import classNames from "classnames";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  "rounded-md border border-emerald-500/50 bg-emerald-600/85 px-4 py-2 text-sm font-medium text-white shadow-md shadow-theme-900/10 backdrop-blur-sm transition-colors hover:bg-emerald-500 dark:border-emerald-400/40 dark:bg-emerald-600/90 dark:shadow-theme-900/20 dark:hover:bg-emerald-500";

const JSON_DRAG_TYPE = "application/json";
const GROUP_DRAG_TYPE = "application/x-homepage-browser-editor-group";
const ITEM_DRAG_TYPE = "application/x-homepage-browser-editor-item";

let activeDragPayload = null;

const serviceFields = [
  ["href", "URL"],
  ["icon", "Icon"],
  ["description", "Description"],
  ["abbr", "Abbr"],
  ["target", "Target"],
  ["weight", "Weight"],
  ["ping", "Ping"],
  ["siteMonitor", "Site monitor"],
  ["showStats", "Show stats"],
  ["proxmoxNode", "Proxmox node"],
  ["proxmoxVMID", "Proxmox VMID"],
  ["proxmoxType", "Proxmox type"],
];

const bookmarkFields = [
  ["href", "URL"],
  ["icon", "Icon"],
  ["description", "Description"],
  ["abbr", "Abbr"],
  ["target", "Target"],
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
      throw new Error("Advanced YAML must be an object");
    }
    Object.assign(config, parsed);
  }

  return config;
}

function getEntryName(entry) {
  return Object.keys(entry)[0];
}

function getEntryValue(entry) {
  return entry[getEntryName(entry)];
}

function findRawEntry(rawGroups, groupName, itemName) {
  const findInEntries = (entries = [], currentGroup) => {
    for (const entry of entries) {
      const name = getEntryName(entry);
      const value = entry[name];

      if (currentGroup === groupName && name === itemName && !Array.isArray(value)) {
        return value;
      }

      if (Array.isArray(value)) {
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

function updateRawEntry(rawGroups, groupName, originalName, nextName, nextConfig) {
  let changed = false;

  const updateEntries = (entries = [], currentGroup) =>
    entries.map((entry) => {
      const name = getEntryName(entry);
      const value = entry[name];

      if (currentGroup === groupName && name === originalName && !Array.isArray(value)) {
        changed = true;
        return { [nextName]: nextConfig };
      }

      if (Array.isArray(value)) {
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
    return addRawEntry(nextGroups, groupName, nextName, nextConfig);
  }

  return nextGroups;
}

function addRawEntry(rawGroups, groupName, itemName, itemConfig) {
  let added = false;

  const addToEntries = (entries = [], currentGroup) => {
    if (currentGroup === groupName) {
      added = true;
      return [...entries, { [itemName]: itemConfig }];
    }

    return entries.map((entry) => {
      const name = getEntryName(entry);
      const value = entry[name];
      return Array.isArray(value) ? { [name]: addToEntries(value, name) } : entry;
    });
  };

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    return { [name]: addToEntries(group[name], name) };
  });

  if (added) return nextGroups;
  return [...nextGroups, { [groupName]: [{ [itemName]: itemConfig }] }];
}

function addRawGroup(rawGroups, groupName, type) {
  if ((rawGroups ?? []).some((group) => getEntryName(group) === groupName)) {
    throw new Error("Group already exists");
  }

  if (type === "services") {
    return [...(rawGroups ?? []), { [groupName]: [{ "New service": { href: "#", weight: 100 } }] }];
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

function deleteRawEntry(rawGroups, groupName, itemName) {
  const filterEntries = (entries = [], currentGroup) =>
    entries
      .filter((entry) => {
        const name = getEntryName(entry);
        const value = entry[name];
        return Array.isArray(value) || currentGroup !== groupName || name !== itemName;
      })
      .map((entry) => {
        const name = getEntryName(entry);
        const value = entry[name];
        return Array.isArray(value) ? { [name]: filterEntries(value, name) } : entry;
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

function reorderRawEntry(rawGroups, type, groupName, sourceName, targetName) {
  let moved = false;

  const reorderEntries = (entries = [], currentGroup) => {
    if (currentGroup !== groupName) {
      return entries.map((entry) => {
        const name = getEntryName(entry);
        const value = entry[name];
        return Array.isArray(value) ? { [name]: reorderEntries(value, name) } : entry;
      });
    }

    const sourceIndex = entries.findIndex((entry) => getEntryName(entry) === sourceName && !Array.isArray(getEntryValue(entry)));
    if (sourceIndex < 0) {
      return entries;
    }

    const nextEntries = [...entries];
    const [sourceEntry] = nextEntries.splice(sourceIndex, 1);
    const targetIndex =
      targetName === null
        ? nextEntries.length
        : nextEntries.findIndex((entry) => getEntryName(entry) === targetName && !Array.isArray(getEntryValue(entry)));

    if (targetIndex < 0) {
      return entries;
    }

    nextEntries.splice(targetIndex, 0, sourceEntry);
    moved = true;

    return type === "services" ? resetServiceWeights(nextEntries) : nextEntries;
  };

  const nextGroups = (rawGroups ?? []).map((group) => {
    const name = getEntryName(group);
    return { [name]: reorderEntries(group[name], name) };
  });

  return { moved, nextGroups };
}

function groupLayoutToForm(layout) {
  return {
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
    modal.mode === "edit" ? findRawEntry(data?.[modal.type], modal.groupName, modal.itemName) ?? modal.item : {};
  const [name, setName] = useState(modal.mode === "edit" ? modal.itemName : "");
  const [form, setForm] = useState(() => splitConfig(rawConfig, modal.type));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = modal.type === "services" ? "service" : "bookmark";

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
        throw new Error("Name is required");
      }

      const config = formToConfig(form);
      const nextData =
        modal.mode === "edit"
          ? updateRawEntry(data[modal.type], modal.groupName, modal.itemName, trimmedName, config)
          : addRawEntry(data[modal.type], modal.groupName, trimmedName, config);

      await save(nextData);
      onSaved(`${trimmedName} saved`);
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
      await save(deleteRawEntry(data[modal.type], modal.groupName, modal.itemName));
      onSaved(`${modal.itemName} deleted`);
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
          <h2 className="text-lg font-semibold">{modal.mode === "edit" ? `Edit ${title}` : `Add ${title}`}</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-theme-400/60 px-3 py-2 text-sm">
            Close
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} />
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
            Advanced YAML
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
                Delete
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BackgroundModal({ settings, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const currentBackground = typeof settings?.background === "string" ? settings.background : settings?.background?.image;

  async function save() {
    if (!file) return;

    setSaving(true);
    setError("");

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/config/editor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background: { name: file.name, type: file.type, dataUrl } }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await refreshConfigData(mutate, ["/api/config/editor"]);
      onSaved("Background saved");
      window.location.reload();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/50 p-3 sm:p-6">
      <div className="mx-auto max-w-xl rounded-md bg-theme-50 p-4 text-theme-900 shadow-xl dark:bg-theme-800 dark:text-theme-100">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Background</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-theme-400/60 px-3 py-2 text-sm">
            Close
          </button>
        </div>
        {currentBackground && (
          <div className="mb-3 text-sm text-theme-700 dark:text-theme-200">
            Current: <span className="font-mono">{currentBackground}</span>
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block w-full rounded-md border border-theme-300/50 bg-theme-50/90 px-3 py-2 text-sm text-theme-900 dark:border-white/10 dark:bg-theme-900/90 dark:text-theme-100"
        />
        {error && <div className="mt-4 rounded-md bg-rose-100 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={!file || saving}
            className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
          >
            {saving ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupModal({ modal, data, onClose, onSaved }) {
  const { mutate } = useSWRConfig();
  const { setSettings } = useContext(SettingsContext);
  const [name, setName] = useState(modal.mode === "edit" ? modal.groupName : "");
  const [form, setForm] = useState(() => groupLayoutToForm(modal.layout));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = modal.type === "services" ? "service group" : "bookmark group";

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
        throw new Error("Group name is required");
      }

      let nextGroups;
      const nextLayout = formToGroupLayout(form);
      let nextSettings;

      if (mode === "delete") {
        nextGroups = deleteRawGroup(data[modal.type], modal.groupName);
        nextSettings = updateSettingsLayout(data.settings, modal.groupName, modal.groupName, {}, "delete");
      } else if (modal.mode === "new") {
        nextGroups = addRawGroup(data[modal.type], trimmedName, modal.type);
        nextSettings = updateSettingsLayout(data.settings, trimmedName, trimmedName, nextLayout, "save");
      } else {
        nextGroups = renameRawGroup(data[modal.type], modal.groupName, trimmedName);
        nextSettings = updateSettingsLayout(data.settings, modal.groupName, trimmedName, nextLayout, "save");
      }

      await putConfig(modal.type, nextGroups);
      await putConfig("settings", nextSettings);
      setSettings(nextSettings);
      await refreshConfigData(mutate);
      onSaved(mode === "delete" ? "Group deleted" : "Group saved");
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
          <h2 className="text-lg font-semibold">{modal.mode === "edit" ? `Edit ${title}` : `Add ${title}`}</h2>
          <button type="button" onClick={onClose} className="rounded-md border border-theme-400/60 px-3 py-2 text-sm">
            Close
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Group name" value={name} onChange={setName} />
          <div className="rounded-md border border-theme-300/50 p-3 dark:border-white/10">
            <div className="mb-2 text-xs font-semibold text-theme-700 dark:text-theme-200">Quick layout</div>
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
                className="rounded-md border border-theme-400/60 px-3 py-2 text-sm"
              >
                Vertical
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
                className="rounded-md border border-theme-400/60 px-3 py-2 text-sm"
              >
                Horizontal
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
                  className="rounded-md border border-theme-400/60 px-3 py-2 text-sm"
                >
                  {columns} columns
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
                className="rounded-md border border-theme-400/60 px-3 py-2 text-sm"
              >
                Toggle header
              </button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Style"
              value={form.style}
              onChange={(value) => setForm((current) => ({ ...current, style: value }))}
            />
            <Field
              label="Columns"
              value={form.columns}
              onChange={(value) => setForm((current) => ({ ...current, columns: value }))}
            />
            <Field
              label="Header"
              value={form.header}
              onChange={(value) => setForm((current) => ({ ...current, header: value }))}
            />
            <Field label="Tab" value={form.tab} onChange={(value) => setForm((current) => ({ ...current, tab: value }))} />
            <Field
              label="Icon"
              value={form.icon}
              onChange={(value) => setForm((current) => ({ ...current, icon: value }))}
            />
            <Field
              label="Initially collapsed"
              value={form.initiallyCollapsed}
              onChange={(value) => setForm((current) => ({ ...current, initiallyCollapsed: value }))}
            />
          </div>
          <p className="text-xs text-theme-600 dark:text-theme-300">
            Style: empty or row. Header and Initially collapsed: true or false.
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
                Delete group
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => saveGroup()}
            disabled={saving}
            className="rounded-md bg-theme-700 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-theme-200 dark:text-theme-900"
          >
            {saving ? "Saving..." : "Save"}
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

export function EditorGroupToolbar({ type, groupName, layout, allowInside = false }) {
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
      data-editor-group-drop-target="true"
      className="relative z-[61] mb-2 flex cursor-move items-center justify-between gap-2 rounded-md border border-emerald-400/50 bg-emerald-500/10 px-2 py-1 text-xs text-theme-800 dark:text-theme-100"
    >
      <span className="truncate font-medium">{groupName}</span>
      <div className="flex shrink-0 gap-1">
        {allowInside && (
          <button
            type="button"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const dragged = readGroupDragPayload(event);
              if (dragged?.scope === "group" && dragged.type === type) {
                moveGroup(type, dragged.groupName, groupName, "inside");
              }
            }}
            data-editor-group-drop-target="true"
            className="rounded-md border border-emerald-500/70 px-2 py-1 text-xs"
          >
            Drop inside
          </button>
        )}
        <button
          type="button"
          onClick={() => openGroup(type, groupName, layout)}
          className="rounded-md bg-emerald-700 px-2 py-1 text-xs text-white"
        >
          Layout
        </button>
      </div>
    </div>
  );
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
            className="fixed left-4 right-4 top-4 z-[80] flex min-h-16 items-center justify-center rounded-md border border-dashed border-emerald-400/70 bg-theme-50/90 px-3 py-3 text-sm font-medium text-theme-800 shadow-lg backdrop-blur-sm dark:bg-theme-900/85 dark:text-theme-100"
          >
            Drop here to move group to root
          </div>
          <div className="pointer-events-none fixed bottom-4 left-1/2 z-[50] -translate-x-1/2 rounded-md border border-dashed border-emerald-400/40 bg-theme-50/80 px-3 py-2 text-xs text-theme-700/90 shadow-md backdrop-blur-sm dark:bg-theme-900/70 dark:text-theme-100/90">
            Drop into empty space to move the group to root
          </div>
        </>
      )}
    </div>
  );
}

export function useEditableItem(type, groupName, itemName, item) {
  const { editMode, moveItem, openItem } = useConfigEditor();

  return {
    editMode,
    itemProps: editMode
      ? {
          draggable: true,
          onDragStart: (event) => {
            event.dataTransfer.effectAllowed = "move";
            writeDragPayload(event, { type, groupName, itemName }, ITEM_DRAG_TYPE);
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
            if (dragged?.type === type && dragged.groupName === groupName) {
              moveItem(type, groupName, dragged.itemName, itemName);
            }
          },
          onClick: (event) => {
            event.preventDefault();
            openItem(type, groupName, itemName, item);
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
          if (dragged?.type === type && dragged.groupName === groupName) {
            moveItem(type, groupName, dragged.itemName, null);
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
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState("");
  const { data } = useSWR(enabled && (editMode || modal) ? "/api/config/editor" : null);

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
          handleSaved("Group cannot be moved there");
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
          placement === "inside" ? "Group nested" : placement === "root" ? "Group moved to root" : "Group order saved",
        );
      },
      moveItem: async (type, groupName, sourceName, targetName = null) => {
        if (!data || sourceName === targetName) {
          return;
        }

        const { moved, nextGroups } = reorderRawEntry(data[type], type, groupName, sourceName, targetName);
        if (!moved) {
          handleSaved("Only configured YAML items can be reordered");
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
        handleSaved("Order saved");
      },
      openGroup: (type, groupName, layout) => setModal({ type, groupName, layout, mode: "edit", scope: "group" }),
      openItem: (type, groupName, itemName, item) => setModal({ type, groupName, itemName, item, mode: "edit" }),
      openNewGroup: (type) => setModal({ type, groupName: "", layout: {}, mode: "new", scope: "group" }),
      openNewItem: (type, groupName) => setModal({ type, groupName, itemName: "", item: {}, mode: "new" }),
    }),
    [data, draggedGroup, editMode, mutate, setDraggedGroup, setSettings],
  );

  function handleSaved(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  if (!enabled) {
    return <ConfigEditorContext.Provider value={noopEditorContext}>{children}</ConfigEditorContext.Provider>;
  }

  return (
    <ConfigEditorContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 left-5 z-50 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEditMode((current) => !current)}
          className={classNames(
            editMode ? toolbarPrimaryButtonClassName : toolbarButtonClassName,
          )}
        >
          {editMode ? "Done" : "Edit"}
        </button>
        {editMode && (
          <button
            type="button"
            onClick={() => setModal({ type: "background" })}
            className={toolbarButtonClassName}
          >
            Background
          </button>
        )}
        {editMode && (
          <>
            <button
              type="button"
              onClick={() => value.openNewGroup("services")}
              className={toolbarButtonClassName}
            >
              Service group
            </button>
            <button
              type="button"
              onClick={() => value.openNewGroup("bookmarks")}
              className={toolbarButtonClassName}
            >
              Bookmark group
            </button>
          </>
        )}
      </div>
      {notice && (
        <div className="fixed bottom-20 left-5 z-50 rounded-md border border-emerald-500/30 bg-emerald-100/90 px-3 py-2 text-sm text-emerald-800 shadow-md shadow-theme-900/10 backdrop-blur-sm dark:bg-emerald-950/90 dark:text-emerald-200 dark:shadow-theme-900/20">
          {notice}
        </div>
      )}
      {modal?.type === "background" && <BackgroundModal settings={data?.settings} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.scope === "group" && modal && data && (
        <GroupModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.type !== "background" && modal?.scope !== "group" && modal && data && (
        <ItemModal modal={modal} data={data} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
    </ConfigEditorContext.Provider>
  );
}
