import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const editorSource = readFileSync(
  new URL(
    "../overlay/src/mods/browser-editor/components/editor.jsx",
    import.meta.url,
  ),
  "utf8",
);

test("closing Studio also closes child configurator windows", () => {
  const closeStudioStart = editorSource.indexOf(
    "const closeStudio = useCallback(() => {",
  );
  const closeStudioEnd = editorSource.indexOf(
    "const openCanvasEditor = useCallback(() => {",
    closeStudioStart,
  );
  const closeStudioSource = editorSource.slice(
    closeStudioStart,
    closeStudioEnd,
  );

  assert.ok(closeStudioStart >= 0);
  assert.ok(closeStudioEnd > closeStudioStart);
  assert.match(closeStudioSource, /setModal\(null\)/);
  assert.match(closeStudioSource, /setIconsManagerOpen\(false\)/);
  assert.match(closeStudioSource, /setIconSelectorCallback\(null\)/);
  assert.match(closeStudioSource, /setStudioOpen\(false\)/);
  assert.match(editorSource, /onClose=\{closeStudio\}/);
});

test("switching from Studio to canvas uses the same child-window cleanup", () => {
  const canvasStart = editorSource.indexOf(
    "const openCanvasEditor = useCallback(() => {",
  );
  const canvasEnd = editorSource.indexOf("useEffect(() => {", canvasStart);
  const canvasSource = editorSource.slice(canvasStart, canvasEnd);

  assert.ok(canvasStart >= 0);
  assert.ok(canvasEnd > canvasStart);
  assert.match(canvasSource, /closeStudio\(\)/);
  assert.match(canvasSource, /setEditMode\(true\)/);
  assert.match(editorSource, /onCanvasEdit=\{openCanvasEditor\}/);
});

test("canvas layout actions open group and update windows with Studio chrome", () => {
  const toolbarStart = editorSource.indexOf("{editMode ? (");
  const toolbarEnd = editorSource.indexOf("{notice && (", toolbarStart);
  const toolbarSource = editorSource.slice(toolbarStart, toolbarEnd);

  assert.ok(toolbarStart >= 0);
  assert.ok(toolbarEnd > toolbarStart);
  assert.match(toolbarSource, /Добавить группу/);
  assert.match(
    toolbarSource,
    /type: "configurator-updates", studioChrome: true/,
  );
  assert.match(editorSource, /studioChrome: editMode/);
});

test("Studio canvas modals use the saved Studio palette without a second legacy window", () => {
  assert.match(
    editorSource,
    /WindowComponent = studioChrome \? StudioModalWindow : EditorWindow/g,
  );
  assert.match(
    editorSource,
    /<ConfiguratorUpdatePanel onSaved=\{onSaved\} studioMode=\{studioChrome\}/,
  );
  assert.equal(
    editorSource.match(/modal\?\.type === "configurator-updates"/g)?.length,
    1,
  );
});
