import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboardStudioSource = readFileSync(
  new URL(
    "../overlay/src/mods/browser-editor/components/dashboard-studio.jsx",
    import.meta.url,
  ),
  "utf8",
);
const editorSource = readFileSync(
  new URL(
    "../overlay/src/mods/browser-editor/components/editor.jsx",
    import.meta.url,
  ),
  "utf8",
);

test("canvas service clicks use the Studio widget inspector modal", () => {
  assert.match(
    editorSource,
    /editMode && type === "services"[\s\S]*?"studio-service-widget"/,
  );
  assert.match(editorSource, /<StudioServiceWidgetModal/);
  assert.match(
    editorSource,
    /modal\?\.scope !== "studio-service-widget"[\s\S]*?<ItemModal/,
  );
});

test("Studio widget modal separates card and widget settings and gives YAML full width", () => {
  assert.match(
    dashboardStudioSource,
    /export function StudioServiceWidgetModal\(/,
  );
  assert.match(
    dashboardStudioSource,
    /aria-label=\{`Редактор виджета сервиса:/,
  );
  assert.match(dashboardStudioSource, /<ServiceWidgetInspector/);
  assert.match(dashboardStudioSource, /modalLayout/);
  assert.match(
    dashboardStudioSource,
    /Основные настройки карточки[\s\S]*?<StudioServiceUpdateControl[\s\S]*?data-studio-widget-settings/,
  );
  assert.match(
    dashboardStudioSource,
    /order-\[-10\][\s\S]*?Шаблон интеграции виджета/,
  );
  assert.match(
    dashboardStudioSource,
    /order-\[20\][\s\S]*?Дополнительные настройки/,
  );
  assert.match(dashboardStudioSource, /data-studio-yaml-full-width/);
  assert.match(
    dashboardStudioSource,
    /<\/div>\s*<\/div>\s*\{widgetYamlSection\}/,
  );
  assert.match(
    dashboardStudioSource,
    /Цвет карточки[\s\S]*?Фоновая картинка[\s\S]*?Текст заголовка/,
  );
  assert.match(
    dashboardStudioSource,
    /Основные настройки карточки[\s\S]*?Узел Proxmox[\s\S]*?Proxmox VMID[\s\S]*?Тип Proxmox/,
  );
  assert.match(
    dashboardStudioSource,
    /Информатор обновлений[\s\S]*?Шаблон интеграции виджета/,
  );
});

test("Studio widget modal can be dragged and resized in both dimensions", () => {
  assert.match(dashboardStudioSource, /data-studio-service-widget-window/);
  assert.match(dashboardStudioSource, /new ResizeObserver/);
  assert.match(dashboardStudioSource, /const beginWindowDrag/);
  assert.match(
    dashboardStudioSource,
    /resize: compactViewport \? "none" : "both"/,
  );
  assert.match(dashboardStudioSource, /cursor-move/);
  assert.match(dashboardStudioSource, /height: `\$\{windowRect\.height\}px`/);
  assert.match(dashboardStudioSource, /width: `\$\{windowRect\.width\}px`/);
});

test("canvas group and update modals use the native Studio window", () => {
  assert.match(dashboardStudioSource, /export function StudioModalWindow\(/);
  assert.match(dashboardStudioSource, /data-studio-modal-window="true"/);
  assert.match(dashboardStudioSource, /studioEffectBackground\(palette\)/);
  assert.match(dashboardStudioSource, /homepage-dashboard-studio-style/);
  assert.match(
    editorSource,
    /studioChrome \? StudioModalWindow : EditorWindow/,
  );
});

test("main Studio remembers and clamps its window geometry", () => {
  assert.match(
    dashboardStudioSource,
    /STUDIO_WINDOW_STORAGE_KEY = "homepage-dashboard-studio-window"/,
  );
  assert.match(dashboardStudioSource, /readStoredStudioWindowGeometry/);
  assert.match(dashboardStudioSource, /clampStudioWindowGeometry/);
  assert.match(
    dashboardStudioSource,
    /localStorage\.setItem\(\s*STUDIO_WINDOW_STORAGE_KEY/,
  );
  assert.match(dashboardStudioSource, /ref=\{studioWindowRef\}/);
});

test("Studio layouts adapt from desktop to tablet and mobile widths", () => {
  assert.match(
    dashboardStudioSource,
    /minWidth: "min\(760px, calc\(100vw - 16px\)\)"/,
  );
  assert.match(
    dashboardStudioSource,
    /resize: compactStudioViewport \? "none" : "both"/,
  );
  assert.match(
    dashboardStudioSource,
    /flex min-h-0 flex-1 flex-col lg:flex-row/,
  );
  assert.equal(
    dashboardStudioSource.match(/h-\[46%\] w-full[\s\S]*?lg:w-\[450px\]/g)
      ?.length,
    2,
  );
  assert.match(
    dashboardStudioSource,
    /order-3 relative block w-full basis-full md:order-none/,
  );
  assert.match(
    dashboardStudioSource,
    /hidden font-medium min-\[460px\]:inline/,
  );
});

test("page appearance editor opens inline below the page heading, not in the side inspector", () => {
  assert.match(
    dashboardStudioSource,
    /pageInspectorMode === "styles" && \(\s*<div[^>]+>\s*<PageStyleInspector[\s\S]*?inline/,
  );
  assert.match(
    dashboardStudioSource,
    /data-studio-page-styles=\{inline \? "inline" : "inspector"\}/,
  );
  assert.match(
    dashboardStudioSource,
    /pageInspectorMode !== "styles" && \(\s*<aside/,
  );
});

test("clicking a page while styling tabs keeps the inline appearance editor open", () => {
  assert.match(
    dashboardStudioSource,
    /if \(pageInspectorMode === "styles"\) \{[\s\S]*?setSelectedPageName\(page\.name\);[\s\S]*?return;/,
  );
});

test("page list and unassigned groups stay out of the inline tab styling mode", () => {
  assert.match(
    dashboardStudioSource,
    /pageInspectorMode === "styles" && "hidden"/,
  );
});

test("Studio update action opens the themed Studio update window", () => {
  assert.match(
    editorSource,
    /onOpenUpdates=\{\(\) =>[\s\S]*?setModal\(\{ type: "configurator-updates", studioChrome: true \}\)/,
  );
});

test("combined Studio save writes the card fields and widget atomically", () => {
  assert.match(
    dashboardStudioSource,
    /await onSave\(item, draft, \{[\s\S]*?name: cardDraft\.name\.trim\(\)[\s\S]*?serviceUpdate:/,
  );
  assert.match(editorSource, /const nextName = String\(cardStyle\?\.name/);
  assert.match(editorSource, /const editableCardFields = \[/);
  assert.match(
    editorSource,
    /nextConfig\.serviceUpdate = cardStyle\.serviceUpdate/,
  );
  assert.match(
    editorSource,
    /updateRawEntry\([\s\S]*?nextName,[\s\S]*?nextConfig/,
  );
});
