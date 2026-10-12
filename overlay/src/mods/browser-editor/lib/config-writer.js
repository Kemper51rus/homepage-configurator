import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const pendingWrites = new Map();

// Resolve symlinks so writes retain the existing config-file link and its target.
async function resolveConfigTarget(filePath) {
  const target = path.resolve(filePath);
  try {
    return await fs.realpath(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return target;
  }
}

// All operations share these queues. Compound operations acquire unique targets
// in a global order, so overlapping sets (even supplied in reverse) cannot deadlock.
async function withTargetLock(target, operation) {
  const previous = pendingWrites.get(target) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => operation(target));
  pendingWrites.set(target, current);
  try {
    return await current;
  } finally {
    if (pendingWrites.get(target) === current) pendingWrites.delete(target);
  }
}

async function withConfigLocks(filePaths, operation) {
  const targets = await Promise.all(filePaths.map(resolveConfigTarget));
  const ordered = [...new Set(targets)].sort();
  const acquire = (index) => index === ordered.length
    ? operation(targets)
    : withTargetLock(ordered[index], () => acquire(index + 1));
  return acquire(0);
}

function withConfigLock(filePath, operation) {
  return withConfigLocks([filePath], ([target]) => operation(target));
}

async function replaceConfigFile(target, content, createOnly = false, onReplace) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  let mode;
  try {
    mode = (await fs.stat(target)).mode & 0o777;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // A same-directory rename exposes either complete version, never an empty or
  // partially written destination. Exclusive creation also avoids temp collisions.
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, "wx", mode ?? 0o666);
    if (mode !== undefined) await handle.chmod(mode);
    await handle.writeFile(content, "utf8");
    await handle.close();
    handle = null;
    if (createOnly) {
      // Do not clobber a file created by another process after the access check.
      try {
        await fs.link(temporary, target);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } else {
      await fs.rename(temporary, target);
      onReplace?.();
    }
  } finally {
    if (handle) await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

export function writeConfigFile(filePath, content) {
  return withConfigLock(filePath, (target) => replaceConfigFile(target, content));
}

export function updateConfigFile(filePath, transform) {
  return withConfigLock(filePath, async (target) => {
    let content;
    try {
      content = await fs.readFile(target, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      content = "";
    }
    await replaceConfigFile(target, await transform(content));
  });
}

/**
 * Transform current UTF-8 snapshots in input order under all shared file locks.
 * Missing files are errors. Repeated targets are allowed; the last value wins.
 * Each replacement is atomic, but the set is not: external readers/processes
 * can observe intermediate versions. Failed writes trigger best-effort rollback.
 */
export function updateConfigFiles(filePaths, transform) {
  if (!Array.isArray(filePaths) || typeof transform !== "function") {
    return Promise.reject(new TypeError("Expected filePaths array and transform function"));
  }
  return withConfigLocks(filePaths, async (targets) => {
    const snapshots = await Promise.all(targets.map((target) => fs.readFile(target, "utf8")));
    // Keep private snapshots intact even if the transform mutates its input array.
    const contents = await transform([...snapshots]);
    if (!Array.isArray(contents) || contents.length !== targets.length
      || Array.from(contents).some((content) => typeof content !== "string")) {
      throw new TypeError("transform must return an array of strings matching filePaths length");
    }
    const replaced = [];
    try {
      for (let index = 0; index < targets.length; index += 1) {
        await replaceConfigFile(targets[index], contents[index], false, () => replaced.push(index));
      }
    } catch (error) {
      const rollbackFailures = [];
      for (const index of replaced.reverse()) {
        try {
          await replaceConfigFile(targets[index], snapshots[index]);
        } catch (rollbackError) {
          rollbackFailures.push({ filePath: targets[index], error: rollbackError });
        }
      }
      if (rollbackFailures.length) {
        const failure = new AggregateError(
          [error, ...rollbackFailures.map(({ error: rollbackError }) => rollbackError)],
          `Config update failed; rollback failed for: ${rollbackFailures.map(({ filePath }) => filePath).join(", ")}`,
          { cause: error },
        );
        failure.rollbackFailures = rollbackFailures;
        throw failure;
      }
      throw error;
    }
  });
}

export function ensureConfigFile(filePath) {
  return withConfigLock(filePath, async (target) => {
    try {
      await fs.access(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await replaceConfigFile(target, "", true);
    }
  });
}
