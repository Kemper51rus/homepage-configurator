import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const editorSource = readFileSync(
  new URL("../overlay/src/mods/browser-editor/components/editor.jsx", import.meta.url),
  "utf8",
);

function blockBetween(start, end) {
  const startIndex = editorSource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = editorSource.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return editorSource.slice(startIndex, endIndex);
}

test("update panel loads and selects the exact Homepage Studio catalog entry", () => {
  const panel = blockBetween(
    "function ConfiguratorUpdatePanel({ onSaved })",
    "function ConfiguratorUpdateModal({ onClose, onSaved })",
  );

  assert.match(panel, /const \[componentCatalog, setComponentCatalog\] = useState\(\[\]\)/);
  assert.match(panel, /const \[loading, setLoading\] = useState\(true\)/);
  assert.match(panel, /const \[operation, setOperation\] = useState\(null\)/);
  assert.match(panel, /const \[componentProgress, setComponentProgress\] = useState\(null\)/);
  assert.match(panel, /const \[restartRequired, setRestartRequired\] = useState\(false\)/);
  assert.match(panel, /postEditorAction\(\{ action: "get-component-catalog" \}\)/);
  assert.match(
    panel,
    /component\.componentId === "homepage-studio" && component\.sourceId === "github-stable"/,
  );
});

test("Homepage Studio card exposes install, update, remove and local-source status", () => {
  const panel = blockBetween(
    "function ConfiguratorUpdatePanel({ onSaved })",
    "function ConfiguratorUpdateModal({ onClose, onSaved })",
  );

  assert.match(panel, /data-component-card="homepage-studio"/);
  assert.match(panel, />Homepage Studio</);
  assert.match(panel, /installedVersion/);
  assert.match(panel, /availableVersion/);
  assert.match(panel, /availabilityReason/);
  assert.match(panel, /installed:/);
  assert.match(panel, /available:/);
  assert.match(panel, /Локальный источник Homepage Studio недоступен/);
  assert.match(panel, /"Install"/);
  assert.match(panel, /"Update"/);
  assert.match(panel, /"Remove"/);
  assert.match(panel, /"Удаление…"/);
  assert.match(panel, /window\.confirm\(/);
  assert.match(panel, /componentBusy \|\| running \|\| updating/);
  assert.match(panel, /data-component-operation-progress/);
  assert.match(panel, /Автоматически перезапускаю Homepage/);
  assert.match(panel, /waitForHomepageRestart\(nextOperation\)/);
  assert.match(panel, /window\.location\.reload\(\)/);
});

test("component operation sends only the fixed browser payload", () => {
  const operation = blockBetween(
    "async function runComponentOperation(nextOperation)",
    "async function startUpdate()",
  );
  const request = operation.match(/postEditorAction\(\{[\s\S]*?\}\)/)?.[0] ?? "";

  assert.match(
    request,
    /postEditorAction\(\{\s*action: "run-component-operation",\s*componentId: "homepage-studio",\s*sourceId: "github-stable",\s*operation: nextOperation,\s*\}\)/,
  );
  assert.doesNotMatch(request, /\b(?:url|path|target|targetDir|autoRestart|command|commands)\b/i);
  assert.match(operation, /setComponentCatalog\(result\?\.catalog \?\? \[\]\)/);
  assert.match(operation, /setRestartRequired\(Boolean\(result\?\.restartRequired\)\)/);
  assert.match(operation, /onSaved\(/);
});
