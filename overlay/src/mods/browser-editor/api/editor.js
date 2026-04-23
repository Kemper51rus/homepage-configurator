import { promises as fs } from "fs";
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
      return res.status(200).json(await getEditorConfig());
    }

    if (req.method === "POST") {
      const { background, backgroundPath } = req.body ?? {};

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
