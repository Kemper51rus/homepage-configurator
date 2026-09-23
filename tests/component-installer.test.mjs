import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  applyComponentInstall,
  configuratorManifestName,
  normalizeConfiguratorManifest,
  planComponentInstall,
  removeComponent,
  validateComponentManifest,
} from "../lib/component-installer.mjs";

function fixture(files = {}) {
  const base = mkdtempSync(join(tmpdir(), "component-installer-"));
  const component = join(base, "component");
  const target = join(base, "target");
  mkdirSync(join(component, "overlay"), { recursive: true });
  mkdirSync(target);
  for (const [path, contents] of Object.entries(files)) {
    const file = join(component, "overlay", ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return { base, component, target };
}

function componentManifest(overrides = {}) {
  return {
    schema: 1,
    id: "weather-card",
    version: "1.2.3",
    requires: { configurator: ">=0.7.0" },
    overlay: { root: "overlay", files: ["src/card.js"] },
    configFiles: [],
    dataDirs: [],
    ...overrides,
  };
}

function emptyManifest() {
  return { schema: 2, core: null, components: {} };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("normalizeConfiguratorManifest migrates schema 1 and preserves schema 2", () => {
  const legacy = { schema: 1, version: "0.7.0", overlayFiles: ["src/core.js"] };
  assert.deepEqual(normalizeConfiguratorManifest(legacy), { schema: 2, core: legacy, components: {} });

  const modern = { schema: 2, core: { version: "0.7.0" }, components: { demo: { ownedFiles: [] } } };
  assert.deepEqual(normalizeConfiguratorManifest(modern), modern);
  assert.notEqual(normalizeConfiguratorManifest(modern), modern);
  assert.throws(() => normalizeConfiguratorManifest({ schema: 3 }), /Unsupported configurator manifest schema/);
});

test("validateComponentManifest rejects traversal paths", () => {
  const { component } = fixture({ "src/card.js": "card" });
  assert.throws(
    () => validateComponentManifest(componentManifest({ overlay: { root: "overlay", files: ["../secret"] } }), component),
    /safe POSIX relative path/,
  );
  assert.throws(
    () => validateComponentManifest(componentManifest({ dataDirs: ["data\\outside"] }), component),
    /safe POSIX relative path/,
  );
});

test("validateComponentManifest rejects source symlink escape when symlinks are available", (t) => {
  const { base, component } = fixture();
  const outside = join(base, "outside.js");
  writeFileSync(outside, "outside");
  try {
    symlinkSync(outside, join(component, "overlay", "escape.js"));
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`);
    return;
  }
  assert.throws(
    () => validateComponentManifest(componentManifest({ overlay: { root: "overlay", files: ["escape.js"] } }), component),
    /escapes component root through a symlink/,
  );
});

test("install writes files and status-equivalent component metadata", () => {
  const { component, target } = fixture({ "src/card.js": "export default 'card';\n" });
  const result = applyComponentInstall(target, component, componentManifest(), emptyManifest());
  assert.equal(readFileSync(join(target, "src/card.js"), "utf8"), "export default 'card';\n");

  const stored = readJson(join(target, configuratorManifestName));
  assert.deepEqual(stored, result.manifest);
  assert.deepEqual(stored.components["weather-card"].ownedFiles, ["src/card.js"]);
  assert.match(stored.components["weather-card"].hashes["src/card.js"], /^[a-f0-9]{64}$/);
  assert.deepEqual(stored.components["weather-card"].replaced, {});
  assert.equal(stored.components["weather-card"].version, "1.2.3");
});

test("plan rejects collisions with core and another component", () => {
  const { component, target } = fixture({ "src/card.js": "card" });
  assert.throws(
    () => planComponentInstall(target, component, componentManifest(), {
      schema: 2,
      core: { overlayFiles: ["src/card.js"] },
      components: {},
    }),
    /collision/,
  );
  assert.throws(
    () => planComponentInstall(target, component, componentManifest(), {
      schema: 2,
      core: null,
      components: { other: { ownedFiles: ["src/card.js"] } },
    }),
    /collision/,
  );
});

test("explicit core replacements are backed up and restored on remove", () => {
  const { component, target } = fixture({ "src/card.js": "studio card" });
  mkdirSync(join(target, "src"));
  writeFileSync(join(target, "src/card.js"), "classic card");
  const manifest = componentManifest({
    replacesCoreFiles: ["src/card.js"],
    persistentFiles: ["config/weather-card.yaml"],
  });
  const coreManifest = {
    schema: 2,
    core: { overlayFiles: ["src/card.js"] },
    components: {},
  };

  const installed = applyComponentInstall(target, component, manifest, coreManifest).manifest;
  assert.equal(readFileSync(join(target, "src/card.js"), "utf8"), "studio card");
  assert.deepEqual(installed.components["weather-card"].replacesCoreFiles, ["src/card.js"]);
  assert.deepEqual(installed.components["weather-card"].persistentFiles, ["config/weather-card.yaml"]);

  removeComponent(target, "weather-card", installed);
  assert.equal(readFileSync(join(target, "src/card.js"), "utf8"), "classic card");
});

test("apply rollback restores replaced files and old manifest after injected failure", () => {
  const { component, target } = fixture({ "src/one.js": "new one", "src/two.js": "new two" });
  mkdirSync(join(target, "src"));
  writeFileSync(join(target, "src/one.js"), "old one");
  const oldManifest = emptyManifest();
  const manifestPath = join(target, configuratorManifestName);
  const oldManifestText = `${JSON.stringify(oldManifest)}\n`;
  writeFileSync(manifestPath, oldManifestText);
  const manifest = componentManifest({ overlay: { root: "overlay", files: ["src/one.js", "src/two.js"] } });

  assert.throws(
    () => applyComponentInstall(target, component, manifest, oldManifest, { failAfterCopies: 2 }),
    /Injected failure/,
  );
  assert.equal(readFileSync(join(target, "src/one.js"), "utf8"), "old one");
  assert.throws(() => readFileSync(join(target, "src/two.js")), /ENOENT/);
  assert.equal(readFileSync(manifestPath, "utf8"), oldManifestText);
});

test("remove deletes unchanged owned files and restores replaced originals", () => {
  const { component, target } = fixture({ "src/new.js": "new", "src/replaced.js": "replacement" });
  mkdirSync(join(target, "src"));
  writeFileSync(join(target, "src/replaced.js"), "original");
  const installed = applyComponentInstall(
    target,
    component,
    componentManifest({ overlay: { root: "overlay", files: ["src/new.js", "src/replaced.js"] } }),
    emptyManifest(),
  ).manifest;

  const removed = removeComponent(target, "weather-card", installed);
  assert.throws(() => readFileSync(join(target, "src/new.js")), /ENOENT/);
  assert.equal(readFileSync(join(target, "src/replaced.js"), "utf8"), "original");
  assert.deepEqual(removed.manifest.components, {});
  assert.deepEqual(readJson(join(target, configuratorManifestName)).components, {});
});

test("remove refuses modified owned files before any mutation", () => {
  const { component, target } = fixture({ "src/one.js": "one", "src/two.js": "two" });
  const installed = applyComponentInstall(
    target,
    component,
    componentManifest({ overlay: { root: "overlay", files: ["src/one.js", "src/two.js"] } }),
    emptyManifest(),
  ).manifest;
  const manifestPath = join(target, configuratorManifestName);
  const before = readFileSync(manifestPath, "utf8");
  writeFileSync(join(target, "src/two.js"), "locally modified");

  assert.throws(() => removeComponent(target, "weather-card", installed), /modified component files/);
  assert.equal(readFileSync(join(target, "src/one.js"), "utf8"), "one");
  assert.equal(readFileSync(join(target, "src/two.js"), "utf8"), "locally modified");
  assert.equal(readFileSync(manifestPath, "utf8"), before);
});

test("remove preserves config files and data directories", () => {
  const { component, target } = fixture({ "src/card.js": "card", "config/card.json": "{\"enabled\":true}\n" });
  const installed = applyComponentInstall(
    target,
    component,
    componentManifest({
      configFiles: ["config/card.json"],
      dataDirs: ["data/weather-card"],
    }),
    emptyManifest(),
  ).manifest;
  writeFileSync(join(target, "config/card.json"), "{\"enabled\":false}\n");
  writeFileSync(join(target, "data/weather-card/cache"), "persistent");

  removeComponent(target, "weather-card", installed);
  assert.equal(readFileSync(join(target, "config/card.json"), "utf8"), "{\"enabled\":false}\n");
  assert.equal(readFileSync(join(target, "data/weather-card/cache"), "utf8"), "persistent");
});
