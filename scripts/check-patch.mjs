import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "homepage-configurator-patch-"));
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
  run("git", ["-c", `safe.directory=${target}`, "apply", "--check", join(root, "browser-editor.patch")], {
    cwd: target,
    stdio: "inherit",
  });
  console.log("Core patch applies cleanly to upstream Homepage.");
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
