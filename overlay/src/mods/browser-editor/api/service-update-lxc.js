import { spawn } from "child_process";
import { promises as fs } from "fs";
import { isIP } from "net";
import path from "path";

import {
  serviceUpdateSourcePattern,
  serviceUpdateTargetPattern,
} from "mods/browser-editor/lib/service-update-config";
import { CONF_DIR } from "utils/config/config";
import { getProxmoxConfig } from "utils/config/proxmox";
import { httpProxy } from "utils/proxy/http";

const executorDirectoryName = "service-update-proxmox";
const executorCheckTimeoutMs = 3 * 60 * 1000;
const executorDiscoveryTimeoutMs = 3 * 60 * 1000;
const executorUpdateTimeoutMs = 30 * 60 * 1000;
const maxExecutorOutputBytes = 64 * 1024;
const discoveryCacheMs = 60 * 1000;
let nestedDockerDiscoveryCache;
let lxcDiscoveryCache;

function proxmoxSources() {
  const config = getProxmoxConfig() || {};
  if (config.url && config.token && config.secret) {
    return [{ config, id: "proxmox" }];
  }

  return Object.entries(config)
    .filter(
      ([id, source]) =>
        serviceUpdateSourcePattern.test(id) &&
        source?.url &&
        source?.token &&
        source?.secret,
    )
    .map(([id, source]) => ({ config: source, id }));
}

function executorDirectory() {
  return (
    process.env.HOMEPAGE_PROXMOX_UPDATE_EXECUTOR_DIR ||
    path.join(CONF_DIR, executorDirectoryName)
  );
}

function executorPaths() {
  const directory = executorDirectory();
  return {
    key: path.join(directory, "id_ed25519"),
    knownHosts: path.join(directory, "known_hosts"),
  };
}

async function executorConfigured() {
  const paths = executorPaths();
  try {
    const [keyStat, knownHostsStat] = await Promise.all([
      fs.stat(paths.key),
      fs.stat(paths.knownHosts),
    ]);
    return keyStat.isFile() && knownHostsStat.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function discoverSource(source) {
  const [items, hasExecutor] = await Promise.all([
    sourceResources(source),
    executorConfigured(),
  ]);

  return items
    .filter((item) => item?.type === "lxc")
    .map((item) => {
      const node = String(item.node || "").slice(0, 64);
      const vmid = String(item.vmid || "").slice(0, 20);
      const id = `${node}-${vmid}`;
      if (!serviceUpdateTargetPattern.test(id)) return null;

      return {
        available: hasExecutor && item.status === "running",
        id,
        label: `${String(item.name || `LXC ${vmid}`).slice(0, 100)} · ${node}/${vmid}`,
        node,
        reason: hasExecutor
          ? item.status === "running"
            ? ""
            : "LXC остановлен"
          : "Не настроен ограниченный исполнитель команд на узле Proxmox",
        source: source.id,
        state: String(item.status || "unknown").slice(0, 40),
        type: "lxc",
        vmid,
      };
    })
    .filter(Boolean);
}

async function proxmoxRequest(source, apiPath) {
  const endpoint = `${String(source.config.url).replace(/\/+$/, "")}/api2/json${apiPath}`;
  const [status, , data] = await httpProxy(endpoint, {
    headers: {
      Authorization: `PVEAPIToken=${source.config.token}=${source.config.secret}`,
    },
    method: "GET",
  });

  if (status !== 200) {
    throw new Error(`Proxmox ${source.id} вернул HTTP ${status}`);
  }

  return JSON.parse(Buffer.from(data).toString())?.data;
}

async function sourceResources(source) {
  const data = await proxmoxRequest(source, "/cluster/resources?type=vm");
  return Array.isArray(data) ? data : [];
}

function privateIpv4(value) {
  const address = String(value || "").split("/")[0];
  if (isIP(address) !== 4) return "";

  const octets = address.split(".").map(Number);
  const privateAddress =
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
  return privateAddress ? address : "";
}

function dockerHostFromInterfaces(interfaces) {
  if (
    !Array.isArray(interfaces) ||
    !interfaces.some((entry) => entry?.name === "docker0")
  ) {
    return "";
  }

  const primaryInterface = interfaces.find(
    (entry) =>
      /^(?:eth|en|bond)\w+$/i.test(String(entry?.name || "")) &&
      privateIpv4(entry?.inet),
  );
  return privateIpv4(primaryInterface?.inet);
}

function automaticDockerSourceId(source, node, vmid) {
  const safeSource = String(source)
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .slice(0, 20);
  const safeNode = String(node)
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .slice(0, 20);
  return `pve-${safeSource}-${safeNode}-${vmid}`;
}

async function discoverSourceDockerCandidates(source) {
  const resources = await sourceResources(source);
  const lxcs = resources.filter(
    (item) => item?.type === "lxc" && item?.status === "running",
  );
  const results = await Promise.allSettled(
    lxcs.map(async (item) => {
      const node = String(item.node || "");
      const vmid = String(item.vmid || "");
      if (!serviceUpdateTargetPattern.test(node) || !/^\d{1,9}$/.test(vmid)) {
        return null;
      }

      const interfaces = await proxmoxRequest(
        source,
        `/nodes/${encodeURIComponent(node)}/lxc/${encodeURIComponent(vmid)}/interfaces`,
      );
      const host = dockerHostFromInterfaces(interfaces);
      if (!host) return null;

      const id = automaticDockerSourceId(source.id, node, vmid);
      if (!serviceUpdateSourcePattern.test(id)) return null;

      return {
        config: { host, port: 2375 },
        id,
        label: String(item.name || `LXC ${vmid}`).slice(0, 100),
        mode: "proxmox",
        node,
        proxmoxSourceId: source.id,
        vmid,
      };
    }),
  );

  return results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
}

export async function discoverProxmoxDockerCandidates() {
  const results = await Promise.allSettled(
    proxmoxSources().map(discoverSourceDockerCandidates),
  );
  return results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);
}

function executorConnection(source) {
  const configuredHost =
    source.config.serviceUpdateHost ||
    process.env.HOMEPAGE_PROXMOX_UPDATE_SSH_HOST;
  const host = String(
    configuredHost || new URL(source.config.url).hostname,
  ).trim();
  const port = Number(
    source.config.serviceUpdatePort ||
      process.env.HOMEPAGE_PROXMOX_UPDATE_SSH_PORT ||
      22,
  );
  const user = String(
    source.config.serviceUpdateUser ||
      process.env.HOMEPAGE_PROXMOX_UPDATE_SSH_USER ||
      "root",
  ).trim();

  if (!host || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(
      new Error(`Некорректные параметры исполнителя Proxmox ${source.id}`),
      { statusCode: 422 },
    );
  }

  return { host, port, user };
}

function parseExecutorStatus(stdout, target) {
  const jsonLine = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error(`Исполнитель LXC ${target.id} не вернул статус`);
  }
  return JSON.parse(jsonLine);
}

function runProxmoxExecutor(source, args, targetLabel, timeoutMs) {
  return new Promise((resolve, reject) => {
    const paths = executorPaths();
    const connection = executorConnection(source);
    const child = spawn(
      "ssh",
      [
        "-i",
        paths.key,
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${paths.knownHosts}`,
        "-o",
        "ConnectTimeout=10",
        "-p",
        String(connection.port),
        `${connection.user}@${connection.host}`,
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let killedForOutput = false;

    const appendOutput = (chunk, stream) => {
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxExecutorOutputBytes) {
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
        reject(new Error(`Исполнитель ${targetLabel} превысил лимит вывода`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim().slice(-2000) ||
              `Исполнитель ${targetLabel} завершился с кодом ${code ?? signal ?? "unknown"}`,
          ),
        );
        return;
      }

      resolve({
        log: `${stdout}${stderr}`.trim().slice(-10000),
        stderr,
        stdout,
      });
    });
  });
}

async function runLxcExecutor(target, action, timeoutMs) {
  const result = await runProxmoxExecutor(
    target.proxmoxSource,
    [action, target.node, target.vmid],
    `LXC ${target.id}`,
    timeoutMs,
  );
  return { ...result, status: parseExecutorStatus(result.stdout, target) };
}

function safeSourceSegment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "-")
    .slice(0, 20);
}

function nestedDockerSourceId(source, node, vmid) {
  return `pve-lxc-${safeSourceSegment(source)}-${safeSourceSegment(node)}-${vmid}`;
}

function parseNestedDockerDiscovery(stdout, source, requestedNode) {
  const targets = [];
  String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .forEach((line) => {
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        return;
      }

      const id = String(item?.id || "").slice(0, 128);
      const node = String(item?.node || "").slice(0, 64);
      const vmid = String(item?.vmid || "").slice(0, 20);
      if (
        item?.kind !== "docker" ||
        node !== requestedNode ||
        !serviceUpdateTargetPattern.test(id) ||
        !serviceUpdateTargetPattern.test(node) ||
        !/^\d{1,9}$/.test(vmid)
      ) {
        return;
      }

      const sourceId = nestedDockerSourceId(source.id, node, vmid);
      if (!serviceUpdateSourcePattern.test(sourceId)) return;
      const lxcLabel = String(item.lxcLabel || `LXC ${vmid}`).slice(0, 100);
      targets.push({
        available: true,
        id,
        image: String(item.image || "").slice(0, 300),
        label: `${id} · ${lxcLabel} (${node}/${vmid})`,
        node,
        proxmoxSourceId: source.id,
        source: sourceId,
        state: String(item.state || "unknown").slice(0, 40),
        type: "docker",
        vmid,
      });
    });
  return targets;
}

async function discoverSourceNestedDocker(source) {
  if (!(await executorConfigured())) {
    throw new Error("Ограниченный исполнитель обновлений Proxmox не настроен");
  }
  const resources = await sourceResources(source);
  const nodes = [
    ...new Set(
      resources
        .filter((item) => item?.type === "lxc" && item?.status === "running")
        .map((item) => String(item.node || ""))
        .filter((node) => serviceUpdateTargetPattern.test(node)),
    ),
  ];
  const results = await Promise.allSettled(
    nodes.map(async (node) => {
      const result = await runProxmoxExecutor(
        source,
        ["docker-discover", node],
        `обнаружения Docker на ${node}`,
        executorDiscoveryTimeoutMs,
      );
      return parseNestedDockerDiscovery(result.stdout, source, node);
    }),
  );
  const targets = [];
  const sourceErrors = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") targets.push(...result.value);
    else {
      sourceErrors.push({
        message: String(
          result.reason?.message || "Ошибка обнаружения Docker",
        ).slice(0, 300),
        source: `${source.id}:${nodes[index]}`,
        type: "docker",
      });
    }
  });
  return { sourceErrors, targets };
}

async function discoverProxmoxNestedDockerTargetsUncached() {
  const sources = proxmoxSources();
  const results = await Promise.allSettled(
    sources.map(discoverSourceNestedDocker),
  );
  const targets = [];
  const sourceErrors = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      targets.push(...result.value.targets);
      sourceErrors.push(...result.value.sourceErrors);
    } else {
      sourceErrors.push({
        message: String(
          result.reason?.message || "Ошибка обнаружения Docker",
        ).slice(0, 300),
        source: sources[index].id,
        type: "docker",
      });
    }
  });
  return { sourceErrors, targets };
}

export async function discoverProxmoxNestedDockerTargets() {
  const now = Date.now();
  if (nestedDockerDiscoveryCache?.expiresAt > now) {
    return nestedDockerDiscoveryCache.promise;
  }

  const promise = discoverProxmoxNestedDockerTargetsUncached();
  nestedDockerDiscoveryCache = {
    expiresAt: now + discoveryCacheMs,
    promise,
  };
  try {
    return await promise;
  } catch (error) {
    if (nestedDockerDiscoveryCache?.promise === promise) {
      nestedDockerDiscoveryCache = undefined;
    }
    throw error;
  }
}

export async function resolveProxmoxNestedDockerTarget(sourceId, targetId) {
  if (
    !serviceUpdateSourcePattern.test(sourceId || "") ||
    !serviceUpdateTargetPattern.test(targetId || "")
  ) {
    throw Object.assign(new Error("Некорректная Docker-цель Proxmox"), {
      statusCode: 400,
    });
  }
  const discovery = await discoverProxmoxNestedDockerTargets();
  const target = discovery.targets.find(
    (candidate) => candidate.source === sourceId && candidate.id === targetId,
  );
  if (!target) {
    throw Object.assign(
      new Error(`Docker-контейнер ${targetId} не найден внутри LXC`),
      { statusCode: 404 },
    );
  }
  const proxmoxSource = proxmoxSources().find(
    (source) => source.id === target.proxmoxSourceId,
  );
  if (!proxmoxSource) {
    throw Object.assign(new Error("Подключение Proxmox не найдено"), {
      statusCode: 404,
    });
  }
  return { ...target, mode: "proxmox-docker", proxmoxSource };
}

async function runProxmoxDockerExecutor(target, action, timeoutMs) {
  const result = await runProxmoxExecutor(
    target.proxmoxSource,
    [action, target.node, target.vmid, target.id],
    `Docker ${target.id} внутри LXC ${target.vmid}`,
    timeoutMs,
  );
  return { ...result, status: parseExecutorStatus(result.stdout, target) };
}

export async function checkProxmoxNestedDockerTarget(target) {
  return (
    await runProxmoxDockerExecutor(
      target,
      "docker-check",
      executorCheckTimeoutMs,
    )
  ).status;
}

export async function updateProxmoxNestedDockerTarget(target) {
  return runProxmoxDockerExecutor(
    target,
    "docker-update",
    executorUpdateTimeoutMs,
  );
}

export async function resolveLxcTarget(sourceId, targetId) {
  if (!serviceUpdateSourcePattern.test(sourceId || "")) {
    throw Object.assign(new Error("Некорректный источник Proxmox"), {
      statusCode: 400,
    });
  }
  if (!serviceUpdateTargetPattern.test(targetId || "")) {
    throw Object.assign(new Error("Некорректный LXC"), { statusCode: 400 });
  }

  const source = proxmoxSources().find(
    (candidate) => candidate.id === sourceId,
  );
  if (!source) {
    throw Object.assign(
      new Error(`Подключение Proxmox ${sourceId} не найдено`),
      { statusCode: 404 },
    );
  }

  const item = (await sourceResources(source)).find(
    (candidate) =>
      candidate?.type === "lxc" &&
      `${String(candidate.node || "")}-${String(candidate.vmid || "")}` ===
        targetId,
  );
  if (!item) {
    throw Object.assign(new Error(`LXC не найден: ${targetId}`), {
      statusCode: 404,
    });
  }
  if (item.status !== "running") {
    throw Object.assign(new Error(`LXC ${targetId} не запущен`), {
      statusCode: 409,
    });
  }
  if (!(await executorConfigured())) {
    throw Object.assign(
      new Error("Ограниченный исполнитель обновлений Proxmox не настроен"),
      { statusCode: 503 },
    );
  }

  return {
    available: true,
    id: targetId,
    label: String(item.name || `LXC ${item.vmid}`).slice(0, 100),
    mode: "lxc",
    node: String(item.node),
    proxmoxSource: source,
    source: source.id,
    type: "lxc",
    vmid: String(item.vmid),
  };
}

export async function checkLxcTarget(target) {
  return (await runLxcExecutor(target, "check", executorCheckTimeoutMs)).status;
}

export async function updateLxcTarget(target) {
  return runLxcExecutor(target, "update", executorUpdateTimeoutMs);
}

async function discoverLxcTargetsUncached() {
  const sources = proxmoxSources();
  const results = await Promise.allSettled(sources.map(discoverSource));
  const targets = [];
  const sourceErrors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      targets.push(...result.value);
    } else {
      sourceErrors.push({
        message: String(result.reason?.message || "Ошибка подключения").slice(
          0,
          300,
        ),
        source: sources[index].id,
        type: "lxc",
      });
    }
  });

  return { sourceErrors, targets };
}

export async function discoverLxcTargets() {
  const now = Date.now();
  if (lxcDiscoveryCache?.expiresAt > now) {
    return lxcDiscoveryCache.promise;
  }

  const promise = discoverLxcTargetsUncached();
  lxcDiscoveryCache = {
    expiresAt: now + discoveryCacheMs,
    promise,
  };
  try {
    return await promise;
  } catch (error) {
    if (lxcDiscoveryCache?.promise === promise) {
      lxcDiscoveryCache = undefined;
    }
    throw error;
  }
}
