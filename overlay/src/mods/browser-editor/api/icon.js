import { promises as fs } from "fs";
import path from "path";

import createLogger from "utils/logger";

const logger = createLogger("iconConfigService");

const contentTypes = {
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function getImagesDir() {
  return process.env.IMAGES_REAL_DIR || path.join(process.cwd(), "public", "images");
}

function getRequestedIcon(req) {
  const requestedFile = Array.isArray(req.query.file) ? req.query.file[0] : req.query.file;
  const fileName = typeof requestedFile === "string" ? requestedFile : "";

  if (!fileName || fileName !== path.basename(fileName)) {
    return null;
  }

  return fileName;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const fileName = getRequestedIcon(req);
    if (!fileName) {
      return res.status(400).end("Invalid icon");
    }

    const filePath = path.join(getImagesDir(), "icons", fileName);
    const extension = path.extname(fileName).toLowerCase();
    const image = await fs.readFile(filePath);

    res.setHeader("Content-Type", contentTypes[extension] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(image);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).end("Icon not found");
    }

    if (error) logger.error(error);
    return res.status(500).end("Internal Server Error");
  }
}
