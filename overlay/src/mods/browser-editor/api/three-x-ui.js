import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import yaml from "js-yaml";

import {
  aggregateThreeXuiSummary,
  threeXuiSourcePattern,
} from "mods/browser-editor/lib/three-x-ui-config";
import { CONF_DIR, substituteEnvironmentVars } from "utils/config/config";
import createLogger from "utils/logger";

const logger = createLogger("threeXuiConfigService");
const configFileName = "three-x-ui.yaml";
const requestTimeoutMs = 8000;
const maxResponseBytes = 1024 * 1024;
const summaryCacheMs = 15000;
const summaryCache = new Map();
const activeSummaries = new Map();

function apiError(message, statusCode = 500) {
  return Object.assign(new Error(message), { statusCode });
}

function verifyEditorAccess(res) {
  if (process.env.HOMEPAGE_BROWSER_EDITOR !== "true") {
    res.status(404).end("Editor is disabled");
    return false;
  }
  return true;
}

function configPath() {
  return process.env.HOMEPAGE_3X_UI_CONFIG || path.join(CONF_DIR, configFileName);
}

function internalBaseUrl() {
  const port = Number(process.env.PORT || 3000);
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3000;
  return `http://127.0.0.1:${safePort}`;
}

function normalizePanelUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return "";
    }

    const pathname = url.pathname.replace(/\/+$/, "").replace(/\/panel$/i, "");
    url.pathname = pathname;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizeSource(id, value, { requireToken = true } = {}) {
  if (!threeXuiSourcePattern.test(id || "")) {
    throw apiError("Некорректное имя подключения 3x-ui", 400);
  }

  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const url = normalizePanelUrl(source.url);
  const token = typeof source.token === "string" ? source.token.trim() : "";

  if (!url) {
    throw apiError(`Подключение ${id}: укажите корректный HTTP(S) URL панели`, 422);
  }
  if (requireToken && !token) {
    throw apiError(`Подключение ${id}: укажите API-токен`, 422);
  }
  if (token.length > 4096) {
    throw apiError(`Подключение ${id}: API-токен слишком длинный`, 422);
  }

  return { id, token, url };
}

async function readRawConfig() {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = yaml.load(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function configuredSources() {
  let raw;
  try {
    raw = substituteEnvironmentVars(await fs.readFile(configPath(), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const parsed = yaml.load(raw);
  const config = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return Object.entries(config).map(([id, value]) => normalizeSource(id, value));
}

async function findSource(id) {
  if (!threeXuiSourcePattern.test(id || "")) {
    throw apiError("Некорректное подключение 3x-ui", 400);
  }
  const source = (await configuredSources()).find((candidate) => candidate.id === id);
  if (!source) {
    throw apiError(`Подключение 3x-ui «${id}» не найдено`, 404);
  }
  return source;
}

async function writeConfig(config) {
  const filePath = configPath();
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const content = yaml.dump(config, { lineWidth: -1, noRefs: true, sortKeys: false });

  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function apiUrl(source, apiPath) {
  return `${source.url}/panel/api/${apiPath.replace(/^\/+/, "")}`;
}

async function requestPanel(source, apiPath, method = "GET") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(apiUrl(source, apiPath), {
      method,
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${source.token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      throw apiError("3x-ui вернула перенаправление; проверьте URL скрытого пути панели", 502);
    }
    if (!response.ok) {
      throw apiError(`3x-ui вернула HTTP ${response.status}`, response.status === 401 || response.status === 403 ? 422 : 502);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxResponseBytes) {
      throw apiError("Ответ 3x-ui слишком большой", 502);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > maxResponseBytes) {
      throw apiError("Ответ 3x-ui слишком большой", 502);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw apiError("3x-ui вернула некорректный JSON", 502);
    }
    if (payload?.success === false) {
      throw apiError(`3x-ui отклонила запрос${payload.msg ? `: ${String(payload.msg).slice(0, 200)}` : ""}`, 502);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw apiError("3x-ui не ответила за 8 секунд", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadSummary(source, { force = false } = {}) {
  if (!force) {
    const cached = summaryCache.get(source.id);
    if (cached?.expiresAt > Date.now()) {
      return cached.value;
    }
    if (activeSummaries.has(source.id)) {
      return activeSummaries.get(source.id);
    }
  }

  const promise = (async () => {
    const [status, onlineResult] = await Promise.all([
      requestPanel(source, "server/status"),
      requestPanel(source, "clients/onlines", "POST").catch((error) => {
        logger.warn(`Не удалось получить онлайн-клиентов 3x-ui ${source.id}: ${error.message}`);
        return null;
      }),
    ]);
    const value = aggregateThreeXuiSummary(status, onlineResult);
    summaryCache.set(source.id, { expiresAt: Date.now() + summaryCacheMs, value });
    return value;
  })();

  activeSummaries.set(source.id, promise);
  try {
    return await promise;
  } finally {
    if (activeSummaries.get(source.id) === promise) {
      activeSummaries.delete(source.id);
    }
  }
}

async function saveSource(body) {
  const id = typeof body?.source === "string" ? body.source.trim() : "";
  if (!threeXuiSourcePattern.test(id)) {
    throw apiError("Имя подключения: латинские буквы, цифры, точка, дефис или подчёркивание", 400);
  }

  const rawConfig = await readRawConfig();
  const previous = rawConfig[id] && typeof rawConfig[id] === "object" ? rawConfig[id] : {};
  const token = typeof body?.token === "string" && body.token.trim() ? body.token.trim() : previous.token;
  const candidate = normalizeSource(id, { token, url: body?.url });

  await loadSummary(candidate, { force: true });
  rawConfig[id] = { url: candidate.url, token };
  await writeConfig(rawConfig);
  summaryCache.delete(id);

  return { hasToken: true, id, url: candidate.url };
}

export default async function handler(req, res) {
  if (!verifyEditorAccess(res)) {
    return undefined;
  }

  try {
    if (req.method === "GET") {
      const sourceId = Array.isArray(req.query.source) ? req.query.source[0] : req.query.source;
      if (sourceId) {
        res.setHeader("Cache-Control", "private, max-age=10");
        return res.status(200).json(await loadSummary(await findSource(sourceId)));
      }

      const sources = await configuredSources();
      return res.status(200).json({
        configFile: configFileName,
        internalBaseUrl: internalBaseUrl(),
        sources: sources.map(({ id, url }) => ({ hasToken: true, id, url })),
      });
    }

    if (req.method === "POST") {
      return res.status(200).json(await saveSource(req.body));
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).end("Method Not Allowed");
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) {
      logger.error(error);
    }
    return res.status(error.statusCode || 500).end(error.message || "Internal Server Error");
  }
}
