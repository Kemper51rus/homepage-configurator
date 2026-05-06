import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { isAbsolute, join } from "path";
import { tmpdir } from "os";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "homepage-configurator-smoke-"));
const target = join(tempRoot, "homepage");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
  });
}

try {
  run("git", ["clone", "--depth", "1", "https://github.com/gethomepage/homepage.git", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--dry-run", "--target", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--target", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--enable", "--target", target], { stdio: "inherit" });

  const env = readFileSync(join(target, ".env.local"), "utf8");
  if (!env.includes("HOMEPAGE_BROWSER_EDITOR=true")) {
    throw new Error("HOMEPAGE_BROWSER_EDITOR=true was not written");
  }

  run("git", ["-c", `safe.directory=${target}`, "apply", "--reverse", "--check", join(root, "browser-editor.patch")], {
    cwd: target,
  });

  const packageJsonPath = join(target, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!packageJson.dependencies?.prismjs || !packageJson.dependencies?.["react-simple-code-editor"]) {
    throw new Error("Managed dependencies were not added");
  }

  const manifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  if (!manifest.overlayFiles?.includes("src/mods/browser-editor/components/editor.jsx")) {
    throw new Error("Install manifest does not list overlay files");
  }
  if (!manifest.overlayFiles?.includes("src/mods/browser-editor/lib/editor-window.js")) {
    throw new Error("Install manifest does not list editor window helper overlay file");
  }
  if (!manifest.backup?.backupRoot) {
    throw new Error("Install manifest does not list backup root");
  }
  if (isAbsolute(manifest.backup.backupRoot)) {
    throw new Error(`Install manifest backup root should be relative, got ${manifest.backup.backupRoot}`);
  }
  if (!manifest.backup.backupRoot.startsWith(".homepage-configurator-backups/")) {
    throw new Error(`Install manifest backup root should stay inside .homepage-configurator-backups, got ${manifest.backup.backupRoot}`);
  }
  if (!existsSync(join(target, manifest.backup.backupRoot))) {
    throw new Error("Install manifest backup root does not exist under target checkout");
  }

  run("node", ["install.mjs", "--dry-run", "--uninstall", "--target", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--uninstall", "--target", target], { stdio: "inherit" });

  console.log("Smoke install/uninstall passed.");
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
