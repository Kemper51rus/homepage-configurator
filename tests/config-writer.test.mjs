import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureConfigFile, updateConfigFile, updateConfigFiles, writeConfigFile } from "../overlay/src/mods/browser-editor/lib/config-writer.js";

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

test("compound updates read both current snapshots after earlier writes and block normal operations", async (t) => {
  const { dir, file } = await fixture(t);
  const second = path.join(dir, "settings.yaml");
  await Promise.all([fs.writeFile(file, "old css"), fs.writeFile(second, "old yaml")]);
  const entered = deferred(); const release = deferred();
  const prior = updateConfigFile(second, async () => {
    entered.resolve();
    await release.promise;
    return "current yaml";
  });
  await entered.promise;
  await writeConfigFile(file, "current css");
  const compoundEntered = deferred(); const compoundRelease = deferred();
  const compound = updateConfigFiles([second, file], async (contents) => {
    assert.deepEqual(contents, ["current yaml", "current css"]);
    compoundEntered.resolve();
    await compoundRelease.promise;
    return contents.map((content) => content + " compound");
  });
  release.resolve();
  await compoundEntered.promise;
  const originalRename = fs.rename;
  const events = [];
  t.mock.method(fs, "rename", async (...args) => {
    events.push(path.basename(args[1]));
    return originalRename(...args);
  });
  const raw = writeConfigFile(second, "normal yaml");
  const normalUpdate = updateConfigFile(file, (content) => {
    assert.equal(content, "current css compound");
    return content + " normal";
  });
  const ensure = ensureConfigFile(second);
  try {
    assert.equal(await fs.readFile(file, "utf8"), "current css");
    assert.equal(await fs.readFile(second, "utf8"), "current yaml");
    assert.deepEqual(events, []);
  } finally { compoundRelease.resolve(); }
  await Promise.all([prior, compound, raw, normalUpdate, ensure]);
  assert.deepEqual(events.slice(0, 2), ["settings.yaml", "custom.css"]);
  assert.equal(await fs.readFile(second, "utf8"), "normal yaml");
  assert.equal(await fs.readFile(file, "utf8"), "current css compound normal");
});

test("overlapping compound updates in opposite order do not deadlock or lose increments", { timeout: 5000 }, async (t) => {
  const { dir, file } = await fixture(t);
  const second = path.join(dir, "second.css");
  await Promise.all([fs.writeFile(file, "0"), fs.writeFile(second, "0")]);
  await Promise.all(Array.from({ length: 20 }, (_, index) => updateConfigFiles(
    index % 2 ? [file, second] : [second, file],
    async (contents) => contents.map((content) => String(Number(content) + 1)),
  )));
  assert.equal(await fs.readFile(file, "utf8"), "20");
  assert.equal(await fs.readFile(second, "utf8"), "20");
});

test("compound destination failure rolls back exact snapshots before releasing normal writes", async (t) => {
  const { dir, file } = await fixture(t);
  const second = path.join(dir, "second.css");
  const initial = "\ufeffinitial\r\n\u0000last\n";
  await Promise.all([fs.writeFile(file, initial, { mode: 0o640 }), fs.writeFile(second, "second", { mode: 0o600 })]);
  const originalRename = fs.rename;
  const entered = deferred(); const release = deferred();
  t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === second) {
      entered.resolve();
      await release.promise;
      throw new Error("second destination denied");
    }
    return originalRename(...args);
  });
  const compound = updateConfigFiles([file, second], (contents) => {
    contents[0] = "mutated input";
    return ["new first", "new second"];
  });
  const rejected = assert.rejects(compound, /second destination denied/);
  await entered.promise;
  assert.equal(await fs.readFile(file, "utf8"), "new first");
  const normal = updateConfigFile(file, (content) => {
    assert.equal(content, initial);
    return content + "recovered";
  });
  release.resolve();
  await Promise.all([rejected, normal]);
  assert.equal(await fs.readFile(file, "utf8"), initial + "recovered");
  assert.equal(await fs.readFile(second, "utf8"), "second");
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  assert.equal((await fs.stat(second)).mode & 0o777, 0o600);
  assert.deepEqual((await fs.readdir(dir)).sort(), ["custom.css", "second.css"]);
});

test("cleanup rejection after a successful replacement still rolls that file back", async (t) => {
  const { dir, file } = await fixture(t);
  const second = path.join(dir, "second.css");
  await Promise.all([fs.writeFile(file, "first"), fs.writeFile(second, "second")]);
  const originalRm = fs.rm;
  let first = true;
  const rm = t.mock.method(fs, "rm", async (...args) => {
    if (first && args[0].endsWith(".tmp")) {
      first = false;
      throw new Error("temporary cleanup denied");
    }
    return originalRm(...args);
  });
  await assert.rejects(updateConfigFiles([file, second], () => ["a", "b"]), /temporary cleanup denied/);
  assert.equal(await fs.readFile(file, "utf8"), "first");
  assert.equal(await fs.readFile(second, "utf8"), "second");
  rm.mock.restore();
  await writeConfigFile(file, "recovered");
  assert.equal(await fs.readFile(file, "utf8"), "recovered");
});

test("rollback failures report paths and original cause, attempt remaining rollbacks, and release all queues", async (t) => {
  const { dir, file } = await fixture(t);
  const second = path.join(dir, "second.css");
  const third = path.join(dir, "third.css");
  await Promise.all([fs.writeFile(file, "first"), fs.writeFile(second, "second"), fs.writeFile(third, "third")]);
  const originalRename = fs.rename;
  let failed = false;
  const destinationError = new Error("third denied");
  const rollbackError = new Error("second rollback denied");
  const rename = t.mock.method(fs, "rename", async (...args) => {
    if (args[1] === third) { failed = true; throw destinationError; }
    if (failed && args[1] === second) throw rollbackError;
    return originalRename(...args);
  });
  await assert.rejects(updateConfigFiles([file, second, third], () => ["a", "b", "c"]), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, destinationError);
    assert.deepEqual(error.errors, [destinationError, rollbackError]);
    assert.deepEqual(error.rollbackFailures, [{ filePath: second, error: rollbackError }]);
    assert.ok(error.message.includes(second));
    return true;
  });
  assert.equal(await fs.readFile(file, "utf8"), "first");
  assert.equal(await fs.readFile(second, "utf8"), "b");
  assert.equal(await fs.readFile(third, "utf8"), "third");
  rename.mock.restore();
  await updateConfigFiles([third, second, file], () => ["recovered", "recovered", "recovered"]);
  assert.deepEqual(await Promise.all([file, second, third].map((target) => fs.readFile(target, "utf8"))), ["recovered", "recovered", "recovered"]);
});

test("compound updates preserve modes and symlink aliases share unique locks", { timeout: 5000 }, async (t) => {
  const { dir, file } = await fixture(t);
  const second = path.join(dir, "second.css");
  const alias = path.join(dir, "alias.css");
  await Promise.all([fs.writeFile(file, "first", { mode: 0o640 }), fs.writeFile(second, "second", { mode: 0o600 })]);
  await fs.symlink(file, alias);
  const entered = deferred(); const release = deferred();
  const compound = updateConfigFiles([alias, second, file], async (contents) => {
    assert.deepEqual(contents, ["first", "second", "first"]);
    entered.resolve();
    await release.promise;
    return ["alias next", "second next", "last wins"];
  });
  await entered.promise;
  const normal = updateConfigFile(alias, (content) => {
    assert.equal(content, "last wins");
    return content + " normal";
  });
  release.resolve();
  await Promise.all([compound, normal]);
  assert.ok((await fs.lstat(alias)).isSymbolicLink());
  assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
  assert.equal((await fs.stat(second)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(alias, "utf8"), "last wins normal");
  assert.equal(await fs.readFile(second, "utf8"), "second next");
});

test("missing snapshots, transform rejection and invalid results do not write or poison compound queues", async (t) => {
  const { dir, file } = await fixture(t);
  const missing = path.join(dir, "missing.css");
  await fs.writeFile(file, "initial");
  let called = false;
  await assert.rejects(updateConfigFiles([file, missing], () => { called = true; return ["a", "b"]; }), { code: "ENOENT" });
  assert.equal(called, false);
  await assert.rejects(updateConfigFiles([file], async () => { throw new Error("transform denied"); }), /transform denied/);
  for (const result of [undefined, [], ["a", "b"], [42], Array(1)]) {
    await assert.rejects(updateConfigFiles([file], () => result), TypeError);
    assert.equal(await fs.readFile(file, "utf8"), "initial");
  }
  await assert.rejects(updateConfigFiles("not an array", () => []), TypeError);
  await assert.rejects(updateConfigFiles([file], null), TypeError);
  await ensureConfigFile(missing);
  await updateConfigFiles([missing, file], (contents) => {
    assert.deepEqual(contents, ["", "initial"]);
    return ["created", "recovered"];
  });
  assert.equal(await fs.readFile(file, "utf8"), "recovered");
  assert.equal(await fs.readFile(missing, "utf8"), "created");
  await updateConfigFiles([], (contents) => { assert.deepEqual(contents, []); return []; });
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
