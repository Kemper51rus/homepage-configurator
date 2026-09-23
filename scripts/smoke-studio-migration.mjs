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
const componentDir = process.env.STUDIO_COMPONENT_DIR || "/projects/homepage-studio";
const configuratorVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

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
  if (classicManifest.schema !== 2) {
    throw new Error(`Expected schema 2 Classic manifest, got ${classicManifest.schema ?? "legacy"}`);
  }
  if (classicManifest.core?.configurator?.version !== configuratorVersion) {
    throw new Error(`Expected Classic ${configuratorVersion}, got ${classicManifest.core?.configurator?.version ?? "unknown"}`);
  }
  if (classicManifest.core?.patch?.id !== "homepage-2.0") {
    throw new Error(`Expected homepage-2.0 compatibility patch, got ${classicManifest.core?.patch?.id ?? "unknown"}`);
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

  if (!existsSync(join(componentDir, "homepage-component.json"))) {
    throw new Error(`Studio component checkout is missing: ${componentDir}`);
  }
  run("node", [
    join(root, "install.mjs"),
    "--target",
    target,
    "--component",
    "install",
    "homepage-studio",
    "--component-dir",
    componentDir,
  ], { stdio: "inherit" });
  const componentManifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  if (componentManifest.components?.["homepage-studio"]?.version !== "0.1.0-beta.2") {
    throw new Error(`Expected Studio component 0.1.0-beta.2, got ${componentManifest.components?.["homepage-studio"]?.version ?? "unknown"}`);
  }
  for (const file of removedStudioFiles) {
    if (!existsSync(join(target, file))) throw new Error(`Studio component did not restore ${file}`);
  }

  console.log(
    `Integrated Studio ${studioRef} -> Classic ${classicManifest.core.configurator.version} -> component Studio ${componentManifest.components["homepage-studio"].version} migration passed on Homepage ${homepageRef}.`,
  );
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
