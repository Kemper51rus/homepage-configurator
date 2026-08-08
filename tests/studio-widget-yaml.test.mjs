import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL(
    "../overlay/src/mods/browser-editor/components/dashboard-studio.jsx",
    import.meta.url,
  ),
  "utf8",
);

test("Studio widget inspector exposes a widget-only YAML editor", () => {
  assert.match(source, /function serializeWidgetYaml\(widget\)/);
  assert.match(source, /function parseWidgetYaml\(source\)/);
  assert.match(source, /keys\.length !== 1 \|\| keys\[0\] !== "widget"/);
  assert.match(source, /aria-label="YAML виджета"/);
  assert.match(source, />\s*Применить YAML\s*</);
});

test("YAML changes update the preview before the existing explicit save", () => {
  assert.match(
    source,
    /const nextWidget = parseWidgetYaml\(widgetYamlDraft\);[\s\S]*?setDraft\(nextWidget\)/,
  );
  assert.match(
    source,
    /YAML применён к предпросмотру\.[\s\S]*?Сохранить карточку и виджет/,
  );
  assert.match(
    source,
    /onClick=\{handleSave\}[\s\S]*?Сохранить карточку и виджет/,
  );
});
