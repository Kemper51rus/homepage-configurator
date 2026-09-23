import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, sep } from "node:path";

const MANIFEST_NAME = ".homepage-configurator-manifest.json";
const COMPONENT_MANIFEST_NAME = "homepage-component.json";
const LOCK_NAME = "homepage-configurator-component-maintenance.lock";
export const COMPONENT_OPERATIONS = Object.freeze(["install", "update", "remove"]);
const LOCKFILES = Object.freeze(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);

export const HOMEPAGE_STUDIO_COMPONENT_ID = "homepage-studio";
export const GITHUB_STABLE_SOURCE_ID = "github-stable";
export const COMPONENT_IDS = Object.freeze([HOMEPAGE_STUDIO_COMPONENT_ID]);
export const COMPONENT_SOURCE_IDS = Object.freeze([GITHUB_STABLE_SOURCE_ID]);
export const COMPONENT_CATALOG = Object.freeze([
  Object.freeze({
    componentId: HOMEPAGE_STUDIO_COMPONENT_ID,
    sourceId: GITHUB_STABLE_SOURCE_ID,
    label: "Homepage Studio",
    channel: "stable",
    operations: COMPONENT_OPERATIONS,
  }),
]);
export const COMPONENT_OPERATION_CATALOG = COMPONENT_CATALOG;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

function publicErrorReason(error, prefix) {
  const message = String(error?.message ?? "");
  if (message.includes("not configured")) return `${prefix}-not-configured`;
  return `${prefix}-invalid`;
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function safeRelativePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 4096
    || value.includes("\\")
    || value.includes("\0")
    || value.startsWith("/")
    || posix.normalize(value) !== value
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ${label}`);
  }
  return value;
}

function resolveLocalDirectory(value, label, expectedFiles) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is not configured`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`${label} must be a local directory`);

  let directory;
  try {
    directory = realpathSync(value);
  } catch (error) {
    throw new Error(`${label} does not exist: ${error.message}`);
  }
  if (!statSync(directory).isDirectory()) throw new Error(`${label} must be a local directory`);
  for (const expected of expectedFiles) {
    const file = join(directory, expected);
    if (!existsSync(file)) throw new Error(`${label} is missing ${expected}`);
    const resolvedFile = realpathSync(file);
    if (!isInside(directory, resolvedFile) || !statSync(resolvedFile).isFile()) {
      throw new Error(`${label} has an unsafe ${expected}`);
    }
  }
  return directory;
}

function readTarget(targetDir) {
  const target = resolveLocalDirectory(targetDir, "Homepage target", ["package.json"]);
  const packageJson = readJson(join(target, "package.json"), "Homepage package.json");
  if (packageJson.name !== "homepage") throw new Error("Target package must be homepage");
  const required = ["next.config.js", "src/pages/index.jsx", "src/components/services/group.jsx", "src/components/bookmarks/group.jsx"];
  for (const file of required) {
    const candidate = join(target, file);
    if (!existsSync(candidate)) throw new Error(`Homepage target is missing ${file}`);
    const resolvedFile = realpathSync(candidate);
    if (!isInside(target, resolvedFile) || !statSync(resolvedFile).isFile()) {
      throw new Error(`Homepage target has an unsafe ${file}`);
    }
  }
  return target;
}

function readSchema2Manifest(target) {
  const file = join(target, MANIFEST_NAME);
  if (!existsSync(file)) throw new Error("Schema 2 configurator manifest is missing");
  const manifest = readJson(file, "configurator manifest");
  if (manifest?.schema !== 2 || (manifest.core !== null && !isObject(manifest.core)) || !isObject(manifest.components)) {
    throw new Error("Component operations require a schema 2 configurator manifest");
  }
  return manifest;
}

function validateStudioManifest(directory) {
  const manifest = readJson(join(directory, COMPONENT_MANIFEST_NAME), "Homepage Studio component manifest");
  if (manifest?.schema !== 1 || manifest.id !== HOMEPAGE_STUDIO_COMPONENT_ID || typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("Homepage Studio component manifest is invalid");
  }
  if (!isObject(manifest.overlay) || !Array.isArray(manifest.overlay.files) || !Array.isArray(manifest.configFiles)) {
    throw new Error("Homepage Studio component manifest has invalid file lists");
  }
  return manifest;
}

export function listComponentOperationCatalog() {
  return COMPONENT_CATALOG.map((entry) => ({ ...entry, operations: [...entry.operations] }));
}

export function validateComponentOperationInput(input) {
  if (!isObject(input)) throw new Error("Component operation input must be an object");
  const expected = ["componentId", "operation", "sourceId"];
  const keys = Object.keys(input).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("Component operation input must contain only componentId, sourceId and operation");
  }
  if (input.componentId !== HOMEPAGE_STUDIO_COMPONENT_ID) throw new Error("Unsupported componentId");
  if (input.sourceId !== GITHUB_STABLE_SOURCE_ID) throw new Error("Unsupported sourceId");
  if (!COMPONENT_OPERATIONS.includes(input.operation)) throw new Error("Unsupported operation");
  return { componentId: input.componentId, sourceId: input.sourceId, operation: input.operation };
}

export function resolveComponentOperationContext(targetDir, options = {}) {
  const env = options.env ?? process.env;
  const target = readTarget(targetDir);
  const manifest = readSchema2Manifest(target);
  const configuredSource = env.HOMEPAGE_CONFIGURATOR_SOURCE_DIR || manifest.core?.source;
  const configuratorSource = resolveLocalDirectory(
    configuredSource,
    "Homepage Configurator source",
    ["install.mjs", "package.json"],
  );
  const configuratorPackage = readJson(join(configuratorSource, "package.json"), "configurator package.json");
  if (configuratorPackage.name !== "homepage-configurator") throw new Error("Configurator source package is invalid");

  let studioSource = null;
  let studioManifest = null;
  if (options.requireStudio !== false) {
    studioSource = resolveLocalDirectory(
      env.HOMEPAGE_STUDIO_COMPONENT_DIR,
      "Homepage Studio component directory",
      [COMPONENT_MANIFEST_NAME],
    );
    studioManifest = validateStudioManifest(studioSource);
  }
  return { target, manifest, configuratorSource, studioSource, studioManifest };
}

function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function clearStaleLock(lockPath) {
  try {
    const record = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!processExists(record.pid)) unlinkSync(lockPath);
  } catch {
    // A malformed or inaccessible lock is treated as active rather than removed unsafely.
  }
}

export function withGlobalMaintenanceLock(callback, options = {}) {
  if (typeof callback !== "function") throw new Error("Maintenance lock callback is required");
  const lockPath = options.lockPath ?? join(tmpdir(), LOCK_NAME);
  mkdirSync(dirname(lockPath), { recursive: true });
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      clearStaleLock(lockPath);
      try {
        descriptor = openSync(lockPath, "wx", 0o600);
      } catch (retryError) {
        if (retryError?.code === "EEXIST") throw new Error("A component maintenance operation is already running");
        throw retryError;
      }
    } else {
      throw error;
    }
  }

  try {
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return callback();
  } finally {
    closeSync(descriptor);
    rmSync(lockPath, { force: true });
  }
}

export function selectBuildCommand(targetDir) {
  const target = realpathSync(targetDir);
  if (existsSync(join(target, "pnpm-lock.yaml"))) return { executable: "pnpm", args: ["build"] };
  if (existsSync(join(target, "package-lock.json"))) return { executable: "npm", args: ["run", "build"] };
  if (existsSync(join(target, "yarn.lock"))) return { executable: "yarn", args: ["build"] };
  throw new Error("Cannot select build command: no supported lockfile");
}

function selectInstallCommand(target) {
  if (existsSync(join(target, "pnpm-lock.yaml"))) return { executable: "pnpm", args: ["install", "--frozen-lockfile"] };
  if (existsSync(join(target, "package-lock.json"))) return { executable: "npm", args: ["ci"] };
  if (existsSync(join(target, "yarn.lock"))) return { executable: "yarn", args: ["install", "--frozen-lockfile"] };
  throw new Error("Cannot install dependencies: no supported lockfile");
}

export function validateLoopbackHealthcheckUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Healthcheck URL is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Healthcheck URL must use HTTP(S) without credentials");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]") {
    throw new Error("Healthcheck URL must use a loopback host");
  }
  return url.toString();
}

export function createLoopbackHealthcheckCommand(value) {
  const url = validateLoopbackHealthcheckUrl(value);
  const script = [
    "const response = await fetch(process.argv[1], { signal: AbortSignal.timeout(10000), redirect: 'error' });",
    "if (!response.ok) throw new Error(`Healthcheck failed with HTTP ${response.status}`);",
  ].join("\n");
  return {
    executable: process.execPath,
    args: ["--input-type=module", "--eval", script, url],
  };
}

function ownedPath(entry) {
  if (typeof entry === "string") return entry;
  if (isObject(entry)) return entry.path ?? entry.target;
  return null;
}

function addRecordPaths(paths, record) {
  for (const field of ["ownedFiles", "overlayFiles", "patchFiles", "configFiles", "replacesCoreFiles"]) {
    if (!Array.isArray(record?.[field])) continue;
    for (const entry of record[field]) {
      const value = ownedPath(entry);
      if (value) paths.add(safeRelativePath(value, `${field} path`));
    }
  }
  if (isObject(record?.replaced)) {
    for (const value of Object.keys(record.replaced)) paths.add(safeRelativePath(value, "replacement path"));
  }
}

function incomingPaths(studioManifest) {
  const paths = new Set();
  if (!studioManifest) return paths;
  for (const field of [studioManifest.overlay.files, studioManifest.configFiles]) {
    for (const entry of field) {
      const value = typeof entry === "string" ? entry : entry?.target ?? entry?.path;
      paths.add(safeRelativePath(value, "incoming overlay target"));
    }
  }
  return paths;
}

function collectSnapshotPaths(context) {
  const paths = new Set([MANIFEST_NAME, ".homepage-configurator-backups", ".next", "package.json", ...LOCKFILES]);
  addRecordPaths(paths, context.manifest.core);
  for (const component of Object.values(context.manifest.components)) addRecordPaths(paths, component);
  for (const path of incomingPaths(context.studioManifest)) paths.add(path);
  return [...paths];
}

function checkedTargetPath(target, path) {
  const relativePath = safeRelativePath(path, "snapshot path");
  const candidate = join(target, ...relativePath.split("/"));
  let parent = existsSync(candidate) ? candidate : dirname(candidate);
  while (!existsSync(parent)) parent = dirname(parent);
  const resolvedParent = realpathSync(parent);
  if (!isInside(target, resolvedParent)) throw new Error(`Snapshot path escapes Homepage target: ${relativePath}`);
  return candidate;
}

function createSnapshot(context) {
  const root = mkdtempSync(join(tmpdir(), "homepage-component-operation-"));
  const entries = [];
  try {
    for (const relativePath of collectSnapshotPaths(context)) {
      const targetPath = checkedTargetPath(context.target, relativePath);
      const existed = existsSync(targetPath);
      const backupPath = join(root, ...relativePath.split("/"));
      if (existed) {
        const info = lstatSync(targetPath);
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
          throw new Error(`Refusing to snapshot unsupported target type: ${relativePath}`);
        }
        mkdirSync(dirname(backupPath), { recursive: true });
        if (info.isDirectory()) cpSync(targetPath, backupPath, { recursive: true, dereference: false });
        else copyFileSync(targetPath, backupPath);
      }
      entries.push({ relativePath, targetPath, backupPath, existed });
    }
    return { root, entries };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function restoreSnapshot(snapshot) {
  for (const entry of snapshot.entries) {
    if (!entry.existed) {
      rmSync(entry.targetPath, { recursive: true, force: true });
      continue;
    }
    mkdirSync(dirname(entry.targetPath), { recursive: true });
    const temporary = join(dirname(entry.targetPath), `.${basename(entry.targetPath)}.restore-${process.pid}-${Date.now()}`);
    rmSync(temporary, { recursive: true, force: true });
    const backupInfo = lstatSync(entry.backupPath);
    if (backupInfo.isDirectory()) {
      cpSync(entry.backupPath, temporary, { recursive: true, dereference: false });
      rmSync(entry.targetPath, { recursive: true, force: true });
    } else {
      copyFileSync(entry.backupPath, temporary);
      if (existsSync(entry.targetPath) && lstatSync(entry.targetPath).isDirectory()) {
        rmSync(entry.targetPath, { recursive: true, force: true });
      }
    }
    renameSync(temporary, entry.targetPath);
  }
}

function dependencyState(target) {
  const packageJson = readJson(join(target, "package.json"), "Homepage package.json");
  const declarations = JSON.stringify({
    dependencies: packageJson.dependencies ?? {},
    devDependencies: packageJson.devDependencies ?? {},
    optionalDependencies: packageJson.optionalDependencies ?? {},
    peerDependencies: packageJson.peerDependencies ?? {},
    packageManager: packageJson.packageManager ?? null,
  });
  const locks = Object.fromEntries(LOCKFILES.map((file) => [file, existsSync(join(target, file)) ? readFileSync(join(target, file), "utf8") : null]));
  return { declarations, locks: JSON.stringify(locks) };
}

function dependenciesChanged(before, after) {
  return before.declarations !== after.declarations || before.locks !== after.locks;
}

function defaultRunner(executable, args, options) {
  return execFileSync(executable, args, options);
}

export function executeComponentOperation(targetDir, rawInput, options = {}) {
  const input = validateComponentOperationInput(rawInput);
  const healthcheckUrl = options.healthcheckUrl === undefined ? null : validateLoopbackHealthcheckUrl(options.healthcheckUrl);
  const runner = options.runner ?? defaultRunner;
  if (typeof runner !== "function") throw new Error("Command runner must be a function");

  return withGlobalMaintenanceLock(() => {
    const context = resolveComponentOperationContext(targetDir, {
      env: options.env,
      requireStudio: input.operation !== "remove",
    });
    const snapshot = createSnapshot(context);
    const beforeDependencies = dependencyState(context.target);
    const commands = [];
    const run = (executable, args, commandOptions) => {
      const safeArgs = [...args];
      commands.push({ executable, args: safeArgs });
      const result = runner(executable, safeArgs, { shell: false, stdio: "pipe", encoding: "utf8", ...commandOptions });
      if (result?.error) throw result.error;
      if (typeof result?.status === "number" && result.status !== 0) {
        throw new Error(`Command failed with exit code ${result.status}: ${executable}`);
      }
      if (result?.signal) throw new Error(`Command terminated by signal ${result.signal}: ${executable}`);
      return result;
    };

    try {
      const cliArgs = [
        join(context.configuratorSource, "install.mjs"),
        "--component",
        input.operation,
        "--component-id",
        input.componentId,
      ];
      if (input.operation !== "remove") cliArgs.push("--component-dir", context.studioSource);
      cliArgs.push("--target", context.target);
      run(process.execPath, cliArgs, { cwd: context.configuratorSource, env: options.env ?? process.env });

      const afterDependencies = dependencyState(context.target);
      if (dependenciesChanged(beforeDependencies, afterDependencies)) {
        const install = selectInstallCommand(context.target);
        run(install.executable, install.args, { cwd: context.target, env: options.env ?? process.env });
      }
      const build = selectBuildCommand(context.target);
      run(build.executable, build.args, {
        cwd: context.target,
        env: { ...(options.env ?? process.env), NODE_ENV: "production" },
      });
      if (healthcheckUrl) {
        if (options.healthcheck) {
          options.healthcheck(healthcheckUrl);
        } else {
          const healthcheck = createLoopbackHealthcheckCommand(healthcheckUrl);
          run(healthcheck.executable, healthcheck.args, {
            cwd: context.target,
            env: options.env ?? process.env,
          });
        }
      }
      return {
        componentId: input.componentId,
        sourceId: input.sourceId,
        operation: input.operation,
        restartRequired: true,
        commands,
      };
    } catch (error) {
      try {
        restoreSnapshot(snapshot);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "Component operation failed and rollback was incomplete");
      }
      throw error;
    } finally {
      rmSync(snapshot.root, { recursive: true, force: true });
    }
  }, { lockPath: options.lockPath });
}

export function getComponentStatusCatalog(targetDir, options = {}) {
  let context;
  let configuratorReason = "ready";
  try {
    context = resolveComponentOperationContext(targetDir, { env: options.env, requireStudio: false });
  } catch (error) {
    configuratorReason = publicErrorReason(error, "configurator-source");
    const target = readTarget(targetDir);
    const manifest = readSchema2Manifest(target);
    context = { target, manifest };
  }

  let studioManifest = null;
  let studioReason = "ready";
  try {
    const studioSource = resolveLocalDirectory(
      (options.env ?? process.env).HOMEPAGE_STUDIO_COMPONENT_DIR,
      "Homepage Studio component directory",
      [COMPONENT_MANIFEST_NAME],
    );
    studioManifest = validateStudioManifest(studioSource);
  } catch (error) {
    studioReason = publicErrorReason(error, "studio-source");
  }

  const installed = context.manifest.components[HOMEPAGE_STUDIO_COMPONENT_ID];
  const available = configuratorReason === "ready" && studioReason === "ready";
  return listComponentOperationCatalog().map((entry) => ({
    ...entry,
    installed: Boolean(installed),
    installedVersion: typeof installed?.version === "string" ? installed.version : null,
    available,
    availabilityReason: available ? null : (configuratorReason !== "ready" ? configuratorReason : studioReason),
    availableVersion: typeof studioManifest?.version === "string" ? studioManifest.version : null,
  }));
}
