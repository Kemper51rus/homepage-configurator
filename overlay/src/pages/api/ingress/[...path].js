import { normalizeLocalIconPath } from "mods/browser-editor/lib/local-icon-path";

// Compatibility for stale icon URLs only. Authentik remains the auth boundary;
// this route never reads/proxies an icon or forwards credentials/query strings.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }

  const query = req.query;
  const segments = query?.path;
  if (!query || Object.keys(query).some((key) => key !== "path") || !Array.isArray(segments) || !segments.length) {
    return res.status(404).end();
  }

  // Next has already decoded each catch-all segment: a decoded slash must not
  // become an extra path boundary when joining. Never decode a second time.
  if (segments.some((segment) => typeof segment !== "string" || !segment || segment === "." || segment === ".." || /[/\\\u0000-\u001f\u007f-\u009f]/u.test(segment))) {
    return res.status(404).end();
  }

  const path = `/api/ingress/${segments.join("/")}`;
  const canonical = normalizeLocalIconPath(path);
  if (canonical === path) return res.status(404).end();

  const filename = canonical.slice("/api/config/icon/".length);
  res.setHeader("Location", `/api/config/icon/${encodeURIComponent(filename)}`);
  return res.status(307).end();
}
