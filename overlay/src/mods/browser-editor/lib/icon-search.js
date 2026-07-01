const iconFileExtensions = new Set([".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const iconVariantSuffixes = [
  "dark",
  "light",
  "black",
  "white",
  "colour",
  "color",
  "colored",
  "mono",
  "monochrome",
  "transparent",
];

function withoutIconPrefix(value) {
  return String(value ?? "").trim().toLowerCase().replace(/^(?:si|mdi|sh)-/, "");
}

export function iconFileName(filePath) {
  return String(filePath ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
}

function iconFileExtension(filePath) {
  const match = iconFileName(filePath).match(/(\.[^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

export function isSupportedIconFile(filePath) {
  return iconFileExtensions.has(iconFileExtension(filePath));
}

export function normalizeIconSearchText(value) {
  const fileName = iconFileName(withoutIconPrefix(value));
  const withoutExtension = fileName.replace(/\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i, "");

  return withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function compact(value) {
  return String(value ?? "").replace(/[^a-z0-9]+/g, "");
}

export function iconBaseNameWithoutVariant(value) {
  let normalized = normalizeIconSearchText(value);
  let changed = true;

  while (changed) {
    changed = false;
    for (const suffix of iconVariantSuffixes) {
      const token = `-${suffix}`;
      if (normalized.endsWith(token)) {
        normalized = normalized.slice(0, -token.length);
        changed = true;
      }
    }
  }

  return normalized;
}

export function iconNameMatchesQuery(filePath, query) {
  const normalizedQuery = normalizeIconSearchText(query);
  if (!normalizedQuery) {
    return false;
  }

  const normalizedName = normalizeIconSearchText(filePath);
  if (!normalizedName) {
    return false;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return true;
  }

  const baseName = iconBaseNameWithoutVariant(filePath);
  if (baseName.includes(normalizedQuery)) {
    return true;
  }

  const compactQuery = compact(normalizedQuery);
  return Boolean(
    compactQuery &&
      (compact(normalizedName).includes(compactQuery) || compact(baseName).includes(compactQuery)),
  );
}

export function iconSearchScore(filePath, query) {
  const normalizedQuery = normalizeIconSearchText(query);
  const normalizedName = normalizeIconSearchText(filePath);
  const baseName = iconBaseNameWithoutVariant(filePath);
  const extension = iconFileExtension(filePath);
  const extensionScore = [".png", ".svg", ".webp", ".avif", ".ico", ".jpg", ".jpeg", ".gif"].indexOf(extension);
  const safeExtensionScore = extensionScore === -1 ? 99 : extensionScore;

  if (normalizedName === normalizedQuery) {
    return safeExtensionScore;
  }

  if (baseName === normalizedQuery) {
    return 10 + safeExtensionScore;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 20 + safeExtensionScore;
  }

  if (baseName.startsWith(normalizedQuery)) {
    return 30 + safeExtensionScore;
  }

  return 100 + safeExtensionScore;
}
