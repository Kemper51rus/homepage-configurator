import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const patchPath = join(root, "browser-editor.patch");
const overlayPath = join(root, "overlay");
const manifestName = ".homepage-configurator-manifest.json";
const backupDirName = ".homepage-configurator-backups";
const managedDependencies = {
  prismjs: "^1.29.0",
  "react-simple-code-editor": "^0.14.1",
};

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
  const files = patchFiles();
  if (!files.length) return;

  const output = runGit(target, ["diff", "--cached", "--name-only", "--", ...files], "pipe").trim();
  if (output) {
    throw new Error(`Patch files have staged changes. Unstage them before continuing:\n${output}`);
  }
}

function unstagePatchFiles(target) {
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

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (packageJson.name !== "homepage") {
    throw new Error(`${target} package name is ${packageJson.name ?? "<missing>"}, expected homepage`);
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

function envPath(target) {
  return join(target, ".env.local");
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

  const files = overlayFiles().map((file) => file.relativePath);
  const patchTouchedFiles = patchFiles();
  const plan = [
    `validate Homepage checkout: ${target}`,
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

  const backup = backupTargetFiles(target, ["package.json", ...files, ...patchTouchedFiles]);

  syncManagedDependencies(target);
  installOverlay(target);
  applyPatch(target);
  writeManifest(target, {
    installedAt: new Date().toISOString(),
    source: root,
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

  reversePatch(target);
  removeOverlay(target, { files, force: options.force });
  setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "false");
  if (existsSync(manifestPath(target))) {
    unlinkSync(manifestPath(target));
  }
  console.log(`Browser editor removed from ${target}`);
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
  if (command === "install") install(target, { dryRun, force });
  if (command === "uninstall") uninstall(target, { dryRun, force });
  if (command === "enable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "true");
  if (command === "disable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "false");
  if (command === "status") status(target);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
