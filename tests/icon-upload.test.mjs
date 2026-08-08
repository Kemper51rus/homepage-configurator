import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const routeUrl = new URL(
  "../overlay/src/pages/api/config/icon/[file].js",
  import.meta.url,
);
const compatibilityRouteUrl = new URL(
  "../overlay/src/mods/browser-editor/api/icon.js",
  import.meta.url,
);
const editorUrl = new URL(
  "../overlay/src/mods/browser-editor/components/editor.jsx",
  import.meta.url,
);
const resolverUrl = new URL(
  "../overlay/src/mods/browser-editor/lib/favicon-resolver.js",
  import.meta.url,
);

test("image upload API accepts Base64 overhead while retaining a bounded file limit", async () => {
  const [route, compatibilityRoute, editor, resolver] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(compatibilityRouteUrl, "utf8"),
    readFile(editorUrl, "utf8"),
    readFile(resolverUrl, "utf8"),
  ]);

  for (const source of [route, compatibilityRoute]) {
    assert.match(source, /sizeLimit:\s*"14mb"/);
  }
  assert.match(resolver, /maxIconBytes = 10 \* 1024 \* 1024/);
  assert.match(editor, /MAX_IMAGE_UPLOAD_BYTES = 10 \* 1024 \* 1024/);
  assert.match(editor, /Размер изображения не должен превышать 10 МБ/);
});
