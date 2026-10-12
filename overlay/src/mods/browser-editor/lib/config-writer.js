import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const pendingWrites = new Map();

// Share a queue between full replacements and read/modify/write operations.
// Resolve symlinks so writes retain the existing config-file link and its target.
async function withConfigLock(filePath, operation) {
  let target = path.resolve(filePath);
  try {
    target = await fs.realpath(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const previous = pendingWrites.get(target) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => operation(target));
  pendingWrites.set(target, current);
  try {
    return await current;
  } finally {
    if (pendingWrites.get(target) === current) pendingWrites.delete(target);
  }
}

async function replaceConfigFile(target, content, createOnly = false) {
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
