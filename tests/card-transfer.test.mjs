import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { updateConfigFiles, updateConfigFile } from "../overlay/src/mods/browser-editor/lib/config-writer.js";

// The installer supplies js-yaml in Homepage; load the pure field/validation
// portion directly so source tests do not require an installed Homepage tree.
const fields = await readFile(new URL("../overlay/src/mods/browser-editor/lib/item-config.js", import.meta.url), "utf8");
const { knownFields, bookmarkFields, validateItemConfig } = new Function(fields.replace(/^import .*;\n/m, "").replaceAll("export ", "") + "\nreturn { knownFields, bookmarkFields, validateItemConfig };")();
const source = await readFile(new URL("../overlay/src/mods/browser-editor/lib/card-transfer.js", import.meta.url), "utf8");
const { moveCardBetweenTypes, convertCardConfig, validateCardTransfer } = new Function("knownFields", "bookmarkFields", "validateItemConfig", source.replace(/^import .*;\n/m, "").replaceAll("export ", "") + "\nreturn { moveCardBetweenTypes, convertCardConfig, validateCardTransfer };")(knownFields, bookmarkFields, validateItemConfig);
const href = "https://example.com";
const matcher = (type, name, config) => ({ name, config: Object.fromEntries(Object.entries(config).filter(([key]) => knownFields[type].includes(key) && !(type === "services" && key === "weight"))) });
const identity = (type, group, name, config, index = null) => ({ type, group, name, matcher: matcher(type, name, config), index });
const end = (type, group) => ({ type, group, name: null, matcher: null, index: null });
const request = (source, target) => ({ action: "move-item-between-types", source, target });

test("service to bookmark uses explicit allowlist and drops all service-only/unknown fields", () => {
  const common = { id: "color-red-card", href, icon: "test.svg", description: "desc", abbr: "EX", target: "_blank", titleColor: "red", titleSize: "14px", titleAlign: "left", titleFont: "Arial" };
  const config = { ...common, widget: { key: "secret" }, widgets: [{}], container: "app", docker: "host", proxmoxNode: "node", siteMonitor: href, ping: href, weight: 23, monitor: true, unknown: "private" };
  assert.deepEqual(convertCardConfig(config, "bookmarks"), common);
  assert.deepEqual(convertCardConfig({ ...common, showLink: false }, "services"), common);
});

test("conversion rejects active URL schemes without fetching, retains ordinary absolute schemes", () => {
  for (const type of ["bookmarks", "services"]) {
    for (const unsafe of ["javascript:alert(1)", "  JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]) {
      assert.throws(() => convertCardConfig({ href: unsafe }, type), /Небезопасная схема/);
    }
    for (const safe of [href, "http://example.com", "mailto:admin@example.com", "tel:+1234567", "ftp://example.com/file"]) {
      assert.equal(convertCardConfig({ href: safe }, type).href, safe);
    }
  }
});

test("both directions preserve metadata and target YAML shape, even identical group/card names", () => {
  for (const type of ["services", "bookmarks"]) {
    const targetType = type === "services" ? "bookmarks" : "services";
    const config = { href, id: "card", icon: "a.svg" };
    const raw = type === "services" ? config : [config];
    const configs = { [type]: [{ Group: [{ Same: raw }] }], [targetType]: [{ Group: [] }] };
    const original = structuredClone(configs);
    const next = moveCardBetweenTypes(configs, request(identity(type, "Group", "Same", config, 0), end(targetType, "Group")));
    assert.deepEqual(configs, original);
    assert.deepEqual(next[type], [{ Group: [] }]);
    const result = next[targetType][0].Group[0].Same;
    assert.equal(Array.isArray(result), targetType === "bookmarks");
    const converted = targetType === "bookmarks" ? result[0] : result;
    assert.equal(converted.href, href);
    assert.equal(converted.id, "card");
    assert.equal(converted.icon, "a.svg");
  }
});

test("nested source and target groups, before/end insertion with weighted visual order", () => {
  const config = { href, titleColor: "red" };
  const a = { href: "https://a.test", weight: 900 }, b = { href: "https://b.test", weight: 100 };
  const configs = { bookmarks: [{ Links: [{ New: [config] }] }], services: [{ Outer: [{ Inner: [{ A: a }, { Sub: [] }, { B: b }] }] }] };
  const next = moveCardBetweenTypes(configs, request(identity("bookmarks", "Links", "New", config, 0), identity("services", "Inner", "A", a, 1)));
  const entries = next.services[0].Outer[0].Inner;
  assert.deepEqual(entries.map((entry) => Object.keys(entry)[0]), ["B", "Sub", "New", "A"]);
  assert.deepEqual(entries[1], { Sub: [] });
  assert.ok(entries[0].B.weight < entries[2].New.weight && entries[2].New.weight < entries[3].A.weight);
  const back = moveCardBetweenTypes(next, request(identity("services", "Inner", "New", entries[2].New, 1), end("bookmarks", "Links")));
  assert.deepEqual(back.bookmarks[0].Links, [{ New: [config] }]);
  assert.equal(back.services[0].Outer[0].Inner.filter((entry) => entry.New).length, 0);
  const appended = moveCardBetweenTypes(configs, request(identity("bookmarks", "Links", "New", config), end("services", "Inner")));
  assert.deepEqual(appended.services[0].Outer[0].Inner.map((entry) => Object.keys(entry)[0]), ["B", "Sub", "A", "New"]);
});

test("same-name destination is never overwritten, source removed exactly once", () => {
  const config = { href }, existing = { href: "https://existing.test" };
  const configs = { services: [{ G: [{ Same: config }, { Other: { href } }] }], bookmarks: [{ G: [{ Same: [existing] }] }] };
  const next = moveCardBetweenTypes(configs, request(identity("services", "G", "Same", config, 0), identity("bookmarks", "G", "Same", existing, 0)));
  assert.deepEqual(next.bookmarks[0].G, [{ Same: [config] }, { Same: [existing] }]);
  assert.deepEqual(next.services[0].G, [{ Other: { href } }]);
});

test("strict source matcher/index rejects stale identities instead of fallback deleting another card", () => {
  const config = { href };
  const configs = { services: [{ G: [{ A: config }, { B: config }] }], bookmarks: [{ G: [] }] };
  for (const invalid of [identity("services", "G", "Missing", config, 0), identity("services", "G", "A", { href: "https://stale.test" }, 0), identity("services", "G", "A", config, 1), identity("services", "Missing", "A", config)]) {
    assert.throws(() => moveCardBetweenTypes(configs, request(invalid, end("bookmarks", "G"))), /Обновите/);
  }
  assert.throws(() => moveCardBetweenTypes(configs, request(identity("services", "G", "A", config), end("bookmarks", "Missing"))), /Группа/);
  assert.deepEqual(configs.services[0].G, [{ A: config }, { B: config }]);
});

test("duplicate identities require a valid index; duplicate groups fail closed", () => {
  const config = { href };
  const configs = { services: [{ G: [{ A: config }, { A: config }] }], bookmarks: [{ G: [] }] };
  assert.throws(() => moveCardBetweenTypes(configs, request(identity("services", "G", "A", config), end("bookmarks", "G"))), /неоднозначна/);
  const next = moveCardBetweenTypes(configs, request(identity("services", "G", "A", config, 1), end("bookmarks", "G")));
  assert.equal(next.services[0].G.length, 1);
  assert.equal(next.bookmarks[0].G.length, 1);
  configs.bookmarks.push({ G: [] });
  assert.throws(() => moveCardBetweenTypes(configs, request(identity("services", "G", "A", config, 1), end("bookmarks", "G"))), /неоднозначна/);
});

test("malformed and unbounded request fields, client config and wrong types are rejected", () => {
  const valid = request(identity("services", "G", "A", { href }), end("bookmarks", "G"));
  for (const body of [null, [], { ...valid, config: { href } }, { ...valid, source: { ...valid.source, type: "settings" } }, { ...valid, target: end("services", "G") }, { ...valid, source: { ...valid.source, index: -1 } }, { ...valid, source: { ...valid.source, index: "0" } }, { ...valid, source: { ...valid.source, matcher: null } }, { ...valid, source: { ...valid.source, group: "x".repeat(513) } }, { ...valid, source: { ...valid.source, matcher: { name: "A", config: { widget: {} } } } }]) {
    assert.throws(() => validateCardTransfer(body));
  }
  assert.throws(() => convertCardConfig({}, "bookmarks"), /URL/);
  assert.throws(() => convertCardConfig({ href: "#" }, "bookmarks"), /абсолютным/);
});

test("stale target or multi-config bookmark never mutates either input", () => {
  const config = { href };
  const configs = { services: [{ G: [{ A: config }] }], bookmarks: [{ G: [{ B: [config] }] }] };
  assert.throws(() => moveCardBetweenTypes(configs, request(identity("services", "G", "A", config), identity("bookmarks", "G", "Gone", config, 0))), /изменилась/);
  configs.bookmarks[0].G[0].B.push({ href: "https://second.test" });
  assert.throws(() => moveCardBetweenTypes(configs, request(identity("bookmarks", "G", "B", config), end("services", "G"))), /несколько конфигураций/);
  assert.equal(configs.bookmarks[0].G[0].B.length, 2);
});

async function apiFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "card-transfer-api-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = { href, id: "card" };
  const configs = { services: [{ G: [{ A: config }] }], bookmarks: [{ G: [] }] };
  for (const [type, value] of Object.entries(configs)) await fs.writeFile(path.join(dir, `${type}.yaml`), JSON.stringify(value));
  const css = "/* radio and particles remain */\n.user { color: red; }\n";
  await fs.writeFile(path.join(dir, "custom.css"), css);
  const api = await readFile(new URL("../overlay/src/mods/browser-editor/api/editor.js", import.meta.url), "utf8");
  const block = api.slice(api.indexOf('if (action === "move-item-between-types")'), api.indexOf('if (action === "get-component-catalog")'));
  const execute = new Function("req", "res", "validateCardTransfer", "moveCardBetweenTypes", "updateConfigFiles", "getConfigPath", "yaml", "regenerateAllStylesCss", "getEditorConfig", `const action = req.body.action; return (async () => { ${block} })();`);
  let regenerations = 0;
  const getConfigPath = (type) => path.join(dir, `${type}.yaml`);
  const getEditorConfig = async () => Object.fromEntries(await Promise.all(Object.keys(configs).map(async (type) => [type, JSON.parse(await fs.readFile(getConfigPath(type), "utf8"))])));
  const run = (body) => execute({ body }, { status(code) { assert.equal(code, 200); return this; }, json(value) { return value; } }, validateCardTransfer, moveCardBetweenTypes, updateConfigFiles, getConfigPath, { load: JSON.parse, dump: JSON.stringify }, async () => { regenerations += 1; }, getEditorConfig);
  return { dir, config, configs, css, run, getConfigPath, getEditorConfig, regenerations: () => regenerations };
}

test("server action resolves latest locked snapshots, retains unrelated data and CSS", async (t) => {
  const fixture = await apiFixture(t);
  await updateConfigFile(fixture.getConfigPath("bookmarks"), (raw) => {
    const current = JSON.parse(raw);
    current[0].G.push({ Concurrent: [{ href: "https://concurrent.test" }] });
    return JSON.stringify(current);
  });
  const next = await fixture.run(request(identity("services", "G", "A", fixture.config, 0), end("bookmarks", "G")));
  assert.equal(next.services[0].G.length, 0);
  assert.deepEqual(next.bookmarks[0].G, [{ Concurrent: [{ href: "https://concurrent.test" }] }, { A: [fixture.config] }]);
  assert.equal(await fs.readFile(path.join(fixture.dir, "custom.css"), "utf8"), fixture.css);
  assert.equal(fixture.regenerations(), 1);
  await assert.rejects(fixture.run(request(identity("services", "G", "A", fixture.config, 0), end("bookmarks", "G"))), /исчезла/);
});

test("server destination/source publish failures preserve both exact snapshots and CSS", async (t) => {
  for (const failedType of ["bookmarks", "services"]) {
    const fixture = await apiFixture(t);
    const rename = fs.rename;
    let failed = false;
    const mock = t.mock.method(fs, "rename", async (...args) => {
      if (!failed && args[1] === fixture.getConfigPath(failedType)) {
        failed = true;
        throw new Error("injected publish failure");
      }
      return rename(...args);
    });
    await assert.rejects(fixture.run(request(identity("services", "G", "A", fixture.config, 0), end("bookmarks", "G"))), /injected publish failure/);
    mock.mock.restore();
    assert.deepEqual(await fixture.getEditorConfig(), fixture.configs);
    for (const [type, value] of Object.entries(fixture.configs)) assert.equal(await fs.readFile(fixture.getConfigPath(type), "utf8"), JSON.stringify(value));
    assert.equal(await fs.readFile(path.join(fixture.dir, "custom.css"), "utf8"), fixture.css);
    assert.equal(fixture.regenerations(), 0);
  }
});

test("style regeneration includes transferred cards in nested service groups", async () => {
  const api = await readFile(new URL("../overlay/src/mods/browser-editor/api/editor.js", import.meta.url), "utf8");
  const block = api.slice(api.indexOf("async function regenerateAllStylesCss()"), api.indexOf("async function getEditorConfig()"));
  const configs = { services: [{ Outer: [{ Inner: [{ Nested: { href, titleColor: "red" } }] }] }], bookmarks: [], settings: {} };
  let captured;
  const regenerate = new Function("readYamlFile", "extractGroupLayouts", "generateCssForLayouts", "generateCssForItems", "updateCustomCssWithStyles", "logger", `${block}; return regenerateAllStylesCss;`)(async (type) => configs[type], () => [], () => "", (items) => JSON.stringify(items), async (value) => { captured = JSON.parse(value); }, { error(error) { throw error; } });
  await regenerate();
  assert.deepEqual(captured, [{ name: "Nested", config: { href, titleColor: "red" }, type: "services" }]);
});

test("API action uses current compound-locked YAML, destination first, no client config", async () => {
  const api = await readFile(new URL("../overlay/src/mods/browser-editor/api/editor.js", import.meta.url), "utf8");
  const block = api.slice(api.indexOf('if (action === "move-item-between-types")'), api.indexOf('if (action === "get-component-catalog")'));
  assert.match(block, /validateCardTransfer\(req.body\)/);
  assert.match(block, /\[input.target.type, input.source.type\]/);
  assert.match(block, /updateConfigFiles/);
  assert.match(block, /yaml.load\(contents\[index\]\)/);
  assert.match(block, /moveCardBetweenTypes\(configs, input\)/);
  assert.doesNotMatch(block, /writeYamlFile|req.body.config/);
  assert.match(block, /regenerateAllStylesCss/);
});
