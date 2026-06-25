import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const metadata = JSON.parse(readFileSync(join(root, "version.json"), "utf8"));

const expectedRepo = "Kemper51rus/homepage-configurator";
const expectedBranch = "main";
const expectedMetadataUrl = `https://github.com/${expectedRepo}/raw/refs/heads/${expectedBranch}/version.json`;
const expectedInstallUrl = `https://github.com/${expectedRepo}/raw/refs/heads/${expectedBranch}/install.sh`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (metadata.schema !== 1) {
  fail("version.json schema must be 1");
}

if (metadata.name !== packageJson.name) {
  fail(`version.json name ${metadata.name} does not match package.json ${packageJson.name}`);
}

if (metadata.version !== packageJson.version) {
  fail(`version.json version ${metadata.version} does not match package.json ${packageJson.version}`);
}

if (metadata.repo !== expectedRepo) {
  fail(`version.json repo must be ${expectedRepo}`);
}

if (metadata.branch !== expectedBranch) {
  fail(`version.json branch must be ${expectedBranch}`);
}

if (metadata.metadataUrl !== expectedMetadataUrl) {
  fail(`version.json metadataUrl must be ${expectedMetadataUrl}`);
}

if (metadata.installUrl !== expectedInstallUrl) {
  fail(`version.json installUrl must be ${expectedInstallUrl}`);
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(metadata.version)) {
  fail("version.json version must be semver-like");
}

if (metadata.target?.name !== "homepage") {
  fail("version.json target.name must be homepage");
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(metadata.target?.minimumVersion ?? "")) {
  fail("version.json target.minimumVersion must be semver-like");
}

if (metadata.target?.updateCommand !== "update") {
  fail("version.json target.updateCommand must be update");
}

console.log(`Version metadata OK: ${metadata.version}`);
