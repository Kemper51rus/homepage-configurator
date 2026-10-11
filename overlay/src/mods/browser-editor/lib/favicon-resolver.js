import net from "net";
import path from "path";
import dns from "dns";
import http from "http";
import https from "https";
import { Readable } from "stream";

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

function isDiscoveryPrivateIpv4(hostname) {
  if (net.isIP(hostname) !== 4 || hostname === "100.100.100.200") return false;
  const [first, second] = hostname.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127);
}

// Server-controlled, exact origins only. No DNS names or metadata/loopback ranges.
export function getIconDiscoveryApprovedOrigins(value) {
  try {
    const entries = JSON.parse(value || "[]");
    if (!Array.isArray(entries)) return [];
    return [...new Set(entries.flatMap((entry) => {
      if (typeof entry !== "string") return [];
      try {
        const url = new URL(entry);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
          url.pathname === "/" && !url.search && !url.hash && isDiscoveryPrivateIpv4(url.hostname)
          ? [url.origin] : [];
      } catch {
        return [];
      }
    }))];
  } catch {
    return [];
  }
}

export function getSafeRemoteUrl(value, { approvedOrigins = [] } = {}) {
  try {
    const rawValue = String(value ?? "").trim();
    const normalizedValue = /^[a-z][a-z0-9+.-]*:/i.test(rawValue) ? rawValue : `https://${rawValue}`;
    const url = new URL(normalizedValue);

    const approvedPrivateOrigin = isDiscoveryPrivateIpv4(url.hostname) && approvedOrigins.includes(url.origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (isPrivateHostname(url.hostname) && !approvedPrivateOrigin)) {
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

export function imageExtensionFromContentType(contentType) {
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

// Discovery has a stricter DNS/IP policy than the legacy manual download path.
function isPublicDiscoveryAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !isPrivateIpv4(address) && address !== "168.63.129.16" && !address.startsWith("192.88.99.");
  if (family !== 6 || address.includes("%")) return false;
  const normalized = address.toLowerCase();
  const [first, second] = normalized.split(":").map((part) => Number.parseInt(part || "0", 16));
  // Global unicast only; exclude protocol assignments, documentation and 6to4.
  return (first & 0xe000) === 0x2000 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    first !== 0x2002 && !(first === 0x3fff && second < 0x1000);
}

function lookupDiscoveryAddresses(hostname, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error("Icon discovery aborted"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) { abort(); return; }
      if (error) reject(error); else resolve(addresses);
    });
  });
}

export async function fetchDiscoveryResponse(value, { signal, approvedOrigins = [] } = {}) {
  const safeUrl = getSafeRemoteUrl(value, { approvedOrigins });
  if (!safeUrl) throw new Error("Remote URL is not allowed");
  const url = new URL(safeUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookupDiscoveryAddresses(hostname, signal);
  const trustedLiteral = literalFamily === 4 && isDiscoveryPrivateIpv4(hostname) && approvedOrigins.includes(url.origin);
  if (!addresses?.length || addresses.some(({ address, family }) =>
    net.isIP(address) !== family || (!isPublicDiscoveryAddress(address) && !(trustedLiteral && address === hostname)))) {
    throw new Error("Remote DNS address is not allowed");
  }
  if (signal?.aborted) throw signal.reason || new Error("Icon discovery aborted");
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET",
      agent: false,
      signal,
      headers: { "Accept-Encoding": "identity" },
      // Preserve URL hostname for HTTP Host and TLS verification, but never resolve it again.
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      },
    }, (incoming) => {
      const abort = () => incoming.destroy(signal.reason || new Error("Icon discovery aborted"));
      signal?.addEventListener("abort", abort, { once: true });
      incoming.once("close", () => signal?.removeEventListener("abort", abort));
      if (signal?.aborted) { abort(); reject(signal.reason || new Error("Icon discovery aborted")); return; }
      const encoding = String(incoming.headers["content-encoding"] || "identity").trim().toLowerCase();
      if (encoding !== "identity") { incoming.destroy(); reject(new Error("Compressed icon response is not supported")); return; }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value != null) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const status = incoming.statusCode;
      if (status < 200 || status > 599) { incoming.destroy(); reject(new Error("Invalid remote response")); return; }
      const noBody = [204, 205, 304].includes(status);
      if (noBody) incoming.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(incoming), {
        status,
        statusText: incoming.statusMessage,
        headers,
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fetchSafeResponse(url, signal, options) {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = getSafeRemoteUrl(currentUrl, options);
    if (!safeUrl) {
      return { error: "Remote URL is not allowed" };
    }

    let response;
    try {
      response = options?.discoveryTransport
        ? await fetchDiscoveryResponse(safeUrl, { signal, approvedOrigins: options.approvedOrigins })
        : await fetch(safeUrl, { redirect: "manual", signal });
    } catch (error) {
      if (options?.discoveryTransport) return { error: error?.message || "Failed to fetch icon" };
      throw error;
    }
    if (!isRedirectStatus(response.status)) {
      return { response, finalUrl: safeUrl };
    }

    if (options?.discoveryTransport) await response.body?.cancel().catch(() => {});
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

async function fetchBuffer(url, maxBytes, errorPrefix = "Remote file", options) {
  const controller = new AbortController();
  const timeoutMs = options?.deadline ? Math.max(1, Math.min(remoteFetchTimeoutMs, options.deadline - Date.now())) : remoteFetchTimeoutMs;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetched = await fetchSafeResponse(url, controller.signal, options);
    if (!fetched.response) {
      return { error: fetched.error || "Failed to fetch URL" };
    }

    const { finalUrl, response } = fetched;
    if (!response.ok) {
      if (options?.discoveryTransport) await response.body?.cancel().catch(() => {});
      return { error: `Failed to fetch URL: ${response.statusText}` };
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > maxBytes) {
      if (options?.discoveryTransport) await response.body?.cancel().catch(() => {});
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

async function fetchInitialUrl(url, options) {
  const controller = new AbortController();
  const timeoutMs = options?.deadline ? Math.max(1, Math.min(remoteFetchTimeoutMs, options.deadline - Date.now())) : remoteFetchTimeoutMs;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetched = await fetchSafeResponse(url, controller.signal, options);
    if (!fetched.response) {
      return { error: fetched.error || "Failed to fetch URL" };
    }

    const { finalUrl, response } = fetched;
    if (!response.ok) {
      if (options?.discoveryTransport) await response.body?.cancel().catch(() => {});
      return { error: `Failed to fetch URL: ${response.statusText}` };
    }

    if (isSupportedImageResponse(response, finalUrl || response.url || url)) {
      const contentLength = Number(response.headers.get("content-length") || "0");
      if (contentLength > maxIconBytes) {
        if (options?.discoveryTransport) await response.body?.cancel().catch(() => {});
        return { error: "Remote icon is too large" };
      }

      const readResult = await readResponseBuffer(response, maxIconBytes, "Remote icon");
      if (!readResult.buffer) {
        return readResult;
      }

      return { buffer: readResult.buffer, finalUrl, response, resolvedFromPage: false };
    }

    if (!isHtmlContentType(response.headers.get("content-type"))) {
      if (options?.discoveryTransport) await response.body?.cancel().catch(() => {});
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

function pushSafeCandidate(candidates, seen, value, pageUrl, options) {
  if (!value) {
    return;
  }

  try {
    const absoluteUrl = new URL(value, pageUrl).toString();
    const safeUrl = getSafeRemoteUrl(absoluteUrl, options);
    if (safeUrl && !seen.has(safeUrl)) {
      seen.add(safeUrl);
      candidates.push(safeUrl);
    }
  } catch {
    // Ignore invalid href values.
  }
}

export function extractFaviconCandidates(html, pageUrl, options) {
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
      pushSafeCandidate(candidates, seen, href, pageUrl, options);
    }

    match = linkPattern.exec(content);
  }

  pushSafeCandidate(candidates, seen, "/favicon.ico", pageUrl, options);
  pushSafeCandidate(candidates, seen, "/favicon.svg", pageUrl, options);
  pushSafeCandidate(candidates, seen, "/apple-touch-icon.png", pageUrl, options);

  return candidates;
}

export async function fetchRemoteIcon(url, { requireSamePageHost = false, approvedOrigins = [], totalTimeoutMs = 0, discoveryTransport = false } = {}) {
  const options = { approvedOrigins, discoveryTransport, deadline: totalTimeoutMs > 0 ? Date.now() + totalTimeoutMs : 0 };
  const initial = await fetchInitialUrl(url, options);
  if (!initial.buffer) {
    return initial;
  }

  // Discovery must not assign an unrelated login provider's favicon after a redirect.
  if (initial.htmlProbe && requireSamePageHost && new URL(initial.finalUrl || url).hostname !== new URL(url).hostname) {
    return { error: "Page redirected to another host" };
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
  const candidates = extractFaviconCandidates(html, pageUrl, options);

  for (const candidate of candidates) {
    if (options.deadline && Date.now() >= options.deadline) return { error: "Icon discovery timed out" };
    const icon = await fetchBuffer(candidate, maxIconBytes, "Remote icon", options);
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
