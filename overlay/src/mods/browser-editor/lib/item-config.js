import yaml from "js-yaml";

export const serviceFields = [
  ["id", "ID"],
  ["href", "URL"],
  ["icon", "Иконка"],
  ["description", "Описание"],
  ["abbr", "Сокращение"],
  ["target", "Цель"],
  ["weight", "Вес"],
  ["ping", "Пинг"],
  ["siteMonitor", "Мониторинг сайта"],
  ["showStats", "Показывать статистику"],
  ["proxmoxNode", "Узел Proxmox"],
  ["proxmoxVMID", "Proxmox VMID"],
  ["proxmoxType", "Тип Proxmox"],
];

export const collapsedServiceFieldKeys = new Set(["id", "description", "abbr", "target", "weight", "ping", "siteMonitor", "showStats"]);
export const collapsedBookmarkFieldKeys = new Set(["id", "description", "abbr", "target"]);

export const bookmarkFields = [
  ["id", "ID"],
  ["href", "URL"],
  ["icon", "Иконка"],
  ["description", "Описание"],
  ["abbr", "Сокращение"],
  ["target", "Цель"],
];

export const serviceCardColorOptions = [
  ["", "Без цвета", ""],
  ["color-sky", "Небесный", "#25C1FF"],
  ["color-yellow", "Жёлтый", "#FFC230"],
  ["color-green", "Зелёный", "#00C655"],
  ["color-red-orange", "Красно-оранжевый", "#ff3d00"],
  ["color-purple", "Фиолетовый", "#AA5CC3"],
  ["color-lime", "Лайм", "#39BA5D"],
  ["color-emerald", "Изумрудный", "#4ade80"],
  ["color-cyan", "Циан", "#22d3ee"],
  ["color-blue", "Синий", "#3eadff"],
  ["color-mint", "Мятный", "#61efad"],
  ["color-orange", "Оранжевый", "#ff7b00"],
  ["color-bright-green", "Ярко-зелёный", "#33cc33"],
  ["color-dark-red", "Тёмно-красный", "#96060c"],
  ["color-red", "Красный", "#ea2222"],
  ["color-teal", "Бирюзовый", "#3fb1db"],
  ["color-amber", "Янтарный", "#ff7700"],
  ["color-indigo", "Индиго", "#2a2978"],
];

const knownFields = {
  bookmarks: bookmarkFields.map(([key]) => key),
  services: serviceFields.map(([key]) => key),
};

function slugifyCardName(value) {
  const transliteration = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => transliteration[letter] ?? "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "service";
}

export function getServiceCardColor(id) {
  const normalizedId = String(id ?? "").trim();
  const match = serviceCardColorOptions.find(([value]) => value && normalizedId.startsWith(`${value}-`));
  return match?.[0] ?? "";
}

export function getServiceCardBaseId(id, itemName) {
  const normalizedId = String(id ?? "").trim();
  const color = getServiceCardColor(normalizedId);
  let base = normalizedId;

  if (color) {
    base = base.slice(color.length + 1);
  }

  if (base.endsWith("-card")) {
    base = base.slice(0, -5);
  }

  base = base.replace(/^-+|-+$/g, "");
  return base || slugifyCardName(itemName);
}

export function buildServiceCardId(id, itemName, color) {
  const base = getServiceCardBaseId(id, itemName);
  return color ? `${color}-${base}-card` : `${base}-card`;
}

export function valueToInput(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function parseInputValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return value;
}

export function splitConfig(config, type) {
  const fields = {};
  const extra = {};

  knownFields[type].forEach((key) => {
    fields[key] = "";
  });

  Object.entries(config ?? {}).forEach(([key, value]) => {
    if (knownFields[type].includes(key)) {
      fields[key] = valueToInput(value);
    } else {
      extra[key] = value;
    }
  });

  return {
    fields,
    extraYaml: Object.keys(extra).length ? yaml.dump(extra, { lineWidth: -1, noRefs: true, sortKeys: false }) : "",
  };
}

export function formToConfig(form) {
  const config = {};

  Object.entries(form.fields).forEach(([key, value]) => {
    const parsed = parseInputValue(value);
    if (parsed !== undefined) {
      config[key] = parsed;
    }
  });

  if (form.extraYaml.trim()) {
    const parsed = yaml.load(form.extraYaml);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Расширенный YAML должен быть объектом");
    }
    Object.assign(config, parsed);
  }

  return config;
}

export function validateItemConfig(type, config) {
  if (type !== "bookmarks") {
    return;
  }

  if (!config.href || typeof config.href !== "string") {
    throw new Error("URL закладки обязателен");
  }

  try {
    // Bookmark rendering expects an absolute URL when it derives the hostname.
    new URL(config.href);
  } catch {
    throw new Error("URL закладки должен быть абсолютным, например https://example.com");
  }
}
