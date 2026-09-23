import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import {
  applyComponentInstall,
  isSafeComponentId,
  planComponentInstall,
  removeComponent,
} from "./lib/component-installer.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const corePatches = [
  {
    id: "homepage-current",
    file: "browser-editor.patch",
    path: join(root, "browser-editor.patch"),
  },
  {
    id: "homepage-2.0",
    file: "browser-editor-homepage-2.0.patch",
    path: join(root, "browser-editor-homepage-2.0.patch"),
  },
];
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
    componentCommand: null,
    componentId: null,
    componentDir: null,
    dryRun: false,
    force: false,
    target: process.env.HOMEPAGE_TARGET_DIR || process.cwd(),
  };
  let coreCommandSet = false;

  const valueAfter = (index, option) => {
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
    return value;
  };
  const setCoreCommand = (command, source) => {
    if (parsed.componentCommand) throw new Error(`${source} cannot be combined with --component`);
    if (coreCommandSet) throw new Error(`Multiple core commands are not allowed (unexpected ${source})`);
    parsed.command = command;
    coreCommandSet = true;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      parsed.target = valueAfter(index, arg);
      index += 1;
    } else if (arg === "--component") {
      if (parsed.componentCommand) throw new Error("--component may only be specified once");
      if (coreCommandSet) throw new Error("--component cannot be combined with a core command");
      const operation = valueAfter(index, arg);
      if (!["install", "update", "remove", "status"].includes(operation)) {
        throw new Error(`Unknown component operation: ${operation}`);
      }
      parsed.componentCommand = operation;
      index += 1;
    } else if (arg === "--component-id") {
      if (parsed.componentId !== null) throw new Error("Component id may only be specified once");
      parsed.componentId = valueAfter(index, arg);
      index += 1;
    } else if (arg === "--component-dir") {
      if (parsed.componentDir !== null) throw new Error("--component-dir may only be specified once");
      parsed.componentDir = valueAfter(index, arg);
      index += 1;
    } else if (!arg.startsWith("-") && parsed.componentCommand && parsed.componentId === null) {
      parsed.componentId = arg;
    } else if (arg === "--enable") {
      setCoreCommand("enable", arg);
    } else if (arg === "--disable") {
      setCoreCommand("disable", arg);
    } else if (arg === "--status") {
      setCoreCommand("status", arg);
    } else if (arg === "--dry-run" || arg === "-n") {
      parsed.dryRun = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--install") {
      setCoreCommand("install", arg);
    } else if (arg === "--uninstall" || arg === "--remove") {
      setCoreCommand("uninstall", arg);
    } else if (["install", "enable", "disable", "status", "uninstall", "remove"].includes(arg)) {
      setCoreCommand(arg === "remove" ? "uninstall" : arg, arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.target) throw new Error("--target requires a non-empty path");
  if (parsed.componentCommand) {
    if ((parsed.componentCommand === "install" || parsed.componentCommand === "update") && !parsed.componentDir) {
      throw new Error(`Component ${parsed.componentCommand} requires --component-dir DIR`);
    }
    if ((parsed.componentCommand === "remove" || parsed.componentCommand === "status") && !parsed.componentId) {
      throw new Error(`Component ${parsed.componentCommand} requires COMPONENT_ID or --component-id ID`);
    }
    if (parsed.componentId !== null && !isSafeComponentId(parsed.componentId)) {
      throw new Error(`Unsafe component id: ${JSON.stringify(parsed.componentId)}`);
    }
  } else if (parsed.componentId !== null || parsed.componentDir !== null) {
    throw new Error("--component-id and --component-dir require --component install|update|remove|status");
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

function canApplyPatch(target, patch, reverse = false) {
  try {
    runGit(target, ["apply", ...(reverse ? ["--reverse"] : []), "--check", patch.path], "pipe");
    return true;
  } catch {
    return false;
  }
}

function patchState(target, patch) {
  if (canApplyPatch(target, patch)) {
    return "applies";
  }
  if (canApplyPatch(target, patch, true)) {
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

function patchFiles(patch) {
  const output = execFileSync("git", ["apply", "--numstat", patch.path], {
    cwd: root,
    stdio: "pipe",
    encoding: "utf8",
  });

  const files = output
    .split(/\r?\n/)
    .map((line) => line.trim().split("\t").at(-1))
    .filter(Boolean);

  const unsafeFile = files.find((file) => !isSafeRelativePath(file));
  if (unsafeFile) {
    throw new Error(`Refusing unsafe path from ${patch.file}: ${unsafeFile}`);
  }

  return files;
}

function ensurePatchFilesNotStaged(target, patch) {
  if (!isGitWorkTree(target)) return;

  const files = patchFiles(patch);
  if (!files.length) return;

  const output = runGit(target, ["diff", "--cached", "--name-only", "--", ...files], "pipe").trim();
  if (output) {
    throw new Error(`Patch files have staged changes. Unstage them before continuing:\n${output}`);
  }
}

function unstagePatchFiles(target, patch) {
  if (!isGitWorkTree(target)) return;

  const files = patchFiles(patch);
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

function coreRecord(manifest) {
  return manifest?.schema === 2 ? manifest.core : manifest;
}

function installedComponents(manifest) {
  if (manifest?.schema !== 2) return [];
  if (!manifest.components || typeof manifest.components !== "object" || Array.isArray(manifest.components)) {
    throw new Error("Schema 2 components must be an object");
  }
  return Object.keys(manifest.components);
}

function assertCoreOperationAllowed(manifest, operation) {
  const components = installedComponents(manifest);
  if (components.length) {
    throw new Error(
      `Cannot ${operation} core while components are installed (${components.join(", ")}). Remove components first with --component remove COMPONENT_ID.`,
    );
  }
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

function normalizePatchCompatibilityTarget(target, patch, { log = false } = {}) {
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
    console.log(`Normalized Homepage compatibility for ${patch.id}: ${changedFiles.join(", ")}`);
  }

  return changedFiles;
}

function canApplyPatchWithCompatibilityNormalization(target, patch) {
  const tempRoot = mkdtempSync(join(tmpdir(), "homepage-configurator-compat-"));

  try {
    for (const file of patchFiles(patch)) {
      copyRelativeFileIfExists(target, tempRoot, file);
    }

    const changedFiles = normalizePatchCompatibilityTarget(tempRoot, patch);
    return changedFiles.length > 0 && canApplyPatch(tempRoot, patch);
  } catch {
    return false;
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

function patchNeedsCompatibilityNormalization(target, patch) {
  return patchState(target, patch) === "conflict" && canApplyPatchWithCompatibilityNormalization(target, patch);
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
  const manifest = readManifest(target);
  const core = coreRecord(manifest);
  const line = readEnv(target).find((candidate) => candidate.startsWith("HOMEPAGE_BROWSER_EDITOR="));
  console.log(line ?? `HOMEPAGE_BROWSER_EDITOR is not set in ${envPath(target)}`);
  console.log(core ? `Core manifest: ${core.configurator?.version ?? core.version ?? "installed"}` : "Core manifest: not installed");
}

function readTrustedComponent(componentDir) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(componentDir)) {
    throw new Error("--component-dir must be a trusted local directory, not a URL");
  }

  let directory;
  try {
    directory = realpathSync(componentDir);
  } catch (error) {
    throw new Error(`Component directory does not exist: ${error.message}`);
  }
  if (!statSync(directory).isDirectory()) throw new Error("--component-dir must be a trusted local directory");

  const file = join(directory, "homepage-component.json");
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`Component manifest is missing: ${file}`);
  }
  return { directory, manifest: JSON.parse(readFileSync(file, "utf8")) };
}

function versionSatisfiesRange(version, range) {
  const comparisons = String(range ?? "").trim().split(/\s+/).filter(Boolean);
  if (!comparisons.length) return false;

  return comparisons.every((comparison) => {
    const match = comparison.match(/^(>=|<=|>|<|=|\^|~)?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
    if (!match) throw new Error(`Unsupported component version requirement: ${comparison}`);
    const [, operator = "=", requiredVersion] = match;
    const result = compareVersions(version, requiredVersion);
    if (operator === ">=") return result >= 0;
    if (operator === "<=") return result <= 0;
    if (operator === ">") return result > 0;
    if (operator === "<") return result < 0;
    if (operator === "^") {
      const current = parseVersionParts(version);
      const required = parseVersionParts(requiredVersion);
      return result >= 0 && current?.parts[0] === required?.parts[0];
    }
    if (operator === "~") {
      const current = parseVersionParts(version);
      const required = parseVersionParts(requiredVersion);
      return result >= 0 && current?.parts[0] === required?.parts[0] && current?.parts[1] === required?.parts[1];
    }
    return result === 0;
  });
}

function ensureComponentCompatibility(target, componentManifest, configuratorManifest) {
  const core = coreRecord(configuratorManifest);
  const configuratorVersion = core?.configurator?.version ?? core?.version;
  const configuratorRange = componentManifest.requires?.homepageConfigurator ?? componentManifest.requires?.configurator;
  const homepageRange = componentManifest.requires?.homepage;

  if (configuratorRange && (!configuratorVersion || !versionSatisfiesRange(configuratorVersion, configuratorRange))) {
    throw new Error(
      `Component ${componentManifest.id} requires Homepage Configurator ${configuratorRange}; installed: ${configuratorVersion ?? "unknown"}`,
    );
  }
  const homepageVersion = targetVersion(target);
  if (homepageRange && !versionSatisfiesRange(homepageVersion, homepageRange)) {
    throw new Error(`Component ${componentManifest.id} requires Homepage ${homepageRange}; installed: ${homepageVersion}`);
  }
}

function componentOperation(target, command, options = {}) {
  ensureTarget(target);
  const currentManifest = readManifest(target);
  if (
    currentManifest?.schema !== 2
    || !currentManifest.components
    || typeof currentManifest.components !== "object"
    || Array.isArray(currentManifest.components)
  ) {
    throw new Error("Component operations require a schema 2 configurator manifest.");
  }
  if ((command === "install" || command === "update") && !coreRecord(currentManifest)) {
    throw new Error("Component install and update require an installed schema 2 core manifest. Install the core first.");
  }

  if (command === "status") {
    const component = Object.hasOwn(currentManifest.components, options.componentId)
      ? currentManifest.components[options.componentId]
      : null;
    if (!component) throw new Error(`Component is not installed: ${options.componentId}`);
    console.log(JSON.stringify({ id: options.componentId, ...component }, null, 2));
    return;
  }

  if (command === "remove") {
    if (options.dryRun) {
      const component = currentManifest.components?.[options.componentId];
      if (!component) throw new Error(`Component is not installed: ${options.componentId}`);
      printPlan("Component remove plan:", [
        `component: ${options.componentId}`,
        ...((component.ownedFiles ?? []).map((file) => `remove owned file: ${typeof file === "string" ? file : file.path}`)),
      ]);
      console.log("Dry-run only. No files changed.");
      return;
    }
    removeComponent(target, options.componentId, currentManifest, { force: options.force });
    console.log(`Component removed: ${options.componentId}`);
    return;
  }

  const { directory, manifest } = readTrustedComponent(options.componentDir);
  if (options.componentId && options.componentId !== manifest.id) {
    throw new Error(`Component id mismatch: CLI requested ${options.componentId}, manifest declares ${manifest.id}`);
  }
  const componentId = options.componentId ?? manifest.id;
  if (!isSafeComponentId(componentId)) throw new Error(`Unsafe component id: ${JSON.stringify(componentId)}`);
  const installed = Object.hasOwn(currentManifest.components, componentId);
  if (command === "install" && installed) throw new Error(`Component is already installed: ${componentId}; use update`);
  if (command === "update" && !installed) throw new Error(`Component is not installed: ${componentId}; use install`);
  ensureComponentCompatibility(target, manifest, currentManifest);

  const plan = planComponentInstall(target, directory, manifest, currentManifest);
  printPlan(`Component ${command} plan:`, [
    `component: ${componentId}@${plan.manifest.version}`,
    ...plan.files.map((file) => `${file.kind}: ${file.relativePath}${file.existing ? " (replace/preserve as applicable)" : ""}`),
    ...plan.dataDirs.map((path) => `data directory: ${path}`),
  ]);
  if (options.dryRun) {
    console.log("Dry-run only. No files changed.");
    return;
  }

  applyComponentInstall(plan, { force: options.force });
  console.log(`Component ${command === "install" ? "installed" : "updated"}: ${componentId}@${plan.manifest.version}`);
}

function install(target, options = {}) {
  ensureTarget(target);
  ensureSupportedTargetVersion(target);

  const files = overlayFiles().map((file) => file.relativePath);
  const existingManifest = readManifest(target);
  assertCoreOperationAllowed(existingManifest, "install or update");
  const selection = preflightInstallPatchState(target, existingManifest);
  const { patch } = selection;
  const patchTouchedFiles = patchFiles(patch);
  const plan = [
    `validate Homepage checkout: ${target}`,
    `validate Homepage version: ${targetVersion(target)} >= ${targetMetadata.minimumVersion}`,
    ...(existingManifest ? [`remove existing browser editor install from ${manifestName}`] : []),
    `select core patch: ${patch.id} (${patch.file})`,
    `sync managed dependencies: ${Object.keys(managedDependencies).join(", ")}`,
    `copy overlay files: ${files.length}`,
    `apply core patch files: ${patchTouchedFiles.length}`,
    `write manifest: ${manifestName}`,
  ];
  printPlan("Install plan:", plan);

  if (options.dryRun) {
    printPlan("Overlay files:", files);
    printPlan(`Patch files for ${patch.id} (${patch.file}):`, patchTouchedFiles);
    console.log("Dry-run only. No files changed.");
    return;
  }

  let { normalizationNeeded } = selection;
  prepareExistingInstall(target, existingManifest);
  if (patchState(target, patch) === "conflict") {
    if (patchNeedsCompatibilityNormalization(target, patch)) {
      normalizationNeeded = true;
    } else {
      throwCorePatchCompatibilityError();
    }
  }

  const backup = backupTargetFiles(target, ["package.json", ...files, ...patchTouchedFiles]);

  installOverlay(target);
  if (normalizationNeeded) {
    normalizePatchCompatibilityTarget(target, patch, { log: true });
  }
  applyPatch(target, patch);
  syncManagedDependencies(target);
  writeManifest(target, {
    schema: 2,
    core: {
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
      patch: {
        id: patch.id,
        file: patch.file,
      },
      overlayFiles: files,
      patchFiles: patchTouchedFiles,
      managedDependencies,
      backup,
    },
    components: {},
  });

  if (backup) {
    console.log(`Backup written to ${join(target, backup.backupRoot)}`);
  }
  console.log(`Browser editor installed into ${target} with ${patch.id} (${patch.file})`);
  console.log("Run with --enable to set HOMEPAGE_BROWSER_EDITOR=true.");
}

function preflightInstallPatchState(target, manifest) {
  const core = coreRecord(manifest);
  if (core) {
    for (const patch of corePatches) {
      const result = existingInstallCanAcceptPatch(target, core, patch);
      if (result.accepted) {
        return { patch, normalizationNeeded: result.normalizationNeeded };
      }
    }
  }

  for (const patch of corePatches) {
    const state = patchState(target, patch);
    if (state !== "conflict") {
      return { patch, normalizationNeeded: false };
    }

    if (canApplyPatchWithCompatibilityNormalization(target, patch)) {
      return { patch, normalizationNeeded: true };
    }
  }

  throwCorePatchCompatibilityError();
}

function throwCorePatchCompatibilityError() {
  throw new Error(
    [
      "No compatible core patch can be applied to this Homepage checkout.",
      `Tried: ${corePatches.map((patch) => `${patch.id} (${patch.file})`).join(", ")}.`,
      "Update the Homepage source checkout first, then run the configurator again.",
      "For LXC install reinstall Homepage from the current community script or perform manual update.",
    ].join("\n"),
  );
}

function existingInstallCanAcceptPatch(target, manifest, patch) {
  const core = coreRecord(manifest);
  const backupRoot = core?.backup?.backupRoot;
  const backupFiles = core?.backup?.files ?? [];

  if (!isSafeRelativePath(backupRoot)) {
    return { accepted: false, normalizationNeeded: false };
  }

  const backupRootPath = join(target, backupRoot);
  if (!existsSync(backupRootPath)) {
    return { accepted: false, normalizationNeeded: false };
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "homepage-configurator-preflight-"));

  try {
    for (const file of patchFiles(patch)) {
      copyRelativeFileIfExists(target, tempRoot, file);
    }

    for (const file of backupFiles) {
      if (!isSafeRelativePath(file)) {
        return { accepted: false, normalizationNeeded: false };
      }

      copyRelativeFileIfExists(backupRootPath, tempRoot, file);
    }

    if (canApplyPatch(tempRoot, patch)) {
      return { accepted: true, normalizationNeeded: false };
    }

    const changedFiles = normalizePatchCompatibilityTarget(tempRoot, patch);
    if (changedFiles.length > 0 && canApplyPatch(tempRoot, patch)) {
      return { accepted: true, normalizationNeeded: true };
    }

    return { accepted: false, normalizationNeeded: false };
  } catch {
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

function patchesForManifest(manifest) {
  const core = coreRecord(manifest);
  const patchId = core?.patch?.id ?? core?.patchId;
  const patchFile = core?.patch?.file ?? core?.patchFile;
  const manifestPatch = corePatches.find((patch) => patch.id === patchId) ?? corePatches.find((patch) => patch.file === patchFile);

  if (!manifestPatch) {
    return corePatches;
  }

  return [manifestPatch, ...corePatches.filter((patch) => patch !== manifestPatch)];
}

function uninstall(target, options = {}) {
  ensureTarget(target);
  const manifest = readManifest(target);
  assertCoreOperationAllowed(manifest, "uninstall");
  const core = coreRecord(manifest);
  const files = core?.overlayFiles ?? overlayFiles().map((file) => file.relativePath);
  const fallbackPatches = patchesForManifest(core);
  const plan = [
    `validate Homepage checkout: ${target}`,
    `restore backup first; reverse fallback: ${fallbackPatches.map((patch) => `${patch.id} (${patch.file})`).join(", ")}`,
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
      reverseInstalledPatch(target, manifest);
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
  assertCoreOperationAllowed(manifest, "reinstall or update");
  const core = coreRecord(manifest);
  if (!core) {
    unlinkSync(manifestPath(target));
    return;
  }

  console.log(`Existing browser editor install detected in ${manifestName}; preparing reinstall`);

  try {
    if (restoreBackupFiles(target, core)) {
      console.log("Previous install files restored from backup before reinstall");
    } else {
      reverseInstalledPatch(target, core);
    }
  } catch (error) {
    if (!restoreBackupFiles(target, core)) {
      throw new Error(`Existing install could not be reverted before reinstall:\n${error.message}`);
    }
    console.log("Previous install files restored from backup before reinstall");
  }

  removeOverlay(target, { files: core.overlayFiles ?? [], force: true });
  if (existsSync(manifestPath(target))) {
    unlinkSync(manifestPath(target));
  }
}

function restoreBackupFiles(target, manifest) {
  const core = coreRecord(manifest);
  const backupRoot = core?.backup?.backupRoot;
  const files = core?.backup?.files ?? [];

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

function applyPatch(target, patch) {
  ensurePatchFilesNotStaged(target, patch);
  const gitWorkTree = isGitWorkTree(target);

  try {
    runGit(target, ["apply", "--check", patch.path], "pipe");
    runGit(target, ["apply", patch.path], "pipe");
    console.log(`Core patch applied: ${patch.id} (${patch.file})`);
    return;
  } catch (error) {
    try {
      runGit(target, ["apply", "--reverse", "--check", patch.path], "pipe");
      console.log(`Core patch already applied: ${patch.id} (${patch.file})`);
      return;
    } catch {
      if (!gitWorkTree) {
        throw error;
      }

      try {
        runGit(target, ["apply", "--3way", patch.path], "pipe");
        unstagePatchFiles(target, patch);
        console.log(`Core patch applied with 3-way merge: ${patch.id} (${patch.file})`);
        return;
      } catch {
        throw error;
      }
    }
  }
}

function reverseInstalledPatch(target, manifest) {
  const candidates = patchesForManifest(manifest);
  const appliedPatch = candidates.find((patch) => canApplyPatch(target, patch, true));

  if (appliedPatch) {
    reversePatch(target, appliedPatch);
    return;
  }

  if (candidates.some((patch) => canApplyPatch(target, patch))) {
    console.log("Core patch is not applied");
    return;
  }

  throw new Error(
    `Core patch cannot be reverted automatically. Tried: ${candidates.map((patch) => patch.file).join(", ")}. Check target changes before removing overlay files.`,
  );
}

function reversePatch(target, patch) {
  ensurePatchFilesNotStaged(target, patch);
  runGit(target, ["apply", "--reverse", "--check", patch.path], "pipe");
  runGit(target, ["apply", "--reverse", patch.path], "pipe");
  console.log(`Core patch reverted: ${patch.id} (${patch.file})`);
}

try {
  const { command, componentCommand, componentId, componentDir, target, dryRun, force } = parseArgs();
  ensureConfiguratorMetadata();
  if (componentCommand) {
    componentOperation(target, componentCommand, { componentId, componentDir, dryRun, force });
  } else if (command === "install") install(target, { dryRun, force });
  else if (command === "uninstall") uninstall(target, { dryRun, force });
  else if (command === "enable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "true");
  else if (command === "disable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "false");
  else if (command === "status") status(target);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
