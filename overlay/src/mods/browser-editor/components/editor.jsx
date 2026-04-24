import classNames from "classnames";
import yaml from "js-yaml";
import Prism from "prismjs";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-yaml";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { SettingsContext } from "utils/contexts/settings";
import { TabContext } from "utils/contexts/tab";

const ConfigEditorContext = createContext({
  draggedGroup: null,
  setDraggedGroup: () => {},
  editMode: false,
  moveTab: () => {},
  moveGroup: () => {},
  moveItem: () => {},
  openGroup: () => {},
  openItem: () => {},
  openNewGroup: () => {},
  openNewItem: () => {},
});

const noopEditorContext = {
  draggedGroup: null,
  setDraggedGroup: () => {},
  editMode: false,
  moveTab: () => {},
  moveGroup: () => {},
  moveItem: () => {},
  openGroup: () => {},
  openItem: () => {},
  openNewGroup: () => {},
  openNewItem: () => {},
};

const toolbarButtonClassName =
  "rounded-md border border-theme-300/40 bg-theme-100/20 px-4 py-2 text-sm font-medium text-theme-800 shadow-md shadow-theme-900/10 backdrop-blur-sm transition-colors hover:bg-theme-300/20 dark:border-white/10 dark:bg-white/5 dark:text-theme-100 dark:shadow-theme-900/20 dark:hover:bg-white/10";

const toolbarPrimaryButtonClassName =
  "rounded-md border border-theme-400/60 bg-theme-200/60 px-4 py-2 text-sm font-medium text-theme-900 shadow-md shadow-theme-900/10 backdrop-blur-sm transition-colors hover:bg-theme-300/40 dark:border-white/20 dark:bg-white/10 dark:text-theme-100 dark:shadow-theme-900/20 dark:hover:bg-white/20";

const JSON_DRAG_TYPE = "application/json";
const GROUP_DRAG_TYPE = "application/x-homepage-browser-editor-group";
const ITEM_DRAG_TYPE = "application/x-homepage-browser-editor-item";
const TAB_DRAG_TYPE = "application/x-homepage-browser-editor-tab";
const CODE_EDITOR_ZOOM_STORAGE_KEY = "homepage-browser-editor-code-zoom";
const CODE_EDITOR_MIN_ZOOM = 1;
const CODE_EDITOR_MAX_ZOOM = 500;

let activeDragPayload = null;

const serviceFields = [
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

const collapsedServiceFieldKeys = new Set(["id", "description", "abbr", "target", "weight", "ping", "siteMonitor", "showStats"]);
const collapsedBookmarkFieldKeys = new Set(["id", "description", "abbr", "target"]);
const BOOKMARK_YAML_ZOOM_STORAGE_KEY = "homepage-browser-editor-code-zoom-item-bookmarks";

const bookmarkFields = [
  ["id", "ID"],
  ["href", "URL"],
  ["icon", "Иконка"],
  ["description", "Описание"],
  ["abbr", "Сокращение"],
  ["target", "Цель"],
];

const serviceCardColorOptions = [
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

function getServiceCardColor(id) {
  const normalizedId = String(id ?? "").trim();
  const match = serviceCardColorOptions.find(([value]) => value && normalizedId.startsWith(`${value}-`));
  return match?.[0] ?? "";
}

function getServiceCardBaseId(id, itemName) {
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

function buildServiceCardId(id, itemName, color) {
  const base = getServiceCardBaseId(id, itemName);
  return color ? `${color}-${base}-card` : `${base}-card`;
}

function valueToInput(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function parseInputValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return value;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function splitConfig(config, type) {
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

function formToConfig(form) {
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

function validateItemConfig(type, config) {
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

function getEntryName(entry) {
  return Object.keys(entry)[0];
}

function getEntryValue(entry) {
  return entry[getEntryName(entry)];
}

function namesEqual(left, right) {
  return String(left ?? "").trim() === String(right ?? "").trim();
}

function isMatcherField(type, key) {
  return !(type === "services" && key === "weight");
}

function normalizeComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeComparableValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = normalizeComparableValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function comparableValuesEqual(left, right) {
  return JSON.stringify(normalizeComparableValue(left)) === JSON.stringify(normalizeComparableValue(right));
}

function createItemMatcher(type, itemName, itemConfig = {}) {
  const config = {};

  knownFields[type].forEach((key) => {
    if (isMatcherField(type, key) && itemConfig?.[key] !== undefined) {
      config[key] = normalizeComparableValue(itemConfig[key]);
    }
  });

  return {
    name: itemName,
    config,
  };
}

function createEntryMatcher(entry, type) {
  return createItemMatcher(type, getEntryName(entry), rawEntryToConfig(entry, type));
}

function itemMatcherEquals(left, right) {
  if (!left || !right) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function entryMatchesItemMatcher(entry, type, itemName, matcher = null) {
  if (!namesEqual(getEntryName(entry), itemName)) {
    return false;
  }

  if (!matcher) {
    return true;
  }

  return itemMatcherEquals(createEntryMatcher(entry, type), matcher);
}

function findItemEntryIndex(entries = [], type, itemName, matcher = null) {
  const exactIndex = entries.findIndex(
    (entry) => isItemEntry(entry, type) && entryMatchesItemMatcher(entry, type, itemName, matcher),
  );

  if (exactIndex >= 0 || !matcher) {
    return exactIndex;
  }

  const namedIndexes = entries.reduce((indexes, entry, index) => {
    if (isItemEntry(entry, type) && namesEqual(getEntryName(entry), itemName)) {
      indexes.push(index);
    }

    return indexes;
  }, []);

  return namedIndexes.length === 1 ? namedIndexes[0] : -1;
}

function isItemEntry(entry, type) {
  const value = getEntryValue(entry);
  if (type === "services") {
    return !Array.isArray(value);
  }

  return Array.isArray(value);
}

function countMatchingRawEntries(rawGroups, type, matchesEntry) {
  let count = 0;

  const countInEntries = (entries = [], currentGroup) => {
    entries.forEach((entry) => {
      const name = getEntryName(entry);
      const value = entry[name];

      if (isItemEntry(entry, type) && matchesEntry(entry, currentGroup)) {
        count += 1;
      }

      if (type === "services" && Array.isArray(value)) {
        countInEntries(value, name);
      }
    });
  };

  (rawGroups ?? []).forEach((group) => {
    const currentGroup = getEntryName(group);
    countInEntries(group[currentGroup], currentGroup);
  });

  return count;
}

function getMatcherConfigValue(matcher, key) {
  if (!matcher?.config || !Object.prototype.hasOwnProperty.call(matcher.config, key)) {
    return undefined;
  }

  return matcher.config[key];
}

function rawEntryConfigValueEquals(entry, type, key, value) {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  const config = rawEntryToConfig(entry, type);
  return config?.[key] !== undefined && comparableValuesEqual(config[key], value);
}

function findUniqueRawEntryPredicate(rawGroups, type, predicates) {
  return predicates.find((matchesEntry) => countMatchingRawEntries(rawGroups, type, matchesEntry) === 1) ?? null;
}

function normalizedItemIndex(itemIndex) {
  const numericIndex = Number(itemIndex);
  return Number.isInteger(numericIndex) && numericIndex >= 0 ? numericIndex : null;
}

function getRenderedItemEntryIndexes(entries = [], type) {
  const itemEntries = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => isItemEntry(entry, type));

  if (type !== "services") {
    return itemEntries.map(({ index }) => index);
  }

  return itemEntries
    .map(({ entry, index }, serviceIndex) => ({
      entry: {
        [getEntryName(entry)]: {
          ...getEntryValue(entry),
          weight:
            typeof getEntryValue(entry)?.weight === "number" ? getEntryValue(entry).weight : (serviceIndex + 1) * 100,
        },
      },
      index,
    }))
    .sort((entryA, entryB) => compareServiceEntriesByWeight(entryA.entry, entryB.entry))
    .map(({ index }) => index);
}

function getRenderedItemRawIndex(entries = [], type, itemIndex = null) {
  const normalizedIndex = normalizedItemIndex(itemIndex);
  if (normalizedIndex === null) {
    return -1;
  }

  return getRenderedItemEntryIndexes(entries, type)[normalizedIndex] ?? -1;
}

function rawItemFallbackPredicates(rawGroups, type, groupName, itemName, itemMatcher = null) {
  const matcherId = getMatcherConfigValue(itemMatcher, "id");
  const matcherHref = getMatcherConfigValue(itemMatcher, "href");
  const predicates = [
    (entry, currentGroup) =>
      namesEqual(currentGroup, groupName) && entryMatchesItemMatcher(entry, type, itemName, null),
  ];

  if (type === "services" && matcherId !== undefined) {
    predicates.push(
      (entry, currentGroup) =>
        namesEqual(currentGroup, groupName) && rawEntryConfigValueEquals(entry, type, "id", matcherId),
      (entry) => rawEntryConfigValueEquals(entry, type, "id", matcherId),
    );
  }

  if (matcherHref !== undefined) {
    predicates.push(
      (entry, currentGroup) =>
        namesEqual(currentGroup, groupName) && rawEntryConfigValueEquals(entry, type, "href", matcherHref),
      (entry) => rawEntryConfigValueEquals(entry, type, "href", matcherHref),
    );
  }

  if (itemMatcher) {
    predicates.push((entry) => entryMatchesItemMatcher(entry, type, itemName, itemMatcher));
  }

  predicates.push((entry) => entryMatchesItemMatcher(entry, type, itemName, null));

  return predicates.filter((predicate) => countMatchingRawEntries(rawGroups, type, predicate) > 0);
}

function rawEntryToConfig(entry, type) {
  const value = getEntryValue(entry);

  if (type === "bookmarks") {
    if (Array.isArray(value)) {
      return value[0] ?? {};
    }

    return value && typeof value === "object" ? value : {};
  }

  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function configToRawEntry(type, itemName, itemConfig) {
  if (type === "bookmarks") {
    return { [itemName]: [itemConfig] };
  }

  return { [itemName]: itemConfig };
}

function findRawEntry(
  rawGroups,
  type,
  groupName,
  itemName,
  itemMatcher = null,
  itemIndex = null,
  allowNameFallback = true,
) {
  const findWithPredicate = (matchesEntry) => {
    const findInEntries = (entries = [], currentGroup) => {
      for (const entry of entries) {
        const name = getEntryName(entry);
        const value = entry[name];

        if (isItemEntry(entry, type) && matchesEntry(entry, currentGroup)) {
          return rawEntryToConfig(entry, type);
        }

        if (type === "services" && Array.isArray(value)) {
          const nested = findInEntries(value, name);
          if (nested) return nested;
        }
      }

      return null;
    };

    for (const group of rawGroups ?? []) {
      const currentGroup = getEntryName(group);
      const found = findInEntries(group[currentGroup], currentGroup);
      if (found) return found;
    }

    return null;
  };

  const findInEntries = (entries = [], currentGroup) => {
    for (const entry of entries) {
      const name = getEntryName(entry);
      const value = entry[name];

      if (
        namesEqual(currentGroup, groupName) &&
        isItemEntry(entry, type) &&
        entryMatchesItemMatcher(entry, type, itemName, itemMatcher)
      ) {
        return rawEntryToConfig(entry, type);
      }

      if (type === "services" && Array.isArray(value)) {
        const nested = findInEntries(value, name);
        if (nested) return nested;
      }
    }

    return null;
  };

  for (const group of rawGroups ?? []) {
    const currentGroup = getEntryName(group);
    const found = findInEntries(group[currentGroup], currentGroup);
    if (found) return found;
  }

  if (allowNameFallback) {
    const fallbackPredicate = findUniqueRawEntryPredicate(
      rawGroups,
      type,
      rawItemFallbackPredicates(rawGroups, type, groupName, itemName, itemMatcher),
    );

    if (fallbackPredicate) {
      return findWithPredicate(fallbackPredicate);
    }

    const indexMatch = findWithRenderedIndex(rawGroups, type, groupName, itemIndex);
    if (indexMatch) {
      return indexMatch;
    }
  }

  return null;
}

function findWithRenderedIndex(rawGroups, type, groupName, itemIndex) {
  const findInEntries = (entries = [], currentGroup) => {
    if (namesEqual(currentGroup, groupName)) {
      const rawIndex = getRenderedItemRawIndex(entries, type, itemIndex);
      const entry = entries[rawIndex];
      if (entry && isItemEntry(entry, type)) {
        return rawEntryToConfig(entry, type);
      }
    }

    for (const entry of entries) {
      const name = getEntryName(entry);
      const value = entry[name];

      if (type === "services" && Array.isArray(value)) {
        const nested = findInEntries(value, name);
        if (nested) return nested;
      }
    }

    return null;
  };

  for (const group of rawGroups ?? []) {
    const currentGroup = getEntryName(group);
    const found = findInEntries(group[currentGroup], currentGroup);
    if (found) return found;
  }

  return null;
}

function updateRawEntry(
  rawGroups,
  type,
  groupName,
  originalName,
  originalMatcher,
  originalIndex,
  nextName,
  nextConfig,
) {
  const updateWithPredicate = (matchesEntry) => {
    let changed = false;

    const updateEntries = (entries = [], currentGroup) =>
      entries.map((entry) => {
        const name = getEntryName(entry);
        const value = entry[name];

        if (isItemEntry(entry, type) && !changed && matchesEntry(entry, currentGroup)) {
          changed = true;
          return configToRawEntry(type, nextName, nextConfig);
        }

        if (type === "services" && Array.isArray(value)) {
          return { [name]: updateEntries(value, name) };
        }

        return entry;
      });

    const nextGroups = (rawGroups ?? []).map((group) => {
      const name = getEntryName(group);
      const entries = group[name] ?? [];

      return { [name]: updateEntries(entries, name) };
    });

    return { changed, nextGroups };
  };

  const updateWithRenderedIndex = () => {
    let changed = false;

    const updateEntries = (entries = [], currentGroup) => {
      const rawIndex = namesEqual(currentGroup, groupName) ? getRenderedItemRawIndex(entries, type, originalIndex) : -1;

      return entries.map((entry, index) => {
        const name = getEntryName(entry);
        const value = entry[name];

        if (isItemEntry(entry, type) && !changed && index === rawIndex) {
          changed = true;
          return configToRawEntry(type, nextName, nextConfig);
        }

        if (type === "services" && Array.isArray(value)) {
          return { [name]: updateEntries(value, name) };
        }

        return entry;
      });
    };

    const nextGroups = (rawGroups ?? []).map((group) => {
      const name = getEntryName(group);
      const entries = group[name] ?? [];

      return { [name]: updateEntries(entries, name) };
    });

    return { changed, nextGroups };
  };

  let result = updateWithPredicate(
    (entry, currentGroup) =>
      namesEqual(currentGroup, groupName) && entryMatchesItemMatcher(entry, type, originalName, originalMatcher),
  );

  if (!result.changed) {
    const fallbackPredicate = findUniqueRawEntryPredicate(
      rawGroups,
      type,
      rawItemFallbackPredicates(rawGroups, type, groupName, originalName, originalMatcher),
    );

    if (fallbackPredicate) {
      result = updateWithPredicate(fallbackPredicate);
    }
  }

  if (!result.changed) {
    result = updateWithRenderedIndex();
  }

  if (!result.changed) {
    throw new Error("Исходная карточка не найдена. Обновите страницу и попробуйте снова.");
  }

  return result.nextGroups;
}

function addRawEntry(rawGroups, type, groupName, itemName, itemConfig) {
  let added = false;

  const addToEntries = (entries = [], currentGroup) => {
    if (namesEqual(currentGroup, groupName)) {
      added = true;
      return [...entries, configToRawEntry(type, itemName, itemConfig)];
    }

    return entries.map((entry) => {
      const name = getEntryName(entry);
      const value = entry[name];
      return type === "services" && Array.isArray(value) ? { [name]: addToEntries(value, name) } : entry;
    });
  };

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    return { [name]: addToEntries(group[name], name) };
  });

  if (added) return nextGroups;
  return [...nextGroups, { [groupName]: [configToRawEntry(type, itemName, itemConfig)] }];
}

function addRawGroup(rawGroups, groupName, type) {
  if ((rawGroups ?? []).some((group) => namesEqual(getEntryName(group), groupName))) {
    throw new Error("Группа уже существует");
  }

  if (type === "services") {
    return [...(rawGroups ?? []), { [groupName]: [{ "Новый сервис": { href: "#", weight: 100 } }] }];
  }

  return [...(rawGroups ?? []), { [groupName]: [] }];
}

function renameRawGroup(rawGroups, originalName, nextName) {
  let renamed = false;

  const renameGroups = (groups = []) =>
    groups.map((group) => {
      const name = getEntryName(group);
      const value = group[name];

      if (namesEqual(name, originalName)) {
        renamed = true;
        return { [nextName]: value ?? [] };
      }

      if (Array.isArray(value)) {
        return { [name]: renameGroups(value) };
      }

      return group;
    });

  const nextGroups = renameGroups(rawGroups);

  if (!renamed) {
    return addRawGroup(nextGroups, nextName);
  }

  return nextGroups;
}

function deleteRawGroup(rawGroups, groupName) {
  return extractNamedNode(rawGroups, groupName).nodes;
}

function deleteRawEntry(rawGroups, type, groupName, itemName, itemMatcher = null, itemIndex = null) {
  const deleteWithPredicate = (matchesEntry) => {
    let removed = false;

    const filterEntries = (entries = [], currentGroup) =>
      entries
        .filter((entry) => {
          if (!isItemEntry(entry, type) || removed) {
            return true;
          }

          if (matchesEntry(entry, currentGroup)) {
            removed = true;
            return false;
          }

          return true;
        })
        .map((entry) => {
          const name = getEntryName(entry);
          const value = entry[name];
          return type === "services" && Array.isArray(value) ? { [name]: filterEntries(value, name) } : entry;
        });

    const nextGroups = (rawGroups ?? []).map((group) => {
      const name = getEntryName(group);
      return { [name]: filterEntries(group[name], name) };
    });

    return { removed, nextGroups };
  };

  const deleteWithRenderedIndex = () => {
    let removed = false;

    const filterEntries = (entries = [], currentGroup) => {
      const rawIndex = namesEqual(currentGroup, groupName) ? getRenderedItemRawIndex(entries, type, itemIndex) : -1;

      return entries
        .filter((entry, index) => {
          if (!isItemEntry(entry, type) || removed || index !== rawIndex) {
            return true;
          }

          removed = true;
          return false;
        })
        .map((entry) => {
          const name = getEntryName(entry);
          const value = entry[name];
          return type === "services" && Array.isArray(value) ? { [name]: filterEntries(value, name) } : entry;
        });
    };

    const nextGroups = (rawGroups ?? []).map((group) => {
      const name = getEntryName(group);
      return { [name]: filterEntries(group[name], name) };
    });

    return { removed, nextGroups };
  };

  let result = deleteWithPredicate(
    (entry, currentGroup) =>
      namesEqual(currentGroup, groupName) && entryMatchesItemMatcher(entry, type, itemName, itemMatcher),
  );

  if (!result.removed) {
    const fallbackPredicate = findUniqueRawEntryPredicate(
      rawGroups,
      type,
      rawItemFallbackPredicates(rawGroups, type, groupName, itemName, itemMatcher),
    );

    if (fallbackPredicate) {
      result = deleteWithPredicate(fallbackPredicate);
    }
  }

  if (!result.removed) {
    result = deleteWithRenderedIndex();
  }

  if (!result.removed) {
    throw new Error("Исходная карточка не найдена. Обновите страницу и попробуйте снова.");
  }

  return result.nextGroups;
}

function resetServiceWeights(entries) {
  return entries.map((entry, index) => {
    const name = getEntryName(entry);
    const value = entry[name];

    if (Array.isArray(value)) {
      return entry;
    }

    return {
      [name]: {
        ...value,
        weight: (index + 1) * 100,
      },
    };
  });
}

function compareServiceEntriesByWeight(entryA, entryB) {
  const valueA = getEntryValue(entryA);
  const valueB = getEntryValue(entryB);
  const weightDiff = valueA.weight - valueB.weight;

  if (weightDiff !== 0) {
    return weightDiff;
  }

  return getEntryName(entryA).localeCompare(getEntryName(entryB));
}

function getSortedServiceEntries(entries = []) {
  const serviceEntries = [];
  let serviceIndex = 0;

  entries.forEach((entry) => {
    const value = getEntryValue(entry);
    if (Array.isArray(value)) {
      return;
    }

    serviceEntries.push({
      entry,
      effectiveWeight: typeof value?.weight === "number" ? value.weight : (serviceIndex + 1) * 100,
    });
    serviceIndex += 1;
  });

  return serviceEntries
    .map(({ entry, effectiveWeight }) => ({
      [getEntryName(entry)]: {
        ...getEntryValue(entry),
        weight: effectiveWeight,
      },
    }))
    .sort(compareServiceEntriesByWeight);
}

function applyWeightedServiceEntries(entries = [], weightedServiceEntries = []) {
  const remainingWeightedEntries = [...weightedServiceEntries];

  return entries.map((entry) => {
    const value = getEntryValue(entry);
    if (Array.isArray(value)) {
      return entry;
    }

    const entryMatcher = createEntryMatcher(entry, "services");
    const weightedIndex = remainingWeightedEntries.findIndex((weightedEntry) =>
      itemMatcherEquals(createEntryMatcher(weightedEntry, "services"), entryMatcher),
    );

    if (weightedIndex < 0) {
      return entry;
    }

    const [weightedEntry] = remainingWeightedEntries.splice(weightedIndex, 1);
    return weightedEntry ?? entry;
  });
}

function reorderServiceEntriesInGroup(
  entries = [],
  sourceName,
  sourceMatcher = null,
  sourceIndex = null,
  targetName = null,
  targetMatcher = null,
  targetIndex = null,
) {
  const currentServiceEntries = getSortedServiceEntries(entries);
  const matchedSourceIndex = findItemEntryIndex(currentServiceEntries, "services", sourceName, sourceMatcher);
  const renderedSourceIndex = normalizedItemIndex(sourceIndex);
  const sourceEntryIndex =
    matchedSourceIndex >= 0
      ? matchedSourceIndex
      : renderedSourceIndex !== null && renderedSourceIndex < currentServiceEntries.length
        ? renderedSourceIndex
        : -1;
  if (sourceEntryIndex < 0) {
    return { moved: false, entries };
  }

  if (targetName !== null) {
    const matchedTargetIndex = findItemEntryIndex(currentServiceEntries, "services", targetName, targetMatcher);
    const renderedTargetIndex = normalizedItemIndex(targetIndex);
    const targetEntryIndex =
      matchedTargetIndex >= 0
        ? matchedTargetIndex
        : renderedTargetIndex !== null && renderedTargetIndex < currentServiceEntries.length
          ? renderedTargetIndex
          : -1;
    if (targetEntryIndex < 0 || targetEntryIndex === sourceEntryIndex) {
      return { moved: false, entries };
    }

    const swappedServiceEntries = [...currentServiceEntries];
    const sourceEntry = swappedServiceEntries[sourceEntryIndex];
    const targetEntry = swappedServiceEntries[targetEntryIndex];
    const sourceWeight = getEntryValue(sourceEntry).weight;
    const targetWeight = getEntryValue(targetEntry).weight;

    swappedServiceEntries[sourceEntryIndex] = {
      [getEntryName(sourceEntry)]: {
        ...getEntryValue(sourceEntry),
        weight: targetWeight,
      },
    };
    swappedServiceEntries[targetEntryIndex] = {
      [getEntryName(targetEntry)]: {
        ...getEntryValue(targetEntry),
        weight: sourceWeight,
      },
    };

    return {
      moved: true,
      entries: applyWeightedServiceEntries(entries, swappedServiceEntries),
    };
  }

  const nextServiceEntries = [...currentServiceEntries];
  const [removedEntry] = nextServiceEntries.splice(sourceEntryIndex, 1);
  if (!removedEntry) {
    return { moved: false, entries };
  }

  nextServiceEntries.push(removedEntry);

  const reorderedServices = resetServiceWeights(nextServiceEntries);
  return {
    moved: true,
    entries: applyWeightedServiceEntries(entries, reorderedServices),
  };
}

function reorderRawServiceEntryInGroup(
  rawGroups,
  groupName,
  sourceName,
  sourceMatcher = null,
  sourceIndex = null,
  targetName = null,
  targetMatcher = null,
  targetIndex = null,
) {
  let moved = false;

  const reorderEntries = (entries = [], currentGroup) => {
    if (namesEqual(currentGroup, groupName)) {
      const reordered = reorderServiceEntriesInGroup(
        entries,
        sourceName,
        sourceMatcher,
        sourceIndex,
        targetName,
        targetMatcher,
        targetIndex,
      );
      moved = moved || reordered.moved;
      return reordered.entries;
    }

    return entries.map((entry) => {
      const name = getEntryName(entry);
      const value = entry[name];

      if (!Array.isArray(value)) {
        return entry;
      }

      return { [name]: reorderEntries(value, name) };
    });
  };

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    const value = group[name] ?? [];
    return { [name]: reorderEntries(value, name) };
  });

  return { moved, nextGroups: moved ? nextGroups : rawGroups };
}

function removeRawEntryForMove(rawGroups, type, sourceGroupName, sourceName, sourceMatcher = null, sourceIndex = null) {
  let removedEntry = null;

  const removeFromEntries = (entries = [], currentGroup) => {
    const matcherIndex = namesEqual(currentGroup, sourceGroupName)
      ? findItemEntryIndex(entries, type, sourceName, sourceMatcher)
      : -1;
    const renderedRawIndex = namesEqual(currentGroup, sourceGroupName)
      ? getRenderedItemRawIndex(entries, type, sourceIndex)
      : -1;

    return entries
      .map((entry, index) => {
        const name = getEntryName(entry);
        const value = entry[name];

        if (isItemEntry(entry, type)) {
          if (
            namesEqual(currentGroup, sourceGroupName) &&
            removedEntry === null &&
            (entryMatchesItemMatcher(entry, type, sourceName, sourceMatcher) ||
              index === matcherIndex ||
              index === renderedRawIndex)
          ) {
            removedEntry = entry;
            return null;
          }
          return entry;
        }

        const nestedEntries = removeFromEntries(value, name);
        return {
          [name]:
            type === "services" && namesEqual(name, sourceGroupName)
              ? resetServiceWeights(nestedEntries)
              : nestedEntries,
        };
      })
      .filter(Boolean);
  };

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    const nextEntries = removeFromEntries(group[name], name);
    return {
      [name]: type === "services" && namesEqual(name, sourceGroupName) ? resetServiceWeights(nextEntries) : nextEntries,
    };
  });

  return { removedEntry, nextGroups };
}

function insertRawEntryForMove(
  rawGroups,
  type,
  targetGroupName,
  sourceEntry,
  targetName = null,
  targetMatcher = null,
  targetIndex = null,
) {
  let inserted = false;

  const insertToEntries = (entries = [], currentGroup) => {
    if (!namesEqual(currentGroup, targetGroupName)) {
      return entries.map((entry) => {
        const name = getEntryName(entry);
        const value = entry[name];
        return isItemEntry(entry, type) ? entry : { [name]: insertToEntries(value, name) };
      });
    }

    const nextEntries = [...entries];
    const matchedTargetIndex =
      targetName === null ? nextEntries.length : findItemEntryIndex(nextEntries, type, targetName, targetMatcher);
    const renderedRawIndex = targetName === null ? -1 : getRenderedItemRawIndex(nextEntries, type, targetIndex);
    const insertionIndex = matchedTargetIndex >= 0 ? matchedTargetIndex : renderedRawIndex;

    if (insertionIndex < 0) {
      return entries;
    }

    nextEntries.splice(insertionIndex, 0, sourceEntry);
    inserted = true;
    return type === "services" ? resetServiceWeights(nextEntries) : nextEntries;
  };

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    const nextEntries = insertToEntries(group[name], name);
    return {
      [name]: type === "services" && namesEqual(name, targetGroupName) ? resetServiceWeights(nextEntries) : nextEntries,
    };
  });

  return { inserted, nextGroups };
}

function reorderRawEntry(
  rawGroups,
  type,
  sourceGroupName,
  sourceName,
  targetGroupName,
  targetName = null,
  sourceMatcher = null,
  targetMatcher = null,
  sourceIndex = null,
  targetIndex = null,
) {
  if (type === "services" && namesEqual(sourceGroupName, targetGroupName)) {
    return reorderRawServiceEntryInGroup(
      rawGroups,
      sourceGroupName,
      sourceName,
      sourceMatcher,
      sourceIndex,
      targetName,
      targetMatcher,
      targetIndex,
    );
  }

  const { removedEntry, nextGroups: groupsWithoutSource } = removeRawEntryForMove(
    rawGroups,
    type,
    sourceGroupName,
    sourceName,
    sourceMatcher,
    sourceIndex,
  );
  if (!removedEntry) {
    return { moved: false, nextGroups: rawGroups };
  }

  const { inserted, nextGroups } = insertRawEntryForMove(
    groupsWithoutSource,
    type,
    targetGroupName,
    removedEntry,
    targetName,
    targetMatcher,
    targetIndex,
  );
  return { moved: inserted, nextGroups: inserted ? nextGroups : rawGroups };
}

function groupLayoutToForm(layout) {
  return {
    alignRowHeights: layout?.alignRowHeights === false ? "false" : "true",
    columns: layout?.columns !== undefined ? String(layout.columns) : "",
    header: layout?.header !== undefined ? String(layout.header) : "",
    icon: layout?.icon ?? "",
    initiallyCollapsed: layout?.initiallyCollapsed !== undefined ? String(layout.initiallyCollapsed) : "",
    style: layout?.style ?? "",
    tab: layout?.tab ?? "",
  };
}

function formToGroupLayout(form) {
  const layout = {};

  if (form.style) layout.style = form.style;
  if (form.columns.trim()) layout.columns = Number(form.columns);
  if (form.alignRowHeights === "false") layout.alignRowHeights = false;
  if (form.header.trim()) layout.header = form.header === "true";
  if (form.icon.trim()) layout.icon = form.icon;
  if (form.initiallyCollapsed.trim()) layout.initiallyCollapsed = form.initiallyCollapsed === "true";
  if (form.tab.trim()) layout.tab = form.tab;

  return layout;
}

function collectLayoutTabs(layoutMap) {
  const tabs = new Set();

  function visit(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return;
    }

    if (typeof node.tab === "string" && node.tab.trim()) {
      tabs.add(node.tab.trim());
    }

    Object.values(node).forEach((value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        visit(value);
      }
    });
  }

  visit(layoutMap);
  return [...tabs].sort((left, right) => left.localeCompare(right, "ru"));
}

function collectTopLevelLayoutTabs(layoutMap) {
  const tabs = [];

  Object.values(layoutMap ?? {}).forEach((value) => {
    const tab = typeof value?.tab === "string" ? value.tab.trim() : "";
    if (tab && !tabs.some((existingTab) => namesEqual(existingTab, tab))) {
      tabs.push(tab);
    }
  });

  return tabs;
}

export function getOrderedTabsForLayout(layoutMap, savedOrder = []) {
  const discoveredTabs = collectTopLevelLayoutTabs(layoutMap);
  const orderedTabs = [];

  (savedOrder ?? []).forEach((tab) => {
    const normalizedTab = typeof tab === "string" ? tab.trim() : "";
    if (!normalizedTab) {
      return;
    }

    const matchedTab = discoveredTabs.find((existingTab) => namesEqual(existingTab, normalizedTab));
    if (matchedTab && !orderedTabs.some((existingTab) => namesEqual(existingTab, matchedTab))) {
      orderedTabs.push(matchedTab);
    }
  });

  discoveredTabs.forEach((tab) => {
    if (!orderedTabs.some((existingTab) => namesEqual(existingTab, tab))) {
      orderedTabs.push(tab);
    }
  });

  return orderedTabs;
}

function updateSettingsLayout(settings, originalName, nextName, nextLayout, mode) {
  const nextSettings = { ...(settings ?? {}) };
  let changed = false;

  const updateLayout = (layoutMap = {}) => {
    const nextLayoutMap = {};

    Object.entries(layoutMap).forEach(([key, value]) => {
      if (namesEqual(key, originalName)) {
        changed = true;
        if (mode !== "delete") {
          nextLayoutMap[nextName] = nextLayout;
        }
        return;
      }

      if (value && typeof value === "object" && !Array.isArray(value)) {
        nextLayoutMap[key] = updateLayout(value);
      } else {
        nextLayoutMap[key] = value;
      }
    });

    return nextLayoutMap;
  };

  nextSettings.layout = updateLayout(settings?.layout ?? {});
  if (!changed && mode !== "delete") {
    nextSettings.layout[nextName] = nextLayout;
  }
  return nextSettings;
}

function extractNamedNode(nodes, sourceName) {
  let extracted = null;

  const nextNodes = (nodes ?? [])
    .map((node) => {
      const name = getEntryName(node);
      const value = node[name];

      if (namesEqual(name, sourceName)) {
        extracted = node;
        return null;
      }

      if (Array.isArray(value)) {
        const childResult = extractNamedNode(value, sourceName);
        if (childResult.extracted) {
          extracted = childResult.extracted;
        }
        return { [name]: childResult.nodes };
      }

      return node;
    })
    .filter(Boolean);

  return { extracted, nodes: nextNodes };
}

function insertRawGroup(nodes, targetName, sourceNode, placement) {
  let inserted = false;

  const insertIntoNodes = (currentNodes = []) => {
    const nextNodes = [];

    currentNodes.forEach((node) => {
      const name = getEntryName(node);
      const value = node[name];

      if (placement === "before" && namesEqual(name, targetName)) {
        nextNodes.push(sourceNode);
        inserted = true;
      }

      if (Array.isArray(value)) {
        if (placement === "inside" && namesEqual(name, targetName)) {
          nextNodes.push({ [name]: [...value, sourceNode] });
          inserted = true;
        } else {
          nextNodes.push({ [name]: insertIntoNodes(value) });
        }
      } else {
        nextNodes.push(node);
      }
    });

    return nextNodes;
  };

  const nextNodes = insertIntoNodes(nodes);
  return { inserted, nodes: nextNodes };
}

function moveRawServiceGroup(rawGroups, sourceName, targetName, placement) {
  if (placement !== "root" && (!targetName || namesEqual(sourceName, targetName))) {
    return { moved: false, nextGroups: rawGroups };
  }

  const { extracted, nodes } = extractNamedNode(rawGroups, sourceName);
  if (!extracted) {
    return { moved: false, nextGroups: rawGroups };
  }

  if (placement === "root") {
    return { moved: true, nextGroups: [...nodes, extracted] };
  }

  const { inserted, nodes: nextGroups } = insertRawGroup(nodes, targetName, extracted, placement);
  return { moved: inserted, nextGroups: inserted ? nextGroups : rawGroups };
}

function moveRawBookmarkGroup(rawGroups, sourceName, targetName, placement = "before") {
  if (placement === "root") {
    const sourceIndex = (rawGroups ?? []).findIndex((group) => namesEqual(getEntryName(group), sourceName));
    if (sourceIndex < 0) {
      return { moved: false, nextGroups: rawGroups };
    }

    const nextGroups = [...rawGroups];
    const [sourceGroup] = nextGroups.splice(sourceIndex, 1);
    nextGroups.push(sourceGroup);
    return { moved: true, nextGroups };
  }

  if (!targetName || namesEqual(sourceName, targetName)) {
    return { moved: false, nextGroups: rawGroups };
  }

  const sourceIndex = (rawGroups ?? []).findIndex((group) => namesEqual(getEntryName(group), sourceName));
  const targetIndex = (rawGroups ?? []).findIndex((group) => namesEqual(getEntryName(group), targetName));
  if (sourceIndex < 0 || targetIndex < 0) {
    return { moved: false, nextGroups: rawGroups };
  }

  const nextGroups = [...rawGroups];
  const [sourceGroup] = nextGroups.splice(sourceIndex, 1);
  const nextTargetIndex = nextGroups.findIndex((group) => namesEqual(getEntryName(group), targetName));
  nextGroups.splice(nextTargetIndex, 0, sourceGroup);

  return { moved: true, nextGroups };
}

function findGroupPath(nodes, targetName, path = []) {
  for (const node of nodes ?? []) {
    const name = getEntryName(node);
    const value = node[name];
    const nextPath = [...path, name];

    if (namesEqual(name, targetName)) {
      return nextPath;
    }

    if (Array.isArray(value)) {
      const nestedPath = findGroupPath(value, targetName, nextPath);
      if (nestedPath) {
        return nestedPath;
      }
    }
  }

  return null;
}

function extractLayoutNode(layoutMap, sourceName) {
  let extracted = null;
  const nextLayout = {};

  Object.entries(layoutMap ?? {}).forEach(([name, value]) => {
    if (namesEqual(name, sourceName)) {
      extracted = value ?? {};
      return;
    }

    const childResult =
      value && typeof value === "object" && !Array.isArray(value) ? extractLayoutNode(value, sourceName) : null;

    if (childResult?.extracted) {
      extracted = childResult.extracted;
      nextLayout[name] = childResult.layout;
    } else {
      nextLayout[name] = value;
    }
  });

  return { extracted, layout: nextLayout };
}

function cloneLayoutValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => [
      key,
      childValue && typeof childValue === "object" && !Array.isArray(childValue)
        ? cloneLayoutValue(childValue)
        : childValue,
    ]),
  );
}

function upsertLayoutAtPath(layoutMap, path, updater) {
  if (!path.length) {
    return updater(cloneLayoutValue(layoutMap));
  }

  const [head, ...tail] = path;
  const nextLayout = cloneLayoutValue(layoutMap);
  nextLayout[head] = upsertLayoutAtPath(nextLayout[head], tail, updater);
  return nextLayout;
}

function moveSettingsLayoutGroup(settings, rawGroups, sourceName, targetName, placement) {
  const { extracted, layout } = extractLayoutNode(settings?.layout ?? {}, sourceName);
  const sourceLayout = extracted ?? {};
  if (placement === "root") {
    return {
      moved: true,
      settings: {
        ...(settings ?? {}),
        layout: {
          ...layout,
          [sourceName]: sourceLayout,
        },
      },
    };
  }

  const targetPath = findGroupPath(rawGroups, targetName);

  if (!targetPath) {
    return { moved: false, settings };
  }

  const nextLayout =
    placement === "inside"
      ? upsertLayoutAtPath(layout, targetPath, (targetLayout) => ({
          ...targetLayout,
          [sourceName]: sourceLayout,
        }))
      : upsertLayoutAtPath(layout, targetPath.slice(0, -1), (parentLayout) => ({
          ...parentLayout,
          [sourceName]: sourceLayout,
        }));

  return {
    moved: true,
    settings: {
      ...(settings ?? {}),
      layout: nextLayout,
    },
  };
}

function moveSettingsLayoutTab(settings, sourceTab, targetTab) {
  const normalizedSourceTab = sourceTab?.trim();
  const normalizedTargetTab = targetTab?.trim();

  if (!normalizedSourceTab || !normalizedTargetTab || namesEqual(normalizedSourceTab, normalizedTargetTab)) {
    return { moved: false, settings };
  }

  const currentOrder = getOrderedTabsForLayout(settings?.layout ?? {}, settings?.__browserEditorTabOrder ?? []);
  const sourceIndex = currentOrder.findIndex((tab) => namesEqual(tab, normalizedSourceTab));
  const targetIndex = currentOrder.findIndex((tab) => namesEqual(tab, normalizedTargetTab));

  if (sourceIndex < 0 || targetIndex < 0) {
    return { moved: false, settings };
  }

  const nextOrder = [...currentOrder];
  const [movedTab] = nextOrder.splice(sourceIndex, 1);
  const nextTargetIndex = nextOrder.findIndex((tab) => namesEqual(tab, normalizedTargetTab));
  nextOrder.splice(nextTargetIndex, 0, movedTab);
  const unchanged = nextOrder.length === currentOrder.length && nextOrder.every((tab, index) => namesEqual(tab, currentOrder[index]));

  if (unchanged) {
    return { moved: false, settings };
  }

  return {
    moved: true,
    settings: {
      ...(settings ?? {}),
      __browserEditorTabOrder: nextOrder,
    },
  };
}

function Field({ label, value, onChange, compact = false }) {
  return (
    <label className={classNames("block min-w-0 text-xs text-theme-600 dark:text-theme-300", compact && "text-[11px]")}>
      {label}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={classNames(
          "mt-1 w-full min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100",
          compact ? "px-2 py-1 text-[13px]" : "px-2 py-1 text-sm",
        )}
      />
    </label>
  );
}

function CodeEditorTheme() {
  return (
    <style jsx global>{`
      .homepage-editor-code .token.comment,
      .homepage-editor-code .token.prolog,
      .homepage-editor-code .token.doctype,
      .homepage-editor-code .token.cdata {
        color: #7c8798;
      }

      .dark .homepage-editor-code .token.comment,
      .dark .homepage-editor-code .token.prolog,
      .dark .homepage-editor-code .token.doctype,
      .dark .homepage-editor-code .token.cdata {
        color: #7f8ea3;
      }

      .homepage-editor-code .token.punctuation {
        color: #67758a;
      }

      .dark .homepage-editor-code .token.punctuation {
        color: #94a3b8;
      }

      .homepage-editor-code .token.property,
      .homepage-editor-code .token.tag,
      .homepage-editor-code .token.constant,
      .homepage-editor-code .token.symbol,
      .homepage-editor-code .token.deleted {
        color: #9f2d56;
      }

      .dark .homepage-editor-code .token.property,
      .dark .homepage-editor-code .token.tag,
      .dark .homepage-editor-code .token.constant,
      .dark .homepage-editor-code .token.symbol,
      .dark .homepage-editor-code .token.deleted {
        color: #f472b6;
      }

      .homepage-editor-code .token.boolean,
      .homepage-editor-code .token.number {
        color: #b45309;
      }

      .dark .homepage-editor-code .token.boolean,
      .dark .homepage-editor-code .token.number {
        color: #fbbf24;
      }

      .homepage-editor-code .token.selector,
      .homepage-editor-code .token.attr-name,
      .homepage-editor-code .token.string,
      .homepage-editor-code .token.char,
      .homepage-editor-code .token.builtin,
      .homepage-editor-code .token.inserted {
        color: #0f766e;
      }

      .dark .homepage-editor-code .token.selector,
      .dark .homepage-editor-code .token.attr-name,
      .dark .homepage-editor-code .token.string,
      .dark .homepage-editor-code .token.char,
      .dark .homepage-editor-code .token.builtin,
      .dark .homepage-editor-code .token.inserted {
        color: #5eead4;
      }

      .homepage-editor-code .token.operator,
      .homepage-editor-code .token.entity,
      .homepage-editor-code .token.url,
      .homepage-editor-code .language-css .token.string,
      .homepage-editor-code .style .token.string {
        color: #2563eb;
      }

      .dark .homepage-editor-code .token.operator,
      .dark .homepage-editor-code .token.entity,
      .dark .homepage-editor-code .token.url,
      .dark .homepage-editor-code .language-css .token.string,
      .dark .homepage-editor-code .style .token.string {
        color: #7dd3fc;
      }

      .homepage-editor-code .token.atrule,
      .homepage-editor-code .token.attr-value,
      .homepage-editor-code .token.keyword {
        color: #7c3aed;
      }

      .dark .homepage-editor-code .token.atrule,
      .dark .homepage-editor-code .token.attr-value,
      .dark .homepage-editor-code .token.keyword {
        color: #c4b5fd;
      }

      .homepage-editor-code .token.function,
      .homepage-editor-code .token.class-name {
        color: #c2410c;
      }

      .dark .homepage-editor-code .token.function,
      .dark .homepage-editor-code .token.class-name {
        color: #fdba74;
      }

      .homepage-editor-scroll {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      .homepage-editor-scroll::-webkit-scrollbar {
        width: 0;
        height: 0;
        display: none;
      }

      .homepage-editor-highlight,
      .homepage-editor-textarea {
        margin: 0;
        border: 0;
        box-sizing: border-box;
        font-family: inherit;
        font-size: inherit;
        font-style: inherit;
        font-variant-ligatures: inherit;
        font-weight: inherit;
        letter-spacing: inherit;
        line-height: inherit;
        tab-size: 2;
        text-indent: inherit;
        text-rendering: inherit;
        text-transform: inherit;
      }

      .homepage-editor-highlight {
        pointer-events: none;
      }

      .homepage-editor-highlight,
      .homepage-editor-highlight code {
        white-space: pre;
        overflow-wrap: normal;
        word-break: normal;
      }

      .homepage-editor-textarea {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        resize: none;
        background: transparent;
        overflow: auto;
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
        caret-color: #111827 !important;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      .homepage-editor-textarea::-webkit-scrollbar {
        width: 0;
        height: 0;
        display: none;
      }

      .dark .homepage-editor-textarea {
        caret-color: #f8fafc !important;
      }

      .homepage-editor-textarea:focus {
        outline: none;
      }

    `}</style>
  );
}

function escapeCodeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function detectEditorLanguage(format, fileName = "") {
  if (format === "yaml") {
    return "yaml";
  }

  const normalizedName = fileName.toLowerCase();
  if (normalizedName.endsWith(".css")) {
    return "css";
  }

  if (normalizedName.endsWith(".js") || normalizedName.endsWith(".json")) {
    return "javascript";
  }

  return "plain";
}

function highlightEditorCode(value, language) {
  if (!value) {
    return "";
  }

  if (language === "plain" || !Prism.languages[language]) {
    return escapeCodeHtml(value);
  }

  try {
    return Prism.highlight(value, Prism.languages[language], language);
  } catch {
    return escapeCodeHtml(value);
  }
}

function CodeEditor({
  label,
  value,
  onChange,
  language = "plain",
  placeholder = "",
  minHeightClassName = "min-h-[16rem]",
  fillAvailableHeight = false,
  zoomStorageKey = CODE_EDITOR_ZOOM_STORAGE_KEY,
}) {
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const [zoom, setZoom] = useState(() => {
    if (typeof window === "undefined" || !zoomStorageKey) {
      return 100;
    }

    const stored = Number.parseInt(window.localStorage.getItem(zoomStorageKey) ?? "", 10);
    return Number.isFinite(stored) ? Math.min(CODE_EDITOR_MAX_ZOOM, Math.max(CODE_EDITOR_MIN_ZOOM, stored)) : 100;
  });
  const highlightedCode = useMemo(() => highlightEditorCode(value, language), [language, value]);
  const editorFontSize = Math.round((13 * zoom) / 100 * 100) / 100;
  const editorLineHeight = `${Math.round((24 * zoom) / 100 * 100) / 100}px`;
  const zoomDecreaseStep = zoom <= 10 ? 1 : 10;
  const zoomIncreaseStep = zoom < 10 ? 1 : 10;

  const syncScrollPosition = useCallback((source) => {
    if (!highlightRef.current) {
      return;
    }

    highlightRef.current.scrollTop = source.scrollTop;
    highlightRef.current.scrollLeft = source.scrollLeft;
  }, []);

  const handleScroll = useCallback(
    (event) => {
      syncScrollPosition(event.currentTarget);
    },
    [syncScrollPosition],
  );

  useEffect(() => {
    if (textareaRef.current) {
      syncScrollPosition(textareaRef.current);
    }
  }, [syncScrollPosition, value]);

  useEffect(() => {
    if (typeof window === "undefined" || !zoomStorageKey) {
      return;
    }

    window.localStorage.setItem(zoomStorageKey, String(zoom));
  }, [zoom, zoomStorageKey]);

  return (
    <label
      className={classNames(
        "min-h-0 text-xs text-theme-600 dark:text-theme-300",
        fillAvailableHeight ? "flex flex-1 flex-col" : "block",
      )}
    >
      {label}
      <CodeEditorTheme />
      <div
        className={classNames(
          "homepage-editor-surface mt-1 overflow-hidden rounded-md border border-theme-300/50 bg-theme-50 shadow-sm dark:border-white/10 dark:bg-theme-800",
          fillAvailableHeight && "flex min-h-0 flex-1 flex-col",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-theme-300/40 px-3 py-2 dark:border-white/10">
          <span className="font-medium uppercase tracking-[0.18em] opacity-70">{language === "plain" ? "text" : language}</span>
          <div className="flex items-center gap-2">
            <span className="opacity-60">{value.length} симв.</span>
            <button
              type="button"
              onClick={() => setZoom((current) => Math.max(CODE_EDITOR_MIN_ZOOM, current - zoomDecreaseStep))}
              className="rounded border border-theme-300/50 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-theme-100/70 dark:border-white/10 dark:hover:bg-white/10"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              className="rounded border border-theme-300/50 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-theme-100/70 dark:border-white/10 dark:hover:bg-white/10"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((current) => Math.min(CODE_EDITOR_MAX_ZOOM, current + zoomIncreaseStep))}
              className="rounded border border-theme-300/50 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-theme-100/70 dark:border-white/10 dark:hover:bg-white/10"
            >
              A+
            </button>
          </div>
        </div>
        <div
          className={classNames(
            "homepage-editor-scroll relative overflow-hidden overscroll-contain",
            fillAvailableHeight ? "flex-1" : "max-h-[min(70vh,42rem)]",
            minHeightClassName,
          )}
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: editorFontSize,
            lineHeight: editorLineHeight,
          }}
        >
          <pre
            ref={highlightRef}
            aria-hidden="true"
            className="homepage-editor-highlight absolute inset-0 overflow-hidden px-3 py-3 text-theme-900 dark:text-theme-100"
          >
            {value ? (
              <code className="homepage-editor-code" dangerouslySetInnerHTML={{ __html: `${highlightedCode}\n` }} />
            ) : (
              <code className="homepage-editor-code opacity-40">{placeholder || " "}</code>
            )}
          </pre>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onScroll={handleScroll}
            className="homepage-editor-textarea selection:bg-theme-300/30 px-3 py-3 dark:selection:bg-white/20"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            data-gramm="false"
            placeholder={placeholder}
          />
        </div>
      </div>
    </label>
  );
}

function ServiceCardColorField({ value, itemName, onChange }) {
  const selectedColor = getServiceCardColor(value);

  return (
    <div className="block text-xs text-theme-600 dark:text-theme-300">
      <div>Цвет карточки</div>
      <div className="mt-1 flex flex-wrap gap-1.5 rounded-md border border-theme-300/50 bg-theme-50/70 p-1.5 shadow-sm dark:border-white/10 dark:bg-theme-900/70">
        {serviceCardColorOptions.map(([colorValue, label, optionSwatch]) => {
          const selected = colorValue === selectedColor;

          return (
            <button
              key={colorValue || "none"}
              type="button"
              title={optionSwatch ? `${label} ${optionSwatch}` : label}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onChange(buildServiceCardId(value, itemName, colorValue))}
              className={classNames(
                "flex h-7 w-7 items-center justify-center rounded border border-theme-400/50 bg-theme-200/40 shadow-sm transition-[transform,box-shadow,border-color] hover:scale-110 hover:border-theme-700 hover:shadow-md focus:outline-hidden focus:ring-2 focus:ring-theme-600 dark:border-white/20 dark:bg-white/5 dark:hover:border-white/50 dark:focus:ring-theme-200",
                selected &&
                  "scale-110 border-theme-950 shadow-lg ring-2 ring-theme-700 ring-offset-2 ring-offset-theme-50 dark:border-white dark:ring-theme-100 dark:ring-offset-theme-900",
              )}
              style={optionSwatch ? { backgroundColor: optionSwatch } : undefined}
            >
              {!optionSwatch && <span className="text-sm leading-none text-theme-700 dark:text-theme-200">×</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function refreshConfigData(mutate, keys = ["/api/config/editor", "/api/services", "/api/bookmarks"]) {
  await fetch("/api/revalidate");
  await Promise.all(keys.map((key) => mutate(key)));

  const hashResponse = await fetch("/api/hash");
  if (hashResponse.ok) {
    const hashData = await hashResponse.json();
    if (typeof window !== "undefined" && hashData?.hash) {
      localStorage.setItem("hash", hashData.hash);
    }
    await mutate("/api/hash", hashData, false);
  }
}

const EDITOR_WINDOW_MARGIN = 16;

function readStoredEditorWindow(storageKey) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (
      Number.isFinite(parsed?.left) &&
      Number.isFinite(parsed?.top) &&
      Number.isFinite(parsed?.width) &&
      Number.isFinite(parsed?.height)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function writeStoredEditorWindow(storageKey, rect) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(rect));
}

function viewportBounds() {
  if (typeof window === "undefined") {
    return { width: 1440, height: 900 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function clampEditorWindow(rect, minWidth, minHeight) {
  const viewport = viewportBounds();
  const maxWidth = Math.max(minWidth, viewport.width - EDITOR_WINDOW_MARGIN * 2);
  const maxHeight = Math.max(minHeight, viewport.height - EDITOR_WINDOW_MARGIN * 2);
  const width = clamp(rect.width, minWidth, maxWidth);
  const height = clamp(rect.height, minHeight, maxHeight);
  const left = clamp(rect.left, EDITOR_WINDOW_MARGIN, viewport.width - width - EDITOR_WINDOW_MARGIN);
  const top = clamp(rect.top, EDITOR_WINDOW_MARGIN, viewport.height - height - EDITOR_WINDOW_MARGIN);

  return { left, top, width, height };
}

function resizeEditorWindow(rect, deltaX, deltaY, directions, minWidth, minHeight) {
  const viewport = viewportBounds();
  const startLeft = rect.left;
  const startTop = rect.top;
  const startRight = rect.left + rect.width;
  const startBottom = rect.top + rect.height;

  let nextLeft = startLeft;
  let nextTop = startTop;
  let nextRight = startRight;
  let nextBottom = startBottom;

  if (directions.includes("left")) {
    nextLeft = clamp(startLeft + deltaX, EDITOR_WINDOW_MARGIN, startRight - minWidth);
  }

  if (directions.includes("right")) {
    nextRight = clamp(startRight + deltaX, startLeft + minWidth, viewport.width - EDITOR_WINDOW_MARGIN);
  }

  if (directions.includes("top")) {
    nextTop = clamp(startTop + deltaY, EDITOR_WINDOW_MARGIN, startBottom - minHeight);
  }

  if (directions.includes("bottom")) {
    nextBottom = clamp(startBottom + deltaY, startTop + minHeight, viewport.height - EDITOR_WINDOW_MARGIN);
  }

  return clampEditorWindow(
    {
      left: nextLeft,
      top: nextTop,
      width: nextRight - nextLeft,
      height: nextBottom - nextTop,
    },
    minWidth,
    minHeight,
  );
}

function resizeCursorForDirections(directions) {
  const hasLeftOrRight = directions.includes("left") || directions.includes("right");
  const hasTopOrBottom = directions.includes("top") || directions.includes("bottom");

  if (hasLeftOrRight && hasTopOrBottom) {
    return directions.includes("left") ? "nesw-resize" : "nwse-resize";
  }

  if (hasLeftOrRight) {
    return "ew-resize";
  }

  if (hasTopOrBottom) {
    return "ns-resize";
  }

  return "";
}

function setGlobalResizeCursor(cursor) {
  if (typeof document === "undefined") {
    return;
  }

  document.body.style.cursor = cursor || "";
}

function centeredEditorWindow(defaultWidth, defaultHeight, minWidth, minHeight) {
  const viewport = viewportBounds();
  const width = Math.min(defaultWidth, viewport.width - EDITOR_WINDOW_MARGIN * 2);
  const height = Math.min(defaultHeight, viewport.height - EDITOR_WINDOW_MARGIN * 2);

  return clampEditorWindow(
    {
      left: Math.round((viewport.width - width) / 2),
      top: Math.round((viewport.height - height) / 2),
      width,
      height,
    },
    minWidth,
    minHeight,
  );
}

function anchoredEditorWindow(anchorRef, defaultWidth, defaultHeight, minWidth, minHeight) {
  const anchorRect = anchorRef?.current?.getBoundingClientRect?.();
  if (!anchorRect) {
    return centeredEditorWindow(defaultWidth, defaultHeight, minWidth, minHeight);
  }

  return clampEditorWindow(
    {
      left: anchorRect.left,
      top: Math.max(EDITOR_WINDOW_MARGIN, anchorRect.bottom + 12),
      width: defaultWidth,
      height: defaultHeight,
    },
    minWidth,
    minHeight,
  );
}

function useEditorWindow({
  storageKey,
  defaultWidth,
  defaultHeight,
  minWidth = 360,
  minHeight = 240,
  anchorRef = null,
}) {
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const [windowRect, setWindowRect] = useState(null);

  const getInitialRect = useCallback(() => {
    const stored = readStoredEditorWindow(storageKey);
    if (stored) {
      return clampEditorWindow(stored, minWidth, minHeight);
    }

    return anchorRef
      ? anchoredEditorWindow(anchorRef, defaultWidth, defaultHeight, minWidth, minHeight)
      : centeredEditorWindow(defaultWidth, defaultHeight, minWidth, minHeight);
  }, [anchorRef, defaultHeight, defaultWidth, minHeight, minWidth, storageKey]);

  useLayoutEffect(() => {
    setWindowRect(getInitialRect());
  }, [getInitialRect]);

  useEffect(() => {
    if (!windowRect) {
      return;
    }

    writeStoredEditorWindow(storageKey, windowRect);
  }, [storageKey, windowRect]);

  useEffect(() => {
    setWindowRect((current) => (current ? clampEditorWindow(current, minWidth, minHeight) : current));
  }, [minHeight, minWidth]);

  useEffect(() => {
    if (!windowRect || typeof window === "undefined") {
      return;
    }

    function handleViewportResize() {
      setWindowRect((current) => (current ? clampEditorWindow(current, minWidth, minHeight) : current));
    }

    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, [minHeight, minWidth, windowRect]);

  useEffect(() => {
    if (!windowRect || typeof window === "undefined") {
      return;
    }

    function handlePointerMove(event) {
      if (resizeRef.current) {
        const { directions, rect, startX, startY } = resizeRef.current;
        setWindowRect(resizeEditorWindow(rect, event.clientX - startX, event.clientY - startY, directions, minWidth, minHeight));
        return;
      }

      if (!dragRef.current) {
        return;
      }

      const dragState = dragRef.current;
      setWindowRect((current) => {
        if (!current || !dragState) {
          return current;
        }

        return clampEditorWindow(
          {
            ...current,
            left: dragState.left + event.clientX - dragState.startX,
            top: dragState.top + event.clientY - dragState.startY,
          },
          minWidth,
          minHeight,
        );
      });
    }

    function handlePointerUp() {
      dragRef.current = null;
      resizeRef.current = null;
      setGlobalResizeCursor("");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [minHeight, minWidth, windowRect]);

  const handleDragStart = useCallback(
    (event) => {
      if (event.button !== 0 || !windowRect) {
        return;
      }

      if (event.target.closest("button, input, textarea, select, label, a, [data-no-drag='true']")) {
        return;
      }

      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        left: windowRect.left,
        top: windowRect.top,
      };
    },
    [windowRect],
  );

  const handleResizeStart = useCallback(
    (event, directions) => {
      if (event.button !== 0 || !windowRect) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setGlobalResizeCursor(resizeCursorForDirections(directions));
      resizeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        rect: windowRect,
        directions,
      };
    },
    [windowRect],
  );

  return {
    panelRef,
    windowRect,
    setWindowRect,
    handleDragStart,
    handleResizeStart,
  };
}

function EditorWindow({
  storageKey,
  title,
  onClose,
  children,
  headerActions = null,
  defaultWidth,
  defaultHeight,
  minWidth = 360,
  minHeight = 240,
  anchorRef = null,
  bodyClassName = "",
  autoFitContent = false,
  autoFitTargetRef = null,
  windowApiRef = null,
  resizeDirections = ["left", "right", "bottom", "bottom-left", "bottom-right"],
}) {
  const bodyRef = useRef(null);
  const { panelRef, windowRect, setWindowRect, handleDragStart, handleResizeStart } = useEditorWindow({
    storageKey,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    anchorRef,
  });

  useLayoutEffect(() => {
    if (!windowRect || !autoFitContent || !bodyRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const bodyElement = bodyRef.current;
    const targetElement = autoFitTargetRef?.current ?? bodyElement;

    const fitToContent = () => {
      const heightDelta = targetElement.scrollHeight - bodyElement.clientHeight;
      if (Math.abs(heightDelta) <= 8) {
        return;
      }

      setWindowRect((current) =>
        current
          ? clampEditorWindow(
              {
                ...current,
                height: current.height + heightDelta + (heightDelta > 0 ? 8 : 0),
              },
              minWidth,
              minHeight,
            )
          : current,
      );
    };

    fitToContent();

    const observer = new ResizeObserver(() => {
      fitToContent();
    });

    observer.observe(targetElement);
    return () => observer.disconnect();
  }, [autoFitContent, autoFitTargetRef, minHeight, minWidth, setWindowRect, windowRect]);

  useEffect(() => {
    if (!windowApiRef) {
      return undefined;
    }

    windowApiRef.current = {
      panelRef,
      bodyRef,
      windowRect,
      setWindowRect,
    };

    return () => {
      if (windowApiRef.current?.panelRef === panelRef) {
        windowApiRef.current = null;
      }
    };
  }, [panelRef, setWindowRect, windowApiRef, windowRect]);

  if (!windowRect) {
    return null;
  }

  const leftResizeCursor = resizeCursorForDirections(["left"]);
  const rightResizeCursor = resizeCursorForDirections(["right"]);
  const bottomResizeCursor = resizeCursorForDirections(["bottom"]);
  const bottomLeftResizeCursor = resizeCursorForDirections(["bottom", "left"]);
  const bottomRightResizeCursor = resizeCursorForDirections(["bottom", "right"]);
  const canResizeLeft = resizeDirections.includes("left");
  const canResizeRight = resizeDirections.includes("right");
  const canResizeBottom = resizeDirections.includes("bottom");
  const canResizeBottomLeft = resizeDirections.includes("bottom-left");
  const canResizeBottomRight = resizeDirections.includes("bottom-right");

  return (
    <div className="fixed inset-0 z-[60] bg-black/50" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        style={{
          left: `${windowRect.left}px`,
          top: `${windowRect.top}px`,
          width: `${windowRect.width}px`,
          height: `${windowRect.height}px`,
          minWidth: `${minWidth}px`,
          minHeight: `${minHeight}px`,
        }}
        className="fixed z-[61] flex overflow-hidden rounded-md border border-theme-300/50 bg-theme-50 text-theme-900 shadow-xl dark:border-white/10 dark:bg-theme-800 dark:text-theme-100"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            onPointerDown={handleDragStart}
            className="flex min-w-0 cursor-move select-none flex-wrap items-center justify-between gap-3 border-b border-theme-300/40 px-4 py-3 dark:border-white/10"
          >
            <h2 className="min-w-0 flex-1 text-lg font-semibold">{title}</h2>
            <div className="relative z-[70] flex min-w-0 flex-wrap items-center justify-end gap-2 pr-3" data-no-drag="true">
              {headerActions}
              <button type="button" onClick={onClose} className="rounded-md border border-theme-400/60 px-3 py-2 text-sm">
                Закрыть
              </button>
            </div>
          </div>
          <div ref={bodyRef} className={classNames("flex min-h-0 min-w-0 flex-1 flex-col p-4", bodyClassName)}>
            {children}
          </div>
        </div>
        {canResizeLeft && (
          <div
            data-window-resize-handle="true"
            onPointerDown={(event) => handleResizeStart(event, ["left"])}
            onMouseEnter={() => setGlobalResizeCursor(leftResizeCursor)}
            onMouseLeave={() => setGlobalResizeCursor("")}
            className="absolute inset-y-0 left-0 z-[62] w-5 cursor-ew-resize"
          />
        )}
        {canResizeRight && (
          <div
            data-window-resize-handle="true"
            onPointerDown={(event) => handleResizeStart(event, ["right"])}
            onMouseEnter={() => setGlobalResizeCursor(rightResizeCursor)}
            onMouseLeave={() => setGlobalResizeCursor("")}
            className="absolute inset-y-0 right-0 z-[62] w-5 cursor-ew-resize"
          />
        )}
        {canResizeBottom && (
          <div
            data-window-resize-handle="true"
            onPointerDown={(event) => handleResizeStart(event, ["bottom"])}
            onMouseEnter={() => setGlobalResizeCursor(bottomResizeCursor)}
            onMouseLeave={() => setGlobalResizeCursor("")}
            className="absolute right-2 bottom-0 left-2 z-[62] h-5 cursor-ns-resize"
          />
        )}
        {canResizeBottomLeft && (
          <div
            data-window-resize-handle="true"
            onPointerDown={(event) => handleResizeStart(event, ["bottom", "left"])}
            onMouseEnter={() => setGlobalResizeCursor(bottomLeftResizeCursor)}
            onMouseLeave={() => setGlobalResizeCursor("")}
            className="absolute bottom-0 left-0 z-[63] h-8 w-8 cursor-nesw-resize"
          />
        )}
        {canResizeBottomRight && (
          <div
            data-window-resize-handle="true"
            onPointerDown={(event) => handleResizeStart(event, ["bottom", "right"])}
            onMouseEnter={() => setGlobalResizeCursor(bottomRightResizeCursor)}
            onMouseLeave={() => setGlobalResizeCursor("")}
            className="absolute bottom-0 right-0 z-[63] h-8 w-8 cursor-nwse-resize"
          />
        )}
        {canResizeLeft && <div className="pointer-events-none absolute inset-y-8 left-2 z-[64] w-[2px] rounded-full bg-theme-500/35 dark:bg-white/25" />}
        {canResizeRight && <div className="pointer-events-none absolute inset-y-8 right-2 z-[64] w-[2px] rounded-full bg-theme-500/35 dark:bg-white/25" />}
      </div>
    </div>
  );
}

function ItemModal({ modal, data, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const isServiceModal = modal.type === "services";
  const isBookmarkModal = modal.type === "bookmarks";
  const bookmarkWindowApiRef = useRef(null);
  const typeFields = modal.type === "services" ? serviceFields : bookmarkFields;
  const rawEntryConfig =
    modal.mode === "edit"
      ? findRawEntry(
          data?.[modal.type],
          modal.type,
          modal.groupName,
          modal.itemName,
          modal.itemMatcher,
          modal.itemIndex,
        )
      : null;
  const rawConfig = modal.mode === "edit" ? (rawEntryConfig ?? modal.item) : {};
  const originalItemMatcher =
    modal.mode === "edit" && rawEntryConfig
      ? createItemMatcher(modal.type, modal.itemName, rawEntryConfig)
      : modal.itemMatcher;
  const [name, setName] = useState(modal.mode === "edit" ? modal.itemName : "");
  const [form, setForm] = useState(() => splitConfig(rawConfig, modal.type));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showAdvancedServiceFields, setShowAdvancedServiceFields] = useState(false);
  const [showAdvancedBookmarkFields, setShowAdvancedBookmarkFields] = useState(false);
  const title = isServiceModal ? "сервис" : "закладка";
  const bookmarkWindowWidth = 648;
  const bookmarkCollapsedHeight = 379;
  const bookmarkExpandedHeight = 760;
  const bookmarkWindowStorageKey = "homepage-browser-editor-window-item-bookmarks-v9";
  const itemModalDefaultHeight = isServiceModal ? 840 : showAdvancedBookmarkFields ? bookmarkExpandedHeight : bookmarkCollapsedHeight;
  const itemModalMinHeight = isServiceModal ? 780 : showAdvancedBookmarkFields ? 620 : 360;
  const primaryTypeFields =
    isServiceModal
      ? typeFields.filter(([key]) => !collapsedServiceFieldKeys.has(key))
      : isBookmarkModal
        ? typeFields.filter(([key]) => !collapsedBookmarkFieldKeys.has(key))
      : typeFields;
  const advancedServiceFields =
    isServiceModal
      ? typeFields.filter(([key]) => collapsedServiceFieldKeys.has(key))
      : [];
  const advancedBookmarkFields =
    isBookmarkModal
      ? typeFields.filter(([key]) => collapsedBookmarkFieldKeys.has(key))
      : [];

  async function save(nextData) {
    const response = await fetch("/api/config/editor", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: modal.type, data: nextData }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    await refreshConfigData(mutate);
  }

  async function loadLatestEditorData() {
    const response = await fetch("/api/config/editor");

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }

  function getLatestItemMatcher(latestData) {
    if (modal.mode !== "edit") {
      return null;
    }

    const latestRawEntryConfig = findRawEntry(
      latestData?.[modal.type],
      modal.type,
      modal.groupName,
      modal.itemName,
      originalItemMatcher ?? modal.itemMatcher,
      modal.itemIndex,
    );

    return latestRawEntryConfig
      ? createItemMatcher(modal.type, modal.itemName, latestRawEntryConfig)
      : (originalItemMatcher ?? modal.itemMatcher);
  }

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Имя обязательно");
      }

      const config = formToConfig(form);
      validateItemConfig(modal.type, config);
      const latestData = await loadLatestEditorData();
      const nextData =
        modal.mode === "edit"
          ? updateRawEntry(
              latestData[modal.type],
              modal.type,
              modal.groupName,
              modal.itemName,
              getLatestItemMatcher(latestData),
              modal.itemIndex,
              trimmedName,
              config,
            )
          : addRawEntry(latestData[modal.type], modal.type, modal.groupName, trimmedName, config);

      await save(nextData);
      onSaved(`Сохранено: ${trimmedName}`);
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError("");

    try {
      const latestData = await loadLatestEditorData();
      await save(
        deleteRawEntry(
          latestData[modal.type],
          modal.type,
          modal.groupName,
          modal.itemName,
          getLatestItemMatcher(latestData),
          modal.itemIndex,
        ),
      );
      onSaved(`Удалено: ${modal.itemName}`);
      onClose();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  }

  const handleAdvancedBookmarkToggle = useCallback(
    (expanded) => {
      if (!isBookmarkModal) {
        setShowAdvancedBookmarkFields(expanded);
        return;
      }

      const currentRect = bookmarkWindowApiRef.current?.windowRect;
      if (currentRect) {
        const targetHeight = expanded ? Math.max(currentRect.height, bookmarkExpandedHeight) : bookmarkCollapsedHeight;
        bookmarkWindowApiRef.current?.setWindowRect((current) =>
          current
            ? clampEditorWindow(
                {
                  ...current,
                  height: targetHeight,
                },
                620,
                expanded ? 520 : 360,
              )
            : current,
        );
      }

      if (expanded && typeof window !== "undefined") {
        const currentZoom = Number.parseInt(window.localStorage.getItem(BOOKMARK_YAML_ZOOM_STORAGE_KEY) ?? "", 10);
        if (!Number.isFinite(currentZoom) || currentZoom < 50) {
          window.localStorage.setItem(BOOKMARK_YAML_ZOOM_STORAGE_KEY, "100");
        }
      }

      setShowAdvancedBookmarkFields(expanded);
    },
    [bookmarkCollapsedHeight, bookmarkExpandedHeight, isBookmarkModal],
  );

  const fieldsBlock = (
    <div className="space-y-3">
      <Field label="Имя" value={name} onChange={setName} compact={isServiceModal} />
      {(isServiceModal || isBookmarkModal) && (
        <ServiceCardColorField
          value={form.fields.id ?? ""}
          itemName={name}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              fields: {
                ...current.fields,
                id: value,
              },
            }))
          }
        />
      )}
      <div className={classNames("grid min-w-0 gap-2", isServiceModal ? "grid-cols-3" : "md:grid-cols-2")}>
        {primaryTypeFields.map(([key, label]) => (
          <Field
            key={key}
            label={label}
            value={form.fields[key] ?? ""}
            compact={isServiceModal}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                fields: {
                  ...current.fields,
                  [key]: value,
                },
              }))
            }
          />
        ))}
      </div>
      {isServiceModal && (
        <div className="rounded-md border border-theme-300/50 p-3 dark:border-white/10">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-theme-700 dark:text-theme-200">
            <input
              type="checkbox"
              checked={showAdvancedServiceFields}
              onChange={(event) => setShowAdvancedServiceFields(event.target.checked)}
              className="h-4 w-4"
            />
            Дополнительные поля
          </label>
          {showAdvancedServiceFields && (
            <div className="mt-3 grid min-w-0 gap-2 grid-cols-3">
              {advancedServiceFields.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={form.fields[key] ?? ""}
                  compact
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      fields: {
                        ...current.fields,
                        [key]: value,
                      },
                    }))
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
      {isBookmarkModal && (
        <div className="rounded-md border border-theme-300/50 p-3 dark:border-white/10">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-theme-700 dark:text-theme-200">
            <input
              type="checkbox"
              checked={showAdvancedBookmarkFields}
              onChange={(event) => handleAdvancedBookmarkToggle(event.target.checked)}
              className="h-4 w-4"
            />
            Дополнительные поля
          </label>
          {showAdvancedBookmarkFields && (
            <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
              {advancedBookmarkFields.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={form.fields[key] ?? ""}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      fields: {
                        ...current.fields,
                        [key]: value,
                      },
                    }))
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const errorBlock = error && (
    <div className="rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</div>
  );

  const footerBlock = (
    <div className="flex flex-wrap justify-between gap-2">
      <div>
        {modal.mode === "edit" && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="rounded-md border border-rose-400/60 px-3 py-2 text-sm text-rose-700 disabled:opacity-60 dark:text-rose-300"
          >
            Удалить
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
      >
        {saving ? "Сохранение..." : "Сохранить"}
      </button>
    </div>
  );

  return (
    <EditorWindow
      storageKey={isBookmarkModal ? bookmarkWindowStorageKey : `homepage-browser-editor-window-item-${modal.type}`}
      title={modal.mode === "edit" ? `Изменить ${title}` : `Добавить ${title}`}
      onClose={onClose}
      defaultWidth={isServiceModal ? 1040 : bookmarkWindowWidth}
      defaultHeight={itemModalDefaultHeight}
      minWidth={isServiceModal ? 760 : 620}
      minHeight={itemModalMinHeight}
      windowApiRef={isBookmarkModal ? bookmarkWindowApiRef : null}
    >
      {isBookmarkModal ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {fieldsBlock}
            {showAdvancedBookmarkFields && (
              <div className="mt-3 flex min-h-0 min-w-0 flex-col">
                <CodeEditor
                  label="Другие YAML-ключи"
                  language="yaml"
                  value={form.extraYaml}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      extraYaml: value,
                    }))
                  }
                  minHeightClassName="h-[20rem] min-h-[20rem]"
                  zoomStorageKey={BOOKMARK_YAML_ZOOM_STORAGE_KEY}
                  placeholder="custom:\n  key: value"
                />
              </div>
            )}
            {errorBlock && <div className="mt-4">{errorBlock}</div>}
          </div>
          <div className="mt-4 shrink-0">{footerBlock}</div>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {fieldsBlock}
            <div className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col">
              <CodeEditor
                label="Расширенный YAML"
                language="yaml"
                value={form.extraYaml}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    extraYaml: value,
                  }))
                }
                minHeightClassName="min-h-[20rem]"
                fillAvailableHeight
                zoomStorageKey="homepage-browser-editor-code-zoom-item-services"
                placeholder="widget:\n  type: customapi\n  url: http://example.local"
              />
            </div>
          </div>
          {errorBlock && <div className="mt-4">{errorBlock}</div>}
          <div className="mt-4">{footerBlock}</div>
        </>
      )}
    </EditorWindow>
  );
}

function BackgroundModal({ settings, anchorRef, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const fileInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [backgroundValue, setBackgroundValue] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const currentBackground =
    typeof settings?.background === "string" ? settings.background : settings?.background?.image;

  async function saveUploadedFile(nextFile) {
    if (!nextFile) return;
    setSaving(true);
    setError("");
    setSelectedFileName(nextFile.name);

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(nextFile);
      });

      const response = await fetch("/api/config/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          background: { name: nextFile.name, type: nextFile.type, dataUrl },
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshConfigData(mutate, ["/api/config/editor"]);
      onSaved("Фон сохранён");
      window.location.reload();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveBackgroundPath() {
    const nextBackground = backgroundValue.trim();
    if (!nextBackground) {
      setError("Укажите путь или URL фона");
      return;
    }

    setSaving(true);
    setError("");
    setSelectedFileName("");

    try {
      const response = await fetch("/api/config/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backgroundPath: nextBackground }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshConfigData(mutate, ["/api/config/editor"]);
      onSaved("Фон сохранён");
      window.location.reload();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!nextFile) {
      return;
    }

    saveUploadedFile(nextFile);
  }

  return (
    <EditorWindow
      storageKey="homepage-browser-editor-window-background"
      title="Фон"
      onClose={onClose}
      defaultWidth={460}
      defaultHeight={340}
      minWidth={420}
      minHeight={260}
      anchorRef={anchorRef}
    >
      <label className="mb-3 block text-xs text-theme-600 dark:text-theme-300">
        Путь или URL фона
        <div className="mt-1 flex items-center gap-3">
          <input
            type="text"
            value={backgroundValue}
            onChange={(event) => setBackgroundValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveBackgroundPath();
              }
            }}
            placeholder={currentBackground || "/images/background.jpg"}
            disabled={saving}
            className="w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-2 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
          />
          <button
            type="button"
            onClick={saveBackgroundPath}
            disabled={saving}
            className="shrink-0 rounded-md border border-theme-400/60 px-3 py-2 text-sm disabled:opacity-60"
          >
            Применить
          </button>
        </div>
      </label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={saving}
          className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
        >
          Выбрать
        </button>
        <div className="min-w-0 flex-1 text-right text-sm text-theme-700 dark:text-theme-200">
          {saving ? (selectedFileName ? `Загрузка ${selectedFileName}...` : "Загрузка...") : selectedFileName || " "}
        </div>
      </div>
      {error && (
        <div className="mt-4 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {error}
        </div>
      )}
    </EditorWindow>
  );
}

function ConfigFilesModal({ tabs, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const { setSettings } = useContext(SettingsContext);
  const [activeFileName, setActiveFileName] = useState(tabs?.[0]?.fileName ?? "");
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries((tabs ?? []).map((tab) => [tab.fileName, tab.content ?? ""])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextDrafts = Object.fromEntries((tabs ?? []).map((tab) => [tab.fileName, tab.content ?? ""]));
    setDrafts(nextDrafts);
  }, [tabs]);

  useEffect(() => {
    if (!tabs?.some((tab) => tab.fileName === activeFileName)) {
      setActiveFileName(tabs?.[0]?.fileName ?? "");
    }
  }, [activeFileName, tabs]);

  const activeTab = tabs?.find((tab) => tab.fileName === activeFileName) ?? tabs?.[0] ?? null;
  const activeContent = activeTab ? drafts[activeTab.fileName] ?? activeTab.content ?? "" : "";
  const activeLanguage = detectEditorLanguage(activeTab?.format, activeTab?.fileName);

  async function handleSave() {
    if (!activeTab) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/config/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: activeTab.fileName,
          content: activeContent,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const nextData = await response.json();
      if (nextData?.settings) {
        setSettings(nextData.settings);
      }

      setDrafts(Object.fromEntries((nextData?.settingsTabs ?? []).map((tab) => [tab.fileName, tab.content ?? ""])));
      await refreshConfigData(mutate, ["/api/config/editor"]);
      onSaved(`Сохранено: ${activeTab.label}`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorWindow
      storageKey="homepage-browser-editor-window-settings"
      title="Ручная правка"
      onClose={onClose}
      defaultWidth={1120}
      defaultHeight={780}
      minWidth={760}
      minHeight={520}
    >
      <div>
        <div className="flex flex-wrap gap-2 pb-1">
          {(tabs ?? []).map((tab) => (
            <button
              key={tab.fileName}
              type="button"
              onClick={() => setActiveFileName(tab.fileName)}
              className={classNames(
                "min-w-[9rem] rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                activeTab?.fileName === tab.fileName
                  ? "border-theme-500/70 bg-theme-200/70 text-theme-950 shadow-sm dark:border-white/30 dark:bg-white/15 dark:text-theme-50"
                  : "border-theme-300/50 bg-transparent text-theme-800 hover:bg-theme-100/60 dark:border-white/10 dark:text-theme-200 dark:hover:bg-white/10",
              )}
            >
              <div className="truncate text-sm font-semibold leading-5">{tab.label}</div>
              <div className="truncate opacity-70">{tab.fileName}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden">
        {activeTab ? (
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingRight: "5px" }}>
            <CodeEditor
              label="Содержимое файла"
              language={activeLanguage}
              value={activeContent}
              onChange={(value) =>
                setDrafts((current) => ({
                  ...current,
                  [activeTab.fileName]: value,
                }))
              }
            minHeightClassName="min-h-0"
            fillAvailableHeight
            zoomStorageKey="homepage-browser-editor-code-zoom-settings"
            placeholder={activeTab.fileName}
          />

          </div>
        ) : (
          <div className="rounded-md border border-theme-300/50 p-4 text-sm text-theme-700 dark:border-white/10 dark:text-theme-200">
            В config-папке пока нет дополнительных файлов для редактирования.
          </div>
        )}

        {error && (
          <div className="mt-4 shrink-0 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {error}
          </div>
        )}

        <div
          className="pointer-events-none mt-4 flex min-w-0 shrink-0 justify-end"
          style={{ paddingRight: "5px", paddingBottom: "5px" }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={!activeTab || saving}
            className="pointer-events-auto relative z-[70] rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </EditorWindow>
  );
}

function GroupModal({ modal, data, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const { setSettings } = useContext(SettingsContext);
  const [groupType, setGroupType] = useState(modal.type ?? "");
  const [name, setName] = useState(modal.mode === "edit" ? modal.groupName : "");
  const [form, setForm] = useState(() => groupLayoutToForm(modal.layout));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = modal.mode === "edit" ? (groupType === "services" ? "группу сервисов" : "группу закладок") : "группу";
  const isVertical = form.style.trim() !== "row";
  const currentColumns = form.columns.trim();
  const alignRowHeights = form.alignRowHeights !== "false";
  const headerHidden = form.header === "false";
  const existingTabs = useMemo(() => collectLayoutTabs(data.settings?.layout ?? {}), [data.settings]);
  const groupModalMinHeight =
    groupType === "services" ? (modal.mode === "new" ? 720 : 660) : (modal.mode === "new" ? 680 : 620);
  const groupTabOptionsId = "homepage-browser-editor-group-tab-options";

  const quickLayoutButtonClass = (active = false) =>
    classNames(
      "rounded-md border px-3 py-2 text-sm transition-colors",
      "border-theme-400/60 hover:bg-theme-200/40 dark:border-white/20 dark:hover:bg-white/10",
      active && "bg-theme-200/70 text-theme-900 dark:bg-white/15 dark:text-theme-100",
    );

  async function putConfig(file, nextData) {
    const response = await fetch("/api/config/editor", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, data: nextData }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
  }

  async function saveGroup(mode = "save") {
    setSaving(true);
    setError("");

    try {
      const trimmedName = name.trim();
      if (mode !== "delete" && !trimmedName) {
        throw new Error("Имя группы обязательно");
      }

      if (mode !== "delete" && groupType !== "services" && groupType !== "bookmarks") {
        throw new Error("Выберите тип группы");
      }

      let nextGroups;
      const nextLayout = formToGroupLayout(form);
      let nextSettings;

      if (mode === "delete") {
        nextGroups = deleteRawGroup(data[groupType], modal.groupName);
        nextSettings = updateSettingsLayout(data.settings, modal.groupName, modal.groupName, {}, "delete");
      } else if (modal.mode === "new") {
        nextGroups = addRawGroup(data[groupType], trimmedName, groupType);
        nextSettings = updateSettingsLayout(data.settings, trimmedName, trimmedName, nextLayout, "save");
      } else {
        nextGroups = renameRawGroup(data[groupType], modal.groupName, trimmedName);
        nextSettings = updateSettingsLayout(data.settings, modal.groupName, trimmedName, nextLayout, "save");
      }

      await putConfig(groupType, nextGroups);
      await putConfig("settings", nextSettings);
      setSettings(nextSettings);
      await refreshConfigData(mutate);
      onSaved(mode === "delete" ? "Группа удалена" : "Группа сохранена");
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorWindow
      storageKey={`homepage-browser-editor-window-group-${modal.mode === "edit" ? "edit" : "new"}`}
      title={modal.mode === "edit" ? `Изменить ${title}` : `Добавить ${title}`}
      onClose={onClose}
      defaultWidth={900}
      defaultHeight={780}
      minWidth={660}
      minHeight={groupModalMinHeight}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-3">
          {modal.mode === "new" && (
            <div className="rounded-md border border-theme-300/50 p-3 dark:border-white/10">
              <div className="mb-2 text-xs font-semibold text-theme-700 dark:text-theme-200">Тип группы</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setGroupType("services")}
                  aria-pressed={groupType === "services"}
                  className={quickLayoutButtonClass(groupType === "services")}
                >
                  Сервисы
                </button>
                <button
                  type="button"
                  onClick={() => setGroupType("bookmarks")}
                  aria-pressed={groupType === "bookmarks"}
                  className={quickLayoutButtonClass(groupType === "bookmarks")}
                >
                  Закладки
                </button>
              </div>
            </div>
          )}
          <Field label="Имя группы" value={name} onChange={setName} />
          <div className="rounded-md border border-theme-300/50 p-3 dark:border-white/10">
            <div className="mb-2 text-xs font-semibold text-theme-700 dark:text-theme-200">Быстрая разметка</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    columns: "",
                    style: "",
                  }))
                }
                aria-pressed={isVertical}
                className={quickLayoutButtonClass(isVertical)}
              >
                Вертикально
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    columns: current.columns || "3",
                    style: "row",
                  }))
                }
                aria-pressed={!isVertical}
                className={quickLayoutButtonClass(!isVertical)}
              >
                Горизонтально
              </button>
              {[2, 3, 4, 5].map((columns) => (
                <button
                  key={columns}
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      columns: String(columns),
                      style: "row",
                    }))
                  }
                  aria-pressed={!isVertical && currentColumns === String(columns)}
                  className={quickLayoutButtonClass(!isVertical && currentColumns === String(columns))}
                >
                  {columns} колонки
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    header: current.header === "false" ? "true" : "false",
                  }))
                }
                aria-pressed={headerHidden}
                className={quickLayoutButtonClass(headerHidden)}
              >
                Переключить заголовок
              </button>
            </div>
            {groupType === "services" && (
              <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-theme-400/60 px-3 py-2 text-sm transition-colors hover:bg-theme-200/40 dark:border-white/20 dark:hover:bg-white/10">
                <input
                  type="checkbox"
                  checked={alignRowHeights}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      alignRowHeights: event.target.checked ? "true" : "false",
                    }))
                  }
                  className="h-4 w-4"
                />
                Выравнивать высоту карточек в одной строке
              </label>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Стиль"
              value={form.style}
              onChange={(value) => setForm((current) => ({ ...current, style: value }))}
            />
            <Field
              label="Колонки"
              value={form.columns}
              onChange={(value) => setForm((current) => ({ ...current, columns: value }))}
            />
            <Field
              label="Заголовок"
              value={form.header}
              onChange={(value) => setForm((current) => ({ ...current, header: value }))}
            />
            <label className="block min-w-0 text-xs text-theme-600 dark:text-theme-300">
              Страница
              <input
                type="text"
                list={groupTabOptionsId}
                value={form.tab}
                onChange={(event) => setForm((current) => ({ ...current, tab: event.target.value }))}
                placeholder={existingTabs.length ? "Выберите или введите новую" : "Введите страницу"}
                className="mt-1 w-full min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              />
              <datalist id={groupTabOptionsId}>
                {existingTabs.map((tab) => (
                  <option key={tab} value={tab} />
                ))}
              </datalist>
              <span className="mt-1 block text-[11px] opacity-70">
                Пусто = группа будет видна на всех страницах.
              </span>
            </label>
            <Field
              label="Иконка"
              value={form.icon}
              onChange={(value) => setForm((current) => ({ ...current, icon: value }))}
            />
            <Field
              label="Свернута изначально"
              value={form.initiallyCollapsed}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  initiallyCollapsed: value,
                }))
              }
            />
          </div>
          <p className="text-xs text-theme-600 dark:text-theme-300">
            Стиль: пусто или row. Заголовок и Свернута изначально: true или false.
          </p>
        </div>

        {error && (
          <div className="mt-4 shrink-0 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-4 shrink-0 flex flex-wrap justify-between gap-2">
          <div>
            {modal.mode === "edit" && (
              <button
                type="button"
                onClick={() => saveGroup("delete")}
                disabled={saving}
                className="rounded-md border border-rose-400/60 px-3 py-2 text-sm text-rose-700 disabled:opacity-60 dark:text-rose-300"
              >
                Удалить группу
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => saveGroup()}
            disabled={saving}
            className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </EditorWindow>
  );
}

export function useConfigEditor() {
  return useContext(ConfigEditorContext);
}

function dragTypes(event) {
  return Array.from(event.dataTransfer?.types ?? []);
}

function hasDragType(event, type) {
  return dragTypes(event).includes(type);
}

function writeDragPayload(event, payload, type = JSON_DRAG_TYPE) {
  const serialized = JSON.stringify(payload);

  activeDragPayload = payload;
  event.dataTransfer.setData(JSON_DRAG_TYPE, serialized);
  if (type !== JSON_DRAG_TYPE) {
    event.dataTransfer.setData(type, serialized);
  }
}

function clearDragPayload() {
  activeDragPayload = null;
}

function readDragPayload(event, preferredType = JSON_DRAG_TYPE) {
  const raw = event.dataTransfer.getData(preferredType) || event.dataTransfer.getData(JSON_DRAG_TYPE);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readGroupDragPayload(event, fallbackPayload = null) {
  const typedPayload = readDragPayload(event, GROUP_DRAG_TYPE);
  const genericPayload = typedPayload ?? readDragPayload(event);
  const fallback = fallbackPayload ?? activeDragPayload;

  if (genericPayload?.scope === "group") {
    return genericPayload;
  }

  if (fallback?.scope === "group") {
    return fallback;
  }

  return null;
}

function readTabDragPayload(event, fallbackPayload = null) {
  const typedPayload = readDragPayload(event, TAB_DRAG_TYPE);
  const genericPayload = typedPayload ?? readDragPayload(event);
  const fallback = fallbackPayload ?? activeDragPayload;

  if (genericPayload?.scope === "tab") {
    return genericPayload;
  }

  if (fallback?.scope === "tab") {
    return fallback;
  }

  return null;
}

function isGroupDragOver(event, fallbackPayload = null) {
  return (
    hasDragType(event, GROUP_DRAG_TYPE) || fallbackPayload?.scope === "group" || activeDragPayload?.scope === "group"
  );
}

function isExplicitGroupDropTarget(event) {
  return event.target instanceof Element && event.target.closest("[data-editor-group-drop-target='true']");
}

export function EditorPageTab({ tab }) {
  const { activeTab, setActiveTab } = useContext(TabContext);
  const { editMode, moveTab } = useConfigEditor();
  const matchesTab = decodeURIComponent(activeTab) === String(tab).replace(/\s+/g, "-").toLowerCase();

  return (
    <li
      key={tab}
      role="presentation"
      draggable={editMode}
      onDragStart={(event) => {
        if (!editMode) {
          return;
        }

        event.dataTransfer.effectAllowed = "move";
        writeDragPayload(event, { scope: "tab", tabName: tab }, TAB_DRAG_TYPE);
      }}
      onDragEnd={() => {
        if (!editMode) {
          return;
        }

        window.setTimeout(clearDragPayload, 0);
      }}
      onDragOver={(event) => {
        if (!editMode) {
          return;
        }

        const dragged = readTabDragPayload(event);
        if (!dragged || namesEqual(dragged.tabName, tab)) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (!editMode) {
          return;
        }

        const dragged = readTabDragPayload(event);
        if (!dragged || namesEqual(dragged.tabName, tab)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        moveTab(dragged.tabName, tab);
      }}
      className={classNames(
        "text-theme-700 dark:text-theme-200 relative h-10 w-full rounded-md flex",
        editMode && "cursor-grab",
      )}
    >
      <button
        id={`${tab}-tab`}
        type="button"
        role="tab"
        aria-controls={`#${tab}`}
        aria-selected={matchesTab ? "true" : "false"}
        className={classNames(
          "w-full rounded-md m-1",
          matchesTab ? "bg-theme-300/20 dark:bg-white/10" : "hover:bg-theme-100/20 dark:hover:bg-white/5",
          editMode &&
            "border border-theme-400/70 bg-theme-100/10 text-theme-800 transition-colors hover:border-theme-500/80 hover:bg-theme-200/40 hover:text-theme-900 dark:border-white/25 dark:bg-white/5 dark:text-theme-100 dark:hover:border-white/40 dark:hover:bg-white/10",
        )}
        onClick={() => {
          setActiveTab(encodeURIComponent(String(tab).replace(/\s+/g, "-").toLowerCase()));
          window.location.hash = `#${encodeURIComponent(String(tab).replace(/\s+/g, "-").toLowerCase())}`;
        }}
      >
        {tab}
      </button>
    </li>
  );
}

function useServiceRowHeightBalancer() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    let frame = null;

    const groupElements = () => Array.from(document.querySelectorAll("[data-editor-service-group='true']"));

    const directListForGroup = (group) => group.querySelector(":scope ul[data-editor-service-list]");

    const directCardsForGroup = (group) => {
      const list = directListForGroup(group);
      return list ? Array.from(list.querySelectorAll(":scope > li.service > .service-card")) : [];
    };

    const clearHeights = () => {
      groupElements().forEach((group) => {
        directCardsForGroup(group).forEach((card) => {
          card.style.height = "";
        });
      });
    };

    const applyEqualHeights = () => {
      frame = null;
      clearHeights();

      const groupsByParent = new Map();
      groupElements()
        .filter((group) => group.dataset.editorAlignRowHeights !== "false")
        .filter((group) => group.offsetParent !== null)
        .forEach((group) => {
          const parent = group.parentElement;
          if (!parent) return;
          groupsByParent.set(parent, [...(groupsByParent.get(parent) ?? []), group]);
        });

      groupsByParent.forEach((groups) => {
        const rows = [];

        groups
          .map((group) => ({ group, rect: group.getBoundingClientRect() }))
          .sort((a, b) => (Math.abs(a.rect.top - b.rect.top) > 3 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left))
          .forEach((entry) => {
            const currentRow = rows[rows.length - 1];
            if (!currentRow || Math.abs(currentRow.top - entry.rect.top) > 3) {
              rows.push({ top: entry.rect.top, groups: [entry.group] });
              return;
            }

            currentRow.groups.push(entry.group);
          });

        rows
          .filter((row) => row.groups.length > 1)
          .forEach((row) => {
            const cardsByGroup = row.groups.map(directCardsForGroup);
            const maxCards = Math.max(...cardsByGroup.map((cards) => cards.length), 0);

            for (let index = 0; index < maxCards; index += 1) {
              const cardsInPosition = cardsByGroup.map((cards) => cards[index]).filter(Boolean);
              if (cardsInPosition.length < 2) continue;

              const maxHeight = Math.ceil(
                Math.max(...cardsInPosition.map((card) => card.getBoundingClientRect().height)),
              );
              cardsInPosition.forEach((card) => {
                card.style.height = `${maxHeight}px`;
              });
            }
          });
      });
    };

    const scheduleApply = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(applyEqualHeights);
    };

    scheduleApply();
    window.addEventListener("resize", scheduleApply);

    const resizeObserver = new ResizeObserver(scheduleApply);
    groupElements().forEach((group) => resizeObserver.observe(group));
    const mutationObserver = new MutationObserver(scheduleApply);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", scheduleApply);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      clearHeights();
    };
  }, []);
}

export function EditorGroupToolbar({ type, groupName, layout }) {
  const { editMode, moveGroup, openGroup, setDraggedGroup } = useConfigEditor();

  if (!editMode) {
    return null;
  }

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        const payload = { scope: "group", type, groupName };
        writeDragPayload(event, payload, GROUP_DRAG_TYPE);
        setDraggedGroup(payload);
      }}
      onDragEnd={() => {
        window.setTimeout(() => {
          clearDragPayload();
          setDraggedGroup(null);
        }, 0);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const dragged = readGroupDragPayload(event);
        if (dragged?.scope === "group" && dragged.type === type) {
          moveGroup(type, dragged.groupName, groupName, "before");
        }
      }}
      onClick={() => openGroup(type, groupName, layout)}
      data-editor-group-drop-target="true"
      className="relative z-[61] mb-2 flex cursor-grab items-center justify-between gap-2 rounded-md border border-theme-400/70 bg-theme-100/10 px-2 py-1 text-xs text-theme-800 transition-colors hover:border-theme-500/80 hover:bg-theme-200/40 hover:text-theme-900 active:cursor-grabbing dark:border-white/25 dark:bg-white/5 dark:text-theme-100 dark:hover:border-white/40 dark:hover:bg-white/10"
    >
      <span className="truncate font-medium">{groupName}</span>
    </div>
  );
}

export function useGroupInsideDropTarget(type, groupName, enabled = true) {
  const { draggedGroup, editMode, moveGroup } = useConfigEditor();

  if (!enabled || !editMode) {
    return {};
  }

  return {
    onDragOver: (event) => {
      if (!isGroupDragOver(event, draggedGroup)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();

      const dragged = readGroupDragPayload(event, draggedGroup);
      if (dragged?.scope === "group" && dragged.type === type) {
        moveGroup(type, dragged.groupName, groupName, "inside");
      }
    },
    "data-editor-group-drop-target": "true",
  };
}

export function RootGroupDropZone({ children }) {
  const { draggedGroup, editMode, moveGroup, setDraggedGroup } = useConfigEditor();

  const dropGroupToRoot = useCallback(
    (event) => {
      const dragged = readGroupDragPayload(event, draggedGroup);
      if (!dragged) {
        return false;
      }

      event.preventDefault();
      moveGroup(dragged.type, dragged.groupName, null, "root");
      clearDragPayload();
      setDraggedGroup(null);
      return true;
    },
    [draggedGroup, moveGroup, setDraggedGroup],
  );

  useEffect(() => {
    if (!editMode) {
      return undefined;
    }

    const handleDragOver = (event) => {
      if (!isGroupDragOver(event, draggedGroup)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    };

    const handleDrop = (event) => {
      if (isExplicitGroupDropTarget(event)) {
        return;
      }

      dropGroupToRoot(event);
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [draggedGroup, dropGroupToRoot, editMode]);

  return (
    <div
      onDragOver={(event) => {
        if (!editMode) {
          return;
        }

        if (!isGroupDragOver(event, draggedGroup)) {
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (!editMode) {
          return;
        }

        if (isExplicitGroupDropTarget(event)) {
          return;
        }

        dropGroupToRoot(event);
      }}
      className="relative pb-12"
    >
      {children}
      {editMode && draggedGroup?.scope === "group" && (
        <>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.stopPropagation();
              dropGroupToRoot(event);
            }}
            className="fixed left-4 right-4 top-4 z-[80] flex min-h-16 items-center justify-center rounded-md border-2 border-dashed border-theme-400/70 bg-theme-50/90 px-3 py-3 text-sm font-medium text-theme-800 shadow-lg backdrop-blur-sm dark:border-white/25 dark:bg-theme-900/85 dark:text-theme-100"
          >
            Отпустите здесь, чтобы переместить группу в корень
          </div>
          <div className="pointer-events-none fixed bottom-4 left-1/2 z-[50] -translate-x-1/2 rounded-md border border-dashed border-theme-400/50 bg-theme-50/80 px-3 py-2 text-xs text-theme-700/90 shadow-md backdrop-blur-sm dark:border-white/20 dark:bg-theme-900/70 dark:text-theme-100/90">
            Перетащите в пустое место, чтобы переместить группу в корень
          </div>
        </>
      )}
    </div>
  );
}

export function useEditableItem(type, groupName, itemName, item, itemIndex = null) {
  const { editMode, moveItem, openItem } = useConfigEditor();
  const itemMatcher = useMemo(() => createItemMatcher(type, itemName, item), [item, itemName, type]);

  return {
    editMode,
    itemProps: editMode
      ? {
          draggable: true,
          onDragStart: (event) => {
            event.dataTransfer.effectAllowed = "move";
            writeDragPayload(event, { type, groupName, itemName, itemMatcher, itemIndex }, ITEM_DRAG_TYPE);
          },
          onDragEnd: () => {
            window.setTimeout(clearDragPayload, 0);
          },
          onDragOver: (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          },
          onDrop: (event) => {
            event.preventDefault();
            const dragged = readDragPayload(event);
            if (dragged?.type === type) {
              moveItem(
                type,
                dragged.groupName,
                dragged.itemName,
                groupName,
                itemName,
                dragged.itemMatcher,
                itemMatcher,
                dragged.itemIndex,
                itemIndex,
              );
            }
          },
          onClick: (event) => {
            event.preventDefault();
            openItem(type, groupName, itemName, item, itemMatcher, itemIndex);
          },
        }
      : {},
  };
}

export function EditorAddTile({ type, groupName, label, className, wrapperClassName }) {
  const { editMode, moveItem, openNewItem } = useConfigEditor();

  if (!editMode) {
    return null;
  }

  return (
    <li className={wrapperClassName}>
      <button
        type="button"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const dragged = readDragPayload(event);
          if (dragged?.type === type) {
            moveItem(
              type,
              dragged.groupName,
              dragged.itemName,
              groupName,
              null,
              dragged.itemMatcher,
              null,
              dragged.itemIndex,
            );
          }
        }}
        onClick={() => openNewItem(type, groupName)}
        className={className}
      >
        {label}
      </button>
    </li>
  );
}

export function ConfigEditorProvider({ children }) {
  const enabled = process.env.HOMEPAGE_BROWSER_EDITOR === "true";
  const { mutate } = useSWRConfig();
  const { setSettings } = useContext(SettingsContext);
  const [draggedGroup, setDraggedGroup] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editButtonVisible, setEditButtonVisible] = useState(false);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const editButtonHideTimeoutRef = useRef(null);
  const backgroundButtonRef = useRef(null);
  const { data } = useSWR(enabled && (editMode || modal) ? "/api/config/editor" : null);
  useServiceRowHeightBalancer();

  function handleSaved(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  const moveTab = useCallback(
    async (sourceTab, targetTab) => {
      if (!data || !sourceTab || !targetTab || namesEqual(sourceTab, targetTab)) {
        return;
      }

      const nextResult = moveSettingsLayoutTab(data.settings, sourceTab, targetTab);
      if (!nextResult.moved) {
        return;
      }

      const response = await fetch("/api/config/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: "settings", data: nextResult.settings }),
      });

      if (!response.ok) {
        handleSaved(await response.text());
        return;
      }

      setSettings(nextResult.settings);
      await refreshConfigData(mutate);
      handleSaved("Порядок страниц сохранён");
    },
    [data, mutate, setSettings],
  );

  const value = useMemo(
    () => ({
      draggedGroup,
      setDraggedGroup,
      editMode,
      moveTab,
      moveGroup: async (type, sourceName, targetName, placement = "before") => {
        if (!data || (placement !== "root" && namesEqual(sourceName, targetName))) {
          return;
        }

        const rawResult =
          type === "services"
            ? moveRawServiceGroup(data[type], sourceName, targetName, placement)
            : moveRawBookmarkGroup(data[type], sourceName, targetName, placement);

        const layoutResult =
          type === "services"
            ? moveSettingsLayoutGroup(data.settings, rawResult.nextGroups, sourceName, targetName, placement)
            : { moved: true, settings: data.settings };

        if (!rawResult.moved || !layoutResult.moved) {
          handleSaved("Группу нельзя переместить сюда");
          return;
        }

        const groupResponse = await fetch("/api/config/editor", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: type, data: rawResult.nextGroups }),
        });

        if (!groupResponse.ok) {
          handleSaved(await groupResponse.text());
          return;
        }

        if (type === "services") {
          const settingsResponse = await fetch("/api/config/editor", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              file: "settings",
              data: layoutResult.settings,
            }),
          });

          if (!settingsResponse.ok) {
            handleSaved(await settingsResponse.text());
            return;
          }

          setSettings(layoutResult.settings);
        }

        await refreshConfigData(mutate);
        handleSaved(
          placement === "inside"
            ? "Группа вложена"
            : placement === "root"
              ? "Группа перемещена в корень"
              : "Порядок групп сохранён",
        );
      },
      moveItem: async (
        type,
        sourceGroupName,
        sourceName,
        targetGroupName,
        targetName = null,
        sourceMatcher = null,
        targetMatcher = null,
        sourceIndex = null,
        targetIndex = null,
      ) => {
        if (!data || !sourceGroupName || !targetGroupName) {
          return;
        }

        if (namesEqual(sourceGroupName, targetGroupName) && namesEqual(sourceName, targetName)) {
          return;
        }

        const { moved, nextGroups } = reorderRawEntry(
          data[type],
          type,
          sourceGroupName,
          sourceName,
          targetGroupName,
          targetName,
          sourceMatcher,
          targetMatcher,
          sourceIndex,
          targetIndex,
        );
        if (!moved) {
          handleSaved("Можно переставлять только элементы, описанные в YAML");
          return;
        }

        const response = await fetch("/api/config/editor", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: type, data: nextGroups }),
        });

        if (!response.ok) {
          handleSaved(await response.text());
          return;
        }

        await refreshConfigData(mutate);
        handleSaved("Порядок сохранён");
      },
      openGroup: (type, groupName, layout) => setModal({ type, groupName, layout, mode: "edit", scope: "group" }),
      openItem: (type, groupName, itemName, item, itemMatcher = null, itemIndex = null) =>
        setModal({
          type,
          groupName,
          itemName,
          item,
          itemMatcher,
          itemIndex,
          mode: "edit",
        }),
      openNewGroup: (type) =>
        setModal({
          type,
          groupName: "",
          layout: {},
          mode: "new",
          scope: "group",
        }),
      openNewItem: (type, groupName) => setModal({ type, groupName, itemName: "", item: {}, mode: "new" }),
    }),
    [data, draggedGroup, editMode, moveTab, mutate, setDraggedGroup, setSettings],
  );

  const showEditButton = useCallback(() => {
    if (editButtonHideTimeoutRef.current) {
      window.clearTimeout(editButtonHideTimeoutRef.current);
      editButtonHideTimeoutRef.current = null;
    }
    setEditButtonVisible(true);
  }, []);

  const hideEditButton = useCallback(() => {
    if (editButtonHideTimeoutRef.current) {
      window.clearTimeout(editButtonHideTimeoutRef.current);
    }
    editButtonHideTimeoutRef.current = window.setTimeout(() => {
      setEditButtonVisible(false);
      editButtonHideTimeoutRef.current = null;
    }, 120);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      if (modal) {
        setModal(null);
        return;
      }

      if (editMode) {
        setDraggedGroup(null);
        setEditMode(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, enabled, modal, setDraggedGroup]);

  useEffect(
    () => () => {
      if (editButtonHideTimeoutRef.current) {
        window.clearTimeout(editButtonHideTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (editMode) {
      showEditButton();
      return;
    }

    setEditButtonVisible(false);
  }, [editMode, showEditButton]);

  if (!enabled) {
    return <ConfigEditorContext.Provider value={noopEditorContext}>{children}</ConfigEditorContext.Provider>;
  }

  return (
    <ConfigEditorContext.Provider value={value}>
      {children}
      {editMode ? (
        <div className="fixed bottom-5 left-5 z-50 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setDraggedGroup(null);
              setModal(null);
              setEditMode(false);
            }}
            className={toolbarPrimaryButtonClassName}
          >
            Готово
          </button>
          <button
            ref={backgroundButtonRef}
            type="button"
            onClick={() => setModal({ type: "background" })}
            className={toolbarButtonClassName}
          >
            Фон
          </button>
          <button type="button" onClick={() => value.openNewGroup("")} className={toolbarButtonClassName}>
            Новая группа
          </button>
          <button type="button" onClick={() => setModal({ type: "settings-tabs" })} className={toolbarButtonClassName}>
            Ручная правка
          </button>
        </div>
      ) : (
        <div className="fixed bottom-0 left-0 z-50 h-36 w-36">
          <div
            aria-hidden="true"
            className="absolute inset-0"
            onPointerEnter={showEditButton}
            onPointerMove={showEditButton}
            onPointerLeave={hideEditButton}
          />
          <button
            type="button"
            onClick={() => setEditMode(true)}
            onPointerEnter={showEditButton}
            onPointerLeave={hideEditButton}
            onFocus={showEditButton}
            onBlur={hideEditButton}
            className={classNames(
              toolbarButtonClassName,
              "absolute bottom-5 left-5 origin-bottom-left transition-[opacity,transform,filter] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              editButtonVisible
                ? "pointer-events-auto translate-y-0 scale-100 opacity-100 blur-0"
                : "pointer-events-none translate-y-2 scale-[0.96] opacity-0 blur-[2px]",
            )}
          >
            Редактировать
          </button>
        </div>
      )}
      {notice && (
        <div className="fixed bottom-20 left-5 z-50 rounded-md border border-theme-400/50 bg-theme-100/90 px-3 py-2 text-sm text-theme-800 shadow-md shadow-theme-900/10 backdrop-blur-sm dark:border-white/20 dark:bg-theme-900/90 dark:text-theme-100 dark:shadow-theme-900/20">
          {notice}
        </div>
      )}
      {modal?.type === "background" && (
        <BackgroundModal
          settings={data?.settings}
          anchorRef={backgroundButtonRef}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.type === "settings-tabs" && (
        <ConfigFilesModal tabs={data?.settingsTabs ?? []} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.scope === "group" && modal && data && (
        <GroupModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.type !== "background" && modal?.type !== "settings-tabs" && modal?.scope !== "group" && modal && data && (
        <ItemModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
    </ConfigEditorContext.Provider>
  );
}
