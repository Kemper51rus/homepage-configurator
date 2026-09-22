import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "homepage-studio-migration-"));
const target = join(tempRoot, "homepage");
const studio = join(tempRoot, "homepage-studio");
const homepageRef = process.env.HOMEPAGE_MIGRATION_TEST_REF || "v2.0.0";
const studioRef = process.env.HOMEPAGE_STUDIO_TEST_REF || "studio-integrated-v0.6.82";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
  });
}

try {
  run("git", ["clone", "--depth", "1", "--branch", homepageRef, "https://github.com/gethomepage/homepage.git", target], {
    stdio: "inherit",
  });
  run("git", ["clone", "--depth", "1", "--branch", studioRef, "https://github.com/Kemper51rus/homepage-studio.git", studio], {
    stdio: "inherit",
  });

  run("node", [join(studio, "install.mjs"), "--target", target], { stdio: "inherit" });
  const studioManifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  if (studioManifest.configurator?.version !== "0.6.82") {
    throw new Error(`Expected Studio 0.6.82, got ${studioManifest.configurator?.version ?? "unknown"}`);
  }

  run("node", [join(root, "install.mjs"), "--target", target], { stdio: "inherit" });
  const classicManifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  if (classicManifest.configurator?.version !== "0.7.0") {
    throw new Error(`Expected Classic 0.7.0, got ${classicManifest.configurator?.version ?? "unknown"}`);
  }
  if (classicManifest.patch?.id !== "homepage-2.0") {
    throw new Error(`Expected homepage-2.0 compatibility patch, got ${classicManifest.patch?.id ?? "unknown"}`);
  }

  const removedStudioFiles = [
    "src/mods/browser-editor/components/dashboard-studio.jsx",
    "src/mods/browser-editor/api/service-updates.js",
    "src/mods/browser-editor/api/three-x-ui.js",
    "src/mods/browser-editor/lib/card-background.js",
  ];
  const residue = removedStudioFiles.filter((file) => existsSync(join(target, file)));
  if (residue.length) {
    throw new Error(`Studio files remained after migration: ${residue.join(", ")}`);
  }

  console.log(`Studio ${studioRef} -> Classic ${classicManifest.configurator.version} migration passed on Homepage ${homepageRef}.`);
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
