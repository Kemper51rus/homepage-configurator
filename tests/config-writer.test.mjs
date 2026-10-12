import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureConfigFile, updateConfigFile, writeConfigFile } from "../overlay/src/mods/browser-editor/lib/config-writer.js";

const source = await fs.readFile(new URL("../overlay/src/mods/browser-editor/api/editor.js", import.meta.url), "utf8");
const START = "/* --- HOMEPAGE-CONFIGURATOR TITLE STYLES START --- */";
const END = "/* --- HOMEPAGE-CONFIGURATOR TITLE STYLES END --- */";
const updaterSource = source.slice(source.indexOf("async function updateCustomCssWithStyles("), source.indexOf("function generateCssForItems("));
const managed = "/* managed radio */\n.radio { display: flex; }\n/* managed particles */\n.particles { opacity: .8; }\n/* user CSS */\n.user { color: red; }\n" + "/* preserved external content */\n".repeat(1700);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "config-writer-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "custom.css");
  const updateStyles = new Function("path", "CONF_DIR", "updateConfigFile", "CSS_START_MARKER", "CSS_END_MARKER", `${updaterSource}\nreturn updateCustomCssWithStyles;`)(path, dir, updateConfigFile, START, END);
  return { dir, file, updateStyles };
}

function outsideTitles(content) {
  return content.replace(new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`), "");
}

test("legacy truncate/read interleaving reproduces title-only CSS loss", async (t) => {
  const { dir, file } = await fixture(t);
  await fs.writeFile(file, managed);
  // fs.writeFile(path, ...) opens with "w": pause at precisely that truncation
  // point, then let the former unlocked title RMW run before the first completes.
  const writer = await fs.open(file, "w");
  const legacyUpdate = async (target, transform) => {
    const next = await transform(await fs.readFile(target, "utf8"));
    await writer.writeFile(managed, "utf8");
    await writer.close();
    await fs.writeFile(target, next, "utf8");
  };
  const update = new Function("path", "CONF_DIR", "updateConfigFile", "CSS_START_MARKER", "CSS_END_MARKER", `${updaterSource}\nreturn updateCustomCssWithStyles;`)(path, dir, legacyUpdate, START, END);
  await update(".title {}\n");
  const final = await fs.readFile(file, "utf8");
  assert.ok(final.startsWith(START));
  assert.ok(!final.includes("managed radio"));
  assert.equal(outsideTitles(final), "");
});

test("config YAML, JSON and raw writes all use the atomic helper", () => {
  for (const [start, end] of [["async function writeJsonFile(", "async function getConfiguratorUpdateFiles("], ["async function writeYamlFile(", "async function fileExists("], ["async function writeRawConfigFile(", "function isSupportedSettingsTabFile("]]) {
    const block = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(block, /await writeConfigFile\(/);
    assert.doesNotMatch(block, /fs\.writeFile\(/);
  }
  assert.match(updaterSource, /await updateConfigFile\(customCssPath/);
});

test("overlapping raw CSS/title writes and readers never observe truncation or lose managed content", async (t) => {
  const { file, updateStyles } = await fixture(t);
  await fs.writeFile(file, managed);
  const next = managed + ".new-user-rule { color: blue; }\n";
  const entered = deferred(); const release = deferred();
  const originalOpen = fs.open;
  let first = true;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await originalOpen(...args);
    if (first && args[1] === "wx") {
      first = false;
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async (content, encoding) => {
        // Hold a real partially-written temporary file while a reader and title
        // regeneration overlap the raw write. The destination must stay intact.
        await handle.write(String(content).slice(0, 7), 0, "utf8");
        entered.resolve();
        await release.promise;
        await handle.truncate(0);
        await originalWrite(content, encoding);
      };
    }
    return handle;
  });
  const raw = writeConfigFile(file, next);
  await entered.promise;
  const styles = updateStyles(".title { color: green; }\n");
  try {
    for (let index = 0; index < 10; index += 1) assert.equal(await fs.readFile(file, "utf8"), managed);
  } finally { release.resolve(); }
  await Promise.all([raw, styles]);
  const final = await fs.readFile(file, "utf8");
  assert.equal(outsideTitles(final), next);
  assert.match(final, /\.title \{ color: green; \}/);
});

test("parallel title regeneration preserves prefix/suffix, and missing/incomplete markers append normally", async (t) => {
  const { file, updateStyles } = await fixture(t);
  for (const initial of [managed, managed + START + "\nincomplete\n", managed + START + "\nold\n" + END + "\n.suffix {}\n"]) {
    await writeConfigFile(file, initial);
    const count = initial.includes(START) && !initial.includes(END) ? 1 : 20;
    await Promise.all(Array.from({ length: count }, (_, i) => updateStyles(`.title-${i} {}\n`)));
    const final = await fs.readFile(file, "utf8");
    if (initial.includes(END)) assert.equal(outsideTitles(final), outsideTitles(initial));
    else assert.ok(final.startsWith(initial));
    assert.ok(final.includes(managed));
    assert.equal(final.split(END).length, 2);
  }
});

test("RMW reads latest external content, preserves modes and symlink targets", async (t) => {
  const { dir, file, updateStyles } = await fixture(t);
  const target = path.join(dir, "actual.css");
  await fs.writeFile(target, managed, { mode: 0o600 });
  await fs.symlink(target, file);
  await updateStyles(".title {}\n");
  assert.ok((await fs.lstat(file)).isSymbolicLink());
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  await fs.writeFile(target, managed + ".external-change {}\n");
  await updateStyles(".new-title {}\n");
  assert.equal(outsideTitles(await fs.readFile(target, "utf8")), managed + ".external-change {}\n");
});

test("ensure cannot overwrite a file created externally after its missing-file check", async (t) => {
  const { file } = await fixture(t);
  const link = fs.link;
  t.mock.method(fs, "link", async (...args) => {
    await fs.writeFile(file, managed, { flag: "wx" });
    return link(...args);
  });
  await ensureConfigFile(file);
  assert.equal(await fs.readFile(file, "utf8"), managed);
});

test("rename failure leaves original intact, cleans temporary file, and does not poison queue", async (t) => {
  const { dir, file } = await fixture(t);
  await fs.writeFile(file, managed);
  const rename = t.mock.method(fs, "rename", async () => { throw Object.assign(new Error("rename denied"), { code: "EACCES" }); });
  await assert.rejects(writeConfigFile(file, "replacement"), /rename denied/);
  assert.equal(await fs.readFile(file, "utf8"), managed);
  assert.deepEqual(await fs.readdir(dir), ["custom.css"]);
  rename.mock.restore();
  await writeConfigFile(file, managed + ".recovered {}\n");
  assert.equal(await fs.readFile(file, "utf8"), managed + ".recovered {}\n");
});
