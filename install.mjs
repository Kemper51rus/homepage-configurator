import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const patchPath = join(root, "browser-editor.patch");
const overlayPath = join(root, "overlay");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    command: "install",
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

function ensureTarget(target) {
  if (!existsSync(join(target, "package.json")) || !existsSync(join(target, "src"))) {
    throw new Error(`${target} does not look like a homepage checkout`);
  }
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

function install(target) {
  ensureTarget(target);
  installOverlay(target);
  applyPatch(target);
  console.log(`Browser editor installed into ${target}`);
  console.log("Run with --enable to set HOMEPAGE_BROWSER_EDITOR=true.");
}

function uninstall(target) {
  ensureTarget(target);
  reversePatch(target);
  removeOverlay(target);
  setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "false");
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
  if (!existsSync(overlayPath) || !statSync(overlayPath).isDirectory()) {
    throw new Error(`Overlay directory is missing: ${overlayPath}`);
  }

  for (const sourcePath of walk(overlayPath)) {
    const relativePath = relative(overlayPath, sourcePath);
    const targetPath = join(target, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
  }
}

function removeOverlay(target) {
  if (!existsSync(overlayPath) || !statSync(overlayPath).isDirectory()) {
    throw new Error(`Overlay directory is missing: ${overlayPath}`);
  }

  const directories = new Set();

  for (const sourcePath of walk(overlayPath)) {
    const relativePath = relative(overlayPath, sourcePath);
    const targetPath = join(target, relativePath);
    directories.add(dirname(targetPath));

    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
      console.log(`Removed ${relativePath}`);
    }
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
  try {
    runGit(target, ["apply", "--3way", patchPath], "pipe");
    console.log("Core patch applied");
    return;
  } catch (error) {
    try {
      runGit(target, ["apply", "--reverse", "--check", patchPath], "pipe");
      console.log("Core patch already applied");
      return;
    } catch {
      throw error;
    }
  }
}

function reversePatch(target) {
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

const { command, target } = parseArgs();

try {
  if (command === "install") install(target);
  if (command === "uninstall") uninstall(target);
  if (command === "enable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "true");
  if (command === "disable") setEnv(target, "HOMEPAGE_BROWSER_EDITOR", "false");
  if (command === "status") status(target);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
