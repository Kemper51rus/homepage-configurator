import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateComponentManifest } from "../lib/component-installer.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const installer = join(root, "install.mjs");
const studio = process.env.STUDIO_COMPONENT_DIR || "/projects/homepage-studio";
const homepageRef = process.env.HOMEPAGE_TEST_REF?.trim();
const buildEnabled = process.env.COMPONENT_SMOKE_BUILD === "1";
const manifestName = ".homepage-configurator-manifest.json";
const tempRoot = mkdtempSync(join(tmpdir(), "homepage-component-profile-"));
const target = join(tempRoot, "homepage");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
    env: options.env ?? process.env,
  });
}

function targetPath(relativePath) {
  return join(target, ...relativePath.split("/"));
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readInstallManifest() {
  const manifest = readJson(join(target, manifestName));
  assert.equal(manifest.schema, 2, "Configurator manifest must use schema 2");
  assert.ok(manifest.core && typeof manifest.core === "object", "Schema 2 manifest must contain core metadata");
  assert.ok(
    manifest.components && typeof manifest.components === "object" && !Array.isArray(manifest.components),
    "Schema 2 manifest must contain a components object",
  );
  return manifest;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function snapshotFiles(paths, label) {
  return new Map(paths.map((relativePath) => {
    const file = targetPath(relativePath);
    assert.ok(existsSync(file), `${label} is missing: ${relativePath}`);
    assert.ok(statSync(file).isFile(), `${label} is not a regular file: ${relativePath}`);
    return [relativePath, readFileSync(file)];
  }));
}

function assertSentinels(sentinels, stage) {
  for (const [relativePath, expected] of sentinels) {
    assert.deepEqual(readFileSync(targetPath(relativePath)), expected, `${stage} changed persistent file ${relativePath}`);
  }
}

function componentArgs(operation, componentId, includeDirectory = false) {
  return [
    installer,
    "--component",
    operation,
    componentId,
    ...(includeDirectory ? ["--component-dir", studio] : []),
    "--target",
    target,
  ];
}

function assertComponentInstalled(componentManifest, coreOverlaySnapshot, routeFiles, stage) {
  const installManifest = readInstallManifest();
  const record = installManifest.components[componentManifest.id];
  assert.ok(record && typeof record === "object", `${stage} did not register ${componentManifest.id}`);
  assert.equal(record.version, componentManifest.version, `${stage} recorded the wrong component version`);

  const expectedOwned = componentManifest.overlay.files.map((entry) => entry.target);
  assert.deepEqual(new Set(record.ownedFiles), new Set(expectedOwned), `${stage} recorded the wrong owned files`);
  assert.equal(record.ownedFiles.length, expectedOwned.length, `${stage} recorded duplicate owned files`);
  assert.deepEqual(record.persistentFiles, componentManifest.persistentFiles, `${stage} recorded the wrong persistent files`);

  for (const entry of componentManifest.overlay.files) {
    const installed = readFileSync(targetPath(entry.target));
    const source = readFileSync(entry.sourcePath);
    assert.deepEqual(installed, source, `${stage} installed unexpected bytes for ${entry.target}`);
    assert.equal(record.hashes?.[entry.target], sha256(installed), `${stage} recorded the wrong hash for ${entry.target}`);
  }

  for (const relativePath of componentManifest.replacesCoreFiles) {
    assert.ok(coreOverlaySnapshot.has(relativePath), `Studio declares a non-core replacement: ${relativePath}`);
    assert.equal(record.replaced?.[relativePath], relativePath, `${stage} did not record core replacement ${relativePath}`);
  }

  for (const routeFile of routeFiles) {
    assert.ok(record.ownedFiles.includes(routeFile), `${stage} does not own Studio route ${routeFile}`);
    assert.ok(existsSync(targetPath(routeFile)), `${stage} is missing Studio route ${routeFile}`);
  }

  const status = JSON.parse(run("node", componentArgs("status", componentManifest.id)));
  assert.deepEqual(status, { id: componentManifest.id, ...record }, `${stage} status does not match the manifest`);
  return { installManifest, record };
}

function productionBuild(stage) {
  if (!buildEnabled) return;
  console.log(`Running production build: ${stage}`);
  run("pnpm", ["run", "build"], {
    cwd: target,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
}

try {
  const rawComponentManifest = readJson(join(studio, "homepage-component.json"));
  const componentManifest = validateComponentManifest(rawComponentManifest, studio);
  const routeFiles = (rawComponentManifest.apiRoutes ?? []).map((route) => `src/pages${route}.js`);
  assert.ok(routeFiles.length > 0, "Studio component must declare API routes for this profile smoke");
  const overlayTargets = new Set(componentManifest.overlay.files.map((entry) => entry.target));
  for (const routeFile of routeFiles) {
    assert.ok(overlayTargets.has(routeFile), `Studio API route has no overlay file: ${routeFile}`);
  }

  const cloneArgs = ["clone", "--depth", "1"];
  if (homepageRef) cloneArgs.push("--branch", homepageRef);
  cloneArgs.push("https://github.com/gethomepage/homepage.git", target);
  run("git", cloneArgs, { stdio: "inherit" });

  run("node", [installer, "--target", target], { stdio: "inherit" });
  const coreManifest = readInstallManifest();
  assert.deepEqual(coreManifest.components, {}, "Fresh core install must not contain components");
  assert.ok(Array.isArray(coreManifest.core.overlayFiles) && coreManifest.core.overlayFiles.length > 0, "Core manifest has no overlay files");
  const coreOverlaySnapshot = snapshotFiles(coreManifest.core.overlayFiles, "Core overlay file");
  const coreOverlayPaths = new Set(coreOverlaySnapshot.keys());

  for (const routeFile of routeFiles) {
    assert.ok(!coreOverlayPaths.has(routeFile), `Studio-only route is unexpectedly owned by core: ${routeFile}`);
  }
  const nonCoreOwned = componentManifest.overlay.files
    .map((entry) => entry.target)
    .filter((relativePath) => !coreOverlayPaths.has(relativePath));
  for (const relativePath of nonCoreOwned) {
    assert.ok(!existsSync(targetPath(relativePath)), `Non-core Studio file already exists after core install: ${relativePath}`);
  }

  const sentinels = new Map(componentManifest.persistentFiles.map((relativePath, index) => {
    const contents = Buffer.from(`homepage-component-profile sentinel ${index}: ${relativePath}\n`);
    const file = targetPath(relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return [relativePath, contents];
  }));

  if (buildEnabled) {
    run("pnpm", ["install", "--no-frozen-lockfile"], { cwd: target, stdio: "inherit" });
  }
  productionBuild("core");

  run("node", componentArgs("install", componentManifest.id, true), { stdio: "inherit" });
  assertComponentInstalled(componentManifest, coreOverlaySnapshot, routeFiles, "Component install");
  assertSentinels(sentinels, "Component install");
  productionBuild("Studio");

  run("node", componentArgs("remove", componentManifest.id), { stdio: "inherit" });
  const removedManifest = readInstallManifest();
  assert.ok(!Object.hasOwn(removedManifest.components, componentManifest.id), "Component remains registered after remove");
  for (const [relativePath, expected] of coreOverlaySnapshot) {
    assert.deepEqual(readFileSync(targetPath(relativePath)), expected, `Remove did not restore exact core bytes for ${relativePath}`);
  }
  for (const relativePath of nonCoreOwned) {
    assert.ok(!existsSync(targetPath(relativePath)), `Remove left non-core owned file ${relativePath}`);
  }
  assertSentinels(sentinels, "Component remove");
  productionBuild("core after component remove");

  run("node", componentArgs("install", componentManifest.id, true), { stdio: "inherit" });
  assertComponentInstalled(componentManifest, coreOverlaySnapshot, routeFiles, "Component reinstall");
  assertSentinels(sentinels, "Component reinstall");

  console.log(
    `Component profile smoke passed for ${componentManifest.id}@${componentManifest.version}`
      + `${homepageRef ? ` on Homepage ${homepageRef}` : " on fresh Homepage"}${buildEnabled ? " with production builds" : ""}.`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
