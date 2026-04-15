import { promises as fs } from "fs";
import path from "path";

import { CONF_DIR } from "utils/config/config";
import createLogger from "utils/logger";

const logger = createLogger("backgroundConfigService");

const contentTypes = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function getBackgroundFile() {
  const files = await fs.readdir(CONF_DIR);
  return files.find((file) => file.startsWith("background-upload."));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const file = await getBackgroundFile();
    if (!file) {
      return res.status(404).end("Background not found");
    }

    const filePath = path.join(CONF_DIR, file);
    const extension = path.extname(file).toLowerCase();
    const image = await fs.readFile(filePath);

    res.setHeader("Content-Type", contentTypes[extension] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(image);
  } catch (error) {
    if (error) logger.error(error);
    return res.status(500).end("Internal Server Error");
  }
}
