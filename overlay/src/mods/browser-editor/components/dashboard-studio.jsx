import classNames from "classnames";
import ResolvedIcon from "components/resolvedicon";
import yaml from "js-yaml";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { editorWriteFetch } from "mods/browser-editor/client/editor-fetch";
import {
  cardBackgroundStyle,
  normalizeCardBackgroundPosition,
} from "mods/browser-editor/lib/card-background";
import {
  normalizeServiceUpdateConfig,
  serializeServiceUpdateConfig,
  serviceUpdateTypes,
} from "mods/browser-editor/lib/service-update-config";
import {
  buildThreeXuiWidget,
  defaultThreeXuiMetricKeys,
  isThreeXuiWidget,
  threeXuiMetricDefinitions,
  threeXuiMetricKeysFromWidget,
  threeXuiSourceFromWidget,
  threeXuiSourcePattern,
} from "mods/browser-editor/lib/three-x-ui-config";
import { orderStudioItems } from "mods/browser-editor/lib/studio-order";
import {
  studioPageRecords,
  studioPageStyleAlignments,
  studioPageStyleBorders,
  studioPageStyleDraft,
  studioPageStyleFonts,
  studioPageStyleFontSizes,
  studioServiceStatusOffsetMax,
  studioServiceStatusOffsetMin,
} from "mods/browser-editor/lib/studio-pages";
import { CodeEditor } from "./editor";

const cardColors = [
  ["color-sky", "#25c1ff"],
  ["color-yellow", "#ffc230"],
  ["color-green", "#00c655"],
  ["color-red-orange", "#ff3d00"],
  ["color-purple", "#aa5cc3"],
  ["color-lime", "#39ba5d"],
  ["color-emerald", "#4ade80"],
  ["color-cyan", "#22d3ee"],
  ["color-blue", "#3eadff"],
  ["color-mint", "#61efad"],
  ["color-orange", "#ff7b00"],
  ["color-bright-green", "#33cc33"],
  ["color-dark-red", "#96060c"],
  ["color-red", "#ea2222"],
  ["color-teal", "#3fb1db"],
  ["color-amber", "#ff7700"],
  ["color-indigo", "#2a2978"],
];

function StudioYamlEditor({ value, onChange }) {
  return (
    <CodeEditor
      aria-label="YAML виджета"
      label={null}
      value={value}
      onChange={onChange}
      language="yaml"
      showToolbar={false}
      minHeightClassName="h-[18rem] min-h-[18rem]"
      zoomStorageKey="homepage-studio-widget-yaml-zoom"
      placeholder="widget:\n  type: customapi"
    />
  );
}

const monochromeThemeColors = {
  "--color-50": "250 250 250",
  "--color-100": "244 244 245",
  "--color-200": "228 228 231",
  "--color-300": "212 212 216",
  "--color-400": "161 161 170",
  "--color-500": "113 113 122",
  "--color-600": "82 82 91",
  "--color-700": "63 63 70",
  "--color-800": "39 39 42",
  "--color-900": "24 24 27",
};

const STUDIO_SCHEME_STORAGE_KEY = "homepage-dashboard-studio-scheme";
const STUDIO_STYLE_STORAGE_KEY = "homepage-dashboard-studio-style";
const STUDIO_WINDOW_STORAGE_KEY = "homepage-dashboard-studio-window";
const studioColorSchemes = [
  {
    id: "ocean",
    label: "Океан",
    description: "Холодный синий с бирюзовым свечением",
    colors: ["#081c2b", "#0d2b40", "#38bdf8", "#e0f2fe", "#93c5fd"],
    activeText: "#07131c",
    effect: "glow",
    effectColorB: "#0ea5e9",
  },
  {
    id: "emerald",
    label: "Изумруд",
    description: "Спокойный зелёный для долгой работы",
    colors: ["#071f1b", "#0d332b", "#34d399", "#ecfdf5", "#86efac"],
    activeText: "#06251d",
    effect: "glow",
    effectColorB: "#10b981",
  },
  {
    id: "violet",
    label: "Аметист",
    description: "Фиолетовый акцент без кислотной яркости",
    colors: ["#160d2b", "#241342", "#a78bfa", "#f5f3ff", "#c4b5fd"],
    activeText: "#160d2b",
    effect: "gradient",
    effectColorB: "#7c3aed",
  },
  {
    id: "sunset",
    label: "Закат",
    description: "Тёплый янтарный на тёмном шоколадном фоне",
    colors: ["#2a130d", "#3b1c12", "#fb923c", "#fff7ed", "#fdba74"],
    activeText: "#2a130d",
    effect: "gradient",
    effectColorB: "#ea580c",
  },
  {
    id: "rose",
    label: "Роза",
    description: "Мягкий кораллово-розовый контраст",
    colors: ["#280d1c", "#3f142a", "#fb7185", "#fff1f2", "#fda4af"],
    activeText: "#280d1c",
    effect: "glow",
    effectColorB: "#e11d48",
  },
  {
    id: "aurora",
    label: "Северное сияние",
    description: "Бирюзовый и лаймовый на ночном фоне",
    colors: ["#071b24", "#0d3037", "#2dd4bf", "#ecfeff", "#99f6e4"],
    activeText: "#06211f",
    effect: "gradient",
    effectColorB: "#84cc16",
  },
];

function paletteFromScheme(scheme) {
  return {
    accent: scheme.colors[2],
    activeText: scheme.activeText ?? "#09090b",
    background: scheme.colors[0],
    effect: scheme.effect ?? "glow",
    effectColorA: scheme.colors[2],
    effectColorB: scheme.effectColorB ?? scheme.colors[1],
    effectStrength: 16,
    mutedText: scheme.colors[4],
    panel: scheme.colors[1],
    text: scheme.colors[3],
  };
}

function readStudioStyle() {
  const fallbackScheme = studioColorSchemes[0];
  if (typeof window === "undefined") {
    return {
      schemeId: fallbackScheme.id,
      palette: paletteFromScheme(fallbackScheme),
    };
  }

  const storedSchemeId = window.localStorage.getItem(STUDIO_SCHEME_STORAGE_KEY);
  const storedScheme = studioColorSchemes.find(
    (candidate) => candidate.id === storedSchemeId,
  );
  const scheme = storedScheme ?? fallbackScheme;
  try {
    const storedPalette = JSON.parse(
      window.localStorage.getItem(STUDIO_STYLE_STORAGE_KEY) ?? "null",
    );
    return {
      schemeId: scheme.id,
      palette: {
        ...paletteFromScheme(scheme),
        ...(storedScheme && storedPalette && typeof storedPalette === "object"
          ? storedPalette
          : {}),
      },
    };
  } catch {
    return { schemeId: scheme.id, palette: paletteFromScheme(scheme) };
  }
}

function clampStudioWindowGeometry(value = {}) {
  const viewportWidth =
    typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 900 : window.innerHeight;
  const maxWidth = Math.max(320, viewportWidth - 16);
  const maxHeight = Math.max(320, viewportHeight - 16);
  const minWidth = Math.min(760, maxWidth);
  const minHeight = Math.min(520, maxHeight);
  const candidateWidth = Number(value.width);
  const candidateHeight = Number(value.height);
  const width = Math.min(
    maxWidth,
    Math.max(minWidth, Number.isFinite(candidateWidth) ? candidateWidth : 1420),
  );
  const height = Math.min(
    maxHeight,
    Math.max(
      minHeight,
      Number.isFinite(candidateHeight) ? candidateHeight : 860,
    ),
  );
  const fallbackX = Math.max(8, Math.round((viewportWidth - width) / 2));
  const fallbackY = Math.max(8, Math.round((viewportHeight - height) / 2));
  const candidateX = Number(value.x);
  const candidateY = Number(value.y);
  const maxX = Math.max(8, viewportWidth - width - 8);
  const maxY = Math.max(8, viewportHeight - height - 8);

  return {
    height: Math.round(height),
    width: Math.round(width),
    x: Math.round(
      Math.min(
        maxX,
        Math.max(8, Number.isFinite(candidateX) ? candidateX : fallbackX),
      ),
    ),
    y: Math.round(
      Math.min(
        maxY,
        Math.max(8, Number.isFinite(candidateY) ? candidateY : fallbackY),
      ),
    ),
  };
}

function readStoredStudioWindowGeometry() {
  if (typeof window === "undefined") {
    return clampStudioWindowGeometry();
  }

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STUDIO_WINDOW_STORAGE_KEY) ?? "null",
    );
    return clampStudioWindowGeometry(
      stored && typeof stored === "object" ? stored : {},
    );
  } catch {
    return clampStudioWindowGeometry();
  }
}

function withAlpha(hex, opacity) {
  const normalized = String(hex ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return "transparent";
  const value = Number.parseInt(normalized.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

function studioEffectBackground(palette) {
  const strength =
    Math.max(0, Math.min(100, Number(palette.effectStrength) || 0)) / 100;
  if (palette.effect === "gradient") {
    return `linear-gradient(135deg, ${withAlpha(palette.effectColorA, strength)}, ${withAlpha(palette.effectColorB, strength)})`;
  }
  if (palette.effect === "glow") {
    return [
      `radial-gradient(circle at 8% 0%, ${withAlpha(palette.effectColorA, strength)}, transparent 38%)`,
      `radial-gradient(circle at 95% 100%, ${withAlpha(palette.effectColorB, strength)}, transparent 42%)`,
    ].join(", ");
  }
  return "none";
}

const widgetMetricPresets = {
  authentik: ["Пользователи", "Входы", "Ошибки"],
  customapi: ["Показатель 1", "Показатель 2", "Показатель 3"],
  glances: ["CPU", "Память", "Диск"],
  homeassistant: ["Состояние", "Устройства", "Автоматизации"],
  immich: ["Фото", "Видео", "Пользователи"],
  jellyfin: ["Фильмы", "Сериалы", "Сейчас смотрят"],
  prowlarr: ["Запросы", "Индексаторы", "Ошибки"],
  qbittorrent: ["Скорость", "Загрузки", "Раздачи"],
  radarr: ["Фильмы", "Очередь", "Не хватает"],
  seerr: ["Запросы", "Одобрено", "Ожидает"],
  sonarr: ["Сериалы", "Очередь", "Не хватает"],
  traefik: ["Маршруты", "Сервисы", "Ошибки"],
};

const widgetFieldLabels = {
  activeUser: "Активные пользователи",
  alerts: "Предупреждения",
  download: "Скорость загрузки",
  episodes: "Эпизоды",
  leech: "Загружается",
  missing: "Отсутствует",
  movies: "Фильмы",
  numberOfFailGrabs: "Ошибки загрузок",
  numberOfFailQueries: "Ошибки запросов",
  numberOfGrabs: "Загрузки",
  numberOfQueries: "Запросы",
  photos: "Фотографии",
  queued: "В очереди",
  seed: "Раздаётся",
  series: "Сериалы",
  songs: "Музыка",
  storage: "Хранилище",
  upload: "Скорость отдачи",
  users: "Пользователи",
  videos: "Видео",
  wanted: "Требуется",
};

const navItems = [
  ["overview", "Обзор", "⌂"],
  ["pages", "Страницы", "▤"],
  ["services", "Сервисы", "▦"],
  ["widgets", "Виджеты", "◫"],
  ["bookmarks", "Закладки", "↗"],
  ["appearance", "Оформление", "✦"],
];

function rawGroups(raw, type) {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry, groupIndex) =>
    Object.entries(entry ?? {}).map(([groupName, rawItems]) => {
      const parsedItems = Array.isArray(rawItems)
        ? rawItems.flatMap((rawItem, itemIndex) =>
            Object.entries(rawItem ?? {}).map(([name, config]) => ({
              config:
                type === "bookmarks" &&
                Array.isArray(config) &&
                config[0] &&
                typeof config[0] === "object"
                  ? config[0]
                  : config &&
                      typeof config === "object" &&
                      !Array.isArray(config)
                    ? config
                    : {},
              groupName,
              itemIndex,
              key: `${type}:${groupIndex}:${itemIndex}:${name}`,
              name,
              type,
            })),
          )
        : [];
      const items = orderStudioItems(parsedItems, type);
      return {
        groupIndex,
        key: `${type}:${groupIndex}:${groupName}`,
        name: groupName,
        items,
        type,
      };
    }),
  );
}

function parseTopWidgets(tabs) {
  const content =
    tabs?.find((tab) => tab.fileName === "widgets.yaml")?.content ?? "";
  try {
    const parsed = yaml.load(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry, index) =>
      Object.entries(entry ?? {})
        .slice(0, 1)
        .map(([type, config]) => ({
          config:
            config && typeof config === "object" && !Array.isArray(config)
              ? config
              : {},
          index,
          key: `top-widget:${index}:${type}`,
          name: config?.label || type,
          type,
          widget: { type, ...(config ?? {}) },
        })),
    );
  } catch {
    return [];
  }
}

function cardAccent(config) {
  const id = String(config?.id ?? "");
  return cardColors.find(([prefix]) => id.startsWith(`${prefix}-`))?.[1] ?? "";
}

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

function groupLayoutFromSettings(settings, type, groupName) {
  const layout = settings?.layout ?? {};
  if (type === "bookmarks") {
    return (
      Object.entries(layout.Bookmarks ?? {}).find(([name]) =>
        namesEqual(name, groupName),
      )?.[1] ?? {}
    );
  }

  const findNestedLayout = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    for (const [name, value] of Object.entries(node)) {
      if (namesEqual(name, groupName)) return value ?? {};
      const nested = findNestedLayout(value);
      if (nested) return nested;
    }
    return null;
  };

  return findNestedLayout(layout) ?? {};
}

function layoutTabs(settings) {
  const tabs = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (typeof node.tab === "string" && node.tab.trim()) {
      tabs.add(node.tab.trim());
    }
    Object.values(node).forEach(visit);
  };
  visit(settings?.layout);
  return [...tabs].sort((left, right) => left.localeCompare(right, "ru"));
}

function slugifyCardName(value) {
  const slug = String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "bookmark";
}

function cardColorId(currentId, itemName, colorPrefix) {
  const normalizedId = String(currentId ?? "").trim();
  const currentPrefix = cardColors.find(([prefix]) =>
    normalizedId.startsWith(`${prefix}-`),
  )?.[0];
  const baseId = currentPrefix
    ? normalizedId.slice(currentPrefix.length + 1)
    : normalizedId || slugifyCardName(itemName);
  return colorPrefix ? `${colorPrefix}-${baseId}` : baseId;
}

function widgetFromItem(item) {
  const widget = item?.config?.widget;
  return widget && typeof widget === "object" && !Array.isArray(widget)
    ? widget
    : null;
}

function humanizeWidgetKey(value) {
  const key =
    String(value ?? "")
      .split(".")
      .pop() ?? "";
  if (widgetFieldLabels[key]) return widgetFieldLabels[key];
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-zа-я])([A-ZА-Я])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function metricDefinitions(widget, catalog = null) {
  if (!widget) return [];
  if (Array.isArray(widget.mappings) && widget.mappings.length) {
    return widget.mappings.slice(0, 4).map((mapping) => ({
      label: mapping?.label || mapping?.field || "Показатель",
      value:
        mapping?.field === "xrayState"
          ? "Работает"
          : mapping?.format === "bytes"
            ? "— GB"
            : "—",
    }));
  }
  const availableFields = Array.isArray(catalog?.fields) ? catalog.fields : [];
  const selectedFields =
    Array.isArray(widget.fields) && widget.fields.length
      ? widget.fields
      : availableFields;
  if (selectedFields.length) {
    return selectedFields.slice(0, 4).map((field) => ({
      label: humanizeWidgetKey(field),
      value: "—",
    }));
  }
  return (
    widgetMetricPresets[widget.type] ?? [
      "Состояние",
      "Показатель",
      "Активность",
    ]
  )
    .slice(0, 4)
    .map((label) => ({ label, value: "—" }));
}

function itemMatches(item, search) {
  if (!search) return true;
  const widget = widgetFromItem(item);
  return `${item.name} ${item.groupName} ${item.config?.description ?? ""} ${widget?.type ?? ""}`
    .toLowerCase()
    .includes(search.toLowerCase());
}

function StudioNavButton({ active, badge, icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={
        active
          ? {
              backgroundColor: "var(--studio-accent)",
              color: "var(--studio-active-text)",
            }
          : undefined
      }
      className={classNames(
        "flex shrink-0 items-center gap-2 rounded-xl px-2 py-2 text-left text-xs transition-all min-[460px]:px-2.5 sm:px-3",
        active
          ? "shadow-md shadow-black/30"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white",
      )}
    >
      <span
        className={classNames(
          "flex h-6 w-6 items-center justify-center rounded-md text-xs",
          active
            ? "bg-black/10"
            : "bg-zinc-200/70 text-zinc-600 dark:bg-white/5 dark:text-zinc-300",
        )}
      >
        {icon}
      </span>
      <span className="hidden font-medium min-[460px]:inline">{label}</span>
      {badge !== undefined && (
        <span
          className={classNames(
            "hidden rounded-full px-2 py-0.5 text-[10px] tabular-nums sm:inline-flex",
            active
              ? "bg-black/10"
              : "bg-zinc-200/80 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function ServiceIcon({ config, name, onClick = null, size = 38 }) {
  const Root = onClick ? "button" : "div";
  return (
    <Root
      type={onClick ? "button" : undefined}
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation();
              onClick();
            }
          : undefined
      }
      aria-label={onClick ? `Выбрать иконку для ${name}` : undefined}
      title={onClick ? "Выбрать или найти иконку" : undefined}
      className="flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/10 shadow-sm dark:bg-white/5"
      style={{ height: size + 14, width: size + 14 }}
    >
      {config?.icon ? (
        <ResolvedIcon
          icon={String(config.icon)}
          width={size}
          height={size}
          alt=""
        />
      ) : (
        <span className="text-lg font-bold text-zinc-500">
          {String(name || "?")
            .slice(0, 1)
            .toUpperCase()}
        </span>
      )}
    </Root>
  );
}

function ServiceCardPreview({
  item,
  large = false,
  onIconClick = null,
  widgetCatalog = null,
}) {
  const config = item?.config ?? {};
  const widget = widgetFromItem(item);
  const metrics = metricDefinitions(widget, widgetCatalog);
  const accent = cardAccent(config);
  const backgroundStyle = cardBackgroundStyle(
    config.cardBackground,
    config.cardBackgroundPosition,
  );

  if (!item) {
    return (
      <div className="flex min-h-52 items-center justify-center rounded-2xl border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-white/15">
        Выберите карточку для предпросмотра
      </div>
    );
  }

  return (
    <div
      data-studio-card-preview="true"
      className={classNames(
        "relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/90 shadow-[0_20px_60px_-35px_rgba(0,0,0,0.65)] dark:border-white/10 dark:bg-zinc-900/90",
        large ? "min-h-64 p-5" : "min-h-40 p-4",
      )}
      style={
        backgroundStyle ??
        (accent
          ? {
              backgroundImage: `linear-gradient(135deg, ${accent}2b, transparent 58%)`,
            }
          : undefined)
      }
    >
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: accent || "rgba(113,113,122,.3)" }}
      />
      <div className="flex min-w-0 items-start gap-3">
        <ServiceIcon
          config={config}
          name={item.name}
          onClick={onIconClick}
          size={large ? 44 : 32}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div
                className={classNames(
                  "truncate font-semibold text-zinc-950 dark:text-white",
                  large ? "text-lg" : "text-sm",
                )}
                style={{
                  color: config.titleColor || undefined,
                  fontFamily: config.titleFont || undefined,
                  fontSize: config.titleSize || undefined,
                  textAlign: config.titleAlign || undefined,
                }}
              >
                {item.name}
              </div>
              <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                {config.description || item.groupName}
              </div>
            </div>
            {config.serviceUpdate && (
              <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
                Updater
              </span>
            )}
          </div>
        </div>
      </div>

      {widget ? (
        <div
          className={classNames(
            "mt-5 grid gap-2",
            metrics.length === 4 ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          {metrics.map((metric, index) => (
            <div
              key={`${metric.label}-${index}`}
              className="min-w-0 rounded-xl border border-zinc-200/70 bg-zinc-50/80 px-2.5 py-2 dark:border-white/10 dark:bg-white/5"
            >
              <div className="truncate text-[9px] uppercase tracking-wide text-zinc-400">
                {metric.label}
              </div>
              <div className="mt-1 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                {metric.value}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 flex items-center justify-between rounded-xl border border-dashed border-zinc-200 px-3 py-3 text-xs text-zinc-400 dark:border-white/10">
          <span>Карточка без виджета</span>
          <span>Добавить данные →</span>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  active,
  item,
  onClick,
  onIconClick,
  onDropItem,
  onDragItem,
}) {
  const widget = widgetFromItem(item);
  return (
    <div
      draggable={Boolean(onDragItem)}
      onDragStart={(event) => onDragItem?.(event, item)}
      onDragOver={(event) => onDropItem && event.preventDefault()}
      onDrop={(event) => onDropItem?.(event, item)}
      style={
        active
          ? {
              backgroundColor:
                "color-mix(in srgb, var(--studio-accent) 14%, transparent)",
              borderColor: "var(--studio-accent)",
            }
          : undefined
      }
      className={classNames(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
        active
          ? "shadow-sm"
          : "border-transparent hover:border-zinc-200 hover:bg-white/70 dark:hover:border-white/10 dark:hover:bg-white/5",
      )}
    >
      <ServiceIcon
        config={item.config}
        name={item.name}
        onClick={onIconClick}
        size={24}
      />
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {item.name}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400">
            <span className="truncate">{item.groupName}</span>
            {widget && (
              <>
                <span>·</span>
                <span className="truncate">{widget.type}</span>
              </>
            )}
          </div>
        </div>
        <span className="text-zinc-300 dark:text-zinc-600">›</span>
      </button>
    </div>
  );
}

const inspectorInputClass =
  "mt-1 w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-100 outline-none transition focus:border-white/30";

function InspectorField({
  label,
  value,
  onChange,
  placeholder = "",
  type = "text",
}) {
  return (
    <label className="block text-[10px] text-zinc-400">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={inspectorInputClass}
      />
    </label>
  );
}

const cardBackgroundPositionPresets = [
  ["Слева", "0% 50%"],
  ["Центр", "50% 50%"],
  ["Справа", "100% 50%"],
];

function CardBackgroundControl({
  onChange,
  onChooseImage,
  onPositionChange,
  position,
  value,
}) {
  const normalizedPosition =
    normalizeCardBackgroundPosition(position) || "50% 50%";
  const horizontal = Number.parseFloat(normalizedPosition);
  const previewStyle = cardBackgroundStyle(value, normalizedPosition);
  const nudgePosition = (delta) => {
    const nextHorizontal = Math.min(100, Math.max(0, horizontal + delta));
    onPositionChange(`${nextHorizontal}% 50%`);
  };
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 p-3">
      <div className="flex items-center gap-3">
        <div
          aria-label="Предпросмотр фоновой картинки"
          className="h-14 w-24 shrink-0 rounded-lg border border-white/10 bg-zinc-900"
          style={previewStyle}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-zinc-200">
            Фоновая картинка
          </div>
          <div className="mt-0.5 text-[9px] leading-relaxed text-zinc-500">
            Высота равна карточке, пропорции изображения сохраняются
          </div>
        </div>
      </div>
      <input
        type="text"
        aria-label="Фоновая картинка карточки"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://... или /api/config/icon/background.webp"
        className={inspectorInputClass}
      />
      <div className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 border-t border-white/10 pt-3">
        <div>
          <div className="mb-1.5 text-[9px] font-medium text-zinc-400">
            Положение
          </div>
          <div className="grid w-fit grid-cols-3 gap-1">
            {cardBackgroundPositionPresets.map(([label, preset]) => (
              <button
                key={preset}
                type="button"
                aria-label={`Положение фона: ${label}`}
                aria-pressed={normalizedPosition === preset}
                onClick={() => onPositionChange(preset)}
                className={classNames(
                  "h-4 w-4 rounded-full border transition",
                  normalizedPosition === preset
                    ? "border-white bg-white"
                    : "border-white/25 bg-white/5 hover:bg-white/20",
                )}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-1.5">
          <button
            type="button"
            aria-label="Сдвинуть фон влево"
            disabled={horizontal <= 0}
            onClick={() => nudgePosition(-5)}
            className="rounded-lg border border-white/10 bg-white/5 py-1 text-[10px] text-zinc-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            ←
          </button>
          <span className="text-center text-[9px] text-zinc-400">
            По горизонтали · {horizontal}%
          </span>
          <button
            type="button"
            aria-label="Сдвинуть фон вправо"
            disabled={horizontal >= 100}
            onClick={() => nudgePosition(5)}
            className="rounded-lg border border-white/10 bg-white/5 py-1 text-[10px] text-zinc-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            →
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChooseImage?.(onChange)}
          disabled={!onChooseImage}
          className="rounded-lg border border-white/10 px-2.5 py-2 text-[10px] font-medium text-zinc-300 transition hover:bg-white/10"
        >
          Выбрать картинку
        </button>
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={!value}
          className="rounded-lg border border-white/10 px-2.5 py-2 text-[10px] text-zinc-400 transition hover:bg-white/10 disabled:opacity-40"
        >
          Убрать фон
        </button>
      </div>
    </div>
  );
}

function StudioServiceUpdateControl({ value, onChange }) {
  const config = normalizeServiceUpdateConfig(value);
  const [registry, setRegistry] = useState(null);
  const [registryError, setRegistryError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config/service-updates")
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
      .then((nextRegistry) => {
        if (!cancelled) setRegistry(nextRegistry);
      })
      .catch((error) => {
        if (!cancelled) {
          setRegistryError(
            error.message || "Не удалось загрузить список обновлений",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const targets = (registry?.targets ?? []).filter(
    (target) => target.type === config.type && target.available !== false,
  );
  const selectedTarget = targets.find(
    (target) =>
      target.id === config.target &&
      (!config.source || target.source === config.source),
  );
  const selectedValue = selectedTarget
    ? `${selectedTarget.source || ""}::${selectedTarget.id}`
    : "";
  const updateConfig = (patch) => onChange({ ...config, ...patch });

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-xs font-semibold text-zinc-100">
            Информатор обновлений
          </span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-400">
            Связь карточки с найденным Docker-контейнером или LXC.
          </span>
        </span>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => updateConfig({ enabled: event.target.checked })}
          className="h-4 w-4 shrink-0 accent-white"
        />
      </label>
      {config.enabled && (
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(serviceUpdateTypes).map(([type, info]) => (
              <button
                key={type}
                type="button"
                onClick={() => updateConfig({ source: "", target: "", type })}
                className={classNames(
                  "rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                  config.type === type
                    ? "border-white/30 bg-white/10 text-white"
                    : "border-white/10 bg-black/10 text-zinc-400 hover:bg-white/5",
                )}
              >
                {info.label}
              </button>
            ))}
          </div>
          <label className="block text-[10px] text-zinc-400">
            Найденная цель
            <select
              aria-label="Цель информатора обновлений"
              value={selectedValue}
              onChange={(event) => {
                const [source = "", target = ""] =
                  event.target.value.split("::");
                updateConfig({ source, target });
              }}
              className={inspectorInputClass}
            >
              <option value="">Выберите цель</option>
              {targets.map((target) => (
                <option
                  key={`${target.source || ""}:${target.id}`}
                  value={`${target.source || ""}::${target.id}`}
                >
                  {target.label || target.id}
                  {target.source ? ` · ${target.source}` : ""}
                </option>
              ))}
            </select>
          </label>
          {!registry && !registryError && (
            <div className="text-[10px] text-zinc-500">Поиск целей…</div>
          )}
          {registryError && (
            <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[10px] text-rose-200">
              {registryError}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ColorControl({ label, value, onChange }) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff";
  return (
    <label className="grid grid-cols-[38px_minmax(0,1fr)] items-end gap-2 text-[10px] text-zinc-400">
      <input
        type="color"
        value={color}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-9 rounded-lg border border-white/10 bg-black/10 p-1"
        aria-label={label}
      />
      <span>
        {label}
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inspectorInputClass}
        />
      </span>
    </label>
  );
}

function InspectorCheckbox({ checked, label, note = "", onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/10 bg-black/10 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-zinc-200">{label}</span>
        {note && (
          <span className="mt-0.5 block text-[10px] leading-4 text-zinc-500">
            {note}
          </span>
        )}
      </span>
    </label>
  );
}

function NewBookmarkInspector({ groupName, onChooseIcon, onClose, onSave }) {
  const [draft, setDraft] = useState({
    cardBackground: "",
    cardBackgroundPosition: "",
    description: "",
    href: "",
    icon: "",
    id: "",
    name: "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const update = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await onSave("bookmarks", groupName, draft);
      onClose();
    } catch (error) {
      setMessage(error.message || "Не удалось добавить карточку");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Новая карточка · визуальный инспектор
        </div>
        <div className="mt-1 text-base font-semibold">Добавить закладку</div>
        <div className="mt-0.5 text-[10px] text-zinc-500">
          Группа: {groupName || "не выбрана"}
        </div>
      </div>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div className="flex items-center gap-3">
          <ServiceIcon
            config={{ icon: draft.icon }}
            name={draft.name || "Закладка"}
            onClick={() => onChooseIcon((icon) => update("icon", icon))}
            size={34}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {draft.name || "Название карточки"}
            </div>
            <div className="truncate text-[10px] text-zinc-500">
              {draft.href || "URL появится здесь"}
            </div>
          </div>
        </div>
        <InspectorField
          label="Название"
          value={draft.name}
          onChange={(value) => update("name", value)}
          placeholder="Моя закладка"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <InspectorField
            label="URL"
            value={draft.href}
            onChange={(value) => update("href", value)}
            placeholder="https://example.com"
          />
          <button
            type="button"
            onClick={() => onChooseIcon((icon) => update("icon", icon))}
            className="rounded-xl border border-white/15 px-3 py-2 text-xs font-medium transition hover:bg-white/10"
          >
            Иконка
          </button>
        </div>
        <InspectorField
          label="Иконка"
          value={draft.icon}
          onChange={(value) => update("icon", value)}
          placeholder="si-example"
        />
        <InspectorField
          label="Описание"
          value={draft.description}
          onChange={(value) => update("description", value)}
          placeholder="Короткая подпись"
        />
        <InspectorField
          label="ID карточки / цветовой префикс"
          value={draft.id}
          onChange={(value) => update("id", value)}
          placeholder="color-green-my-service"
        />
        <CardBackgroundControl
          value={draft.cardBackground}
          onChange={(value) => update("cardBackground", value)}
          onChooseImage={onChooseIcon}
          position={draft.cardBackgroundPosition}
          onPositionChange={(value) => update("cardBackgroundPosition", value)}
        />
      </section>

      {message && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
          {message}
        </div>
      )}
      <div
        className="sticky bottom-0 z-20 -mx-1 flex gap-2 border-t border-white/10 px-1 py-3"
        style={{
          backgroundColor: "var(--studio-panel)",
          boxShadow: "0 -12px 24px var(--studio-panel)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-xl border border-white/10 px-3 py-2.5 text-xs text-zinc-300 disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
        >
          {saving ? "Сохранение…" : "Добавить закладку"}
        </button>
      </div>
    </div>
  );
}

function NewServiceInspector({
  groupName,
  internalBaseUrl,
  onChooseIcon,
  onClose,
  onSave,
  templates,
  translations,
  booleanOptions,
  widgetCatalog,
  widgetTypes,
}) {
  const [meta, setMeta] = useState({
    description: "",
    href: "",
    icon: "",
    id: "",
    name: "",
  });
  const updateMeta = (key, value) =>
    setMeta((current) => ({ ...current, [key]: value }));
  const item = {
    key: `new-service:${groupName}`,
    name: meta.name || "Новый сервис",
    groupName,
    config: {
      ...meta,
    },
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Новый сервис · визуальный инспектор
        </div>
        <div className="mt-1 text-base font-semibold">Добавить сервис</div>
        <div className="mt-0.5 text-[10px] text-zinc-500">
          Группа: {groupName || "не выбрана"}. Здесь доступны те же настройки,
          что и при редактировании сервиса.
        </div>
      </div>
      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <InspectorField
          label="Название"
          value={meta.name}
          onChange={(value) => updateMeta("name", value)}
          placeholder="Мой сервис"
        />
        <InspectorField
          label="URL"
          value={meta.href}
          onChange={(value) => updateMeta("href", value)}
          placeholder="https://example.com"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <InspectorField
            label="Иконка"
            value={meta.icon}
            onChange={(value) => updateMeta("icon", value)}
            placeholder="si-example"
          />
          <button
            type="button"
            onClick={() => onChooseIcon((icon) => updateMeta("icon", icon))}
            className="rounded-xl border border-white/15 px-3 py-2 text-xs font-medium transition hover:bg-white/10"
          >
            Выбрать
          </button>
        </div>
        <InspectorField
          label="Описание"
          value={meta.description}
          onChange={(value) => updateMeta("description", value)}
          placeholder="Короткая подпись"
        />
        <InspectorField
          label="ID карточки / цветовой префикс"
          value={meta.id}
          onChange={(value) => updateMeta("id", value)}
          placeholder="color-green-my-service"
        />
      </section>
      <ServiceWidgetInspector
        key={item.key}
        booleanOptions={booleanOptions}
        internalBaseUrl={internalBaseUrl}
        item={item}
        onChooseBackground={onChooseIcon}
        onOpenItem={() => {}}
        onPickIcon={() => onChooseIcon((icon) => updateMeta("icon", icon))}
        onSave={async (_item, widget, cardStyle) => {
          if (!meta.name.trim()) throw new Error("Укажите название сервиса");
          if (!meta.href.trim()) throw new Error("Укажите URL сервиса");
          await onSave("services", groupName, {
            ...meta,
            ...cardStyle,
            widget,
          });
          onClose();
        }}
        templates={templates}
        translations={translations}
        widgetCatalog={widgetCatalog}
        widgetTypes={widgetTypes}
      />
    </div>
  );
}

function NewItemInspector(props) {
  if (props.type === "services") {
    return <NewServiceInspector {...props} />;
  }
  return <NewBookmarkInspector {...props} />;
}

function BookmarkInspector({ item, onChooseIcon, onDeleted, onSave }) {
  const initialDraft = {
    abbr: item.config?.abbr ?? "",
    cardBackground: item.config?.cardBackground ?? "",
    cardBackgroundPosition: item.config?.cardBackgroundPosition ?? "",
    description: item.config?.description ?? "",
    href: item.config?.href ?? "",
    icon: item.config?.icon ?? "",
    id: item.config?.id ?? "",
    showLink: item.config?.showLink === true,
    target: item.config?.target ?? "",
    titleAlign: item.config?.titleAlign ?? "",
    titleColor: item.config?.titleColor ?? "",
    titleFont: item.config?.titleFont ?? "",
    titleSize: item.config?.titleSize ?? "",
  };
  const [name, setName] = useState(item.name);
  const [draft, setDraft] = useState(initialDraft);
  const [savedSignature, setSavedSignature] = useState(
    JSON.stringify({ name: item.name, draft: initialDraft }),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const previewItem = {
    ...item,
    name,
    config: { ...item.config, ...draft },
  };
  const dirty = JSON.stringify({ name, draft }) !== savedSignature;
  const selectedColor =
    cardColors.find(([prefix]) =>
      String(draft.id).startsWith(`${prefix}-`),
    )?.[0] ?? "";
  const validTitleColor = /^#[0-9a-f]{6}$/i.test(draft.titleColor)
    ? draft.titleColor
    : "#ffffff";

  const updateField = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await onSave(item, { name, fields: draft });
      setSavedSignature(JSON.stringify({ name, draft }));
      setMessage("Закладка сохранена");
    } catch (error) {
      setMessage(error.message || "Не удалось сохранить закладку");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Удалить закладку «${item.name}»? Это действие нельзя отменить.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await onSave(item, null, "delete");
      onDeleted();
    } catch (error) {
      setMessage(error.message || "Не удалось удалить закладку");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Закладка · визуальный инспектор
          </div>
          <div className="mt-1 text-base font-semibold">{item.name}</div>
        </div>
        {dirty && (
          <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[9px] font-semibold text-amber-200">
            Не сохранено
          </span>
        )}
      </div>

      <ServiceCardPreview
        item={previewItem}
        large
        onIconClick={() => onChooseIcon((icon) => updateField("icon", icon))}
      />

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div>
          <div className="text-xs font-semibold">Основные параметры</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Все изменения видны в макете выше
          </div>
        </div>
        <InspectorField label="Название" value={name} onChange={setName} />
        <InspectorField
          label="URL"
          value={draft.href}
          onChange={(value) => updateField("href", value)}
          placeholder="https://example.com"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <InspectorField
            label="Иконка"
            value={draft.icon}
            onChange={(value) => updateField("icon", value)}
            placeholder="si-example"
          />
          <button
            type="button"
            onClick={() => onChooseIcon((icon) => updateField("icon", icon))}
            className="rounded-xl border border-white/15 px-3 py-2 text-xs font-medium transition hover:bg-white/10"
          >
            Выбрать
          </button>
        </div>
        <InspectorCheckbox
          checked={draft.showLink}
          onChange={(checked) => updateField("showLink", checked)}
          label="Отображать адрес"
          note="Показывает URL непосредственно на карточке закладки"
        />
      </section>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div>
          <div className="text-xs font-semibold">Стилизация закладки</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Фон карточки и оформление заголовка
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-400">Цвет карточки</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-label="Без цвета"
              aria-pressed={!selectedColor}
              onClick={() =>
                updateField("id", cardColorId(draft.id, name || item.name, ""))
              }
              className={classNames(
                "flex h-7 w-7 items-center justify-center rounded-lg border text-[10px]",
                !selectedColor
                  ? "border-white ring-2 ring-white/25"
                  : "border-white/15",
              )}
            >
              ×
            </button>
            {cardColors.map(([prefix, color]) => (
              <button
                type="button"
                key={prefix}
                aria-label={`Цвет карточки ${prefix}`}
                aria-pressed={selectedColor === prefix}
                onClick={() =>
                  updateField(
                    "id",
                    cardColorId(draft.id, name || item.name, prefix),
                  )
                }
                className={classNames(
                  "h-7 w-7 rounded-lg border",
                  selectedColor === prefix
                    ? "border-white ring-2 ring-white/25"
                    : "border-white/15",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
        <CardBackgroundControl
          value={draft.cardBackground}
          onChange={(value) => updateField("cardBackground", value)}
          onChooseImage={onChooseIcon}
          position={draft.cardBackgroundPosition}
          onPositionChange={(value) =>
            updateField("cardBackgroundPosition", value)
          }
        />
        <div className="grid grid-cols-[42px_minmax(0,1fr)] items-end gap-2">
          <label className="block text-[10px] text-zinc-400">
            Цвет
            <input
              type="color"
              value={validTitleColor}
              onChange={(event) =>
                updateField("titleColor", event.target.value)
              }
              className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/10 p-1"
            />
          </label>
          <InspectorField
            label="Цвет заголовка"
            value={draft.titleColor}
            onChange={(value) => updateField("titleColor", value)}
            placeholder="#ffffff"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] text-zinc-400">
            Размер
            <select
              value={draft.titleSize}
              onChange={(event) => updateField("titleSize", event.target.value)}
              className={inspectorInputClass}
            >
              <option value="">По умолчанию</option>
              {["14px", "16px", "18px", "20px", "24px"].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] text-zinc-400">
            Шрифт
            <select
              value={draft.titleFont}
              onChange={(event) => updateField("titleFont", event.target.value)}
              className={inspectorInputClass}
            >
              <option value="">По умолчанию</option>
              {["Comfortaa", "Inter", "Roboto", "Montserrat"].map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <div className="text-[10px] text-zinc-400">Выравнивание</div>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {[
              ["left", "Слева"],
              ["center", "Центр"],
              ["right", "Справа"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={(draft.titleAlign || "left") === value}
                onClick={() => updateField("titleAlign", value)}
                className={classNames(
                  "rounded-lg border px-2 py-2 text-[10px]",
                  (draft.titleAlign || "left") === value
                    ? "border-white/35 bg-white/15 text-white"
                    : "border-white/10 text-zinc-400",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <details className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <summary className="cursor-pointer text-xs font-semibold">
          Дополнительные параметры
        </summary>
        <div className="mt-3 space-y-3">
          <InspectorField
            label="Описание"
            value={draft.description}
            onChange={(value) => updateField("description", value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <InspectorField
              label="Сокращение"
              value={draft.abbr}
              onChange={(value) => updateField("abbr", value)}
            />
            <InspectorField
              label="Цель ссылки"
              value={draft.target}
              onChange={(value) => updateField("target", value)}
              placeholder="_blank"
            />
          </div>
        </div>
      </details>

      {message && (
        <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-300">
          {message}
        </div>
      )}
      <div
        className="sticky bottom-0 z-20 -mx-1 flex gap-2 border-t border-white/10 px-1 py-3"
        style={{
          backgroundColor: "var(--studio-panel)",
          boxShadow: "0 -12px 24px var(--studio-panel)",
        }}
      >
        <button
          type="button"
          onClick={handleDelete}
          disabled={saving}
          className="rounded-xl border border-rose-400/40 px-3 py-2.5 text-xs text-rose-300 disabled:opacity-50"
        >
          Удалить
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
        >
          {saving ? "Сохранение…" : "Сохранить закладку"}
        </button>
      </div>
    </div>
  );
}

function PageStyleInspector({ inline = false, onSave, pages, settings }) {
  const initialDraft = studioPageStyleDraft(settings);
  const [draft, setDraft] = useState(initialDraft);
  const [savedSignature, setSavedSignature] = useState(
    JSON.stringify(initialDraft),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(draft) !== savedSignature;
  const updateField = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };
  const previewPages = pages.length
    ? pages.slice(0, 3).map((page) => page.name)
    : ["Основное", "Медиа", "Сайты"];
  const justifyContent = {
    between: "space-between",
    center: "center",
    end: "flex-end",
    start: "flex-start",
  }[draft.align];

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      await onSave(draft);
      setSavedSignature(JSON.stringify(draft));
      setMessage("Оформление страниц сохранено");
    } catch (error) {
      setMessage(error.message || "Не удалось сохранить оформление страниц");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-studio-page-styles={inline ? "inline" : "inspector"}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Страницы · оформление
          </div>
          <div className="mt-1 text-base font-semibold">Вкладки дашборда</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Общий вид вкладок и положение статуса карточек
          </div>
        </div>
        {dirty && (
          <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[9px] font-semibold text-amber-200">
            Не сохранено
          </span>
        )}
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Предпросмотр
        </div>
        <div
          className={classNames(
            "mt-3 flex min-h-14 items-center gap-1 overflow-hidden rounded-xl p-2",
            draft.hideTabBackground
              ? "border border-dashed border-white/10 bg-transparent"
              : "border border-white/10 bg-black/20",
            draft.borderStyle === "outline" && "border-white/25",
          )}
          style={{
            fontFamily: draft.fontFamily || undefined,
            fontSize: draft.fontSize || undefined,
            justifyContent,
          }}
        >
          {previewPages.map((name, index) => {
            const active = index === 0;
            return (
              <span
                key={name}
                className={classNames(
                  "min-w-0 truncate px-2 py-1 transition",
                  draft.borderStyle === "pill" && "rounded-full",
                  draft.borderStyle === "card" && "rounded-md border",
                  draft.borderStyle === "underline" && "border-b-2",
                  draft.borderStyle === "underline-rounded" &&
                    "rounded-b border-b-4",
                  active &&
                    !draft.hideTabBackground &&
                    ["none", "pill"].includes(draft.borderStyle) &&
                    "bg-white/10",
                  !active && "opacity-70",
                )}
                style={{
                  borderColor:
                    active && draft.borderStyle !== "none"
                      ? draft.borderColor || "var(--studio-accent)"
                      : "transparent",
                  color: active
                    ? draft.activeColor || draft.borderColor || undefined
                    : draft.inactiveColor || undefined,
                }}
              >
                {name}
              </span>
            );
          })}
        </div>
      </section>

      <div className={classNames("grid gap-4", inline && "xl:grid-cols-2")}>
      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div className="text-xs font-semibold">Текст и расположение</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[10px] text-zinc-400">
            Шрифт
            <select
              value={draft.fontFamily}
              onChange={(event) => updateField("fontFamily", event.target.value)}
              className={inspectorInputClass}
            >
              {studioPageStyleFonts.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] text-zinc-400">
            Размер шрифта
            <select
              value={draft.fontSize}
              onChange={(event) => updateField("fontSize", event.target.value)}
              className={inspectorInputClass}
            >
              {studioPageStyleFontSizes.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-[10px] text-zinc-400">
          Выравнивание вкладок
          <select
            value={draft.align}
            onChange={(event) => updateField("align", event.target.value)}
            className={inspectorInputClass}
          >
            {studioPageStyleAlignments.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <InspectorCheckbox
          checked={draft.hideTabBackground}
          label="Прозрачный фон вкладок"
          note="Убирает фон и тень общего контейнера"
          onChange={(value) => updateField("hideTabBackground", value)}
        />
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div className="text-xs font-semibold">Эффект и рамка</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {studioPageStyleBorders.map(([value, label]) => {
            const active = draft.borderStyle === value;
            return (
              <button
                type="button"
                key={value}
                aria-pressed={active}
                onClick={() => updateField("borderStyle", value)}
                className={classNames(
                  "min-h-14 rounded-xl border px-3 py-2 text-left text-[10px] transition",
                  active
                    ? "bg-white/10 text-white"
                    : "border-white/10 bg-black/10 text-zinc-400 hover:border-white/20",
                )}
                style={active ? { borderColor: "var(--studio-accent)" } : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ColorControl
            label="Активный текст"
            value={draft.activeColor}
            onChange={(value) => updateField("activeColor", value)}
          />
          <ColorControl
            label="Неактивный текст"
            value={draft.inactiveColor}
            onChange={(value) => updateField("inactiveColor", value)}
          />
          <ColorControl
            label="Рамка / подчёркивание"
            value={draft.borderColor}
            onChange={(value) => updateField("borderColor", value)}
          />
        </div>
      </section>

      <section
        className={classNames(
          "space-y-4 rounded-2xl border border-white/10 bg-white/5 p-3.5",
          inline && "xl:col-span-2",
        )}
      >
        <div>
          <div className="text-xs font-semibold">Позиция статуса карточек</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Сдвиг надписей Running / Exited на карточках мониторинга
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["serviceStatusOffsetX", "Влево / вправо"],
            ["serviceStatusOffsetY", "Вверх / вниз"],
          ].map(([key, label]) => (
            <label key={key} className="block text-[10px] text-zinc-400">
              <span className="flex items-center justify-between gap-2">
                <span>{label}</span>
                <span className="rounded-md border border-white/10 bg-black/15 px-2 py-1 tabular-nums text-zinc-200">
                  {draft[key]}px
                </span>
              </span>
              <input
                type="range"
                min={studioServiceStatusOffsetMin}
                max={studioServiceStatusOffsetMax}
                step="1"
                value={draft[key]}
                onChange={(event) =>
                  updateField(key, Number(event.target.value))
                }
                className="mt-2 w-full accent-white"
              />
            </label>
          ))}
        </div>
      </section>
      </div>

      {message && (
        <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-300">
          {message}
        </div>
      )}
      <div
        className={classNames(
          "border-t border-white/10 px-1 py-3",
          !inline && "sticky bottom-0 z-20 -mx-1",
        )}
        style={
          inline
            ? undefined
            : {
                backgroundColor: "var(--studio-panel)",
                boxShadow: "0 -12px 24px var(--studio-panel)",
              }
        }
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="w-full rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
        >
          {saving ? "Сохранение…" : "Сохранить оформление"}
        </button>
      </div>
    </div>
  );
}

function PageInspector({ groups, onChooseIcon, onDeleted, onSave, page }) {
  const initialSelected = (page?.groups ?? []).map((group) => group.key);
  const initialDraft = {
    icon: page?.icon ?? "",
    name: page?.name ?? "",
    selectedGroupKeys: initialSelected,
  };
  const [draft, setDraft] = useState(initialDraft);
  const [savedSignature, setSavedSignature] = useState(
    JSON.stringify(initialDraft),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const isNew = !page;
  const dirty = JSON.stringify(draft) !== savedSignature;

  const updateField = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const toggleGroup = (groupKey, checked) => {
    updateField(
      "selectedGroupKeys",
      checked
        ? [...new Set([...draft.selectedGroupKeys, groupKey])]
        : draft.selectedGroupKeys.filter((key) => key !== groupKey),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const result = await onSave(page?.name ?? "", draft, "save");
      const savedDraft = { ...draft, name: result?.name ?? draft.name.trim() };
      setDraft(savedDraft);
      setSavedSignature(JSON.stringify(savedDraft));
      setMessage(isNew ? "Страница создана" : "Страница сохранена");
    } catch (error) {
      setMessage(error.message || "Не удалось сохранить страницу");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Удалить страницу «${page.name}»? Её группы останутся на дашборде и будут видны на всех страницах.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await onSave(page.name, draft, "delete");
      onDeleted();
    } catch (error) {
      setMessage(error.message || "Не удалось удалить страницу");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Страница · визуальный инспектор
          </div>
          <div className="mt-1 text-base font-semibold">
            {isNew ? "Новая страница" : page.name}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Страница формируется из выбранных групп
          </div>
        </div>
        {dirty && (
          <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[9px] font-semibold text-amber-200">
            Не сохранено
          </span>
        )}
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <ServiceIcon
            config={{ icon: draft.icon }}
            name={draft.name || "Страница"}
            onClick={() => onChooseIcon((icon) => updateField("icon", icon))}
            size={30}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">
              {draft.name || "Название страницы"}
            </div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {draft.selectedGroupKeys.length} групп выбрано
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div className="text-xs font-semibold">Основные параметры</div>
        <InspectorField
          label="Название страницы"
          value={draft.name}
          onChange={(value) => updateField("name", value)}
          placeholder="Например, Основное"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <InspectorField
            label="Иконка страницы"
            value={draft.icon}
            onChange={(value) => updateField("icon", value)}
            placeholder="mdi-home"
          />
          <button
            type="button"
            onClick={() => onChooseIcon((icon) => updateField("icon", icon))}
            className="rounded-xl border border-white/15 px-3 py-2 text-xs font-medium transition hover:bg-white/10"
          >
            Выбрать
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div className="text-xs font-semibold">Группы на странице</div>
        <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
          Группа может находиться только на одной странице. Выбор перенесёт её с
          текущей страницы.
        </p>
        <div className="mt-3 space-y-2">
          {groups.map((group) => {
            const checked = draft.selectedGroupKeys.includes(group.key);
            return (
              <label
                key={group.key}
                className={classNames(
                  "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] transition-colors",
                  checked
                    ? "border-white/30 bg-white/10 text-white"
                    : "border-white/10 bg-black/10 text-zinc-400 hover:border-white/20",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    toggleGroup(group.key, event.target.checked)
                  }
                  className="h-4 w-4 accent-white"
                />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="shrink-0 text-[9px] text-zinc-500">
                  {group.type === "bookmarks" ? "Закладки" : "Сервисы"}
                  {group.pageName && !checked ? ` · ${group.pageName}` : ""}
                </span>
              </label>
            );
          })}
          {!groups.length && (
            <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-[10px] text-zinc-500">
              Сначала создайте хотя бы одну группу сервисов или закладок
            </div>
          )}
        </div>
      </section>

      {message && (
        <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-300">
          {message}
        </div>
      )}
      <div
        className="sticky bottom-0 z-20 -mx-1 flex gap-2 border-t border-white/10 px-1 py-3"
        style={{
          backgroundColor: "var(--studio-panel)",
          boxShadow: "0 -12px 24px var(--studio-panel)",
        }}
      >
        {!isNew && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="rounded-xl border border-rose-400/40 px-3 py-2.5 text-xs text-rose-300 disabled:opacity-50"
          >
            Удалить
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || (!isNew && !dirty)}
          className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
        >
          {saving
            ? "Сохранение…"
            : isNew
              ? "Создать страницу"
              : "Сохранить страницу"}
        </button>
      </div>
    </div>
  );
}

function GroupInspector({
  group,
  layout,
  onChooseIcon,
  onDeleted,
  onSave,
  tabs,
}) {
  const initialDraft = {
    alignRowHeights: layout.alignRowHeights !== false,
    columns: layout.columns !== undefined ? String(layout.columns) : "",
    headerVisible: layout.header !== false,
    icon: layout.icon ?? "",
    initiallyCollapsed: layout.initiallyCollapsed === true,
    style: layout.style === "row" ? "row" : "",
    tab: layout.tab ?? "",
    titleAlign: layout.titleAlign ?? "",
    titleColor: layout.titleColor ?? "",
    titleFont: layout.titleFont ?? "",
    titleSize: layout.titleSize ?? "",
  };
  const [name, setName] = useState(group.name);
  const [draft, setDraft] = useState(initialDraft);
  const [savedSignature, setSavedSignature] = useState(
    JSON.stringify({ name: group.name, draft: initialDraft }),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify({ name, draft }) !== savedSignature;
  const horizontal = draft.style === "row";

  const updateField = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const result = await onSave(group, { name, fields: draft });
      const savedName = result?.name || name;
      setName(savedName);
      setSavedSignature(JSON.stringify({ name: savedName, draft }));
      setMessage("Группа сохранена");
    } catch (error) {
      setMessage(error.message || "Не удалось сохранить группу");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Удалить группу «${group.name}» вместе со всеми карточками?`,
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await onSave(group, null, "delete");
      onDeleted();
    } catch (error) {
      setMessage(error.message || "Не удалось удалить группу");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Группа · визуальный инспектор
          </div>
          <div className="mt-1 text-base font-semibold">{group.name}</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            {group.type === "bookmarks" ? "Закладки" : "Сервисы"} ·{" "}
            {group.items.length} карточек
          </div>
        </div>
        {dirty && (
          <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[9px] font-semibold text-amber-200">
            Не сохранено
          </span>
        )}
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <ServiceIcon
            config={{ icon: draft.icon }}
            name={name || group.name}
            onClick={() => onChooseIcon((icon) => updateField("icon", icon))}
            size={30}
          />
          <div
            className="min-w-0 flex-1"
            style={{
              color: draft.titleColor || undefined,
              fontFamily: draft.titleFont || undefined,
              fontSize: draft.titleSize || undefined,
              textAlign: draft.titleAlign || undefined,
            }}
          >
            <div className="truncate font-semibold">{name || group.name}</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              Предпросмотр заголовка группы
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div className="text-xs font-semibold">Основные параметры</div>
        <InspectorField
          label="Название группы"
          value={name}
          onChange={setName}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <InspectorField
            label="Иконка группы"
            value={draft.icon}
            onChange={(value) => updateField("icon", value)}
          />
          <button
            type="button"
            onClick={() => onChooseIcon((icon) => updateField("icon", icon))}
            className="rounded-xl border border-white/15 px-3 py-2 text-xs font-medium transition hover:bg-white/10"
          >
            Выбрать
          </button>
        </div>
        <label className="block text-[10px] text-zinc-400">
          Страница
          <input
            type="text"
            list="dashboard-studio-group-tabs"
            value={draft.tab}
            onChange={(event) => updateField("tab", event.target.value)}
            placeholder="Все страницы"
            className={inspectorInputClass}
          />
          <datalist id="dashboard-studio-group-tabs">
            {tabs.map((tab) => (
              <option key={tab} value={tab}>
                {tab}
              </option>
            ))}
          </datalist>
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div>
          <div className="text-xs font-semibold">Расположение</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Направление и количество колонок
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            ["", "Вертикально"],
            ["row", "Горизонтально"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={draft.style === value}
              onClick={() => {
                updateField("style", value);
                if (value === "row" && !draft.columns) {
                  updateField("columns", "3");
                }
              }}
              className={classNames(
                "rounded-xl border px-3 py-2 text-xs",
                draft.style === value
                  ? "border-white/35 bg-white/15 text-white"
                  : "border-white/10 text-zinc-400",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {horizontal && (
          <div className="grid grid-cols-4 gap-1.5">
            {["2", "3", "4", "5"].map((columns) => (
              <button
                type="button"
                key={columns}
                aria-pressed={draft.columns === columns}
                onClick={() => updateField("columns", columns)}
                className={classNames(
                  "rounded-lg border px-2 py-2 text-[10px]",
                  draft.columns === columns
                    ? "border-white/35 bg-white/15 text-white"
                    : "border-white/10 text-zinc-400",
                )}
              >
                {columns} кол.
              </button>
            ))}
          </div>
        )}
        <InspectorCheckbox
          checked={draft.headerVisible}
          onChange={(checked) => updateField("headerVisible", checked)}
          label="Показывать заголовок группы"
        />
        <InspectorCheckbox
          checked={draft.initiallyCollapsed}
          onChange={(checked) => updateField("initiallyCollapsed", checked)}
          label="Сворачивать при загрузке"
        />
        {group.type === "services" && (
          <InspectorCheckbox
            checked={draft.alignRowHeights}
            onChange={(checked) => updateField("alignRowHeights", checked)}
            label="Выравнивать высоту карточек"
          />
        )}
      </section>

      <details className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <summary className="cursor-pointer text-xs font-semibold">
          Стиль заголовка
        </summary>
        <div className="mt-3 space-y-3">
          <InspectorField
            label="Цвет заголовка"
            value={draft.titleColor}
            onChange={(value) => updateField("titleColor", value)}
            placeholder="#ffffff"
          />
          <div className="grid grid-cols-2 gap-2">
            <InspectorField
              label="Размер"
              value={draft.titleSize}
              onChange={(value) => updateField("titleSize", value)}
              placeholder="16px"
            />
            <InspectorField
              label="Шрифт"
              value={draft.titleFont}
              onChange={(value) => updateField("titleFont", value)}
              placeholder="Comfortaa"
            />
          </div>
          <label className="block text-[10px] text-zinc-400">
            Выравнивание
            <select
              value={draft.titleAlign}
              onChange={(event) =>
                updateField("titleAlign", event.target.value)
              }
              className={inspectorInputClass}
            >
              <option value="">По умолчанию</option>
              <option value="left">Слева</option>
              <option value="center">По центру</option>
              <option value="right">Справа</option>
            </select>
          </label>
        </div>
      </details>

      {message && (
        <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-300">
          {message}
        </div>
      )}
      <div
        className="sticky bottom-0 z-20 -mx-1 flex gap-2 border-t border-white/10 px-1 py-3"
        style={{
          backgroundColor: "var(--studio-panel)",
          boxShadow: "0 -12px 24px var(--studio-panel)",
        }}
      >
        <button
          type="button"
          onClick={handleDelete}
          disabled={saving}
          className="rounded-xl border border-rose-400/40 px-3 py-2.5 text-xs text-rose-300 disabled:opacity-50"
        >
          Удалить
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
        >
          {saving ? "Сохранение…" : "Сохранить группу"}
        </button>
      </div>
    </div>
  );
}

function widgetTypeFromConfig(widget) {
  if (!widget) return "";
  return isThreeXuiWidget(widget) ? "3xui" : String(widget.type ?? "");
}

function widgetFromTemplate(type, templates, internalBaseUrl) {
  if (!type) return null;
  if (type === "3xui") {
    return buildThreeXuiWidget(
      undefined,
      defaultThreeXuiMetricKeys().slice(0, 4),
      internalBaseUrl,
    );
  }

  try {
    const parsed = yaml.load(templates?.[type] ?? "");
    if (
      parsed?.widget &&
      typeof parsed.widget === "object" &&
      !Array.isArray(parsed.widget)
    ) {
      return parsed.widget;
    }
  } catch {
    // Fall back to a small editable template below.
  }

  return {
    type,
    url: "http://ip-address:port",
  };
}

function widgetSettingLabel(key) {
  const labels = {
    category: "Категория",
    env: "Окружение / ID",
    key: "API-ключ",
    password: "Пароль",
    refreshInterval: "Интервал обновления, мс",
    token: "Токен",
    url: "Адрес сервиса",
    username: "Пользователь",
    version: "Версия API",
  };
  return labels[key] ?? humanizeWidgetKey(key);
}

function serializeWidgetYaml(widget) {
  return yaml.dump(
    { widget: widget ?? null },
    {
      lineWidth: -1,
      noRefs: true,
      schema: yaml.JSON_SCHEMA,
      sortKeys: false,
    },
  );
}

function parseWidgetYaml(source) {
  const parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('YAML должен содержать объект с секцией "widget"');
  }

  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "widget") {
    throw new Error('В этом поле разрешена только секция "widget"');
  }

  const widget = parsed.widget;
  if (widget === null) return null;
  if (!widget || typeof widget !== "object" || Array.isArray(widget)) {
    throw new Error('Секция "widget" должна быть объектом или null');
  }

  return widget;
}

const studioServiceCardFields = [
  "abbr",
  "description",
  "href",
  "icon",
  "id",
  "ping",
  "proxmoxNode",
  "proxmoxType",
  "proxmoxVMID",
  "showStats",
  "siteMonitor",
  "target",
  "titleAlign",
  "titleColor",
  "titleFont",
  "titleSize",
  "weight",
];

function serviceCardDraftFromItem(item) {
  return {
    name: item?.name ?? "",
    ...Object.fromEntries(
      studioServiceCardFields.map((key) => [key, item?.config?.[key] ?? ""]),
    ),
    serviceUpdate: normalizeServiceUpdateConfig(item?.config?.serviceUpdate),
  };
}

function ServiceWidgetInspector({
  booleanOptions,
  internalBaseUrl,
  item,
  modalLayout = false,
  onChooseBackground,
  onOpenItem,
  onPickIcon,
  onSave,
  templates,
  translations,
  widgetCatalog,
  widgetTypes,
}) {
  const initialWidget = widgetFromItem(item);
  const initialCardBackground = item.config?.cardBackground ?? "";
  const initialCardBackgroundPosition =
    item.config?.cardBackgroundPosition ?? "";
  const initialCardDraft = serviceCardDraftFromItem(item);
  const [draft, setDraft] = useState(initialWidget);
  const [savedDraft, setSavedDraft] = useState(initialWidget);
  const [cardDraft, setCardDraft] = useState(initialCardDraft);
  const [savedCardDraft, setSavedCardDraft] = useState(initialCardDraft);
  const [cardBackground, setCardBackground] = useState(initialCardBackground);
  const [savedCardBackground, setSavedCardBackground] = useState(
    initialCardBackground,
  );
  const [cardBackgroundPosition, setCardBackgroundPosition] = useState(
    initialCardBackgroundPosition,
  );
  const [savedCardBackgroundPosition, setSavedCardBackgroundPosition] =
    useState(initialCardBackgroundPosition);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [widgetYamlOpen, setWidgetYamlOpen] = useState(false);
  const [widgetYamlDraft, setWidgetYamlDraft] = useState("");
  const [widgetYamlDirty, setWidgetYamlDirty] = useState(false);
  const [widgetYamlError, setWidgetYamlError] = useState("");
  const [threeXuiSources, setThreeXuiSources] = useState([]);
  const [threeXuiSource, setThreeXuiSource] = useState(
    threeXuiSourceFromWidget(initialWidget) || "main",
  );
  const [threeXuiPanelUrl, setThreeXuiPanelUrl] = useState("");
  const [threeXuiToken, setThreeXuiToken] = useState("");
  const [threeXuiConnectionSaving, setThreeXuiConnectionSaving] =
    useState(false);
  const currentType = widgetTypeFromConfig(draft);
  const availableWidgetTypes = [
    ...new Set([
      ...widgetTypes,
      ...widgetCatalog.map((entry) => entry.type),
      ...(currentType ? [currentType] : []),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const catalog =
    widgetCatalog.find((entry) => entry.type === currentType) ?? null;
  const isThreeXui = isThreeXuiWidget(draft);
  const isCustomApi = currentType === "customapi" && !isThreeXui;
  useEffect(() => {
    if (widgetYamlOpen && !widgetYamlDirty) {
      setWidgetYamlDraft(serializeWidgetYaml(draft));
    }
  }, [draft, widgetYamlDirty, widgetYamlOpen]);
  useEffect(() => {
    if (!isThreeXui) {
      return undefined;
    }

    let cancelled = false;
    fetch("/api/config/three-x-ui")
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
      .then((config) => {
        if (cancelled) return;
        const sources = Array.isArray(config?.sources) ? config.sources : [];
        const sourceId = threeXuiSourceFromWidget(draft) || "main";
        setThreeXuiSources(sources);
        setThreeXuiSource(sourceId);
        setThreeXuiPanelUrl(
          sources.find((source) => source.id === sourceId)?.url ?? "",
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(error.message || "Не удалось загрузить подключения 3x-ui");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isThreeXui]);
  const mappingOptions = Array.isArray(draft?.mappings)
    ? draft.mappings
        .map((mapping) => ({
          key: String(mapping?.field ?? ""),
          label: mapping?.label || humanizeWidgetKey(mapping?.field),
          mapping,
        }))
        .filter((entry) => entry.key)
    : [];
  const availableMetrics = isThreeXui
    ? threeXuiMetricDefinitions.map((metric) => ({
        key: metric.key,
        label: metric.label,
      }))
    : mappingOptions.length
      ? mappingOptions
      : (catalog?.fields ?? []).map((field) => ({
          key: field,
          label: humanizeWidgetKey(field),
        }));
  const selectedMetrics = isThreeXui
    ? threeXuiMetricKeysFromWidget(draft).slice(0, 4)
    : mappingOptions.length
      ? mappingOptions.map((entry) => entry.key).slice(0, 4)
      : Array.isArray(draft?.fields) && draft.fields.length
        ? draft.fields.slice(0, 4)
        : availableMetrics.slice(0, 4).map((entry) => entry.key);
  const scalarSettings = Object.entries(draft ?? {}).filter(
    ([key, value]) =>
      key !== "type" &&
      key !== "fields" &&
      key !== "mappings" &&
      !(isThreeXui && ["refreshInterval", "url"].includes(key)) &&
      typeof value !== "boolean" &&
      (typeof value === "string" || typeof value === "number"),
  );
  const booleanKeys = [
    ...new Set([
      ...(booleanOptions?.[currentType] ?? []),
      ...Object.entries(draft ?? {})
        .filter(([, value]) => typeof value === "boolean")
        .map(([key]) => key),
    ]),
  ];
  const previewItem = {
    ...item,
    name: cardDraft.name.trim() || item.name,
    config: {
      ...item.config,
      ...Object.fromEntries(
        studioServiceCardFields
          .filter((key) => cardDraft[key] !== "")
          .map((key) => [key, cardDraft[key]]),
      ),
      ...(cardDraft.serviceUpdate?.enabled
        ? { serviceUpdate: cardDraft.serviceUpdate }
        : {}),
      ...(draft ? { widget: draft } : {}),
      ...(cardBackground.trim() ? { cardBackground } : {}),
      ...(cardBackgroundPosition.trim() ? { cardBackgroundPosition } : {}),
    },
  };
  if (!draft) {
    delete previewItem.config.widget;
  }
  if (!cardBackground.trim()) {
    delete previewItem.config.cardBackground;
  }
  studioServiceCardFields.forEach((key) => {
    if (cardDraft[key] === "") delete previewItem.config[key];
  });
  if (!cardDraft.serviceUpdate?.enabled) {
    delete previewItem.config.serviceUpdate;
  }
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(savedDraft) ||
    JSON.stringify(cardDraft) !== JSON.stringify(savedCardDraft) ||
    cardBackground !== savedCardBackground ||
    cardBackgroundPosition !== savedCardBackgroundPosition;
  const selectedCardColor =
    cardColors.find(([prefix]) =>
      String(cardDraft.id).startsWith(`${prefix}-`),
    )?.[0] ?? "";
  const validTitleColor = /^#[0-9a-f]{6}$/i.test(cardDraft.titleColor)
    ? cardDraft.titleColor
    : "#ffffff";

  const updateCardField = (key, value) => {
    setCardDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const handlePickCardIcon = () => {
    if (typeof onChooseBackground === "function") {
      onChooseBackground((icon) => updateCardField("icon", icon));
      return;
    }
    onPickIcon?.();
  };

  const setMetric = (key, checked) => {
    const nextMetrics = checked
      ? [...new Set([...selectedMetrics, key])]
      : selectedMetrics.filter((field) => field !== key);

    if (checked && nextMetrics.length > 4) {
      setMessage("На карточке можно показать не больше четырёх показателей");
      return;
    }
    if (!nextMetrics.length) {
      setMessage("Оставьте хотя бы один показатель");
      return;
    }

    setMessage("");
    if (isThreeXui) {
      setDraft(
        buildThreeXuiWidget(
          threeXuiSourceFromWidget(draft),
          nextMetrics,
          internalBaseUrl,
        ),
      );
      return;
    }

    if (mappingOptions.length) {
      setDraft((current) => ({
        ...current,
        mappings: mappingOptions
          .filter((entry) => nextMetrics.includes(entry.key))
          .map((entry) => entry.mapping),
      }));
      return;
    }

    setDraft((current) => ({ ...current, fields: nextMetrics }));
  };

  const updateCustomApiMapping = (index, key, value) => {
    setDraft((current) => {
      const mappings = Array.isArray(current?.mappings)
        ? current.mappings.map((mapping) => ({ ...mapping }))
        : [];
      mappings[index] = { ...(mappings[index] ?? {}), [key]: value };
      return { ...current, mappings };
    });
    setMessage("");
  };

  const addCustomApiMapping = () => {
    const mappings = Array.isArray(draft?.mappings) ? draft.mappings : [];
    if ((draft?.display ?? "block") === "block" && mappings.length >= 4) {
      setMessage(
        "В блочном режиме помещается до четырёх показателей. Выберите режим «Список», чтобы добавить больше.",
      );
      return;
    }
    setDraft((current) => ({
      ...current,
      mappings: [
        ...(Array.isArray(current?.mappings) ? current.mappings : []),
        {
          field: "",
          label: `Показатель ${mappings.length + 1}`,
          format: "text",
        },
      ],
    }));
    setMessage("");
  };

  const removeCustomApiMapping = (index) => {
    setDraft((current) => ({
      ...current,
      mappings: (Array.isArray(current?.mappings)
        ? current.mappings
        : []
      ).filter((_, mappingIndex) => mappingIndex !== index),
    }));
    setMessage("");
  };

  const addCustomApiHeader = () => {
    setDraft((current) => ({
      ...current,
      headers: {
        ...(current?.headers && typeof current.headers === "object"
          ? current.headers
          : {}),
        "X-Header": "",
      },
    }));
  };

  const updateCustomApiHeader = (oldKey, nextKey, value) => {
    setDraft((current) => {
      const headers =
        current?.headers && typeof current.headers === "object"
          ? { ...current.headers }
          : {};
      delete headers[oldKey];
      if (nextKey.trim()) headers[nextKey.trim()] = value;
      return { ...current, headers };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const serviceUpdate = serializeServiceUpdateConfig(
        cardDraft.serviceUpdate,
      );
      await onSave(item, draft, {
        ...Object.fromEntries(
          studioServiceCardFields.map((key) => [key, cardDraft[key]]),
        ),
        name: cardDraft.name.trim(),
        cardBackground: cardBackground.trim() || undefined,
        cardBackgroundPosition: cardBackgroundPosition.trim() || undefined,
        serviceUpdate: serviceUpdate || undefined,
      });
      setSavedDraft(draft);
      setSavedCardDraft(cardDraft);
      setSavedCardBackground(cardBackground);
      setSavedCardBackgroundPosition(cardBackgroundPosition);
      setMessage("Настройки виджета сохранены");
    } catch (error) {
      setMessage(error.message || "Не удалось сохранить виджет");
    } finally {
      setSaving(false);
    }
  };

  const toggleWidgetYaml = () => {
    setWidgetYamlOpen((current) => {
      if (!current) {
        setWidgetYamlDraft(serializeWidgetYaml(draft));
        setWidgetYamlDirty(false);
        setWidgetYamlError("");
      }
      return !current;
    });
  };

  const resetWidgetYaml = () => {
    setWidgetYamlDraft(serializeWidgetYaml(draft));
    setWidgetYamlDirty(false);
    setWidgetYamlError("");
  };

  const applyWidgetYaml = () => {
    try {
      const nextWidget = parseWidgetYaml(widgetYamlDraft);
      setDraft(nextWidget);
      setWidgetYamlDraft(serializeWidgetYaml(nextWidget));
      setWidgetYamlDirty(false);
      setWidgetYamlError("");
      setMessage(
        "YAML применён к предпросмотру. Нажмите «Сохранить карточку и виджет», чтобы записать изменения.",
      );
    } catch (error) {
      setWidgetYamlError(error.message || "Не удалось разобрать YAML");
    }
  };

  const saveThreeXuiConnection = async () => {
    const source = threeXuiSource.trim();
    if (!threeXuiSourcePattern.test(source)) {
      setMessage(
        "Имя подключения: латинские буквы, цифры, точка, дефис или подчёркивание",
      );
      return;
    }
    if (!threeXuiPanelUrl.trim()) {
      setMessage("Укажите URL панели 3x-ui");
      return;
    }

    setThreeXuiConnectionSaving(true);
    setMessage("");
    try {
      const response = await editorWriteFetch("/api/config/three-x-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          token: threeXuiToken,
          url: threeXuiPanelUrl.trim(),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const saved = await response.json();
      setThreeXuiSource(saved.id);
      setThreeXuiPanelUrl(saved.url);
      setThreeXuiToken("");
      setThreeXuiSources((current) => [
        ...current.filter((candidate) => candidate.id !== saved.id),
        saved,
      ]);
      setDraft(buildThreeXuiWidget(saved.id, selectedMetrics, internalBaseUrl));
      setMessage(
        "Подключение 3x-ui проверено. Сохраните виджет, чтобы применить его к карточке.",
      );
    } catch (error) {
      setMessage(error.message || "Не удалось сохранить подключение 3x-ui");
    } finally {
      setThreeXuiConnectionSaving(false);
    }
  };

  const widgetYamlSection = (
    <section
      data-studio-yaml-full-width={modalLayout ? "true" : undefined}
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-sm"
    >
      <button
        type="button"
        onClick={toggleWidgetYaml}
        aria-expanded={widgetYamlOpen}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/5"
      >
        <span>
          <span className="block text-xs font-semibold text-zinc-100">
            YAML виджета
          </span>
          <span className="mt-0.5 block text-[10px] text-zinc-400">
            Полная секция widget из конфигурации карточки
          </span>
        </span>
        <span className="text-[10px] font-medium text-zinc-400">
          {widgetYamlOpen ? "Скрыть" : "Показать"}
        </span>
      </button>

      {widgetYamlOpen && (
        <div className="border-t border-white/10 p-3.5">
          <p className="mb-2 text-[10px] leading-relaxed text-zinc-400">
            Сначала примените YAML к предпросмотру, затем сохраните виджет.
            Значение widget: null удалит виджет с карточки.
          </p>
          <StudioYamlEditor
            value={widgetYamlDraft}
            onChange={(value) => {
              setWidgetYamlDraft(value);
              setWidgetYamlDirty(true);
              setWidgetYamlError("");
            }}
          />
          {widgetYamlError && (
            <div
              role="alert"
              className="mt-2 rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-[10px] text-rose-200"
            >
              {widgetYamlError}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={resetWidgetYaml}
              disabled={!widgetYamlDirty}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Сбросить YAML
            </button>
            <button
              type="button"
              onClick={applyWidgetYaml}
              disabled={!widgetYamlDirty}
              className="rounded-xl bg-white px-3 py-2 text-[11px] font-semibold text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Применить YAML
            </button>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Визуальный инспектор
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">
              {cardDraft.name || item.name}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-400">
              {item.groupName} · изменения сразу видны на макете
            </div>
          </div>
          {dirty && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-medium text-zinc-300">
              Не сохранено
            </span>
          )}
        </div>
      </div>

      <div
        className={classNames(
          "items-start gap-4",
          modalLayout
            ? "grid xl:grid-cols-[minmax(360px,1fr)_minmax(420px,1fr)]"
            : "space-y-4",
        )}
      >
        <div className="space-y-4">
          <ServiceCardPreview
            item={previewItem}
            large
            onIconClick={handlePickCardIcon}
            widgetCatalog={catalog}
          />

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-100">
              Цвет карточки
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-label="Без цвета карточки"
                aria-pressed={!selectedCardColor}
                onClick={() =>
                  updateCardField(
                    "id",
                    cardColorId(cardDraft.id, cardDraft.name || item.name, ""),
                  )
                }
                className={classNames(
                  "flex h-7 w-7 items-center justify-center rounded-lg border text-[10px]",
                  !selectedCardColor
                    ? "border-white ring-2 ring-white/25"
                    : "border-white/15",
                )}
              >
                ×
              </button>
              {cardColors.map(([prefix, color]) => (
                <button
                  type="button"
                  key={prefix}
                  aria-label={`Цвет карточки ${prefix}`}
                  aria-pressed={selectedCardColor === prefix}
                  onClick={() =>
                    updateCardField(
                      "id",
                      cardColorId(
                        cardDraft.id,
                        cardDraft.name || item.name,
                        prefix,
                      ),
                    )
                  }
                  className={classNames(
                    "h-7 w-7 rounded-lg border",
                    selectedCardColor === prefix
                      ? "border-white ring-2 ring-white/25"
                      : "border-white/15",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
            <div>
              <div className="text-xs font-semibold text-zinc-100">
                Фоновая картинка
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                Изображение, загрузка и положение сразу видны в предпросмотре.
              </p>
            </div>
            <CardBackgroundControl
              value={cardBackground}
              onChange={(value) => {
                setCardBackground(value);
                setMessage("");
              }}
              onChooseImage={onChooseBackground}
              position={cardBackgroundPosition}
              onPositionChange={(value) => {
                setCardBackgroundPosition(value);
                setMessage("");
              }}
            />
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-100">
              Текст заголовка
            </div>
            <div className="grid grid-cols-[42px_minmax(0,1fr)] items-end gap-2">
              <label className="block text-[10px] text-zinc-400">
                Цвет
                <input
                  type="color"
                  value={validTitleColor}
                  onChange={(event) =>
                    updateCardField("titleColor", event.target.value)
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/10 p-1"
                />
              </label>
              <InspectorField
                label="Цвет заголовка"
                value={cardDraft.titleColor}
                onChange={(value) => updateCardField("titleColor", value)}
                placeholder="#ffffff"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] text-zinc-400">
                Размер
                <select
                  value={cardDraft.titleSize}
                  onChange={(event) =>
                    updateCardField("titleSize", event.target.value)
                  }
                  className={inspectorInputClass}
                >
                  {[
                    "",
                    "10px",
                    "12px",
                    "14px",
                    "16px",
                    "18px",
                    "20px",
                    "24px",
                  ].map((size) => (
                    <option key={size} value={size}>
                      {size || "По умолчанию"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] text-zinc-400">
                Шрифт
                <select
                  value={cardDraft.titleFont}
                  onChange={(event) =>
                    updateCardField("titleFont", event.target.value)
                  }
                  className={inspectorInputClass}
                >
                  {[
                    "",
                    "Comfortaa",
                    "Inter",
                    "Roboto",
                    "system-ui",
                    "Arial",
                    "Georgia",
                    "Courier New",
                  ].map((font) => (
                    <option key={font} value={font}>
                      {font || "По умолчанию"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-[10px] text-zinc-400">
              Выравнивание
              <select
                value={cardDraft.titleAlign}
                onChange={(event) =>
                  updateCardField("titleAlign", event.target.value)
                }
                className={inspectorInputClass}
              >
                <option value="">По умолчанию</option>
                <option value="left">Слева</option>
                <option value="center">По центру</option>
                <option value="right">Справа</option>
              </select>
            </label>
          </section>

          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
            <div className="text-xs font-semibold text-zinc-100">
              Основные настройки карточки
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <InspectorField
                label="Название"
                value={cardDraft.name}
                onChange={(value) => updateCardField("name", value)}
              />
              <InspectorField
                label="URL"
                value={cardDraft.href}
                onChange={(value) => updateCardField("href", value)}
                placeholder="https://example.local"
              />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <InspectorField
                label="Иконка"
                value={cardDraft.icon}
                onChange={(value) => updateCardField("icon", value)}
                placeholder="si-example или /api/config/icon/..."
              />
              <button
                type="button"
                onClick={handlePickCardIcon}
                className="rounded-xl border border-white/15 px-3 py-2 text-xs font-medium transition hover:bg-white/10"
              >
                Выбрать
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <InspectorField
                label="Узел Proxmox"
                value={cardDraft.proxmoxNode}
                onChange={(value) => updateCardField("proxmoxNode", value)}
              />
              <InspectorField
                label="Proxmox VMID"
                value={cardDraft.proxmoxVMID}
                onChange={(value) => updateCardField("proxmoxVMID", value)}
              />
              <label className="block text-[10px] text-zinc-400">
                Тип Proxmox
                <select
                  value={cardDraft.proxmoxType}
                  onChange={(event) =>
                    updateCardField("proxmoxType", event.target.value)
                  }
                  className={inspectorInputClass}
                >
                  <option value="">По умолчанию</option>
                  <option value="lxc">LXC</option>
                  <option value="qemu">QEMU</option>
                </select>
              </label>
            </div>
          </section>

          <StudioServiceUpdateControl
            value={cardDraft.serviceUpdate}
            onChange={(value) => updateCardField("serviceUpdate", value)}
          />
        </div>

        <div
          data-studio-widget-settings={modalLayout ? "true" : undefined}
          className={classNames(
            modalLayout ? "flex flex-col gap-4" : "mt-4 space-y-4",
          )}
        >
          <section className="order-[20] space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
            <div>
              <div className="text-xs font-semibold text-zinc-100">
                Дополнительные настройки
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-400">
                Параметры карточки без оформления заголовка.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["description", "Описание"],
                ["abbr", "Сокращение"],
                ["target", "Цель ссылки"],
                ["weight", "Вес"],
                ["ping", "Пинг"],
                ["siteMonitor", "Мониторинг сайта"],
                ["showStats", "Показывать статистику"],
              ].map(([key, label]) => (
                <InspectorField
                  key={key}
                  label={label}
                  value={cardDraft[key]}
                  onChange={(value) => updateCardField(key, value)}
                />
              ))}
            </div>
          </section>

          <section className="order-[-10] rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
            <label className="block text-[11px] font-medium text-zinc-300">
              Шаблон интеграции виджета
              <select
                value={currentType}
                onChange={(event) => {
                  setDraft(
                    widgetFromTemplate(
                      event.target.value,
                      templates,
                      internalBaseUrl,
                    ),
                  );
                  setMessage("");
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-sm text-zinc-100 outline-hidden transition focus:border-white/30 focus:bg-zinc-900 focus:ring-2 focus:ring-white/10"
              >
                <option value="">Без виджета</option>
                {availableWidgetTypes.map((type) => (
                  <option key={type} value={type}>
                    {type === "3xui" ? "3x-ui" : type}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {draft && availableMetrics.length > 0 && !isCustomApi && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-zinc-100">
                    Показатели на карточке
                  </div>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                    Выберите до четырёх значений. Макет выше обновляется сразу.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-zinc-200">
                  {selectedMetrics.length}/4
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {availableMetrics.map((metric) => {
                  const checked = selectedMetrics.includes(metric.key);
                  return (
                    <label
                      key={metric.key}
                      className={classNames(
                        "flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] transition-colors",
                        checked
                          ? "border-white/25 bg-white/10 text-white"
                          : "border-white/10 bg-black/10 text-zinc-400 hover:border-white/20 hover:bg-white/5",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setMetric(metric.key, event.target.checked)
                        }
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-200 accent-white focus:ring-white/30"
                        style={{ accentColor: "#e4e4e7" }}
                      />
                      <span className="min-w-0 truncate" title={metric.label}>
                        {metric.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {isCustomApi && (
            <section
              className={classNames(
                "space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3 shadow-sm",
                modalLayout && "sm:col-span-2",
              )}
            >
              <div>
                <div className="text-xs font-semibold text-zinc-100">
                  Custom API
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                  Endpoint, способ запроса и подписи показателей на карточке.
                </p>
              </div>
              <InspectorField
                label="URL API"
                value={draft.url ?? ""}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, url: value }))
                }
                placeholder="http://service.local/api/status"
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[10px] text-zinc-400">
                  Метод
                  <select
                    value={draft.method ?? "GET"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        method: event.target.value,
                      }))
                    }
                    className={inspectorInputClass}
                  >
                    {["GET", "POST", "PUT", "PATCH"].map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[10px] text-zinc-400">
                  Отображение
                  <select
                    value={draft.display ?? "block"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        display: event.target.value,
                      }))
                    }
                    className={inspectorInputClass}
                  >
                    <option value="block">Блоки (до 4)</option>
                    <option value="list">Список</option>
                  </select>
                </label>
              </div>
              <InspectorField
                label="Интервал, мс"
                type="number"
                value={draft.refreshInterval ?? 10000}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    refreshInterval: Math.max(1000, Number(value) || 10000),
                  }))
                }
              />
              {(draft.method ?? "GET") !== "GET" && (
                <InspectorField
                  label="Тело запроса (строка или JSON)"
                  value={
                    typeof draft.requestBody === "string"
                      ? draft.requestBody
                      : JSON.stringify(draft.requestBody ?? {})
                  }
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, requestBody: value }))
                  }
                />
              )}

              <div className="rounded-xl border border-white/10 bg-black/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold">
                    HTTP-заголовки
                  </div>
                  <button
                    type="button"
                    onClick={addCustomApiHeader}
                    className="rounded-lg border border-white/10 px-2 py-1 text-[10px] hover:bg-white/10"
                  >
                    + Заголовок
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {Object.entries(
                    draft.headers && typeof draft.headers === "object"
                      ? draft.headers
                      : {},
                  ).map(([key, value], index) => (
                    <div key={index} className="grid grid-cols-2 gap-2">
                      <input
                        value={key}
                        onChange={(event) =>
                          updateCustomApiHeader(key, event.target.value, value)
                        }
                        aria-label="Название HTTP-заголовка"
                        className={inspectorInputClass}
                      />
                      <input
                        type={
                          /authorization|token|key/i.test(key)
                            ? "password"
                            : "text"
                        }
                        value={String(value ?? "")}
                        onChange={(event) =>
                          updateCustomApiHeader(key, key, event.target.value)
                        }
                        aria-label={`Значение ${key}`}
                        className={inspectorInputClass}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold">
                      Показатели API
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      Поле JSON и собственное название для дашборда
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={addCustomApiMapping}
                    className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] hover:bg-white/10"
                  >
                    + Показатель
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {(Array.isArray(draft.mappings) ? draft.mappings : []).map(
                    (mapping, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-white/10 bg-black/10 p-2.5"
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <InspectorField
                            label="Название"
                            value={mapping.label ?? ""}
                            onChange={(value) =>
                              updateCustomApiMapping(index, "label", value)
                            }
                          />
                          <InspectorField
                            label="Поле JSON"
                            value={mapping.field ?? ""}
                            onChange={(value) =>
                              updateCustomApiMapping(index, "field", value)
                            }
                            placeholder="data.online"
                          />
                        </div>
                        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                          <label className="block text-[10px] text-zinc-400">
                            Формат
                            <select
                              value={mapping.format ?? "text"}
                              onChange={(event) =>
                                updateCustomApiMapping(
                                  index,
                                  "format",
                                  event.target.value,
                                )
                              }
                              className={inspectorInputClass}
                            >
                              {[
                                "text",
                                "number",
                                "float",
                                "percent",
                                "bytes",
                                "bitrate",
                                "duration",
                                "size",
                                "date",
                                "relativeDate",
                              ].map((format) => (
                                <option key={format}>{format}</option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => removeCustomApiMapping(index)}
                            className="mb-0.5 rounded-lg border border-rose-400/30 px-2.5 py-2 text-[10px] text-rose-300"
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </section>
          )}

          {isThreeXui && (
            <section
              className={classNames(
                "rounded-2xl border border-white/10 bg-white/5 p-3 shadow-sm",
                modalLayout && "sm:col-span-2",
              )}
            >
              <div className="text-xs font-semibold text-zinc-100">
                Подключение к 3x-ui
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                Подключение хранится отдельно, а в карточку попадёт только его
                безопасный идентификатор.
              </p>
              <div className="mt-3 grid gap-2">
                <label className="block text-[10px] font-medium text-zinc-500">
                  Имя подключения
                  <input
                    type="text"
                    list="studio-three-x-ui-sources"
                    value={threeXuiSource}
                    onChange={(event) => {
                      const source = event.target.value;
                      setThreeXuiSource(source);
                      const existing = threeXuiSources.find(
                        (candidate) => candidate.id === source,
                      );
                      if (existing) setThreeXuiPanelUrl(existing.url);
                      if (threeXuiSourcePattern.test(source)) {
                        setDraft(
                          buildThreeXuiWidget(
                            source,
                            selectedMetrics,
                            internalBaseUrl,
                          ),
                        );
                      }
                    }}
                    className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-xs text-zinc-100 outline-hidden transition focus:border-white/30 focus:ring-2 focus:ring-white/10"
                  />
                  <datalist id="studio-three-x-ui-sources">
                    {threeXuiSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.url}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="block text-[10px] font-medium text-zinc-500">
                  URL панели со скрытым путём
                  <input
                    type="url"
                    value={threeXuiPanelUrl}
                    onChange={(event) =>
                      setThreeXuiPanelUrl(event.target.value)
                    }
                    placeholder="https://3x.example.com/secret-path"
                    className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-xs text-zinc-100 outline-hidden transition focus:border-white/30 focus:ring-2 focus:ring-white/10"
                  />
                </label>
                <label className="block text-[10px] font-medium text-zinc-500">
                  API-токен
                  <input
                    type="password"
                    value={threeXuiToken}
                    onChange={(event) => setThreeXuiToken(event.target.value)}
                    placeholder={
                      threeXuiSources.some(
                        (source) => source.id === threeXuiSource,
                      )
                        ? "Уже сохранён — оставьте пустым, чтобы не менять"
                        : "Bearer API token"
                    }
                    autoComplete="new-password"
                    className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-xs text-zinc-100 outline-hidden transition focus:border-white/30 focus:ring-2 focus:ring-white/10"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={saveThreeXuiConnection}
                disabled={threeXuiConnectionSaving}
                className="mt-3 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50"
              >
                {threeXuiConnectionSaving
                  ? "Проверка подключения…"
                  : "Проверить и сохранить подключение"}
              </button>
            </section>
          )}

          {draft && scalarSettings.length > 0 && !isCustomApi && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
              <div className="text-xs font-semibold text-zinc-100">
                Подключение и параметры
              </div>
              <div className="mt-3 grid gap-2">
                {scalarSettings.map(([key, value]) => (
                  <label
                    key={key}
                    className="block text-[10px] font-medium text-zinc-500"
                  >
                    {isThreeXui && key === "url"
                      ? "Внутренний источник 3x-ui"
                      : widgetSettingLabel(key)}
                    <input
                      type={
                        /password|token|key/i.test(key) ? "password" : "text"
                      }
                      value={value}
                      readOnly={isThreeXui && key === "url"}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [key]:
                            typeof value === "number"
                              ? Number(event.target.value)
                              : event.target.value,
                        }))
                      }
                      className="mt-1 h-9 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-xs text-zinc-100 outline-hidden transition read-only:text-zinc-500 focus:border-white/30 focus:ring-2 focus:ring-white/10"
                    />
                  </label>
                ))}
              </div>
            </section>
          )}

          {draft && booleanKeys.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-3.5 shadow-sm">
              <div className="text-xs font-semibold text-zinc-100">
                Возможности виджета
              </div>
              <div className="mt-3 space-y-2">
                {booleanKeys.map((key) => (
                  <label
                    key={key}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/10 px-3 py-2.5 text-[11px] text-zinc-300"
                  >
                    <span>{translations?.[key] ?? humanizeWidgetKey(key)}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(draft[key])}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-200 accent-white focus:ring-white/30"
                      style={{ accentColor: "#e4e4e7" }}
                    />
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {widgetYamlSection}

      {message && (
        <div
          className={classNames(
            "rounded-xl px-3 py-2 text-[11px]",
            "border border-white/10 bg-white/5 text-zinc-300",
          )}
        >
          {message}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="w-full rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-zinc-950 shadow-sm shadow-black/20 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Сохранение…" : "Сохранить карточку и виджет"}
        </button>
      </div>
    </div>
  );
}

export function StudioModalWindow({
  ariaLabel,
  bodyClassName = "",
  children,
  defaultHeight = 760,
  defaultWidth = 1040,
  description,
  minHeight = 520,
  minWidth = 680,
  onClose,
  title,
  zIndex = 500,
}) {
  const initialStudioStyle = useMemo(readStudioStyle, []);
  const palette = initialStudioStyle.palette;
  const windowRef = useRef(null);
  const [windowRect, setWindowRect] = useState(() => {
    const viewportWidth =
      typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight =
      typeof window === "undefined" ? 900 : window.innerHeight;
    const width = Math.min(defaultWidth, viewportWidth - 24);
    const height = Math.min(defaultHeight, viewportHeight - 24);
    return {
      height,
      width,
      x: Math.max(8, Math.round((viewportWidth - width) / 2)),
      y: Math.max(8, Math.round((viewportHeight - height) / 2)),
    };
  });
  const [windowDrag, setWindowDrag] = useState(null);
  const themeStyle = {
    ...monochromeThemeColors,
    "--studio-accent": palette.accent,
    "--studio-active-text": palette.activeText,
    "--studio-bg": palette.background,
    "--studio-muted": palette.mutedText,
    "--studio-panel": palette.panel,
    "--studio-text": palette.text,
  };

  useEffect(() => {
    if (!windowDrag || typeof window === "undefined") return undefined;

    const move = (event) => {
      setWindowRect((current) => ({
        ...current,
        x: Math.min(
          Math.max(8, window.innerWidth - current.width - 8),
          Math.max(8, windowDrag.x + event.clientX - windowDrag.clientX),
        ),
        y: Math.min(
          Math.max(8, window.innerHeight - current.height - 8),
          Math.max(8, windowDrag.y + event.clientY - windowDrag.clientY),
        ),
      }));
    };
    const stop = () => setWindowDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [windowDrag]);

  useEffect(() => {
    const node = windowRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setWindowRect((current) =>
        current.width === width && current.height === height
          ? current
          : { ...current, height, width },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const clampToViewport = () => {
      setWindowRect((current) => {
        const width = Math.min(current.width, window.innerWidth - 16);
        const height = Math.min(current.height, window.innerHeight - 16);
        return {
          height,
          width,
          x: Math.min(current.x, Math.max(8, window.innerWidth - width - 8)),
          y: Math.min(current.y, Math.max(8, window.innerHeight - height - 8)),
        };
      });
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const beginWindowDrag = (event) => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return;
    if (
      event.button !== 0 ||
      event.target.closest("button, input, select, textarea, a")
    ) {
      return;
    }
    event.preventDefault();
    setWindowDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      x: windowRect.x,
      y: windowRect.y,
    });
  };

  const actualMinWidth =
    typeof window === "undefined"
      ? minWidth
      : Math.min(minWidth, window.innerWidth - 16);
  const actualMinHeight =
    typeof window === "undefined"
      ? minHeight
      : Math.min(minHeight, window.innerHeight - 16);
  const compactViewport =
    typeof window !== "undefined" && window.innerWidth < 640;

  return (
    <div
      className="homepage-configurator-ui homepage-studio-editor-window homepage-themed-configurator dark fixed inset-0 z-[500] bg-black/65 text-zinc-100 backdrop-blur-sm"
      style={{ ...themeStyle, zIndex }}
    >
      <section
        ref={windowRef}
        data-studio-editor-window="true"
        data-studio-modal-window="true"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title}
        className="absolute flex flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_100px_-24px_rgba(0,0,0,0.85)] ring-1 ring-white/5 sm:rounded-3xl"
        style={{
          backgroundColor: "var(--studio-bg)",
          backgroundImage: studioEffectBackground(palette),
          color: "var(--studio-text)",
          height: `${windowRect.height}px`,
          left: `${windowRect.x}px`,
          maxHeight: "calc(100vh - 16px)",
          maxWidth: "calc(100vw - 16px)",
          minHeight: `${actualMinHeight}px`,
          minWidth: `${actualMinWidth}px`,
          resize: compactViewport ? "none" : "both",
          top: `${windowRect.y}px`,
          width: `${windowRect.width}px`,
        }}
      >
        <header
          className="flex min-h-[68px] shrink-0 cursor-default select-none items-center justify-between gap-3 border-b border-white/10 px-3 backdrop-blur-xl sm:min-h-[72px] sm:cursor-move sm:px-5"
          style={{ backgroundColor: "var(--studio-panel)" }}
          onPointerDown={beginWindowDrag}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Студия кастомизации
            </div>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-zinc-100">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl leading-none text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            aria-label="Закрыть окно"
            title="Закрыть"
          >
            ×
          </button>
        </header>
        <div
          className={classNames(
            "min-h-0 flex-1 overflow-y-auto p-3 sm:p-5",
            bodyClassName,
          )}
        >
          {children}
        </div>
      </section>
    </div>
  );
}

export function StudioServiceWidgetModal({
  booleanOptions,
  internalBaseUrl,
  item,
  onChooseBackground,
  onClose,
  onOpenItem,
  onPickIcon,
  onSave,
  templates,
  translations,
  widgetCatalog,
  widgetTypes,
}) {
  const initialStudioStyle = useMemo(readStudioStyle, []);
  const palette = initialStudioStyle.palette;
  const windowRef = useRef(null);
  const [windowRect, setWindowRect] = useState(() => {
    const viewportWidth =
      typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight =
      typeof window === "undefined" ? 900 : window.innerHeight;
    const width = Math.min(1240, viewportWidth - 24);
    const height = Math.min(860, viewportHeight - 24);
    return {
      height,
      width,
      x: Math.max(8, Math.round((viewportWidth - width) / 2)),
      y: Math.max(8, Math.round((viewportHeight - height) / 2)),
    };
  });
  const [windowDrag, setWindowDrag] = useState(null);
  const themeStyle = {
    ...monochromeThemeColors,
    "--studio-accent": palette.accent,
    "--studio-active-text": palette.activeText,
    "--studio-bg": palette.background,
    "--studio-muted": palette.mutedText,
    "--studio-panel": palette.panel,
    "--studio-text": palette.text,
  };

  useEffect(() => {
    if (!windowDrag || typeof window === "undefined") return undefined;

    const move = (event) => {
      setWindowRect((current) => ({
        ...current,
        x: Math.min(
          Math.max(8, window.innerWidth - current.width - 8),
          Math.max(8, windowDrag.x + event.clientX - windowDrag.clientX),
        ),
        y: Math.min(
          Math.max(8, window.innerHeight - current.height - 8),
          Math.max(8, windowDrag.y + event.clientY - windowDrag.clientY),
        ),
      }));
    };
    const stop = () => setWindowDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [windowDrag]);

  useEffect(() => {
    const node = windowRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setWindowRect((current) =>
        current.width === width && current.height === height
          ? current
          : { ...current, height, width },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const clampToViewport = () => {
      setWindowRect((current) => {
        const width = Math.min(current.width, window.innerWidth - 16);
        const height = Math.min(current.height, window.innerHeight - 16);
        return {
          height,
          width,
          x: Math.min(current.x, Math.max(8, window.innerWidth - width - 8)),
          y: Math.min(current.y, Math.max(8, window.innerHeight - height - 8)),
        };
      });
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const beginWindowDrag = (event) => {
    if (typeof window !== "undefined" && window.innerWidth < 640) return;
    if (
      event.button !== 0 ||
      event.target.closest("button, input, select, textarea, a")
    ) {
      return;
    }
    event.preventDefault();
    setWindowDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      x: windowRect.x,
      y: windowRect.y,
    });
  };

  const minWindowWidth =
    typeof window === "undefined" ? 900 : Math.min(900, window.innerWidth - 16);
  const minWindowHeight =
    typeof window === "undefined"
      ? 560
      : Math.min(560, window.innerHeight - 16);
  const compactViewport =
    typeof window !== "undefined" && window.innerWidth < 640;

  return (
    <div
      className="homepage-configurator-ui dark fixed inset-0 z-[500] bg-black/65 text-zinc-100 backdrop-blur-sm"
      style={themeStyle}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={windowRef}
        data-studio-service-widget-window="true"
        role="dialog"
        aria-modal="true"
        aria-label={`Редактор виджета сервиса: ${item.name}`}
        className="absolute flex flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_100px_-24px_rgba(0,0,0,0.85)] ring-1 ring-white/5 sm:rounded-3xl"
        style={{
          backgroundColor: "var(--studio-bg)",
          backgroundImage: studioEffectBackground(palette),
          color: "var(--studio-text)",
          height: `${windowRect.height}px`,
          left: `${windowRect.x}px`,
          maxHeight: "calc(100vh - 16px)",
          maxWidth: "calc(100vw - 16px)",
          minHeight: `${minWindowHeight}px`,
          minWidth: `${minWindowWidth}px`,
          resize: compactViewport ? "none" : "both",
          top: `${windowRect.y}px`,
          width: `${windowRect.width}px`,
        }}
      >
        <header
          className="flex min-h-[68px] shrink-0 cursor-default select-none items-center justify-between gap-3 border-b border-white/10 px-3 backdrop-blur-xl sm:min-h-[72px] sm:cursor-move sm:px-5"
          style={{ backgroundColor: "var(--studio-panel)" }}
          onPointerDown={beginWindowDrag}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              Студия кастомизации
            </div>
            <h2 className="mt-0.5 truncate text-lg font-semibold text-zinc-100">
              Виджет сервиса
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
              Визуальный инспектор карточки на холсте
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl leading-none text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            aria-label="Закрыть редактор виджета сервиса"
            title="Закрыть"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <ServiceWidgetInspector
            booleanOptions={booleanOptions}
            internalBaseUrl={internalBaseUrl}
            item={item}
            modalLayout
            onChooseBackground={onChooseBackground}
            onOpenItem={onOpenItem}
            onPickIcon={onPickIcon}
            onSave={onSave}
            templates={templates}
            translations={translations}
            widgetCatalog={widgetCatalog}
            widgetTypes={widgetTypes}
          />
        </div>
      </section>
    </div>
  );
}

function ResourceWidgetPreview({ draft }) {
  const metrics = [
    draft.cpu && ["CPU", "34%"],
    draft.memory && ["RAM", "61%"],
    draft.disk && ["Диск", "72%"],
    draft.network && ["Сеть", "12 MB/s"],
    draft.cputemp && ["Темп.", "48°"],
    draft.uptime && ["Uptime", "12d"],
  ].filter(Boolean);
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/15 p-4">
      <div
        className={classNames(
          "grid gap-2",
          metrics.length > 3 ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-2"
          >
            <div className="text-[9px] uppercase tracking-wide text-zinc-500">
              {label}
            </div>
            <div className="mt-1 text-xs font-semibold">{value}</div>
            {draft.expanded && (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-2/3 rounded-full bg-emerald-400" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 text-center text-[10px] text-zinc-400">
        {draft.label || "Ресурсы сервера"}
      </div>
    </div>
  );
}

function ResourceWidgetInspector({ entry, onClose, onSave }) {
  const initialDraft = {
    cpu: entry?.config?.cpu !== false,
    cputemp: entry?.config?.cputemp === true,
    disk: entry?.config?.disk ?? "/",
    diskUnits: entry?.config?.diskUnits ?? "bytes",
    expanded: entry?.config?.expanded === true,
    href: entry?.config?.href ?? "",
    label: entry?.config?.label ?? "",
    memory: entry?.config?.memory !== false,
    network: entry?.config?.network ?? "",
    refresh: entry?.config?.refresh ?? 1500,
    units: entry?.config?.units ?? "metric",
    uptime: entry?.config?.uptime === true,
  };
  const [draft, setDraft] = useState(initialDraft);
  const [savedDraft, setSavedDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const update = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const normalized = {
        ...draft,
        disk: draft.disk || false,
        refresh: Math.max(1000, Number(draft.refresh) || 1500),
      };
      if (!normalized.network) delete normalized.network;
      if (!normalized.href) delete normalized.href;
      await onSave(
        entry?.index ?? null,
        normalized,
        entry?.isNew ? "add" : "save",
      );
      setSavedDraft(normalized);
      setDraft(normalized);
      setMessage(
        entry?.isNew ? "Виджет resources добавлен" : "Виджет сохранён",
      );
      if (entry?.isNew) onClose();
    } catch (error) {
      setMessage(error.message || "Не удалось сохранить resources");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Удалить этот виджет resources из верхней панели?")) {
      return;
    }
    setSaving(true);
    try {
      await onSave(entry.index, null, "delete");
      onClose();
    } catch (error) {
      setMessage(error.message || "Не удалось удалить виджет");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Верхняя панель · resources
        </div>
        <div className="mt-1 text-base font-semibold">
          {entry?.isNew ? "Новый монитор ресурсов" : draft.label || "Resources"}
        </div>
        <div className="mt-0.5 text-[10px] text-zinc-500">
          Можно добавить несколько независимых виджетов
        </div>
      </div>

      <ResourceWidgetPreview draft={draft} />

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div className="text-xs font-semibold">Название и данные</div>
        <InspectorField
          label="Название"
          value={draft.label}
          onChange={(value) => update("label", value)}
          placeholder="Основной сервер"
        />
        <div className="grid grid-cols-2 gap-2">
          {[
            ["cpu", "CPU"],
            ["memory", "Память"],
            ["uptime", "Uptime"],
            ["cputemp", "Температура CPU"],
          ].map(([key, label]) => (
            <InspectorCheckbox
              key={key}
              checked={Boolean(draft[key])}
              label={label}
              onChange={(checked) => update(key, checked)}
            />
          ))}
        </div>
        <InspectorField
          label="Диск / точка монтирования"
          value={draft.disk === false ? "" : draft.disk}
          onChange={(value) => update("disk", value)}
          placeholder="/ или /data; пусто — скрыть"
        />
        <InspectorField
          label="Сетевой интерфейс"
          value={draft.network}
          onChange={(value) => update("network", value)}
          placeholder="eth0; пусто — скрыть"
        />
      </section>

      <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
        <div>
          <div className="text-xs font-semibold">Оформление и поведение</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Компактный или расширенный вид, единицы и ссылка
          </div>
        </div>
        <InspectorCheckbox
          checked={draft.expanded}
          label="Расширенные индикаторы"
          note="Добавляет полосы загрузки и дополнительные значения"
          onChange={(checked) => update("expanded", checked)}
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[10px] text-zinc-400">
            Температура
            <select
              value={draft.units}
              onChange={(event) => update("units", event.target.value)}
              className={inspectorInputClass}
            >
              <option value="metric">°C</option>
              <option value="imperial">°F</option>
            </select>
          </label>
          <label className="block text-[10px] text-zinc-400">
            Диск
            <select
              value={draft.diskUnits}
              onChange={(event) => update("diskUnits", event.target.value)}
              className={inspectorInputClass}
            >
              <option value="bytes">Авто</option>
              <option value="bbytes">Десятичные</option>
            </select>
          </label>
        </div>
        <InspectorField
          label="Обновление, мс"
          type="number"
          value={draft.refresh}
          onChange={(value) => update("refresh", value)}
        />
        <InspectorField
          label="Ссылка при нажатии"
          value={draft.href}
          onChange={(value) => update("href", value)}
          placeholder="https://monitoring.local"
        />
      </section>

      {message && (
        <div className="rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-zinc-300">
          {message}
        </div>
      )}
      <div
        className="sticky bottom-0 z-20 -mx-1 flex gap-2 border-t border-white/10 px-1 py-3"
        style={{
          backgroundColor: "var(--studio-panel)",
          boxShadow: "0 -12px 24px var(--studio-panel)",
        }}
      >
        {!entry?.isNew && (
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            className="rounded-xl border border-rose-400/40 px-3 py-2.5 text-xs text-rose-300 disabled:opacity-50"
          >
            Удалить
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving || (!entry?.isNew && !dirty)}
          className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
        >
          {saving
            ? "Сохранение…"
            : entry?.isNew
              ? "Добавить resources"
              : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, note, accent }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: accent }}
        />
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums text-zinc-950 dark:text-white">
        {value}
      </div>
      <div className="mt-1 text-[10px] text-zinc-400">{note}</div>
    </div>
  );
}

export default function DashboardStudio({
  data,
  onClose,
  onOpenAppearance,
  onOpenConfig,
  onOpenIcons,
  onOpenItem,
  onOpenNewGroup,
  onOpenNewItem,
  onOpenTopWidget,
  onOpenUpdates,
  onChooseIcon,
  onPickItemIcon,
  onPickTopWidgetIcon,
  onSaveBookmark,
  onSaveGroup,
  onSaveNewItem,
  onSavePage,
  onSavePageStyles,
  onSaveServiceWidget,
  onSaveTopWidget,
  onMoveItem,
  widgetBooleanOptions = {},
  widgetTemplates = {},
  widgetTranslations = {},
  widgetTypes = [],
}) {
  useLayoutEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const themeClasses = ["dark", "light", "scheme-dark", "scheme-light"];
    const previousThemeClasses = themeClasses.filter((className) =>
      root.classList.contains(className),
    );

    root.classList.remove(...themeClasses);
    root.classList.add("dark", "scheme-dark");

    return () => {
      root.classList.remove(...themeClasses);
      root.classList.add(...previousThemeClasses);
    };
  }, []);

  const serviceGroups = useMemo(
    () => rawGroups(data?.services, "services"),
    [data?.services],
  );
  const bookmarkGroups = useMemo(
    () => rawGroups(data?.bookmarks, "bookmarks"),
    [data?.bookmarks],
  );
  const services = useMemo(
    () => serviceGroups.flatMap((group) => group.items),
    [serviceGroups],
  );
  const bookmarks = useMemo(
    () => bookmarkGroups.flatMap((group) => group.items),
    [bookmarkGroups],
  );
  const topWidgets = useMemo(
    () => parseTopWidgets(data?.settingsTabs),
    [data?.settingsTabs],
  );
  const widgetServices = useMemo(
    () => services.filter((item) => widgetFromItem(item)),
    [services],
  );
  const pageData = useMemo(
    () => studioPageRecords(data?.settings, data?.services, data?.bookmarks),
    [data?.bookmarks, data?.services, data?.settings],
  );
  const pages = pageData.pages;
  const pageGroups = pageData.groups;
  const [section, setSection] = useState("overview");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState(services[0]?.key ?? "");
  const [selectedGroupRef, setSelectedGroupRef] = useState(null);
  const [selectedTopWidget, setSelectedTopWidget] = useState(null);
  const [newItemTarget, setNewItemTarget] = useState(null);
  const [selectedPageName, setSelectedPageName] = useState(
    pages[0]?.name ?? "",
  );
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [pageInspectorMode, setPageInspectorMode] = useState("page");
  const [draggedStudioItem, setDraggedStudioItem] = useState(null);
  const studioWindowRef = useRef(null);
  const [studioWindow, setStudioWindow] = useState(
    readStoredStudioWindowGeometry,
  );
  const [studioDrag, setStudioDrag] = useState(null);
  const initialStudioStyle = useMemo(readStudioStyle, []);
  const [studioSchemeId, setStudioSchemeId] = useState(
    initialStudioStyle.schemeId,
  );
  const [studioPalette, setStudioPalette] = useState(
    initialStudioStyle.palette,
  );
  const studioThemeStyle = {
    ...monochromeThemeColors,
    "--studio-accent": studioPalette.accent,
    "--studio-active-text": studioPalette.activeText,
    "--studio-bg": studioPalette.background,
    "--studio-muted": studioPalette.mutedText,
    "--studio-panel": studioPalette.panel,
    "--studio-text": studioPalette.text,
  };

  useEffect(() => {
    if (!studioDrag) return undefined;
    const move = (event) => {
      setStudioWindow((current) =>
        clampStudioWindowGeometry({
          ...current,
          x: studioDrag.x + event.clientX - studioDrag.clientX,
          y: studioDrag.y + event.clientY - studioDrag.clientY,
        }),
      );
    };
    const stop = () => setStudioDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [studioDrag]);

  useEffect(() => {
    const node = studioWindowRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setStudioWindow((current) =>
        current.width === width && current.height === height
          ? current
          : clampStudioWindowGeometry({ ...current, height, width }),
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const clampToViewport = () =>
      setStudioWindow((current) => clampStudioWindowGeometry(current));
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      STUDIO_WINDOW_STORAGE_KEY,
      JSON.stringify(studioWindow),
    );
  }, [studioWindow]);

  function beginStudioDrag(event) {
    if (typeof window !== "undefined" && window.innerWidth < 640) return;
    if (event.target.closest("button, input, select, textarea, a")) return;
    event.preventDefault();
    setStudioDrag({
      clientX: event.clientX,
      clientY: event.clientY,
      x: studioWindow.x,
      y: studioWindow.y,
    });
  }

  function startStudioItemDrag(event, item) {
    setDraggedStudioItem(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.key);
  }

  function dropStudioItem(event, target) {
    event.preventDefault();
    const source = draggedStudioItem;
    setDraggedStudioItem(null);
    if (!source || !target || source.key === target.key || !onMoveItem) return;
    onMoveItem(
      source.type,
      source.groupName,
      source.name,
      target.groupName,
      target.name,
      null,
      null,
      source.itemIndex,
      target.itemIndex,
    );
  }

  function selectStudioScheme(schemeId) {
    const scheme =
      studioColorSchemes.find((candidate) => candidate.id === schemeId) ??
      studioColorSchemes[0];
    const nextPalette = paletteFromScheme(scheme);
    setStudioSchemeId(schemeId);
    setStudioPalette(nextPalette);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STUDIO_SCHEME_STORAGE_KEY, schemeId);
      window.localStorage.setItem(
        STUDIO_STYLE_STORAGE_KEY,
        JSON.stringify(nextPalette),
      );
    }
  }

  function updateStudioPalette(key, value) {
    setStudioPalette((current) => {
      const next = { ...current, [key]: value };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          STUDIO_STYLE_STORAGE_KEY,
          JSON.stringify(next),
        );
      }
      return next;
    });
  }

  const sectionItems =
    section === "bookmarks"
      ? bookmarks
      : section === "widgets"
        ? widgetServices
        : services;
  const filteredItems = sectionItems.filter((item) =>
    itemMatches(item, search),
  );
  const selectedItem =
    selectedGroupRef || selectedTopWidget || newItemTarget
      ? null
      : (sectionItems.find((item) => item.key === selectedKey) ??
        filteredItems[0] ??
        null);

  useEffect(() => {
    if (
      !filteredItems.length ||
      filteredItems.some((item) => item.key === selectedKey)
    ) {
      return;
    }
    setSelectedKey(filteredItems[0].key);
  }, [filteredItems, selectedKey]);

  useEffect(() => {
    if (newPageOpen) return;
    if (
      selectedPageName &&
      pages.some((page) => namesEqual(page.name, selectedPageName))
    ) {
      return;
    }
    setSelectedPageName(pages[0]?.name ?? "");
  }, [newPageOpen, pages, selectedPageName]);

  const selectedPage =
    pages.find((page) => namesEqual(page.name, selectedPageName)) ?? null;

  const groups =
    section === "bookmarks"
      ? bookmarkGroups
      : section === "widgets"
        ? serviceGroups
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => widgetFromItem(item)),
            }))
            .filter((group) => group.items.length)
        : serviceGroups;
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => itemMatches(item, search)),
    }))
    .filter((group) => group.items.length);
  const selectedGroup = selectedGroupRef
    ? (groups.find(
        (group) =>
          group.type === selectedGroupRef.type &&
          namesEqual(group.name, selectedGroupRef.name),
      ) ?? null)
    : null;
  const selectedGroupLayout = selectedGroup
    ? groupLayoutFromSettings(
        data?.settings,
        selectedGroup.type,
        selectedGroup.name,
      )
    : {};
  const serviceWidgetCatalog = Array.isArray(data?.serviceWidgetCatalog)
    ? data.serviceWidgetCatalog
    : [];
  const activeWidget = widgetFromItem(selectedItem);
  const activeWidgetCatalog =
    serviceWidgetCatalog.find(
      (entry) => entry.type === widgetTypeFromConfig(activeWidget),
    ) ?? null;
  const compactStudioViewport =
    typeof window !== "undefined" && window.innerWidth < 640;

  if (!data) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[400] flex items-center justify-center p-4">
        <div
          className="pointer-events-auto w-full max-w-md rounded-3xl border border-white/15 bg-zinc-950 px-8 py-9 text-center text-white shadow-[0_32px_100px_-20px_rgba(0,0,0,0.8)]"
          role="dialog"
          aria-modal="true"
          aria-label="Настройка дашборда"
        >
          <div className="text-lg font-semibold">Настройка дашборда</div>
          <div className="mt-2 text-xs text-zinc-400">
            Загружаю структуру и настройки дашборда…
          </div>
          <div className="mx-auto mt-5 h-1 w-40 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-white/80" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 text-xs text-zinc-500 transition-colors hover:text-white"
          >
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="homepage-configurator-ui pointer-events-none fixed inset-0 z-[400] text-zinc-100"
      style={studioThemeStyle}
    >
      <div
        ref={studioWindowRef}
        id="dashboard-studio-shell"
        className="pointer-events-auto absolute flex max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_28px_90px_-30px_rgba(0,0,0,0.75)] ring-1 ring-white/5 sm:rounded-3xl"
        style={{
          backgroundColor: "var(--studio-bg)",
          backgroundImage: studioEffectBackground(studioPalette),
          color: "var(--studio-text)",
          height: `${studioWindow.height}px`,
          left: `${studioWindow.x}px`,
          resize: compactStudioViewport ? "none" : "both",
          top: `${studioWindow.y}px`,
          width: `${studioWindow.width}px`,
          minHeight: "min(520px, calc(100vh - 16px))",
          minWidth: "min(760px, calc(100vw - 16px))",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Настройка дашборда"
      >
        <style jsx global>{`
          #dashboard-studio-shell .text-zinc-100,
          #dashboard-studio-shell .text-zinc-200,
          #dashboard-studio-shell .text-zinc-300 {
            color: var(--studio-text) !important;
          }
          #dashboard-studio-shell .text-zinc-400,
          #dashboard-studio-shell .text-zinc-500 {
            color: var(--studio-muted) !important;
          }
        `}</style>
        <header
          className="flex min-h-[60px] shrink-0 cursor-default items-center gap-1.5 border-b border-white/10 px-2 backdrop-blur-xl sm:min-h-[68px] sm:cursor-move sm:gap-3 sm:px-4"
          style={{ backgroundColor: "var(--studio-bg)" }}
          onPointerDown={beginStudioDrag}
        >
          <div className="hidden min-w-0 shrink-0 lg:block">
            <div className="text-sm font-semibold">Настройка дашборда</div>
            <div className="mt-0.5 text-[10px] text-zinc-400">
              Все инструменты в одном окне
            </div>
          </div>

          <nav
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5 sm:py-2 lg:ml-3"
            aria-label="Разделы настройки"
          >
            {navItems.map(([id, label, icon]) => (
              <StudioNavButton
                key={id}
                active={section === id}
                label={label}
                icon={icon}
                badge={
                  id === "pages"
                    ? pages.length
                    : id === "services"
                      ? services.length
                      : id === "widgets"
                        ? widgetServices.length + topWidgets.length
                        : id === "bookmarks"
                          ? bookmarks.length
                          : undefined
                }
                onClick={() => {
                  setSection(id);
                  setSearch("");
                  setSelectedGroupRef(null);
                  setSelectedTopWidget(null);
                  setNewItemTarget(null);
                  setNewPageOpen(false);
                  if (id === "pages") {
                    setSelectedPageName(pages[0]?.name ?? "");
                  }
                }}
              />
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xl leading-none text-zinc-400 shadow-sm transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
              aria-label="Закрыть настройку дашборда"
              title="Закрыть"
            >
              ×
            </button>
          </div>
        </header>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <header
            className="flex min-h-[72px] shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-3 backdrop-blur-xl sm:gap-4 sm:px-5 md:flex-nowrap"
            style={{ backgroundColor: "var(--studio-bg)" }}
          >
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold">
                {navItems.find(([id]) => id === section)?.[1] ?? "Обзор"}
              </h1>
              <p className="truncate text-[11px] text-zinc-400">
                Изменения сохраняются через безопасный API конфигуратора
              </p>
            </div>
            {!["overview", "appearance", "pages"].includes(section) && (
              <label className="order-3 relative block w-full basis-full md:order-none md:max-w-sm md:basis-auto">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                  ⌕
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Найти карточку, группу или виджет"
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-3 text-sm outline-hidden transition focus:border-zinc-400 focus:bg-white dark:border-white/10 dark:bg-white/5 dark:focus:border-white/25 dark:focus:bg-white/10"
                />
              </label>
            )}
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={onOpenUpdates}
                className="rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-[11px] font-medium hover:bg-zinc-50 sm:px-3 sm:text-xs dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                Обновления
              </button>
              <button
                type="button"
                onClick={onOpenConfig}
                className="rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-[11px] font-medium hover:bg-zinc-50 sm:px-3 sm:text-xs dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                Конфигуратор
              </button>
            </div>
          </header>

          {section === "overview" ? (
            <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Сервисы"
                  value={services.length}
                  note={`${serviceGroups.length} групп`}
                  accent="#f4f4f5"
                />
                <StatCard
                  label="Виджеты"
                  value={widgetServices.length + topWidgets.length}
                  note={`${widgetServices.length} на карточках · ${topWidgets.length} верхних`}
                  accent="#d4d4d8"
                />
                <StatCard
                  label="Закладки"
                  value={bookmarks.length}
                  note={`${bookmarkGroups.length} групп`}
                  accent="#a1a1aa"
                />
                <StatCard
                  label="Updater"
                  value={
                    services.filter((item) => item.config?.serviceUpdate).length
                  }
                  note="карточек подключено"
                  accent="#71717a"
                />
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <section className="rounded-2xl border border-zinc-200/80 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">
                        Структура дашборда
                      </h2>
                      <p className="mt-0.5 text-[10px] text-zinc-400">
                        Группы и наполненность карточками
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenNewGroup("")}
                      className="rounded-lg bg-white px-3 py-2 text-[11px] font-semibold text-zinc-950 shadow-sm shadow-black/20 transition-colors hover:bg-zinc-200"
                    >
                      + Новая группа
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {serviceGroups.map((group) => (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => {
                          setSection("services");
                          setSearch("");
                          setSelectedGroupRef({
                            type: "services",
                            name: group.name,
                          });
                        }}
                        className="rounded-xl border border-zinc-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate text-sm font-medium">
                            {group.name}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-white/10 dark:text-zinc-300">
                            {group.items.length}
                          </span>
                        </div>
                        <div className="mt-3 flex -space-x-2">
                          {group.items.slice(0, 6).map((item) => (
                            <div
                              key={item.key}
                              className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border-2 border-white bg-zinc-100 dark:border-zinc-900 dark:bg-zinc-800"
                            >
                              {item.config?.icon ? (
                                <ResolvedIcon
                                  icon={String(item.config.icon)}
                                  width={22}
                                  height={22}
                                  alt=""
                                />
                              ) : (
                                <span className="text-[10px] font-semibold">
                                  {item.name.slice(0, 1)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold">
                      Живой макет карточки
                    </h2>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      Логотип, название, подпись и расположение показателей
                    </p>
                  </div>
                  <ServiceCardPreview
                    item={selectedItem}
                    large
                    onIconClick={
                      selectedItem
                        ? () => onPickItemIcon(selectedItem)
                        : undefined
                    }
                    widgetCatalog={activeWidgetCatalog}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSection("services");
                      if (selectedItem) setSelectedKey(selectedItem.key);
                    }}
                    className="mt-3 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-xs font-medium hover:bg-zinc-50 dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    Перейти к настройке карточек
                  </button>
                </section>
              </div>
            </main>
          ) : section === "pages" ? (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Страницы дашборда</h2>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      Вкладки Основное, Медиа, Сайты и распределение групп
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPageInspectorMode("styles")}
                      aria-pressed={pageInspectorMode === "styles"}
                      className={classNames(
                        "rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                        pageInspectorMode === "styles"
                          ? "border-white/35 bg-white/15 text-white"
                          : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10",
                      )}
                    >
                      Оформление вкладок
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPageInspectorMode("page");
                        setSelectedPageName("");
                        setNewPageOpen(true);
                      }}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-zinc-950 shadow-sm shadow-black/20 transition-colors hover:bg-zinc-200"
                    >
                      + Страница
                    </button>
                  </div>
                </div>

                {pageInspectorMode === "styles" && (
                  <div className="mb-5 rounded-3xl border border-white/10 bg-black/10 p-3 sm:p-4">
                    <PageStyleInspector
                      key="studio-page-styles"
                      inline
                      onSave={onSavePageStyles}
                      pages={pages}
                      settings={data?.settings}
                    />
                  </div>
                )}

                <div
                  className={classNames(
                    "grid gap-3 sm:grid-cols-2 xl:grid-cols-3",
                    pageInspectorMode === "styles" && "hidden",
                  )}
                >
                  {pages.map((page) => {
                    const active =
                      !newPageOpen &&
                      selectedPage &&
                      namesEqual(selectedPage.name, page.name);
                    const serviceCount = page.groups.filter(
                      (group) => group.type === "services",
                    ).length;
                    const bookmarkCount = page.groups.length - serviceCount;
                    return (
                      <button
                      type="button"
                      key={page.name}
                      onClick={() => {
                        if (pageInspectorMode === "styles") {
                          // The page appearance editor is inline. Selecting a
                          // tab here must not close it and switch to the page
                          // inspector; the styling applies to the tab bar as a
                          // whole.
                          setSelectedPageName(page.name);
                          return;
                        }
                        setPageInspectorMode("page");
                        setNewPageOpen(false);
                        setSelectedPageName(page.name);
                        }}
                        aria-pressed={active}
                        className={classNames(
                          "min-h-32 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg",
                          active
                            ? "shadow-md"
                            : "border-zinc-200 bg-white/75 dark:border-white/10 dark:bg-white/5",
                        )}
                        style={
                          active
                            ? {
                                backgroundColor:
                                  "color-mix(in srgb, var(--studio-accent) 14%, transparent)",
                                borderColor: "var(--studio-accent)",
                              }
                            : undefined
                        }
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/10">
                            {page.icon ? (
                              <ResolvedIcon
                                icon={page.icon}
                                width={24}
                                height={24}
                                alt=""
                              />
                            ) : (
                              <span className="text-sm font-semibold">
                                {page.name.slice(0, 1)}
                              </span>
                            )}
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[9px] text-zinc-400">
                            {page.groups.length} групп
                          </span>
                        </span>
                        <span className="mt-4 block truncate text-sm font-semibold">
                          {page.name}
                        </span>
                        <span className="mt-1 block text-[10px] text-zinc-400">
                          Сервисы: {serviceCount} · Закладки: {bookmarkCount}
                        </span>
                      </button>
                    );
                  })}
                  {!pages.length && (
                    <button
                      type="button"
                      onClick={() => {
                        setPageInspectorMode("page");
                        setNewPageOpen(true);
                      }}
                      className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-white/15 text-xs text-zinc-400 transition hover:border-white/30 hover:bg-white/5"
                    >
                      Создать первую страницу
                    </button>
                  )}
                </div>

                <div
                  className={classNames(
                    "mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4",
                    pageInspectorMode === "styles" && "hidden",
                  )}
                >
                  <div className="text-xs font-semibold">
                    Группы без страницы
                  </div>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    Они отображаются на дашборде независимо от выбранной
                    вкладки.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pageGroups
                      .filter((group) => !group.pageName)
                      .map((group) => (
                        <span
                          key={group.key}
                          className="rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5 text-[10px] text-zinc-300"
                        >
                          {group.name}
                        </span>
                      ))}
                    {!pageGroups.some((group) => !group.pageName) && (
                      <span className="text-[10px] text-zinc-500">
                        Все группы распределены по страницам
                      </span>
                    )}
                  </div>
                </div>
              </main>

              {pageInspectorMode !== "styles" && (
                <aside
                  className="h-[46%] w-full shrink-0 overflow-y-auto border-t border-white/10 p-3 sm:p-4 lg:h-auto lg:w-[450px] lg:border-l lg:border-t-0"
                  style={{ backgroundColor: "var(--studio-panel)" }}
                >
                  {newPageOpen || selectedPage ? (
                    <PageInspector
                      key={
                        newPageOpen
                          ? "studio-page:new"
                          : `studio-page:${selectedPage.name}`
                      }
                      groups={pageGroups}
                      onChooseIcon={onChooseIcon}
                      onDeleted={() => {
                        setNewPageOpen(false);
                        setSelectedPageName("");
                      }}
                      onSave={async (previousName, draft, mode) => {
                        const result = await onSavePage(
                          previousName,
                          draft,
                          mode,
                        );
                        if (result?.name) {
                          setNewPageOpen(false);
                          setSelectedPageName(result.name);
                        }
                        return result;
                      }}
                      page={newPageOpen ? null : selectedPage}
                    />
                  ) : (
                    <div className="flex min-h-60 items-center justify-center rounded-2xl border border-dashed border-white/15 px-6 text-center text-sm text-zinc-400">
                      Создайте страницу и назначьте ей группы
                    </div>
                  )}
                </aside>
              )}
            </div>
          ) : section === "appearance" ? (
            <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
              <div className="grid gap-5 xl:grid-cols-3">
                <button
                  type="button"
                  onClick={onOpenAppearance}
                  className="group min-h-52 overflow-hidden rounded-2xl border p-5 text-left shadow-lg transition hover:-translate-y-1"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, color-mix(in srgb, var(--studio-accent) 38%, var(--studio-bg)), var(--studio-panel))",
                    borderColor:
                      "color-mix(in srgb, var(--studio-accent) 38%, transparent)",
                    color: "var(--studio-text)",
                  }}
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-300">
                    Персонализация
                  </div>
                  <div className="mt-20 text-xl font-semibold">
                    Фон и атмосфера
                  </div>
                  <div className="mt-1 text-xs text-zinc-300">
                    Изображение, затемнение и визуальные эффекты
                  </div>
                </button>
                <button
                  type="button"
                  onClick={onOpenIcons}
                  className="min-h-52 rounded-2xl border p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                  style={{
                    backgroundColor: "var(--studio-panel)",
                    borderColor:
                      "color-mix(in srgb, var(--studio-accent) 28%, transparent)",
                    color: "var(--studio-text)",
                  }}
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">
                    Медиатека
                  </div>
                  <div className="mt-20 text-xl font-semibold">Иконки</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Поиск, загрузка и локализация изображений
                  </div>
                </button>
                <button
                  type="button"
                  onClick={onOpenConfig}
                  className="min-h-52 rounded-2xl border p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, var(--studio-panel), color-mix(in srgb, var(--studio-accent) 24%, var(--studio-bg)))",
                    borderColor:
                      "color-mix(in srgb, var(--studio-accent) 38%, transparent)",
                    color: "var(--studio-text)",
                  }}
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">
                    Расширенные настройки
                  </div>
                  <div className="mt-20 text-xl font-semibold">
                    Стиль и поведение
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Темы, сетка, CSS и параметры Homepage
                  </div>
                </button>
              </div>
              <div className="mt-5 rounded-2xl border border-zinc-200 bg-white/70 p-5 dark:border-white/10 dark:bg-white/[0.03]">
                <h2 className="text-sm font-semibold">Цветовая схема студии</h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Сохраняется локально для этого браузера и не меняет дашборд
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {studioColorSchemes.map((scheme) => (
                    <button
                      type="button"
                      key={scheme.id}
                      onClick={() => selectStudioScheme(scheme.id)}
                      aria-pressed={studioSchemeId === scheme.id}
                      className={classNames(
                        "rounded-xl border p-3 text-left transition hover:-translate-y-0.5",
                        studioSchemeId === scheme.id
                          ? "border-white/40 bg-white/10"
                          : "border-white/10 bg-black/10 hover:border-white/20",
                      )}
                    >
                      <span className="flex h-12 overflow-hidden rounded-lg border border-white/10">
                        {scheme.colors.map((color) => (
                          <span
                            key={color}
                            className="h-full flex-1"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span className="mt-2 block text-xs font-semibold">
                        {scheme.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-zinc-400">
                        {scheme.description}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => selectStudioScheme(studioColorSchemes[0].id)}
                  className="mt-4 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-white/15 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10"
                >
                  Сбросить к настройкам по умолчанию
                </button>
                <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 xl:grid-cols-2">
                  <section>
                    <div className="text-xs font-semibold">
                      Собственная палитра
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-400">
                      Изменения применяются к студии сразу и сохраняются в
                      браузере
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <ColorControl
                        label="Фон студии"
                        value={studioPalette.background}
                        onChange={(value) =>
                          updateStudioPalette("background", value)
                        }
                      />
                      <ColorControl
                        label="Панели"
                        value={studioPalette.panel}
                        onChange={(value) =>
                          updateStudioPalette("panel", value)
                        }
                      />
                      <ColorControl
                        label="Основной текст"
                        value={studioPalette.text}
                        onChange={(value) => updateStudioPalette("text", value)}
                      />
                      <ColorControl
                        label="Вторичный текст"
                        value={studioPalette.mutedText}
                        onChange={(value) =>
                          updateStudioPalette("mutedText", value)
                        }
                      />
                      <ColorControl
                        label="Активные пункты"
                        value={studioPalette.accent}
                        onChange={(value) =>
                          updateStudioPalette("accent", value)
                        }
                      />
                      <ColorControl
                        label="Текст активного пункта"
                        value={studioPalette.activeText}
                        onChange={(value) =>
                          updateStudioPalette("activeText", value)
                        }
                      />
                    </div>
                  </section>
                  <section>
                    <div className="text-xs font-semibold">
                      Градиент и эффект
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-400">
                      Настройте тип, два цвета и интенсивность атмосферы
                    </div>
                    <label className="mt-3 block text-[10px] text-zinc-400">
                      Эффект
                      <select
                        value={studioPalette.effect}
                        onChange={(event) =>
                          updateStudioPalette("effect", event.target.value)
                        }
                        className={inspectorInputClass}
                      >
                        <option value="none">Без эффекта</option>
                        <option value="gradient">Линейный градиент</option>
                        <option value="glow">Мягкое свечение</option>
                      </select>
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <ColorControl
                        label="Первый цвет"
                        value={studioPalette.effectColorA}
                        onChange={(value) =>
                          updateStudioPalette("effectColorA", value)
                        }
                      />
                      <ColorControl
                        label="Второй цвет"
                        value={studioPalette.effectColorB}
                        onChange={(value) =>
                          updateStudioPalette("effectColorB", value)
                        }
                      />
                    </div>
                    <label className="mt-3 block text-[10px] text-zinc-400">
                      Интенсивность · {studioPalette.effectStrength}%
                      <input
                        type="range"
                        min="0"
                        max="60"
                        value={studioPalette.effectStrength}
                        onChange={(event) =>
                          updateStudioPalette(
                            "effectStrength",
                            Number(event.target.value),
                          )
                        }
                        className="mt-2 w-full accent-emerald-500"
                      />
                    </label>
                  </section>
                </div>
              </div>
            </main>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {section === "widgets"
                        ? "Карточки с данными"
                        : section === "bookmarks"
                          ? "Закладки"
                          : "Карточки сервисов"}
                    </h2>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      Выберите элемент — справа появится визуальный инспектор
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenNewGroup(
                          section === "bookmarks" ? "bookmarks" : "services",
                        )
                      }
                      className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50 dark:border-white/15 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      + Группа
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const type =
                          section === "bookmarks" ? "bookmarks" : "services";
                        const groupName =
                          visibleGroups[0]?.name ?? groups[0]?.name ?? "";
                        if (groupName) {
                          setSelectedGroupRef(null);
                          setSelectedTopWidget(null);
                          setNewItemTarget({
                            groupName,
                            key: `new:${type}:${groupName}`,
                            type,
                          });
                        }
                      }}
                      disabled={!groups.length}
                      className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-zinc-950 shadow-sm shadow-black/20 transition-colors hover:bg-zinc-200 disabled:opacity-40"
                    >
                      + Карточка
                    </button>
                  </div>
                </div>

                <div className="space-y-5">
                  {section === "widgets" && (
                    <section>
                      <div className="mb-2 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                            Верхняя панель · {topWidgets.length}
                          </div>
                          <div className="mt-0.5 text-[10px] text-zinc-400">
                            Информационные виджеты над группами
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGroupRef(null);
                            setSelectedTopWidget({
                              config: {},
                              isNew: true,
                              key: "top-widget:new:resources",
                              name: "Новый resources",
                              type: "resources",
                            });
                          }}
                          className="rounded-xl bg-white px-3 py-2 text-[11px] font-semibold text-zinc-950 shadow-sm transition hover:bg-zinc-200"
                        >
                          + Resources
                        </button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                        {topWidgets.map((widget) => (
                          <div
                            key={widget.key}
                            className={classNames(
                              "flex min-h-20 items-center gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md",
                              selectedTopWidget?.key === widget.key
                                ? "shadow-sm"
                                : "border-zinc-200 bg-white/80 dark:border-white/10 dark:bg-white/5",
                            )}
                            style={
                              selectedTopWidget?.key === widget.key
                                ? {
                                    backgroundColor:
                                      "color-mix(in srgb, var(--studio-accent) 14%, transparent)",
                                    borderColor: "var(--studio-accent)",
                                  }
                                : undefined
                            }
                          >
                            <ServiceIcon
                              config={widget.config}
                              name={widget.name}
                              onClick={() =>
                                onPickTopWidgetIcon(widget.widget, widget.index)
                              }
                              size={24}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (widget.type === "resources") {
                                  setSelectedGroupRef(null);
                                  setSelectedTopWidget(widget);
                                } else {
                                  onOpenTopWidget(widget.widget, widget.index);
                                }
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {widget.name}
                                </div>
                                <div className="mt-0.5 truncate text-[10px] text-zinc-400">
                                  {widget.type} · позиция {widget.index + 1}
                                </div>
                              </div>
                            </button>
                          </div>
                        ))}
                        {!topWidgets.length && (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedTopWidget({
                                config: {},
                                isNew: true,
                                key: "top-widget:new:resources",
                                name: "Новый resources",
                                type: "resources",
                              })
                            }
                            className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-white/15 text-xs text-zinc-400 hover:border-white/30 hover:bg-white/5"
                          >
                            Добавить первый resources
                          </button>
                        )}
                      </div>
                    </section>
                  )}
                  {visibleGroups.map((group) => (
                    <section key={group.key}>
                      <div className="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTopWidget(null);
                            setSelectedGroupRef({
                              type: group.type,
                              name: group.name,
                            });
                          }}
                          aria-pressed={selectedGroup?.key === group.key}
                          className={classNames(
                            "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition",
                            selectedGroup?.key === group.key
                              ? "border-white/30 bg-white/15 text-white"
                              : "border-transparent text-zinc-600 hover:border-white/10 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
                          )}
                        >
                          {group.name} · {group.items.length} · Настроить
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGroupRef(null);
                            setSelectedTopWidget(null);
                            setNewItemTarget({
                              groupName: group.name,
                              key: `new:${group.type}:${group.name}`,
                              type: group.type,
                            });
                          }}
                          className="text-[10px] text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
                        >
                          Добавить сюда
                        </button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                        {group.items.map((item) => (
                          <ItemRow
                            key={item.key}
                            item={item}
                            active={selectedItem?.key === item.key}
                            onDragItem={startStudioItemDrag}
                            onDropItem={dropStudioItem}
                            onClick={() => {
                              setSelectedGroupRef(null);
                              setSelectedTopWidget(null);
                              setSelectedKey(item.key);
                            }}
                            onIconClick={() => onPickItemIcon(item)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                  {!visibleGroups.length && (
                    <div className="flex min-h-60 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 text-center dark:border-white/15">
                      <div className="text-sm font-medium">
                        Ничего не найдено
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">
                        Измените запрос или добавьте новую карточку
                      </div>
                    </div>
                  )}
                </div>
              </main>

              <aside
                className="h-[46%] w-full shrink-0 overflow-y-auto border-t border-white/10 p-3 sm:p-4 lg:h-auto lg:w-[450px] lg:border-l lg:border-t-0"
                style={{ backgroundColor: "var(--studio-panel)" }}
              >
                {newItemTarget ? (
                  <NewItemInspector
                    key={newItemTarget.key}
                    booleanOptions={widgetBooleanOptions}
                    groupName={newItemTarget.groupName}
                    internalBaseUrl={data?.internalBaseUrl}
                    onChooseIcon={onChooseIcon}
                    onClose={() => setNewItemTarget(null)}
                    onSave={onSaveNewItem}
                    type={newItemTarget.type}
                    templates={widgetTemplates}
                    translations={widgetTranslations}
                    widgetCatalog={serviceWidgetCatalog}
                    widgetTypes={widgetTypes}
                  />
                ) : selectedTopWidget?.type === "resources" ? (
                  <ResourceWidgetInspector
                    key={`${selectedTopWidget.key}:${JSON.stringify(selectedTopWidget.config)}`}
                    entry={selectedTopWidget}
                    onClose={() => setSelectedTopWidget(null)}
                    onSave={onSaveTopWidget}
                  />
                ) : selectedGroup ? (
                  <GroupInspector
                    key={`${selectedGroup.key}:${JSON.stringify(selectedGroupLayout)}`}
                    group={selectedGroup}
                    layout={selectedGroupLayout}
                    onChooseIcon={onChooseIcon}
                    onDeleted={() => setSelectedGroupRef(null)}
                    onSave={async (group, draft, mode) => {
                      const result = await onSaveGroup(group, draft, mode);
                      if (result?.name) {
                        setSelectedGroupRef({
                          type: group.type,
                          name: result.name,
                        });
                      }
                      return result;
                    }}
                    tabs={layoutTabs(data?.settings)}
                  />
                ) : selectedItem?.type === "services" ? (
                  <ServiceWidgetInspector
                    key={`${selectedItem.key}:${JSON.stringify(widgetFromItem(selectedItem))}`}
                    booleanOptions={widgetBooleanOptions}
                    internalBaseUrl={data?.internalBaseUrl}
                    item={selectedItem}
                    onChooseBackground={onChooseIcon}
                    onOpenItem={onOpenItem}
                    onPickIcon={() => onPickItemIcon(selectedItem)}
                    onSave={onSaveServiceWidget}
                    templates={widgetTemplates}
                    translations={widgetTranslations}
                    widgetCatalog={serviceWidgetCatalog}
                    widgetTypes={widgetTypes}
                  />
                ) : selectedItem?.type === "bookmarks" ? (
                  <BookmarkInspector
                    key={`${selectedItem.key}:${JSON.stringify(selectedItem.config)}`}
                    item={selectedItem}
                    onChooseIcon={onChooseIcon}
                    onDeleted={() => setSelectedKey("")}
                    onSave={onSaveBookmark}
                  />
                ) : (
                  <div className="flex min-h-60 items-center justify-center rounded-2xl border border-dashed border-zinc-300 text-sm text-zinc-400">
                    Выберите карточку
                  </div>
                )}
              </aside>
            </div>
          )}
          <div
            id="dashboard-studio-workspace"
            className="pointer-events-none absolute inset-0 z-30"
          />
        </div>
      </div>
    </div>
  );
}
