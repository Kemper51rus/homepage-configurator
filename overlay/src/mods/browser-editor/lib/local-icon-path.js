// Repair only the known local-icon corruption. Never resolve URLs or decode paths:
// encoded separators, traversal, query strings and unrelated routes stay untouched.
const ingressLocalIcon = /^(?:\/api\/ingress\/[A-Za-z0-9_-]+)+(\/api\/config\/icon\/([\p{L}\p{M}\p{N} _().-]+\.(?:gif|ico|jpe?g|png|svg|webp)))$/iu;

export function normalizeLocalIconPath(value) {
  if (typeof value !== "string") return value;
  const match = ingressLocalIcon.exec(value);
  if (!match || match[0] !== value || match[2].startsWith(".") || match[2].includes("..")) return value;
  return match[1];
}

// Copy only changed branches, so callers can preserve raw YAML byte-for-byte
// when no icon needs repair. Do not touch href, text or other string fields.
export function normalizeLocalIconFields(value, ancestors = new Set()) {
  if (!value || typeof value !== "object" || ancestors.has(value)) return value;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }
  ancestors.add(value);
  let changed = false;
  const entries = Object.entries(value).map(([key, child]) => {
    const next = key === "icon" && typeof child === "string"
      ? normalizeLocalIconPath(child)
      : normalizeLocalIconFields(child, ancestors);
    if (next !== child) changed = true;
    return [key, next];
  });
  ancestors.delete(value);
  if (!changed) return value;
  return Array.isArray(value) ? entries.map(([, child]) => child) : Object.fromEntries(entries);
}
