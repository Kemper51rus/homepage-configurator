import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const api = readFileSync(new URL("../overlay/src/mods/browser-editor/api/editor.js", import.meta.url), "utf8");
const installer = readFileSync(new URL("../install.sh", import.meta.url), "utf8");
const metadata = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8"));

function installedVersion(manifest) {
  const source = api.slice(api.indexOf("async function getInstalledConfiguratorInfo("), api.indexOf("async function getHomepageTargetInfo("));
  const context = { readJsonIfExists: async () => manifest, path: { join: (...parts) => parts.join("/") }, configuratorName: "homepage-configurator", configuratorVersion: "fallback" };
  return vm.runInNewContext(`${source}\ngetInstalledConfiguratorInfo('/homepage')`, context);
}

test("schema 2 core version is used instead of the embedded legacy fallback", async () => {
  assert.deepEqual(JSON.parse(JSON.stringify(await installedVersion({ schema: 2, core: { configurator: { version: "0.8.0-beta.4" }, installedAt: "today" }, components: {} }))), {
    name: "homepage-configurator", version: "0.8.0-beta.4", installedAt: "today", targetDir: "/homepage", manifestFound: true,
  });
  assert.equal((await installedVersion({ configurator: { version: "0.7.0" } })).version, "0.7.0");
});

test("GitHub browser update uses the maintained component-host release branch", () => {
  assert.equal(metadata.branch, "feature/component-host-v1");
  assert.ok(metadata.metadataUrl.endsWith("ref=feature/component-host-v1"));
  assert.ok(metadata.installUrl.endsWith("/feature/component-host-v1/install.sh"));
  assert.match(api, /const defaultConfiguratorBranch = "feature\/component-host-v1"/);
  assert.match(api, /versionComparison <= 0/);
  assert.match(installer, /BRANCH="\$\{HOMEPAGE_EDITOR_BRANCH:-feature\/component-host-v1\}"/);
});

test("failed live Classic update restores the build, source, manifest, and custom files", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "homepage-classic-reinstall-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, "homepage");
  const config = join(target, "config");
  mkdirSync(join(target, "src"), { recursive: true });
  mkdirSync(join(target, ".next", "standalone"), { recursive: true });
  mkdirSync(config);
  mkdirSync(join(target, "public", "images", "radio"), { recursive: true });
  writeFileSync(join(target, "public", "images", "radio", "station.png"), "previous radio asset");
  writeFileSync(join(target, "src", "app.js"), "previous source");
  writeFileSync(join(target, ".next", "standalone", "server.js"), "previous build");
  writeFileSync(join(target, ".homepage-configurator-manifest.json"), "previous manifest");
  writeFileSync(join(config, "custom.js"), "previous custom");
  const shell = join(dir, "installer-functions.sh");
  writeFileSync(shell, installer.replace(/\nmain "\$@"\s*$/, "\n"));
  const script = `source "$1"; TARGET="$2"; CONFIG_DIR="$3"; ACTION=update-mod; snapshot_update_target; prepare_live_build_output; mkdir -p "$TARGET/.next/standalone"; printf changed > "$TARGET/.next/standalone/server.js"; printf changed > "$TARGET/src/app.js"; printf changed > "$TARGET/.homepage-configurator-manifest.json"; printf changed > "$CONFIG_DIR/custom.js"; printf changed > "$TARGET/public/images/radio/station.png"; exit 42`;
  const result = spawnSync("bash", ["-c", script, "test", shell, target, config], { encoding: "utf8" });
  assert.equal(result.status, 42, result.stderr);
  assert.equal(readFileSync(join(target, ".next", "standalone", "server.js"), "utf8"), "previous build");
  assert.equal(readFileSync(join(target, "src", "app.js"), "utf8"), "previous source");
  assert.equal(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"), "previous manifest");
  assert.equal(readFileSync(join(config, "custom.js"), "utf8"), "previous custom");
  assert.equal(readFileSync(join(target, "public", "images", "radio", "station.png"), "utf8"), "previous radio asset");
  assert.equal(existsSync(join(target, ".homepage-configurator-running-next")), false);
});
