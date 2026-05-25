import { existsSync, promises as fs } from "fs";
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

function getImagesDirs() {
  const candidates = [];

  if (process.env.IMAGES_REAL_DIR) {
    candidates.push(process.env.IMAGES_REAL_DIR);
  }

  const publicImagesDir = path.join(process.cwd(), "public", "images");
  const sourceImagesDir = path.join(process.cwd(), "images");

  if (existsSync(publicImagesDir)) {
    candidates.push(publicImagesDir);
  }

  if (existsSync(sourceImagesDir)) {
    candidates.push(sourceImagesDir);
  }

  candidates.push(publicImagesDir);

  return [...new Set(candidates)];
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

    const extension = path.extname(fileName).toLowerCase();
    let image = null;

    for (const imagesDir of getImagesDirs()) {
      try {
        image = await fs.readFile(path.join(imagesDir, "icons", fileName));
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    if (!image) {
      return res.status(404).end("Icon not found");
    }

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
