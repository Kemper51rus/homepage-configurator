import { spawn } from "child_process";
import { existsSync, promises as fs } from "fs";
import { createHash, randomUUID } from "crypto";
import { lookup } from "dns/promises";
import net from "net";
import os from "os";
import path from "path";

import yaml from "js-yaml";

import checkAndCopyConfig, { CONF_DIR } from "utils/config/config";
import createLogger from "utils/logger";

const logger = createLogger("configEditorService");

const editableFiles = {
  bookmarks: { fileName: "bookmarks.yaml", format: "yaml" },
  services: { fileName: "services.yaml", format: "yaml" },
  settings: { fileName: "settings.yaml", format: "yaml" },
};

const settingsTabFiles = [
  { id: "settings", fileName: "settings.yaml", format: "yaml", label: "Настройки" },
  { id: "widgets", fileName: "widgets.yaml", format: "yaml", label: "Виджеты" },
  { id: "docker", fileName: "docker.yaml", format: "yaml", label: "Докеры" },
  { id: "kubernetes", fileName: "kubernetes.yaml", format: "yaml", label: "Kubernetes" },
  { id: "proxmox", fileName: "proxmox.yaml", format: "yaml", label: "Proxmox" },
  { id: "custom-css", fileName: "custom.css", format: "text", label: "CSS" },
  { id: "custom-js", fileName: "custom.js", format: "text", label: "JavaScript" },
  { id: "services", fileName: "services.yaml", format: "yaml", label: "Сервисы" },
  { id: "bookmarks", fileName: "bookmarks.yaml", format: "yaml", label: "Закладки" },
];

const settingsTabFilesByName = new Map(settingsTabFiles.map((file) => [file.fileName, file]));
const updateStatusFileName = ".homepage-configurator-update-status.json";
const updateCheckCacheFileName = ".homepage-configurator-update-check.json";
const configuratorUpdateDataFiles = [
  {
    fileName: updateCheckCacheFileName,
    label: "Последняя проверка версии",
    description: "Кеш ответа GitHub version.json и результат сравнения версий.",
  },
  {
    fileName: updateStatusFileName,
    label: "Последнее обновление",
    description: "Состояние и лог последнего запуска обновления с GitHub.",
  },
];
const configuratorUpdateDataFileNames = new Set(configuratorUpdateDataFiles.map((file) => file.fileName));
const excludedSettingsTabFiles = new Set(["bookmarks.yaml", "services.yaml", ...configuratorUpdateDataFileNames]);
const supportedSettingsTabExtensions = new Set([".yaml", ".yml", ".css", ".js", ".json", ".txt"]);

const backgroundTypes = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const iconTypes = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};

const iconExtensions = new Set([".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const maxIconBytes = 5 * 1024 * 1024;
const trackInfoProbeTimeoutMs = 5000;
const maxTrackInfoProbeBytes = 256 * 1024;
const configuratorName = "homepage-configurator";
const configuratorVersion = "0.6.38";
const defaultConfiguratorRepo = "Kemper51rus/homepage-configurator";
const defaultConfiguratorBranch = "main";
const defaultConfiguratorMetadataUrl = `https://api.github.com/repos/${defaultConfiguratorRepo}/contents/version.json?ref=${defaultConfiguratorBranch}`;
const defaultConfiguratorInstallUrl = `https://raw.githubusercontent.com/${defaultConfiguratorRepo}/${defaultConfiguratorBranch}/install.sh`;
const defaultMinimumHomepageVersion = "1.13.2";
const defaultHomepageUpdateCommand = "update";
const updateCheckIntervalMs = 24 * 60 * 60 * 1000;
const updateFetchTimeoutMs = 10000;
const maxUpdateMetadataBytes = 64 * 1024;
const maxInstallScriptBytes = 1024 * 1024;
let activeConfiguratorUpdate = null;

function isEditorEnabled() {
  return process.env.HOMEPAGE_BROWSER_EDITOR === "true";
}

function verifyEditorAccess(_req, res) {
  if (!isEditorEnabled()) {
    res.status(404).end("Editor is disabled");
    return false;
  }

  return true;
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map((part) => Number(part));

  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateAddress(address) {
  const normalized = String(address ?? "").replace(/^\[|\]$/g, "").toLowerCase();

  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }

  if (net.isIP(normalized) === 4) {
    return isPrivateIpv4(normalized);
  }

  if (net.isIP(normalized) === 6) {
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }

  return false;
}

async function getSafeRemoteProbeUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isPrivateAddress(url.hostname)) {
    return null;
  }

  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      return null;
    }
  } catch {
    return null;
  }

  return url;
}

function getJsonPathValue(obj, keyPath) {
  if (!keyPath) return obj;
  return keyPath.split(".").reduce((acc, part) => {
    return acc && acc[part] !== undefined ? acc[part] : undefined;
  }, obj);
}

function normalizeTrackText(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length >= 2 ? text : "";
}

function getStreamMountPath(streamUrl) {
  try {
    return new URL(streamUrl).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function getIcecastSourceProbe(data, streamUrl) {
  const rawSource = data?.icestats?.source;
  if (!rawSource) {
    return null;
  }

  const sources = Array.isArray(rawSource) ? rawSource : [rawSource];
  const streamPath = getStreamMountPath(streamUrl);
  const matchedIndex = sources.findIndex((source) => {
    const mount = String(source?.listenurl ?? source?.mount ?? "").toLowerCase();
    return streamPath && mount.includes(streamPath);
  });
  const index = matchedIndex >= 0 ? matchedIndex : 0;
  const value = normalizeTrackText(sources[index]?.title);
  if (!value) {
    return null;
  }

  return {
    key: Array.isArray(rawSource) ? `icestats.source.${index}.title` : "icestats.source.title",
    value,
  };
}

function getJsonTrackInfoProbe(data, keys, streamUrl) {
  const icecastProbe = getIcecastSourceProbe(data, streamUrl);
  if (icecastProbe) {
    return icecastProbe;
  }

  const candidateKeys = [
    ...keys,
    "now_playing.song.text",
    "now_playing.song.title",
    "song.text",
    "song.title",
    "current_track.title",
    "track.title",
    "title",
  ];

  for (const key of [...new Set(candidateKeys.filter(Boolean))]) {
    const value = normalizeTrackText(getJsonPathValue(data, key));
    if (value) {
      return { key, value };
    }
  }

  return null;
}

function getTrackInfoProbeCandidates(streamUrl) {
  let url;
  try {
    url = new URL(streamUrl);
  } catch {
    return [];
  }

  const origin = url.origin;
  const pathParts = url.pathname.split("/").filter(Boolean);
  const listenIndex = pathParts.findIndex((part) => part.toLowerCase() === "listen");
  const stationSlug = listenIndex >= 0 ? pathParts[listenIndex + 1] : "";
  const nowPlayingKeys = ["now_playing.song.text", "now_playing.song.title", "song.text", "song.title"];
  const candidates = [];

  if (stationSlug) {
    candidates.push({ url: `${origin}/api/nowplaying/${encodeURIComponent(stationSlug)}`, keys: nowPlayingKeys });
  }

  candidates.push(
    { url: `${origin}/api/nowplaying/1`, keys: nowPlayingKeys },
    { url: `${origin}/api/nowplaying`, keys: nowPlayingKeys },
    { url: `${origin}/status-json.xsl`, keys: ["icestats.source.title", "icestats.source.0.title"] },
  );

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) {
      return false;
    }
    seen.add(candidate.url);
    return true;
  });
}

async function fetchTrackInfoCandidate(candidate, streamUrl) {
  const url = await getSafeRemoteProbeUrl(candidate.url);
  if (!url) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), trackInfoProbeTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "homepage-browser-editor/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > maxTrackInfoProbeBytes) {
      return null;
    }

    const text = await response.text();
    if (!text || text.length > maxTrackInfoProbeBytes) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      const data = JSON.parse(text);
      const probe = getJsonTrackInfoProbe(data, candidate.keys ?? [], streamUrl);
      if (!probe) {
        return null;
      }

      return {
        trackInfoUrl: url.toString(),
        trackInfoKey: probe.key,
        sample: probe.value,
      };
    }

    const sample = normalizeTrackText(text);
    if (!sample || /<html|<!doctype/i.test(sample)) {
      return null;
    }

    return {
      trackInfoUrl: url.toString(),
      trackInfoKey: "",
      sample,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeRadioTrackInfo(stationUrl) {
  const streamUrl = await getSafeRemoteProbeUrl(stationUrl);
  if (!streamUrl) {
    throw new Error("Некорректная или небезопасная ссылка на поток");
  }

  for (const candidate of getTrackInfoProbeCandidates(streamUrl.toString())) {
    const probe = await fetchTrackInfoCandidate(candidate, streamUrl.toString());
    if (probe) {
      return probe;
    }
  }

  throw new Error("Метаданные трека по этой ссылке не найдены");
}

function getConfiguratorMetadataUrl() {
  return process.env.HOMEPAGE_CONFIGURATOR_VERSION_URL || defaultConfiguratorMetadataUrl;
}

function getConfiguratorRepoUrl(metadata = {}) {
  if (process.env.HOMEPAGE_CONFIGURATOR_REPO) {
    return process.env.HOMEPAGE_CONFIGURATOR_REPO;
  }

  const repo = metadata.repo || defaultConfiguratorRepo;
  return `https://github.com/${repo}.git`;
}

function getConfiguratorBranch(metadata = {}) {
  return process.env.HOMEPAGE_CONFIGURATOR_BRANCH || metadata.branch || defaultConfiguratorBranch;
}

function getConfiguratorInstallUrl(metadata = {}) {
  return process.env.HOMEPAGE_CONFIGURATOR_INSTALL_URL || metadata.installUrl || defaultConfiguratorInstallUrl;
}

function getConfiguratorUpdateEnv(updateCheck, imagesDir) {
  const env = {
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || process.env.LOGNAME || "root",
    LOGNAME: process.env.LOGNAME || process.env.USER || "root",
    SHELL: process.env.SHELL || "/bin/sh",
    LANG: process.env.LANG || "C.UTF-8",
  };

  [
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "PNPM_HOME",
    "COREPACK_HOME",
    "HOMEPAGE_CONFIGURATOR_RESTART_COMMAND",
    "HOMEPAGE_SERVICE_NAME",
  ].forEach((key) => {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  });

  Object.entries(process.env).forEach(([key, value]) => {
    if (key.startsWith("npm_config_") || key.startsWith("HOMEPAGE_CONFIGURATOR_")) {
      env[key] = value;
    }
  });

  return {
    ...env,
    HOMEPAGE_EDITOR_REPO: getConfiguratorRepoUrl(updateCheck.latest),
    HOMEPAGE_EDITOR_BRANCH: getConfiguratorBranch(updateCheck.latest),
    HOMEPAGE_EDITOR_CUSTOM_INSTALL: "all",
    HOMEPAGE_EDITOR_CLEAN_CUSTOM: "keep",
    HOMEPAGE_TARGET_DIR: updateCheck.targetDir,
    HOMEPAGE_CONFIG_DIR: CONF_DIR,
    HOMEPAGE_IMAGES_DIR: imagesDir,
  };
}

function getUpdateStatusPath() {
  return path.join(CONF_DIR, updateStatusFileName);
}

function getUpdateCheckCachePath() {
  return path.join(CONF_DIR, updateCheckCacheFileName);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function getConfiguratorUpdateFiles() {
  return Promise.all(
    configuratorUpdateDataFiles.map(async (file) => {
      const content = await readTextIfExists(path.join(CONF_DIR, file.fileName));
      return {
        ...file,
        exists: content.length > 0,
        content,
      };
    }),
  );
}

function parseVersionParts(version) {
  const normalized = String(version ?? "").trim().replace(/^v/i, "");
  const [main, preRelease = ""] = normalized.split("-", 2);
  const parts = main.split(".").map((part) => Number(part));

  if (parts.length < 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  return { parts, preRelease };
}

function compareVersions(left, right) {
  const leftParsed = parseVersionParts(left);
  const rightParsed = parseVersionParts(right);

  if (!leftParsed || !rightParsed) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    const diff = leftParsed.parts[index] - rightParsed.parts[index];
    if (diff !== 0) {
      return diff;
    }
  }

  if (leftParsed.preRelease && !rightParsed.preRelease) return -1;
  if (!leftParsed.preRelease && rightParsed.preRelease) return 1;
  return leftParsed.preRelease.localeCompare(rightParsed.preRelease);
}

async function fetchBoundedText(rawUrl, { maxBytes, timeoutMs }) {
  const url = await getSafeRemoteProbeUrl(rawUrl);
  if (!url) {
    throw new Error("URL обновления некорректен или небезопасен");
  }
  url.searchParams.set("_homepage_configurator_t", String(Date.now()));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "Accept": "application/vnd.github.raw, application/vnd.github+json",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "homepage-browser-editor/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub ответил HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > maxBytes) {
      throw new Error("Ответ GitHub слишком большой");
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("Ответ GitHub слишком большой");
    }

    let contentsResponse = null;
    try {
      contentsResponse = JSON.parse(text);
    } catch {
      contentsResponse = null;
    }
    if (contentsResponse?.encoding === "base64" && typeof contentsResponse.content === "string") {
      const decoded = Buffer.from(contentsResponse.content.replace(/\s+/g, ""), "base64").toString("utf8");
      if (Buffer.byteLength(decoded, "utf8") > maxBytes) {
        throw new Error("Ответ GitHub слишком большой");
      }
      return decoded;
    }

    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeConfiguratorMetadata(rawMetadata) {
  const metadata = rawMetadata && typeof rawMetadata === "object" ? rawMetadata : {};
  const version = String(metadata.version || "").trim();

  if (!parseVersionParts(version)) {
    throw new Error("В version.json нет корректной версии");
  }

  const repo = String(metadata.repo || defaultConfiguratorRepo).trim();
  const branch = String(metadata.branch || defaultConfiguratorBranch).trim();
  const target = metadata.target && typeof metadata.target === "object" ? metadata.target : {};
  const minimumVersion = String(target.minimumVersion || defaultMinimumHomepageVersion).trim();
  const updateCommand = String(target.updateCommand || defaultHomepageUpdateCommand).trim();

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("В version.json некорректный repo");
  }

  if (!/^[A-Za-z0-9_.\/-]+$/.test(branch) || branch.includes("..")) {
    throw new Error("В version.json некорректная branch");
  }

  if (!parseVersionParts(minimumVersion)) {
    throw new Error("В version.json нет корректной минимальной версии Homepage");
  }

  if (updateCommand !== "update") {
    throw new Error("В version.json некорректная команда обновления target");
  }

  return {
    schema: metadata.schema ?? 1,
    name: String(metadata.name || configuratorName),
    version,
    repo,
    branch,
    target: {
      name: "homepage",
      minimumVersion,
      updateCommand,
    },
    metadataUrl: String(metadata.metadataUrl || defaultConfiguratorMetadataUrl),
    installUrl: String(metadata.installUrl || defaultConfiguratorInstallUrl),
    commitUrl: String(metadata.commitUrl || `https://github.com/${repo}/commits/${branch}`),
    updatedAt: String(metadata.updatedAt || ""),
  };
}

async function fetchConfiguratorMetadata() {
  const metadataUrl = getConfiguratorMetadataUrl();
  const text = await fetchBoundedText(metadataUrl, {
    maxBytes: maxUpdateMetadataBytes,
    timeoutMs: updateFetchTimeoutMs,
  });

  return normalizeConfiguratorMetadata(JSON.parse(text));
}

async function looksLikeHomepageTarget(candidate) {
  if (!candidate) {
    return false;
  }

  const targetDir = path.resolve(candidate);
  const requiredFiles = [
    "package.json",
    "next.config.js",
    "src/pages/index.jsx",
    "src/components/services/group.jsx",
    "src/components/bookmarks/group.jsx",
  ];

  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(targetDir, "package.json"), "utf8"));
    if (packageJson.name !== "homepage") {
      return false;
    }

    for (const fileName of requiredFiles.slice(1)) {
      if (!(await fileExists(path.join(targetDir, fileName)))) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function getHomepageTargetDir() {
  const candidates = [
    process.env.HOMEPAGE_CONFIGURATOR_TARGET_DIR,
    process.env.HOMEPAGE_TARGET_DIR,
    path.resolve(process.cwd(), "..", ".."),
    process.cwd(),
    "/opt/homepage",
    "/app",
    "/usr/src/app",
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate) continue;
    const targetDir = path.resolve(candidate);
    if (seen.has(targetDir)) continue;
    seen.add(targetDir);

    if (await looksLikeHomepageTarget(targetDir)) {
      return targetDir;
    }
  }

  return null;
}

async function getInstalledConfiguratorInfo(targetDir) {
  const manifest = targetDir ? await readJsonIfExists(path.join(targetDir, ".homepage-configurator-manifest.json")) : null;
  return {
    name: manifest?.configurator?.name || configuratorName,
    version: manifest?.configurator?.version || configuratorVersion,
    installedAt: manifest?.installedAt || null,
    targetDir,
    manifestFound: Boolean(manifest),
  };
}

async function getHomepageTargetInfo(targetDir, metadata) {
  const minimumVersion = metadata?.target?.minimumVersion || defaultMinimumHomepageVersion;
  const updateCommand = metadata?.target?.updateCommand || defaultHomepageUpdateCommand;
  const result = {
    name: "homepage",
    version: "",
    minimumVersion,
    updateCommand,
    updateRequired: false,
    supported: false,
  };

  if (!targetDir) {
    return result;
  }

  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(targetDir, "package.json"), "utf8"));
    result.name = packageJson.name || "homepage";
    result.version = String(packageJson.version || "");
    result.supported = parseVersionParts(result.version)
      ? compareVersions(result.version, minimumVersion) >= 0
      : false;
    result.updateRequired = !result.supported;
    return result;
  } catch {
    result.updateRequired = true;
    return result;
  }
}

async function readUpdateCheckCache() {
  return readJsonIfExists(getUpdateCheckCachePath());
}

async function writeUpdateCheckCache(data) {
  await writeJsonFile(getUpdateCheckCachePath(), data);
}

async function checkConfiguratorUpdate({ force = false } = {}) {
  const cached = await readUpdateCheckCache();
  const checkedAtMs = cached?.checkedAt ? Date.parse(cached.checkedAt) : 0;
  let cachedTargetDir = null;

  if (!force && cached?.target && checkedAtMs && Date.now() - checkedAtMs < updateCheckIntervalMs) {
    cachedTargetDir = await getHomepageTargetDir();
    const installed = await getInstalledConfiguratorInfo(cachedTargetDir);
    if (cached.currentVersion === installed.version && cached.targetDir === cachedTargetDir) {
      return { ...cached, cached: true };
    }
  }

  const [metadata, targetDir] = await Promise.all([
    fetchConfiguratorMetadata(),
    cachedTargetDir ? Promise.resolve(cachedTargetDir) : getHomepageTargetDir(),
  ]);
  const installed = await getInstalledConfiguratorInfo(targetDir);
  const targetInfo = await getHomepageTargetInfo(targetDir, metadata);
  const updateAvailable = compareVersions(installed.version, metadata.version) < 0;
  const targetUpdateRequired = Boolean(targetDir && targetInfo.updateRequired);
  const result = {
    checkedAt: new Date().toISOString(),
    cached: false,
    current: installed,
    latest: metadata,
    target: targetInfo,
    currentVersion: installed.version,
    latestVersion: metadata.version,
    targetVersion: targetInfo.version,
    minimumTargetVersion: targetInfo.minimumVersion,
    targetUpdateCommand: targetInfo.updateCommand,
    targetUpdateRequired,
    updateAvailable,
    canUpdate: Boolean(targetDir && !targetUpdateRequired),
    targetDir,
    reason: !targetDir
      ? "Не найден полный checkout Homepage. Для standalone-only runtime используйте внешний deploy."
      : targetUpdateRequired
      ? `Target Homepage ${targetInfo.version || "неизвестной версии"} слишком старый. Минимум для мода: ${targetInfo.minimumVersion}. Сначала обновите target проект из консоли командой \`${targetInfo.updateCommand}\`, затем повторите обновление configurator. ⚠️ Важно: после обновления target Homepage наш мод может полностью перестать работать. Если браузерный редактор не откроется, обновите configurator из консоли: bash <(curl -Ls ${metadata.installUrl}) --action update`
      : "",
    nextCheckAfter: new Date(Date.now() + updateCheckIntervalMs).toISOString(),
  };

  await writeUpdateCheckCache(result);
  return result;
}

async function readConfiguratorUpdateStatus() {
  const status = await readJsonIfExists(getUpdateStatusPath());
  if (!status) {
    return { state: "idle", log: [] };
  }

  if (activeConfiguratorUpdate?.id === status.id && status.state !== "running") {
    return { ...status, state: "running" };
  }

  if (status.state === "running" && !activeConfiguratorUpdate) {
    const updatedAtMs = Date.parse(status.updatedAt || status.startedAt || "");
    if (updatedAtMs && Date.now() - updatedAtMs > 2 * 60 * 60 * 1000) {
      const nextStatus = {
        ...status,
        state: "failed",
        phase: "failed",
        progress: 100,
        message: "Обновление было прервано или зависло.",
        finishedAt: new Date().toISOString(),
        restartRequired: false,
      };
      appendUpdateLog(nextStatus, "Обновление было прервано или зависло.");
      await writeConfiguratorUpdateStatus(nextStatus);
      return nextStatus;
    }
  }

  if (status.state === "restarting" && !activeConfiguratorUpdate) {
    const installed = await getInstalledConfiguratorInfo(status.targetDir);
    if (compareVersions(installed.version, status.latestVersion) >= 0) {
      const nextStatus = {
        ...status,
        state: "completed",
        phase: "completed",
        progress: 100,
        message: `Обновление ${status.latestVersion} установлено. Homepage перезапущен.`,
        restartRequired: false,
        finishedAt: status.finishedAt || new Date().toISOString(),
        currentVersion: status.latestVersion,
      };
      appendUpdateLog(nextStatus, "Homepage перезапущен. Обновление завершено.");
      await writeConfiguratorUpdateStatus(nextStatus);
      return nextStatus;
    }
  }

  return status;
}

async function writeConfiguratorUpdateStatus(status) {
  await writeJsonFile(getUpdateStatusPath(), status);
}

function appendUpdateLog(status, chunk) {
  const nextLines = String(chunk)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => (line.length > 600 ? `${line.slice(0, 597)}...` : line));

  status.log = [...(status.log ?? []), ...nextLines].slice(-200);
  status.updatedAt = new Date().toISOString();
}

function setUpdateProgress(status, phase, progress, message) {
  status.phase = phase;
  status.progress = Math.min(100, Math.max(0, progress));
  status.message = message;
  status.updatedAt = new Date().toISOString();
}

function updateProgressFromInstallerOutput(status, chunk) {
  const text = String(chunk);
  const stages = [
    ["Downloading mod", "download", 20, "Скачиваю configurator с GitHub"],
    ["Using mod source", "download", 25, "Configurator скачан"],
    ["Install plan:", "install", 30, "Проверяю план установки"],
    ["Existing browser editor install detected", "cleanup", 36, "Снимаю предыдущую установку"],
    ["Core patch reverted", "cleanup", 44, "Предыдущий core patch снят"],
    ["Restored ", "cleanup", 48, "Восстанавливаю файлы из backup"],
    ["Core patch applied", "install", 58, "Core patch применён"],
    ["Browser editor installed", "install", 66, "Файлы configurator установлены"],
    ["Installing missing target dependencies", "dependencies", 72, "Устанавливаю зависимости"],
    ["Building homepage", "build", 80, "Собираю Homepage"],
    ["Compiled successfully", "build", 88, "Production build скомпилирован"],
    ["Finalizing page optimization", "build", 92, "Завершаю оптимизацию страниц"],
    ["Syncing standalone runtime assets", "runtime", 96, "Синхронизирую standalone runtime"],
    ["Done", "done", 98, "Установщик завершает работу"],
  ];
  const match = stages.find(([needle]) => text.includes(needle));

  if (!match) {
    return;
  }

  const [, phase, progress, message] = match;
  if ((status.progress ?? 0) <= progress) {
    setUpdateProgress(status, phase, progress, message);
  }
}

function getServiceName() {
  const serviceName = process.env.HOMEPAGE_SERVICE_NAME || "homepage.service";
  return /^[A-Za-z0-9_.@-]+$/.test(serviceName) ? serviceName : "homepage.service";
}

function scheduleHomepageRestart(status) {
  const restartCommand = process.env.HOMEPAGE_CONFIGURATOR_RESTART_COMMAND;
  const child = restartCommand
    ? spawn("sh", ["-lc", `sleep 1; ${restartCommand}`], { detached: true, stdio: "ignore" })
    : spawn("sh", ["-c", "sleep 1; exec systemctl restart \"$1\"", "homepage-configurator-restart", getServiceName()], {
        detached: true,
        stdio: "ignore",
      });

  child.on("error", async (error) => {
    const nextStatus = {
      ...status,
      state: "completed",
      phase: "restart-warning",
      progress: 100,
      message: "Обновление установлено, но перезапуск не был запланирован",
      restartRequired: true,
      restartError: error.message,
      finishedAt: new Date().toISOString(),
    };
    appendUpdateLog(nextStatus, `Не удалось запланировать перезапуск: ${error.message}`);
    await writeConfiguratorUpdateStatus(nextStatus);
  });
  child.unref();
}

async function fetchInstallScript(metadata) {
  const installUrl = getConfiguratorInstallUrl(metadata);
  const text = await fetchBoundedText(installUrl, {
    maxBytes: maxInstallScriptBytes,
    timeoutMs: updateFetchTimeoutMs,
  });

  if (!text.includes("homepage-configurator") || !text.includes("run_mod_installer")) {
    throw new Error("Скачанный install.sh не похож на установщик homepage-configurator");
  }

  return text;
}

async function startConfiguratorUpdate({ autoRestart = true } = {}) {
  const currentStatus = await readConfiguratorUpdateStatus();
  if (activeConfiguratorUpdate || currentStatus.state === "running") {
    return currentStatus;
  }

  const updateCheck = await checkConfiguratorUpdate({ force: true });
  if (!updateCheck.canUpdate || !updateCheck.targetDir) {
    throw new Error(updateCheck.reason || "Не найден target Homepage для обновления");
  }

  const installScript = await fetchInstallScript(updateCheck.latest);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "homepage-configurator-update-"));
  const scriptPath = path.join(tmpDir, "install.sh");
  await fs.writeFile(scriptPath, installScript, { encoding: "utf8", mode: 0o700 });

  const imagesDir = getImagesDir();
  const status = {
    id: randomUUID(),
    state: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentVersion: updateCheck.currentVersion,
    latestVersion: updateCheck.latestVersion,
    targetVersion: updateCheck.targetVersion,
    minimumTargetVersion: updateCheck.minimumTargetVersion,
    targetDir: updateCheck.targetDir,
    configDir: CONF_DIR,
    imagesDir,
    autoRestart,
    restartRequired: false,
    phase: "start",
    progress: 10,
    message: "Подготовка обновления",
    log: [`Старт обновления ${updateCheck.currentVersion} -> ${updateCheck.latestVersion}`],
  };
  await writeConfiguratorUpdateStatus(status);

  const args = [
    scriptPath,
    "--action",
    "update",
    "--target",
    updateCheck.targetDir,
    "--config-dir",
    CONF_DIR,
    "--images-dir",
    imagesDir,
    "--clean-custom",
    "keep",
    "--no-restart",
  ];

  const child = spawn("bash", args, {
    cwd: updateCheck.targetDir,
    env: getConfiguratorUpdateEnv(updateCheck, imagesDir),
    stdio: ["ignore", "pipe", "pipe"],
  });

  activeConfiguratorUpdate = { id: status.id, child };

  const writeChunk = async (chunk) => {
    appendUpdateLog(status, chunk);
    updateProgressFromInstallerOutput(status, chunk);
    await writeConfiguratorUpdateStatus(status);
  };

  child.stdout.on("data", (chunk) => {
    writeChunk(chunk).catch((error) => logger.error(error));
  });
  child.stderr.on("data", (chunk) => {
    writeChunk(chunk).catch((error) => logger.error(error));
  });
  child.on("error", async (error) => {
    activeConfiguratorUpdate = null;
    status.state = "failed";
    setUpdateProgress(status, "failed", 100, `Не удалось запустить установщик: ${error.message}`);
    status.finishedAt = new Date().toISOString();
    appendUpdateLog(status, error.message);
    await writeConfiguratorUpdateStatus(status);
  });
  child.on("close", async (code) => {
    activeConfiguratorUpdate = null;
    status.exitCode = code;
    status.finishedAt = new Date().toISOString();

    if (code === 0) {
      await writeUpdateCheckCache({
        ...updateCheck,
        cached: false,
        currentVersion: updateCheck.latestVersion,
        current: { ...updateCheck.current, version: updateCheck.latestVersion },
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
      });
      if (autoRestart) {
        status.state = "restarting";
        setUpdateProgress(status, "restarting", 98, `Обновление установлено. Перезапускаю ${getServiceName()}...`);
        status.restartRequired = false;
        appendUpdateLog(status, `Обновление установлено. Перезапускаю ${getServiceName()}...`);
        await writeConfiguratorUpdateStatus(status);
        scheduleHomepageRestart(status);
      } else {
        status.state = "completed";
        setUpdateProgress(status, "completed", 100, "Обновление установлено. Нужен перезапуск Homepage.");
        status.restartRequired = true;
        appendUpdateLog(status, "Обновление установлено. Нужен перезапуск Homepage.");
        await writeConfiguratorUpdateStatus(status);
      }
    } else {
      status.state = "failed";
      setUpdateProgress(status, "failed", 100, `Обновление не установлено. Установщик завершился с кодом ${code}.`);
      status.restartRequired = false;
      appendUpdateLog(status, `Установщик завершился с кодом ${code}`);
      await writeConfiguratorUpdateStatus(status);
    }

    fs.rm(tmpDir, { recursive: true, force: true }).catch((error) => logger.error(error));
  });

  return status;
}

function getImagesDir() {
  if (process.env.IMAGES_REAL_DIR) {
    return process.env.IMAGES_REAL_DIR;
  }

  const publicImagesDir = path.join(process.cwd(), "public", "images");
  if (existsSync(publicImagesDir)) {
    return publicImagesDir;
  }

  const sourceImagesDir = path.join(process.cwd(), "images");
  if (existsSync(sourceImagesDir)) {
    return sourceImagesDir;
  }

  return publicImagesDir;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

function getConfigPath(file) {
  const configFile = editableFiles[file];
  if (!configFile) {
    return null;
  }

  checkAndCopyConfig(configFile.fileName);
  return path.join(CONF_DIR, configFile.fileName);
}

async function readYamlFile(file, fallback) {
  const filePath = getConfigPath(file);
  const raw = await fs.readFile(filePath, "utf8");
  return yaml.load(raw) ?? fallback;
}

async function writeYamlFile(file, data) {
  const filePath = getConfigPath(file);
  const dumped = yaml.dump(data, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  await fs.writeFile(filePath, dumped, "utf8");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureTextFile(fileName) {
  const filePath = path.join(CONF_DIR, fileName);

  if (!(await fileExists(filePath))) {
    await fs.mkdir(CONF_DIR, { recursive: true });
    await fs.writeFile(filePath, "", "utf8");
  }

  return filePath;
}

async function readRawConfigFile(fileName, format) {
  const filePath =
    format === "yaml" ? (checkAndCopyConfig(fileName), path.join(CONF_DIR, fileName)) : await ensureTextFile(fileName);

  return fs.readFile(filePath, "utf8");
}

async function writeRawConfigFile(fileName, format, content) {
  const nextContent = typeof content === "string" ? content : "";
  const filePath =
    format === "yaml" ? (checkAndCopyConfig(fileName), path.join(CONF_DIR, fileName)) : await ensureTextFile(fileName);

  if (format === "yaml") {
    yaml.load(nextContent || "");
  }

  await fs.writeFile(filePath, nextContent, "utf8");
}

function isSupportedSettingsTabFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return supportedSettingsTabExtensions.has(extension) && !/\.bak$|\.back$/i.test(fileName);
}

function prettifySettingsTabLabel(fileName) {
  const basename = fileName.replace(/\.[^.]+$/, "");
  return basename
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function getSettingsTabs() {
  await fs.mkdir(CONF_DIR, { recursive: true });

  const dirEntries = await fs.readdir(CONF_DIR, { withFileTypes: true });
  const discoveredFiles = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => !excludedSettingsTabFiles.has(fileName))
    .filter((fileName) => isSupportedSettingsTabFile(fileName));

  const tabMap = new Map(settingsTabFiles.map((file) => [file.fileName, file]));

  discoveredFiles.forEach((fileName) => {
    if (tabMap.has(fileName)) {
      return;
    }

    const extension = path.extname(fileName).toLowerCase();
    tabMap.set(fileName, {
      id: `extra-${fileName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "config"}`,
      fileName,
      format: extension === ".css" || extension === ".js" || extension === ".txt" ? "text" : "yaml",
      label: prettifySettingsTabLabel(fileName),
    });
  });

  const orderedTabs = [
    ...settingsTabFiles.filter((file) => tabMap.has(file.fileName)),
    ...Array.from(tabMap.values())
      .filter((file) => !settingsTabFilesByName.has(file.fileName))
      .sort((left, right) => left.label.localeCompare(right.label, "ru")),
  ];

  return Promise.all(
    orderedTabs.map(async (file) => ({
      ...file,
      content: await readRawConfigFile(file.fileName, file.format),
    })),
  );
}

async function removeOldBackgrounds() {
  const files = await fs.readdir(CONF_DIR);
  await Promise.all(
    files
      .filter((file) => file.startsWith("background-upload."))
      .map((file) => fs.unlink(path.join(CONF_DIR, file))),
  );
}

function parseBackground(background) {
  if (!background?.dataUrl || !background?.type) {
    throw new Error("Missing background file");
  }

  const extension = backgroundTypes[background.type];
  if (!extension) {
    throw new Error("Unsupported background type");
  }

  const [, base64] = background.dataUrl.split(",");
  if (!base64) {
    throw new Error("Invalid background file");
  }

  return {
    buffer: Buffer.from(base64, "base64"),
    extension,
  };
}

async function saveBackgroundUpload(background) {
  const { buffer, extension } = parseBackground(background);
  const settings = await readYamlFile("settings", {});
  const cacheKey = Date.now();
  const fileName = `background-upload${extension}`;

  await removeOldBackgrounds();
  await fs.writeFile(path.join(CONF_DIR, fileName), buffer);

  settings.background = `/api/config/background?v=${cacheKey}`;
  await writeYamlFile("settings", settings);

  return settings;
}

async function saveBackgroundValue(backgroundPath) {
  const nextBackground = typeof backgroundPath === "string" ? backgroundPath.trim() : "";
  if (!nextBackground) {
    throw new Error("Путь или URL фона обязателен");
  }

  const settings = await readYamlFile("settings", {});
  await removeOldBackgrounds();
  settings.background = nextBackground;
  await writeYamlFile("settings", settings);

  return settings;
}

function isRemoteIcon(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function isLegacyLocalIcon(value) {
  return typeof value === "string" && /^(?:\/images\/)?icons\/[^/].+/i.test(value.trim());
}

function getLegacyLocalIconFileName(value) {
  return value.trim().replace(/^(?:\/images\/)?icons\//i, "");
}

function getIconApiPath(fileName) {
  return `/api/config/icon/${encodeURIComponent(fileName)}`;
}

function slugifyIconName(name) {
  return (
    String(name ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "icon"
  );
}

function getIconExtension(url, contentType) {
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (iconExtensions.has(extension)) {
      return extension;
    }
  } catch {
    // Fall through to content-type based detection.
  }

  return iconTypes[contentType?.split(";")[0]?.trim().toLowerCase()] ?? ".png";
}

function collectRemoteIcons(value, icons, itemName = "") {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectRemoteIcons(entry, icons, itemName));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (isRemoteIcon(value.icon)) {
    icons.push({ item: value, itemName, type: "remote", url: value.icon.trim() });
  } else if (isLegacyLocalIcon(value.icon)) {
    icons.push({ item: value, type: "local", fileName: getLegacyLocalIconFileName(value.icon) });
  }

  Object.entries(value).forEach(([key, child]) => {
    if (key === "icon") {
      return;
    }

    const nextName =
      child && typeof child === "object" && !Array.isArray(child) && Object.prototype.hasOwnProperty.call(child, "icon")
        ? key
        : itemName || key;
    collectRemoteIcons(child, icons, nextName);
  });
}

async function downloadIcon(url, itemName, iconsDir, downloadedByUrl) {
  if (downloadedByUrl.has(url)) {
    return { ...downloadedByUrl.get(url), reused: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "homepage-browser-editor/1.0" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Не удалось скачать иконку ${url}: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const extension = getIconExtension(url, contentType);
  const normalizedContentType = contentType.split(";")[0].trim().toLowerCase();
  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > maxIconBytes) {
    throw new Error(`Иконка слишком большая: ${url}`);
  }

  if (
    !normalizedContentType.startsWith("image/") &&
    normalizedContentType !== "application/octet-stream" &&
    !iconExtensions.has(extension)
  ) {
    throw new Error(`Неподдерживаемый тип иконки ${contentType || "<empty>"}: ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxIconBytes) {
    throw new Error(`Иконка слишком большая: ${url}`);
  }

  await fs.mkdir(iconsDir, { recursive: true });

  const hash = createHash("sha256").update(url).digest("hex").slice(0, 10);
  const fileName = `${slugifyIconName(itemName)}-${hash}${extension}`;
  const filePath = path.join(iconsDir, fileName);
  await fs.writeFile(filePath, buffer);

  const result = { fileName, localIcon: getIconApiPath(fileName) };
  downloadedByUrl.set(url, result);
  return { ...result, reused: false };
}

async function localizeRemoteIcons() {
  const iconsDir = path.join(getImagesDir(), "icons");
  const services = await readYamlFile("services", []);
  const bookmarks = await readYamlFile("bookmarks", []);
  const targets = [];
  const downloadedByUrl = new Map();
  const result = {
    downloaded: 0,
    updated: 0,
    skipped: 0,
    iconsDir,
    files: [],
  };

  collectRemoteIcons(services, targets, "");
  collectRemoteIcons(bookmarks, targets, "");

  for (const target of targets) {
    if (target.type === "local") {
      target.item.icon = getIconApiPath(target.fileName);
      result.updated += 1;
      continue;
    }

    try {
      const icon = await downloadIcon(target.url, target.itemName, iconsDir, downloadedByUrl);
      target.item.icon = icon.localIcon;
      result.updated += 1;
      if (!icon.reused) {
        result.downloaded += 1;
        result.files.push(icon.fileName);
      }
    } catch (error) {
      result.skipped += 1;
      logger.error(error);
    }
  }

  if (targets.length > 0 && result.updated > 0) {
    await writeYamlFile("services", services);
    await writeYamlFile("bookmarks", bookmarks);
  }

  return result;
}

const CSS_START_MARKER = "/* --- HOMEPAGE-CONFIGURATOR TITLE STYLES START --- */";
const CSS_END_MARKER = "/* --- HOMEPAGE-CONFIGURATOR TITLE STYLES END --- */";

function extractGroupLayouts(settings) {
  const layouts = [];
  const layoutObj = settings?.layout;
  if (!layoutObj || typeof layoutObj !== "object") {
    return layouts;
  }

  for (const [key, value] of Object.entries(layoutObj)) {
    if (key === "Bookmarks" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [bKey, bValue] of Object.entries(value)) {
        if (bValue && typeof bValue === "object" && !Array.isArray(bValue)) {
          layouts.push({ name: bKey, layout: bValue });
        }
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      layouts.push({ name: key, layout: value });
    }
  }
  return layouts;
}

function generateCssForLayouts(layouts) {
  let css = "";
  for (const item of layouts) {
    const name = item.name;
    const l = item.layout;
    if (!l) continue;

    const color = (l.titleColor || "").trim();
    const align = (l.titleAlign || "").trim();
    const size = (l.titleSize || "").trim();
    const font = (l.titleFont || "").trim();

    if (!color && !align && !size && !font) {
      continue;
    }

    const escapedName = name.replace(/"/g, '\\"');

    css += `div[data-editor-group-name="${escapedName}"] h2 {\n`;
    if (color) {
      css += `  color: ${color} !important;\n`;
    }
    if (size) {
      css += `  font-size: ${size} !important;\n`;
    }
    if (font) {
      css += `  font-family: "${font}", sans-serif !important;\n`;
    }
    if (align) {
      css += `  flex-grow: 1 !important;\n`;
      css += `  text-align: ${align} !important;\n`;
      if (align === "center") {
        css += `  justify-content: center !important;\n`;
      } else if (align === "right") {
        css += `  justify-content: flex-end !important;\n`;
      } else if (align === "left") {
        css += `  justify-content: flex-start !important;\n`;
      }
    }
    css += `}\n\n`;
  }
  return css;
}

async function updateCustomCssWithStyles(generatedCss) {
  const customCssPath = path.join(CONF_DIR, "custom.css");
  let currentContent = "";

  if (existsSync(customCssPath)) {
    currentContent = await fs.readFile(customCssPath, "utf8");
  }

  const startIdx = currentContent.indexOf(CSS_START_MARKER);
  const endIdx = currentContent.indexOf(CSS_END_MARKER);

  const blockContent = `${CSS_START_MARKER}\n/* This block is auto-generated. Do not edit manually. */\n${generatedCss}${CSS_END_MARKER}`;

  let nextContent = "";
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    nextContent = currentContent.substring(0, startIdx) + blockContent + currentContent.substring(endIdx + CSS_END_MARKER.length);
  } else {
    const separator = currentContent && !currentContent.endsWith("\n") ? "\n\n" : "";
    nextContent = currentContent + separator + blockContent + "\n";
  }

  await fs.writeFile(customCssPath, nextContent, "utf8");
}

function generateCssForItems(items) {
  let css = "";
  for (const item of items) {
    const name = item.name;
    const c = item.config;
    if (!c) continue;

    const color = (c.titleColor || "").trim();
    const align = (c.titleAlign || "").trim();
    const size = (c.titleSize || "").trim();
    const font = (c.titleFont || "").trim();

    if (!color && !align && !size && !font) {
      continue;
    }

    const escapedName = name.replace(/"/g, '\\"');

    if (item.type === "services") {
      css += `li.service[data-name="${escapedName}"] .service-name {\n`;
    } else {
      css += `li.bookmark[data-name="${escapedName}"] .bookmark-name {\n`;
    }

    if (color) {
      css += `  color: ${color} !important;\n`;
    }
    if (size) {
      css += `  font-size: ${size} !important;\n`;
    }
    if (font) {
      css += `  font-family: "${font}", sans-serif !important;\n`;
    }
    if (align) {
      css += `  flex-grow: 1 !important;\n`;
      css += `  text-align: ${align} !important;\n`;
      if (align === "center") {
        css += `  justify-content: center !important;\n`;
      } else if (align === "right") {
        css += `  justify-content: flex-end !important;\n`;
      } else if (align === "left") {
        css += `  justify-content: flex-start !important;\n`;
      }
    }
    css += `}\n\n`;
  }
  return css;
}

async function regenerateAllStylesCss() {
  try {
    const services = await readYamlFile("services", []);
    const bookmarks = await readYamlFile("bookmarks", []);
    const settings = await readYamlFile("settings", {});

    const groupLayouts = extractGroupLayouts(settings);
    let css = generateCssForLayouts(groupLayouts);

    const items = [];
    // Extract services items
    if (Array.isArray(services)) {
      for (const groupObj of services) {
        if (groupObj && typeof groupObj === "object") {
          for (const [groupName, itemsList] of Object.entries(groupObj)) {
            if (Array.isArray(itemsList)) {
              for (const itemObj of itemsList) {
                if (itemObj && typeof itemObj === "object") {
                  for (const [itemName, itemConfig] of Object.entries(itemObj)) {
                    if (itemConfig && typeof itemConfig === "object" && !Array.isArray(itemConfig)) {
                      items.push({ name: itemName, config: itemConfig, type: "services" });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // Extract bookmarks items
    if (Array.isArray(bookmarks)) {
      for (const groupObj of bookmarks) {
        if (groupObj && typeof groupObj === "object") {
          for (const [groupName, itemsList] of Object.entries(groupObj)) {
            if (Array.isArray(itemsList)) {
              for (const itemObj of itemsList) {
                if (itemObj && typeof itemObj === "object") {
                  for (const [itemName, configVal] of Object.entries(itemObj)) {
                    if (Array.isArray(configVal)) {
                      for (const subConf of configVal) {
                        if (subConf && typeof subConf === "object") {
                          items.push({ name: itemName, config: subConf, type: "bookmarks" });
                        }
                      }
                    } else if (configVal && typeof configVal === "object") {
                      items.push({ name: itemName, config: configVal, type: "bookmarks" });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    css += generateCssForItems(items);

    await updateCustomCssWithStyles(css);
  } catch (error) {
    logger.error("Failed to regenerate style CSS:", error);
  }
}

async function getEditorConfig() {
  const [services, bookmarks, settings, settingsTabs] = await Promise.all([
    readYamlFile("services", []),
    readYamlFile("bookmarks", []),
    readYamlFile("settings", {}),
    getSettingsTabs(),
  ]);

  return { services, bookmarks, settings, settingsTabs };
}

export default async function handler(req, res) {
  try {
    if (!verifyEditorAccess(req, res)) {
      return undefined;
    }

    if (req.method === "GET") {
      return res.status(200).json(await getEditorConfig());
    }

    if (req.method === "PUT") {
      const { file, data, fileName, content } = req.body ?? {};

      if (fileName) {
        const settingsTab =
          settingsTabFilesByName.get(fileName) ??
          (await getSettingsTabs()).find((settingsFile) => settingsFile.fileName === fileName);

        if (!settingsTab) {
          return res.status(422).end("Unsupported file");
        }

        await writeRawConfigFile(settingsTab.fileName, settingsTab.format, content);
        if (["settings.yaml", "services.yaml", "bookmarks.yaml"].includes(fileName)) {
          await regenerateAllStylesCss();
        }
        return res.status(200).json(await getEditorConfig());
      }

      if (!editableFiles[file]) {
        return res.status(422).end("Unsupported file");
      }

      if ((file === "services" || file === "bookmarks") && !Array.isArray(data)) {
        return res.status(422).end("Config must be a list");
      }

      if (file === "settings" && (typeof data !== "object" || Array.isArray(data) || data === null)) {
        return res.status(422).end("Settings must be an object");
      }

      await writeYamlFile(file, data);
      if (["settings", "services", "bookmarks"].includes(file)) {
        await regenerateAllStylesCss();
      }
      return res.status(200).json(await getEditorConfig());
    }

    if (req.method === "POST") {
      const { action, background, backgroundPath, provider, q, apiKey, stationUrl, force, autoRestart } = req.body ?? {};

      if (action === "localize-icons") {
        const iconLocalization = await localizeRemoteIcons();
        return res.status(200).json({ ...(await getEditorConfig()), iconLocalization });
      }

      if (action === "check-configurator-update") {
        return res.status(200).json(await checkConfiguratorUpdate({ force: Boolean(force) }));
      }

      if (action === "get-configurator-update-status") {
        return res.status(200).json(await readConfiguratorUpdateStatus());
      }

      if (action === "get-configurator-update-files") {
        return res.status(200).json({ files: await getConfiguratorUpdateFiles() });
      }

      if (action === "run-configurator-update") {
        return res.status(202).json(await startConfiguratorUpdate({ autoRestart: autoRestart !== false }));
      }

      if (action === "probe-radio-track-info") {
        if (!stationUrl) {
          return res.status(400).end("Ссылка на поток обязательна");
        }

        return res.status(200).json(await probeRadioTrackInfo(stationUrl));
      }

      if (action === "geocode") {
        if (!q) {
          return res.status(400).end("Поисковый запрос обязателен");
        }

        const settings = await readYamlFile("settings", {});
        let url;
        if (provider === "openweathermap") {
          const key = apiKey || settings?.providers?.openweathermap;
          if (!key) return res.status(400).end("Отсутствует API-ключ OpenWeatherMap");
          url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${key}`;
        } else {
          const key = apiKey || settings?.providers?.weatherapi;
          if (!key) return res.status(400).end("Отсутствует API-ключ WeatherAPI");
          url = `https://api.weatherapi.com/v1/search.json?key=${key}&q=${encodeURIComponent(q)}`;
        }

        try {
          const fetchResponse = await fetch(url);
          if (!fetchResponse.ok) {
            return res.status(fetchResponse.status).end(await fetchResponse.text());
          }
          const rawData = await fetchResponse.json();
          let results = [];
          if (provider === "openweathermap") {
            results = (rawData ?? []).map(item => {
              const state = item.state ? `, ${item.state}` : "";
              return {
                name: `${item.name}${state}, ${item.country}`,
                lat: item.lat,
                lon: item.lon
              };
            });
          } else {
            results = (rawData ?? []).map(item => {
              return {
                name: `${item.name}, ${item.region}, ${item.country}`,
                lat: item.lat,
                lon: item.lon
              };
            });
          }
          return res.status(200).json(results);
        } catch (fetchErr) {
          return res.status(500).end(fetchErr.message || "Ошибка подключения к API погоды");
        }
      }

      if (backgroundPath !== undefined) {
        await saveBackgroundValue(backgroundPath);
        return res.status(200).json(await getEditorConfig());
      }

      await saveBackgroundUpload(background);
      return res.status(200).json(await getEditorConfig());
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return res.status(405).end("Method Not Allowed");
  } catch (error) {
    if (error) logger.error(error);
    return res.status(500).end(error.message || "Internal Server Error");
  }
}
