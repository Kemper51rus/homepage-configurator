const tabOrderKey = "__browserEditorTabOrder";
const groupOrderKey = "__browserEditorGroupOrderByPage";

export const studioPageStyleFonts = [
  ["", "По умолчанию"],
  ["Comfortaa", "Comfortaa"],
  ["Inter", "Inter"],
  ["Roboto", "Roboto"],
  ["Outfit", "Outfit"],
  ["system-ui", "Системный"],
  ["Arial", "Arial"],
  ["Georgia", "Georgia"],
  ["Courier New", "Monospace"],
];
export const studioPageStyleFontSizes = [
  ["", "По умолчанию (14px)"],
  ["12px", "Очень маленький (12px)"],
  ["13px", "Маленький (13px)"],
  ["14px", "Стандартный (14px)"],
  ["15px", "Средний (15px)"],
  ["16px", "Увеличенный (16px)"],
  ["18px", "Крупный (18px)"],
  ["20px", "Очень крупный (20px)"],
  ["24px", "Огромный (24px)"],
];
export const studioPageStyleAlignments = [
  ["start", "Слева"],
  ["center", "По центру"],
  ["end", "Справа"],
  ["between", "Распределить"],
];
export const studioPageStyleBorders = [
  ["none", "Без рамки"],
  ["underline", "Подчёркивание"],
  ["underline-rounded", "Скруглённая линия"],
  ["outline", "Рамка контейнера"],
  ["pill", "Пилюли"],
  ["card", "Карточки"],
];
export const studioServiceStatusOffsetMin = -48;
export const studioServiceStatusOffsetMax = 48;

function namesEqual(left, right) {
  return (
    String(left ?? "")
      .trim()
      .toLocaleLowerCase("ru") ===
    String(right ?? "")
      .trim()
      .toLocaleLowerCase("ru")
  );
}

function rawGroupName(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  return String(Object.keys(entry)[0] ?? "").trim();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function optionValue(value, options, fallback) {
  const normalized = String(value ?? "");
  return options.some(([candidate]) => candidate === normalized)
    ? normalized
    : fallback;
}

function pageStyleColor(value) {
  const normalized = String(value ?? "").trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)
    ? normalized
    : "";
}

function serviceStatusOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(
    studioServiceStatusOffsetMax,
    Math.max(studioServiceStatusOffsetMin, Math.round(parsed)),
  );
}

export function studioPageStyleDraft(settings) {
  const styles = objectValue(settings?.pageStyles);
  return {
    activeColor: pageStyleColor(styles.activeColor),
    align: optionValue(styles.align, studioPageStyleAlignments, "start"),
    borderColor: pageStyleColor(styles.borderColor),
    borderStyle: optionValue(
      styles.borderStyle,
      studioPageStyleBorders,
      "none",
    ),
    fontFamily: optionValue(styles.fontFamily, studioPageStyleFonts, ""),
    fontSize: optionValue(styles.fontSize, studioPageStyleFontSizes, ""),
    hideTabBackground: styles.hideTabBackground === true,
    inactiveColor: pageStyleColor(styles.inactiveColor),
    serviceStatusOffsetX: serviceStatusOffset(styles.serviceStatusOffsetX),
    serviceStatusOffsetY: serviceStatusOffset(styles.serviceStatusOffsetY),
  };
}

export function updateStudioPageStyles(settings, draft) {
  const next = { ...objectValue(settings) };
  const styles = { ...objectValue(next.pageStyles) };
  const normalized = studioPageStyleDraft({ pageStyles: draft });
  const rawColors = ["activeColor", "inactiveColor", "borderColor"];

  rawColors.forEach((key) => {
    const rawValue = String(draft?.[key] ?? "").trim();
    if (rawValue && !normalized[key]) {
      throw new Error("Цвета должны быть указаны в формате #fff или #ffffff");
    }
  });

  const optionalValues = {
    activeColor: normalized.activeColor,
    borderColor: normalized.borderColor,
    fontFamily: normalized.fontFamily,
    fontSize: normalized.fontSize,
    inactiveColor: normalized.inactiveColor,
  };
  Object.entries(optionalValues).forEach(([key, value]) => {
    if (value) styles[key] = value;
    else delete styles[key];
  });

  if (normalized.align === "start") delete styles.align;
  else styles.align = normalized.align;
  if (normalized.borderStyle === "none") delete styles.borderStyle;
  else styles.borderStyle = normalized.borderStyle;
  if (normalized.hideTabBackground) styles.hideTabBackground = true;
  else delete styles.hideTabBackground;
  if (normalized.serviceStatusOffsetX) {
    styles.serviceStatusOffsetX = normalized.serviceStatusOffsetX;
  } else {
    delete styles.serviceStatusOffsetX;
  }
  if (normalized.serviceStatusOffsetY) {
    styles.serviceStatusOffsetY = normalized.serviceStatusOffsetY;
  } else {
    delete styles.serviceStatusOffsetY;
  }

  if (Object.keys(styles).length) next.pageStyles = styles;
  else delete next.pageStyles;
  return next;
}

function matchingKey(object, name) {
  return Object.keys(objectValue(object)).find((key) => namesEqual(key, name));
}

function groupLayout(settings, type, name) {
  const layout = objectValue(settings?.layout);
  if (type === "bookmarks") {
    const bookmarks = objectValue(layout.Bookmarks);
    const key = matchingKey(bookmarks, name);
    return key ? objectValue(bookmarks[key]) : {};
  }

  const key = matchingKey(layout, name);
  return key ? objectValue(layout[key]) : {};
}

function pageNameFromLayout(layout) {
  return typeof layout?.tab === "string" ? layout.tab.trim() : "";
}

function orderedPageNames(discovered, savedOrder = []) {
  const result = [];
  const add = (rawName) => {
    const name = String(rawName ?? "").trim();
    const discoveredName = discovered.find((page) => namesEqual(page, name));
    if (
      discoveredName &&
      !result.some((existing) => namesEqual(existing, discoveredName))
    ) {
      result.push(discoveredName);
    }
  };
  savedOrder.forEach(add);
  discovered.forEach(add);
  return result;
}

export function studioPageGroupKey(type, name) {
  return `${type}:${String(name ?? "").trim()}`;
}

export function studioPageRecords(settings, services = [], bookmarks = []) {
  const groups = [
    ...services.map((entry) => ({ entry, type: "services" })),
    ...bookmarks.map((entry) => ({ entry, type: "bookmarks" })),
  ]
    .map(({ entry, type }) => {
      const name = rawGroupName(entry);
      if (!name) return null;
      const rawItems = entry[name];
      return {
        itemCount: Array.isArray(rawItems) ? rawItems.length : 0,
        key: studioPageGroupKey(type, name),
        name,
        pageName: pageNameFromLayout(groupLayout(settings, type, name)),
        type,
      };
    })
    .filter(Boolean);

  const discovered = [];
  groups.forEach((group) => {
    if (
      group.pageName &&
      !discovered.some((page) => namesEqual(page, group.pageName))
    ) {
      discovered.push(group.pageName);
    }
  });
  const pageNames = orderedPageNames(
    discovered,
    Array.isArray(settings?.[tabOrderKey]) ? settings[tabOrderKey] : [],
  );
  const icons = objectValue(settings?.pageStyles?.icons);

  return {
    groups,
    pages: pageNames.map((name) => ({
      groups: groups.filter((group) => namesEqual(group.pageName, name)),
      icon: icons[matchingKey(icons, name) ?? ""] ?? "",
      name,
    })),
  };
}

function validatePageName(value) {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("Название страницы обязательно");
  if (name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("Название страницы содержит недопустимые символы");
  }
  return name;
}

function setGroupPage(layout, type, name, pageName) {
  if (type === "bookmarks") {
    const bookmarks = { ...objectValue(layout.Bookmarks) };
    const key = matchingKey(bookmarks, name) ?? name;
    const nextGroupLayout = { ...objectValue(bookmarks[key]) };
    if (pageName) nextGroupLayout.tab = pageName;
    else delete nextGroupLayout.tab;
    bookmarks[key] = nextGroupLayout;
    return { ...layout, Bookmarks: bookmarks };
  }

  const key = matchingKey(layout, name) ?? name;
  const nextGroupLayout = { ...objectValue(layout[key]) };
  if (pageName) nextGroupLayout.tab = pageName;
  else delete nextGroupLayout.tab;
  return { ...layout, [key]: nextGroupLayout };
}

function updatePageIcon(settings, previousName, name, icon, mode) {
  const pageStyles = { ...objectValue(settings.pageStyles) };
  const icons = { ...objectValue(pageStyles.icons) };
  const oldIconKey = previousName ? matchingKey(icons, previousName) : null;
  if (oldIconKey) delete icons[oldIconKey];

  const targetIconKey = name ? matchingKey(icons, name) : null;
  if (targetIconKey) delete icons[targetIconKey];
  if (mode !== "delete" && icon) icons[name] = icon;

  if (Object.keys(icons).length) pageStyles.icons = icons;
  else delete pageStyles.icons;
  if (Object.keys(pageStyles).length) settings.pageStyles = pageStyles;
  else delete settings.pageStyles;
}

function updatePageGroupOrder(settings, previousName, name, mode) {
  const current = objectValue(settings[groupOrderKey]);
  const next = { ...current };
  const previousKey = previousName ? matchingKey(next, previousName) : null;
  const previousOrder = previousKey ? next[previousKey] : undefined;
  if (previousKey) delete next[previousKey];
  if (mode !== "delete" && previousOrder !== undefined) {
    next[name] = previousOrder;
  }
  if (Object.keys(next).length) settings[groupOrderKey] = next;
  else delete settings[groupOrderKey];
}

export function updateStudioPageSettings(
  settings,
  services,
  bookmarks,
  { icon = "", mode = "save", name, previousName = "", selectedGroupKeys = [] },
) {
  const before = studioPageRecords(settings, services, bookmarks);
  const normalizedPreviousName = String(previousName ?? "").trim();
  const deleting = mode === "delete";
  const normalizedName = deleting ? "" : validatePageName(name);

  if (
    !deleting &&
    before.pages.some(
      (page) =>
        namesEqual(page.name, normalizedName) &&
        !namesEqual(page.name, normalizedPreviousName),
    )
  ) {
    throw new Error("Страница с таким названием уже существует");
  }

  const knownGroupKeys = new Set(before.groups.map((group) => group.key));
  const selected = new Set(
    selectedGroupKeys.filter((key) => knownGroupKeys.has(key)),
  );
  if (!deleting && selected.size === 0) {
    throw new Error("Выберите хотя бы одну группу для страницы");
  }

  const next = { ...objectValue(settings) };
  let nextLayout = { ...objectValue(next.layout) };
  before.groups.forEach((group) => {
    let nextPageName = group.pageName;
    if (deleting) {
      if (namesEqual(group.pageName, normalizedPreviousName)) nextPageName = "";
    } else if (selected.has(group.key)) {
      nextPageName = normalizedName;
    } else if (
      normalizedPreviousName &&
      namesEqual(group.pageName, normalizedPreviousName)
    ) {
      nextPageName = "";
    }

    if (!namesEqual(nextPageName, group.pageName)) {
      nextLayout = setGroupPage(
        nextLayout,
        group.type,
        group.name,
        nextPageName,
      );
    }
  });
  next.layout = nextLayout;

  const normalizedIcon = String(icon ?? "").trim();
  if (
    normalizedIcon.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalizedIcon)
  ) {
    throw new Error("Некорректное имя иконки");
  }
  updatePageIcon(
    next,
    normalizedPreviousName,
    normalizedName,
    normalizedIcon,
    mode,
  );
  updatePageGroupOrder(next, normalizedPreviousName, normalizedName, mode);

  const after = studioPageRecords(next, services, bookmarks);
  const preferredOrder = before.pages.map((page) =>
    normalizedPreviousName && namesEqual(page.name, normalizedPreviousName)
      ? normalizedName
      : page.name,
  );
  if (
    !deleting &&
    !preferredOrder.some((page) => namesEqual(page, normalizedName))
  ) {
    preferredOrder.push(normalizedName);
  }
  const nextOrder = orderedPageNames(
    after.pages.map((page) => page.name),
    preferredOrder,
  );
  if (nextOrder.length) next[tabOrderKey] = nextOrder;
  else delete next[tabOrderKey];

  return {
    name: normalizedName,
    settings: next,
  };
}
