import { existsSync, promises as fs } from "fs";
import { createHash } from "crypto";
import { lookup } from "dns/promises";
import net from "net";
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
const excludedSettingsTabFiles = new Set(["bookmarks.yaml", "services.yaml"]);
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
      const { action, background, backgroundPath, provider, q, apiKey, stationUrl } = req.body ?? {};

      if (action === "localize-icons") {
        const iconLocalization = await localizeRemoteIcons();
        return res.status(200).json({ ...(await getEditorConfig()), iconLocalization });
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
