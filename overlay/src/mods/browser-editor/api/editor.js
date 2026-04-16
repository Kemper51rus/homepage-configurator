import { promises as fs } from "fs";
import path from "path";

import yaml from "js-yaml";

import checkAndCopyConfig, { CONF_DIR } from "utils/config/config";
import createLogger from "utils/logger";

const logger = createLogger("configEditorService");

const editableFiles = {
  bookmarks: "bookmarks.yaml",
  services: "services.yaml",
  settings: "settings.yaml",
};

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

  checkAndCopyConfig(configFile);
  return path.join(CONF_DIR, configFile);
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
  const [services, bookmarks, settings] = await Promise.all([
    readYamlFile("services", []),
    readYamlFile("bookmarks", []),
    readYamlFile("settings", {}),
  ]);

  return { services, bookmarks, settings };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return res.status(200).json(await getEditorConfig());
    }

    if (req.method === "PUT") {
      const { file, data } = req.body ?? {};

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
