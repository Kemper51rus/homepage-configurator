import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const projectRoot = join(import.meta.dirname, "..");
const installer = join(projectRoot, "install.mjs");
const manifestName = ".homepage-configurator-manifest.json";

function write(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function targetFixture() {
  const base = mkdtempSync(join(tmpdir(), "component-cli-"));
  const target = join(base, "target");
  mkdirSync(target);
  write(join(target, "package.json"), `${JSON.stringify({ name: "homepage", version: "2.4.0" })}\n`);
  for (const file of [
    "next.config.js",
    "src/pages/index.jsx",
    "src/components/services/group.jsx",
    "src/components/bookmarks/group.jsx",
  ]) write(join(target, file), "// fixture\n");
  write(join(target, manifestName), `${JSON.stringify({
    schema: 2,
    core: { configurator: { version: "0.7.0" }, overlayFiles: [], patchFiles: [] },
    components: {},
  }, null, 2)}\n`);
  return { base, target };
}

function componentFixture(base, {
  id = "demo-card",
  version = "1.0.0",
  files = ["src/demo-card.js"],
  requires = { configurator: ">=0.7.0" },
} = {}) {
  const component = join(base, `component-${version.replaceAll(".", "-")}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(component, "overlay"), { recursive: true });
  for (const file of files) write(join(component, "overlay", ...file.split("/")), `export default ${JSON.stringify(version)};\n`);
  write(join(component, "homepage-component.json"), `${JSON.stringify({
    schema: 1,
    id,
    version,
    requires,
    overlay: { root: "overlay", files },
    configFiles: [],
    dataDirs: [],
  }, null, 2)}\n`);
  return component;
}

function cli(target, ...args) {
  return spawnSync(process.execPath, [installer, "--target", target, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout}${result.stderr}`;
}

test("component CLI supports dry-run, install, status, update and remove", async () => {
  const { base, target } = targetFixture();
  const v1 = componentFixture(base);
  const installedFile = join(target, "src/demo-card.js");

  const dryRun = await cli(target, "--component", "install", "demo-card", "--component-dir", v1, "--dry-run");
  assert.equal(dryRun.status, 0, output(dryRun));
  assert.match(dryRun.stdout, /Dry-run only/);
  assert.throws(() => readFileSync(installedFile), /ENOENT/);
  assert.deepEqual(JSON.parse(readFileSync(join(target, manifestName))).components, {});

  const install = await cli(target, "--component", "install", "--component-id", "demo-card", "--component-dir", v1);
  assert.equal(install.status, 0, output(install));
  assert.match(readFileSync(installedFile, "utf8"), /1\.0\.0/);

  const status = await cli(target, "--component", "status", "demo-card");
  assert.equal(status.status, 0, output(status));
  assert.equal(JSON.parse(status.stdout).id, "demo-card");
  assert.equal(JSON.parse(status.stdout).version, "1.0.0");

  const v2 = componentFixture(base, { version: "2.0.0" });
  const update = await cli(target, "--component", "update", "demo-card", "--component-dir", v2, "--force");
  assert.equal(update.status, 0, output(update));
  assert.match(readFileSync(installedFile, "utf8"), /2\.0\.0/);
  assert.equal(JSON.parse(readFileSync(join(target, manifestName))).components["demo-card"].version, "2.0.0");

  const blockedCoreUpdate = await cli(target, "--dry-run");
  assert.notEqual(blockedCoreUpdate.status, 0);
  assert.match(output(blockedCoreUpdate), /Remove components first/);

  const blockedCoreUninstall = await cli(target, "--uninstall", "--dry-run");
  assert.notEqual(blockedCoreUninstall.status, 0);
  assert.match(output(blockedCoreUninstall), /Remove components first/);

  const remove = await cli(target, "--component", "remove", "demo-card", "--force");
  assert.equal(remove.status, 0, output(remove));
  assert.throws(() => readFileSync(installedFile), /ENOENT/);
  assert.deepEqual(JSON.parse(readFileSync(join(target, manifestName))).components, {});
});

test("component CLI rejects id mismatch, traversal, missing install and unknown arguments", async () => {
  const mismatchFixture = targetFixture();
  const mismatchComponent = componentFixture(mismatchFixture.base, { id: "actual-id" });
  const mismatch = await cli(
    mismatchFixture.target,
    "--component",
    "install",
    "requested-id",
    "--component-dir",
    mismatchComponent,
  );
  assert.notEqual(mismatch.status, 0);
  assert.match(output(mismatch), /id mismatch/);

  const traversalFixture = targetFixture();
  const traversalComponent = componentFixture(traversalFixture.base, { files: ["../escape.js"] });
  const traversal = await cli(traversalFixture.target, "--component", "install", "--component-dir", traversalComponent);
  assert.notEqual(traversal.status, 0);
  assert.match(output(traversal), /safe POSIX relative path/);

  const updateFixture = targetFixture();
  const updateComponent = componentFixture(updateFixture.base);
  const update = await cli(updateFixture.target, "--component", "update", "--component-dir", updateComponent);
  assert.notEqual(update.status, 0);
  assert.match(output(update), /not installed/);

  const incompatibleFixture = targetFixture();
  const incompatibleComponent = componentFixture(incompatibleFixture.base, {
    requires: { homepageConfigurator: ">=0.8.0", homepage: ">=3.0.0" },
  });
  const incompatible = await cli(
    incompatibleFixture.target,
    "--component",
    "install",
    "--component-dir",
    incompatibleComponent,
  );
  assert.notEqual(incompatible.status, 0);
  assert.match(output(incompatible), /requires Homepage Configurator/);
  assert.deepEqual(JSON.parse(readFileSync(join(incompatibleFixture.target, manifestName))).components, {});

  const unknown = await cli(updateFixture.target, "--wat");
  assert.notEqual(unknown.status, 0);
  assert.match(output(unknown), /Unknown argument/);
});
