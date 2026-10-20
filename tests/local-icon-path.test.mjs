import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { normalizeLocalIconPath, normalizeLocalIconFields } from "../overlay/src/mods/browser-editor/lib/local-icon-path.js";

const local = "/api/config/icon/help.ico";
const ingress = "/api/ingress/some-other_token-123";
const broken = ingress.repeat(4) + local;
const api = await readFile(new URL("../overlay/src/mods/browser-editor/api/editor.js", import.meta.url), "utf8");

test("local ingress icon repair accepts one/many safe tokens and Unicode basenames, and is idempotent", () => {
  for (const prefix of [ingress, ingress.repeat(4), "/api/ingress/one/api/ingress/two-2"]) {
    for (const name of ["help.ico", "Моя иконка (1).PNG", "cafe\u0301.svg", "图标.webp", "a-b_c.2.jpeg"]) {
      const canonical = `/api/config/icon/${name}`;
      const fixed = normalizeLocalIconPath(prefix + canonical);
      assert.equal(fixed, canonical);
      assert.equal(normalizeLocalIconPath(fixed), canonical);
    }
  }
});

test("external, query, unrelated, malformed and unsafe paths are preserved exactly", () => {
  const values = [null, undefined, 1, {}, local, "mdi-help", "help.ico", "", `https://example.com${broken}`, `http://example.com${broken}`, `//example.com${broken}`, `${broken}?v=1`, `${broken}#icon`, `${broken}\n`, `/prefix${broken}`, `${ingress}/images/help.ico`, `${ingress}/api/config/icons/help.ico`, `${ingress}/api/config/icon/nested/help.ico`, `${ingress}/api/config/icon/../help.ico`, `${ingress}/api/config/icon/foo..png`, `${ingress}/api/config/icon/.hidden.png`, `${ingress}/api/config/icon/%2e%2e%2fhelp.ico`, `${ingress}/api/config/icon/a%2Fhelp.ico`, `${ingress}/api/config/icon/a\\help.ico`, `${ingress}/api/config/icon/help.svg/extra`, `${ingress}/api/config/icon/help.html`, `${ingress}/api/config/icon/help\u0000.ico`, `/api/ingress/../api/config/icon/help.ico`, `/api/ingress/token%2fother${local}`, `/api/ingress//token${local}`];
  for (const value of values) assert.equal(normalizeLocalIconPath(value), value);
});

test("recursive field repair changes only icon string values without mutating input", () => {
  const source = [{ Outer: [{ Inner: [{ Service: { icon: broken, href: broken, description: broken, widget: { icon: broken, url: broken } } }, { Bookmark: [{ icon: broken, href: broken }] }] }] }];
  const original = structuredClone(source);
  const fixed = normalizeLocalIconFields(source);
  assert.deepEqual(source, original);
  const entries = fixed[0].Outer[0].Inner;
  assert.equal(entries[0].Service.icon, local);
  assert.equal(entries[0].Service.href, broken);
  assert.equal(entries[0].Service.description, broken);
  assert.deepEqual(entries[0].Service.widget, { icon: local, url: broken });
  assert.deepEqual(entries[1].Bookmark, [{ icon: local, href: broken }]);
  assert.equal(normalizeLocalIconFields(fixed), fixed);
  assert.equal(normalizeLocalIconFields({ href: broken }).href, broken);
  const cycle = {}; cycle.self = cycle;
  assert.equal(normalizeLocalIconFields(cycle), cycle);
  const date = new Date();
  assert.equal(normalizeLocalIconFields(date), date);
});

function getFunction(start, end, names, values) {
  const source = api.slice(api.indexOf(start), api.indexOf(end, api.indexOf(start)));
  return new Function(...names, `${source}\nreturn ${start.match(/function (\w+)/)[1]};`)(...values);
}

// js-yaml is supplied by the target Homepage, not this source-only repository.
// Inject a deterministic codec and execute the actual save functions to check
// their parsed-object boundaries, dump decisions and exact raw-byte retention.
function saveFixture() {
  const writes = [];
  const samples = new Map();
  let dumps = 0;
  const yaml = {
    load: (text) => samples.has(text) ? structuredClone(samples.get(text)) : JSON.parse(text),
    dump: (value) => { dumps += 1; return JSON.stringify(value); },
  };
  const writeConfigFile = async (file, text) => writes.push({ file, text });
  const writeYaml = getFunction("async function writeYamlFile(", "async function fileExists(", ["getConfigPath", "yaml", "writeConfigFile", "normalizeLocalIconFields"], [(file) => file, yaml, writeConfigFile, normalizeLocalIconFields]);
  const writeRaw = getFunction("async function writeRawConfigFile(", "function isSupportedSettingsTabFile(", ["path", "CONF_DIR", "checkAndCopyConfig", "ensureTextFile", "yaml", "writeConfigFile", "normalizeLocalIconFields"], [{ join: (...parts) => parts.join("/") }, "config", () => {}, async (file) => file, yaml, writeConfigFile, normalizeLocalIconFields]);
  return { writes, samples, writeYaml, writeRaw, dumps: () => dumps };
}

test("structured saves normalize services/bookmarks but leave settings and unrelated fields alone", async () => {
  const f = saveFixture();
  const input = [{ G: [{ App: { icon: broken, href: broken } }] }];
  for (const type of ["services", "bookmarks", "settings"]) {
    await f.writeYaml(type, input);
    const saved = JSON.parse(f.writes.at(-1).text)[0].G[0].App;
    assert.equal(saved.icon, type === "settings" ? broken : local);
    assert.equal(saved.href, broken);
  }
  assert.equal(input[0].G[0].App.icon, broken);
});

test("raw YAML repairs only both card files; clean/unrelated YAML retains comments, spacing and bytes", async () => {
  const f = saveFixture();
  const clean = `# keep comment\r\n- G: [ { App: { icon: '${local}', href: '${broken}' } } ]\r\n`;
  const corrupt = `# repair icon\n- G:\n  - App:\n      icon: ${broken}\n      href: ${broken}\n`;
  f.samples.set(clean, [{ G: [{ App: { icon: local, href: broken } }] }]);
  f.samples.set(corrupt, [{ G: [{ App: { icon: broken, href: broken } }] }]);
  for (const file of ["services.yaml", "bookmarks.yaml"]) {
    const dumps = f.dumps();
    await f.writeRaw(file, "yaml", clean);
    assert.equal(f.writes.at(-1).text, clean);
    assert.equal(f.dumps(), dumps);
    await f.writeRaw(file, "yaml", corrupt);
    assert.deepEqual(JSON.parse(f.writes.at(-1).text)[0].G[0].App, { icon: local, href: broken });
  }
  for (const file of ["settings.yaml", "widgets.yaml", "other.yaml"]) {
    await f.writeRaw(file, "yaml", corrupt);
    assert.equal(f.writes.at(-1).text, corrupt);
  }
  await f.writeRaw("custom.js", "text", broken);
  assert.equal(f.writes.at(-1).text, broken);
  await assert.rejects(f.writeRaw("services.yaml", "yaml", "invalid YAML stub input"));
});

test("cross-type transfer serializes canonical icons in both destination and source", async () => {
  const start = api.indexOf('        const order = [input.target.type, input.source.type];');
  const end = api.indexOf('        await regenerateAllStylesCss();', start);
  const block = api.slice(start, end);
  assert.ok(start > 0 && end > start);
  for (const sourceType of ["services", "bookmarks"]) {
    const targetType = sourceType === "services" ? "bookmarks" : "services";
    let result;
    const run = new Function("input", "getConfigPath", "updateConfigFiles", "yaml", "moveCardBetweenTypes", "normalizeLocalIconFields", `return (async () => { ${block} })();`);
    const source = { [sourceType]: [{ icon: broken, href: broken }], [targetType]: [{ icon: broken, href: broken }] };
    await run({ source: { type: sourceType }, target: { type: targetType } }, (type) => type, async (files, transform) => {
      assert.deepEqual(files, [targetType, sourceType]);
      result = await transform(files.map((file) => JSON.stringify(source[file])));
    }, { load: JSON.parse, dump: JSON.stringify }, (configs) => configs, normalizeLocalIconFields);
    for (const saved of result) assert.deepEqual(JSON.parse(saved), [{ icon: local, href: broken }]);
  }
});

test("both rendering patches import the shared helper and normalize before direct src selection", async () => {
  for (const name of ["browser-editor.patch", "browser-editor-homepage-2.0.patch"]) {
    const patch = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    const start = patch.indexOf("diff --git a/src/components/resolvedicon.jsx");
    const end = patch.indexOf("diff --git", start + 10);
    const diff = patch.slice(start, end);
    assert.match(diff, /\+import \{ normalizeLocalIconPath \} from "mods\/browser-editor\/lib\/local-icon-path";/);
    assert.match(diff, /\+  icon = normalizeLocalIconPath\(icon\);\n\+\n   \/\/ direct or relative URLs/);
    // Execute the added normalization and the upstream direct-src branch.
    const statement = diff.match(/^\+(  icon = normalizeLocalIconPath\(icon\);)$/m)[1];
    const renderSource = new Function("normalizeLocalIconPath", "icon", `${statement}\nif (icon.startsWith("http") || icon.startsWith("/")) return icon;`);
    assert.equal(renderSource(normalizeLocalIconPath, broken), local);
    assert.equal(renderSource(normalizeLocalIconPath, `https://example.com${broken}`), `https://example.com${broken}`);
  }
});
