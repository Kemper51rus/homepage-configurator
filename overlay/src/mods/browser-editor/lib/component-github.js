import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import { resolveComponentReleaseArtifact, resolveComponentSource } from "./component-sources.js";
import { getComponentStatusCatalog, HOMEPAGE_STUDIO_COMPONENT_ID, GITHUB_STABLE_SOURCE_ID } from "./component-operations.js";

const allowedHosts = new Set(["github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const studioMaxBytes = 8 * 1024 * 1024;
const coreMaxBytes = 24 * 1024 * 1024;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// Python's tarfile validates the complete archive before writing *any* file. Only
// regular files and directories below the selected root are admitted; no links,
// devices, absolute paths, duplicate members, or traversal through PAX paths.
const extractScript = String.raw`
import os, pathlib, shutil, sys, tarfile
archive, destination, prefix = sys.argv[1:]
root = pathlib.Path(destination)
with tarfile.open(archive, 'r:gz') as bundle:
    members = bundle.getmembers()
    if len(members) > 700: raise ValueError('Too many release files')
    total = 0
    seen = set()
    safe_members = []
    files = set()
    for member in members:
        name = member.name.rstrip('/') if member.isdir() else member.name
        if not name or name.startswith('/') or '\\' in name or '\x00' in name:
            raise ValueError('Unsafe release path')
        parts = name.split('/')
        if any(part in ('', '.', '..') for part in parts):
            raise ValueError('Unsafe release path')
        if prefix:
            if parts[0] != prefix:
                raise ValueError('Unexpected release root')
            parts = parts[1:]
            if not parts and member.isdir(): continue
        relative = '/'.join(parts)
        if not parts or relative in seen or not (member.isfile() or member.isdir()):
            raise ValueError('Duplicate or unsupported release entry')
        seen.add(relative)
        if member.isfile(): files.add(relative)
        safe_members.append((member, parts))
        total += member.size
        if member.size > 12_000_000 or total > 80_000_000:
            raise ValueError('Release expands beyond size limit')
    for member, parts in safe_members:
        if any('/'.join(parts[:index]) in files for index in range(1, len(parts))):
            raise ValueError('Release file is also a parent directory')
    for member, parts in safe_members:
        path = root.joinpath(*parts)
        if member.isdir():
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
        else:
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with bundle.extractfile(member) as source, open(path, 'xb') as target:
                shutil.copyfileobj(source, target)
            os.chmod(path, 0o600)
`;

function requireVersion(value, label) {
  if (typeof value !== "string" || !versionPattern.test(value) || value.length > 100) {
    throw new Error(`Invalid ${label} version`);
  }
  return value;
}

async function fetchGithubBytes(url, limit, fetchImpl = fetch) {
  let current = new URL(url);
  for (let hop = 0; hop < 7; hop += 1) {
    if (current.protocol !== "https:" || current.username || current.password || !allowedHosts.has(current.hostname) || current.port) {
      throw new Error("GitHub release redirected to an unsafe URL");
    }
    let redirected = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(current.href, {
          redirect: "manual",
          signal: AbortSignal.timeout(45000),
          headers: { "User-Agent": "homepage-configurator-component/1.0", "Accept": "application/octet-stream, application/json" },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new Error("GitHub release redirect is missing a destination");
          await response.body?.cancel();
          redirected = new URL(location, current);
          break;
        }
        if (!response.ok) throw new Error(`GitHub release HTTP ${response.status}`);
        if (Number(response.headers.get("content-length") || 0) > limit) throw new Error("GitHub release exceeds size limit");
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > limit) {
            await response.body.cancel().catch(() => {});
            throw new Error("GitHub release exceeds size limit");
          }
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks, bytes);
      } catch (error) {
        if (attempt > 0 || !["AbortError", "TimeoutError", "TypeError"].includes(error?.name)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    if (redirected) {
      current = redirected;
      continue;
    }
    throw new Error("Unable to download GitHub release");
  }
  throw new Error("Too many GitHub release redirects");
}

export async function fetchStudioRelease(options = {}) {
  const source = resolveComponentSource(HOMEPAGE_STUDIO_COMPONENT_ID, GITHUB_STABLE_SOURCE_ID);
  const bytes = await fetchGithubBytes(source.releaseManifestUrl, 16384, options.fetchImpl);
  let release;
  try { release = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Invalid Studio release metadata"); }
  const version = requireVersion(release?.version, "Studio release");
  if (release.schema !== 1 || release.id !== HOMEPAGE_STUDIO_COMPONENT_ID || release.tag !== `homepage-studio-v${version}`) {
    throw new Error("Unexpected Studio release metadata");
  }
  if (!Number.isSafeInteger(release.size) || release.size < 1 || release.size > studioMaxBytes) {
    throw new Error("Invalid Studio release artifact size");
  }
  const artifact = resolveComponentReleaseArtifact(HOMEPAGE_STUDIO_COMPONENT_ID, GITHUB_STABLE_SOURCE_ID, release);
  return { version, size: release.size, sha256: artifact.sha256, artifactUrl: artifact.artifactUrl };
}

export async function getGithubComponentCatalog(target, options = {}) {
  try {
    const release = await fetchStudioRelease(options);
    return getComponentStatusCatalog(target, { githubRelease: release });
  } catch {
    return getComponentStatusCatalog(target, { githubError: "studio-github-unavailable" });
  }
}

function safeManifestPath(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || value.includes("\\") || value.includes("\0")
    || value.startsWith("/") || posix.normalize(value) !== value
    || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe Studio release manifest path");
  }
  return value;
}

function verifyStudioArchive(directory, release) {
  const component = JSON.parse(readFileSync(join(directory, "homepage-component.json"), "utf8"));
  if (component.schema !== 1 || component.id !== HOMEPAGE_STUDIO_COMPONENT_ID || component.version !== release.version
    || !component.overlay || !Array.isArray(component.overlay.files) || !Array.isArray(component.configFiles)) {
    throw new Error("Studio artifact does not match GitHub release metadata");
  }
  const root = safeManifestPath(component.overlay.root);
  const files = ["homepage-component.json"];
  for (const item of component.overlay.files) {
    const source = typeof item === "string" ? item : item?.source;
    const target = typeof item === "string" ? item : item?.target;
    safeManifestPath(target);
    files.push(posix.join(root, safeManifestPath(source)));
  }
  for (const item of component.configFiles) {
    safeManifestPath(item?.target);
    files.push(safeManifestPath(item?.source));
  }
  for (const item of component.managedCss ?? []) files.push(safeManifestPath(item?.source));
  for (const item of component.runtimeScripts ?? []) files.push(safeManifestPath(item));
  for (const file of files) {
    const candidate = join(directory, ...file.split("/"));
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      throw new Error("Studio release is missing a declared file");
    }
  }
}

function extractVerified(bytes, expectedSha, root, name, prefix) {
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha) {
    throw new Error(`GitHub ${name} release checksum mismatch`);
  }
  const archive = join(root, `${name}.tar.gz`);
  const directory = join(root, name);
  writeFileSync(archive, bytes, { mode: 0o600 });
  execFileSync("python3", ["-c", extractScript, archive, directory, prefix], {
    stdio: "pipe",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  return directory;
}

export async function prepareGithubComponentSources(target, input, options = {}) {
  const manifest = JSON.parse(readFileSync(join(target, ".homepage-configurator-manifest.json"), "utf8"));
  if (manifest.schema !== 2 || !manifest.core?.configurator || !manifest.components) {
    throw new Error("Component operations require a schema 2 Configurator core");
  }
  const version = requireVersion(manifest.core.configurator.version, "Configurator core");
  const coreArchiveName = `homepage-configurator-${version}.tar.gz`;
  const coreRelease = `https://github.com/Kemper51rus/homepage-configurator/releases/download/component-host-v${version}`;
  const checksums = (await fetchGithubBytes(`${coreRelease}/SHA256SUMS.txt`, 4096, options.fetchImpl)).toString("utf8");
  const checksumLines = checksums.split(/\r?\n/).filter(Boolean);
  const expectedLine = new RegExp(`^([a-f0-9]{64})  ${coreArchiveName.replaceAll(".", "\\.")}$`);
  if (checksumLines.length !== 1 || !expectedLine.test(checksumLines[0])) {
    throw new Error("Configurator release checksum is missing or ambiguous");
  }
  const checksum = checksumLines[0].slice(0, 64);

  const coreBytes = await fetchGithubBytes(`${coreRelease}/${coreArchiveName}`, coreMaxBytes, options.fetchImpl);
  const studioRelease = input.operation === "remove" ? null : await fetchStudioRelease(options);
  const studioBytes = studioRelease
    ? await fetchGithubBytes(studioRelease.artifactUrl, studioMaxBytes, options.fetchImpl)
    : null;
  if (studioRelease && studioBytes.length !== studioRelease.size) throw new Error("Studio release artifact size mismatch");

  const root = mkdtempSync(join(tmpdir(), "homepage-github-component-"));
  try {
    const configuratorSource = extractVerified(coreBytes, checksum, root, "configurator", `homepage-configurator-${version}`);
    const pkg = JSON.parse(readFileSync(join(configuratorSource, "package.json"), "utf8"));
    if (pkg.name !== "homepage-configurator" || pkg.version !== version || !existsSync(join(configuratorSource, "install.mjs"))) {
      throw new Error("Configurator release does not match installed core");
    }
    let studioSource = null;
    if (studioRelease) {
      studioSource = extractVerified(studioBytes, studioRelease.sha256, root, "studio", "");
      verifyStudioArchive(studioSource, studioRelease);
    }
    return {
      env: {
        ...(options.env ?? process.env),
        HOMEPAGE_CONFIGURATOR_SOURCE_DIR: configuratorSource,
        ...(studioSource ? { HOMEPAGE_STUDIO_COMPONENT_DIR: studioSource } : {}),
      },
      release: studioRelease,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
