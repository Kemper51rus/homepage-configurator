import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";

export const configuratorManifestName = ".homepage-configurator-manifest.json";
const backupDirectoryName = ".homepage-configurator-backups";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

export function isSafePosixRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return false;
  if (isAbsolute(value) || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  if (value.endsWith("/") || value.includes("//") || posix.normalize(value) !== value) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[\u0000-\u001f\u007f]/.test(part));
}

function safePath(value, label) {
  if (!isSafePosixRelativePath(value)) {
    throw new Error(`${label} must be a safe POSIX relative path: ${JSON.stringify(value)}`);
  }
  return value;
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function pathFromPosix(root, path) {
  return join(root, ...path.split("/"));
}

function validateSource(rootReal, sourcePath, label) {
  let sourceReal;
  try {
    sourceReal = realpathSync(sourcePath);
  } catch (error) {
    throw new Error(`${label} does not exist: ${error.message}`);
  }
  if (!isInside(rootReal, sourceReal)) {
    throw new Error(`${label} escapes component root through a symlink`);
  }
  if (!statSync(sourceReal).isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  return sourceReal;
}

function normalizeEntry(entry, label, overlayRoot) {
  if (typeof entry === "string") {
    const target = safePath(entry, label);
    return { source: target, target, sourcePath: pathFromPosix(overlayRoot, target) };
  }
  if (!isObject(entry)) throw new Error(`${label} must be a path or {source, target}`);
  const source = safePath(entry.source, `${label}.source`);
  const target = safePath(entry.target ?? entry.path, `${label}.target`);
  return { source, target, sourcePath: pathFromPosix(overlayRoot, source) };
}

export function isSafeComponentId(value) {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value);
}

export function validateComponentManifest(manifest, root) {
  if (!isObject(manifest)) throw new Error("Component manifest must be an object");
  if (manifest.schema !== 1) throw new Error(`Unsupported component manifest schema: ${JSON.stringify(manifest.schema)}`);
  if (!isSafeComponentId(manifest.id)) {
    throw new Error("Component id must be 1-64 lowercase letters, digits, dots, underscores or dashes");
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim() || manifest.version.length > 128) {
    throw new Error("Component version must be a non-empty string up to 128 characters");
  }
  if (!isObject(manifest.requires)) throw new Error("Component requires must be an object");
  for (const [name, requirement] of Object.entries(manifest.requires)) {
    if (!name || typeof requirement !== "string" || !requirement.trim()) {
      throw new Error("Component requires must contain non-empty string requirements");
    }
  }
  if (!isObject(manifest.overlay)) throw new Error("Component overlay must be an object");
  const overlayRootRelative = safePath(manifest.overlay.root, "overlay.root");
  if (!Array.isArray(manifest.overlay.files)) throw new Error("overlay.files must be an array");
  if (!Array.isArray(manifest.configFiles)) throw new Error("configFiles must be an array");
  if (!Array.isArray(manifest.dataDirs)) throw new Error("dataDirs must be an array");

  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch (error) {
    throw new Error(`Component root does not exist: ${error.message}`);
  }
  if (!statSync(rootReal).isDirectory()) throw new Error("Component root must be a directory");
  const overlayRoot = pathFromPosix(rootReal, overlayRootRelative);
  let overlayRootReal;
  try {
    overlayRootReal = realpathSync(overlayRoot);
  } catch (error) {
    throw new Error(`overlay.root does not exist: ${error.message}`);
  }
  if (!isInside(rootReal, overlayRootReal) || !statSync(overlayRootReal).isDirectory()) {
    throw new Error("overlay.root must resolve to a directory inside component root");
  }

  const files = manifest.overlay.files.map((entry, index) => normalizeEntry(entry, `overlay.files[${index}]`, overlayRootReal));
  const configFiles = manifest.configFiles.map((entry, index) => normalizeEntry(entry, `configFiles[${index}]`, overlayRootReal));
  const dataDirs = manifest.dataDirs.map((entry, index) => safePath(entry, `dataDirs[${index}]`));
  const targets = new Set();
  for (const entry of [...files, ...configFiles]) {
    if (targets.has(entry.target)) throw new Error(`Duplicate component target: ${entry.target}`);
    targets.add(entry.target);
    entry.sourcePath = validateSource(rootReal, entry.sourcePath, `Source ${entry.source}`);
  }
  if (new Set(dataDirs).size !== dataDirs.length) throw new Error("Duplicate dataDirs path");
  for (const dataDir of dataDirs) {
    if (targets.has(dataDir)) throw new Error(`${dataDir} cannot be both a file and data directory`);
  }

  return {
    ...clone(manifest),
    schema: 1,
    version: manifest.version.trim(),
    requires: { ...manifest.requires },
    overlay: { root: overlayRootRelative, files },
    configFiles,
    dataDirs,
  };
}

export function normalizeConfiguratorManifest(oldManifest) {
  if (oldManifest == null) return { schema: 2, core: null, components: {} };
  if (!isObject(oldManifest)) throw new Error("Configurator manifest must be an object");
  if (oldManifest.schema === 2) {
    if (oldManifest.core !== null && !isObject(oldManifest.core)) throw new Error("Schema 2 core must be an object or null");
    if (!isObject(oldManifest.components)) throw new Error("Schema 2 components must be an object");
    return clone(oldManifest);
  }
  if (oldManifest.schema !== undefined && oldManifest.schema !== 1) {
    throw new Error(`Unsupported configurator manifest schema: ${JSON.stringify(oldManifest.schema)}`);
  }
  return { schema: 2, core: clone(oldManifest), components: {} };
}

function ownedPath(entry) {
  if (typeof entry === "string") return entry;
  return isObject(entry) ? entry.path ?? entry.target : undefined;
}

function collectOwnedPaths(record) {
  const result = [];
  for (const entry of record?.ownedFiles ?? []) {
    const path = ownedPath(entry);
    if (typeof path === "string") result.push(path);
  }
  return result;
}

function collectCorePaths(core) {
  return new Set([
    ...collectOwnedPaths(core),
    ...(Array.isArray(core?.overlayFiles) ? core.overlayFiles.filter((path) => typeof path === "string") : []),
  ]);
}

function assertTargetPath(targetReal, relativePath) {
  const targetPath = pathFromPosix(targetReal, relativePath);
  let cursor = existsSync(targetPath) ? targetPath : dirname(targetPath);
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const parentReal = realpathSync(cursor);
  if (!isInside(targetReal, parentReal)) throw new Error(`Target path escapes target root through a symlink: ${relativePath}`);
  return targetPath;
}

export function planComponentInstall(target, componentRoot, manifest, currentManifest) {
  const normalized = validateComponentManifest(manifest, componentRoot);
  const current = normalizeConfiguratorManifest(currentManifest);
  const targetReal = realpathSync(target);
  if (!statSync(targetReal).isDirectory()) throw new Error("Install target must be a directory");

  const claimed = collectCorePaths(current.core);
  const previousComponent = Object.hasOwn(current.components, normalized.id) ? current.components[normalized.id] : null;
  const previousOwned = new Set(collectOwnedPaths(previousComponent));
  const previousReplaced = isObject(previousComponent?.replaced) ? previousComponent.replaced : {};
  for (const [id, component] of Object.entries(current.components)) {
    if (id === normalized.id) continue;
    for (const path of collectOwnedPaths(component)) claimed.add(path);
  }

  const entries = [
    ...normalized.overlay.files.map((entry) => ({ ...entry, kind: "owned" })),
    ...normalized.configFiles.map((entry) => ({ ...entry, kind: "config" })),
  ].map((entry) => {
    if (claimed.has(entry.target)) throw new Error(`Component file collision at ${entry.target}`);
    const targetPath = assertTargetPath(targetReal, entry.target);
    const existing = existsSync(targetPath);
    if (existing && !lstatSync(targetPath).isFile()) throw new Error(`Component target is not a regular file: ${entry.target}`);
    return {
      kind: entry.kind,
      relativePath: entry.target,
      source: entry.sourcePath,
      target: targetPath,
      sourcePath: entry.sourcePath,
      targetPath,
      existing,
      inheritedReplacement: entry.kind === "owned" && previousOwned.has(entry.target) && Boolean(previousReplaced[entry.target]),
      replaced: entry.kind === "owned" && (Boolean(previousReplaced[entry.target]) || (existing && !previousOwned.has(entry.target))),
    };
  });

  for (const dataDir of normalized.dataDirs) assertTargetPath(targetReal, dataDir);
  return {
    target: targetReal,
    componentRoot: realpathSync(componentRoot),
    manifest: normalized,
    currentManifest: current,
    files: entries,
    ownedFiles: entries.filter((entry) => entry.kind === "owned"),
    configFiles: entries.filter((entry) => entry.kind === "config"),
    existing: entries.filter((entry) => entry.existing),
    replaced: entries.filter((entry) => entry.replaced),
    dataDirs: [...normalized.dataDirs],
  };
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function uniqueSuffix() {
  return `${Date.now()}-${process.pid}-${randomBytes(5).toString("hex")}`;
}

function atomicWrite(file, contents) {
  const temporary = `${file}.tmp-${uniqueSuffix()}`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function atomicCopy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${posix.basename(target)}.tmp-${uniqueSuffix()}`);
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function restoreManifest(file, existed, contents) {
  if (existed) atomicWrite(file, contents);
  else rmSync(file, { force: true });
}

function ensureDirectory(path, root, createdDirs) {
  const missing = [];
  let cursor = path;
  while (cursor !== root && !existsSync(cursor)) {
    missing.push(cursor);
    cursor = dirname(cursor);
  }
  mkdirSync(path, { recursive: true });
  for (const directory of missing.reverse()) createdDirs.add(directory);
}

function cleanCreatedDirectories(createdDirs) {
  const deepestFirst = [...createdDirs].sort((left, right) => right.length - left.length);
  for (const directory of deepestFirst) {
    try { rmSync(directory, { recursive: false }); } catch { /* Preserve directories that acquired content. */ }
  }
}

export function applyComponentInstall(target, componentRoot, manifest, currentManifest, options = {}) {
  let plan;
  if (isObject(target) && Array.isArray(target.files) && isObject(target.currentManifest)) {
    plan = target;
    options = componentRoot ?? {};
  } else {
    plan = planComponentInstall(target, componentRoot, manifest, currentManifest);
  }
  const manifestFile = join(plan.target, configuratorManifestName);
  const oldManifestExists = existsSync(manifestFile);
  const oldManifestContents = oldManifestExists ? readFileSync(manifestFile) : null;
  const previousComponent = Object.hasOwn(plan.currentManifest.components, plan.manifest.id)
    ? plan.currentManifest.components[plan.manifest.id]
    : null;
  const backupRootRelative = previousComponent?.backupRoot
    ? safePath(previousComponent.backupRoot, "component backupRoot")
    : `${backupDirectoryName}/component-${plan.manifest.id}-${uniqueSuffix()}`;
  const backupRoot = pathFromPosix(plan.target, backupRootRelative);
  const backupRootExisted = existsSync(backupRoot);
  const rollbackRoot = join(plan.target, backupDirectoryName, `.install-${plan.manifest.id}-${uniqueSuffix()}`);
  const createdComponentBackups = [];
  const mutations = [];
  const createdDirs = new Set();
  let copies = 0;

  try {
    if (options.failAfterCopies === 0) throw new Error("Injected failure after 0 copies");
    for (const dataDir of plan.dataDirs) {
      const path = assertTargetPath(plan.target, dataDir);
      if (!existsSync(path)) {
        ensureDirectory(path, plan.target, createdDirs);
      } else if (!statSync(path).isDirectory()) {
        throw new Error(`Data directory target is not a directory: ${dataDir}`);
      }
    }

    for (const file of plan.files) {
      if (file.kind === "config" && file.existing) continue;
      let rollbackPath = null;
      if (file.existing) {
        rollbackPath = pathFromPosix(rollbackRoot, file.relativePath);
        mkdirSync(dirname(rollbackPath), { recursive: true });
        copyFileSync(file.targetPath, rollbackPath);
      }
      if (file.replaced && !file.inheritedReplacement) {
        const backupPath = pathFromPosix(backupRoot, file.relativePath);
        mkdirSync(dirname(backupPath), { recursive: true });
        copyFileSync(file.targetPath, backupPath);
        createdComponentBackups.push(backupPath);
      }
      mutations.push({ targetPath: file.targetPath, existed: file.existing, rollbackPath });
      ensureDirectory(dirname(file.targetPath), plan.target, createdDirs);
      atomicCopy(file.sourcePath, file.targetPath);
      copies += 1;
      if (options.failAfterCopies !== undefined && copies >= options.failAfterCopies) {
        throw new Error(`Injected failure after ${copies} copies`);
      }
    }

    const ownedFiles = plan.ownedFiles.map((file) => file.relativePath);
    const hashes = Object.fromEntries(ownedFiles.map((path) => [path, sha256(pathFromPosix(plan.target, path))]));
    const replaced = Object.fromEntries(plan.ownedFiles.filter((file) => file.replaced).map((file) => [file.relativePath, file.relativePath]));
    const componentRecord = {
      version: plan.manifest.version,
      requires: clone(plan.manifest.requires),
      ownedFiles,
      hashes,
      replaced,
      backupRoot: Object.keys(replaced).length ? backupRootRelative : null,
      configFiles: plan.configFiles.map((file) => file.relativePath),
      dataDirs: [...plan.dataDirs],
    };
    const nextManifest = clone(plan.currentManifest);
    nextManifest.components[plan.manifest.id] = componentRecord;
    atomicWrite(manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`);
    rmSync(rollbackRoot, { recursive: true, force: true });
    if (!componentRecord.backupRoot) rmSync(backupRoot, { recursive: true, force: true });
    return { manifest: nextManifest, component: componentRecord, plan };
  } catch (error) {
    for (const mutation of mutations.reverse()) {
      if (mutation.existed && mutation.rollbackPath && existsSync(mutation.rollbackPath)) atomicCopy(mutation.rollbackPath, mutation.targetPath);
      else if (!mutation.existed) rmSync(mutation.targetPath, { force: true });
    }
    cleanCreatedDirectories(createdDirs);
    rmSync(rollbackRoot, { recursive: true, force: true });
    if (backupRootExisted) {
      for (const file of createdComponentBackups) rmSync(file, { force: true });
    } else {
      rmSync(backupRoot, { recursive: true, force: true });
    }
    restoreManifest(manifestFile, oldManifestExists, oldManifestContents);
    throw error;
  }
}

function parseRemoveArguments(currentManifest, options) {
  if (currentManifest && isObject(currentManifest) && currentManifest.schema === undefined && "force" in currentManifest && options === undefined) {
    return { currentManifest: undefined, options: currentManifest };
  }
  return { currentManifest, options: options ?? {} };
}

export function removeComponent(target, componentId, currentManifest, options) {
  ({ currentManifest, options } = parseRemoveArguments(currentManifest, options));
  if (!isSafeComponentId(componentId)) throw new Error(`Unsafe component id: ${JSON.stringify(componentId)}`);
  const targetReal = realpathSync(target);
  const manifestFile = join(targetReal, configuratorManifestName);
  const diskContents = existsSync(manifestFile) ? readFileSync(manifestFile) : null;
  const sourceManifest = currentManifest ?? (diskContents ? JSON.parse(diskContents) : null);
  const normalized = normalizeConfiguratorManifest(sourceManifest);
  const component = Object.hasOwn(normalized.components, componentId) ? normalized.components[componentId] : null;
  if (!component) throw new Error(`Component is not installed: ${componentId}`);

  const ownedFiles = collectOwnedPaths(component).map((path) => safePath(path, "ownedFiles entry"));
  const hashes = isObject(component.hashes) ? component.hashes : {};
  const modified = [];
  for (const path of ownedFiles) {
    const file = assertTargetPath(targetReal, path);
    if (existsSync(file) && hashes[path] && sha256(file) !== hashes[path]) modified.push(path);
  }
  if (modified.length && !options.force) {
    throw new Error(`Refusing to remove modified component files: ${modified.join(", ")}`);
  }

  const rollbackRoot = join(targetReal, backupDirectoryName, `.remove-${componentId}-${uniqueSuffix()}`);
  const prior = [];
  try {
    for (const path of ownedFiles) {
      const file = assertTargetPath(targetReal, path);
      const existed = existsSync(file);
      let rollbackPath = null;
      if (existed) {
        rollbackPath = pathFromPosix(rollbackRoot, path);
        mkdirSync(dirname(rollbackPath), { recursive: true });
        copyFileSync(file, rollbackPath);
      }
      prior.push({ file, existed, rollbackPath });

      const replacement = component.replaced?.[path];
      if (replacement) {
        const backupRoot = safePath(component.backupRoot, "component backupRoot");
        const backupRelative = safePath(typeof replacement === "string" ? replacement : path, "component replacement path");
        const backup = pathFromPosix(pathFromPosix(targetReal, backupRoot), backupRelative);
        const backupReal = validateSource(targetReal, backup, `Backup for ${path}`);
        atomicCopy(backupReal, file);
      } else {
        rmSync(file, { force: true });
      }
    }

    const nextManifest = clone(normalized);
    delete nextManifest.components[componentId];
    atomicWrite(manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`);
    if (component.backupRoot && isSafePosixRelativePath(component.backupRoot)) {
      rmSync(pathFromPosix(targetReal, component.backupRoot), { recursive: true, force: true });
    }
    rmSync(rollbackRoot, { recursive: true, force: true });
    return { manifest: nextManifest, removed: componentId };
  } catch (error) {
    for (const entry of prior.reverse()) {
      if (entry.existed && entry.rollbackPath && existsSync(entry.rollbackPath)) atomicCopy(entry.rollbackPath, entry.file);
      else if (!entry.existed) rmSync(entry.file, { force: true });
    }
    rmSync(rollbackRoot, { recursive: true, force: true });
    restoreManifest(manifestFile, diskContents !== null, diskContents);
    throw error;
  }
}
