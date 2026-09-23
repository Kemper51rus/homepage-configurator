import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const editorApiSource = readFileSync(
  new URL("../overlay/src/mods/browser-editor/api/editor.js", import.meta.url),
  "utf8",
);

function blockBetween(start, end) {
  const startIndex = editorApiSource.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = editorApiSource.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return editorApiSource.slice(startIndex, endIndex);
}

test("editor POST routes expose the component catalog from the server target", () => {
  const route = blockBetween(
    'if (action === "get-component-catalog")',
    'if (action === "run-component-operation")',
  );

  assert.match(route, /await requireHomepageTargetDir\(\)/);
  assert.match(route, /getComponentStatusCatalog\(targetDir, \{ env: process\.env \}\)/);
  assert.doesNotMatch(route, /req\.body\.(?:path|target|targetDir|url)|healthcheckUrl/);
});

test("component operation route passes exact input and server-only context", () => {
  const route = blockBetween(
    'if (action === "run-component-operation")',
    'if (action === "localize-icons")',
  );

  assert.match(route, /const input = getExactComponentOperationInput\(req\.body\)/);
  assert.match(route, /executeComponentOperation\(targetDir, input, \{[\s\S]*?env: process\.env,[\s\S]*?healthcheckUrl: process\.env\.HOMEPAGE_COMPONENT_HEALTHCHECK_URL/);
  assert.match(route, /getComponentStatusCatalog\(targetDir, \{ env: process\.env \}\)/);
  assert.doesNotMatch(route, /autoRestart|req\.body\.(?:path|target|targetDir|url)|commands\s*:/);
  assert.match(route, /componentId: result\.componentId/);
  assert.match(route, /sourceId: result\.sourceId/);
  assert.match(route, /operation: result\.operation/);
  assert.match(route, /restartRequired: result\.restartRequired/);
});

test("component operation body allowlist cannot reach the core validator", () => {
  assert.match(
    editorApiSource,
    /new Set\(\["action", "componentId", "sourceId", "operation", "autoRestart"\]\)/,
  );
  const exactInput = blockBetween(
    "function getExactComponentOperationInput(body)",
    "async function requireHomepageTargetDir()",
  );
  assert.match(exactInput, /Object\.keys\(body\).*componentOperationBodyKeys\.has\(key\)/s);
  assert.match(
    exactInput,
    /return \{\s*componentId: body\.componentId,\s*sourceId: body\.sourceId,\s*operation: body\.operation,\s*\}/s,
  );
  assert.doesNotMatch(exactInput, /\.\.\.body|autoRestart|\bpath\b|\burl\b/i);
});
