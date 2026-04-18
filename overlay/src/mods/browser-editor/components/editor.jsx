import classNames from "classnames";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import yaml from "js-yaml";
import { SettingsContext } from "utils/contexts/settings";

const ConfigEditorContext = createContext({
  draggedGroup: null,
  setDraggedGroup: () => {},
  editMode: false,
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

let activeDragPayload = null;

const serviceFields = [
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

const bookmarkFields = [
  ["href", "URL"],
  ["icon", "Иконка"],
  ["description", "Описание"],
  ["abbr", "Сокращение"],
  ["target", "Цель"],
];

const knownFields = {
  bookmarks: bookmarkFields.map(([key]) => key),
  services: serviceFields.map(([key]) => key),
};

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

function createItemMatcher(type, itemName, itemConfig = {}) {
  const config = {};

  knownFields[type].forEach((key) => {
    if (itemConfig?.[key] !== undefined) {
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
  if (getEntryName(entry) !== itemName) {
    return false;
  }

  if (!matcher) {
    return true;
  }

  return itemMatcherEquals(createEntryMatcher(entry, type), matcher);
}

function isItemEntry(entry, type) {
  const value = getEntryValue(entry);
  if (type === "services") {
    return !Array.isArray(value);
  }

  return Array.isArray(value);
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

function findRawEntry(rawGroups, type, groupName, itemName, itemMatcher = null) {
  const findInEntries = (entries = [], currentGroup) => {
    for (const entry of entries) {
      const name = getEntryName(entry);
      const value = entry[name];

      if (currentGroup === groupName && isItemEntry(entry, type) && entryMatchesItemMatcher(entry, type, itemName, itemMatcher)) {
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
}

function updateRawEntry(rawGroups, type, groupName, originalName, originalMatcher, nextName, nextConfig) {
  let changed = false;

  const updateEntries = (entries = [], currentGroup) =>
    entries.map((entry) => {
      const name = getEntryName(entry);
      const value = entry[name];

      if (currentGroup === groupName && isItemEntry(entry, type) && !changed && entryMatchesItemMatcher(entry, type, originalName, originalMatcher)) {
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

  if (!changed) {
    return addRawEntry(nextGroups, type, groupName, nextName, nextConfig);
  }

  return nextGroups;
}

function addRawEntry(rawGroups, type, groupName, itemName, itemConfig) {
  let added = false;

  const addToEntries = (entries = [], currentGroup) => {
    if (currentGroup === groupName) {
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
  if ((rawGroups ?? []).some((group) => getEntryName(group) === groupName)) {
    throw new Error("Группа уже существует");
  }

  if (type === "services") {
    return [...(rawGroups ?? []), { [groupName]: [{ "Новый сервис": { href: "#", weight: 100 } }] }];
  }

  return [...(rawGroups ?? []), { [groupName]: [] }];
}

function renameRawGroup(rawGroups, originalName, nextName) {
  let renamed = false;

  const renameGroups = (groups = []) => groups.map((group) => {
    const name = getEntryName(group);
    const value = group[name];

    if (name === originalName) {
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

function deleteRawEntry(rawGroups, type, groupName, itemName, itemMatcher = null) {
  let removed = false;

  const filterEntries = (entries = [], currentGroup) =>
    entries
      .filter((entry) => {
        if (!isItemEntry(entry, type) || currentGroup !== groupName || removed) {
          return true;
        }

        if (entryMatchesItemMatcher(entry, type, itemName, itemMatcher)) {
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

  return (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    return { [name]: filterEntries(group[name], name) };
  });
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
    const weightedIndex = remainingWeightedEntries.findIndex((weightedEntry) => itemMatcherEquals(createEntryMatcher(weightedEntry, "services"), entryMatcher));

    if (weightedIndex < 0) {
      return entry;
    }

    const [weightedEntry] = remainingWeightedEntries.splice(weightedIndex, 1);
    return weightedEntry ?? entry;
  });
}

function reorderServiceEntriesInGroup(entries = [], sourceName, sourceMatcher = null, targetName = null, targetMatcher = null) {
  const currentServiceEntries = getSortedServiceEntries(entries);
  const sourceIndex = currentServiceEntries.findIndex((entry) => entryMatchesItemMatcher(entry, "services", sourceName, sourceMatcher));
  if (sourceIndex < 0) {
    return { moved: false, entries };
  }

  if (targetName !== null) {
    const targetIndex = currentServiceEntries.findIndex((entry) => entryMatchesItemMatcher(entry, "services", targetName, targetMatcher));
    if (targetIndex < 0 || targetIndex === sourceIndex) {
      return { moved: false, entries };
    }

    const swappedServiceEntries = [...currentServiceEntries];
    const sourceEntry = swappedServiceEntries[sourceIndex];
    const targetEntry = swappedServiceEntries[targetIndex];
    const sourceWeight = getEntryValue(sourceEntry).weight;
    const targetWeight = getEntryValue(targetEntry).weight;

    swappedServiceEntries[sourceIndex] = {
      [getEntryName(sourceEntry)]: {
        ...getEntryValue(sourceEntry),
        weight: targetWeight,
      },
    };
    swappedServiceEntries[targetIndex] = {
      [getEntryName(targetEntry)]: {
        ...getEntryValue(targetEntry),
        weight: sourceWeight,
      },
    };

    return { moved: true, entries: applyWeightedServiceEntries(entries, swappedServiceEntries) };
  }

  const nextServiceEntries = [...currentServiceEntries];
  const [removedEntry] = nextServiceEntries.splice(sourceIndex, 1);
  if (!removedEntry) {
    return { moved: false, entries };
  }

  nextServiceEntries.push(removedEntry);

  const reorderedServices = resetServiceWeights(nextServiceEntries);
  return { moved: true, entries: applyWeightedServiceEntries(entries, reorderedServices) };
}

function reorderRawServiceEntryInGroup(rawGroups, groupName, sourceName, sourceMatcher = null, targetName = null, targetMatcher = null) {
  let moved = false;

  const reorderEntries = (entries = [], currentGroup) => {
    if (currentGroup === groupName) {
      const reordered = reorderServiceEntriesInGroup(entries, sourceName, sourceMatcher, targetName, targetMatcher);
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

function removeRawEntryForMove(rawGroups, type, sourceGroupName, sourceName, sourceMatcher = null) {
  let removedEntry = null;

  const removeFromEntries = (entries = [], currentGroup) =>
    entries
      .map((entry) => {
        const name = getEntryName(entry);
        const value = entry[name];

        if (isItemEntry(entry, type)) {
          if (
            currentGroup === sourceGroupName &&
            removedEntry === null &&
            entryMatchesItemMatcher(entry, type, sourceName, sourceMatcher)
          ) {
            removedEntry = entry;
            return null;
          }
          return entry;
        }

        const nestedEntries = removeFromEntries(value, name);
        return { [name]: type === "services" && name === sourceGroupName ? resetServiceWeights(nestedEntries) : nestedEntries };
      })
      .filter(Boolean);

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    const nextEntries = removeFromEntries(group[name], name);
    return { [name]: type === "services" && name === sourceGroupName ? resetServiceWeights(nextEntries) : nextEntries };
  });

  return { removedEntry, nextGroups };
}

function insertRawEntryForMove(rawGroups, type, targetGroupName, sourceEntry, targetName = null, targetMatcher = null) {
  let inserted = false;

  const insertToEntries = (entries = [], currentGroup) => {
    if (currentGroup !== targetGroupName) {
      return entries.map((entry) => {
        const name = getEntryName(entry);
        const value = entry[name];
        return isItemEntry(entry, type) ? entry : { [name]: insertToEntries(value, name) };
      });
    }

    const nextEntries = [...entries];
    const targetIndex =
      targetName === null
        ? nextEntries.length
        : nextEntries.findIndex((entry) => isItemEntry(entry, type) && entryMatchesItemMatcher(entry, type, targetName, targetMatcher));

    if (targetIndex < 0) {
      return entries;
    }

    nextEntries.splice(targetIndex, 0, sourceEntry);
    inserted = true;
    return type === "services" ? resetServiceWeights(nextEntries) : nextEntries;
  };

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    const nextEntries = insertToEntries(group[name], name);
    return { [name]: type === "services" && name === targetGroupName ? resetServiceWeights(nextEntries) : nextEntries };
  });

  return { inserted, nextGroups };
}

function reorderRawEntry(rawGroups, type, sourceGroupName, sourceName, targetGroupName, targetName = null, sourceMatcher = null, targetMatcher = null) {
  if (type === "services" && sourceGroupName === targetGroupName) {
    return reorderRawServiceEntryInGroup(rawGroups, sourceGroupName, sourceName, sourceMatcher, targetName, targetMatcher);
  }

  const { removedEntry, nextGroups: groupsWithoutSource } = removeRawEntryForMove(rawGroups, type, sourceGroupName, sourceName, sourceMatcher);
  if (!removedEntry) {
    return { moved: false, nextGroups: rawGroups };
  }

  const { inserted, nextGroups } = insertRawEntryForMove(groupsWithoutSource, type, targetGroupName, removedEntry, targetName, targetMatcher);
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

function updateSettingsLayout(settings, originalName, nextName, nextLayout, mode) {
  const nextSettings = { ...(settings ?? {}) };
  let changed = false;

  const updateLayout = (layoutMap = {}) => {
    const nextLayoutMap = {};

    Object.entries(layoutMap).forEach(([key, value]) => {
      if (key === originalName) {
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

      if (name === sourceName) {
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

      if (placement === "before" && name === targetName) {
        nextNodes.push(sourceNode);
        inserted = true;
      }

      if (Array.isArray(value)) {
        if (placement === "inside" && name === targetName) {
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
  if (placement !== "root" && (!targetName || sourceName === targetName)) {
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
    const sourceIndex = (rawGroups ?? []).findIndex((group) => getEntryName(group) === sourceName);
    if (sourceIndex < 0) {
      return { moved: false, nextGroups: rawGroups };
    }

    const nextGroups = [...rawGroups];
    const [sourceGroup] = nextGroups.splice(sourceIndex, 1);
    nextGroups.push(sourceGroup);
    return { moved: true, nextGroups };
  }

  if (!targetName || sourceName === targetName) {
    return { moved: false, nextGroups: rawGroups };
  }

  const sourceIndex = (rawGroups ?? []).findIndex((group) => getEntryName(group) === sourceName);
  const targetIndex = (rawGroups ?? []).findIndex((group) => getEntryName(group) === targetName);
  if (sourceIndex < 0 || targetIndex < 0) {
    return { moved: false, nextGroups: rawGroups };
  }

  const nextGroups = [...rawGroups];
  const [sourceGroup] = nextGroups.splice(sourceIndex, 1);
  const nextTargetIndex = nextGroups.findIndex((group) => getEntryName(group) === targetName);
  nextGroups.splice(nextTargetIndex, 0, sourceGroup);

  return { moved: true, nextGroups };
}

function findGroupPath(nodes, targetName, path = []) {
  for (const node of nodes ?? []) {
    const name = getEntryName(node);
    const value = node[name];
    const nextPath = [...path, name];

    if (name === targetName) {
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
    if (name === sourceName) {
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
      childValue && typeof childValue === "object" && !Array.isArray(childValue) ? cloneLayoutValue(childValue) : childValue,
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

function Field({ label, value, onChange }) {
  return (
    <label className="block text-xs text-theme-600 dark:text-theme-300">
      {label}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 text-sm text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
      />
    </label>
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

function ItemModal({ modal, data, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const typeFields = modal.type === "services" ? serviceFields : bookmarkFields;
  const rawConfig =
    modal.mode === "edit" ? findRawEntry(data?.[modal.type], modal.type, modal.groupName, modal.itemName, modal.itemMatcher) ?? modal.item : {};
  const [name, setName] = useState(modal.mode === "edit" ? modal.itemName : "");
  const [form, setForm] = useState(() => splitConfig(rawConfig, modal.type));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = modal.type === "services" ? "сервис" : "закладка";

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
      const nextData =
        modal.mode === "edit"
          ? updateRawEntry(data[modal.type], modal.type, modal.groupName, modal.itemName, modal.itemMatcher, trimmedName, config)
          : addRawEntry(data[modal.type], modal.type, modal.groupName, trimmedName, config);

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
      await save(deleteRawEntry(data[modal.type], modal.type, modal.groupName, modal.itemName, modal.itemMatcher));
      onSaved(`Удалено: ${modal.itemName}`);
      onClose();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/50 p-3 sm:p-6">
      <div className="mx-auto max-w-2xl rounded-md bg-theme-50 p-4 text-theme-900 shadow-xl dark:bg-theme-800 dark:text-theme-100">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{modal.mode === "edit" ? `Изменить ${title}` : `Добавить ${title}`}</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-theme-400/60 px-3 py-2 text-sm">
            Закрыть
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Имя" value={name} onChange={setName} />
          <div className="grid gap-3 md:grid-cols-2">
            {typeFields.map(([key, label]) => (
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
          <label className="block text-xs text-theme-600 dark:text-theme-300">
            Расширенный YAML
            <textarea
              value={form.extraYaml}
              onChange={(event) => setForm((current) => ({ ...current, extraYaml: event.target.value }))}
              rows={modal.type === "services" ? 9 : 4}
              className="mt-1 w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-2 py-1 font-mono text-xs text-theme-900 shadow-sm dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
              placeholder={modal.type === "services" ? "widget:\n  type: customapi\n  url: http://example.local" : ""}
            />
          </label>
        </div>

        {error && <div className="mt-4 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</div>}

        <div className="mt-4 flex flex-wrap justify-between gap-2">
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
      </div>
    </div>
  );
}

function BackgroundModal({ settings, anchorRef, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const fileInputRef = useRef(null);
  const panelRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [backgroundValue, setBackgroundValue] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [position, setPosition] = useState(null);
  const currentBackground = typeof settings?.background === "string" ? settings.background : settings?.background?.image;

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
        body: JSON.stringify({ background: { name: nextFile.name, type: nextFile.type, dataUrl } }),
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

  useEffect(() => {
    function handlePointerDown(event) {
      if (!panelRef.current?.contains(event.target)) {
        onClose();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  useLayoutEffect(() => {
    function updatePosition() {
      const panel = panelRef.current;
      if (!panel || typeof window === "undefined") {
        return;
      }

      const margin = 12;
      const gap = 10;
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = panelRect.width || panel.offsetWidth || 416;
      const panelHeight = panelRect.height || panel.offsetHeight || 220;
      const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
      const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);
      const anchorRect = anchorRef?.current?.getBoundingClientRect?.() ?? null;

      if (!anchorRect) {
        setPosition({
          left: clamp(20, margin, maxLeft),
          top: clamp(window.innerHeight - panelHeight - 76, margin, maxTop),
        });
        return;
      }

      const preferredLeft = clamp(anchorRect.left, margin, maxLeft);
      const aboveTop = anchorRect.top - panelHeight - gap;
      const belowTop = anchorRect.bottom + gap;
      const preferredTop = aboveTop >= margin ? aboveTop : belowTop;

      setPosition({
        left: preferredLeft,
        top: clamp(preferredTop, margin, maxTop),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef]);

  const modalStyle = position
    ? {
        left: `${position.left}px`,
        top: `${position.top}px`,
      }
    : {
        left: "20px",
        bottom: "76px",
      };

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <div
        ref={panelRef}
        style={modalStyle}
        className="pointer-events-auto fixed z-[61] w-[min(26rem,calc(100vw-1.5rem))] rounded-md border border-theme-300/50 bg-theme-50/95 p-4 text-theme-900 shadow-xl backdrop-blur-sm dark:border-white/10 dark:bg-theme-800/95 dark:text-theme-100"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Фон</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-theme-400/60 px-3 py-2 text-sm">
            Закрыть
          </button>
        </div>
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
            {saving
              ? selectedFileName
                ? `Загрузка ${selectedFileName}...`
                : "Загрузка..."
              : selectedFileName || " "}
          </div>
        </div>
        {error && <div className="mt-4 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</div>}
      </div>
    </div>
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
  const title =
    modal.mode === "edit"
      ? groupType === "services"
        ? "группу сервисов"
        : "группу закладок"
      : "группу";
  const isVertical = form.style.trim() !== "row";
  const currentColumns = form.columns.trim();
  const alignRowHeights = form.alignRowHeights !== "false";
  const headerHidden = form.header === "false";

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
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/50 p-3 sm:p-6">
      <div className="mx-auto max-w-2xl rounded-md bg-theme-50 p-4 text-theme-900 shadow-xl dark:bg-theme-800 dark:text-theme-100">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{modal.mode === "edit" ? `Изменить ${title}` : `Добавить ${title}`}</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-theme-400/60 px-3 py-2 text-sm">
            Закрыть
          </button>
        </div>

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
            <Field label="Вкладка" value={form.tab} onChange={(value) => setForm((current) => ({ ...current, tab: value }))} />
            <Field
              label="Иконка"
              value={form.icon}
              onChange={(value) => setForm((current) => ({ ...current, icon: value }))}
            />
            <Field
              label="Свернута изначально"
              value={form.initiallyCollapsed}
              onChange={(value) => setForm((current) => ({ ...current, initiallyCollapsed: value }))}
            />
          </div>
          <p className="text-xs text-theme-600 dark:text-theme-300">
            Стиль: пусто или row. Заголовок и Свернута изначально: true или false.
          </p>
        </div>

        {error && <div className="mt-4 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</div>}

        <div className="mt-4 flex flex-wrap justify-between gap-2">
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
    </div>
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

function isGroupDragOver(event, fallbackPayload = null) {
  return hasDragType(event, GROUP_DRAG_TYPE) || fallbackPayload?.scope === "group" || activeDragPayload?.scope === "group";
}

function isExplicitGroupDropTarget(event) {
  return event.target instanceof Element && event.target.closest("[data-editor-group-drop-target='true']");
}

function useServiceRowHeightBalancer() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    let frame = null;

    const groupElements = () =>
      Array.from(document.querySelectorAll("[data-editor-service-group='true']"));

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

  const dropGroupToRoot = useCallback((event) => {
    const dragged = readGroupDragPayload(event, draggedGroup);
    if (!dragged) {
      return false;
    }

    event.preventDefault();
    moveGroup(dragged.type, dragged.groupName, null, "root");
    clearDragPayload();
    setDraggedGroup(null);
    return true;
  }, [draggedGroup, moveGroup, setDraggedGroup]);

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

export function useEditableItem(type, groupName, itemName, item) {
  const { editMode, moveItem, openItem } = useConfigEditor();
  const itemMatcher = useMemo(() => createItemMatcher(type, itemName, item), [item, itemName, type]);

  return {
    editMode,
    itemProps: editMode
      ? {
          draggable: true,
          onDragStart: (event) => {
            event.dataTransfer.effectAllowed = "move";
            writeDragPayload(event, { type, groupName, itemName, itemMatcher }, ITEM_DRAG_TYPE);
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
              moveItem(type, dragged.groupName, dragged.itemName, groupName, itemName, dragged.itemMatcher, itemMatcher);
            }
          },
          onClick: (event) => {
            event.preventDefault();
            openItem(type, groupName, itemName, item, itemMatcher);
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
            moveItem(type, dragged.groupName, dragged.itemName, groupName, null, dragged.itemMatcher, null);
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

  const value = useMemo(
    () => ({
      draggedGroup,
      setDraggedGroup,
      editMode,
      moveGroup: async (type, sourceName, targetName, placement = "before") => {
        if (!data || (placement !== "root" && sourceName === targetName)) {
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
            body: JSON.stringify({ file: "settings", data: layoutResult.settings }),
          });

          if (!settingsResponse.ok) {
            handleSaved(await settingsResponse.text());
            return;
          }

          setSettings(layoutResult.settings);
        }

        await refreshConfigData(mutate);
        handleSaved(
          placement === "inside" ? "Группа вложена" : placement === "root" ? "Группа перемещена в корень" : "Порядок групп сохранён",
        );
      },
      moveItem: async (type, sourceGroupName, sourceName, targetGroupName, targetName = null, sourceMatcher = null, targetMatcher = null) => {
        if (!data || !sourceGroupName || !targetGroupName) {
          return;
        }

        if (sourceGroupName === targetGroupName && sourceName === targetName) {
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
      openItem: (type, groupName, itemName, item, itemMatcher = null) => setModal({ type, groupName, itemName, item, itemMatcher, mode: "edit" }),
      openNewGroup: (type) => setModal({ type, groupName: "", layout: {}, mode: "new", scope: "group" }),
      openNewItem: (type, groupName) => setModal({ type, groupName, itemName: "", item: {}, mode: "new" }),
    }),
    [data, draggedGroup, editMode, mutate, setDraggedGroup, setSettings],
  );

  function handleSaved(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

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
            Группа
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
      {modal?.scope === "group" && modal && data && (
        <GroupModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.type !== "background" && modal?.scope !== "group" && modal && data && (
        <ItemModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
    </ConfigEditorContext.Provider>
  );
}
