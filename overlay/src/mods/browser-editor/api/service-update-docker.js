import { promises as fs } from "fs";
import path from "path";

import Docker from "dockerode";
import yaml from "js-yaml";

import {
  discoverProxmoxDockerCandidates,
  discoverProxmoxNestedDockerTargets,
  resolveProxmoxNestedDockerTarget,
} from "mods/browser-editor/api/service-update-lxc";
import {
  serviceUpdateSourcePattern,
  serviceUpdateTargetPattern,
} from "mods/browser-editor/lib/service-update-config";
import getDockerArguments from "utils/config/docker";
import { CONF_DIR, substituteEnvironmentVars } from "utils/config/config";

const dockerConfigFileName = "docker.yaml";
const updaterSourcesFileName = "service-update-sources.yaml";
const dockerOperationTimeoutMs = 2 * 60 * 1000;
const dockerPullAttempts = 3;
const containerHealthTimeoutMs = 90 * 1000;
const activeImagePulls = new Map();
const sourcePullQueues = new Map();
let proxmoxDockerSourcesCache;

function apiError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

async function readYamlConfig(fileName) {
  try {
    const raw = substituteEnvironmentVars(
      await fs.readFile(path.join(CONF_DIR, fileName), "utf8"),
    );
    const config = yaml.load(raw);
    return config && typeof config === "object" && !Array.isArray(config)
      ? config
      : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function configuredDockerSources() {
  const [homepageDocker, updaterSources, proxmoxDocker] = await Promise.all([
    readYamlConfig(dockerConfigFileName),
    readYamlConfig(updaterSourcesFileName),
    availableProxmoxDockerSources(),
  ]);
  const managedDocker =
    updaterSources.docker &&
    typeof updaterSources.docker === "object" &&
    !Array.isArray(updaterSources.docker)
      ? updaterSources.docker
      : {};
  const sources = new Map();

  Object.keys(homepageDocker)
    .filter((source) => serviceUpdateSourcePattern.test(source))
    .forEach((source) =>
      sources.set(source, {
        config: homepageDocker[source],
        id: source,
        mode: "homepage",
      }),
    );
  Object.entries(managedDocker)
    .filter(
      ([source, config]) =>
        serviceUpdateSourcePattern.test(source) &&
        config &&
        typeof config === "object",
    )
    .forEach(([source, config]) =>
      sources.set(source, { config, id: source, mode: "managed" }),
    );
  const configuredHosts = new Set(
    [...sources.values()]
      .map((source) => source.config)
      .filter((config) => config?.host)
      .map((config) => `${config.host}:${Number(config.port || 2375)}`),
  );
  proxmoxDocker
    .filter(
      (source) =>
        !configuredHosts.has(`${source.config.host}:${source.config.port}`),
    )
    .forEach((source) => sources.set(source.id, source));

  const proxmoxSourcesByEndpoint = new Map(
    proxmoxDocker.map((source) => [
      `${source.config.host}:${source.config.port}`,
      source,
    ]),
  );
  sources.forEach((source, sourceId) => {
    if (!source.config?.host) return;
    const match = proxmoxSourcesByEndpoint.get(
      `${source.config.host}:${Number(source.config.port || 2375)}`,
    );
    if (!match) return;
    sources.set(sourceId, {
      ...source,
      node: match.node,
      proxmoxSourceId: match.proxmoxSourceId,
      vmid: match.vmid,
    });
  });

  return [...sources.values()];
}

async function availableProxmoxDockerSources() {
  const now = Date.now();
  if (proxmoxDockerSourcesCache?.expiresAt > now) {
    return proxmoxDockerSourcesCache.promise;
  }

  const promise = discoverProxmoxDockerCandidates().then(async (candidates) => {
    const results = await Promise.allSettled(
      candidates.map(async (candidate) => {
        const docker = new Docker({
          ...managedDockerConnection(candidate.id, candidate.config),
          timeout: 3000,
        });
        await docker.ping();
        return candidate;
      }),
    );
    return results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
  });
  proxmoxDockerSourcesCache = {
    expiresAt: now + 5 * 60 * 1000,
    promise,
  };

  try {
    return await promise;
  } catch (error) {
    if (proxmoxDockerSourcesCache?.promise === promise) {
      proxmoxDockerSourcesCache = undefined;
    }
    throw error;
  }
}

function managedDockerConnection(source, config) {
  if (config.socket) {
    if (typeof config.socket !== "string" || !path.isAbsolute(config.socket)) {
      throw apiError(
        `Docker-подключение ${source}: socket должен быть абсолютным путём`,
        422,
      );
    }
    return { socketPath: config.socket };
  }

  if (!config.host || typeof config.host !== "string") {
    throw apiError(
      `Docker-подключение ${source}: укажите host или socket`,
      422,
    );
  }
  const port = Number(config.port || 2375);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw apiError(`Docker-подключение ${source}: некорректный port`, 422);
  }

  return {
    host: config.host,
    port,
    ...(config.protocol === "https" ? { protocol: "https" } : {}),
    ...(config.headers && typeof config.headers === "object"
      ? { headers: config.headers }
      : {}),
  };
}

async function dockerForSource(source) {
  if (!serviceUpdateSourcePattern.test(source || "")) {
    throw apiError("Некорректный источник Docker", 400);
  }

  const sourceDefinition = (await configuredDockerSources()).find(
    (candidate) => candidate.id === source,
  );
  if (!sourceDefinition) {
    throw apiError(`Docker-подключение ${source} не найдено`, 404);
  }
  if (
    sourceDefinition.mode === "managed" ||
    sourceDefinition.mode === "proxmox"
  ) {
    return {
      docker: new Docker(
        managedDockerConnection(source, sourceDefinition.config),
      ),
      sourceDefinition,
    };
  }

  const dockerArgs = getDockerArguments(source);
  if (!dockerArgs?.conn || dockerArgs.swarm) {
    throw apiError(
      `Docker-подключение ${source} не найдено или использует неподдерживаемый Swarm`,
      404,
    );
  }

  return { docker: new Docker(dockerArgs.conn), sourceDefinition };
}

function containerName(container) {
  return container.Names?.map((name) => name.replace(/^\//, "")).find((name) =>
    serviceUpdateTargetPattern.test(name),
  );
}

function publicDockerTarget(source, container, sourceDefinition = {}) {
  const id = containerName(container);
  const image =
    container.homepageImageReference ||
    container.Labels?.["com.docker.compose.image"] ||
    container.Image;
  return {
    available: true,
    id,
    image: String(image || "").slice(0, 300),
    label: id,
    ...(sourceDefinition.node ? { node: sourceDefinition.node } : {}),
    ...(sourceDefinition.proxmoxSourceId
      ? { proxmoxSourceId: sourceDefinition.proxmoxSourceId }
      : {}),
    source,
    state: String(container.State || "unknown").slice(0, 40),
    type: "docker",
    ...(sourceDefinition.vmid ? { vmid: String(sourceDefinition.vmid) } : {}),
  };
}

async function listSourceContainers(source) {
  const { docker, sourceDefinition } = await dockerForSource(source);
  const containers = await docker.listContainers({ all: true });
  if (!Array.isArray(containers)) {
    throw apiError(
      `Docker-подключение ${source} вернуло некорректный ответ`,
      502,
    );
  }

  const supportedContainers = containers.filter(containerName);
  const enrichedContainers = await Promise.all(
    supportedContainers.map(async (container) => {
      const info = await docker.getContainer(container.Id).inspect();
      return {
        ...container,
        homepageImageReference: String(info.Config?.Image || "").slice(0, 300),
      };
    }),
  );

  return {
    containers: enrichedContainers,
    docker,
    sourceDefinition,
  };
}

export async function discoverDockerTargets() {
  const [sourceDefinitions, nestedDiscovery] = await Promise.all([
    configuredDockerSources(),
    discoverProxmoxNestedDockerTargets(),
  ]);
  const sources = sourceDefinitions.map((source) => source.id);
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const { containers, sourceDefinition } =
        await listSourceContainers(source);
      return containers.map((container) =>
        publicDockerTarget(source, container, sourceDefinition),
      );
    }),
  );

  const targets = [...nestedDiscovery.targets];
  const sourceErrors = [...nestedDiscovery.sourceErrors];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      targets.push(...result.value);
    } else {
      sourceErrors.push({
        message: String(result.reason?.message || "Ошибка подключения").slice(
          0,
          300,
        ),
        source: sources[index],
        type: "docker",
      });
    }
  });

  const preferredTargets = new Map();
  targets.forEach((target) => {
    const location =
      target.node && target.vmid
        ? `${target.proxmoxSourceId || "proxmox"}:${target.node}:${target.vmid}:${target.id}`
        : `${target.source}:${target.id}`;
    const existing = preferredTargets.get(location);
    if (!existing || existing.source.startsWith("pve-lxc-")) {
      preferredTargets.set(location, target);
    }
  });

  return { sourceErrors, targets: [...preferredTargets.values()] };
}

export async function resolveDockerTarget(source, targetId) {
  if (!serviceUpdateTargetPattern.test(targetId || "")) {
    throw apiError("Некорректный контейнер Docker", 400);
  }

  const configuredSources = await configuredDockerSources();
  if (
    source &&
    !configuredSources.some((candidate) => candidate.id === source)
  ) {
    return resolveProxmoxNestedDockerTarget(source, targetId);
  }
  const sources = source
    ? [source]
    : configuredSources.map((candidate) => candidate.id);
  const matches = [];

  for (const sourceId of sources) {
    try {
      const { containers, docker, sourceDefinition } =
        await listSourceContainers(sourceId);
      const container = containers.find(
        (candidate) => containerName(candidate) === targetId,
      );
      if (container) {
        matches.push({
          container,
          docker,
          source: sourceId,
          sourceDefinition,
        });
      }
    } catch (error) {
      if (source) throw error;
    }
  }

  if (!source) {
    const nestedMatches = (
      await discoverProxmoxNestedDockerTargets()
    ).targets.filter((candidate) => candidate.id === targetId);
    if (matches.length === 0 && nestedMatches.length === 1) {
      return resolveProxmoxNestedDockerTarget(
        nestedMatches[0].source,
        targetId,
      );
    }
    if (nestedMatches.length > 1) {
      throw apiError(
        `Контейнер ${targetId} найден в нескольких LXC — выберите источник заново`,
        409,
      );
    }
  }

  if (matches.length === 0) {
    throw apiError(`Контейнер Docker не найден: ${targetId}`, 404);
  }
  if (matches.length > 1) {
    throw apiError(
      `Контейнер ${targetId} найден на нескольких Docker-хостах — выберите источник заново`,
      409,
    );
  }

  const match = matches[0];
  return {
    available: true,
    container: match.container,
    docker: match.docker,
    id: targetId,
    image: String(
      match.container.homepageImageReference ||
        match.container.Labels?.["com.docker.compose.image"] ||
        match.container.Image ||
        "",
    ).slice(0, 300),
    label: targetId,
    ...(match.sourceDefinition.node
      ? { node: match.sourceDefinition.node }
      : {}),
    mode: "docker",
    ...(match.sourceDefinition.proxmoxSourceId
      ? { proxmoxSourceId: match.sourceDefinition.proxmoxSourceId }
      : {}),
    source: match.source,
    type: "docker",
    ...(match.sourceDefinition.vmid
      ? { vmid: String(match.sourceDefinition.vmid) }
      : {}),
  };
}

function imageVersion(imageInfo) {
  const labels = imageInfo?.Config?.Labels || {};
  const version =
    labels["org.opencontainers.image.version"] ||
    labels["org.label-schema.version"] ||
    labels["build_version"] ||
    labels["version"];
  if (typeof version === "string" && version.trim())
    return version.trim().slice(0, 128);
  return String(imageInfo?.Id || "")
    .replace(/^sha256:/, "")
    .slice(0, 12);
}

function pullImageOnce(docker, image) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(apiError(`Загрузка образа ${image} превысила 2 минуты`, 504)),
      dockerOperationTimeoutMs,
    );

    docker.pull(image, (pullError, stream) => {
      if (pullError) {
        clearTimeout(timeout);
        reject(pullError);
        return;
      }

      docker.modem.followProgress(stream, (progressError, output) => {
        clearTimeout(timeout);
        if (progressError) reject(progressError);
        else resolve(output);
      });
    });
  });
}

function isTransientRegistryError(error) {
  return /timeout|timed out|request canceled|connection reset|econnreset|eai_again|temporary|http code (?:429|5\d\d)|status code 429|toomanyrequests|retry-after/i.test(
    String(error?.message || error),
  );
}

function registryRetryDelayMs(error, attempt) {
  const message = String(error?.message || error);
  const retryAfter = message.match(
    /retry-after:\s*([\d.]+)\s*(µs|us|ms|s|m)?/i,
  );
  let requestedDelayMs = 0;

  if (retryAfter) {
    const value = Number(retryAfter[1]);
    const unit = String(retryAfter[2] || "s").toLowerCase();
    if (Number.isFinite(value)) {
      if (unit === "µs" || unit === "us") requestedDelayMs = value / 1000;
      else if (unit === "ms") requestedDelayMs = value;
      else if (unit === "m") requestedDelayMs = value * 60 * 1000;
      else requestedDelayMs = value * 1000;
    }
  }

  return Math.min(30 * 1000, Math.max(attempt * 2000, requestedDelayMs));
}

async function pullImageWithRetry(docker, image) {
  let lastError;

  for (let attempt = 1; attempt <= dockerPullAttempts; attempt += 1) {
    try {
      return await pullImageOnce(docker, image);
    } catch (error) {
      lastError = error;
      if (!isTransientRegistryError(error) || attempt === dockerPullAttempts)
        break;
      await delay(registryRetryDelayMs(error, attempt));
    }
  }

  if (isTransientRegistryError(lastError)) {
    throw apiError(
      `Registry образа ${image} не ответил после ${dockerPullAttempts} попыток: ${lastError.message}`,
      502,
    );
  }
  throw lastError;
}

async function queuedImagePull(docker, image, source) {
  const sourceKey = source || "default";
  const previous = sourcePullQueues.get(sourceKey) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => pullImageWithRetry(docker, image));
  sourcePullQueues.set(sourceKey, current);

  try {
    return await current;
  } finally {
    if (sourcePullQueues.get(sourceKey) === current) {
      sourcePullQueues.delete(sourceKey);
    }
  }
}

async function pullImage(docker, image, source) {
  const pullKey = `${source || "default"}:${image}`;
  const active = activeImagePulls.get(pullKey);
  if (active) return active;

  const pull = queuedImagePull(docker, image, source);
  activeImagePulls.set(pullKey, pull);

  try {
    return await pull;
  } finally {
    if (activeImagePulls.get(pullKey) === pull) {
      activeImagePulls.delete(pullKey);
    }
  }
}

async function inspectImages(target, pull = true) {
  const containerInfo = await target.docker.getContainer(target.id).inspect();
  const imageReference = containerInfo.Config?.Image;
  if (!imageReference || imageReference.includes("@sha256:")) {
    throw apiError(
      `Контейнер ${target.id} использует закреплённый образ без обновляемого тега`,
      422,
    );
  }

  const currentImage = await target.docker
    .getImage(containerInfo.Image)
    .inspect();
  if (pull) await pullImage(target.docker, imageReference, target.source);
  const latestImage = await target.docker.getImage(imageReference).inspect();

  return { containerInfo, currentImage, imageReference, latestImage };
}

export async function checkDockerTarget(target) {
  const { currentImage, imageReference, latestImage } =
    await inspectImages(target);
  const updateAvailable = currentImage.Id !== latestImage.Id;

  return {
    configured: true,
    currentVersion: imageVersion(currentImage),
    image: imageReference,
    latestVersion: imageVersion(latestImage),
    message: updateAvailable
      ? `Загружен новый образ ${imageReference}`
      : `Образ ${imageReference} актуален`,
    source: target.source,
    state: updateAvailable ? "available" : "idle",
    updateAvailable,
  };
}

function cleanEndpointSettings(networks) {
  return Object.fromEntries(
    Object.entries(networks || {}).map(([networkName, settings]) => [
      networkName,
      {
        ...(settings?.Aliases ? { Aliases: settings.Aliases } : {}),
        ...(settings?.DriverOpts ? { DriverOpts: settings.DriverOpts } : {}),
        ...(settings?.Links ? { Links: settings.Links } : {}),
      },
    ]),
  );
}

function createOptionsFromInspect(info, imageReference, name) {
  const hostConfig = { ...info.HostConfig };
  delete hostConfig.AutoRemove;

  return {
    ...info.Config,
    HostConfig: {
      ...hostConfig,
      AutoRemove: false,
    },
    Image: imageReference,
    NetworkingConfig: {
      EndpointsConfig: cleanEndpointSettings(info.NetworkSettings?.Networks),
    },
    name,
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForHealthy(container) {
  const deadline = Date.now() + containerHealthTimeoutMs;
  let lastInfo;

  while (Date.now() < deadline) {
    lastInfo = await container.inspect();
    const health = lastInfo.State?.Health?.Status;
    if (lastInfo.State?.Running && (!health || health === "healthy")) {
      if (!health) await delay(3000);
      return;
    }
    if (!lastInfo.State?.Running || health === "unhealthy") break;
    await delay(2000);
  }

  const state =
    lastInfo?.State?.Health?.Status || lastInfo?.State?.Status || "unknown";
  throw new Error(`Новый контейнер не прошёл проверку состояния: ${state}`);
}

export async function updateDockerTarget(target) {
  const { containerInfo, currentImage, imageReference, latestImage } =
    await inspectImages(target);
  if (currentImage.Id === latestImage.Id) {
    return {
      configured: true,
      currentVersion: imageVersion(currentImage),
      latestVersion: imageVersion(latestImage),
      message: `Контейнер ${target.id} уже использует актуальный образ`,
      source: target.source,
      state: "success",
      updateAvailable: false,
    };
  }

  if (containerInfo.HostConfig?.AutoRemove) {
    throw apiError(
      `Автоматическое обновление контейнера ${target.id} с AutoRemove не поддерживается`,
      422,
    );
  }
  if (
    String(containerInfo.HostConfig?.NetworkMode || "").startsWith("container:")
  ) {
    throw apiError(
      `Контейнер ${target.id} использует network_mode container и требует ручного обновления`,
      422,
    );
  }

  const oldContainer = target.docker.getContainer(containerInfo.Id);
  const originalName = String(containerInfo.Name || `/${target.id}`).replace(
    /^\//,
    "",
  );
  const backupName = `${originalName.slice(0, 32)}-homepage-backup-${Date.now()}`;
  let newContainer;
  let oldRenamed = false;

  try {
    if (containerInfo.State?.Running) await oldContainer.stop({ t: 30 });
    await oldContainer.rename({ name: backupName });
    oldRenamed = true;

    newContainer = await target.docker.createContainer(
      createOptionsFromInspect(containerInfo, imageReference, originalName),
    );
    await newContainer.start();
    await waitForHealthy(newContainer);
    await oldContainer.remove({ force: true, v: false });
  } catch (error) {
    if (newContainer) {
      await newContainer
        .remove({ force: true, v: false })
        .catch(() => undefined);
    }
    if (oldRenamed) {
      await oldContainer.rename({ name: originalName }).catch(() => undefined);
      if (containerInfo.State?.Running)
        await oldContainer.start().catch(() => undefined);
    }
    throw error;
  }

  return {
    configured: true,
    currentVersion: imageVersion(latestImage),
    latestVersion: imageVersion(latestImage),
    message: `Контейнер ${target.id} обновлён и запущен`,
    source: target.source,
    state: "success",
    updateAvailable: false,
  };
}
