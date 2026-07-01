import net from "net";
import path from "path";

export const remoteFetchTimeoutMs = 5000;
export const maxIconBytes = 2 * 1024 * 1024;
export const maxHtmlProbeBytes = 1024 * 1024;
const maxRedirects = 5;

const imageContentTypeExtensions = new Map([
  ["image/gif", ".gif"],
  ["image/vnd.microsoft.icon", ".ico"],
  ["image/x-icon", ".ico"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/svg+xml", ".svg"],
  ["image/webp", ".webp"],
]);

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map((part) => Number(part));

  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return net.isIP(mappedIpv4) === 4 ? isPrivateIpv4(mappedIpv4) : true;
  }

  const firstBlock = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstBlock)) {
    return true;
  }

  return (firstBlock & 0xfe00) === 0xfc00 || (firstBlock & 0xffc0) === 0xfe80 || (firstBlock & 0xff00) === 0xff00;
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
    return isPrivateIpv6(normalized);
  }

  return false;
}

export function getSafeRemoteUrl(value) {
  try {
    const rawValue = String(value ?? "").trim();
    const normalizedValue = /^[a-z][a-z0-9+.-]*:/i.test(rawValue) ? rawValue : `https://${rawValue}`;
    const url = new URL(normalizedValue);

    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || isPrivateHostname(url.hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function contentTypeBase(contentType) {
  return String(contentType ?? "").split(";")[0].trim().toLowerCase();
}

function imageExtensionFromContentType(contentType) {
  return imageContentTypeExtensions.get(contentTypeBase(contentType)) ?? "";
}

function isHtmlContentType(contentType) {
  const base = contentTypeBase(contentType);
  return base === "text/html" || base === "application/xhtml+xml";
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isSupportedImageResponse(response, url) {
  if (imageExtensionFromContentType(response.headers.get("content-type"))) {
    return true;
  }

  return Boolean(path.extname(new URL(url).pathname).toLowerCase().match(/^\.(?:gif|ico|jpe?g|png|svg|webp)$/));
}

async function fetchSafeResponse(url, signal) {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = getSafeRemoteUrl(currentUrl);
    if (!safeUrl) {
      return { error: "Remote URL is not allowed" };
    }

    const response = await fetch(safeUrl, { redirect: "manual", signal });
    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: safeUrl };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { error: `Failed to fetch URL: ${response.statusText}` };
    }

    currentUrl = new URL(location, safeUrl).toString();
  }

  return { error: "Remote URL redirects too many times" };
}

async function readResponseBuffer(response, maxBytes, errorPrefix, allowPartial = false) {
  if (!response.body?.getReader) {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0 || buffer.length > maxBytes) {
      if (allowPartial && buffer.length > 0) {
        return { buffer: buffer.subarray(0, maxBytes), truncated: true };
      }

      return { error: `${errorPrefix} is too large` };
    }

    return { buffer, truncated: false };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let truncated = false;
  let shouldCancel = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      if (totalBytes + chunk.length > maxBytes) {
        if (!allowPartial) {
          shouldCancel = true;
          return { error: `${errorPrefix} is too large` };
        }

        const remainingBytes = maxBytes - totalBytes;
        if (remainingBytes > 0) {
          chunks.push(chunk.subarray(0, remainingBytes));
          totalBytes += remainingBytes;
        }
        truncated = true;
        break;
      }

      chunks.push(chunk);
      totalBytes += chunk.length;
    }
  } finally {
    if (truncated || shouldCancel) {
      await reader.cancel().catch(() => {});
    } else {
      reader.releaseLock();
    }
  }

  if (totalBytes === 0) {
    return { error: `${errorPrefix} is too large` };
  }

  return { buffer: Buffer.concat(chunks, totalBytes), truncated };
}

async function fetchBuffer(url, maxBytes, errorPrefix = "Remote file") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), remoteFetchTimeoutMs);

  try {
    const fetched = await fetchSafeResponse(url, controller.signal);
    if (!fetched.response) {
      return { error: fetched.error || "Failed to fetch URL" };
    }

    const { finalUrl, response } = fetched;
    if (!response.ok) {
      return { error: `Failed to fetch URL: ${response.statusText}` };
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > maxBytes) {
      return { error: `${errorPrefix} is too large` };
    }

    const readResult = await readResponseBuffer(response, maxBytes, errorPrefix);
    if (!readResult.buffer) {
      return readResult;
    }

    return { buffer: readResult.buffer, finalUrl, response };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchInitialUrl(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), remoteFetchTimeoutMs);

  try {
    const fetched = await fetchSafeResponse(url, controller.signal);
    if (!fetched.response) {
      return { error: fetched.error || "Failed to fetch URL" };
    }

    const { finalUrl, response } = fetched;
    if (!response.ok) {
      return { error: `Failed to fetch URL: ${response.statusText}` };
    }

    if (isSupportedImageResponse(response, finalUrl || response.url || url)) {
      const contentLength = Number(response.headers.get("content-length") || "0");
      if (contentLength > maxIconBytes) {
        return { error: "Remote icon is too large" };
      }

      const readResult = await readResponseBuffer(response, maxIconBytes, "Remote icon");
      if (!readResult.buffer) {
        return readResult;
      }

      return { buffer: readResult.buffer, finalUrl, response, resolvedFromPage: false };
    }

    if (!isHtmlContentType(response.headers.get("content-type"))) {
      return { error: "URL is not an image and no favicon was found" };
    }

    const readResult = await readResponseBuffer(response, maxHtmlProbeBytes, "HTML page", true);
    if (!readResult.buffer) {
      return readResult;
    }

    return { buffer: readResult.buffer, finalUrl, response, htmlProbe: true, truncated: readResult.truncated };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseAttributes(tag) {
  const attributes = {};
  const attrPattern = /([^\s=/"'>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match = attrPattern.exec(tag);

  while (match) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
    match = attrPattern.exec(tag);
  }

  return attributes;
}

function pushSafeCandidate(candidates, seen, value, pageUrl) {
  if (!value) {
    return;
  }

  try {
    const absoluteUrl = new URL(value, pageUrl).toString();
    const safeUrl = getSafeRemoteUrl(absoluteUrl);
    if (safeUrl && !seen.has(safeUrl)) {
      seen.add(safeUrl);
      candidates.push(safeUrl);
    }
  } catch {
    // Ignore invalid href values.
  }
}

export function extractFaviconCandidates(html, pageUrl) {
  const candidates = [];
  const seen = new Set();
  const content = String(html ?? "");
  const linkPattern = /<link\b[^>]*>/gi;
  let match = linkPattern.exec(content);

  while (match) {
    const attributes = parseAttributes(match[0]);
    const rel = String(attributes.rel ?? "").toLowerCase();
    const href = attributes.href;
    if (href && /\b(?:icon|apple-touch-icon|mask-icon|fluid-icon)\b/.test(rel)) {
      pushSafeCandidate(candidates, seen, href, pageUrl);
    }

    match = linkPattern.exec(content);
  }

  pushSafeCandidate(candidates, seen, "/favicon.ico", pageUrl);
  pushSafeCandidate(candidates, seen, "/favicon.svg", pageUrl);
  pushSafeCandidate(candidates, seen, "/apple-touch-icon.png", pageUrl);

  return candidates;
}

export async function fetchRemoteIcon(url) {
  const initial = await fetchInitialUrl(url);
  if (!initial.buffer) {
    return initial;
  }

  if (!initial.htmlProbe && isSupportedImageResponse(initial.response, initial.finalUrl || initial.response.url || url)) {
    return {
      buffer: initial.buffer,
      contentType: initial.response.headers.get("content-type") || "",
      sourceUrl: initial.finalUrl || initial.response.url || url,
      resolvedFromPage: false,
    };
  }

  const pageUrl = initial.finalUrl || initial.response.url || url;
  const html = initial.buffer.toString("utf8");
  const candidates = extractFaviconCandidates(html, pageUrl);

  for (const candidate of candidates) {
    const icon = await fetchBuffer(candidate, maxIconBytes, "Remote icon");
    if (!icon.buffer || !isSupportedImageResponse(icon.response, icon.finalUrl || icon.response.url || candidate)) {
      continue;
    }

    return {
      buffer: icon.buffer,
      contentType: icon.response.headers.get("content-type") || "",
      sourceUrl: icon.finalUrl || icon.response.url || candidate,
      resolvedFromPage: true,
    };
  }

  return { error: "URL is not an image and no favicon was found" };
}
