import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  createLoopbackHealthcheckCommand,
  executeComponentOperation,
  getComponentStatusCatalog,
  listComponentOperationCatalog,
  resolveComponentOperationContext,
  selectBuildCommand,
  validateComponentOperationInput,
  validateLoopbackHealthcheckUrl,
  withGlobalMaintenanceLock,
} from "../overlay/src/mods/browser-editor/lib/component-operations.js";

function write(file, contents = "fixture\n") {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "component-operations-test-"));
  const target = join(root, "homepage");
  const configurator = join(root, "configurator");
  const studio = join(root, "studio");

  write(join(target, "package.json"), `${JSON.stringify({ name: "homepage", version: "1.0.0", scripts: { build: "next build" } })}\n`);
  write(join(target, "package-lock.json"), "{}\n");
  for (const file of [
    "next.config.js",
    "src/pages/index.jsx",
    "src/components/services/group.jsx",
    "src/components/bookmarks/group.jsx",
  ]) write(join(target, file));
  write(join(target, "src/current.js"), "before\n");
  const manifest = {
    schema: 2,
    core: {
      source: configurator,
      overlayFiles: ["src/current.js"],
    },
    components: {},
  };
  write(join(target, ".homepage-configurator-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  write(join(configurator, "package.json"), `${JSON.stringify({ name: "homepage-configurator", version: "1.0.0" })}\n`);
  write(join(configurator, "install.mjs"), "// fixture\n");

  const studioManifest = {
    schema: 1,
    id: "homepage-studio",
    version: "2.3.4",
    requires: {},
    overlay: { root: "overlay", files: ["src/new.js", { source: "replacement.js", target: "src/current.js" }] },
    configFiles: [],
    dataDirs: [],
  };
  write(join(studio, "homepage-component.json"), `${JSON.stringify(studioManifest)}\n`);
  write(join(studio, "overlay/src/new.js"), "new\n");
  write(join(studio, "overlay/replacement.js"), "after\n");

  return {
    root,
    target,
    configurator,
    studio,
    env: { HOMEPAGE_CONFIGURATOR_SOURCE_DIR: configurator, HOMEPAGE_STUDIO_COMPONENT_DIR: studio },
  };
}

const validInput = {
  componentId: "homepage-studio",
  sourceId: "github-stable",
  operation: "install",
};

test("browser operation input is an exact fixed allowlist", () => {
  assert.deepEqual(validateComponentOperationInput(validInput), validInput);
  for (const input of [
    { ...validInput, componentId: "../../etc" },
    { ...validInput, sourceId: "https://evil.example/source" },
    { ...validInput, operation: "exec" },
    { ...validInput, path: "/tmp/payload" },
    { ...validInput, url: "https://evil.example" },
    { ...validInput, command: "sh -c id" },
  ]) assert.throws(() => validateComponentOperationInput(input));
});

test("public catalog and status redact paths and URLs", () => {
  const data = fixture();
  const catalog = listComponentOperationCatalog();
  const status = getComponentStatusCatalog(data.target, { env: data.env });
  const serialized = JSON.stringify({ catalog, status });
  assert.equal(serialized.includes(data.root), false);
  assert.equal(serialized.includes("http://"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(status[0].available, true);
  assert.equal(status[0].availableVersion, "2.3.4");
  assert.equal(status[0].installed, false);
});

test("context accepts only real local sources with expected files", () => {
  const data = fixture();
  const context = resolveComponentOperationContext(data.target, { env: data.env });
  assert.equal(context.target, data.target);
  assert.equal(context.configuratorSource, data.configurator);
  assert.equal(context.studioSource, data.studio);

  assert.throws(
    () => resolveComponentOperationContext(data.target, { env: { ...data.env, HOMEPAGE_CONFIGURATOR_SOURCE_DIR: "https://evil.example/x" } }),
    /local directory/,
  );
  assert.throws(
    () => resolveComponentOperationContext(data.target, { env: { ...data.env, HOMEPAGE_STUDIO_COMPONENT_DIR: "/does/not/exist" } }),
    /does not exist/,
  );

  const outside = join(data.root, "outside-install.mjs");
  write(outside);
  const badConfigurator = join(data.root, "bad-configurator");
  write(join(badConfigurator, "package.json"), `${JSON.stringify({ name: "homepage-configurator" })}\n`);
  symlinkSync(outside, join(badConfigurator, "install.mjs"));
  assert.throws(
    () => resolveComponentOperationContext(data.target, { env: { ...data.env, HOMEPAGE_CONFIGURATOR_SOURCE_DIR: badConfigurator } }),
  );
});

test("build commands are fixed arrays selected from lockfiles", () => {
  for (const [lockfile, expected] of [
    ["pnpm-lock.yaml", { executable: "pnpm", args: ["build"] }],
    ["package-lock.json", { executable: "npm", args: ["run", "build"] }],
    ["yarn.lock", { executable: "yarn", args: ["build"] }],
  ]) {
    const root = mkdtempSync(join(tmpdir(), "component-build-command-"));
    write(join(root, lockfile));
    assert.deepEqual(selectBuildCommand(root), expected);
  }
});

test("global maintenance lock rejects a concurrent operation and releases", () => {
  const lockPath = join(mkdtempSync(join(tmpdir(), "component-lock-test-")), "maintenance.lock");
  withGlobalMaintenanceLock(() => {
    assert.throws(
      () => withGlobalMaintenanceLock(() => {}, { lockPath }),
      /already running/,
    );
  }, { lockPath });
  assert.equal(withGlobalMaintenanceLock(() => "released", { lockPath }), "released");
});

test("healthcheck URL permits loopback only", () => {
  assert.equal(validateLoopbackHealthcheckUrl("http://127.0.0.1:3000/api/health"), "http://127.0.0.1:3000/api/health");
  assert.equal(validateLoopbackHealthcheckUrl("http://[::1]:3000/"), "http://[::1]:3000/");
  const command = createLoopbackHealthcheckCommand("http://127.0.0.1:3000/api/healthcheck");
  assert.equal(command.executable, process.execPath);
  assert.deepEqual(command.args.slice(0, 2), ["--input-type=module", "--eval"]);
  assert.equal(command.args.at(-1), "http://127.0.0.1:3000/api/healthcheck");

  for (const url of [
    "https://example.com/health",
    "http://127.0.0.2/health",
    "http://user:pass@localhost/health",
    "file:///etc/passwd",
    "not a url",
  ]) assert.throws(() => validateLoopbackHealthcheckUrl(url));
});

test("successful operation uses fixed no-shell commands and requires restart", () => {
  const data = fixture();
  const calls = [];
  const result = executeComponentOperation(data.target, validInput, {
    env: data.env,
    lockPath: join(data.root, "maintenance.lock"),
    runner(executable, args, options) {
      calls.push({ executable, args, options });
      return "";
    },
  });

  assert.equal(result.restartRequired, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].executable, process.execPath);
  assert.deepEqual(calls[1].args, ["run", "build"]);
  for (const call of calls) {
    assert.ok(Array.isArray(call.args));
    assert.equal(call.options.shell, false);
  }
});

test("build failure restores manifest, owned files, and deletes incoming files", () => {
  const data = fixture();
  const manifestFile = join(data.target, ".homepage-configurator-manifest.json");
  const oldManifest = readFileSync(manifestFile, "utf8");
  const calls = [];
  const runner = (executable, args, options) => {
    calls.push({ executable, args, options });
    assert.equal(options.shell, false);
    assert.ok(Array.isArray(args));
    if (executable === process.execPath) {
      write(join(data.target, "src/current.js"), "mutated\n");
      write(join(data.target, "src/new.js"), "created\n");
      write(manifestFile, "{\"mutated\":true}\n");
      return "";
    }
    if (executable === "npm") throw new Error("injected build failure");
    throw new Error(`unexpected command ${executable}`);
  };

  assert.throws(
    () => executeComponentOperation(data.target, validInput, {
      env: data.env,
      runner,
      lockPath: join(data.root, "maintenance.lock"),
    }),
    /injected build failure/,
  );
  assert.equal(readFileSync(join(data.target, "src/current.js"), "utf8"), "before\n");
  assert.equal(readFileSync(manifestFile, "utf8"), oldManifest);
  assert.throws(() => readFileSync(join(data.target, "src/new.js")), /ENOENT/);
  assert.equal(calls.length, 2, "dependency install must be skipped when dependency declarations and locks did not change");
  assert.equal(calls[0].executable, process.execPath);
  assert.equal(calls[0].args[0], join(data.configurator, "install.mjs"));
  assert.deepEqual(calls[1].args, ["run", "build"]);
});
