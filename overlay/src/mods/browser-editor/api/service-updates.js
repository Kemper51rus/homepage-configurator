import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { constants as fsConstants, promises as fs } from "fs";
import path from "path";

import yaml from "js-yaml";

import {
  checkDockerTarget,
  discoverDockerTargets,
  resolveDockerTarget,
  updateDockerTarget,
} from "mods/browser-editor/api/service-update-docker";
import {
  checkLxcTarget,
  checkProxmoxNestedDockerTarget,
  discoverLxcTargets,
  resolveLxcTarget,
  updateProxmoxNestedDockerTarget,
  updateLxcTarget,
} from "mods/browser-editor/api/service-update-lxc";
import {
  normalizeServiceUpdateRegistry,
  normalizeServiceUpdateStatus,
  serviceUpdateSourcePattern,
  serviceUpdateTargetPattern,
} from "mods/browser-editor/lib/service-update-config";
import { CONF_DIR } from "utils/config/config";
import createLogger from "utils/logger";

const logger = createLogger("serviceUpdateService");
const registryFileName = "service-updates.yaml";
const defaultRunnerTimeoutMs = 30 * 1000;
const updateRunnerTimeoutMs = 30 * 60 * 1000;
const maxRunnerOutputBytes = 64 * 1024;
const statusCacheMs = 5 * 60 * 1000;
const activeChecks = new Map();
const activeUpdates = new Map();
const statusCache = new Map();

function isEditorEnabled() {
  return process.env.HOMEPAGE_BROWSER_EDITOR === "true";
}

function verifyEditorAccess(res) {
  if (!isEditorEnabled()) {
    res.status(404).end("Editor is disabled");
    return false;
  }

  return true;
}

function registryPath() {
  return (
    process.env.HOMEPAGE_SERVICE_UPDATES_CONFIG ||
    path.join(CONF_DIR, registryFileName)
  );
}

function runnersDirectory() {
  return (
    process.env.HOMEPAGE_SERVICE_UPDATE_RUNNERS_DIR ||
    path.join(CONF_DIR, "service-update-runners")
  );
}

function statusDirectory() {
  return (
    process.env.HOMEPAGE_SERVICE_UPDATE_STATUS_DIR ||
    path.join(CONF_DIR, ".service-update-status")
  );
}

async function readRegistry() {
  try {
    const raw = await fs.readFile(registryPath(), "utf8");
    return normalizeServiceUpdateRegistry(yaml.load(raw));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function targetKey(target) {
  return [target.type, target.source, target.id].filter(Boolean).join("-");
}

async function findTarget(targetId, requestedType, requestedSource) {
  if (!serviceUpdateTargetPattern.test(targetId || "")) {
    throw Object.assign(new Error("Некорректный ID цели"), { statusCode: 400 });
  }
  if (requestedSource && !serviceUpdateSourcePattern.test(requestedSource)) {
    throw Object.assign(new Error("Некорректный источник цели"), {
      statusCode: 400,
    });
  }

  if (requestedType === "docker") {
    try {
      const target = await resolveDockerTarget(requestedSource, targetId);
      return { ...target, mode: target.mode || "docker" };
    } catch (error) {
      if (requestedSource || error?.statusCode !== 404) throw error;
    }
  }

  if (requestedType === "lxc" && requestedSource) {
    return resolveLxcTarget(requestedSource, targetId);
  }

  const target = (await readRegistry()).find(
    (candidate) => candidate.id === targetId,
  );
  if (!target) {
    throw Object.assign(
      new Error(`Цель обновления не зарегистрирована: ${targetId}`),
      { statusCode: 404 },
    );
  }

  if (requestedType && target.type !== requestedType) {
    throw Object.assign(
      new Error(`Цель ${targetId} зарегистрирована как ${target.type}`),
      { statusCode: 422 },
    );
  }

  return { ...target, mode: "runner" };
}

async function resolveRunner(target) {
  const runnerRoot = await fs.realpath(runnersDirectory()).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!runnerRoot) {
    throw Object.assign(new Error("Каталог runner-файлов не настроен"), {
      statusCode: 503,
    });
  }

  const candidate = path.join(runnerRoot, target.runner);
  const runner = await fs.realpath(candidate).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const relativeRunner = runner ? path.relative(runnerRoot, runner) : "";

  if (
    !runner ||
    !relativeRunner ||
    relativeRunner.startsWith("..") ||
    path.isAbsolute(relativeRunner)
  ) {
    throw Object.assign(new Error(`Runner цели ${target.id} не найден`), {
      statusCode: 503,
    });
  }

  const stat = await fs.stat(runner);
  if (!stat.isFile()) {
    throw Object.assign(
      new Error(`Runner цели ${target.id} должен быть файлом`),
      { statusCode: 503 },
    );
  }

  await fs.access(runner, fsConstants.X_OK);
  return runner;
}

function runnerEnvironment(target) {
  return {
    LANG: process.env.LANG || "C.UTF-8",
    PATH:
      process.env.PATH ||
      "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOMEPAGE_SERVICE_UPDATE_TARGET: target.id,
    HOMEPAGE_SERVICE_UPDATE_TYPE: target.type,
  };
}

function parseRunnerOutput(stdout, target) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines]
    .reverse()
    .find((line) => line.startsWith("{") && line.endsWith("}"));

  if (!jsonLine) {
    throw new Error(`Runner цели ${target.id} не вернул JSON`);
  }

  return normalizeServiceUpdateStatus(JSON.parse(jsonLine), {
    id: target.id,
    label: target.label,
    type: target.type,
  });
}

function runRunner(target, action, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    let runner;
    try {
      runner = await resolveRunner(target);
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(runner, [action], {
      env: runnerEnvironment(target),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let killedForOutput = false;

    const appendOutput = (chunk, stream) => {
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxRunnerOutputBytes) {
        killedForOutput = true;
        child.kill("SIGTERM");
        return;
      }
      if (stream === "stdout") stdout += text;
      else stderr += text;
    };

    child.stdout.on("data", (chunk) => appendOutput(chunk, "stdout"));
    child.stderr.on("data", (chunk) => appendOutput(chunk, "stderr"));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (killedForOutput) {
        reject(new Error(`Runner цели ${target.id} превысил лимит вывода`));
        return;
      }
      if (code !== 0) {
        const details = stderr.trim().slice(-2000);
        reject(
          new Error(
            details ||
              `Runner завершился с кодом ${code ?? signal ?? "unknown"}`,
          ),
        );
        return;
      }

      try {
        resolve({
          status: parseRunnerOutput(stdout, target),
          log: `${stdout}${stderr}`.trim().slice(-10000),
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function statusPath(targetId) {
  return path.join(statusDirectory(), `${targetId}.json`);
}

async function writeStatus(targetId, status) {
  await fs.mkdir(statusDirectory(), { recursive: true });
  const targetPath = statusPath(targetId);
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await fs.writeFile(tempPath, `${JSON.stringify(status, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(tempPath, targetPath);
  } finally {
    await fs.unlink(tempPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function readStoredStatus(targetId) {
  try {
    return JSON.parse(await fs.readFile(statusPath(targetId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readCachedTargetStatus(
  targetId,
  requestedType,
  requestedSource,
) {
  if (!serviceUpdateTargetPattern.test(targetId || "")) {
    throw Object.assign(new Error("Некорректный ID цели"), { statusCode: 400 });
  }
  if (!["docker", "lxc"].includes(requestedType)) {
    throw Object.assign(new Error("Некорректный тип цели"), {
      statusCode: 400,
    });
  }
  if (requestedSource && !serviceUpdateSourcePattern.test(requestedSource)) {
    throw Object.assign(new Error("Некорректный источник цели"), {
      statusCode: 400,
    });
  }

  const target = {
    id: targetId,
    label: targetId,
    source: requestedSource || "",
    type: requestedType,
  };
  const key = targetKey(target);
  const activeUpdate = activeUpdates.get(key);
  const storedStatus = activeUpdate?.status ?? (await readStoredStatus(key));

  return normalizeServiceUpdateStatus(storedStatus, {
    ...target,
    checkedAt:
      typeof storedStatus?.checkedAt === "string"
        ? storedStatus.checkedAt.slice(0, 64)
        : "",
    label: storedStatus?.label || targetId,
  });
}

async function readCachedStatusSummaries() {
  let entries;
  try {
    entries = await fs.readdir(statusDirectory(), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }

  const statusFiles = entries
    .filter(
      (entry) =>
        entry.isFile() && /^[a-z0-9._-]{1,200}\.json$/i.test(entry.name),
    )
    .slice(0, 512);
  const statuses = {};

  await Promise.all(
    statusFiles.map(async (entry) => {
      const key = entry.name.slice(0, -5);
      const storedStatus = await readStoredStatus(key);
      if (!storedStatus) return;

      const normalized = normalizeServiceUpdateStatus(storedStatus, {
        checkedAt:
          typeof storedStatus.checkedAt === "string"
            ? storedStatus.checkedAt.slice(0, 64)
            : "",
        id:
          typeof storedStatus.id === "string"
            ? storedStatus.id.slice(0, 64)
            : "",
        label:
          typeof storedStatus.label === "string"
            ? storedStatus.label.slice(0, 120)
            : "",
        source:
          typeof storedStatus.source === "string"
            ? storedStatus.source.slice(0, 64)
            : "",
        type: storedStatus.type === "lxc" ? "lxc" : "docker",
      });
      statuses[key] = {
        checkedAt: normalized.checkedAt,
        configured: normalized.configured,
        currentVersion: normalized.currentVersion,
        id: normalized.id,
        label: normalized.label,
        latestVersion: normalized.latestVersion,
        message: normalized.message,
        source: normalized.source,
        state: normalized.state,
        type: normalized.type,
        updateAvailable: normalized.updateAvailable,
      };
    }),
  );

  return statuses;
}

async function unavailableStatus(target, error, key = target.id) {
  const storedStatus = await readStoredStatus(key);
  return normalizeServiceUpdateStatus(
    {
      ...storedStatus,
      configured: false,
      message: error.message,
      state: "unavailable",
      updateAvailable: false,
    },
    {
      checkedAt: new Date().toISOString(),
      id: target.id,
      label: target.label,
      type: target.type,
    },
  );
}

async function performTargetCheck(target, key) {
  try {
    let rawStatus;
    if (target.mode === "docker") {
      rawStatus = await checkDockerTarget(target);
    } else if (target.mode === "proxmox-docker") {
      rawStatus = await checkProxmoxNestedDockerTarget(target);
    } else if (target.mode === "lxc") {
      rawStatus = await checkLxcTarget(target);
    } else {
      rawStatus = (await runRunner(target, "check", defaultRunnerTimeoutMs))
        .status;
    }
    const status = normalizeServiceUpdateStatus(rawStatus, {
      id: target.id,
      label: target.label,
      source: target.source,
      type: target.type,
    });
    const nextStatus = {
      ...status,
      checkedAt: new Date().toISOString(),
    };
    statusCache.set(key, { cachedAt: Date.now(), status: nextStatus });
    await writeStatus(key, nextStatus);
    return nextStatus;
  } catch (error) {
    const status = await unavailableStatus(target, error, key);
    statusCache.set(key, { cachedAt: Date.now(), status });
    return status;
  }
}

async function checkTarget(target, force = false) {
  const key = targetKey(target);
  const activeUpdate = activeUpdates.get(key);
  if (activeUpdate) {
    return activeUpdate.status;
  }

  const cached = statusCache.get(key);
  if (!force && cached && Date.now() - cached.cachedAt < statusCacheMs) {
    return cached.status;
  }

  const activeCheck = activeChecks.get(key);
  if (activeCheck) return activeCheck;

  const check = performTargetCheck(target, key);
  activeChecks.set(key, check);

  try {
    return await check;
  } finally {
    if (activeChecks.get(key) === check) {
      activeChecks.delete(key);
    }
  }
}

async function startUpdate(target) {
  const key = targetKey(target);
  if (activeUpdates.has(key)) {
    throw Object.assign(
      new Error(`Обновление ${target.label} уже выполняется`),
      { statusCode: 409 },
    );
  }

  const activeCheck = activeChecks.get(key);
  if (activeCheck) await activeCheck;
  if (activeUpdates.has(key)) {
    throw Object.assign(
      new Error(`Обновление ${target.label} уже выполняется`),
      { statusCode: 409 },
    );
  }

  if (target.mode === "runner") await resolveRunner(target);
  const startedAt = new Date().toISOString();
  const runningStatus = normalizeServiceUpdateStatus(
    {
      configured: true,
      message: "Обновление запущено",
      state: "running",
      updateAvailable: true,
    },
    {
      id: target.id,
      label: target.label,
      source: target.source,
      startedAt,
      type: target.type,
    },
  );
  activeUpdates.set(key, { status: runningStatus });
  statusCache.delete(key);
  await writeStatus(key, runningStatus);

  (target.mode === "docker"
    ? updateDockerTarget(target).then((status) => ({ log: "", status }))
    : target.mode === "proxmox-docker"
      ? updateProxmoxNestedDockerTarget(target)
      : target.mode === "lxc"
        ? updateLxcTarget(target)
        : runRunner(target, "update", updateRunnerTimeoutMs)
  )
    .then(async ({ status, log }) => {
      const finishedStatus = {
        ...status,
        finishedAt: new Date().toISOString(),
        log,
        startedAt,
        state: status.state === "error" ? "error" : "success",
        updateAvailable: status.state === "error",
      };
      await writeStatus(key, finishedStatus);
      statusCache.set(key, { cachedAt: Date.now(), status: finishedStatus });
    })
    .catch(async (error) => {
      const failedStatus = normalizeServiceUpdateStatus(
        {
          configured: true,
          message: error.message,
          state: "error",
          updateAvailable: true,
        },
        {
          finishedAt: new Date().toISOString(),
          id: target.id,
          label: target.label,
          source: target.source,
          startedAt,
          type: target.type,
        },
      );
      await writeStatus(key, failedStatus);
      statusCache.set(key, { cachedAt: Date.now(), status: failedStatus });
    })
    .finally(() => {
      activeUpdates.delete(key);
    });

  return runningStatus;
}

export default async function handler(req, res) {
  if (!verifyEditorAccess(res)) {
    return undefined;
  }

  try {
    if (
      req.method === "GET" &&
      req.query.cached === "true" &&
      !req.query.target
    ) {
      return res
        .status(200)
        .json({ statuses: await readCachedStatusSummaries() });
    }

    if (req.method === "GET" && !req.query.target) {
      const [registeredTargets, dockerDiscovery, lxcDiscovery] =
        await Promise.all([
          readRegistry(),
          discoverDockerTargets(),
          discoverLxcTargets(),
        ]);
      const targets = [
        ...registeredTargets.map(({ id, label, type }) => ({
          available: true,
          id,
          label,
          source: "",
          type,
        })),
        ...dockerDiscovery.targets,
        ...lxcDiscovery.targets,
      ];
      return res.status(200).json({
        configured: targets.some((target) => target.available !== false),
        registryFile: registryFileName,
        sourceErrors: [
          ...dockerDiscovery.sourceErrors,
          ...lxcDiscovery.sourceErrors,
        ],
        targets,
      });
    }

    const targetId = Array.isArray(req.query.target)
      ? req.query.target[0]
      : req.query.target;
    const requestedType = Array.isArray(req.query.type)
      ? req.query.type[0]
      : req.query.type;
    const requestedSource = Array.isArray(req.query.source)
      ? req.query.source[0]
      : req.query.source;

    if (req.method === "GET" && req.query.cached === "true") {
      return res
        .status(200)
        .json(
          await readCachedTargetStatus(
            targetId,
            requestedType,
            requestedSource,
          ),
        );
    }

    const target = await findTarget(targetId, requestedType, requestedSource);

    if (req.method === "GET") {
      return res
        .status(200)
        .json(await checkTarget(target, req.query.force === "true"));
    }

    if (req.method === "POST") {
      return res.status(202).json(await startUpdate(target));
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).end("Method Not Allowed");
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) {
      logger.error(error);
    }
    return res
      .status(error.statusCode || 500)
      .end(error.message || "Internal Server Error");
  }
}
