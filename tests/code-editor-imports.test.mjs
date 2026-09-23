import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const componentUrl = (fileName) =>
  new URL(
    `../overlay/src/mods/browser-editor/components/${fileName}`,
    import.meta.url,
  );

const codeEditorSource = readFileSync(componentUrl("code-editor.jsx"), "utf8");
const editorSource = readFileSync(componentUrl("editor.jsx"), "utf8");

test("Classic editor imports the extracted CodeEditor primitive", () => {
  assert.match(
    editorSource,
    /import\s+\{\s*CodeEditor\s*\}\s+from\s+["']\.\/code-editor["']/,
  );
  assert.doesNotMatch(editorSource, /function\s+CodeEditor\s*\(/);
  assert.match(codeEditorSource, /export\s+function\s+CodeEditor\s*\(/);
});
