import { existsSync, promises as fs } from "fs";
import net from "net";
import path from "path";

import createLogger from "utils/logger";

const logger = createLogger("iconConfigService");
const maxIconBytes = 2 * 1024 * 1024;
const remoteFetchTimeoutMs = 5000;

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

function getSafeIconName(name) {
  const fileName = typeof name === "string" ? name.trim() : "";
  const extension = path.extname(fileName).toLowerCase();

  if (!fileName || fileName !== path.basename(fileName) || !contentTypes[extension]) {
    return null;
  }

  return fileName;
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map((part) => Number(part));

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

function isPrivateHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();

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

function getSafeRemoteUrl(value) {
  try {
    const url = new URL(String(value));

    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isPrivateHostname(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function decodeImageDataUrl(dataUrl) {
  const match = typeof dataUrl === "string" ? dataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i) : null;
  if (!match) {
    return null;
  }

  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length === 0 || buffer.length > maxIconBytes) {
    return null;
  }

  return buffer;
}

async function fetchRemoteIcon(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), remoteFetchTimeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { error: `Failed to fetch URL: ${response.statusText}` };
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > maxIconBytes) {
      return { error: "Remote icon is too large" };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0 || buffer.length > maxIconBytes) {
      return { error: "Remote icon is too large" };
    }

    return { buffer };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function handler(req, res) {
  try {
    const fileName = getRequestedIcon(req);
    if (!fileName) {
      return res.status(400).end("Invalid icon");
    }

    if (req.method === "GET") {
      if (fileName === "list") {
        const allIcons = [];
        for (const imagesDir of getImagesDirs()) {
          const iconsPath = path.join(imagesDir, "icons");
          try {
            if (existsSync(iconsPath)) {
              const files = await fs.readdir(iconsPath);
              for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (contentTypes[ext]) {
                  allIcons.push(file);
                }
              }
            }
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
        const uniqueIcons = [...new Set(allIcons)].sort();
        return res.status(200).json({ icons: uniqueIcons });
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
    }

    if (req.method === "POST") {
      if (fileName === "upload") {
        const { name, dataUrl } = req.body ?? {};
        const safeName = getSafeIconName(name);
        if (!safeName || !dataUrl) {
          return res.status(400).end("Missing name or dataUrl");
        }

        const buffer = decodeImageDataUrl(dataUrl);
        if (!buffer) {
          return res.status(400).end("Invalid file data");
        }

        const imagesDirs = getImagesDirs();
        if (imagesDirs.length === 0) {
          return res.status(500).end("Images directory not found");
        }
        const iconsDir = path.join(imagesDirs[0], "icons");
        await fs.mkdir(iconsDir, { recursive: true });

        const filePath = path.join(iconsDir, safeName);
        await fs.writeFile(filePath, buffer);

        return res.status(200).json({ success: true, fileName: safeName });
      }

      if (fileName === "download") {
        const { url, name } = req.body ?? {};
        const safeName = getSafeIconName(name);
        const safeUrl = getSafeRemoteUrl(url);
        if (!safeUrl || !safeName) {
          return res.status(400).end("Missing url or name");
        }

        const imagesDirs = getImagesDirs();
        if (imagesDirs.length === 0) {
          return res.status(500).end("Images directory not found");
        }
        const iconsDir = path.join(imagesDirs[0], "icons");
        await fs.mkdir(iconsDir, { recursive: true });

        const { buffer, error } = await fetchRemoteIcon(safeUrl);
        if (!buffer) {
          return res.status(400).end(error || "Failed to fetch URL");
        }

        const filePath = path.join(iconsDir, safeName);
        await fs.writeFile(filePath, buffer);

        return res.status(200).json({ success: true, fileName: safeName });
      }

      return res.status(400).end("Invalid action");
    }

    if (req.method === "DELETE") {
      if (fileName === "list" || fileName === "upload" || fileName === "download") {
        return res.status(400).end("Invalid operation");
      }

      let deleted = false;
      for (const imagesDir of getImagesDirs()) {
        const filePath = path.join(imagesDir, "icons", fileName);
        try {
          if (existsSync(filePath)) {
            await fs.unlink(filePath);
            deleted = true;
          }
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }

      if (!deleted) {
        return res.status(404).end("Icon not found");
      }

      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).end("Method Not Allowed");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return res.status(404).end("Icon not found");
    }

    if (error) logger.error(error);
    return res.status(500).end("Internal Server Error");
  }
}
