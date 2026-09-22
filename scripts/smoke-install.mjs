import { execFileSync } from "child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import { tmpdir } from "os";

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "homepage-configurator-smoke-"));
const target = join(tempRoot, "homepage");
const currentPatch = {
  id: "homepage-current",
  file: "browser-editor.patch",
};
const legacyPatch = {
  id: "homepage-2.0",
  file: "browser-editor-homepage-2.0.patch",
};

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? "pipe",
    encoding: "utf8",
  });
}

function patchFiles(patch) {
  return run("git", ["apply", "--numstat", join(root, patch.file)])
    .split(/\r?\n/)
    .map((line) => line.trim().split("\t").at(-1))
    .filter(Boolean);
}

function coreRecord(manifest) {
  return manifest?.schema === 2 ? manifest.core : manifest;
}

function assertPatchMetadata(manifest, expectedPatch) {
  const core = coreRecord(manifest);
  if (core?.patch?.id !== expectedPatch.id || core?.patch?.file !== expectedPatch.file) {
    throw new Error(
      `Install manifest patch metadata mismatch: expected ${expectedPatch.id} (${expectedPatch.file}), got ${JSON.stringify(core?.patch)}`,
    );
  }
}

try {
  run("git", ["clone", "--depth", "1", "https://github.com/gethomepage/homepage.git", target], { stdio: "inherit" });

  for (const patch of [currentPatch, legacyPatch]) {
    if (!patchFiles(patch).length) {
      throw new Error(`Core patch has no files: ${patch.id} (${patch.file})`);
    }
  }

  const originalPackageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  writeFileSync(join(target, "package.json"), `${JSON.stringify({ ...originalPackageJson, version: "0.0.1" }, null, 2)}\n`);
  try {
    run("node", ["install.mjs", "--dry-run", "--target", target]);
    throw new Error("Old Homepage target version should be rejected");
  } catch (error) {
    if (!String(error.stderr || error.message).includes("Target Homepage слишком старый")) {
      throw error;
    }
  } finally {
    writeFileSync(join(target, "package.json"), `${JSON.stringify(originalPackageJson, null, 2)}\n`);
  }

  const beforeDryRunStatus = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: target });
  const dryRunOutput = run("node", ["install.mjs", "--dry-run", "--target", target]);
  const afterDryRunStatus = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: target });
  if (afterDryRunStatus !== beforeDryRunStatus) {
    throw new Error(`Dry-run changed the target checkout:\n${afterDryRunStatus}`);
  }
  if (!dryRunOutput.includes(`select core patch: ${currentPatch.id} (${currentPatch.file})`)) {
    throw new Error(`Dry-run did not report the selected current patch:\n${dryRunOutput}`);
  }
  process.stdout.write(dryRunOutput);

  run("node", ["install.mjs", "--target", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--enable", "--target", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--target", target], { stdio: "inherit" });

  const env = readFileSync(join(target, ".env.local"), "utf8");
  if (!env.includes("HOMEPAGE_BROWSER_EDITOR=true")) {
    throw new Error("HOMEPAGE_BROWSER_EDITOR=true was not written");
  }

  run("git", ["-c", `safe.directory=${target}`, "apply", "--reverse", "--check", join(root, currentPatch.file)], {
    cwd: target,
  });

  const nextConfig = readFileSync(join(target, "next.config.js"), "utf8");
  if (!nextConfig.includes("outputFileTracingRoot: __dirname")) {
    throw new Error("next.config.js should pin outputFileTracingRoot to the Homepage checkout");
  }

  const packageJsonPath = join(target, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!packageJson.dependencies?.prismjs || !packageJson.dependencies?.["react-simple-code-editor"]) {
    throw new Error("Managed dependencies were not added");
  }

  const manifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  const core = coreRecord(manifest);
  assertPatchMetadata(manifest, currentPatch);
  if (manifest.schema !== 2 || !core || Object.keys(manifest.components ?? {}).length !== 0) {
    throw new Error("Install manifest must use schema 2 with core and empty components");
  }
  if (!core.overlayFiles?.includes("src/mods/browser-editor/components/editor.jsx")) {
    throw new Error("Install manifest does not list overlay files");
  }
  if (!core.overlayFiles?.includes("src/mods/browser-editor/lib/editor-window.js")) {
    throw new Error("Install manifest does not list editor window helper overlay file");
  }
  if (!core.backup?.backupRoot) {
    throw new Error("Install manifest does not list backup root");
  }
  if (isAbsolute(core.backup.backupRoot)) {
    throw new Error(`Install manifest backup root should be relative, got ${core.backup.backupRoot}`);
  }
  if (!core.backup.backupRoot.startsWith(".homepage-configurator-backups/")) {
    throw new Error(`Install manifest backup root should stay inside .homepage-configurator-backups, got ${core.backup.backupRoot}`);
  }
  if (!existsSync(join(target, core.backup.backupRoot))) {
    throw new Error("Install manifest backup root does not exist under target checkout");
  }

  const staleBackupFile = patchFiles(currentPatch).find((file) => existsSync(join(target, core.backup.backupRoot, file)));
  if (!staleBackupFile) {
    throw new Error("Could not find a backed-up patch file for stale manifest preflight smoke");
  }
  cpSync(join(target, core.backup.backupRoot, staleBackupFile), join(target, staleBackupFile));
  rmSync(join(target, core.backup.backupRoot, staleBackupFile), { force: true });
  const { patch: ignoredPatchMetadata, ...legacyManifest } = core;
  void ignoredPatchMetadata;
  writeFileSync(
    join(target, ".homepage-configurator-manifest.json"),
    `${JSON.stringify(
      {
        ...legacyManifest,
        backup: {
          ...core.backup,
          files: core.backup.files.filter((file) => file !== staleBackupFile),
        },
      },
      null,
      2,
    )}\n`,
  );
  run("node", ["install.mjs", "--target", target], { stdio: "inherit" });
  const migratedManifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  assertPatchMetadata(migratedManifest, currentPatch);

  run("node", ["install.mjs", "--dry-run", "--uninstall", "--target", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--uninstall", "--target", target], { stdio: "inherit" });

  rmSync(join(target, ".env.local"), { force: true });
  rmSync(join(target, ".git"), { force: true, recursive: true });
  writeFileSync(join(target, ".env"), "HOMEPAGE_ALLOWED_HOSTS=localhost:3000\n");

  run("node", ["install.mjs", "--target", target], { stdio: "inherit" });
  run("node", ["install.mjs", "--enable", "--target", target], { stdio: "inherit" });

  const dotEnv = readFileSync(join(target, ".env"), "utf8");
  if (!dotEnv.includes("HOMEPAGE_BROWSER_EDITOR=true")) {
    throw new Error("HOMEPAGE_BROWSER_EDITOR=true was not written to existing .env");
  }

  run("git", ["apply", "--reverse", "--check", join(root, currentPatch.file)], {
    cwd: target,
  });
  const fallbackManifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  rmSync(join(target, coreRecord(fallbackManifest).backup.backupRoot), { force: true, recursive: true });
  run("node", ["install.mjs", "--uninstall", "--target", target], { stdio: "inherit" });

  console.log("Smoke install/uninstall passed.");
} finally {
  rmSync(tempRoot, { force: true, recursive: true });
}
