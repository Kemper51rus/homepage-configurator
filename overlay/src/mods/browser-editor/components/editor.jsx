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
import { ThemeContext } from "utils/contexts/theme";
import ResolvedIcon from "components/resolvedicon";
import { editorWriteFetch } from "mods/browser-editor/client/editor-fetch";
import {
  bookmarkFields,
  buildServiceCardId,
  collapsedBookmarkFieldKeys,
  collapsedServiceFieldKeys,
  formToConfig,
  getServiceCardColor,
  knownFields,
  serviceCardColorOptions,
  serviceFields,
  splitConfig,
  validateItemConfig,
} from "mods/browser-editor/lib/item-config";
import {
  anchoredEditorWindow,
  centeredEditorWindow,
  clampEditorWindow,
  readStoredEditorWindow,
  resizeCursorForDirections,
  resizeEditorWindow,
  setGlobalResizeCursor,
  writeStoredEditorWindow,
} from "mods/browser-editor/lib/editor-window";

const ConfigEditorContext = createContext({
  activePageName: null,
  draggedGroup: null,
  setDraggedGroup: () => {},
  editMode: false,
  moveTab: () => {},
  moveGroup: () => {},
  moveItem: () => {},
  moveTopWidget: () => {},
  openGroup: () => {},
  openItem: () => {},
  openTopWidget: () => {},
  openNewGroup: () => {},
  openNewItem: () => {},
  iconSelectorCallback: null,
  setIconSelectorCallback: () => {},
  selectIcon: () => {},
});

const noopEditorContext = {
  activePageName: null,
  draggedGroup: null,
  setDraggedGroup: () => {},
  editMode: false,
  moveTab: () => {},
  moveGroup: () => {},
  moveItem: () => {},
  moveTopWidget: () => {},
  openGroup: () => {},
  openItem: () => {},
  openTopWidget: () => {},
  openNewGroup: () => {},
  openNewItem: () => {},
  iconSelectorCallback: null,
  setIconSelectorCallback: () => {},
  selectIcon: () => {},
};

const toolbarButtonClassName =
  "rounded-md border border-theme-300/40 bg-theme-100/20 px-4 py-2 text-sm font-medium text-theme-800 shadow-md shadow-theme-900/10 backdrop-blur-sm transition-colors hover:bg-theme-300/20 dark:border-white/10 dark:bg-white/5 dark:text-theme-100 dark:shadow-theme-900/20 dark:hover:bg-white/10";

const toolbarPrimaryButtonClassName =
  "rounded-md border border-theme-400/60 bg-theme-200/60 px-4 py-2 text-sm font-medium text-theme-900 shadow-md shadow-theme-900/10 backdrop-blur-sm transition-colors hover:bg-theme-300/40 dark:border-white/20 dark:bg-white/10 dark:text-theme-100 dark:shadow-theme-900/20 dark:hover:bg-white/20";

const JSON_DRAG_TYPE = "application/json";
const GROUP_DRAG_TYPE = "application/x-homepage-browser-editor-group";
const ITEM_DRAG_TYPE = "application/x-homepage-browser-editor-item";
const TAB_DRAG_TYPE = "application/x-homepage-browser-editor-tab";
const TOP_WIDGET_DRAG_TYPE = "application/x-homepage-browser-editor-top-widget";
const PAGE_AUTO_OPEN_DELAY_MS = 450;
const CODE_EDITOR_ZOOM_STORAGE_KEY = "homepage-browser-editor-code-zoom";
const CODE_EDITOR_MIN_ZOOM = 1;
const CODE_EDITOR_MAX_ZOOM = 500;
const GROUP_ORDER_SETTINGS_KEY = "__browserEditorGroupOrderByPage";
const DEFAULT_GROUP_ORDER_PAGE_KEY = "__default__";

let activeDragPayload = null;
let pageAutoOpenTimeoutId = 0;
let pageAutoOpenTabName = null;

const BOOKMARK_YAML_ZOOM_STORAGE_KEY = "homepage-browser-editor-code-zoom-item-bookmarks";

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

function collectRawEntryNames(rawGroups, type, groupName) {
  const names = [];

  const collectFromEntries = (entries = [], currentGroup) => {
    entries.forEach((entry) => {
      const name = getEntryName(entry);
      const value = entry[name];

      if (namesEqual(currentGroup, groupName) && isItemEntry(entry, type)) {
        names.push(name);
      }

      if (type === "services" && Array.isArray(value)) {
        collectFromEntries(value, name);
      }
    });
  };

  (rawGroups ?? []).forEach((group) => {
    const name = getEntryName(group);
    collectFromEntries(group[name], name);
  });

  return names;
}

function buildUniqueEntryName(rawGroups, type, groupName, baseName) {
  const normalizedBaseName = String(baseName ?? "").trim() || "Copy";
  const usedNames = new Set(collectRawEntryNames(rawGroups, type, groupName).map((entryName) => String(entryName).trim()));
  let candidate = `${normalizedBaseName} copy`;
  let index = 2;

  while (usedNames.has(candidate)) {
    candidate = `${normalizedBaseName} copy ${index}`;
    index += 1;
  }

  return candidate;
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
    titleColor: layout?.titleColor ?? "",
    titleAlign: layout?.titleAlign ?? "",
    titleSize: layout?.titleSize ?? "",
    titleFont: layout?.titleFont ?? "",
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
  if (form.titleColor.trim()) layout.titleColor = form.titleColor;
  if (form.titleAlign.trim()) layout.titleAlign = form.titleAlign;
  if (form.titleSize.trim()) layout.titleSize = form.titleSize;
  if (form.titleFont.trim()) layout.titleFont = form.titleFont;

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

  Object.entries(layoutMap ?? {}).forEach(([key, value]) => {
    if (key === "Bookmarks" && value && typeof value === "object" && !Array.isArray(value)) {
      Object.values(value).forEach((bookmarkLayout) => {
        const tab = typeof bookmarkLayout?.tab === "string" ? bookmarkLayout.tab.trim() : "";
        if (tab && !tabs.some((existingTab) => namesEqual(existingTab, tab))) {
          tabs.push(tab);
        }
      });
      return;
    }

    const tab = typeof value?.tab === "string" ? value.tab.trim() : "";
    if (tab && !tabs.some((existingTab) => namesEqual(existingTab, tab))) {
      tabs.push(tab);
    }
  });

  return tabs;
}

export function getGroupLayout(layoutMap, type, groupName) {
  const normalizedName = typeof groupName === "string" ? groupName.trim() : "";
  if (!normalizedName) {
    return undefined;
  }

  if (type === "bookmarks") {
    const bookmarkLayoutMap = layoutMap?.Bookmarks;
    if (!bookmarkLayoutMap || typeof bookmarkLayoutMap !== "object" || Array.isArray(bookmarkLayoutMap)) {
      return undefined;
    }

    const matchedBookmarkEntry = Object.entries(bookmarkLayoutMap).find(([name]) => namesEqual(name, normalizedName));
    return matchedBookmarkEntry?.[1];
  }

  const matchedEntry = Object.entries(layoutMap ?? {}).find(([name]) => namesEqual(name, normalizedName));
  return matchedEntry?.[1];
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

function normalizeGroupOrderPageName(pageName) {
  const normalizedPageName = typeof pageName === "string" ? pageName.trim() : "";
  return normalizedPageName || DEFAULT_GROUP_ORDER_PAGE_KEY;
}

function createGroupOrderEntry(type, groupName) {
  return {
    type,
    groupName: String(groupName ?? "").trim(),
  };
}

function normalizeGroupOrderEntry(entry) {
  const normalizedType = entry?.type;
  const normalizedGroupName = typeof entry?.groupName === "string" ? entry.groupName.trim() : "";

  if ((normalizedType !== "services" && normalizedType !== "bookmarks") || !normalizedGroupName) {
    return null;
  }

  return createGroupOrderEntry(normalizedType, normalizedGroupName);
}

function groupOrderEntryKey(entry) {
  return `${entry.type}\u0000${entry.groupName}`;
}

function readGroupOrderMap(settings) {
  const groupOrderMap = settings?.[GROUP_ORDER_SETTINGS_KEY];
  return groupOrderMap && typeof groupOrderMap === "object" && !Array.isArray(groupOrderMap) ? groupOrderMap : {};
}

function getGroupPageName(settings, type, groupName) {
  const groupLayout = getGroupLayout(settings?.layout ?? {}, type, groupName);
  const normalizedPageName = typeof groupLayout?.tab === "string" ? groupLayout.tab.trim() : "";
  return normalizedPageName || null;
}

function groupMatchesPage(settings, type, groupName, pageName) {
  const normalizedPageName = typeof pageName === "string" ? pageName.trim() : "";
  const groupPageName = getGroupPageName(settings, type, groupName);

  if (!groupPageName) {
    return !normalizedPageName;
  }

  return namesEqual(groupPageName, normalizedPageName);
}

function dedupeTopLevelGroupEntries(groups = []) {
  const seen = new Set();

  return groups.filter((entry) => {
    const normalizedType = entry?.type;
    const normalizedGroupName = typeof entry?.group?.name === "string" ? entry.group.name.trim() : "";
    if ((normalizedType !== "services" && normalizedType !== "bookmarks") || !normalizedGroupName) {
      return false;
    }

    const key = `${normalizedType}\u0000${normalizedGroupName}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function collectCurrentPageTopLevelGroups(settings, rawServices, rawBookmarks, pageName) {
  const serviceMap = new Map((rawServices ?? []).map((group) => [group.name, group]));
  const bookmarkMap = new Map((rawBookmarks ?? []).map((group) => [group.name, group]));
  const layoutEntries = Object.entries(settings?.layout ?? {});

  const layoutGroups = layoutEntries
    .map(([groupName]) => {
      if (groupName === "Bookmarks") {
        return null;
      }

      if (serviceMap.has(groupName)) {
        return { type: "services", group: serviceMap.get(groupName) };
      }

      if (bookmarkMap.has(groupName)) {
        return { type: "bookmarks", group: bookmarkMap.get(groupName) };
      }

      return {
        type: "services",
        group: { name: groupName, services: [], groups: [] },
      };
    })
    .filter((entry) => entry && groupMatchesPage(settings, entry.type, entry.group.name, pageName));

  const serviceFallbackGroups = (rawServices ?? [])
    .filter((group) => groupMatchesPage(settings, "services", group.name, pageName))
    .filter((group) => getGroupLayout(settings?.layout ?? {}, "services", group.name) === undefined)
    .map((group) => ({ type: "services", group }));

  const bookmarkLayoutGroups = Object.keys(settings?.layout?.Bookmarks ?? {})
    .map((groupName) => ({
      type: "bookmarks",
      group: bookmarkMap.get(groupName) ?? { name: groupName, bookmarks: [] },
    }))
    .filter((entry) => groupMatchesPage(settings, "bookmarks", entry.group.name, pageName));

  const bookmarkFallbackGroups = (rawBookmarks ?? [])
    .filter((group) => groupMatchesPage(settings, "bookmarks", group.name, pageName))
    .filter((group) => getGroupLayout(settings?.layout ?? {}, "bookmarks", group.name) === undefined)
    .map((group) => ({ type: "bookmarks", group }));

  return dedupeTopLevelGroupEntries([...layoutGroups, ...serviceFallbackGroups, ...bookmarkLayoutGroups, ...bookmarkFallbackGroups]);
}

export function getOrderedTopLevelGroupsForPage(settings, pageName, groups = []) {
  const fallbackGroups = dedupeTopLevelGroupEntries(groups);
  const persistedOrder = (readGroupOrderMap(settings)[normalizeGroupOrderPageName(pageName)] ?? [])
    .map(normalizeGroupOrderEntry)
    .filter(Boolean);
  const orderedGroups = [];
  const seen = new Set();

  persistedOrder.forEach((entry) => {
    const matchedGroup = fallbackGroups.find(
      (candidate) => candidate.type === entry.type && namesEqual(candidate.group?.name, entry.groupName),
    );
    if (!matchedGroup) {
      return;
    }

    const key = `${entry.type}\u0000${entry.groupName}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    orderedGroups.push(matchedGroup);
  });

  fallbackGroups.forEach((entry) => {
    const key = `${entry.type}\u0000${String(entry.group?.name ?? "").trim()}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    orderedGroups.push(entry);
  });

  return orderedGroups;
}

function encodeTabName(tab) {
  return encodeURIComponent(String(tab).replace(/\s+/g, "-").toLowerCase());
}

function applyGroupTabToSettings(settings, type, groupName, tabName) {
  const nextLayout = {
    ...(getGroupLayout(settings?.layout ?? {}, type, groupName) ?? {}),
  };

  if (typeof tabName === "string" && tabName.trim()) {
    nextLayout.tab = tabName.trim();
  } else {
    delete nextLayout.tab;
  }

  return updateSettingsLayout(settings, type, groupName, groupName, nextLayout, "save");
}

function isTopLevelRawGroup(rawGroups, groupName) {
  return (rawGroups ?? []).some((group) => namesEqual(getEntryName(group), groupName));
}

function setGroupOrderEntriesForPage(settings, pageName, entries) {
  const nextEntries = entries.map(normalizeGroupOrderEntry).filter(Boolean);
  const normalizedPageName = normalizeGroupOrderPageName(pageName);
  const nextGroupOrderMap = { ...readGroupOrderMap(settings) };

  if (nextEntries.length > 0) {
    nextGroupOrderMap[normalizedPageName] = nextEntries;
  } else {
    delete nextGroupOrderMap[normalizedPageName];
  }

  const nextSettings = { ...(settings ?? {}) };
  if (Object.keys(nextGroupOrderMap).length > 0) {
    nextSettings[GROUP_ORDER_SETTINGS_KEY] = nextGroupOrderMap;
  } else {
    delete nextSettings[GROUP_ORDER_SETTINGS_KEY];
  }

  return nextSettings;
}

function updateGroupOrderSettings(
  settingsBefore,
  settingsAfter,
  rawServicesBefore,
  rawBookmarksBefore,
  rawServicesAfter,
  rawBookmarksAfter,
  type,
  sourceName,
  targetName,
  placement,
) {
  const beforeRawGroups = type === "services" ? rawServicesBefore : rawBookmarksBefore;
  const afterRawGroups = type === "services" ? rawServicesAfter : rawBookmarksAfter;
  const sourceWasTopLevel = isTopLevelRawGroup(beforeRawGroups, sourceName);
  const sourceIsTopLevel = isTopLevelRawGroup(afterRawGroups, sourceName);
  const targetIsTopLevel = placement === "before" && targetName ? isTopLevelRawGroup(afterRawGroups, targetName) : false;

  if (!sourceWasTopLevel && !sourceIsTopLevel && !targetIsTopLevel) {
    return settingsAfter;
  }

  const sourcePageBefore = sourceWasTopLevel ? getGroupPageName(settingsBefore, type, sourceName) : undefined;
  const sourcePageAfter = sourceIsTopLevel ? getGroupPageName(settingsAfter, type, sourceName) : undefined;
  const targetPageAfter = targetIsTopLevel ? getGroupPageName(settingsAfter, type, targetName) : undefined;
  const sourceEntry = createGroupOrderEntry(type, sourceName);
  const baseOrders = new Map();
  const affectedPages = new Map();

  [sourcePageBefore, sourcePageAfter, targetPageAfter].forEach((pageName) => {
    if (pageName === undefined) {
      return;
    }

    const pageKey = normalizeGroupOrderPageName(pageName);
    if (affectedPages.has(pageKey)) {
      return;
    }

    affectedPages.set(pageKey, pageName);
  });

  affectedPages.forEach((rawPageName, pageKey) => {
    const currentPageGroups = getOrderedTopLevelGroupsForPage(
      settingsBefore,
      rawPageName,
      collectCurrentPageTopLevelGroups(settingsBefore, rawServicesBefore, rawBookmarksBefore, rawPageName),
    );
    baseOrders.set(
      pageKey,
      currentPageGroups.map((entry) => createGroupOrderEntry(entry.type, entry.group.name)),
    );
  });

  baseOrders.forEach((entries, pageKey) => {
    baseOrders.set(
      pageKey,
      entries.filter((entry) => groupOrderEntryKey(entry) !== groupOrderEntryKey(sourceEntry)),
    );
  });

  if (sourceIsTopLevel) {
    const destinationPageKey = normalizeGroupOrderPageName(sourcePageAfter);
    const destinationEntries = [...(baseOrders.get(destinationPageKey) ?? [])];

    if (placement === "before" && targetIsTopLevel && namesEqual(sourcePageAfter, targetPageAfter)) {
      const targetEntry = createGroupOrderEntry(type, targetName);
      const targetIndex = destinationEntries.findIndex((entry) => groupOrderEntryKey(entry) === groupOrderEntryKey(targetEntry));

      if (targetIndex >= 0) {
        destinationEntries.splice(targetIndex, 0, sourceEntry);
      } else {
        destinationEntries.push(sourceEntry);
      }
    } else {
      destinationEntries.push(sourceEntry);
    }

    baseOrders.set(destinationPageKey, destinationEntries);
  }

  let nextSettings = settingsAfter;

  affectedPages.forEach((rawPageName, pageKey) => {
    const fallbackGroups = collectCurrentPageTopLevelGroups(nextSettings, rawServicesAfter, rawBookmarksAfter, rawPageName);
    const orderedEntries = [...(baseOrders.get(pageKey) ?? [])];
    const actualEntries = fallbackGroups.map((entry) => createGroupOrderEntry(entry.type, entry.group.name));
    const actualEntryKeys = new Set(actualEntries.map(groupOrderEntryKey));
    const seen = new Set();
    const sanitizedEntries = [];

    orderedEntries.forEach((entry) => {
      const key = groupOrderEntryKey(entry);
      if (!actualEntryKeys.has(key) || seen.has(key)) {
        return;
      }

      seen.add(key);
      sanitizedEntries.push(entry);
    });

    actualEntries.forEach((entry) => {
      const key = groupOrderEntryKey(entry);
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      sanitizedEntries.push(entry);
    });

    nextSettings = setGroupOrderEntriesForPage(nextSettings, rawPageName, sanitizedEntries);
  });

  return nextSettings;
}

function updateSettingsLayout(settings, type, originalName, nextName, nextLayout, mode) {
  const nextSettings = { ...(settings ?? {}) };

  if (type === "bookmarks") {
    const nextRootLayout = cloneLayoutValue(settings?.layout ?? {});
    const nextBookmarkLayout = cloneLayoutValue(nextRootLayout.Bookmarks ?? {});
    const matchedBookmarkEntry = Object.keys(nextBookmarkLayout).find((name) => namesEqual(name, originalName));

    if (mode === "delete") {
      if (matchedBookmarkEntry) {
        delete nextBookmarkLayout[matchedBookmarkEntry];
      }
    } else {
      if (matchedBookmarkEntry && !namesEqual(matchedBookmarkEntry, nextName)) {
        delete nextBookmarkLayout[matchedBookmarkEntry];
      }
      nextBookmarkLayout[nextName] = nextLayout;
    }

    if (Object.keys(nextBookmarkLayout).length > 0) {
      nextRootLayout.Bookmarks = nextBookmarkLayout;
    } else {
      delete nextRootLayout.Bookmarks;
    }

    nextSettings.layout = nextRootLayout;
    return nextSettings;
  }

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

/**
 * Reorders the top-level keys of a layout object to match the visual order
 * of groups in rawGroups (services.yaml array). This ensures settings.layout
 * key order stays in sync with services.yaml after drag-and-drop.
 *
 * Groups not present in rawGroups (e.g. "Bookmarks") are preserved at the end.
 */
function reorderLayoutToMatchGroups(layout, rawGroups) {
  if (!layout || typeof layout !== "object") return layout;

  // Build ordered list of group names from the new services order
  const serviceOrder = (rawGroups ?? []).map((node) => getEntryName(node)).filter(Boolean);

  const reordered = {};

  // 1. Add layout entries in services order
  serviceOrder.forEach((name) => {
    const matchedKey = Object.keys(layout).find((k) => namesEqual(k, name));
    if (matchedKey && !(matchedKey in reordered)) {
      reordered[matchedKey] = layout[matchedKey];
    }
  });

  // 2. Append any remaining layout keys not in services (e.g. "Bookmarks")
  Object.keys(layout).forEach((key) => {
    if (!(key in reordered)) {
      reordered[key] = layout[key];
    }
  });

  return reordered;
}

function moveSettingsLayoutGroup(settings, rawGroups, sourceName, targetName, placement) {
  const { extracted, layout } = extractLayoutNode(settings?.layout ?? {}, sourceName);
  const sourceLayout = extracted ?? {};
  if (placement === "root") {
    return {
      moved: true,
      settings: {
        ...(settings ?? {}),
        layout: reorderLayoutToMatchGroups(
          {
            ...layout,
            [sourceName]: sourceLayout,
          },
          rawGroups,
        ),
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
      // Reorder top-level layout keys to match the new services order so that
      // homepage renders groups in the correct visual order.
      layout: reorderLayoutToMatchGroups(nextLayout, rawGroups),
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

function ColorInput({ value, onChange, placeholder = "#ffffff", compact = false }) {
  const [localValue, setLocalValue] = useState(value ?? "");
  const timeoutRef = useRef(null);

  useEffect(() => {
    setLocalValue(value ?? "");
  }, [value]);

  const commitValue = useCallback((val) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (val !== value) {
      onChange(val);
    }
  }, [onChange, value]);

  const handleTextChange = (e) => {
    const val = e.target.value;
    setLocalValue(val);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      commitValue(val);
    }, 400);
  };

  const handleColorChange = (e) => {
    const val = e.target.value;
    setLocalValue(val);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      commitValue(val);
    }, 120);
  };

  const handleBlur = () => {
    commitValue(localValue);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const pickerValue = localValue && localValue.startsWith('#') && (localValue.length === 4 || localValue.length === 7)
    ? localValue
    : "#ffffff";

  return (
    <div className={classNames("mt-1 flex items-center gap-1.5", compact ? "h-[28px]" : "h-[32px]")}>
      <input
        type="text"
        placeholder={placeholder}
        value={localValue}
        onChange={handleTextChange}
        onBlur={handleBlur}
        className={classNames(
          "flex-1 min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 px-2 py-1 h-full",
          compact ? "text-[13px]" : "text-sm"
        )}
      />
      <input
        type="color"
        value={pickerValue}
        onChange={handleColorChange}
        onBlur={handleBlur}
        className="w-8 h-full p-0.5 rounded-md border border-theme-300/50 bg-transparent cursor-pointer dark:border-white/10"
      />
    </div>
  );
}

function Field({ name, label, value, onChange, compact = false }) {
  if (name === "showLink" || name === "showStats" || name === "ping") {
    return (
      <label className={classNames("flex items-center gap-2 text-xs text-theme-600 dark:text-theme-300 cursor-pointer h-[28px] mt-4", compact && "text-[11px]")}>
        <input
          type="checkbox"
          checked={value === true || value === "true"}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-theme-300 dark:border-white/10"
        />
        {label}
      </label>
    );
  }

  if (name === "titleColor") {
    return (
      <label className={classNames("block min-w-0 text-xs text-theme-600 dark:text-theme-300", compact && "text-[11px]")}>
        {label}
        <ColorInput
          value={value}
          onChange={onChange}
          placeholder="#ffffff"
          compact={true}
        />
      </label>
    );
  }

  if (name === "titleAlign") {
    const alignments = [
      ["left", "Лево"],
      ["center", "Центр"],
      ["right", "Право"],
    ];
    return (
      <label className={classNames("block min-w-0 text-xs text-theme-600 dark:text-theme-300", compact && "text-[11px]")}>
        {label}
        <div className="mt-1 flex gap-1 h-[28px]">
          {alignments.map(([alignVal, alignLabel]) => (
            <button
              key={alignVal}
              type="button"
              onClick={() => onChange(value === alignVal ? "" : alignVal)}
              className={classNames(
                "flex-1 rounded-md border text-center text-[12px] font-medium transition-colors cursor-pointer",
                value === alignVal
                  ? "border-theme-500 bg-theme-500/20 text-theme-900 dark:border-white/40 dark:bg-white/10 dark:text-theme-100"
                  : "border-theme-300/50 bg-theme-50/30 text-theme-700 hover:bg-theme-50/70 dark:border-white/10 dark:bg-theme-900/30 dark:text-theme-300 dark:hover:bg-theme-900/50"
              )}
            >
              {alignLabel}
            </button>
          ))}
        </div>
      </label>
    );
  }

  if (name === "titleSize") {
    const sizeOptions = [
      ["", "По умолчанию"],
      ["10px", "10px"],
      ["11px", "11px"],
      ["12px", "12px"],
      ["13px", "13px"],
      ["14px", "14px"],
      ["15px", "15px"],
      ["16px", "16px"],
      ["18px", "18px"],
      ["20px", "20px"],
      ["24px", "24px"],
      ["0.75rem", "0.75rem"],
      ["0.85rem", "0.85rem"],
      ["1rem", "1rem"],
      ["1.2rem", "1.2rem"],
    ];
    return (
      <label className={classNames("block min-w-0 text-xs text-theme-600 dark:text-theme-300", compact && "text-[11px]")}>
        {label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 px-2 py-1 text-[13px] h-[28px]"
        >
          {sizeOptions.map(([sizeVal, sizeLabel]) => (
            <option key={sizeVal} value={sizeVal}>
              {sizeLabel}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (name === "titleFont") {
    const fonts = [
      ["", "По умолчанию"],
      ["Comfortaa", "Comfortaa"],
      ["Inter", "Inter"],
      ["Roboto", "Roboto"],
      ["system-ui", "Системный"],
      ["Arial", "Arial"],
      ["Georgia", "Georgia"],
      ["Courier New", "Monospace"],
    ];
    return (
      <label className={classNames("block min-w-0 text-xs text-theme-600 dark:text-theme-300", compact && "text-[11px]")}>
        {label}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 px-2 py-1 text-[13px] h-[28px]"
        >
          {fonts.map(([fontVal, fontLabel]) => (
            <option key={fontVal} value={fontVal}>
              {fontLabel}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const editor = useConfigEditor();

  if (name === "icon") {
    return (
      <label className={classNames("block min-w-0 text-xs text-theme-600 dark:text-theme-300", compact && "text-[11px]")}>
        {label}
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={value || ""}
            onChange={(event) => onChange(event.target.value)}
            placeholder="si-keenetic, mdi-home, /api/config/icon/..."
            className={classNames(
              "flex-1 min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 px-2 py-1",
              compact ? "text-[13px]" : "text-sm",
            )}
          />
          {editor && typeof editor.selectIcon === "function" && (
            <button
              type="button"
              onClick={() => {
                editor.selectIcon((selectedIcon) => {
                  onChange(selectedIcon);
                });
              }}
              className="rounded-md border border-theme-300/50 bg-theme-100/50 hover:bg-theme-200/50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 px-3 text-xs font-semibold transition-colors shrink-0 flex items-center justify-center cursor-pointer"
            >
              Выбрать
            </button>
          )}
        </div>
      </label>
    );
  }

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
      .homepage-editor-textarea,
      .homepage-editor-code {
        margin: 0;
        border: 0;
        box-sizing: border-box;
        font-family: inherit !important;
        font-size: inherit !important;
        font-style: inherit;
        font-variant-ligatures: inherit;
        font-weight: inherit;
        letter-spacing: inherit;
        line-height: inherit !important;
        tab-size: 2;
        text-indent: inherit;
        text-rendering: inherit;
        text-transform: inherit;
      }

      .homepage-editor-code {
        padding: 0 !important;
        margin: 0 !important;
        background: transparent !important;
        border: 0 !important;
        display: block !important;
        white-space: pre !important;
      }

      .homepage-editor-highlight {
        pointer-events: none;
      }

      .homepage-editor-highlight,
      .homepage-editor-highlight code {
        white-space: pre !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
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
        white-space: pre !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
        scrollbar-width: thin !important;
        scrollbar-color: rgba(156, 163, 175, 0.4) transparent !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar {
        width: 10px !important;
        height: 10px !important;
        display: block !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar-track {
        background: transparent !important;
        display: block !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar-thumb {
        background: rgba(156, 163, 175, 0.4) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
        border-radius: 9999px !important;
        display: block !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar-thumb:hover {
        background: rgba(156, 163, 175, 0.6) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
      }

      .dark .homepage-editor-textarea::-webkit-scrollbar-thumb {
        background: rgba(156, 163, 175, 0.3) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
      }

      .dark .homepage-editor-textarea::-webkit-scrollbar-thumb:hover {
        background: rgba(156, 163, 175, 0.5) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
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

function lineCommentSyntax(language) {
  if (language === "javascript") {
    return { kind: "line", token: "//" };
  }

  if (language === "css") {
    return { kind: "block", start: "/*", end: "*/" };
  }

  return { kind: "line", token: "#" };
}

function selectedLineRange(value, selectionStart, selectionEnd) {
  const start = Math.max(0, Number(selectionStart) || 0);
  const end = Math.max(start, Number(selectionEnd) || start);
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = value.indexOf("\n", end);

  if (lineEnd === -1) {
    lineEnd = value.length;
  }

  return { lineStart, lineEnd };
}

function toggleLineComments(value, selectionStart, selectionEnd, language) {
  const syntax = lineCommentSyntax(language);
  const { lineStart, lineEnd } = selectedLineRange(value, selectionStart, selectionEnd);
  const before = value.slice(0, lineStart);
  const selected = value.slice(lineStart, lineEnd);
  const after = value.slice(lineEnd);
  const lines = selected.split("\n");
  const hasCodeLines = lines.some((line) => line.trim().length > 0);
  const activeLines = hasCodeLines ? lines.filter((line) => line.trim().length > 0) : lines;

  const allCommented = activeLines.length
    ? activeLines.every((line) => {
        const indent = line.match(/^\s*/)?.[0] ?? "";
        const body = line.slice(indent.length);

        if (syntax.kind === "block") {
          return body.startsWith(syntax.start) && body.trimEnd().endsWith(syntax.end);
        }

        return body.startsWith(syntax.token);
      })
    : false;

  const nextLines = lines.map((line) => {
    if (hasCodeLines && !line.trim()) {
      return line;
    }

    const indent = line.match(/^\s*/)?.[0] ?? "";
    const body = line.slice(indent.length);

    if (syntax.kind === "block") {
      if (allCommented) {
        const withoutStart = body.startsWith(syntax.start) ? body.slice(syntax.start.length).replace(/^ ?/, "") : body;
        const withoutEnd = withoutStart.endsWith(syntax.end)
          ? withoutStart.slice(0, -syntax.end.length).replace(/ ?$/, "")
          : withoutStart;
        return `${indent}${withoutEnd}`;
      }

      return `${indent}${syntax.start} ${body} ${syntax.end}`;
    }

    if (allCommented) {
      const withoutToken = body.startsWith(syntax.token) ? body.slice(syntax.token.length).replace(/^ ?/, "") : body;
      return `${indent}${withoutToken}`;
    }

    return `${indent}${syntax.token} ${body}`;
  });

  const nextSelected = nextLines.join("\n");

  return {
    value: `${before}${nextSelected}${after}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextSelected.length,
  };
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

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== "/" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      event.preventDefault();
      const target = event.currentTarget;
      const next = toggleLineComments(value, target.selectionStart, target.selectionEnd, language);
      onChange(next.value);

      window.requestAnimationFrame(() => {
        target.selectionStart = next.selectionStart;
        target.selectionEnd = next.selectionEnd;
        syncScrollPosition(target);
      });
    },
    [language, onChange, syncScrollPosition, value],
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
            onKeyDown={handleKeyDown}
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

function activeTopLevelYamlBlocks(content) {
  const lines = String(content ?? "").split("\n");
  const starts = [];

  lines.forEach((line, index) => {
    if (/^-\s+\S/.test(line)) {
      starts.push(index);
    }
  });

  return starts.map((start, index) => ({
    start,
    end: starts[index + 1] ?? lines.length,
    content: lines.slice(start, starts[index + 1] ?? lines.length).join("\n").replace(/\n+$/, ""),
  }));
}

function replaceTopLevelYamlBlock(content, blockIndex, nextBlock) {
  const lines = String(content ?? "").split("\n");
  const blocks = activeTopLevelYamlBlocks(content);
  const block = blocks[blockIndex];

  if (!block) {
    throw new Error("Виджет не найден в widgets.yaml. Обновите страницу и попробуйте снова.");
  }

  const nextLines = String(nextBlock ?? "").trimEnd().split("\n");
  return [...lines.slice(0, block.start), ...nextLines, ...lines.slice(block.end)].join("\n");
}

function moveTopLevelYamlBlock(content, sourceIndex, targetIndex) {
  if (sourceIndex === targetIndex) {
    return { moved: false, content };
  }

  const lines = String(content ?? "").split("\n");
  const blocks = activeTopLevelYamlBlocks(content);
  const sourceBlock = blocks[sourceIndex];
  const targetBlock = blocks[targetIndex];

  if (!sourceBlock || !targetBlock) {
    return { moved: false, content };
  }

  const prefix = lines.slice(0, blocks[0].start);
  const blockLines = blocks.map((block) => lines.slice(block.start, block.end));
  [blockLines[sourceIndex], blockLines[targetIndex]] = [blockLines[targetIndex], blockLines[sourceIndex]];

  return {
    moved: true,
    content: [...prefix, ...blockLines.flat()].join("\n"),
  };
}

function topWidgetDisplayName(widget, index) {
  const label = widget?.label || widget?.type || `#${index + 1}`;
  return `${label}`;
}

function TopWidgetModal({ modal, data, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const widgetsTab = data?.settingsTabs?.find((tab) => tab.fileName === "widgets.yaml");
  const originalContent = widgetsTab?.content ?? "";
  const originalBlock = activeTopLevelYamlBlocks(originalContent)[modal.widgetIndex]?.content;
  const [widgetYaml, setWidgetYaml] = useState(() =>
    originalBlock ||
    yaml.dump([{ [modal.widget?.type ?? "widget"]: {} }], { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadLatestEditorData() {
    const response = await fetch("/api/config/editor");

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      const parsed = yaml.load(widgetYaml) ?? {};
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 1 ||
        !parsed[0] ||
        typeof parsed[0] !== "object" ||
        Array.isArray(parsed[0]) ||
        Object.keys(parsed[0]).length !== 1
      ) {
        throw new Error("YAML должен быть одной записью widgets.yaml, например: - resources:");
      }

      const latestData = await loadLatestEditorData();
      const latestWidgetsTab = latestData?.settingsTabs?.find((tab) => tab.fileName === "widgets.yaml");
      const nextContent = replaceTopLevelYamlBlock(latestWidgetsTab?.content ?? "", modal.widgetIndex, widgetYaml);
      const response = await editorWriteFetch("/api/config/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "widgets.yaml", content: nextContent }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshConfigData(mutate, ["/api/config/editor", "/api/widgets"]);
      onSaved(`Виджет сохранён: ${topWidgetDisplayName(modal.widget, modal.widgetIndex)}`);
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorWindow
      storageKey="homepage-browser-editor-window-top-widget"
      title={`Виджет: ${topWidgetDisplayName(modal.widget, modal.widgetIndex)}`}
      onClose={onClose}
      defaultWidth={760}
      defaultHeight={620}
      minWidth={620}
      minHeight={460}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CodeEditor
          label="YAML виджета"
          language="yaml"
          value={widgetYaml}
          onChange={setWidgetYaml}
          fillAvailableHeight
          zoomStorageKey="homepage-browser-editor-code-zoom-widget"
          placeholder="- resources:\n    cpu: true\n    memory: true"
        />
      </div>
      {error && <div className="mt-4 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</div>}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </EditorWindow>
  );
}

function ClockWidgetModal({ modal, data, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const widgetsTab = data?.settingsTabs?.find((tab) => tab.fileName === "widgets.yaml");
  const originalContent = widgetsTab?.content ?? "";
  const originalBlock = activeTopLevelYamlBlocks(originalContent)[modal.widgetIndex]?.content;

  const initialParsed = useMemo(() => {
    try {
      const obj = yaml.load(originalBlock);
      if (Array.isArray(obj) && obj[0]) {
        return obj[0];
      }
      return obj || { datetime: {} };
    } catch {
      return { datetime: {} };
    }
  }, [originalBlock]);

  const [widgetOptions, setWidgetOptions] = useState(() => initialParsed.datetime ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const clockStyle = widgetOptions.clockStyle ?? {};

  const updateClockStyle = (key, value) => {
    setWidgetOptions((current) => {
      const nextOptions = { ...current };
      const nextStyle = { ...(nextOptions.clockStyle ?? {}) };
      if (value === "" || value === undefined) {
        delete nextStyle[key];
      } else {
        nextStyle[key] = value;
      }
      nextOptions.clockStyle = nextStyle;
      return nextOptions;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      const updatedParsed = {
        datetime: widgetOptions
      };
      const widgetYaml = yaml.dump([updatedParsed], { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd();

      const latestData = await loadLatestEditorData();
      const latestWidgetsTab = latestData?.settingsTabs?.find((tab) => tab.fileName === "widgets.yaml");
      const nextContent = replaceTopLevelYamlBlock(latestWidgetsTab?.content ?? "", modal.widgetIndex, widgetYaml);

      const response = await editorWriteFetch("/api/config/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "widgets.yaml", content: nextContent }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshConfigData(mutate, ["/api/config/editor", "/api/widgets"]);
      onSaved("Настройки часов сохранены");
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  async function loadLatestEditorData() {
    const response = await fetch("/api/config/editor");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  }

  // Standard preview code similar to DateTime widget:
  const [previewTime, setPreviewTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setPreviewTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const clockType = clockStyle.type ?? "digital-one-line";
  const dateLocale = widgetOptions.locale || "ru";

  const formattedTime = useMemo(() => {
    return new Intl.DateTimeFormat(dateLocale, {
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).format(previewTime);
  }, [previewTime, dateLocale]);

  const formattedDate = useMemo(() => {
    return new Intl.DateTimeFormat(dateLocale, {
      dateStyle: "medium",
    }).format(previewTime);
  }, [previewTime, dateLocale]);

  const hourDeg = (previewTime.getHours() % 12) * 30 + previewTime.getMinutes() * 0.5;
  const minuteDeg = previewTime.getMinutes() * 6 + previewTime.getSeconds() * 0.1;
  const secondDeg = previewTime.getSeconds() * 6;

  const fontSizes = [
    ["", "По умолчанию (Tailwind)"],
    ["14px", "14px (Очень мелкий)"],
    ["16px", "16px (Мелкий)"],
    ["18px", "18px (Стандартный)"],
    ["20px", "20px (Средний)"],
    ["24px", "24px (Увеличенный)"],
    ["32px", "32px (Крупный)"],
    ["40px", "40px (Очень крупный)"],
    ["48px", "48px (Огромный)"],
    ["64px", "64px (Гигантский)"],
  ];

  const fonts = [
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

  const clockTypes = [
    ["digital-one-line", "Цифровые в одну линию"],
    ["digital-two-lines-date-time", "Две линии: Дата сверху"],
    ["digital-two-lines-time-date", "Две линии: Время сверху"],
    ["only-time", "Только время"],
    ["only-date", "Только дата"],
  ];

  const previewStyle = {
    color: clockStyle.color || undefined,
    fontFamily: clockStyle.fontFamily || undefined,
    fontSize: clockStyle.fontSize || "24px",
  };

  const align = clockStyle.align ?? "right";
  const justifyClass = align === "left" ? "justify-start" : align === "center" ? "justify-center" : "justify-end";
  const colAlignClass = align === "left" ? "items-start text-left" : align === "center" ? "items-center text-center" : "items-end text-right";

  const renderPreviewClock = () => {
    switch (clockType) {
      case "only-time":
        return <span className="tabular-nums text-theme-900 dark:text-theme-100" style={previewStyle}>{formattedTime}</span>;
      case "only-date":
        return <span className="text-theme-900 dark:text-theme-100" style={previewStyle}>{formattedDate}</span>;
      case "digital-two-lines-date-time":
        return (
          <div className={`flex flex-col leading-tight ${colAlignClass} text-theme-900 dark:text-theme-100`}>
            <span style={{ ...previewStyle, fontSize: `calc(${previewStyle.fontSize} * 0.75)` }} className="opacity-80">
              {formattedDate}
            </span>
            <span style={previewStyle} className="font-semibold tabular-nums">
              {formattedTime}
            </span>
          </div>
        );
      case "digital-two-lines-time-date":
        return (
          <div className={`flex flex-col leading-tight ${colAlignClass} text-theme-900 dark:text-theme-100`}>
            <span style={previewStyle} className="font-semibold tabular-nums">
              {formattedTime}
            </span>
            <span style={{ ...previewStyle, fontSize: `calc(${previewStyle.fontSize} * 0.75)` }} className="opacity-80">
              {formattedDate}
            </span>
          </div>
        );
      case "digital-one-line":
      default:
        return <span className="tabular-nums text-theme-900 dark:text-theme-100" style={previewStyle}>{formattedDate}, {formattedTime}</span>;
    }
  };

  return (
    <EditorWindow
      storageKey="homepage-browser-editor-window-clock"
      title="Настройка часов"
      onClose={onClose}
      defaultWidth={700}
      defaultHeight={540}
      minWidth={600}
      minHeight={460}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col space-y-6 overflow-y-auto pr-1">
        {/* Live Preview Section */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-theme-300/40 p-6 dark:border-white/10 min-h-[140px] shrink-0">
          <div className="text-[10px] uppercase tracking-widest opacity-40 mb-3">Предпросмотр</div>
          <div className={`flex items-center w-full min-h-[80px] px-4 ${justifyClass}`}>
            {renderPreviewClock()}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Style Customization */}
          <div className="space-y-4 rounded-md border border-theme-300/50 p-4 dark:border-white/10 bg-theme-50/10 dark:bg-white/5">
            <h3 className="text-sm font-semibold text-theme-900 dark:text-theme-100">Внешний вид</h3>

            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Тип часов / Формат
              <select
                value={clockStyle.type ?? "digital-one-line"}
                onChange={(e) => updateClockStyle("type", e.target.value)}
                className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              >
                {clockTypes.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Выравнивание
              <select
                value={clockStyle.align ?? "right"}
                onChange={(e) => updateClockStyle("align", e.target.value)}
                className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              >
                <option value="left">Влево (Left)</option>
                <option value="center">По центру (Center)</option>
                <option value="right">Вправо (Right)</option>
              </select>
            </label>

            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Шрифт
              <select
                value={clockStyle.fontFamily ?? ""}
                onChange={(e) => updateClockStyle("fontFamily", e.target.value)}
                className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              >
                {fonts.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Размер
              <select
                value={clockStyle.fontSize ?? ""}
                onChange={(e) => updateClockStyle("fontSize", e.target.value)}
                className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              >
                {fontSizes.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Цвет часов
              <ColorInput
                value={clockStyle.color ?? ""}
                onChange={(val) => updateClockStyle("color", val)}
                placeholder="#ffffff"
                compact={false}
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-theme-600 dark:text-theme-300 cursor-pointer pt-2">
              <input
                type="checkbox"
                checked={clockStyle.noBackground ?? false}
                onChange={(e) => updateClockStyle("noBackground", e.target.checked)}
                className="rounded border-theme-300 text-theme-600 shadow-sm dark:border-white/10 dark:bg-theme-900"
              />
              Скрыть фон виджета (Без фона)
            </label>
          </div>

          {/* Standard YAML settings as fallback/advanced */}
          <div className="space-y-4 rounded-md border border-theme-300/50 p-4 dark:border-white/10 bg-theme-50/10 dark:bg-white/5 flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-semibold text-theme-900 dark:text-theme-100">Опции локали</h3>
              <p className="text-[11px] text-theme-500 dark:text-theme-400 mt-1 mb-3">Стандартные языковые настройки виджета datetime.</p>
              
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Локаль (например ru, en)
                <input
                  type="text"
                  placeholder="ru"
                  value={widgetOptions.locale ?? ""}
                  onChange={(e) => setWidgetOptions((curr) => ({ ...curr, locale: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                />
              </label>

              <label className="block text-xs text-theme-600 dark:text-theme-300 mt-3">
                Базовый размер (Tailwind класс)
                <select
                  value={widgetOptions.text_size ?? ""}
                  onChange={(e) => setWidgetOptions((curr) => ({ ...curr, text_size: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                >
                  <option value="">По умолчанию</option>
                  <option value="xs">Extra Small (xs)</option>
                  <option value="sm">Small (sm)</option>
                  <option value="md">Medium (md)</option>
                  <option value="lg">Large (lg)</option>
                  <option value="xl">Extra Large (xl)</option>
                  <option value="2xl">2XL</option>
                  <option value="3xl">3XL</option>
                  <option value="4xl">4XL</option>
                </select>
              </label>
            </div>

            <div className="text-[11px] text-theme-400 opacity-80 mt-4 leading-normal">
              Изменения будут записаны в `widgets.yaml`. Настройки отображения обновляются автоматически, а выбранный шрифт подгружается динамически.
            </div>
          </div>
        </div>
      </div>

      {error && <div className="mt-4 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200 shrink-0">{error}</div>}
      <div className="mt-4 flex justify-end shrink-0">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </div>
    </EditorWindow>
  );
}

function WeatherWidgetModal({ modal, data, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const widgetsTab = data?.settingsTabs?.find((tab) => tab.fileName === "widgets.yaml");
  const originalContent = widgetsTab?.content ?? "";
  const originalBlock = activeTopLevelYamlBlocks(originalContent)[modal.widgetIndex]?.content;

  const initialParsed = useMemo(() => {
    try {
      const obj = yaml.load(originalBlock);
      if (Array.isArray(obj) && obj[0]) {
        return obj[0];
      }
      return obj || { weather: {} };
    } catch {
      return { weather: {} };
    }
  }, [originalBlock]);

  const widgetKey = Object.keys(initialParsed)[0] || "weather";
  const [widgetOptions, setWidgetOptions] = useState(() => initialParsed[widgetKey] ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const weatherStyle = widgetOptions.weatherStyle ?? {};

  // Settings values
  const weatherUnits = widgetOptions.units ?? "metric";
  const weatherLabel = widgetOptions.label ?? "";
  const weatherProv = widgetOptions.provider ?? (widgetKey === "weather" ? "openweathermap" : widgetKey);

  // States for coordinates and search
  const [weatherLoc, setWeatherLoc] = useState(() => {
    if (widgetOptions.latitude !== undefined && widgetOptions.longitude !== undefined) {
      return `${widgetOptions.latitude}, ${widgetOptions.longitude}`;
    }
    return widgetOptions.location ?? "";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [geocodeResults, setGeocodeResults] = useState([]);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [geocodeError, setGeocodeError] = useState("");

  const updateWidgetOption = (key, value) => {
    setWidgetOptions((current) => {
      const nextOptions = { ...current };
      if (value === "" || value === undefined) {
        delete nextOptions[key];
      } else {
        nextOptions[key] = value;
      }
      return nextOptions;
    });
  };

  const updateWeatherStyle = (key, value) => {
    setWidgetOptions((current) => {
      const nextOptions = { ...current };
      const nextStyle = { ...(nextOptions.weatherStyle ?? {}) };
      if (value === "" || value === undefined || value === false) {
        delete nextStyle[key];
      } else {
        nextStyle[key] = value;
      }
      nextOptions.weatherStyle = nextStyle;
      return nextOptions;
    });
  };

  const handleGeocodeSearch = async () => {
    if (!searchQuery.trim()) return;
    setGeocodeLoading(true);
    setGeocodeError("");
    setGeocodeResults([]);
    try {
      const settings = data?.settings ?? {};
      const activeApiKey = weatherProv === "openweathermap"
        ? (settings.providers?.openweathermap ?? "")
        : (settings.providers?.weatherapi ?? "");

      const response = await fetch("/api/config/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "geocode",
          provider: weatherProv,
          q: searchQuery,
          apiKey: activeApiKey
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const results = await response.json();
      if (!results || results.length === 0) {
        setGeocodeError("Ничего не найдено");
      } else {
        setGeocodeResults(results);
      }
    } catch (err) {
      setGeocodeError(err.message || "Ошибка поиска");
    } finally {
      setGeocodeLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      const updatedParsed = {
        [widgetKey]: widgetOptions
      };
      const widgetYaml = yaml.dump([updatedParsed], { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd();

      const latestData = await loadLatestEditorData();
      const latestWidgetsTab = latestData?.settingsTabs?.find((tab) => tab.fileName === "widgets.yaml");
      const nextContent = replaceTopLevelYamlBlock(latestWidgetsTab?.content ?? "", modal.widgetIndex, widgetYaml);

      const response = await editorWriteFetch("/api/config/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "widgets.yaml", content: nextContent }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshConfigData(mutate, ["/api/config/editor", "/api/widgets"]);
      onSaved("Настройки погоды сохранены");
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  async function loadLatestEditorData() {
    const response = await fetch("/api/config/editor");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json();
  }

  const fonts = [
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

  const fontSizes = [
    ["", "По умолчанию (14px)"],
    ["12px", "Очень мелкий (12px)"],
    ["13px", "Мелкий (13px)"],
    ["14px", "Стандартный (14px)"],
    ["15px", "Средний (15px)"],
    ["16px", "Увеличенный (16px)"],
    ["18px", "Крупный (18px)"],
    ["20px", "Очень крупный (20px)"],
    ["24px", "Огромный (24px)"],
  ];

  const iconSizes = [
    ["", "По умолчанию (40px)"],
    ["24px", "Очень маленькая (24px)"],
    ["32px", "Маленькая (32px)"],
    ["40px", "Стандартная (40px)"],
    ["48px", "Средняя (48px)"],
    ["56px", "Увеличенная (56px)"],
    ["64px", "Крупная (64px)"],
    ["80px", "Очень крупная (80px)"],
  ];

  const layouts = [
    {
      id: "classic",
      name: "Стандартный",
      desc: "Иконка слева, температура и описание справа",
      preview: (
        <div className="flex items-center gap-2 rounded bg-theme-100/30 dark:bg-black/20 p-2 text-[10px] w-full max-w-[200px] border border-theme-300/30 dark:border-white/5">
          <div className="text-xl">☀️</div>
          <div className="flex flex-col text-left">
            <span className="font-semibold">Москва, 22°C</span>
            <span className="opacity-60 text-[9px]">Ясно</span>
          </div>
        </div>
      )
    },
    {
      id: "custom",
      name: "Колонки (Сплит)",
      desc: "Иконка с описанием слева, температура и город справа",
      preview: (
        <div className="flex items-center justify-center rounded bg-theme-100/30 dark:bg-black/20 p-2 text-[10px] w-full max-w-[200px] border border-theme-300/30 dark:border-white/5 gap-2">
          <div className="flex flex-col items-center text-center justify-center flex-1">
            <div className="text-xl">☀️</div>
            <span className="opacity-60 text-[8px] leading-tight text-center">Ясно</span>
          </div>
          <div className="flex flex-col items-center text-center justify-center flex-1">
            <span className="font-bold text-xs text-center">22°C</span>
            <span className="opacity-70 text-[9px] text-center">Москва</span>
          </div>
        </div>
      )
    },
    {
      id: "vertical",
      name: "Вертикальный",
      desc: "Иконка сверху, температура, описание и город друг под другом",
      preview: (
        <div className="flex flex-col items-center justify-center rounded bg-theme-100/30 dark:bg-black/20 p-2 text-[10px] w-full max-w-[200px] border border-theme-300/30 dark:border-white/5 text-center">
          <div className="text-xl">☀️</div>
          <span className="font-bold text-xs mt-0.5">22°C</span>
          <span className="opacity-80 text-[8px]">Ясно</span>
          <span className="opacity-60 text-[8px] mt-0.5 font-medium">Москва</span>
        </div>
      )
    }
  ];

  return (
    <EditorWindow
      storageKey="homepage-browser-editor-window-weather"
      title={`Настройка погоды: ${widgetKey}`}
      onClose={onClose}
      defaultWidth={760}
      defaultHeight={580}
      minWidth={660}
      minHeight={480}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col space-y-5 overflow-y-auto pr-1">
        {error && (
          <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-500/5 border border-rose-500/20 p-2 rounded">
            ⚠️ {error}
          </div>
        )}

        <div className="grid gap-5 md:grid-cols-2">
          {/* Left Column: Basic configuration and geocoding */}
          <div className="space-y-4 rounded-md border border-theme-300/50 p-4 dark:border-white/10 bg-theme-50/10 dark:bg-white/5">
            <h3 className="text-sm font-semibold text-theme-900 dark:text-theme-100">Основные параметры</h3>



            <div>
              <label className="block text-xs text-theme-600 dark:text-theme-300 mb-1">Отображаемое название города (Label)</label>
              <input
                type="text"
                value={weatherLabel}
                onChange={(e) => updateWidgetOption("label", e.target.value)}
                placeholder="Например, Москва"
                className="w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              />
              <span className="text-[9px] text-theme-400 mt-0.5 block">
                Если оставить пустым, название города будет автоматически загружено из API погоды.
              </span>
            </div>

            <div>
              <label className="block text-xs text-theme-600 dark:text-theme-300 mb-1">Ениницы измерения</label>
              <select
                value={weatherUnits}
                onChange={(e) => updateWidgetOption("units", e.target.value)}
                className="w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              >
                <option value="metric">Метрические (°C)</option>
                <option value="imperial">Имперские (°F)</option>
              </select>
            </div>

            <div className="border-t border-theme-300/20 dark:border-white/5 pt-3 mt-3">
              <label className="block text-xs text-theme-600 dark:text-theme-300 mb-1">Текущие координаты</label>
              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  readOnly
                  value={weatherLoc || "Не заданы"}
                  className="flex-1 rounded-md border border-theme-300/30 bg-theme-100/30 px-2 py-1.5 text-xs text-theme-500 dark:border-white/5 dark:bg-white/5 dark:text-theme-400 font-mono"
                />
              </div>

              <div className="mt-3">
                <label className="block text-[11px] font-semibold text-theme-700 dark:text-theme-300 mb-1">Поиск координат города</label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    placeholder="Например, Saratov"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleGeocodeSearch();
                      }
                    }}
                    className="flex-1 min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                  />
                  <button
                    type="button"
                    onClick={handleGeocodeSearch}
                    disabled={geocodeLoading}
                    className="px-3 rounded-md bg-theme-600 text-white hover:bg-theme-700 text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 cursor-pointer h-[28px] shrink-0"
                  >
                    {geocodeLoading ? "..." : "🔍 Искать"}
                  </button>
                </div>

                {geocodeError && (
                  <div className="text-[10px] text-rose-600 dark:text-rose-400 mt-1 font-medium">
                    ⚠️ {geocodeError}
                  </div>
                )}

                {geocodeResults.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto border border-theme-300/50 dark:border-white/10 rounded-md bg-white dark:bg-theme-900 text-xs divide-y divide-theme-200 dark:divide-white/5 shadow-md">
                    {geocodeResults.map((res, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setWeatherLoc(`${res.lat}, ${res.lon}`);
                          updateWidgetOption("latitude", res.lat);
                          updateWidgetOption("longitude", res.lon);
                          if (widgetOptions.location !== undefined) {
                            updateWidgetOption("location", undefined);
                          }
                          setGeocodeResults([]);
                        }}
                        className="p-2 cursor-pointer hover:bg-theme-50 dark:hover:bg-white/5 transition-colors flex justify-between items-center"
                      >
                        <span className="font-medium text-theme-900 dark:text-theme-100">{res.name}</span>
                        <span className="text-[10px] text-theme-500 dark:text-theme-400 font-mono shrink-0">{res.lat.toFixed(4)}, {res.lon.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Styling & Previews */}
          <div className="space-y-4 rounded-md border border-theme-300/50 p-4 dark:border-white/10 bg-theme-50/10 dark:bg-white/5 flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-theme-900 dark:text-theme-100">Стиль отображения</h3>

              {/* Layout Styles Selector */}
              <div>
                <label className="block text-xs text-theme-600 dark:text-theme-300 mb-2">Выберите шаблон визуализации</label>
                <div className="space-y-2">
                  {layouts.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => updateWeatherStyle("layout", item.id)}
                      className={classNames(
                        "flex items-center gap-4 p-3 rounded-md border cursor-pointer transition-all hover:bg-theme-100/20 dark:hover:bg-white/5",
                        (weatherStyle.layout || "classic") === item.id
                          ? "border-theme-600 bg-theme-100/10 dark:border-white dark:bg-white/5"
                          : "border-theme-300/40 dark:border-white/10"
                      )}
                    >
                      <div className="flex-1 text-left min-w-0">
                        <span className="text-xs font-semibold text-theme-900 dark:text-theme-100 block">{item.name}</span>
                        <span className="text-[10px] text-theme-500 dark:text-theme-400 block mt-0.5 leading-normal">{item.desc}</span>
                      </div>
                      <div className="shrink-0">
                        {item.preview}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Layout customizations */}
              <div className="grid gap-3 grid-cols-2 border-t border-theme-300/20 dark:border-white/5 pt-3">
                <div>
                  <label className="block text-xs text-theme-600 dark:text-theme-300">Шрифт текста погоды</label>
                  <select
                    value={weatherStyle.fontFamily ?? ""}
                    onChange={(e) => updateWeatherStyle("fontFamily", e.target.value)}
                    className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 h-[28px]"
                  >
                    {fonts.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-theme-600 dark:text-theme-300">Размер шрифта текста</label>
                  <select
                    value={weatherStyle.fontSize ?? ""}
                    onChange={(e) => updateWeatherStyle("fontSize", e.target.value)}
                    className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 h-[28px]"
                  >
                    {fontSizes.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs text-theme-600 dark:text-theme-300">Размер иконки погоды</label>
                  <select
                    value={weatherStyle.iconSize ?? ""}
                    onChange={(e) => updateWeatherStyle("iconSize", e.target.value)}
                    className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 h-[28px]"
                  >
                    {iconSizes.map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs text-theme-600 dark:text-theme-300">Цвет текста погоды</label>
                  <ColorInput
                    value={weatherStyle.textColor ?? ""}
                    onChange={(val) => updateWeatherStyle("textColor", val)}
                    placeholder="#ffffff"
                    compact={true}
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-theme-600 dark:text-theme-300 cursor-pointer p-1 col-span-2 mt-1">
                  <input
                    type="checkbox"
                    checked={weatherStyle.hideBackground ?? false}
                    onChange={(e) => updateWeatherStyle("hideBackground", e.target.checked)}
                    className="rounded border-theme-300 bg-theme-50/90 text-theme-600 dark:border-white/10 dark:bg-theme-900/90"
                  />
                  Скрыть фон виджета погоды (сделать прозрачным)
                </label>

                <label className="flex items-center gap-2 text-xs text-theme-600 dark:text-theme-300 cursor-pointer p-1 col-span-2 mt-1">
                  <input
                    type="checkbox"
                    checked={weatherStyle.hideDescription ?? false}
                    onChange={(e) => updateWeatherStyle("hideDescription", e.target.checked)}
                    className="rounded border-theme-300 bg-theme-50/90 text-theme-600 dark:border-white/10 dark:bg-theme-900/90"
                  />
                  Скрыть описание состояния погоды (например, "переменная облачность")
                </label>
              </div>
            </div>

            {/* Save Buttons */}
            <div className="flex justify-end gap-2 border-t border-theme-300/20 dark:border-white/5 pt-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-theme-300/50 bg-theme-100/50 hover:bg-theme-200/50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-theme-600 text-white hover:bg-theme-700 px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </EditorWindow>
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
  wrapperClassName = "",
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
    <div className={classNames("fixed inset-0 z-[60] bg-black/50", wrapperClassName)} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
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
        ? typeFields.filter(([key]) => !collapsedBookmarkFieldKeys.has(key) && key !== "href" && key !== "showLink")
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
    const response = await editorWriteFetch("/api/config/editor", {
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

  async function handleClone() {
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
      const cloneName = buildUniqueEntryName(latestData[modal.type], modal.type, modal.groupName, trimmedName);
      await save(addRawEntry(latestData[modal.type], modal.type, modal.groupName, cloneName, config));
      onSaved(`Копия создана: ${cloneName}`);
      onClose();
    } catch (cloneError) {
      setError(cloneError.message);
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
      {isBookmarkModal && (
        <div className="grid grid-cols-3 gap-3 items-end">
          <div className="col-span-2">
            <Field
              name="href"
              label="URL"
              value={form.fields.href ?? ""}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  fields: {
                    ...current.fields,
                    href: value,
                  },
                }))
              }
            />
          </div>
          <Field
            name="showLink"
            label="Отображать ссылку"
            value={form.fields.showLink ?? ""}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                fields: {
                  ...current.fields,
                  showLink: value,
                },
              }))
            }
          />
        </div>
      )}
      <div className={classNames("grid min-w-0 gap-2", isServiceModal ? "grid-cols-3" : "md:grid-cols-2")}>
        {primaryTypeFields.map(([key, label]) => (
          <Field
            key={key}
            name={key}
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
                  name={key}
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
                  name={key}
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleClone}
              disabled={saving}
              className="rounded-md border border-theme-400/60 px-3 py-2 text-sm text-theme-700 disabled:opacity-60 dark:text-theme-200"
            >
              Клонировать
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="rounded-md border border-rose-400/60 px-3 py-2 text-sm text-rose-700 disabled:opacity-60 dark:text-rose-300"
            >
              Удалить
            </button>
          </div>
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
            {isServiceModal && (
              <WidgetTemplateSelector
                extraYaml={form.extraYaml}
                onChange={(nextYaml) =>
                  setForm((current) => ({
                    ...current,
                    extraYaml: nextYaml,
                  }))
                }
              />
            )}
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

const WIDGET_TEMPLATES = {
  "argocd": "widget:\n  type: argocd\n  url: http://argocd.host.or.ip:port\n  key: argocdapikey",
  "truenas": "widget:\n  type: truenas\n  url: http://truenas.host.or.ip\n  version: 2 # optional, defaults to 1\n  username: user # not required if using api key\n  password: pass # not required if using api key\n  key: yourtruenasapikey # not required if using username / password\n  enablePools: true # optional, defaults to false\n  nasType: scale # defaults to scale, must be set to 'core' if using enablePools with TrueNAS Core",
  "photoprism": "widget:\n  type: photoprism\n  url: http://photoprism.host.or.ip:port\n  username: admin # required only if using username/password\n  password: password # required only if using username/password\n  key: # required only if using app passwords",
  "mikrotik": "widget:\n  type: mikrotik\n  url: https://mikrotik.host.or.ip\n  username: username\n  password: password",
  "prometheusmetric": "widget:\n  type: prometheusmetric\n  url: https://prometheus.host.or.ip\n  refreshInterval: 10000 # optional - in milliseconds, defaults to 10s\n  metrics:\n    - label: Metric 1\n      query: alertmanager_alerts{state=\"active\"}\n    - label: Metric 2\n      query: apiserver_storage_size_bytes{node=\"mynode\"}\n      format:\n        type: bytes\n    - label: Metric 3\n      query: avg(prometheus_notifications_latency_seconds)\n      format:\n        type: number\n        suffix: s\n        options:\n          maximumFractionDigits: 4\n    - label: Metric 4\n      query: time()\n      refreshInterval: 1000 # will override global refreshInterval\n      format:\n        type: date\n        scale: 1000\n        options:\n          timeStyle: medium",
  "flood": "widget:\n  type: flood\n  url: http://flood.host.or.ip\n  username: username # if set\n  password: password # if set",
  "stash": "widget:\n  type: stash\n  url: http://stash.host.or.ip\n  key: stashapikey\n  fields: [\"scenes\", \"images\"] # optional - default fields shown",
  "lidarr": "widget:\n  type: lidarr\n  url: http://lidarr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "fritzbox": "widget:\n  type: fritzbox\n  url: http://192.168.178.1",
  "xteve": "widget:\n  type: xteve\n  url: http://xteve.host.or.ip\n  username: username # optional\n  password: password # optional",
  "crowdsec": "widget:\n  type: crowdsec\n  url: http://crowdsechostorip:port\n  username: localhost # machine_id in crowdsec\n  password: password\n  limit24h: true # optional, limits alerts to last 24h. Default: false",
  "calibre-web": "widget:\n  type: calibreweb\n  url: http://your.calibreweb.host:port\n  username: username\n  password: password",
  "gitea": "widget:\n  type: gitea\n  url: http://gitea.host.or.ip:port\n  key: giteaapitoken",
  "transmission": "widget:\n  type: transmission\n  url: http://transmission.host.or.ip\n  username: username\n  password: password\n  rpcUrl: /transmission/ # Optional. Matches the value of \"rpc-url\" in your Transmission's settings.json file",
  "prowlarr": "widget:\n  type: prowlarr\n  url: http://prowlarr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "vikunja": "widget:\n  type: vikunja\n  url: http[s]://vikunja.host.or.ip[:port]\n  key: vikunjaapikey\n  enableTaskList: true # optional, defaults to false\n  version: 2 # optional, defaults to 1",
  "komga": "widget:\n  type: komga\n  url: http://komga.host.or.ip:port\n  username: username\n  password: password\n  key: komgaapikey # optional",
  "channelsdvrserver": "widget:\n  type: channelsdvrserver\n  url: http://server.host.or.ip:port",
  "linkwarden": "widget:\n  type: linkwarden\n  url: http://linkwarden.host.or.ip\n  key: myApiKeyHere # On your Linkwarden install, go to Settings > Access Tokens. Generate a token.",
  "gatus": "widget:\n  type: gatus\n  url: http://gatus.host.or.ip:port",
  "gamedig": "widget:\n  type: gamedig\n  serverType: csgo # see https://github.com/gamedig/node-gamedig#games-list\n  url: udp://server.host.or.ip:port\n  gameToken: # optional, a token used by gamedig with certain games",
  "plex-tautulli": "widget:\n  type: tautulli\n  url: http://tautulli.host.or.ip:port\n  key: apikeyapikeyapikeyapikeyapikey\n  enableUser: true # optional, defaults to false\n  showEpisodeNumber: true # optional, defaults to false\n  expandOneStreamToTwoRows: false # optional, defaults to true",
  "wallos": "widget:\n  type: wallos\n  url: http://wallos.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "sonarr": "widget:\n  type: sonarr\n  url: http://sonarr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey\n  enableQueue: true # optional, defaults to false",
  "mylar": "widget:\n  type: mylar\n  url: http://mylar3.host.or.ip:port\n  key: yourmylar3apikey",
  "stocks": "widget:\n  type: stocks\n  provider: finnhub\n  showUSMarketStatus: true # optional, defaults to true\n  watchlist:\n    - GME\n    - AMC\n    - NVDA\n    - TSM\n    - BRK.A\n    - TSLA\n    - AAPL\n    - MSFT\n    - AMZN\n    - BRK.B",
  "audiobookshelf": "widget:\n  type: audiobookshelf\n  url: http://audiobookshelf.host.or.ip:port\n  key: audiobookshelflapikey",
  "mastodon": "widget:\n  type: mastodon\n  url: https://mastodon.host.name",
  "zabbix": "widget:\n  type: zabbix\n  url: http://zabbix.host.or.ip/zabbix\n  key: your-api-key",
  "diskstation": "widget:\n  type: diskstation\n  url: http://diskstation.host.or.ip:port\n  username: username\n  password: password\n  volume: volume_N # optional",
  "pterodactyl": "widget:\n  type: pterodactyl\n  url: http://pterodactylhost:port\n  key: pterodactylapikey",
  "nginx-proxy-manager": "widget:\n  type: npm\n  url: http://npm.host.or.ip\n  username: admin_username\n  password: admin_password",
  "dispatcharr": "widget:\n  type: dispatcharr\n  url: http://dispatcharr.host.or.ip\n  username: username\n  password: password\n  enableActiveStreams: true # optional, defaults to false",
  "develancacheui": "widget:\n  type: develancacheui\n  url: http://your.develancacheui_backend.host:port",
  "tailscale": "widget:\n  type: tailscale\n  deviceid: deviceid\n  key: tailscalekey",
  "readarr": "widget:\n  type: readarr\n  url: http://readarr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "unmanic": "widget:\n  type: unmanic\n  url: http://unmanic.host.or.ip:port",
  "cloudflared": "widget:\n  type: cloudflared\n  accountid: accountid # from zero trust dashboard url e.g. https://one.dash.cloudflare.com/<accountid>/home/quick-start\n  tunnelid: tunnelid # found in tunnels dashboard under the tunnel name\n  key: cloudflareapitoken # api token with `Account.Cloudflare Tunnel:Read` https://dash.cloudflare.com/profile/api-tokens",
  "coin-market-cap": "widget:\n  type: coinmarketcap\n  currency: GBP # Optional\n  symbols: [BTC, LTC, ETH]\n  key: apikeyapikeyapikeyapikeyapikey\n  defaultinterval: 7d # Optional",
  "customapi": "widget:\n  type: customapi\n  url: http://custom.api.host.or.ip:port/path/to/exact/api/endpoint\n  refreshInterval: 10000 # optional - in milliseconds, defaults to 10s\n  username: username # auth - optional\n  password: password # auth - optional\n  method: GET # optional, e.g. POST\n  headers: # optional, must be object, see below\n  requestBody: # optional, can be string or object, see below\n  display: # optional, default to block, see below\n  mappings:\n    - field: key\n      label: Field 1\n      format: text # optional - defaults to text\n    - field: path.to.key2\n      format: number # optional - defaults to text\n      label: Field 2\n    - field: path.to.another.key3\n      label: Field 3\n      format: percent # optional - defaults to text\n    - field: key\n      label: Field 4\n      format: date # optional - defaults to text\n      locale: nl # optional\n      dateStyle: long # optional - defaults to \"long\". Allowed values: `[\"full\", \"long\", \"medium\", \"short\"]`.\n      timeStyle: medium # optional - Allowed values: `[\"full\", \"long\", \"medium\", \"short\"]`.\n    - field: key\n      label: Field 5\n      format: relativeDate # optional - defaults to text\n      locale: nl # optional\n      style: short # optional - defaults to \"long\". Allowed values: `[\"long\", \"short\", \"narrow\"]`.\n      numeric: auto # optional - defaults to \"always\". Allowed values `[\"always\", \"auto\"]`.\n    - field: key\n      label: Field 6\n      format: text\n      additionalField: # optional\n        field: hourly.time.key\n        color: theme # optional - defaults to \"\". Allowed values: `[\"theme\", \"adaptive\", \"black\", \"white\"]`.\n        format: date # optional\n    - field: key\n      label: Number of things in array\n      format: size\n    # This (no field) will take the root of the API response, e.g. when APIs return an array:\n    - label: Number of items\n      format: size",
  "seerr": "widget:\n  type: seerr\n  url: http://seerr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "radarr": "widget:\n  type: radarr\n  url: http://radarr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey\n  enableQueue: true # optional, defaults to false",
  "ntfy": "widget:\n  type: ntfy\n  url: http://ntfy.host.or.ip:port # required\n  topic: mytopic # required\n  # key: tk_accesstoken # optional — for token auth\n  # username: user # optional — for basic auth\n  # password: pass # optional — for basic auth",
  "nextcloud": "widget:\n  type: nextcloud\n  url: https://nextcloud.host.or.ip:port\n  key: token",
  "tandoor": "widget:\n  type: tandoor\n  url: http://tandoor-frontend.host.or.ip\n  key: tandoor-api-token",
  "pfsense": "widget:\n  type: pfsense\n  url: http://pfsense.host.or.ip:port\n  username: user # optional, or API key\n  password: pass # optional, or API key\n  headers: # optional, or username/password\n    X-API-Key: key\n  wan: igb0\n  version: 2 # optional, defaults to 1 for api v1\n  fields: [\"load\", \"memory\", \"temp\", \"wanStatus\"] # optional",
  "frigate": "widget:\n  type: frigate\n  url: http://frigate.host.or.ip:port\n  enableRecentEvents: true # Optional, defaults to false\n  username: username # optional\n  password: password # optional",
  "qbittorrent": "widget:\n  type: qbittorrent\n  url: http://qbittorrent.host.or.ip\n  username: username\n  password: password\n  enableLeechProgress: true # optional, defaults to false\n  enableLeechSize: true # optional, defaults to false",
  "arcane": "widget:\n  type: arcane\n  url: http://localhost:3552\n  env: 0 # required, 0 is Arcane default local environment\n  key: your-api-key\n  fields: [\"running\", \"stopped\", \"total\", \"image_updates\"] # optional",
  "mjpeg": "widget:\n  type: mjpeg\n  stream: http://mjpeg.host.or.ip/webcam/stream",
  "slskd": "widget:\n  type: slskd\n  url: http[s]://slskd.host.or.ip[:5030]\n  key: generatedapikey",
  "esphome": "widget:\n  type: esphome\n  url: http://esphome.host.or.ip:port\n  username: myesphomeuser # only if auth enabled\n  password: myesphomepass # only if auth enabled",
  "openwrt": "widget:\n  type: openwrt\n  url: http://host.or.ip\n  username: homepage\n  password: pass\n  interfaceName: eth0 # optional",
  "netalertx": "widget:\n  type: netalertx\n  url: http://ip:port # use backend port for widget version 2+\n  key: yournetalertxapitoken\n  version: 2 # optional, default is 1",
  "peanut": "widget:\n  type: peanut\n  url: http://peanut.host.or.ip:port\n  key: nameofyourups\n  username: username # only needed if set\n  password: password # only needed if set",
  "ghostfolio": "widget:\n  type: ghostfolio\n  url: http://ghostfoliohost:port\n  key: ghostfoliobearertoken",
  "sabnzbd": "widget:\n  type: sabnzbd\n  url: http://sabnzbd.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "jackett": "widget:\n  type: jackett\n  url: http://jackett.host.or.ip\n  password: jackettadminpassword # optional",
  "karakeep": "widget:\n  type: karakeep\n  url: http[s]://karakeep.host.or.ip[:port]\n  key: karakeep_api_key",
  "wgeasy": "widget:\n  type: wgeasy\n  url: http://wg.easy.or.ip\n  version: 2 # optional, default is 1\n  username: yourwgusername # required for v15 and above\n  password: yourwgeasypassword\n  threshold: 2 # optional",
  "jellystat": "widget:\n  type: jellystat\n  url: http://jellystat.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey\n  days: 30 # optional, defaults to 30",
  "homebridge": "widget:\n  type: homebridge\n  url: http://homebridge.host.or.ip:port\n  username: username\n  password: password",
  "authentik": "widget:\n  type: authentik\n  url: http://authentik.host.or.ip:port\n  key: api_token\n  version: 2 # optional, default is 1",
  "iframe": "widget:\n  type: iframe\n  name: myIframe\n  src: http://example.com",
  "proxmoxbackupserver": "widget:\n  type: proxmoxbackupserver\n  url: https://proxmoxbackupserver.host:port\n  username: api_token_id\n  password: api_token_secret\n  datastore: datastore_name #optional; if ommitted, will display a combination of all datastores used / total",
  "filebrowser": "widget:\n  type: filebrowser\n  url: http://filebrowserhostorip:port\n  username: username\n  password: password\n  authHeader: X-My-Header # If using Proxy header authentication",
  "technitium": "widget:\n  type: technitium\n  url: <url to dns server>\n  key: biglongapitoken\n  node: <node dns name or cluster> # optional, defaults to current node\n  range: LastDay # optional, defaults to LastHour",
  "healthchecks": "widget:\n  type: healthchecks\n  url: http://healthchecks.host.or.ip:port\n  key: <YOUR_API_KEY>\n  uuid: <CHECK_UUID> # optional, if not included total statistics for all checks is shown",
  "proxmox": "widget:\n  type: proxmox\n  url: https://proxmox.host.or.ip:8006\n  username: api_token_id\n  password: api_token_secret\n  node: pve-1 # optional",
  "scrutiny": "widget:\n  type: scrutiny\n  url: http://scrutiny.host.or.ip",
  "hdhomerun": "widget:\n  type: hdhomerun\n  url: http://hdhomerun.host.or.ip\n  tuner: 0 # optional - defaults to 0, used for tuner-specific fields\n  fields: [\"channels\", \"hd\"] # optional - default fields shown",
  "yourspotify": "widget:\n  type: yourspotify\n  url: http://your-spotify-server.host.or.ip # if using lsio image, add /api/\n  key: apikeyapikeyapikeyapikeyapikey\n  interval: month # optional, defaults to week",
  "tdarr": "widget:\n  type: tdarr\n  url: http://tdarr.host.or.ip\n  key: tdarrapikey # optional",
  "homebox": "widget:\n  type: homebox\n  url: http://homebox.host.or.ip:port\n  username: username\n  password: password\n  fields: [\"items\", \"locations\", \"totalValue\"] # optional - default fields shown",
  "kopia": "widget:\n  type: kopia\n  url: http://kopia.host.or.ip:port\n  username: username\n  password: password\n  snapshotHost: hostname # optional\n  snapshotPath: path # optional",
  "nzbget": "widget:\n  type: nzbget\n  url: http://nzbget.host.or.ip\n  username: controlusername\n  password: controlpassword",
  "booklore": "widget:\n  type: booklore\n  url: https://booklore.host.or.ip\n  username: username\n  password: password",
  "rutorrent": "widget:\n  type: rutorrent\n  url: http://rutorrent.host.or.ip\n  username: username # optional, false if not used\n  password: password # optional, false if not used",
  "grafana": "widget:\n  type: grafana\n  version: 2 # optional, default is 1\n  alerts: alertmanager # optional, default is grafana\n  url: http://grafana.host.or.ip:port\n  username: username\n  password: password",
  "swagdashboard": "widget:\n  type: swagdashboard\n  url: http://swagdashboard.host.or.ip:adminport # default port is 81",
  "romm": "widget:\n  type: romm\n  url: http://romm.host.or.ip\n  fields: [\"platforms\", \"totalRoms\", \"saves\", \"states\"] # optional - default fields shown",
  "trilium": "widget:\n  type: trilium\n  url: https://trilium.host.or.ip\n  key: etapi_token",
  "downloadstation": "widget:\n  type: downloadstation\n  url: http://downloadstation.host.or.ip:port\n  username: username\n  password: password",
  "apcups": "widget:\n  type: apcups\n  url: tcp://your.acpupsd.host:3551",
  "adguard-home": "widget:\n  type: adguard\n  url: http://adguard.host.or.ip\n  username: admin\n  password: password",
  "evcc": "widget:\n  type: evcc\n  url: http://evcc.host.or.ip:port",
  "syncthing-relay-server": "widget:\n  type: strelaysrv\n  url: http://syncthing.host.or.ip:22070",
  "pihole": "widget:\n  type: pihole\n  url: http://pi.hole.or.ip\n  version: 6 # required if running v6 or higher, defaults to 5\n  key: yourpiholeapikey # optional, in v6 can be your password or app password",
  "calendar": "widget:\n  type: calendar\n  firstDayInWeek: sunday # optional - defaults to monday\n  view: monthly # optional - possible values monthly, agenda\n  maxEvents: 10 # optional - defaults to 10\n  showTime: true # optional - show time for event happening today - defaults to false\n  timezone: America/Los_Angeles # optional and only when timezone is not detected properly (slightly slower performance) - force timezone for ical events (if it's the same - no change, if missing or different in ical - will be converted to this timezone)\n  integrations: # optional\n    - type: sonarr # active widget type that is currently enabled on homepage - possible values: radarr, sonarr, lidarr, readarr, ical\n      service_group: Media # group name where widget exists\n      service_name: Sonarr # service name for that widget\n      color: teal # optional - defaults to pre-defined color for the service (teal for sonarr)\n      baseUrl: https://sonarr.domain.url # optional - adds links to sonarr/radarr pages\n      params: # optional - additional params for the service\n        unmonitored: true # optional - defaults to false, used with *arr stack\n    - type: ical # Show calendar events from another service\n      url: https://domain.url/with/link/to.ics # URL with calendar events\n      name: My Events # required - name for these calendar events\n      color: zinc # optional - defaults to pre-defined color for the service (zinc for ical)\n      params: # optional - additional params for the service\n        showName: true # optional - show name before event title in event line - defaults to false",
  "navidrome": "widget:\n  type: navidrome\n  url: http://navidrome.host.or.ip:port\n  user: username\n  token: token #md5(password + salt)\n  salt: randomsalt",
  "opendtu": "widget:\n  type: opendtu\n  url: http://opendtu.host.or.ip",
  "sparkyfitness": "widget:\n  type: sparkyfitness\n  url: http://sparkyfitness.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "plex": "widget:\n  type: plex\n  url: http://plex.host.or.ip:32400\n  key: mytokenhere # see https://www.plexopedia.com/plex-media-server/general/plex-token/",
  "fileflows": "widget:\n  type: fileflows\n  url: http://your.fileflows.host:port",
  "traefik": "widget:\n  type: traefik\n  url: http://traefik.host.or.ip\n  username: username # optional\n  password: password # optional",
  "plantit": "widget:\n  type: plantit\n  url: http://plant-it.host.or.ip:port # api port\n  key: plantit-api-key",
  "jdownloader": "widget:\n  type: jdownloader\n  username: JDownloader Username\n  password: JDownloader Password\n  client: Name of JDownloader Instance",
  "urbackup": "widget:\n  type: urbackup\n  username: urbackupUsername\n  password: urbackupPassword\n  url: http://urbackupUrl:55414\n  maxDays: 5 # optional",
  "deluge": "widget:\n  type: deluge\n  url: http://deluge.host.or.ip\n  password: password # webui password\n  enableLeechProgress: true # optional, defaults to false",
  "headscale": "widget:\n  type: headscale\n  url: http://headscale.host.or.ip:port\n  nodeId: nodeid\n  key: headscaleapiaccesstoken",
  "watchtower": "widget:\n  type: watchtower\n  url: http://your-ip-address:8080\n  key: demotoken",
  "atsumeru": "widget:\n  type: atsumeru\n  url: http://atsumeru.host.or.ip:port\n  username: username\n  password: password",
  "pyload": "widget:\n  type: pyload\n  url: http://pyload.host.or.ip:port\n  username: username\n  password: password # only needed if set\n  key: pyloadapikey # only needed if set, takes precedence over username/password",
  "minecraft": "widget:\n  type: minecraft\n  url: udp://minecraftserveripordomain:port",
  "spoolman": "widget:\n  type: spoolman\n  url: http://spoolman.host.or.ip\n  spoolIds: [1, 2, 3, 4] # optional",
  "prometheus": "widget:\n  type: prometheus\n  url: http://prometheushost:port",
  "kavita": "widget:\n  type: kavita\n  url: http://kavita.host.or.ip:port\n  username: username\n  password: password\n  key: kavitaapikey # Optional, e.g. if not using username and password",
  "unraid": "widget:\n  type: unraid\n  url: https://unraid.host.or.ip\n  key: api-key\n  pool1: pool1name # required only if using pool1 fields\n  pool2: pool2name # required only if using pool2 fields\n  pool3: pool3name # required only if using pool3 fields\n  pool4: pool4name # required only if using pool4 fields",
  "immich": "widget:\n  type: immich\n  url: http://immich.host.or.ip\n  key: adminapikeyadminapikeyadminapikey\n  version: 2 # optional, default is 1",
  "backrest": "widget:\n  type: backrest\n  url: http://backrest.host.or.ip\n  username: admin # optional if auth is enabled in Backrest\n  password: admin # optional if auth is enabled in Backrest",
  "opnsense": "widget:\n  type: opnsense\n  url: http://opnsense.host.or.ip\n  username: key\n  password: secret\n  wan: opt1 # optional, defaults to wan",
  "unifi-controller": "widget:\n  type: unifi\n  url: https://unifi.host.or.ip:port\n  site: Site Name # optional\n  username: user\n  password: pass\n  key: unifiapikey # required if using API key instead of username/password",
  "openmediavault": "widget:\n  type: openmediavault\n  url: http://omv.host.or.ip\n  username: admin\n  password: pass\n  method: services.getStatus # required",
  "autobrr": "widget:\n  type: autobrr\n  url: http://autobrr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "uptimerobot": "widget:\n  type: uptimerobot\n  url: https://api.uptimerobot.com\n  key: uptimerobotapitoken",
  "uptime-kuma": "widget:\n  type: uptimekuma\n  url: http://uptimekuma.host.or.ip:port\n  slug: statuspageslug",
  "octoprint": "widget:\n  type: octoprint\n  url: http://octoprint.host.or.ip:port\n  key: youroctoprintapikey",
  "gotify": "widget:\n  type: gotify\n  url: http://gotify.host.or.ip\n  key: clientoken",
  "miniflux": "widget:\n  type: miniflux\n  url: http://miniflux.host.or.ip:port\n  key: minifluxapikey",
  "medusa": "widget:\n  type: medusa\n  url: http://medusa.host.or.ip:port\n  key: medusaapikeyapikeyapikeyapikeyapikey",
  "changedetectionio": "widget:\n  type: changedetectionio\n  url: http://changedetection.host.or.ip:port\n  key: apikeyapikeyapikeyapikeyapikey",
  "mealie": "widget:\n  type: mealie\n  url: http://mealie-frontend.host.or.ip\n  key: mealieapitoken\n  version: 2 # only required if version > 1, defaults to 1",
  "gitlab": "widget:\n  type: gitlab\n  url: http://gitlab.host.or.ip:port\n  key: personal-access-token\n  user_id: 123456",
  "beszel": "widget:\n  type: beszel\n  url: http://beszel.host.or.ip\n  username: username # email\n  password: password\n  systemId: systemId # optional\n  version: 2 # optional, default is 1",
  "moonraker": "widget:\n  type: moonraker\n  url: http://moonraker.host.or.ip:port",
  "dockhand": "widget:\n  type: dockhand\n  url: http://localhost:3001\n  environment: local # optional: name or id; aggregates all when omitted\n  username: your-user # required for local auth\n  password: your-pass # required for local auth",
  "azuredevops": "widget:\n  type: azuredevops\n  organization: myOrganization\n  project: myProject\n  definitionId: pipelineDefinitionId # required for pipelines\n  branchName: branchName # optional for pipelines, leave empty for all\n  userEmail: email # required for pull requests\n  repositoryId: prRepositoryId # required for pull requests\n  key: personalaccesstoken",
  "whatsupdocker": "widget:\n  type: whatsupdocker\n  url: http://whatsupdocker:port\n  username: username # optional\n  password: password # optional",
  "emby": "widget:\n  type: emby\n  url: http://emby.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey\n  enableBlocks: true # optional, defaults to false\n  enableNowPlaying: true # optional, defaults to true\n  enableUser: true # optional, defaults to false\n  enableMediaControl: false # optional, defaults to true\n  showEpisodeNumber: true # optional, defaults to false\n  expandOneStreamToTwoRows: false # optional, defaults to true",
  "glances": "widget:\n  type: glances\n  url: http://glances.host.or.ip:port\n  username: user # optional if auth enabled in Glances\n  password: pass # optional if auth enabled in Glances\n  version: 4 # required only if running glances v4 or higher, defaults to 3\n  metric: cpu\n  diskUnits: bytes # optional, bytes (default) or bbytes. Only applies to disk\n  refreshInterval: 5000 # optional - in milliseconds, defaults to 1000 or more, depending on the metric\n  pointsLimit: 15 # optional, defaults to 15",
  "omada": "widget:\n  type: omada\n  url: http://omada.host.or.ip:port\n  username: username\n  password: password\n  site: sitename",
  "bazarr": "widget:\n  type: bazarr\n  url: http://bazarr.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "firefly": "widget:\n  type: firefly\n  url: https://firefly.host.or.ip\n  key: personalaccesstoken.personalaccesstoken.personalaccesstoken",
  "unifi-drive": "widget:\n  type: unifi_drive\n  url: https://unifi.host.or.ip\n  username: your_username\n  password: your_password",
  "jellyfin": "widget:\n  type: jellyfin\n  url: http://jellyfin.host.or.ip:port\n  key: apikeyapikeyapikeyapikeyapikey\n  version: 2 # optional, default is 1\n  enableBlocks: true # optional, defaults to false\n  enableNowPlaying: true # optional, defaults to true\n  enableUser: true # optional, defaults to false\n  enableMediaControl: false # optional, defaults to true\n  showEpisodeNumber: true # optional, defaults to false\n  expandOneStreamToTwoRows: false # optional, defaults to true",
  "lubelogger": "widget:\n  type: lubelogger\n  url: https://lubelogger.host.or.ip\n  username: lubeloggerusername\n  password: lubeloggerpassword\n  vehicleID: 1 # optional, changes to single-vehicle version",
  "caddy": "widget:\n  type: caddy\n  url: http://caddy.host.or.ip:adminport # default admin port is 2019",
  "checkmk": "widget:\n  type: checkmk\n  url: http://checkmk.host.or.ip:port\n  site: your-site-name-cla-by-default\n  username: username\n  password: password",
  "qnap": "widget:\n  type: qnap\n  url: http://qnap.host.or.ip:port\n  username: user\n  password: pass",
  "ombi": "widget:\n  type: ombi\n  url: http://ombi.host.or.ip\n  key: apikeyapikeyapikeyapikeyapikey",
  "komodo": "widget:\n  type: komodo\n  url: http://komodo.hostname.or.ip:port\n  key: K-xxxxxx...\n  secret: S-xxxxxx...\n  showSummary: true # optional, default: false. Takes precedence over showStacks\n  showStacks: true # optional, default: false",
  "mailcow": "widget:\n  type: mailcow\n  url: https://mailcow.host.or.ip\n  key: mailcowapikey",
  "portainer": "widget:\n  type: portainer\n  url: https://portainer.host.or.ip:9443\n  env: 1\n  kubernetes: true # optional, defaults to false\n  key: ptr_accesskeyaccesskeyaccesskeyaccesskey",
  "netdata": "widget:\n  type: netdata\n  url: http://netdata.host.or.ip",
  "myspeed": "widget:\n  type: myspeed\n  url: http://myspeed.host.or.ip:port\n  password: password # only required if password is set",
  "suwayomi": "widget:\n  type: suwayomi\n  url: http://suwayomi.host.or.ip\n  username: username #optional\n  password: password #optional\n  category: 0 #optional, defaults to all categories",
  "tubearchivist": "widget:\n  type: tubearchivist\n  url: http://tubearchivist.host.or.ip\n  key: tubearchivistapikey",
  "gluetun": "widget:\n  type: gluetun\n  url: http://gluetun.host.or.ip:port\n  key: gluetunkey # Not required if /v1/publicip/ip endpoint is configured with `auth = none`\n  version: 2 # optional, default is 1",
  "homeassistant": "widget:\n  type: homeassistant\n  url: http://homeassistant.host.or.ip:port\n  key: access_token\n  custom:\n    - state: sensor.total_power\n    - state: sensor.total_energy_today\n      label: energy today\n    - template: \"{{ states.switch|selectattr('state','equalto','on')|list|length }}\"\n      label: switches on\n    - state: weather.forecast_home\n      label: wind speed\n      value: \"{attributes.wind_speed} {attributes.wind_speed_unit}\"",
  "pangolin": "widget:\n  type: pangolin\n  url: https://api.pangolin.net\n  key: your-api-key\n  org: your-org-id",
  "speedtest-tracker": "widget:\n  type: speedtest\n  url: http://speedtest.host.or.ip\n  version: 1 # optional, default is 1\n  key: speedtestapikey # required for version 2\n  bitratePrecision: 3 # optional, default is 0",
  "nextdns": "widget:\n  type: nextdns\n  profile: profileid\n  key: yourapikeyhere",
  "freshrss": "widget:\n  type: freshrss\n  url: http://freshrss.host.or.ip:port\n  username: username\n  password: password",
  "tracearr": "widget:\n  type: tracearr\n  url: http://tracearr.host.or.ip:3000\n  key: apikeyapikeyapikeyapikeyapikey\n  view: both # optional, \"summary\", \"details\", or \"both\", defaults to \"details\"\n  enableUser: true # optional, defaults to false\n  showEpisodeNumber: true # optional, defaults to false\n  expandOneStreamToTwoRows: false # optional, defaults to true",
  "paperlessngx": "widget:\n  type: paperlessngx\n  url: http://paperlessngx.host.or.ip:port\n  username: username\n  password: password",
  "torrsyncarr": "widget:\n  type: torrsyncarr\n  url: http://192.168.1.132:8099\n  fields:\n    - movies\n    - series\n    - anime\n    - cartoons\n    - import"
};

const WIDGET_BOOLEANS = {
  "jellyfin": [
    "enableBlocks",
    "enableMediaControl",
    "enableNowPlaying",
    "enableUser",
    "expandOneStreamToTwoRows",
    "showEpisodeNumber"
  ],
  "dispatcharr": [
    "enableActiveStreams"
  ],
  "truenas": [
    "enablePools"
  ],
  "tautulli": [
    "enableUser",
    "expandOneStreamToTwoRows",
    "showEpisodeNumber"
  ],
  "komodo": [
    "showStacks",
    "showSummary"
  ],
  "sonarr": [
    "enableQueue"
  ],
  "stocks": [
    "showUSMarketStatus"
  ],
  "radarr": [
    "enableQueue"
  ],
  "iframe": [
    "allowPolicy",
    "allowScrolling",
    "allowfullscreen"
  ],
  "frigate": [
    "enableRecentEvents"
  ],
  "deluge": [
    "enableLeechProgress"
  ],
  "vikunja": [
    "enableTaskList"
  ],
  "tracearr": [
    "enableUser",
    "expandOneStreamToTwoRows",
    "showEpisodeNumber"
  ],
  "qbittorrent": [
    "enableLeechProgress",
    "enableLeechSize"
  ],
  "emby": [
    "enableBlocks",
    "enableMediaControl",
    "enableNowPlaying",
    "enableUser",
    "expandOneStreamToTwoRows",
    "showEpisodeNumber"
  ],
  "glances": [
    "hideErrors"
  ],
  "calendar": [
    "showTime"
  ],
  "ical": [
    "showTime"
  ],
  "torrsyncarr": [
    "enableWaitingCount"
  ]
};

const WIDGET_TRANSLATIONS = {
  "enableBlocks": "Показывать библиотеки блоками",
  "enableMediaControl": "Интерактивный пульт управления медиа",
  "enableNowPlaying": "Показывать воспроизведение сейчас",
  "enableUser": "Показывать имя пользователя",
  "expandOneStreamToTwoRows": "Отображать поток в две строки",
  "showEpisodeNumber": "Показывать сезон и номер серии",
  "enableActiveStreams": "Показывать активные потоки",
  "enablePools": "Отображать дисковые пулы подробно",
  "showStacks": "Показывать стеки контейнеров",
  "showSummary": "Показывать общую сводку",
  "enableQueue": "Отображать очередь загрузок",
  "showUSMarketStatus": "Показывать статус рынка США",
  "allowPolicy": "Разрешить политики безопасности (allow-policy)",
  "allowScrolling": "Разрешить прокрутку внутри фрейма",
  "allowfullscreen": "Разрешить полноэкранный режим фрейма",
  "enableRecentEvents": "Показывать недавние события frigate",
  "enableLeechProgress": "Показывать прогресс скачивающих (личей)",
  "enableLeechSize": "Показывать размер загрузок скачивающих (личей)",
  "enableTaskList": "Показывать список задач",
  "hideErrors": "Скрывать ошибки подключения",
  "showTime": "Показывать время для сегодняшних событий",
  "enableWaitingCount": "Показывать количество медиа на импорт"
};

function WidgetTemplateSelector({ extraYaml, onChange }) {
  let parsed = null;
  try {
    parsed = yaml.load(extraYaml) ?? {};
  } catch {
    // ignore parsing errors (e.g. while editing)
  }

  const widget = parsed?.widget;

  const allWidgetTypes = [
  "adguard-home",
  "apcups",
  "arcane",
  "argocd",
  "atsumeru",
  "audiobookshelf",
  "authentik",
  "autobrr",
  "azuredevops",
  "backrest",
  "bazarr",
  "beszel",
  "booklore",
  "caddy",
  "calendar",
  "calibre-web",
  "changedetectionio",
  "channelsdvrserver",
  "checkmk",
  "cloudflared",
  "coin-market-cap",
  "crowdsec",
  "customapi",
  "deluge",
  "develancacheui",
  "diskstation",
  "dispatcharr",
  "dockhand",
  "downloadstation",
  "emby",
  "esphome",
  "evcc",
  "filebrowser",
  "fileflows",
  "firefly",
  "flood",
  "freshrss",
  "frigate",
  "fritzbox",
  "gamedig",
  "gatus",
  "ghostfolio",
  "gitea",
  "gitlab",
  "glances",
  "gluetun",
  "gotify",
  "grafana",
  "hdhomerun",
  "headscale",
  "healthchecks",
  "homeassistant",
  "homebox",
  "homebridge",
  "iframe",
  "immich",
  "jackett",
  "jdownloader",
  "jellyfin",
  "jellystat",
  "karakeep",
  "kavita",
  "komga",
  "komodo",
  "kopia",
  "lidarr",
  "linkwarden",
  "lubelogger",
  "mailcow",
  "mastodon",
  "mealie",
  "medusa",
  "mikrotik",
  "minecraft",
  "miniflux",
  "mjpeg",
  "moonraker",
  "mylar",
  "myspeed",
  "navidrome",
  "netalertx",
  "netdata",
  "nextcloud",
  "nextdns",
  "nginx-proxy-manager",
  "ntfy",
  "nzbget",
  "octoprint",
  "omada",
  "ombi",
  "opendtu",
  "openmediavault",
  "openwrt",
  "opnsense",
  "pangolin",
  "paperlessngx",
  "peanut",
  "pfsense",
  "photoprism",
  "pihole",
  "plantit",
  "plex",
  "plex-tautulli",
  "portainer",
  "prometheus",
  "prometheusmetric",
  "prowlarr",
  "proxmox",
  "proxmoxbackupserver",
  "pterodactyl",
  "pyload",
  "qbittorrent",
  "qnap",
  "radarr",
  "readarr",
  "romm",
  "rutorrent",
  "sabnzbd",
  "scrutiny",
  "seerr",
  "slskd",
  "sonarr",
  "sparkyfitness",
  "speedtest-tracker",
  "spoolman",
  "stash",
  "stocks",
  "suwayomi",
  "swagdashboard",
  "syncthing-relay-server",
  "tailscale",
  "tandoor",
  "tdarr",
  "technitium",
  "torrsyncarr",
  "tracearr",
  "traefik",
  "transmission",
  "trilium",
  "truenas",
  "tubearchivist",
  "unifi-controller",
  "unifi-drive",
  "unmanic",
  "unraid",
  "uptime-kuma",
  "uptimerobot",
  "urbackup",
  "vikunja",
  "wallos",
  "watchtower",
  "wgeasy",
  "whatsupdocker",
  "xteve",
  "yourspotify",
  "zabbix"
];

  let currentType = "";
  if (widget) {
    if (allWidgetTypes.includes(widget.type)) {
      currentType = widget.type;
    } else {
      currentType = "custom";
    }
  }

  const handleTypeChange = (newType) => {
    const obj = { ...(parsed ?? {}) };
    if (newType === "") {
      delete obj.widget;
    } else if (newType === "custom") {
      obj.widget = {
        type: "custom_widget",
        url: "http://example-ip:80",
      };
    } else {
      const templateStr = WIDGET_TEMPLATES[newType];
      if (templateStr) {
        try {
          const templateObj = yaml.load(templateStr);
          Object.assign(obj, templateObj);
        } catch {
          obj.widget = {
            type: newType,
            url: "http://ip-address:port",
          };
        }
      } else {
        obj.widget = {
          type: newType,
          url: "http://ip-address:port",
        };
      }
    }

    try {
      const nextYaml = Object.keys(obj).length ? yaml.dump(obj, { lineWidth: -1, noRefs: true, sortKeys: false }) : "";
      onChange(nextYaml);
    } catch {
      // ignore
    }
  };

  const handleToggle = (key, checked) => {
    if (!parsed) return;
    const obj = { ...parsed };
    if (!obj.widget) obj.widget = {};
    obj.widget[key] = checked;
    try {
      const nextYaml = yaml.dump(obj, { lineWidth: -1, noRefs: true, sortKeys: false });
      onChange(nextYaml);
    } catch {
      // ignore
    }
  };

  // Find all boolean keys for the current widget type
  const getWidgetBooleans = (w, type) => {
    const booleans = [];
    const keysSeen = new Set();

    // 1. Known booleans for this type
    const knownBools = WIDGET_BOOLEANS[type] || [];
    knownBools.forEach((k) => {
      const val = w && typeof w === "object" && k in w ? w[k] : false;
      booleans.push({ key: k, value: val });
      keysSeen.add(k);
    });

    // 2. Any other custom booleans in the widget object
    if (w && typeof w === "object") {
      Object.entries(w).forEach(([k, v]) => {
        if (typeof v === "boolean" && k !== "type" && !keysSeen.has(k)) {
          booleans.push({ key: k, value: v });
        }
      });
    }

    return booleans;
  };

  const booleans = getWidgetBooleans(widget, currentType);

  return (
    <div className="mb-3 rounded-md border border-theme-300/50 p-3 dark:border-white/10 bg-theme-100/5 dark:bg-white/5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-theme-300/30 dark:border-white/5 pb-2">
        <label className="text-xs font-semibold text-theme-700 dark:text-theme-200">
          Шаблоны интеграции виджетов
        </label>
        {parsed === null && (
          <span className="text-[11px] font-medium text-rose-500">
            Ошибка в YAML (исправьте код ниже)
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", width: "100%" }}>
        <div style={{ flex: "1 1 300px", minWidth: "250px" }} className="flex flex-col justify-start">
          <label className="block min-w-0 text-xs text-theme-600 dark:text-theme-300">
            Выберите тип виджета для вставки шаблона:
            <select
              value={currentType}
              disabled={parsed === null}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="mt-1 w-full min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 px-2 py-1 text-[13px] h-[32px] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Без виджета / очистить</option>
              {allWidgetTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
              <option value="custom">Другой (кастомный шаблон)</option>
            </select>
          </label>
        </div>

        <div style={{ flex: "1 1 300px", minWidth: "250px" }} className="flex flex-col justify-start">
          {booleans.length > 0 && parsed !== null ? (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-theme-500 uppercase tracking-wide">
                Дополнительные настройки ({currentType}):
              </span>
              <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto pr-1">
                {booleans.map(({ key, value }) => {
                  const labelRussian = WIDGET_TRANSLATIONS[key] || key;
                  return (
                    <label key={key} className="flex cursor-pointer items-center gap-2 text-xs font-medium text-theme-700 dark:text-theme-200 hover:text-theme-950 dark:hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) => handleToggle(key, e.target.checked)}
                        className="h-4 w-4 rounded border-theme-300 text-theme-600 focus:ring-theme-500 cursor-pointer"
                      />
                      <span className="truncate" title={`${key}: ${labelRussian}`}>
                        {labelRussian} <span className="text-[10px] text-theme-400 dark:text-theme-500 font-normal">({key})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            currentType && currentType !== "custom" && parsed !== null && (
              <div className="text-xs text-theme-400 dark:text-theme-500 italic mt-5">
                У виджета {currentType} нет дополнительных настроек.
              </div>
            )
          )}
        </div>
      </div>
    </div>
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

      const response = await editorWriteFetch("/api/config/editor", {
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
      const response = await editorWriteFetch("/api/config/editor", {
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


let selfhstIconsCache = null;

function IconsManagerModal({ onClose, onSaved, settings }) {
  const { mutate } = useSWRConfig();
  const { theme } = useContext(ThemeContext);
  const editor = useConfigEditor();
  const iconSelectorCallback = editor?.iconSelectorCallback;
  const setIconSelectorCallback = editor?.setIconSelectorCallback;

  const [activeTab, setActiveTab] = useState("list");
  const [icons, setIcons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");
  const [repoName, setRepoName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoSearchQuery, setRepoSearchQuery] = useState("");
  const [repoSearchResults, setRepoSearchResults] = useState([]);
  const [searchingRepo, setSearchingRepo] = useState(false);
  const [localizing, setLocalizing] = useState(false);
  const [editingRepoIdx, setEditingRepoIdx] = useState(null);
  const [libSearchQuery, setLibSearchQuery] = useState("");
  const [libSearchResults, setLibSearchResults] = useState([]);
  const [searchingLib, setSearchingLib] = useState(false);
  const [itemColors, setItemColors] = useState({});
  const fileInputRef = useRef(null);

  const loadIcons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config/icon/list");
      if (res.ok) {
        const data = await res.json();
        setIcons(data.icons || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIcons();
  }, [loadIcons]);

  const iconRepos = settings?.iconRepositories || [
    {
      name: "Dashboard Icons (walkxcode)",
      url: "https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/png/"
    }
  ];

  const systemRepos = [
    {
      name: "Dashboard Icons (walkxcode / homarr)",
      url: "https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/png/",
      prefix: "нет",
      isSystem: true
    },
    {
      name: "Simple Icons",
      url: "https://cdn.jsdelivr.net/npm/simple-icons/icons/",
      prefix: "si-",
      isSystem: true
    },
    {
      name: "Material Design Icons",
      url: "https://cdn.jsdelivr.net/npm/@mdi/svg/svg/",
      prefix: "mdi-",
      isSystem: true
    },
    {
      name: "selfh.st/icons",
      url: "https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/",
      prefix: "sh-",
      isSystem: true
    }
  ];

  const customRepos = settings?.iconRepositories || [];
  const filteredSystemRepos = systemRepos.filter(sys => 
    !customRepos.some(cust => cust.url.trim().replace(/\/+$/, "") === sys.url.trim().replace(/\/+$/, ""))
  );
  const displayedRepos = [...filteredSystemRepos, ...customRepos];

  async function saveRepos(nextRepos) {
    try {
      const response = await editorWriteFetch("/api/config/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file: "settings",
          data: {
            ...settings,
            iconRepositories: nextRepos
          }
        }),
      });
      if (response.ok) {
        const nextData = await response.json();
        await mutate("/api/config/editor", nextData, false);
        onSaved("Список репозиториев сохранен");
      }
    } catch (err) {
      setError("Ошибка сохранения настроек");
    }
  }

  async function deleteIcon(name) {
    if (!window.confirm(`Вы уверены, что хотите удалить иконку ${name}?`)) return;
    try {
      const res = await fetch(`/api/config/icon/${name}`, {
        method: "DELETE"
      });
      if (res.ok) {
        onSaved("Иконка удалена");
        loadIcons();
      } else {
        const text = await res.text();
        setError(text || "Ошибка удаления");
      }
    } catch (err) {
      setError("Ошибка удаления");
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/config/icon/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, dataUrl })
      });

      if (res.ok) {
        onSaved("Иконка загружена");
        loadIcons();
        setActiveTab("list");
      } else {
        const text = await res.text();
        setError(text || "Ошибка загрузки");
      }
    } catch (err) {
      setError("Ошибка загрузки");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function handleDownloadFromUrl() {
    if (!downloadUrl || !downloadName) {
      setError("Заполните ссылку и название файла");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/config/icon/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: downloadUrl, name: downloadName })
      });
      if (res.ok) {
        onSaved("Иконка успешно скачана");
        loadIcons();
        setDownloadUrl("");
        setDownloadName("");
        setActiveTab("list");
      } else {
        const text = await res.text();
        setError(text || "Ошибка скачивания");
      }
    } catch (err) {
      setError("Ошибка скачивания");
    } finally {
      setLoading(false);
    }
  }

  function parseGithubRepo(url) {
    const cleanUrl = url.trim().replace(/\/+$/, "");
    let match = cleanUrl.match(/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)(?:\/(.*))?/);
    if (match) {
      return { user: match[1], repo: match[2], version: match[3], path: match[4] ? "/" + match[4] : "" };
    }
    match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      const repoName = match[2].replace(/\.git$/, "");
      const treeMatch = cleanUrl.match(/github\.com\/[^\/]+\/[^\/]+\/tree\/([^\/]+)(?:\/(.*))?/);
      return { 
        user: match[1], 
        repo: repoName, 
        version: treeMatch ? treeMatch[1] : "main", 
        path: treeMatch && treeMatch[2] ? "/" + treeMatch[2] : "" 
      };
    }
    match = cleanUrl.match(/cdn\.jsdelivr\.net\/gh\/([^\/]+)\/([^\/@]+)(?:@([^\/]+))?(?:\/(.*))?/);
    if (match) {
      return { 
        user: match[1], 
        repo: match[2], 
        version: match[3] || "main", 
        path: match[4] ? "/" + match[4] : "" 
      };
    }
    return null;
  }

  async function handleRepoSearch() {
    if (!repoSearchQuery.trim()) return;
    setSearchingRepo(true);
    setError("");
    const results = [];
    const term = repoSearchQuery.toLowerCase().trim();

    for (const repo of iconRepos) {
      const parsed = parseGithubRepo(repo.url);
      if (parsed) {
        try {
          const pathPart = parsed.path ? parsed.path.replace(/^\//, "") : "";
          const apiUrl = `https://api.github.com/repos/${parsed.user}/${parsed.repo}/contents/${pathPart}?ref=${parsed.version}`;
          const res = await fetch(apiUrl);
          if (res.ok) {
            const files = await res.json();
            if (Array.isArray(files)) {
              const matches = files.filter(f => f.type === "file" && f.name.toLowerCase().includes(term));
              matches.forEach(m => {
                let rawUrl = m.download_url;
                if (!rawUrl) {
                  const urlPath = pathPart ? pathPart + "/" : "";
                  rawUrl = `https://raw.githubusercontent.com/${parsed.user}/${parsed.repo}/${parsed.version}/${urlPath}${m.name}`;
                }
                results.push({
                  name: m.name,
                  url: rawUrl,
                  repo: repo.name
                });
              });
            }
          } else {
            console.error(`Failed searching repo ${repo.name} via GitHub:`, res.status);
          }
        } catch (err) {
          console.error(`Failed searching repo ${repo.name}:`, err);
        }
      }
    }

    if (results.length === 0) {
      iconRepos.forEach(repo => {
        const ext = term.endsWith(".png") || term.endsWith(".svg") ? "" : ".png";
        const fileName = `${term}${ext}`;
        results.push({
          name: fileName,
          url: `${repo.url}${fileName}`,
          repo: repo.name,
          isFallback: true
        });
      });
    }

    setRepoSearchResults(results);
    setSearchingRepo(false);
  }

  async function handleLibSearch() {
    if (!libSearchQuery.trim()) return;
    setSearchingLib(true);
    setError("");
    const results = [];
    let query = libSearchQuery.toLowerCase().trim();

    if (query.startsWith("si-")) {
      query = query.replace("si-", "");
    } else if (query.startsWith("mdi-")) {
      query = query.replace("mdi-", "");
    } else if (query.startsWith("sh-")) {
      query = query.replace("sh-", "");
    }

    try {
      const promises = [
        fetch(`https://api.iconify.design/search?query=${query}&prefix=simple-icons&limit=64`).then(r => r.ok ? r.json() : null),
        fetch(`https://api.iconify.design/search?query=${query}&prefix=mdi&limit=64`).then(r => r.ok ? r.json() : null),
        (async () => {
          if (selfhstIconsCache) return selfhstIconsCache;
          try {
            const res = await fetch(`https://api.github.com/repos/selfhst/icons/contents/svg?ref=main`);
            if (res.ok) {
              const data = await res.json();
              selfhstIconsCache = data;
              return data;
            }
          } catch (e) {
            console.error("Failed fetching selfhst/icons directory:", e);
          }
          return null;
        })()
      ];

      const [siData, mdiData, shFiles] = await Promise.all(promises);

      if (siData && siData.icons) {
        siData.icons.forEach(name => {
          const cleanName = name.replace("simple-icons:", "");
          results.push({
            name: `si-${cleanName}`,
            url: `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${cleanName}.svg`,
            type: "si"
          });
        });
      }

      if (mdiData && mdiData.icons) {
        mdiData.icons.forEach(name => {
          const cleanName = name.replace("mdi:", "");
          results.push({
            name: `mdi-${cleanName}`,
            url: `https://cdn.jsdelivr.net/npm/@mdi/svg@latest/svg/${cleanName}.svg`,
            type: "mdi"
          });
        });
      }

      if (Array.isArray(shFiles)) {
        const matches = shFiles.filter(f => f.type === "file" && f.name.toLowerCase().includes(query));
        matches.forEach(m => {
          const cleanName = m.name.replace(".svg", "");
          results.push({
            name: `sh-${cleanName}`,
            url: m.download_url || `https://raw.githubusercontent.com/selfhst/icons/main/svg/${m.name}`,
            type: "sh"
          });
        });
      }
    } catch (err) {
      console.error("Libraries search failed:", err);
      setError("Ошибка поиска по библиотекам");
    }

    setLibSearchResults(results);
    setSearchingLib(false);
  }

  async function handleDownloadRepoIcon(item) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/config/icon/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: item.url, name: item.name })
      });
      if (res.ok) {
        onSaved(`Иконка ${item.name} успешно сохранена`);
        loadIcons();
      } else {
        const text = await res.text();
        setError(text || "Не удалось скачать. Проверьте имя и ссылку.");
      }
    } catch (err) {
      setError("Ошибка при скачивании");
    } finally {
      setLoading(false);
    }
  }

  async function handleLocalize() {
    setLocalizing(true);
    setError("");
    try {
      const response = await editorWriteFetch("/api/config/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "localize-icons" }),
      });

      if (!response.ok) {
        setError(await response.text());
        return;
      }

      const nextData = await response.json();
      await mutate("/api/config/editor", nextData, false);

      const result = nextData.iconLocalization;
      if (!result?.updated) {
        onSaved("Иконки со ссылками не найдены в конфигурации");
        return;
      }

      const skipped = result.skipped ? `, пропущено ${result.skipped}` : "";
      onSaved(`Локализовано: скачано ${result.downloaded}, обновлено ${result.updated}${skipped}`);
      loadIcons();
    } catch (err) {
      setError("Ошибка локализации");
    } finally {
      setLocalizing(false);
    }
  }

  const filteredLocalIcons = icons.filter(name => name.toLowerCase().includes(search.toLowerCase()));

  return (
    <EditorWindow
      storageKey="homepage-browser-editor-window-icons-v2"
      title="Менеджер иконок"
      onClose={onClose}
      defaultWidth={620}
      defaultHeight={480}
      minWidth={450}
      minHeight={350}
      wrapperClassName="!z-[70]"
    >
      <div className="flex border-b border-theme-300/30 dark:border-white/5 pb-2 mb-3 gap-3 text-[11px] font-semibold uppercase tracking-wider">
        <button
          type="button"
          onClick={() => setActiveTab("list")}
          className={activeTab === "list" ? "text-theme-950 dark:text-white border-b-2 border-theme-600 pb-1" : "text-theme-400 dark:text-theme-500 pb-1"}
        >
          Локальные ({icons.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("upload")}
          className={activeTab === "upload" ? "text-theme-950 dark:text-white border-b-2 border-theme-600 pb-1" : "text-theme-400 dark:text-theme-500 pb-1"}
        >
          Загрузить файл
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("url")}
          className={activeTab === "url" ? "text-theme-950 dark:text-white border-b-2 border-theme-600 pb-1" : "text-theme-400 dark:text-theme-500 pb-1"}
        >
          Скачать по URL
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("repos")}
          className={activeTab === "repos" ? "text-theme-950 dark:text-white border-b-2 border-theme-600 pb-1" : "text-theme-400 dark:text-theme-500 pb-1"}
        >
          Репозитории
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("libs")}
          className={activeTab === "libs" ? "text-theme-950 dark:text-white border-b-2 border-theme-600 pb-1" : "text-theme-400 dark:text-theme-500 pb-1"}
        >
          Библиотеки (MDI / SI / SH)
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === "list" && (
          <div className="flex-1 min-h-0 flex flex-col space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск локальных иконок..."
                className="flex-1 rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1.5 text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              />
              <button
                type="button"
                onClick={handleLocalize}
                disabled={localizing}
                className="shrink-0 rounded-md border border-theme-300/50 bg-theme-100/50 hover:bg-theme-200/50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {localizing ? "Синхронизация..." : "Локализовать из конфигов"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto border border-theme-300/20 dark:border-white/5 rounded-md p-3 bg-theme-50/20 dark:bg-black/10">
              {filteredLocalIcons.length === 0 ? (
                <div className="text-center text-xs text-theme-400 dark:text-theme-500 italic py-8">
                  Локальные иконки не найдены
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {filteredLocalIcons.map(name => {
                    const iconPath = `/api/config/icon/${name}`;
                    const localIconName = `/api/config/icon/${name}`;
                    return (
                      <div 
                        key={name}
                        onClick={() => {
                          if (iconSelectorCallback) {
                            iconSelectorCallback(localIconName);
                            setIconSelectorCallback(null);
                            onClose();
                          }
                        }}
                        className={classNames(
                          "flex flex-col items-center p-2 rounded border border-theme-300/30 dark:border-white/5 bg-theme-50/50 dark:bg-white/5 space-y-2 group relative",
                          iconSelectorCallback && "cursor-pointer hover:border-theme-500 dark:hover:border-white/40"
                        )}
                      >
                        <img src={iconPath} alt={name} className="h-10 w-10 object-contain" onError={(e) => { e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ccc' d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/%3E%3C/svg%3E"; }} />
                        <span className="text-[10px] break-all text-center select-all font-mono" title={name}>
                          {name}
                        </span>
                        {iconSelectorCallback ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              iconSelectorCallback(localIconName);
                              setIconSelectorCallback(null);
                              onClose();
                            }}
                            className="w-full text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white py-1 px-2 rounded mt-1 transition-colors"
                          >
                            Выбрать
                          </button>
                        ) : (
                          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteIcon(name);
                              }}
                              className="bg-rose-500 hover:bg-rose-600 text-white rounded p-1"
                              title="Удалить"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="text-[10px] text-theme-400 dark:text-theme-500">
              Используйте имя <code className="bg-theme-100 dark:bg-white/5 px-1 py-0.5 rounded select-all font-mono">/api/config/icon/название_файла</code> в поле &quot;Иконка&quot;.
            </div>
          </div>
        )}

        {activeTab === "upload" && (
          <div className="flex-1 flex flex-col justify-center items-center p-6 border border-dashed border-theme-300/50 dark:border-white/10 rounded-md bg-theme-50/10 dark:bg-black/5 space-y-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <div className="text-center">
              <svg className="w-10 h-10 mx-auto text-theme-400 dark:text-theme-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-xs font-semibold">Выберите файл изображения иконки</p>
              <p className="text-[10px] text-theme-400 dark:text-theme-500 mt-1">Поддерживаются PNG, SVG, JPG, WebP и др.</p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="rounded-md bg-theme-700 px-4 py-2 text-xs text-white disabled:opacity-60 hover:bg-theme-850 dark:bg-theme-200 dark:text-theme-900 dark:hover:bg-white transition-colors"
            >
              Выбрать и загрузить
            </button>
          </div>
        )}

        {activeTab === "url" && (
          <div className="flex-1 flex flex-col space-y-3 p-4 border border-theme-300/20 dark:border-white/5 rounded-md bg-theme-50/10 dark:bg-black/5">
            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-semibold">Ссылка на удаленную иконку (URL)</label>
              <input
                type="text"
                value={downloadUrl}
                onChange={e => {
                  setDownloadUrl(e.target.value);
                  if (e.target.value && !downloadName) {
                    const base = e.target.value.split("/").pop() || "";
                    if (base.includes(".")) {
                      setDownloadName(base);
                    }
                  }
                }}
                placeholder="https://example.com/logo.png"
                className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1.5 text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              />
            </div>

            <div className="flex flex-col space-y-1">
              <label className="text-[10px] font-semibold">Имя сохраняемого файла</label>
              <input
                type="text"
                value={downloadName}
                onChange={e => setDownloadName(e.target.value)}
                placeholder="my-logo.png"
                className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1.5 text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              />
            </div>

            <button
              type="button"
              onClick={handleDownloadFromUrl}
              disabled={loading}
              className="w-full rounded-md bg-theme-700 px-4 py-2 text-xs text-white disabled:opacity-60 hover:bg-theme-850 dark:bg-theme-200 dark:text-theme-900 dark:hover:bg-white transition-colors mt-2"
            >
              Скачать и сохранить
            </button>
          </div>
        )}

        {activeTab === "repos" && (
          <div className="flex-1 min-h-0 flex flex-col space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={repoSearchQuery}
                onChange={e => setRepoSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleRepoSearch(); }}
                placeholder="Поиск иконки в репозитории (например: proxmox)"
                className="flex-1 rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1.5 text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              />
              <button
                type="button"
                onClick={handleRepoSearch}
                disabled={searchingRepo}
                className="rounded-md bg-theme-700 hover:bg-theme-850 px-4 py-1.5 text-xs text-white dark:bg-theme-200 dark:hover:bg-white dark:text-theme-900 transition-colors"
              >
                Поиск
              </button>
            </div>

            {repoSearchResults.length > 0 ? (
              <div className="flex-1 overflow-y-auto border border-theme-300/20 dark:border-white/5 rounded-md p-3 bg-theme-50/20 dark:bg-black/10">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {repoSearchResults.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        if (iconSelectorCallback) {
                          iconSelectorCallback(item.name);
                          setIconSelectorCallback(null);
                          onClose();
                        }
                      }}
                      className={classNames(
                        "flex flex-col items-center p-2 rounded border border-theme-300/30 dark:border-white/5 bg-theme-50/50 dark:bg-white/5 space-y-2 group relative",
                        iconSelectorCallback && "cursor-pointer hover:border-theme-500 dark:hover:border-white/40"
                      )}
                    >
                      <img src={item.url} alt={item.name} className="h-10 w-10 object-contain" onError={(e) => { e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ccc' d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/%3E%3C/svg%3E"; }} />
                      <span className="text-[10px] break-all text-center select-all font-mono" title={item.name}>
                        {item.name}
                      </span>
                      <span className="text-[9px] text-theme-400 dark:text-theme-500 text-center truncate w-full">
                        {item.repo}
                      </span>
                      {iconSelectorCallback ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            iconSelectorCallback(item.name);
                            setIconSelectorCallback(null);
                            onClose();
                          }}
                          className="w-full text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white py-1 px-2 rounded mt-1 transition-colors"
                        >
                          Выбрать
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadRepoIcon(item);
                          }}
                          disabled={loading}
                          className="w-full text-[10px] font-semibold bg-theme-200 dark:bg-white/10 hover:bg-theme-300 dark:hover:bg-white/20 py-1 px-2 rounded mt-1 transition-colors disabled:opacity-50"
                        >
                          Скачать локально
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto border border-theme-300/20 dark:border-white/5 rounded-md p-3 bg-theme-50/20 dark:bg-black/10 flex flex-col">
                <span className="text-xs font-semibold mb-2">Подключенные репозитории:</span>
                <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                  {displayedRepos.map((repo, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2 rounded border border-theme-300/10 dark:border-white/5 bg-theme-50/50 dark:bg-white/5">
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold truncate">{repo.name}</span>
                          {repo.isSystem && (
                            <span className="text-[9px] bg-theme-200 dark:bg-white/10 px-1.5 py-0.2 rounded font-medium opacity-85">
                              Системный
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-theme-400 dark:text-theme-500 truncate">{repo.url}</span>
                        {repo.prefix && (
                          <span className="text-[9px] text-theme-400 dark:text-theme-500 font-mono">
                            Префикс: <code className="bg-theme-100 dark:bg-white/5 px-0.5 rounded">{repo.prefix}</code>
                          </span>
                        )}
                      </div>
                      {!repo.isSystem && (
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              const customIdx = customRepos.findIndex(r => r.url === repo.url);
                              if (customIdx !== -1) {
                                setEditingRepoIdx(customIdx);
                                setRepoName(repo.name);
                                setRepoUrl(repo.url);
                              }
                            }}
                            className="text-theme-600 dark:text-theme-400 hover:text-theme-700 text-xs font-semibold px-2 py-1"
                          >
                            Редактировать
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = customRepos.filter(r => r.url !== repo.url);
                              saveRepos(next);
                            }}
                            className="text-rose-500 hover:text-rose-600 text-xs font-semibold px-2 py-1"
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-3 border-t border-theme-300/20 dark:border-white/5 pt-2 flex flex-col space-y-2">
                  <span className="text-xs font-semibold">
                    {editingRepoIdx !== null ? "Редактировать репозиторий:" : "Подключить новый репозиторий:"}
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={repoName}
                      onChange={e => setRepoName(e.target.value)}
                      placeholder="Название"
                      className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1 text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                    />
                    <input
                      type="text"
                      value={repoUrl}
                      onChange={e => setRepoUrl(e.target.value)}
                      placeholder="Базовый URL (с / в конце)"
                      className="rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1 text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!repoName || !repoUrl) return;
                        if (editingRepoIdx !== null) {
                          const next = [...iconRepos];
                          next[editingRepoIdx] = { name: repoName, url: repoUrl };
                          saveRepos(next);
                          setEditingRepoIdx(null);
                        } else {
                          const next = [...iconRepos, { name: repoName, url: repoUrl }];
                          saveRepos(next);
                        }
                        setRepoName("");
                        setRepoUrl("");
                      }}
                      className="flex-1 rounded bg-theme-200 dark:bg-white/10 hover:bg-theme-350 dark:hover:bg-white/20 py-1.5 text-xs font-semibold transition-colors"
                    >
                      {editingRepoIdx !== null ? "Сохранить изменения" : "Добавить репозиторий"}
                    </button>
                    {editingRepoIdx !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRepoIdx(null);
                          setRepoName("");
                          setRepoUrl("");
                        }}
                        className="rounded bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                      >
                        Отмена
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "libs" && (
          <div className="flex-1 min-h-0 flex flex-col space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={libSearchQuery}
                onChange={e => setLibSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleLibSearch(); }}
                placeholder="Поиск в MDI, Simple Icons, Selfh.st (например: home, plex, immich)"
                className="flex-1 rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-1.5 text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              />
              <button
                type="button"
                onClick={handleLibSearch}
                disabled={searchingLib}
                className="rounded-md bg-theme-700 hover:bg-theme-850 px-4 py-1.5 text-xs text-white dark:bg-theme-200 dark:hover:bg-white dark:text-theme-900 transition-colors"
              >
                {searchingLib ? "Поиск..." : "Поиск"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto border border-theme-300/20 dark:border-white/5 rounded-md p-3 bg-theme-50/20 dark:bg-black/10">
              {libSearchResults.length === 0 ? (
                <div className="text-center text-xs text-theme-400 dark:text-theme-500 italic py-8">
                  Введите запрос для поиска иконок в библиотеках MDI, Simple Icons и selfh.st.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {libSearchResults.map((item, idx) => {
                    const itemColor = itemColors[idx] || "";
                    const displayColor = itemColor || (theme === "dark" ? "#ffffff" : "#000000");
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          if (iconSelectorCallback) {
                            const finalName = itemColor ? `${item.name}-${itemColor}` : item.name;
                            iconSelectorCallback(finalName);
                            setIconSelectorCallback(null);
                            onClose();
                          }
                        }}
                        className={classNames(
                          "flex flex-col items-center p-2 rounded border border-theme-300/30 dark:border-white/5 bg-theme-50/50 dark:bg-white/5 space-y-2 group relative",
                          iconSelectorCallback && "cursor-pointer hover:border-theme-500 dark:hover:border-white/40"
                        )}
                      >
                        {itemColor ? (
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              background: displayColor,
                              mask: `url(${item.url}) no-repeat center / contain`,
                              WebkitMask: `url(${item.url}) no-repeat center / contain`,
                            }}
                          />
                        ) : (
                          <img 
                            src={item.url} 
                            alt={item.name} 
                            className={classNames("h-10 w-10 object-contain", item.type !== "sh" && "dark:invert")}
                            onError={(e) => { e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ccc' d='M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z'/%3E%3C/svg%3E"; }} 
                          />
                        )}
                        <span className="text-[10px] break-all text-center select-all font-mono" title={item.name}>
                          {item.name}
                        </span>
                        {(item.type === "si" || item.type === "mdi") && (
                          <div className="flex items-center gap-1 mt-1 text-[10px]" onClick={e => e.stopPropagation()}>
                            <label className="flex items-center gap-1 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={!!itemColor}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setItemColors(prev => ({ ...prev, [idx]: "#3eadff" }));
                                  } else {
                                    setItemColors(prev => {
                                      const copy = { ...prev };
                                      delete copy[idx];
                                      return copy;
                                    });
                                  }
                                }}
                                className="h-3 w-3 rounded-sm border-theme-300 dark:border-white/10"
                              />
                              <span>Цвет:</span>
                            </label>
                            {!!itemColor && (
                              <input
                                type="color"
                                value={itemColor}
                                onChange={e => setItemColors(prev => ({ ...prev, [idx]: e.target.value }))}
                                className="w-5 h-4 p-0 border border-theme-300/40 bg-transparent rounded cursor-pointer shrink-0"
                              />
                            )}
                          </div>
                        )}
                        {iconSelectorCallback && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const finalName = itemColor ? `${item.name}-${itemColor}` : item.name;
                              iconSelectorCallback(finalName);
                              setIconSelectorCallback(null);
                              onClose();
                            }}
                            className="w-full text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white py-1 px-2 rounded mt-1 transition-colors"
                          >
                            Выбрать
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md bg-rose-100 p-2 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {error}
          </div>
        )}
      </div>
    </EditorWindow>
  );
}


function PageStylingEditor({ settingsContent, onChange }) {
  const editor = useConfigEditor();
  const config = useMemo(() => {
    try {
      return yaml.load(settingsContent) ?? {};
    } catch {
      return {};
    }
  }, [settingsContent]);

  const pageStyles = config.pageStyles ?? {};
  const pageIcons = pageStyles.icons ?? {};

  const tabsList = useMemo(() => {
    return getOrderedTabsForLayout(config.layout ?? {}, config.__browserEditorTabOrder ?? []);
  }, [config]);

  const updateStyle = (key, value) => {
    const nextConfig = { ...config };
    if (!nextConfig.pageStyles) {
      nextConfig.pageStyles = {};
    }
    nextConfig.pageStyles = {
      ...nextConfig.pageStyles,
      [key]: value,
    };
    onChange(yaml.dump(nextConfig, { lineWidth: -1, noRefs: true, sortKeys: false }));
  };

  const updateIcon = (tabName, iconVal) => {
    const nextConfig = { ...config };
    if (!nextConfig.pageStyles) {
      nextConfig.pageStyles = {};
    }
    const nextIcons = { ...(nextConfig.pageStyles.icons ?? {}) };
    if (!iconVal) {
      delete nextIcons[tabName];
    } else {
      nextIcons[tabName] = iconVal;
    }
    nextConfig.pageStyles.icons = nextIcons;
    onChange(yaml.dump(nextConfig, { lineWidth: -1, noRefs: true, sortKeys: false }));
  };

  const getBorderPreview = (styleVal) => {
    switch (styleVal) {
      case "none":
        return (
          <div className="mt-2 flex items-center justify-center gap-1.5 rounded bg-theme-100/10 dark:bg-black/20 p-2 border border-transparent w-full">
            <span className="text-[10px] px-2 py-0.5 rounded bg-theme-300/30 dark:bg-white/10 text-theme-950 dark:text-white">Active</span>
            <span className="text-[10px] px-2 py-0.5 opacity-60">Tab</span>
          </div>
        );
      case "underline":
        return (
          <div className="mt-2 flex flex-col items-center justify-center rounded bg-theme-100/10 dark:bg-black/20 p-2 border border-transparent w-full">
            <div className="flex gap-1.5 w-full justify-center">
              <span className="text-[10px] px-2 pb-0.5 border-b-2 border-theme-600 dark:border-white/50 text-theme-950 dark:text-white font-semibold">Active</span>
              <span className="text-[10px] px-2 pb-0.5 opacity-60">Tab</span>
            </div>
            <div className="w-full border-t border-theme-300/30 dark:border-white/5 mt-0.5"></div>
          </div>
        );
      case "underline-rounded":
        return (
          <div className="mt-2 flex flex-col items-center justify-center rounded bg-theme-100/10 dark:bg-black/20 p-2 border border-transparent w-full">
            <div className="flex gap-1.5 w-full justify-center">
              <span className="text-[10px] px-2 pb-1 relative text-theme-950 dark:text-white font-semibold">
                Active
                <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full bg-theme-600 dark:bg-white/50"></span>
              </span>
              <span className="text-[10px] px-2 pb-1 opacity-60">Tab</span>
            </div>
          </div>
        );
      case "outline":
        return (
          <div className="mt-2 flex items-center justify-center gap-1.5 rounded bg-theme-100/10 dark:bg-black/20 p-2 border border-theme-300/60 dark:border-white/20 w-full">
            <span className="text-[10px] px-2 py-0.5 rounded bg-theme-300/30 dark:bg-white/10 text-theme-950 dark:text-white font-semibold">Active</span>
            <span className="text-[10px] px-2 py-0.5 opacity-60">Tab</span>
          </div>
        );
      case "pill":
        return (
          <div className="mt-2 flex items-center justify-center gap-1.5 rounded bg-theme-100/10 dark:bg-black/20 p-2 border border-transparent w-full">
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-theme-300/40 dark:bg-white/15 text-theme-950 dark:text-white font-semibold">Active</span>
            <span className="text-[10px] px-2 py-0.5 opacity-60">Tab</span>
          </div>
        );
      case "card":
        return (
          <div className="mt-2 flex items-center justify-center gap-1.5 rounded bg-theme-100/10 dark:bg-black/20 p-2 border border-transparent w-full">
            <span className="text-[10px] px-2 py-0.5 rounded border border-theme-400/50 bg-theme-300/20 dark:bg-white/10 text-theme-950 dark:text-white font-semibold">Active</span>
            <span className="text-[10px] px-2 py-0.5 rounded border border-transparent opacity-60">Tab</span>
          </div>
        );
      default:
        return null;
    }
  };

  const borderStyles = [
    ["none", "Без рамки"],
    ["underline", "Подчеркивание"],
    ["underline-rounded", "Подчеркивание (скруглённое)"],
    ["outline", "Рамка контейнера"],
    ["pill", "Пилюли"],
    ["card", "Карточки"],
  ];

  const alignments = [
    ["start", "Слева (left)"],
    ["center", "По центру (center)"],
    ["end", "Справа (right)"],
    ["between", "Распределить (fill row)"],
  ];

  const fonts = [
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

  const fontSizes = [
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-2">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-md border border-theme-300/50 p-4 dark:border-white/10 bg-theme-50/10 dark:bg-white/5">
          <h3 className="text-sm font-semibold text-theme-900 dark:text-theme-100">Стиль вкладок страниц</h3>
          
          <label className="block text-xs text-theme-600 dark:text-theme-300">
            Шрифт
            <select
              value={pageStyles.fontFamily ?? ""}
              onChange={(e) => updateStyle("fontFamily", e.target.value)}
              className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
            >
              {fonts.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-theme-600 dark:text-theme-300">
            Размер шрифта
            <select
              value={pageStyles.fontSize ?? ""}
              onChange={(e) => updateStyle("fontSize", e.target.value)}
              className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
            >
              {fontSizes.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-theme-600 dark:text-theme-300">
            Выравнивание вкладок
            <select
              value={pageStyles.align ?? "start"}
              onChange={(e) => updateStyle("align", e.target.value)}
              className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
            >
              {alignments.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </label>

          <div className="block text-xs text-theme-600 dark:text-theme-300">
            Эффект / Тип бордюра
            <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {borderStyles.map(([val, label]) => {
                const isSelected = (pageStyles.borderStyle ?? "none") === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => updateStyle("borderStyle", val)}
                    className={classNames(
                      "rounded-lg border p-3 flex flex-col justify-between text-left text-xs font-medium cursor-pointer transition-all",
                      isSelected
                        ? "border-theme-600 bg-theme-500/10 text-theme-950 shadow-sm dark:border-white/50 dark:bg-white/10 dark:text-white"
                        : "border-theme-300/40 bg-theme-50/10 text-theme-650 hover:bg-theme-50/40 dark:border-white/5 dark:bg-theme-900/10 dark:text-theme-300 dark:hover:bg-theme-900/30"
                    )}
                  >
                    <span>{label}</span>
                    {getBorderPreview(val)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Активный текст
              <ColorInput
                value={pageStyles.activeColor ?? ""}
                onChange={(val) => updateStyle("activeColor", val)}
                placeholder="#ffffff"
                compact={false}
              />
            </label>
            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Неактивный текст
              <ColorInput
                value={pageStyles.inactiveColor ?? ""}
                onChange={(val) => updateStyle("inactiveColor", val)}
                placeholder="#a0aec0"
                compact={false}
              />
            </label>
            <label className="block text-xs text-theme-600 dark:text-theme-300 col-span-2">
              Цвет бордюра / Подчеркивания
              <ColorInput
                value={pageStyles.borderColor ?? ""}
                onChange={(val) => updateStyle("borderColor", val)}
                placeholder="#3fb1db"
                compact={false}
              />
            </label>
          </div>
        </div>

        <div className="space-y-4 rounded-md border border-theme-300/50 p-4 dark:border-white/10 bg-theme-50/10 dark:bg-white/5 flex flex-col min-h-[300px]">
          <h3 className="text-sm font-semibold text-theme-900 dark:text-theme-100">Иконки страниц (вкладок)</h3>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[400px]">
            {tabsList.length === 0 ? (
              <p className="text-xs text-theme-500 dark:text-theme-400">Нет вкладок. Создайте их в разметке групп.</p>
            ) : (
              tabsList.map((tabName) => {
                const iconVal = pageIcons[tabName] ?? "";
                return (
                  <div key={tabName} className="flex flex-col gap-1.5 p-2 rounded-md border border-theme-300/10 dark:border-white/5 bg-theme-50/40 dark:bg-white/5">
                    <span className="text-xs font-semibold text-theme-800 dark:text-theme-200">{tabName}</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="mdi-home, si-proxmox, etc."
                        value={iconVal}
                        onChange={(e) => updateIcon(tabName, e.target.value)}
                        className="flex-1 min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100 px-2 py-1 text-xs"
                      />
                      {editor && typeof editor.selectIcon === "function" && (
                        <button
                          type="button"
                          onClick={() => {
                            editor.selectIcon((selectedIcon) => {
                              updateIcon(tabName, selectedIcon);
                            });
                          }}
                          className="rounded-md border border-theme-300/50 bg-theme-100/50 hover:bg-theme-200/50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 px-3 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center shrink-0"
                        >
                          Выбрать
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Weather styles moved to WeatherWidgetModal */}
      </div>
    </div>
  );
}

const cleanBackgroundObject = (conf) => {
  if (typeof conf.background === "object" && conf.background !== null) {
    const keys = Object.keys(conf.background);
    if (keys.length === 1 && keys[0] === "image") {
      conf.background = conf.background.image;
    } else if (keys.length === 0) {
      delete conf.background;
    }
  }
};

function SettingsVisualEditor({ content, onChange, widgetsContent, onWidgetsChange }) {
  const [parsedConfig, setParsedConfig] = useState({});
  const [yamlError, setYamlError] = useState("");
  const [lastValidConfig, setLastValidConfig] = useState({});

  useEffect(() => {
    try {
      const obj = yaml.load(content) ?? {};
      setParsedConfig(obj);
      setLastValidConfig(obj);
      setYamlError("");
    } catch (err) {
      setYamlError(err.message);
    }
  }, [content]);

  const updateConfig = (updater) => {
    const next = updater({ ...lastValidConfig });
    setLastValidConfig(next);
    setParsedConfig(next);
    onChange(yaml.dump(next, { lineWidth: -1, noRefs: true, sortKeys: false }));
  };

  const isBgObject = typeof lastValidConfig.background === "object" && lastValidConfig.background !== null;
  const bgImageVal = isBgObject ? lastValidConfig.background.image ?? "" : lastValidConfig.background ?? "";
  const bgBlurVal = isBgObject ? lastValidConfig.background.blur ?? "" : "";
  const bgOpacityVal = isBgObject ? lastValidConfig.background.opacity ?? "" : "";
  const bgBrightnessVal = isBgObject ? lastValidConfig.background.brightness ?? "" : "";
  const bgSaturateVal = isBgObject ? lastValidConfig.background.saturate ?? "" : "";
  const weatherProviders = lastValidConfig.providers ?? {};
  const pwaSettings = lastValidConfig.pwa ?? {};
  const pwaEnabled = pwaSettings.enabled ?? false;

  // widgets.yaml weather widget mapping helper
  let widgetsList = [];
  let widgetsParseError = false;
  try {
    widgetsList = yaml.load(widgetsContent) ?? [];
    if (!Array.isArray(widgetsList)) {
      widgetsList = [];
    }
  } catch (e) {
    widgetsParseError = true;
  }

  const weatherWidgetIndex = widgetsList.findIndex(
    w => w && typeof w === "object" && (w.weather !== undefined || w.openweathermap !== undefined || w.weatherapi !== undefined)
  );
  // Weather config logic moved to WeatherWidgetModal

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0 overflow-hidden">
      {/* Left panel: Visual controls */}
      <div className="lg:col-span-7 flex flex-col min-h-0 border border-theme-300/30 rounded-xl dark:border-white/10 bg-theme-50/10 dark:bg-white/5 p-4 overflow-y-auto">
        <h3 className="text-sm font-semibold text-theme-900 dark:text-theme-100 mb-4 flex items-center gap-2">
          ⚙️ Панель настроек дашборда
          {yamlError && (
            <span className="text-[10px] bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 px-2 py-0.5 rounded-full font-normal">
              Ошибка YAML (поля заморожены)
            </span>
          )}
        </h3>

        {/* Visual Fields Form */}
        <div className={yamlError ? "opacity-60 pointer-events-none space-y-6" : "space-y-6"}>
          {/* General Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-theme-800 dark:text-theme-200 uppercase tracking-wider">Общие параметры</h4>

            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Заголовок дашборда (title)
              <input
                type="text"
                value={lastValidConfig.title ?? ""}
                onChange={(e) => updateConfig(conf => { conf.title = e.target.value; return conf; })}
                className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                placeholder="Homepage"
              />
            </label>

            <label className="block text-xs text-theme-600 dark:text-theme-300">
              Описание (meta description)
              <input
                type="text"
                value={lastValidConfig.description ?? ""}
                onChange={(e) => updateConfig(conf => { conf.description = e.target.value; return conf; })}
                className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                placeholder="Dashboard description"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Язык (language)
                <input
                  type="text"
                  value={lastValidConfig.language ?? ""}
                  onChange={(e) => updateConfig(conf => { conf.language = e.target.value; return conf; })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                  placeholder="ru, en"
                />
              </label>
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Локаль дат (locale)
                <input
                  type="text"
                  value={lastValidConfig.locale ?? ""}
                  onChange={(e) => updateConfig(conf => { conf.locale = e.target.value; return conf; })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                  placeholder="ru-RU, en-US"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Start URL
                <input
                  type="text"
                  value={lastValidConfig.startUrl ?? ""}
                  onChange={(e) => updateConfig(conf => { conf.startUrl = e.target.value; return conf; })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                  placeholder="/"
                />
              </label>
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Favicon
                <input
                  type="text"
                  value={lastValidConfig.favicon ?? ""}
                  onChange={(e) => updateConfig(conf => { conf.favicon = e.target.value; return conf; })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                  placeholder="/favicon.ico"
                />
              </label>
            </div>
          </div>

          <hr className="border-theme-300/20 dark:border-white/5" />

          {/* Theme & Design Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-theme-800 dark:text-theme-200 uppercase tracking-wider">Тема и Оформление</h4>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Тема (theme)
                <select
                  value={lastValidConfig.theme ?? ""}
                  onChange={(e) => updateConfig(conf => {
                    if (e.target.value === "") delete conf.theme;
                    else conf.theme = e.target.value;
                    return conf;
                  })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                >
                  <option value="">По умолчанию (системная)</option>
                  <option value="light">Светлая тема (light)</option>
                  <option value="dark">Темная тема (dark)</option>
                </select>
              </label>
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Цвет акцента (color)
                <select
                  value={lastValidConfig.color ?? ""}
                  onChange={(e) => updateConfig(conf => {
                    if (e.target.value === "") delete conf.color;
                    else conf.color = e.target.value;
                    return conf;
                  })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                >
                  <option value="">По умолчанию</option>
                  <option value="slate">Slate</option>
                  <option value="gray">Gray</option>
                  <option value="zinc">Zinc</option>
                  <option value="red">Red</option>
                  <option value="orange">Orange</option>
                  <option value="amber">Amber</option>
                  <option value="yellow">Yellow</option>
                  <option value="green">Green</option>
                  <option value="teal">Teal</option>
                  <option value="cyan">Cyan</option>
                  <option value="sky">Sky</option>
                  <option value="blue">Blue</option>
                  <option value="indigo">Indigo</option>
                  <option value="violet">Violet</option>
                  <option value="purple">Purple</option>
                  <option value="pink">Pink</option>
                  <option value="rose">Rose</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Размытие карточек (cardBlur)
                <select
                  value={lastValidConfig.cardBlur ?? ""}
                  onChange={(e) => updateConfig(conf => {
                    if (e.target.value === "") delete conf.cardBlur;
                    else conf.cardBlur = e.target.value;
                    return conf;
                  })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                >
                  <option value="">Без размытия</option>
                  <option value="sm">Слабое (sm)</option>
                  <option value="md">Среднее (md)</option>
                  <option value="lg">Сильное (lg)</option>
                  <option value="xl">Очень сильное (xl)</option>
                  <option value="2xl">Экстремальное (2xl)</option>
                </select>
              </label>
              <label className="block text-xs text-theme-600 dark:text-theme-300">
                Стиль заголовков (headerStyle)
                <select
                  value={lastValidConfig.headerStyle ?? ""}
                  onChange={(e) => updateConfig(conf => {
                    if (e.target.value === "") delete conf.headerStyle;
                    else conf.headerStyle = e.target.value;
                    return conf;
                  })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1.5 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                >
                  <option value="">По умолчанию</option>
                  <option value="clean">Clean</option>
                  <option value="underlined">Underlined</option>
                </select>
              </label>
            </div>

            {/* Background options */}
            <div className="space-y-3 rounded-md border border-theme-300/20 dark:border-white/5 bg-theme-50/5 p-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-theme-700 dark:text-theme-200">Фоновое изображение</span>
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isBgObject}
                    onChange={(e) => {
                      const useObj = e.target.checked;
                      updateConfig(conf => {
                        if (useObj) {
                          const oldBg = conf.background;
                          conf.background = {
                            image: typeof oldBg === "string" ? oldBg : (oldBg?.image ?? ""),
                          };
                        } else {
                          conf.background = typeof conf.background === "object" && conf.background !== null ? conf.background.image ?? "" : "";
                          if (conf.background === "") {
                            delete conf.background;
                          }
                        }
                        return conf;
                      });
                    }}
                    className="rounded border-theme-300 text-theme-600 shadow-sm dark:border-white/10 dark:bg-theme-900"
                  />
                  Фильтры и прозрачность
                </label>
              </div>

              <label className="block text-[11px] text-theme-600 dark:text-theme-300">
                Путь или URL фона (image)
                <input
                  type="text"
                  value={bgImageVal}
                  onChange={(e) => updateConfig(conf => {
                    const val = e.target.value;
                    if (typeof conf.background === "object" && conf.background !== null) {
                      conf.background.image = val;
                    } else {
                      conf.background = val;
                    }
                    if (conf.background === "") {
                      delete conf.background;
                    }
                    return conf;
                  })}
                  className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                  placeholder="/api/config/background"
                />
              </label>

              {isBgObject && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-3 gap-3">
                    <label className="block text-[11px] text-theme-600 dark:text-theme-300">
                      Размытие фона (blur)
                      <select
                        value={bgBlurVal}
                        onChange={(e) => updateConfig(conf => {
                          conf.background = conf.background || {};
                          if (e.target.value === "") delete conf.background.blur;
                          else conf.background.blur = e.target.value;
                          
                          cleanBackgroundObject(conf);
                          return conf;
                        })}
                        className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                      >
                        <option value="">Без размытия</option>
                        <option value="sm">Слабое (sm)</option>
                        <option value="md">Среднее (md)</option>
                        <option value="lg">Сильное (lg)</option>
                        <option value="xl">Очень сильное (xl)</option>
                        <option value="2xl">Экстремальное (2xl)</option>
                        <option value="3xl">Максимальное (3xl)</option>
                      </select>
                    </label>

                    <label className="block text-[11px] text-theme-600 dark:text-theme-300">
                      Яркость фона
                      <select
                        value={bgBrightnessVal}
                        onChange={(e) => updateConfig(conf => {
                          conf.background = conf.background || {};
                          if (e.target.value === "") delete conf.background.brightness;
                          else conf.background.brightness = parseInt(e.target.value, 10);
                          
                          cleanBackgroundObject(conf);
                          return conf;
                        })}
                        className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                      >
                        <option value="">Обычная (100%)</option>
                        <option value="50">Очень темно (50%)</option>
                        <option value="75">Темно (75%)</option>
                        <option value="90">Чуть темнее (90%)</option>
                        <option value="95">Немного темнее (95%)</option>
                        <option value="105">Немного светлее (105%)</option>
                        <option value="110">Чуть светлее (110%)</option>
                        <option value="125">Светло (125%)</option>
                        <option value="150">Очень светло (150%)</option>
                        <option value="200">Максимально светло (200%)</option>
                      </select>
                    </label>

                    <label className="block text-[11px] text-theme-600 dark:text-theme-300">
                      Насыщенность
                      <select
                        value={bgSaturateVal}
                        onChange={(e) => updateConfig(conf => {
                          conf.background = conf.background || {};
                          if (e.target.value === "") delete conf.background.saturate;
                          else conf.background.saturate = parseInt(e.target.value, 10);
                          
                          cleanBackgroundObject(conf);
                          return conf;
                        })}
                        className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                      >
                        <option value="">Обычная (100%)</option>
                        <option value="0">Черно-белая (0%)</option>
                        <option value="50">Приглушенная (50%)</option>
                        <option value="150">Яркая (150%)</option>
                        <option value="200">Супер-яркая (200%)</option>
                      </select>
                    </label>
                  </div>

                  <div className="pt-2">
                    <label className="block text-[11px] text-theme-600 dark:text-theme-300">
                      Видимость фонового рисунка: {bgOpacityVal !== "" ? `${bgOpacityVal}%` : "100%"}
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={bgOpacityVal !== "" ? bgOpacityVal : 100}
                        onChange={(e) => updateConfig(conf => {
                          conf.background = conf.background || {};
                          const val = parseInt(e.target.value, 10);
                          if (val === 100) delete conf.background.opacity;
                          else conf.background.opacity = val;
                          
                          cleanBackgroundObject(conf);
                          return conf;
                        })}
                        className="w-full h-1 bg-theme-200 rounded-lg appearance-none cursor-pointer dark:bg-theme-700 mt-2"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <hr className="border-theme-300/20 dark:border-white/5" />

          {/* API Keys Providers */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-theme-800 dark:text-theme-200 uppercase tracking-wider">Интеграции и API поставщиков</h4>

            <div className="space-y-3 rounded-md border border-theme-300/20 dark:border-white/5 bg-theme-50/5 p-3">
              <span className="text-[11px] font-semibold text-theme-700 dark:text-theme-200 block">Погода (Weather API и Виджет)</span>

              <div className="grid grid-cols-2 gap-4 mb-2">
                <label className="block text-[11px] text-theme-600 dark:text-theme-300">
                  OpenWeatherMap Key (в settings.yaml)
                  <input
                    type="text"
                    value={weatherProviders.openweathermap ?? ""}
                    onChange={(e) => updateConfig(conf => {
                      conf.providers = conf.providers || {};
                      const val = e.target.value;
                      if (val === "") delete conf.providers.openweathermap;
                      else conf.providers.openweathermap = val;
                      return conf;
                    })}
                    className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                    placeholder="openweathermapapikey"
                  />
                </label>
                <label className="block text-[11px] text-theme-600 dark:text-theme-300">
                  WeatherAPI Key (в settings.yaml)
                  <input
                    type="text"
                    value={weatherProviders.weatherapi ?? ""}
                    onChange={(e) => updateConfig(conf => {
                      conf.providers = conf.providers || {};
                      const val = e.target.value;
                      if (val === "") delete conf.providers.weatherapi;
                      else conf.providers.weatherapi = val;
                      return conf;
                    })}
                    className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-xs text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                    placeholder="weatherapiapikey"
                  />
                </label>
              </div>

              {/* Weather config moved to WeatherWidgetModal */}
            </div>
          </div>

          <hr className="border-theme-300/20 dark:border-white/5" />

          {/* PWA Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-theme-800 dark:text-theme-200 uppercase tracking-wider">Приложение (PWA)</h4>

            <div className="space-y-3 rounded-md border border-theme-300/20 dark:border-white/5 bg-theme-50/5 p-3">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-semibold text-theme-700 dark:text-theme-200">Progressive Web App (PWA)</span>
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pwaEnabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      updateConfig(conf => {
                        conf.pwa = conf.pwa || {};
                        conf.pwa.enabled = enabled;
                        return conf;
                      });
                    }}
                    className="rounded border-theme-300 text-theme-600 shadow-sm dark:border-white/10 dark:bg-theme-900"
                  />
                  Включить PWA
                </label>
              </div>

              {pwaEnabled && (
                <div className="text-[10px] leading-normal text-amber-600 dark:text-amber-400/90 border border-amber-300/20 bg-amber-500/5 p-2.5 rounded-md mt-2">
                  <p className="font-semibold mb-1">ℹ️ Ограничение браузера по безопасности:</p>
                  Кнопка установки PWA появится в браузере только если ваш сайт работает по безопасному протоколу <strong>HTTPS</strong> или открыт по адресу <strong>localhost / 127.0.0.1</strong>. При доступе по обычному IP-адресу (например, http://192.168.1.73) браузер блокирует работу PWA.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel: Raw YAML */}
      <div className="lg:col-span-5 flex flex-col min-h-0">
        <CodeEditor
          label="YAML Редактор (settings.yaml)"
          language="yaml"
          value={content}
          onChange={onChange}
          minHeightClassName="min-h-0"
          fillAvailableHeight
          zoomStorageKey="homepage-browser-editor-code-zoom-settings"
          placeholder="settings.yaml"
        />
        {yamlError && (
          <div className="mt-2 text-[10px] text-rose-600 dark:text-rose-400 font-mono bg-rose-50 dark:bg-rose-950/20 p-2 rounded border border-rose-300/30 whitespace-pre-wrap leading-normal overflow-x-auto">
            {yamlError}
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigFilesModal({ tabs, settings: initialSettings, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const { settings, setSettings } = useContext(SettingsContext);
  const currentSettings = settings ?? initialSettings;
  const [activeFileName, setActiveFileName] = useState("__page_styling__");
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
    if (activeFileName !== "__page_styling__" && !tabs?.some((tab) => tab.fileName === activeFileName)) {
      setActiveFileName("__page_styling__");
    }
  }, [activeFileName, tabs]);

  const activeTab = tabs?.find((tab) => tab.fileName === activeFileName) ?? null;
  const activeContent = activeTab ? drafts[activeTab.fileName] ?? activeTab.content ?? "" : "";
  const activeLanguage = activeTab ? detectEditorLanguage(activeTab.format, activeTab.fileName) : "";

  async function handleSave() {
    const targetFileName = activeFileName === "__page_styling__" ? "settings.yaml" : activeTab?.fileName;
    if (!targetFileName) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await editorWriteFetch("/api/config/editor", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: targetFileName,
          content: drafts[targetFileName] ?? "",
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      let nextData;
      if (targetFileName === "settings.yaml" && drafts["widgets.yaml"] !== undefined) {
        const widgetsResponse = await editorWriteFetch("/api/config/editor", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: "widgets.yaml",
            content: drafts["widgets.yaml"] ?? "",
          }),
        });
        if (!widgetsResponse.ok) {
          throw new Error("Не удалось сохранить widgets.yaml: " + (await widgetsResponse.text()));
        }
        nextData = await widgetsResponse.json();
      } else {
        nextData = await response.json();
      }

      if (nextData?.settings) {
        setSettings(nextData.settings);
      }

      setDrafts(Object.fromEntries((nextData?.settingsTabs ?? []).map((tab) => [tab.fileName, tab.content ?? ""])));
      await refreshConfigData(mutate, ["/api/config/editor", "/api/widgets"]);
      onSaved(activeFileName === "__page_styling__" ? "Стилизация страниц сохранена" : `Сохранено: ${activeTab.label}`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorWindow
      storageKey="homepage-browser-editor-window-settings"
      title="Ручная настройка и стили"
      onClose={onClose}
      defaultWidth={1120}
      defaultHeight={780}
      minWidth={760}
      minHeight={520}
    >
      <div>
        <div className="flex flex-wrap gap-2 pb-1.5 border-b border-theme-300/30 mb-4">
          <button
            type="button"
            onClick={() => setActiveFileName("__page_styling__")}
            className={classNames(
              "min-w-[9rem] rounded-xl border px-3 py-2 text-left text-xs transition-colors",
              activeFileName === "__page_styling__"
                ? "border-theme-500/70 bg-theme-200/70 text-theme-950 shadow-sm dark:border-white/30 dark:bg-white/15 dark:text-theme-50"
                : "border-theme-300/50 bg-transparent text-theme-800 hover:bg-theme-100/60 dark:border-white/10 dark:text-theme-200 dark:hover:bg-white/10",
            )}
          >
            <div className="truncate text-sm font-semibold leading-5">Стилизация страниц</div>
            <div className="truncate opacity-70">Настройки вкладок</div>
          </button>
          {(tabs ?? []).map((tab) => (
            <button
              key={tab.fileName}
              type="button"
              onClick={() => setActiveFileName(tab.fileName)}
              className={classNames(
                "min-w-[9rem] rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                activeFileName === tab.fileName
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
        <div style={{ display: activeFileName === "__page_styling__" ? "flex" : "none" }} className="flex-1 min-h-0 flex flex-col">
          <PageStylingEditor
            settingsContent={drafts["settings.yaml"] ?? ""}
            onChange={(newContent) =>
              setDrafts((current) => ({
                ...current,
                "settings.yaml": newContent,
              }))
            }
          />
        </div>
        {(tabs ?? []).map((tab) => {
          const active = activeFileName === tab.fileName;
          const isSettingsYaml = tab.fileName === "settings.yaml";
          return (
            <div
              key={tab.fileName}
              style={{ display: active ? "flex" : "none" }}
              className="flex-1 min-h-0 flex flex-col"
            >
              {isSettingsYaml ? (
                <SettingsVisualEditor
                  content={drafts["settings.yaml"] ?? ""}
                  onChange={(value) =>
                    setDrafts((current) => ({
                      ...current,
                      "settings.yaml": value,
                    }))
                  }
                  widgetsContent={drafts["widgets.yaml"] ?? ""}
                  onWidgetsChange={(value) =>
                    setDrafts((current) => ({
                      ...current,
                      "widgets.yaml": value,
                    }))
                  }
                />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col" style={{ paddingRight: "5px" }}>
                  <CodeEditor
                    label="Содержимое файла"
                    language={detectEditorLanguage(tab.format, tab.fileName)}
                    value={drafts[tab.fileName] ?? ""}
                    onChange={(value) =>
                      setDrafts((current) => ({
                        ...current,
                        [tab.fileName]: value,
                      }))
                    }
                    minHeightClassName="min-h-0"
                    fillAvailableHeight
                    zoomStorageKey="homepage-browser-editor-code-zoom-settings"
                    placeholder={tab.fileName}
                  />
                </div>
              )}
            </div>
          );
        })}
        {(!tabs || tabs.length === 0) && activeFileName !== "__page_styling__" && (
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
            disabled={(activeFileName !== "__page_styling__" && !activeTab) || saving}
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
  const matchedExistingTab = existingTabs.find((tab) => namesEqual(tab, form.tab));
  const [showCustomPageInput, setShowCustomPageInput] = useState(() => Boolean(form.tab.trim() && !matchedExistingTab));
  const pageSelectValue = showCustomPageInput ? "__custom__" : matchedExistingTab ? matchedExistingTab : "";

  const quickLayoutButtonClass = (active = false) =>
    classNames(
      "rounded-md border px-3 py-2 text-sm transition-colors",
      "border-theme-400/60 hover:bg-theme-200/40 dark:border-white/20 dark:hover:bg-white/10",
      active && "bg-theme-200/70 text-theme-900 dark:bg-white/15 dark:text-theme-100",
    );

  async function putConfig(file, nextData) {
    const response = await editorWriteFetch("/api/config/editor", {
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
        nextSettings = updateSettingsLayout(data.settings, groupType, modal.groupName, modal.groupName, {}, "delete");
      } else if (modal.mode === "new") {
        nextGroups = addRawGroup(data[groupType], trimmedName, groupType);
        nextSettings = updateSettingsLayout(data.settings, groupType, trimmedName, trimmedName, nextLayout, "save");
      } else {
        nextGroups = renameRawGroup(data[groupType], modal.groupName, trimmedName);
        nextSettings = updateSettingsLayout(data.settings, groupType, modal.groupName, trimmedName, nextLayout, "save");
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
              <select
                value={pageSelectValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "__custom__") {
                    setShowCustomPageInput(true);
                    return;
                  }

                  setShowCustomPageInput(false);
                  setForm((current) => ({
                    ...current,
                    tab: nextValue,
                  }));
                }}
                className="mt-1 w-full min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              >
                <option value="">Все страницы</option>
                {existingTabs.map((tab) => (
                  <option key={tab} value={tab}>
                    {tab}
                  </option>
                ))}
                <option value="__custom__">Новая страница...</option>
              </select>
              {pageSelectValue === "__custom__" && (
                <input
                  type="text"
                  value={form.tab}
                  onChange={(event) => setForm((current) => ({ ...current, tab: event.target.value }))}
                  placeholder="Введите новую страницу"
                  className="mt-2 w-full min-w-0 rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
                />
              )}
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
          <div className="mt-3 border-t border-theme-300/30 pt-3">
            <p className="mb-2 text-xs font-medium text-theme-600 dark:text-theme-300">Стиль заголовка</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                name="titleColor"
                label="Цвет заголовка"
                value={form.titleColor}
                onChange={(value) => setForm((current) => ({ ...current, titleColor: value }))}
              />
              <Field
                name="titleAlign"
                label="Выравнивание заголовка"
                value={form.titleAlign}
                onChange={(value) => setForm((current) => ({ ...current, titleAlign: value }))}
              />
              <Field
                name="titleSize"
                label="Размер шрифта заголовка"
                value={form.titleSize}
                onChange={(value) => setForm((current) => ({ ...current, titleSize: value }))}
              />
              <Field
                name="titleFont"
                label="Шрифт заголовка"
                value={form.titleFont}
                onChange={(value) => setForm((current) => ({ ...current, titleFont: value }))}
              />
            </div>
          </div>
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

function clearPageAutoOpen() {
  if (pageAutoOpenTimeoutId) {
    window.clearTimeout(pageAutoOpenTimeoutId);
    pageAutoOpenTimeoutId = 0;
  }
  pageAutoOpenTabName = null;
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

function readItemDragPayload(event, fallbackPayload = null) {
  const typedPayload = readDragPayload(event, ITEM_DRAG_TYPE);
  const genericPayload = typedPayload ?? readDragPayload(event);
  const fallback = fallbackPayload ?? activeDragPayload;

  if (genericPayload?.type === "services" || genericPayload?.type === "bookmarks") {
    return genericPayload;
  }

  if (fallback?.type === "services" || fallback?.type === "bookmarks") {
    return fallback;
  }

  return null;
}

function readTopWidgetDragPayload(event, fallbackPayload = null) {
  const typedPayload = readDragPayload(event, TOP_WIDGET_DRAG_TYPE);
  const genericPayload = typedPayload ?? readDragPayload(event);
  const fallback = fallbackPayload ?? activeDragPayload;

  if (genericPayload?.scope === "top-widget") {
    return genericPayload;
  }

  if (fallback?.scope === "top-widget") {
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
  const { editMode, moveGroup, moveTab, setDraggedGroup } = useConfigEditor();
  const { settings } = useContext(SettingsContext);
  const encodedTab = encodeTabName(tab);
  const matchesTab = activeTab
    ? decodeURIComponent(activeTab) === String(tab).replace(/\s+/g, "-").toLowerCase()
    : false;

  const pageStyles = settings?.pageStyles ?? {};
  const pageIcons = pageStyles.icons ?? {};
  const iconName = pageIcons[tab];
  const borderStyle = pageStyles.borderStyle ?? "none";
  const activeColor = pageStyles.activeColor;
  const inactiveColor = pageStyles.inactiveColor;
  const borderColor = pageStyles.borderColor;

  const activateTab = useCallback(() => {
    setActiveTab(encodedTab);
    window.location.hash = `#${encodedTab}`;
  }, [encodedTab, setActiveTab]);

  const iconEl = iconName ? (
    <span className="mr-2 inline-flex items-center shrink-0 w-4 h-4" style={{ color: matchesTab ? (activeColor || borderColor) : inactiveColor }}>
      <ResolvedIcon icon={iconName} />
    </span>
  ) : null;

  const buttonStyle = {};
  const textStyle = {};

  const fontFamily = pageStyles.fontFamily;
  const fontSize = pageStyles.fontSize;
  if (fontFamily) {
    buttonStyle.fontFamily = fontFamily;
  }
  if (fontSize) {
    buttonStyle.fontSize = fontSize;
  }

  if (matchesTab && (activeColor || borderColor)) {
    buttonStyle.color = activeColor || borderColor;
    textStyle.color = activeColor || borderColor;
  } else if (!matchesTab && inactiveColor) {
    buttonStyle.color = inactiveColor;
    textStyle.color = inactiveColor;
  }

  let buttonClasses = "";
  if (borderStyle === "underline") {
    buttonClasses = classNames(
      "w-full rounded-none m-1 pb-1 transition-all tab-style-underline",
      matchesTab ? "border-b-2" : "hover:border-b-2 hover:border-theme-300/30 dark:hover:border-white/10",
    );
    if (matchesTab && (borderColor || activeColor)) {
      buttonStyle.borderBottomColor = borderColor || activeColor;
    }
  } else if (borderStyle === "underline-rounded") {
    buttonClasses = classNames(
      "w-full rounded-none m-1 pb-1 transition-all tab-style-underline-rounded",
    );
    if (matchesTab && (borderColor || activeColor)) {
      buttonStyle["--underline-color"] = borderColor || activeColor;
    }
    if (!matchesTab && inactiveColor) {
      buttonStyle["--underline-hover-color"] = inactiveColor;
    }
  } else if (borderStyle === "pill") {
    buttonClasses = classNames(
      "w-full rounded-full m-1 transition-all tab-style-pill",
      matchesTab ? "" : "hover:bg-theme-100/20 dark:hover:bg-white/5",
    );
    if (matchesTab) {
      const tintColor = borderColor && borderColor.startsWith('#') && (borderColor.length === 7 || borderColor.length === 4)
        ? (borderColor.length === 4 ? borderColor + borderColor.substring(1) : borderColor) + "26"
        : "rgba(59, 130, 246, 0.15)";
      buttonStyle.backgroundColor = tintColor;
      buttonStyle["--pill-bg-color"] = tintColor;
    }
  } else if (borderStyle === "card") {
    buttonClasses = classNames(
      "w-full rounded-md m-1 border transition-all tab-style-card",
      matchesTab ? "bg-theme-100/10 dark:bg-white/5" : "border-transparent hover:bg-theme-100/20 dark:hover:bg-white/5",
    );
    if (matchesTab && borderColor) {
      buttonStyle.borderColor = borderColor;
    } else if (matchesTab) {
      buttonStyle.borderColor = "rgba(156, 163, 175, 0.3)";
    }
  } else {
    buttonClasses = classNames(
      "w-full rounded-md m-1 transition-all",
      matchesTab ? "bg-theme-300/20 dark:bg-white/10" : "hover:bg-theme-100/20 dark:hover:bg-white/5",
    );
  }

  if (editMode && borderStyle === "none") {
    buttonClasses = classNames(
      buttonClasses,
      "border border-theme-400/70 bg-theme-100/10 text-theme-800 transition-colors hover:border-theme-500/80 hover:bg-theme-200/40 hover:text-theme-900 dark:border-white/25 dark:bg-white/5 dark:text-theme-100 dark:hover:border-white/40 dark:hover:bg-white/10",
    );
  }

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

        clearPageAutoOpen();
        window.setTimeout(clearDragPayload, 0);
      }}
      onDragOver={(event) => {
        if (!editMode) {
          return;
        }

        const draggedTab = readTabDragPayload(event);
        if (draggedTab) {
          if (namesEqual(draggedTab.tabName, tab)) {
            clearPageAutoOpen();
            return;
          }

          clearPageAutoOpen();
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          return;
        }

        const draggedItem = readItemDragPayload(event);
        const draggedGroup = readGroupDragPayload(event);
        if (!draggedItem && !draggedGroup) {
          clearPageAutoOpen();
          return;
        }

        if (draggedGroup && matchesTab) {
          clearPageAutoOpen();
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          return;
        }

        if (matchesTab) {
          clearPageAutoOpen();
          return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = "move";

        if (!namesEqual(pageAutoOpenTabName, tab)) {
          clearPageAutoOpen();
          pageAutoOpenTabName = tab;
          pageAutoOpenTimeoutId = window.setTimeout(() => {
            pageAutoOpenTimeoutId = 0;
            pageAutoOpenTabName = null;
            activateTab();
          }, PAGE_AUTO_OPEN_DELAY_MS);
        }
      }}
      onDragLeave={() => {
        if (namesEqual(pageAutoOpenTabName, tab)) {
          clearPageAutoOpen();
        }
      }}
      onDrop={(event) => {
        if (!editMode) {
          return;
        }

        clearPageAutoOpen();
        const draggedGroup = readGroupDragPayload(event);
        if (draggedGroup) {
          event.preventDefault();
          event.stopPropagation();
          activateTab();
          moveGroup(draggedGroup.type, draggedGroup.groupName, null, "root", tab);
          clearDragPayload();
          setDraggedGroup(null);
          return;
        }

        const draggedTab = readTabDragPayload(event);
        if (!draggedTab || namesEqual(draggedTab.tabName, tab)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        moveTab(draggedTab.tabName, tab);
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
        className={buttonClasses}
        style={buttonStyle}
        onClick={() => {
          activateTab();
        }}
      >
        <span className="flex items-center justify-center w-full h-full" style={textStyle}>
          {iconEl}
          <span style={textStyle}>{tab}</span>
        </span>
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

export function useEditableGroupHeader(type, groupName, layout) {
  const { editMode, moveGroup, openGroup, setDraggedGroup } = useConfigEditor();

  if (!editMode) {
    return {};
  }

  /** Returns "before" when cursor is in the top half of the element, "after" otherwise. */
  function getDropPlacement(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  /** Sets a CSS data-attribute so the group header shows a drop-line indicator. */
  function updateDropIndicator(event) {
    const el = event.currentTarget;
    if (el) {
      el.setAttribute("data-drop-placement", getDropPlacement(event));
    }
  }

  function clearDropIndicator(event) {
    event.currentTarget?.removeAttribute("data-drop-placement");
  }

  return {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = "move";
      const payload = { scope: "group", type, groupName };
      writeDragPayload(event, payload, GROUP_DRAG_TYPE);
      setDraggedGroup(payload);
    },
    onDragEnd: () => {
      window.setTimeout(() => {
        clearDragPayload();
        setDraggedGroup(null);
      }, 0);
    },
    onDragOver: (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      updateDropIndicator(event);
    },
    onDragLeave: (event) => {
      clearDropIndicator(event);
    },
    onDrop: (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearDropIndicator(event);
      const dragged = readGroupDragPayload(event);
      if (dragged?.scope === "group" && dragged.type === type) {
        const placement = getDropPlacement(event);
        moveGroup(type, dragged.groupName, groupName, placement);
      }
    },
    onClick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      openGroup(type, groupName, layout);
    },
    "data-editor-group-drop-target": "true",
  };
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
  const { activePageName, draggedGroup, editMode, moveGroup, setDraggedGroup } = useConfigEditor();

  const dropGroupToRoot = useCallback(
    (event) => {
      const dragged = readGroupDragPayload(event, draggedGroup);
      if (!dragged) {
        return false;
      }

      event.preventDefault();
      moveGroup(dragged.type, dragged.groupName, null, "root", activePageName);
      clearDragPayload();
      setDraggedGroup(null);
      return true;
    },
    [activePageName, draggedGroup, moveGroup, setDraggedGroup],
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

export function useEditableTopWidget(widget, widgetIndex) {
  const { editMode, moveTopWidget, openTopWidget } = useConfigEditor();
  return {
    editMode,
    widgetProps: editMode
      ? {
          draggable: true,
          onDragStart: (event) => {
            event.dataTransfer.effectAllowed = "move";
            writeDragPayload(event, { scope: "top-widget", widgetIndex }, TOP_WIDGET_DRAG_TYPE);
          },
          onDragEnd: () => {
            window.setTimeout(clearDragPayload, 0);
          },
          onDragOver: (event) => {
            if (!readTopWidgetDragPayload(event)) {
              return;
            }

            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          },
          onDrop: (event) => {
            const dragged = readTopWidgetDragPayload(event);
            if (!dragged) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            moveTopWidget(dragged.widgetIndex, widgetIndex);
          },
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            openTopWidget(widget, widgetIndex);
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
  const { activeTab } = useContext(TabContext);
  const [draggedGroup, setDraggedGroup] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editButtonVisible, setEditButtonVisible] = useState(false);
  const [modal, setModal] = useState(null);
  const [iconSelectorCallback, setIconSelectorCallback] = useState(null);
  const [iconsManagerOpen, setIconsManagerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [iconsSaving, setIconsSaving] = useState(false);
  const editButtonHideTimeoutRef = useRef(null);
  const backgroundButtonRef = useRef(null);
  const { data } = useSWR(enabled && (editMode || modal || iconsManagerOpen) ? "/api/config/editor" : null);
  useServiceRowHeightBalancer();

  function handleSaved(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  const localizeIcons = useCallback(async () => {
    if (iconsSaving) {
      return;
    }

    setIconsSaving(true);
    try {
      const response = await editorWriteFetch("/api/config/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "localize-icons" }),
      });

      if (!response.ok) {
        handleSaved(await response.text());
        return;
      }

      const nextData = await response.json();
      await mutate("/api/config/editor", nextData, false);
      await refreshConfigData(mutate);

      const result = nextData.iconLocalization;
      if (!result?.updated) {
        handleSaved("Иконки со ссылками не найдены");
        return;
      }

      const skipped = result.skipped ? `, пропущено ${result.skipped}` : "";
      handleSaved(`Иконки: скачано ${result.downloaded}, обновлено ${result.updated}${skipped}`);
    } finally {
      setIconsSaving(false);
    }
  }, [iconsSaving, mutate]);

  const activePageName = useMemo(() => {
    const normalizedActiveTab = typeof activeTab === "string" ? decodeURIComponent(activeTab) : "";
    if (!normalizedActiveTab) {
      return null;
    }

    const orderedTabs = getOrderedTabsForLayout(data?.settings?.layout ?? {}, data?.settings?.__browserEditorTabOrder ?? []);
    return orderedTabs.find((tab) => namesEqual(encodeTabName(tab), normalizedActiveTab)) ?? null;
  }, [activeTab, data]);

  const moveTab = useCallback(
    async (sourceTab, targetTab) => {
      if (!data || !sourceTab || !targetTab || namesEqual(sourceTab, targetTab)) {
        return;
      }

      const nextResult = moveSettingsLayoutTab(data.settings, sourceTab, targetTab);
      if (!nextResult.moved) {
        return;
      }

      const response = await editorWriteFetch("/api/config/editor", {
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
      activePageName,
      draggedGroup,
      setDraggedGroup,
      editMode,
      moveTab,
      moveGroup: async (type, sourceName, targetName, placement = "before", targetTab = null) => {
        if (!data || (placement !== "root" && namesEqual(sourceName, targetName))) {
          return;
        }

        const rawResult =
          type === "services"
            ? moveRawServiceGroup(data[type], sourceName, targetName, placement)
            : moveRawBookmarkGroup(data[type], sourceName, targetName, placement);

        let layoutResult =
          type === "services"
            ? moveSettingsLayoutGroup(data.settings, rawResult.nextGroups, sourceName, targetName, placement)
            : { moved: true, settings: data.settings };

        if (layoutResult.moved && placement === "root" && typeof targetTab === "string" && targetTab.trim()) {
          layoutResult = {
            ...layoutResult,
            settings: applyGroupTabToSettings(layoutResult.settings, type, sourceName, targetTab),
          };
        }

        if (layoutResult.moved) {
          layoutResult = {
            ...layoutResult,
            settings: updateGroupOrderSettings(
              data.settings,
              layoutResult.settings,
              data.services,
              data.bookmarks,
              type === "services" ? rawResult.nextGroups : data.services,
              type === "bookmarks" ? rawResult.nextGroups : data.bookmarks,
              type,
              sourceName,
              targetName,
              placement,
            ),
          };
        }

        if (!rawResult.moved || !layoutResult.moved) {
          handleSaved("Группу нельзя переместить сюда");
          return;
        }

        const groupResponse = await editorWriteFetch("/api/config/editor", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: type, data: rawResult.nextGroups }),
        });

        if (!groupResponse.ok) {
          handleSaved(await groupResponse.text());
          return;
        }

        if (layoutResult.settings !== data.settings) {
          const settingsResponse = await editorWriteFetch("/api/config/editor", {
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

        const response = await editorWriteFetch("/api/config/editor", {
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
      moveTopWidget: async (sourceIndex, targetIndex) => {
        if (!data || sourceIndex === targetIndex) {
          return;
        }

        const widgetsTab = data?.settingsTabs?.find((tab) => tab.fileName === "widgets.yaml");
        const result = moveTopLevelYamlBlock(widgetsTab?.content ?? "", sourceIndex, targetIndex);
        if (!result.moved) {
          handleSaved("Виджет нельзя переместить");
          return;
        }

        const response = await editorWriteFetch("/api/config/editor", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: "widgets.yaml", content: result.content }),
        });

        if (!response.ok) {
          handleSaved(await response.text());
          return;
        }

        await refreshConfigData(mutate, ["/api/config/editor", "/api/widgets"]);
        handleSaved("Порядок виджетов сохранён");
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
      openTopWidget: (widget, widgetIndex) =>
        setModal({
          type: "widgets",
          widget,
          widgetIndex,
          mode: "edit",
          scope: "top-widget",
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
      iconSelectorCallback,
      setIconSelectorCallback,
      selectIcon: (callback) => {
        setIconSelectorCallback(() => callback);
        setIconsManagerOpen(true);
      },
    }),
    [activePageName, data, draggedGroup, editMode, moveTab, mutate, setDraggedGroup, setSettings, iconSelectorCallback, iconsManagerOpen],
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
          <button type="button" onClick={() => setIconsManagerOpen(true)} className={toolbarButtonClassName}>
            Иконки
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
        <ConfigFilesModal
          tabs={data?.settingsTabs ?? []}
          settings={data?.settings}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.scope === "group" && modal && data && (
        <GroupModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.scope === "top-widget" && modal && data && (
        modal.widget?.type === "datetime" ? (
          <ClockWidgetModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
        ) : (modal.widget?.type === "weather" || modal.widget?.type === "openweathermap" || modal.widget?.type === "weatherapi" || modal.widget?.type === "openmeteo") ? (
          <WeatherWidgetModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
        ) : (
          <TopWidgetModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
        )
      )}
      {modal?.type !== "background" &&
        modal?.type !== "settings-tabs" &&
        modal?.type !== "icons-manager" &&
        modal?.scope !== "group" &&
        modal?.scope !== "top-widget" &&
        modal &&
        data && (
        <ItemModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {iconsManagerOpen && (
        <IconsManagerModal
          settings={data?.settings}
          onClose={() => {
            setIconsManagerOpen(false);
            setIconSelectorCallback(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </ConfigEditorContext.Provider>
  );
}
