import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const patchPath = join(root, "browser-editor.patch");
const overlayPath = join(root, "overlay");
const manifestName = ".homepage-configurator-manifest.json";
const backupDirName = ".homepage-configurator-backups";
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const versionMetadata = JSON.parse(readFileSync(join(root, "version.json"), "utf8"));
const targetMetadata = versionMetadata.target ?? {};
const consoleUpdateCommand = `bash <(curl -Ls ${versionMetadata.installUrl}) --action update`;
const targetUpdateRiskWarning =
  `⚠️ Важно: после обновления target Homepage наш мод может полностью перестать работать. Если браузерный редактор не откроется, обновите configurator из консоли: ${consoleUpdateCommand}`;

const managedDependencies = {
  prismjs: "^1.29.0",
  "react-simple-code-editor": "^0.14.1",
};

function ensureConfiguratorMetadata() {
  if (versionMetadata.version !== packageJson.version) {
    throw new Error(`Configurator metadata version ${versionMetadata.version} does not match package.json ${packageJson.version}`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    command: "install",
    dryRun: false,
    force: false,
    target: process.env.HOMEPAGE_TARGET_DIR || process.cwd(),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      parsed.target = args[index + 1];
      index += 1;
    } else if (arg === "--enable") {
      parsed.command = "enable";
    } else if (arg === "--disable") {
      parsed.command = "disable";
    } else if (arg === "--status") {
      parsed.command = "status";
    } else if (arg === "--dry-run" || arg === "-n") {
      parsed.dryRun = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--install") {
      parsed.command = "install";
    } else if (arg === "--uninstall" || arg === "--remove") {
      parsed.command = "uninstall";
    } else if (["install", "enable", "disable", "status", "uninstall", "remove"].includes(arg)) {
      parsed.command = arg === "remove" ? "uninstall" : arg;
    }
  }

  return parsed;
}

function runGit(target, args, stdio = "inherit") {
  return execFileSync("git", ["-c", `safe.directory=${target}`, ...args], {
    cwd: target,
    stdio,
    encoding: "utf8",
  });
}

function canApplyPatch(target, reverse = false) {
  try {
    runGit(target, ["apply", ...(reverse ? ["--reverse"] : []), "--check", patchPath], "pipe");
    return true;
  } catch {
    return false;
  }
}

function patchState(target) {
  if (canApplyPatch(target)) {
    return "applies";
  }
  if (canApplyPatch(target, true)) {
    return "already-applied";
  }
  return "conflict";
}

function isGitWorkTree(target) {
  try {
    return runGit(target, ["rev-parse", "--is-inside-work-tree"], "pipe").trim() === "true";
  } catch {
    return false;
  }
}

function parseVersionParts(version) {
  const normalized = String(version ?? "").trim().replace(/^v/i, "");
  const [main, preRelease = ""] = normalized.split("-", 2);
  const parts = main.split(".").map((part) => Number(part));

  if (parts.length < 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  return { parts, preRelease };
}

function compareVersions(left, right) {
  const leftParsed = parseVersionParts(left);
  const rightParsed = parseVersionParts(right);

  if (!leftParsed || !rightParsed) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    const diff = leftParsed.parts[index] - rightParsed.parts[index];
    if (diff !== 0) {
      return diff;
    }
  }

  if (leftParsed.preRelease && !rightParsed.preRelease) return -1;
  if (!leftParsed.preRelease && rightParsed.preRelease) return 1;
  return leftParsed.preRelease.localeCompare(rightParsed.preRelease);
}

function targetPackageJson(target) {
  return JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
}

function targetVersion(target) {
  return String(targetPackageJson(target).version ?? "");
}

function ensureSupportedTargetVersion(target) {
  const minimumVersion = String(targetMetadata.minimumVersion ?? "").trim();
  if (!minimumVersion) {
    return;
  }

  const currentVersion = targetVersion(target);
  if (!parseVersionParts(currentVersion)) {
    throw new Error(
      [
        `Не удалось определить версию target Homepage в ${join(target, "package.json")}.`,
        `Минимальная поддерживаемая версия Homepage для ${packageJson.name} ${packageJson.version}: ${minimumVersion}.`,
        "Сначала обновите target проект из консоли командой `update`, затем повторите установку/обновление мода.",
        targetUpdateRiskWarning,
      ].join("\n"),
    );
  }

  if (compareVersions(currentVersion, minimumVersion) < 0) {
    throw new Error(
      [
        `Target Homepage слишком старый для ${packageJson.name} ${packageJson.version}.`,
        `Установлено: ${currentVersion}. Минимум: ${minimumVersion}.`,
        "Сначала обновите target проект из консоли командой `update`, затем повторите установку/обновление мода.",
        targetUpdateRiskWarning,
      ].join("\n"),
    );
  }
}

function patchFiles() {
  const output = execFileSync("git", ["apply", "--numstat", patchPath], {
    cwd: root,
    stdio: "pipe",
    encoding: "utf8",
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim().split("\t").at(-1))
    .filter(Boolean);
}

function ensurePatchFilesNotStaged(target) {
  if (!isGitWorkTree(target)) return;

  const files = patchFiles();
  if (!files.length) return;

  const output = runGit(target, ["diff", "--cached", "--name-only", "--", ...files], "pipe").trim();
  if (output) {
    throw new Error(`Patch files have staged changes. Unstage them before continuing:\n${output}`);
  }
}

function unstagePatchFiles(target) {
  if (!isGitWorkTree(target)) return;

  const files = patchFiles();
  if (files.length) {
    runGit(target, ["reset", "--quiet", "--", ...files], "pipe");
  }
}

function ensureTarget(target) {
  const packageJsonPath = join(target, "package.json");

  if (!existsSync(packageJsonPath) || !existsSync(join(target, "src"))) {
    throw new Error(`${target} does not look like a homepage checkout`);
  }

  const targetPackage = targetPackageJson(target);
  if (targetPackage.name !== "homepage") {
    throw new Error(`${target} package name is ${targetPackage.name ?? "<missing>"}, expected homepage`);
  }

  const requiredFiles = [
    "next.config.js",
    "src/pages/index.jsx",
    "src/components/services/group.jsx",
    "src/components/bookmarks/group.jsx",
  ];

  const missing = requiredFiles.filter((file) => !existsSync(join(target, file)));
  if (missing.length) {
    throw new Error(`${target} is missing expected Homepage files:\n${missing.join("\n")}`);
  }
}

function manifestPath(target) {
  return join(target, manifestName);
}

function readManifest(target) {
  const file = manifestPath(target);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeManifest(target, manifest) {
  writeFileSync(manifestPath(target), `${JSON.stringify(manifest, null, 2)}\n`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readFileIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function isSafeRelativePath(path) {
  return Boolean(path) && !path.startsWith("/") && !path.split(/[\\/]/).includes("..");
}

function overlayFiles() {
  if (!existsSync(overlayPath) || !statSync(overlayPath).isDirectory()) {
    throw new Error(`Overlay directory is missing: ${overlayPath}`);
  }

  return walk(overlayPath).map((sourcePath) => ({
    sourcePath,
    relativePath: relative(overlayPath, sourcePath),
  }));
}

function backupTargetFiles(target, files) {
  const backupRootPath = join(target, backupDirName, timestamp());
  const copied = [];

  for (const file of files) {
    const targetPath = join(target, file);
    if (!existsSync(targetPath)) continue;

    const backupPath = join(backupRootPath, file);
    mkdirSync(dirname(backupPath), { recursive: true });
    cpSync(targetPath, backupPath);
    copied.push(file);
  }

  return copied.length ? { backupRoot: relative(target, backupRootPath), files: copied } : null;
}

function printPlan(title, items) {
  console.log(title);
  for (const item of items) {
    console.log(`  - ${item}`);
  }
}

function syncManagedDependencies(target) {
  const packageJsonPath = join(target, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const nextDependencies = { ...(packageJson.dependencies ?? {}) };
  let changed = false;

  Object.entries(managedDependencies).forEach(([name, version]) => {
    if (nextDependencies[name] === version) {
      return;
    }

    nextDependencies[name] = version;
    changed = true;
  });

  if (!changed) {
    return;
  }

  packageJson.dependencies = nextDependencies;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`Updated managed dependencies in ${packageJsonPath}`);
}

function replaceOnce(content, search, replacement) {
  if (!content.includes(search)) {
    return content;
  }

  return content.replace(search, replacement);
}

function writeRelativeFileIfChanged(target, file, nextContent, changedFiles) {
  const filePath = join(target, file);
  const currentContent = readFileSync(filePath, "utf8");

  if (currentContent === nextContent) {
    return;
  }

  writeFileSync(filePath, nextContent);
  changedFiles.push(file);
}

function normalizePatchCompatibilityTarget(target, { log = false } = {}) {
  const changedFiles = [];

  const nextConfigFile = "next.config.js";
  let nextConfig = readFileSync(join(target, nextConfigFile), "utf8");
  if (!nextConfig.includes("outputFileTracingIncludes")) {
    nextConfig = replaceOnce(
      nextConfig,
      '  output: "standalone",\n',
      [
        '  output: "standalone",',
        "  // for serverSideTranslations",
        "  outputFileTracingIncludes: {",
        '    "/**": ["./next-i18next.config.js"],',
        "  },",
      ].join("\n") + "\n",
    );
    writeRelativeFileIfChanged(target, nextConfigFile, nextConfig, changedFiles);
  }

  const indexFile = "src/pages/index.jsx";
  let index = readFileSync(join(target, indexFile), "utf8");
  if (!index.includes('components/toggles/signout')) {
    index = replaceOnce(
      index,
      'const Version = dynamic(() => import("components/version"), {\n',
      [
        'const SignOut = dynamic(() => import("components/toggles/signout"), {',
        "  ssr: false,",
        "});",
        "",
        'const Version = dynamic(() => import("components/version"), {',
      ].join("\n") + "\n",
    );
  }
  if (!index.includes("<SignOut />")) {
    index = replaceOnce(
      index,
      "            <Revalidate />\n            {!settings.theme && <ThemeToggle />}",
      "            <Revalidate />\n            <SignOut />\n            {!settings.theme && <ThemeToggle />}",
    );
  }
  writeRelativeFileIfChanged(target, indexFile, index, changedFiles);

  const widgetComponentsFile = "src/widgets/components.js";
  let widgetComponents = readFileSync(join(target, widgetComponentsFile), "utf8");
  if (!widgetComponents.includes("maintainerr: dynamic")) {
    widgetComponents = replaceOnce(
      widgetComponents,
      '  mailcow: dynamic(() => import("./mailcow/component")),\n',
      '  mailcow: dynamic(() => import("./mailcow/component")),\n  maintainerr: dynamic(() => import("./maintainerr/component")),\n',
    );
  }
  if (!widgetComponents.includes("sportarr: dynamic")) {
    widgetComponents = replaceOnce(
      widgetComponents,
      '  spoolman: dynamic(() => import("./spoolman/component")),\n',
      '  spoolman: dynamic(() => import("./spoolman/component")),\n  sportarr: dynamic(() => import("./sportarr/component")),\n',
    );
  }
  writeRelativeFileIfChanged(target, widgetComponentsFile, widgetComponents, changedFiles);

  const widgetsFile = "src/widgets/widgets.js";
  let widgets = readFileSync(join(target, widgetsFile), "utf8");
  if (!widgets.includes('import maintainerr from "./maintainerr/widget";')) {
    widgets = replaceOnce(
      widgets,
      'import mailcow from "./mailcow/widget";\n',
      'import mailcow from "./mailcow/widget";\nimport maintainerr from "./maintainerr/widget";\n',
    );
  }
  if (!widgets.includes('import sportarr from "./sportarr/widget";')) {
    widgets = replaceOnce(
      widgets,
      'import spoolman from "./spoolman/widget";\n',
      'import spoolman from "./spoolman/widget";\nimport sportarr from "./sportarr/widget";\n',
    );
  }
  if (!widgets.includes("  maintainerr,\n")) {
    widgets = replaceOnce(widgets, "  mailcow,\n", "  mailcow,\n  maintainerr,\n");
  }
  if (!widgets.includes("  sportarr,\n")) {
    widgets = replaceOnce(widgets, "  spoolman,\n", "  spoolman,\n  sportarr,\n");
  }
  writeRelativeFileIfChanged(target, widgetsFile, widgets, changedFiles);

  if (log && changedFiles.length) {
    console.log(`Normalized Homepage compatibility before patch: ${changedFiles.join(", ")}`);
  }

  return changedFiles;
}

function canApplyPatchWithCompatibilityNormalization(target) {
  const tempRoot = mkdtempSync(join(tmpdir(), "homepage-configurator-compat-"));

  try {
    for (const file of patchFiles()) {
      if (!isSafeRelativePath(file)) {
        return false;
      }

      copyRelativeFileIfExists(target, tempRoot, file);
    }

    const changedFiles = normalizePatchCompatibilityTarget(tempRoot);
    return changedFiles.length > 0 && canApplyPatch(tempRoot);
  } catch {
    return false;
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

function patchNeedsCompatibilityNormalization(target) {
  return patchState(target) === "conflict" && canApplyPatchWithCompatibilityNormalization(target);
}

function envPath(target) {
  const localEnvPath = join(target, ".env.local");
  if (existsSync(localEnvPath)) {
    return localEnvPath;
  }

  const dotEnvPath = join(target, ".env");
  if (existsSync(dotEnvPath)) {
    return dotEnvPath;
  }

  return localEnvPath;
}

function readEnv(target) {
  const file = envPath(target);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/);
}

function writeEnv(target, lines) {
  writeFileSync(envPath(target), `${lines.filter((line, index, all) => line.length || index < all.length - 1).join("\n")}\n`);
}

function setEnv(target, key, value) {
  const lines = readEnv(target);
  const nextLine = `${key}=${value}`;
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));

  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    lines.push(nextLine);
  }

  writeEnv(target, lines);
  console.log(`${nextLine} written to ${envPath(target)}`);
}

function status(target) {
  const line = readEnv(target).find((candidate) => candidate.startsWith("HOMEPAGE_BROWSER_EDITOR="));
  console.log(line ?? `HOMEPAGE_BROWSER_EDITOR is not set in ${envPath(target)}`);
}

function install(target, options = {}) {
  ensureTarget(target);
  ensureSupportedTargetVersion(target);

  const files = overlayFiles().map((file) => file.relativePath);
  const patchTouchedFiles = patchFiles();
  const existingManifest = readManifest(target);
  const plan = [
    `validate Homepage checkout: ${target}`,
    `validate Homepage version: ${targetVersion(target)} >= ${targetMetadata.minimumVersion}`,
    ...(existingManifest ? [`remove existing browser editor install from ${manifestName}`] : []),
    `sync managed dependencies: ${Object.keys(managedDependencies).join(", ")}`,
    `copy overlay files: ${files.length}`,
    `apply core patch files: ${patchTouchedFiles.length}`,
    `write manifest: ${manifestName}`,
  ];
  printPlan("Install plan:", plan);

  if (options.dryRun) {
    printPlan("Overlay files:", files);
    printPlan("Patch files:", patchTouchedFiles);
    console.log("Dry-run only. No files changed.");
    return;
  }

  let compatibilityNormalizationNeeded = preflightInstallPatchState(target, existingManifest);
  prepareExistingInstall(target, existingManifest);
  if (!compatibilityNormalizationNeeded && patchNeedsCompatibilityNormalization(target)) {
    compatibilityNormalizationNeeded = true;
  }

  const backup = backupTargetFiles(target, ["package.json", ...files, ...patchTouchedFiles]);

  installOverlay(target);
  if (compatibilityNormalizationNeeded) {
    normalizePatchCompatibilityTarget(target, { log: true });
  }
  applyPatch(target);
  syncManagedDependencies(target);
  writeManifest(target, {
    installedAt: new Date().toISOString(),
    source: root,
    configurator: {
      name: packageJson.name,
      version: packageJson.version,
      repo: versionMetadata.repo,
      branch: versionMetadata.branch,
      target: targetMetadata,
      metadataUrl: versionMetadata.metadataUrl,
      installUrl: versionMetadata.installUrl,
    },
    overlayFiles: files,
    patchFiles: patchTouchedFiles,
    managedDependencies,
    backup,
  });

  if (backup) {
    console.log(`Backup written to ${join(target, backup.backupRoot)}`);
  }
  console.log(`Browser editor installed into ${target}`);
  console.log("Run with --enable to set HOMEPAGE_BROWSER_EDITOR=true.");
}

function preflightInstallPatchState(target, manifest) {
  const state = patchState(target);

  if (state !== "conflict") {
    return false;
  }

  if (manifest) {
    const existingInstallPatchState = existingInstallCanAcceptCurrentPatch(target, manifest);
    if (existingInstallPatchState.accepted) {
      return existingInstallPatchState.normalizationNeeded;
    }
  }

  if (canApplyPatchWithCompatibilityNormalization(target)) {
    return true;
  }

  throw new Error(
    [
      "Core patch cannot be applied to this Homepage checkout.",
      "Update the Homepage source checkout first, then run the configurator again.",
      "For LXC install reinstall Homepage from the current community script or perform manual update.",
    ].join("\n"),
  );
}

function existingInstallCanAcceptCurrentPatch(target, manifest) {
  const backupRoot = manifest?.backup?.backupRoot;
  const backupFiles = manifest?.backup?.files ?? [];

  if (!isSafeRelativePath(backupRoot)) {
    return { accepted: false, normalizationNeeded: false };
  }

  const backupRootPath = join(target, backupRoot);
  if (!existsSync(backupRootPath)) {
    return { accepted: false, normalizationNeeded: false };
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "homepage-configurator-preflight-"));

  try {
    for (const file of patchFiles()) {
      if (!isSafeRelativePath(file)) {
        return { accepted: false, normalizationNeeded: false };
      }

      copyRelativeFileIfExists(target, tempRoot, file);
    }

    for (const file of backupFiles) {
      if (!isSafeRelativePath(file)) {
        return { accepted: false, normalizationNeeded: false };
      }

      copyRelativeFileIfExists(backupRootPath, tempRoot, file);
    }

    if (canApplyPatch(tempRoot)) {
      return { accepted: true, normalizationNeeded: false };
    }

    const changedFiles = normalizePatchCompatibilityTarget(tempRoot);
    if (changedFiles.length > 0 && canApplyPatch(tempRoot)) {
      return { accepted: true, normalizationNeeded: true };
    }

    return { accepted: false, normalizationNeeded: false };
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

function copyRelativeFileIfExists(sourceRoot, targetRoot, file) {
  const sourcePath = join(sourceRoot, file);
  if (!existsSync(sourcePath)) {
    return false;
  }

  const targetPath = join(targetRoot, file);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
  return true;
}

function uninstall(target, options = {}) {
  ensureTarget(target);
  const manifest = readManifest(target);
  const files = manifest?.overlayFiles ?? overlayFiles().map((file) => file.relativePath);
  const plan = [
    `validate Homepage checkout: ${target}`,
    `reverse core patch`,
    `remove overlay files from manifest: ${files.length}`,
    `set HOMEPAGE_BROWSER_EDITOR=false`,
    `remove manifest: ${manifestName}`,
  ];
  printPlan("Uninstall plan:", plan);

  if (options.dryRun) {
    printPlan("Overlay files:", files);
    console.log("Dry-run only. No files changed.");
    return;
  }

  try {
    if (restoreBackupFiles(target, manifest)) {
      console.log("Core patch restored from previous install backup");
    } else {
      reversePatch(target);
    }
  } catch (error) {
    if (!restoreBackupFiles(target, manifest)) {
      throw error;
    }
    console.log("Core patch restored from previous install backup");
  }
  removeOverlay(target, { files, force: options.force });
  setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "false");
  if (existsSync(manifestPath(target))) {
    unlinkSync(manifestPath(target));
  }
  console.log(`Browser editor removed from ${target}`);
}

function prepareExistingInstall(target, manifest) {
  if (!manifest) return;

  console.log(`Existing browser editor install detected in ${manifestName}; preparing reinstall`);

  try {
    if (restoreBackupFiles(target, manifest)) {
      console.log("Previous install files restored from backup before reinstall");
    } else {
      reversePatch(target);
    }
  } catch (error) {
    if (!restoreBackupFiles(target, manifest)) {
      throw new Error(`Existing install could not be reverted before reinstall:\n${error.message}`);
    }
    console.log("Previous install files restored from backup before reinstall");
  }

  removeOverlay(target, { files: manifest.overlayFiles ?? [], force: true });
  if (existsSync(manifestPath(target))) {
    unlinkSync(manifestPath(target));
  }
}

function restoreBackupFiles(target, manifest) {
  const backupRoot = manifest?.backup?.backupRoot;
  const files = manifest?.backup?.files ?? [];

  if (!isSafeRelativePath(backupRoot) || !files.length) {
    return false;
  }

  const backupRootPath = join(target, backupRoot);
  if (!existsSync(backupRootPath)) {
    return false;
  }

  let restored = 0;
  for (const file of files) {
    if (!isSafeRelativePath(file)) {
      throw new Error(`Refusing to restore unsafe backup path from manifest: ${file}`);
    }

    const backupPath = join(backupRootPath, file);
    if (!existsSync(backupPath)) {
      continue;
    }

    const targetPath = join(target, file);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(backupPath, targetPath);
    restored += 1;
  }

  if (!restored) {
    return false;
  }

  console.log(`Restored ${restored} file(s) from ${backupRoot}`);
  return true;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function installOverlay(target) {
  for (const { sourcePath, relativePath } of overlayFiles()) {
    const targetPath = join(target, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
  }
}

function removeOverlay(target, { files = null, force = false } = {}) {
  const directories = new Set();
  const relativePaths = files ?? overlayFiles().map((file) => file.relativePath);

  for (const relativePath of relativePaths) {
    const targetPath = join(target, relativePath);
    const sourcePath = join(overlayPath, relativePath);
    directories.add(dirname(targetPath));

    if (!existsSync(targetPath)) {
      continue;
    }

    if (!force && existsSync(sourcePath) && readFileIfExists(targetPath) !== readFileIfExists(sourcePath)) {
      throw new Error(`Refusing to remove modified overlay file without --force: ${relativePath}`);
    }

    unlinkSync(targetPath);
    console.log(`Removed ${relativePath}`);
  }

  [...directories]
    .sort((left, right) => right.length - left.length)
    .forEach((directory) => {
      try {
        rmdirSync(directory);
      } catch {
        // Directory is not empty or cannot be removed. Keep it.
      }
    });
}

function applyPatch(target) {
  ensurePatchFilesNotStaged(target);
  const gitWorkTree = isGitWorkTree(target);

  try {
    runGit(target, ["apply", "--check", patchPath], "pipe");
    runGit(target, ["apply", patchPath], "pipe");
    console.log("Core patch applied");
    return;
  } catch (error) {
    try {
      runGit(target, ["apply", "--reverse", "--check", patchPath], "pipe");
      console.log("Core patch already applied");
      return;
    } catch {
      if (!gitWorkTree) {
        throw error;
      }

      try {
        runGit(target, ["apply", "--3way", patchPath], "pipe");
        unstagePatchFiles(target);
        console.log("Core patch applied with 3-way merge");
        return;
      } catch {
        throw error;
      }
    }
  }
}

function reversePatch(target) {
  ensurePatchFilesNotStaged(target);

  try {
    runGit(target, ["apply", "--reverse", "--check", patchPath], "pipe");
    runGit(target, ["apply", "--reverse", patchPath], "pipe");
    console.log("Core patch reverted");
    return;
  } catch {
    try {
      runGit(target, ["apply", "--check", patchPath], "pipe");
      console.log("Core patch is not applied");
      return;
    } catch {
      throw new Error("Core patch cannot be reverted automatically. Check target changes before removing overlay files.");
    }
  }
}

const { command, target, dryRun, force } = parseArgs();

try {
  ensureConfiguratorMetadata();
  if (command === "install") install(target, { dryRun, force });
  if (command === "uninstall") uninstall(target, { dryRun, force });
  if (command === "enable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "true");
  if (command === "disable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "false");
  if (command === "status") status(target);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
