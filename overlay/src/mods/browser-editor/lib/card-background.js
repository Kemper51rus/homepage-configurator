const iconSetUrls = {
  mdi: "https://gcore.jsdelivr.net/npm/@mdi/svg@latest/svg/",
  si: "https://gcore.jsdelivr.net/npm/simple-icons@latest/icons/",
};

function stripIconColor(value) {
  return value.replace(/-#[a-f0-9]{6}$/i, "");
}

export function resolveCardBackgroundSource(value) {
  const source = String(value ?? "").trim();
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return "";

  if (source.startsWith("/")) return source;

  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      if (url.username || url.password) return "";
      return url.toString();
    } catch {
      return "";
    }
  }

  const prefix = source.split("-", 1)[0].toLowerCase();
  if (prefix === "mdi" || prefix === "si") {
    const iconName = stripIconColor(source)
      .replace(new RegExp(`^${prefix}-`, "i"), "")
      .replace(/\.svg$/i, "");
    return /^[a-z0-9._-]+$/i.test(iconName)
      ? `${iconSetUrls[prefix]}${iconName}.svg`
      : "";
  }

  if (prefix === "sh") {
    const iconName = source
      .replace(/^sh-/i, "")
      .replace(/\.(svg|png|webp)$/i, "");
    if (!/^[a-z0-9._-]+$/i.test(iconName)) return "";
    const extension = /\.svg$/i.test(source)
      ? "svg"
      : /\.webp$/i.test(source)
        ? "webp"
        : "png";
    return `https://gcore.jsdelivr.net/gh/selfhst/icons@main/${extension}/${iconName}.${extension}`;
  }

  if (!/^[a-z0-9._-]+$/i.test(source)) return "";
  const fileName = /\.[a-z0-9]+$/i.test(source) ? source : `${source}.png`;
  return `/api/config/icon/${fileName}`;
}

export function normalizeCardBackgroundPosition(value) {
  const position = String(value ?? "").trim();
  if (!position) return "50% 50%";

  const match = position.match(
    /^(\d{1,3}(?:\.\d+)?)%?\s+(\d{1,3}(?:\.\d+)?)%?$/,
  );
  if (!match) return "";

  const horizontal = Number(match[1]);
  const vertical = Number(match[2]);
  if (horizontal > 100 || vertical > 100) return "";

  return `${horizontal}% 50%`;
}

export function cardBackgroundStyle(value, position) {
  const source = resolveCardBackgroundSource(value);
  if (!source) return undefined;

  return {
    backgroundImage: `url("${source.replace(/["\\]/g, "\\$&")}")`,
    backgroundPosition: normalizeCardBackgroundPosition(position) || "50% 50%",
    backgroundRepeat: "no-repeat",
    backgroundSize: "auto 100%",
  };
}
