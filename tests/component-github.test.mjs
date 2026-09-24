import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { fetchStudioRelease, prepareGithubComponentSources } from "../overlay/src/mods/browser-editor/lib/component-github.js";

const coreVersion = "0.8.0-beta.7";
const studioVersion = "0.1.0-beta.6";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "homepage-github-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const target = join(dir, "target");
  const core = join(dir, `homepage-configurator-${coreVersion}`);
  const studio = join(dir, "studio");
  mkdirSync(target);
  mkdirSync(core);
  mkdirSync(join(studio, "overlay/src"), { recursive: true });
  writeFileSync(join(target, ".homepage-configurator-manifest.json"), JSON.stringify({
    schema: 2, core: { configurator: { version: coreVersion } }, components: {},
  }));
  writeFileSync(join(core, "package.json"), JSON.stringify({ name: "homepage-configurator", version: coreVersion }));
  writeFileSync(join(core, "install.mjs"), "// installer\n");
  writeFileSync(join(studio, "homepage-component.json"), JSON.stringify({
    schema: 1, id: "homepage-studio", version: studioVersion,
    overlay: { root: "overlay", files: ["src/new.js"] }, configFiles: [],
  }));
  writeFileSync(join(studio, "overlay/src/new.js"), "export const installed = true;\n");
  const coreArchive = join(dir, "core.tar.gz");
  const studioArchive = join(dir, "studio.tar.gz");
  execFileSync("tar", ["-czf", coreArchive, `homepage-configurator-${coreVersion}`], { cwd: dir });
  execFileSync("tar", ["-czf", studioArchive, "homepage-component.json", "overlay/src/new.js"], { cwd: studio });
  const coreBytes = readFileSync(coreArchive);
  const studioBytes = readFileSync(studioArchive);
  const metadata = {
    schema: 1, id: "homepage-studio", version: studioVersion,
    tag: `homepage-studio-v${studioVersion}`, artifactName: "homepage-studio-component.tar.gz",
    size: studioBytes.length, sha256: sha256(studioBytes),
  };
  function fetchImpl(url) {
    let bytes;
    if (url.endsWith("SHA256SUMS.txt")) bytes = Buffer.from(`${sha256(coreBytes)}  homepage-configurator-${coreVersion}.tar.gz\n`);
    else if (url.endsWith(`homepage-configurator-${coreVersion}.tar.gz`)) bytes = coreBytes;
    else if (url.endsWith("homepage-component-release.json")) bytes = Buffer.from(JSON.stringify(metadata));
    else if (url.endsWith("homepage-studio-component.tar.gz")) bytes = studioBytes;
    else throw new Error(`Unexpected test URL ${url}`);
    return Promise.resolve(new Response(bytes, { status: 200 }));
  }
  return { dir, target, coreBytes, studioBytes, metadata, fetchImpl };
}

test("GitHub Studio install downloads fixed releases and verifies both archives before use", async (t) => {
  const data = fixture(t);
  const release = await fetchStudioRelease({ fetchImpl: data.fetchImpl });
  assert.equal(release.version, studioVersion);
  const sources = await prepareGithubComponentSources(data.target, { operation: "install" }, { fetchImpl: data.fetchImpl });
  const temporary = dirname(sources.env.HOMEPAGE_CONFIGURATOR_SOURCE_DIR);
  try {
    assert.equal(JSON.parse(readFileSync(join(sources.env.HOMEPAGE_CONFIGURATOR_SOURCE_DIR, "package.json"))).version, coreVersion);
    assert.equal(JSON.parse(readFileSync(join(sources.env.HOMEPAGE_STUDIO_COMPONENT_DIR, "homepage-component.json"))).version, studioVersion);
    assert.equal(sources.release.version, studioVersion);
    assert.ok(!JSON.stringify(sources.release).includes(data.dir));
  } finally {
    sources.cleanup();
  }
  assert.equal(existsSync(temporary), false);
});

test("transient GitHub timeouts are retried once", async (t) => {
  const data = fixture(t);
  let failed = false;
  const sources = await prepareGithubComponentSources(data.target, { operation: "install" }, {
    fetchImpl: async (url, options) => {
      if (!failed && url.endsWith("homepage-component-release.json")) {
        failed = true;
        assert.ok(options.signal instanceof AbortSignal);
        throw new DOMException("transient timeout", "TimeoutError");
      }
      return data.fetchImpl(url);
    },
  });
  try {
    assert.equal(failed, true);
    assert.equal(sources.release.version, studioVersion);
  } finally {
    sources.cleanup();
  }
});

test("remove downloads only the matching installed Configurator release", async (t) => {
  const data = fixture(t);
  const urls = [];
  const sources = await prepareGithubComponentSources(data.target, { operation: "remove" }, {
    fetchImpl: (url) => { urls.push(url); return data.fetchImpl(url); },
  });
  try {
    assert.equal(sources.release, null);
    assert.equal(urls.some((url) => url.includes("homepage-studio")), false);
  } finally {
    sources.cleanup();
  }
});

test("tampered Studio and core artifacts are rejected without touching target", async (t) => {
  const data = fixture(t);
  const before = readFileSync(join(data.target, ".homepage-configurator-manifest.json"));
  await assert.rejects(
    prepareGithubComponentSources(data.target, { operation: "install" }, {
      fetchImpl: (url) => url.endsWith("homepage-studio-component.tar.gz")
        ? Promise.resolve(new Response(Buffer.from("wrong"))) : data.fetchImpl(url),
    }), /size mismatch/,
  );
  await assert.rejects(
    prepareGithubComponentSources(data.target, { operation: "remove" }, {
      fetchImpl: (url) => url.endsWith(`homepage-configurator-${coreVersion}.tar.gz`)
        ? Promise.resolve(new Response(Buffer.from("wrong"))) : data.fetchImpl(url),
    }), /checksum mismatch/,
  );
  assert.deepEqual(readFileSync(join(data.target, ".homepage-configurator-manifest.json")), before);
});

test("untrusted release redirects and metadata-supplied paths are refused", async (t) => {
  const data = fixture(t);
  await assert.rejects(fetchStudioRelease({
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }),
  }), /unsafe URL/);
  await assert.rejects(fetchStudioRelease({
    fetchImpl: async () => new Response(JSON.stringify({ ...data.metadata, tag: "../../evil" })),
  }), /Unexpected Studio release metadata/);
  writeFileSync(join(data.target, ".homepage-configurator-manifest.json"), JSON.stringify({
    schema: 2, core: { configurator: { version: "../../evil" } }, components: {},
  }));
  await assert.rejects(prepareGithubComponentSources(data.target, { operation: "remove" }, { fetchImpl: data.fetchImpl }), /Invalid Configurator core version/);
});

test("verified but unsafe tar traversal and symlink entries are refused", async (t) => {
  const data = fixture(t);
  for (const mode of ["traversal", "symlink"]) {
    const archive = join(data.dir, `${mode}.tar.gz`);
    execFileSync("python3", ["-c", `import io,sys,tarfile\nwith tarfile.open(sys.argv[1], 'w:gz') as tar:\n entry=tarfile.TarInfo('../escape' if sys.argv[2]=='traversal' else 'homepage-component.json')\n entry.type=tarfile.REGTYPE if sys.argv[2]=='traversal' else tarfile.SYMTYPE\n entry.linkname='/etc/passwd'\n data=b'bad'\n entry.size=len(data) if sys.argv[2]=='traversal' else 0\n tar.addfile(entry, io.BytesIO(data) if entry.size else None)`, archive, mode]);
    const bytes = readFileSync(archive);
    const metadata = { ...data.metadata, size: bytes.length, sha256: sha256(bytes) };
    await assert.rejects(prepareGithubComponentSources(data.target, { operation: "install" }, {
      fetchImpl: (url) => {
        if (url.endsWith("homepage-component-release.json")) return Promise.resolve(new Response(JSON.stringify(metadata)));
        if (url.endsWith("homepage-studio-component.tar.gz")) return Promise.resolve(new Response(bytes));
        return data.fetchImpl(url);
      },
    }), /Command failed/);
    assert.equal(existsSync(join(data.dir, "escape")), false);
  }
});

test("Studio artifact with declared path traversal is refused before installation", async (t) => {
  const data = fixture(t);
  const badDir = join(data.dir, "bad");
  mkdirSync(badDir);
  writeFileSync(join(badDir, "homepage-component.json"), JSON.stringify({
    schema: 1, id: "homepage-studio", version: studioVersion,
    overlay: { root: "overlay", files: ["../../escape"] }, configFiles: [],
  }));
  const badArchive = join(data.dir, "bad.tar.gz");
  execFileSync("tar", ["-czf", badArchive, "homepage-component.json"], { cwd: badDir });
  const bytes = readFileSync(badArchive);
  const metadata = { ...data.metadata, size: bytes.length, sha256: sha256(bytes) };
  await assert.rejects(prepareGithubComponentSources(data.target, { operation: "install" }, {
    fetchImpl: (url) => {
      if (url.endsWith("homepage-component-release.json")) return Promise.resolve(new Response(JSON.stringify(metadata)));
      if (url.endsWith("homepage-studio-component.tar.gz")) return Promise.resolve(new Response(bytes));
      return data.fetchImpl(url);
    },
  }), /Unsafe Studio release manifest path/);
});
