import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  anchoredEditorWindow,
  centeredEditorWindow,
  clampEditorWindow,
  readStoredEditorWindow,
  resizeCursorForDirections,
  resizeEditorWindow,
  writeStoredEditorWindow,
} from "../overlay/src/mods/browser-editor/lib/editor-window.js";

const originalWindow = globalThis.window;

function withWindow(width = 800, height = 600) {
  const storage = new Map();
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
  };
  return storage;
}

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test("clampEditorWindow keeps a window inside the viewport and respects minimum size", () => {
  withWindow(800, 600);

  assert.deepEqual(clampEditorWindow({ left: -100, top: 580, width: 1000, height: 700 }, 320, 200), {
    left: 16,
    top: 16,
    width: 768,
    height: 568,
  });
});

test("resizeEditorWindow clamps dragged edges to the viewport and minimum size", () => {
  withWindow(800, 600);

  assert.deepEqual(
    resizeEditorWindow({ left: 100, top: 80, width: 300, height: 200 }, -200, 0, ["left"], 200, 150),
    {
      left: 16,
      top: 80,
      width: 384,
      height: 200,
    },
  );

  assert.deepEqual(
    resizeEditorWindow({ left: 100, top: 80, width: 300, height: 200 }, 1000, 1000, ["right", "bottom"], 200, 150),
    {
      left: 100,
      top: 80,
      width: 684,
      height: 504,
    },
  );
});

test("centeredEditorWindow and anchoredEditorWindow derive deterministic initial rectangles", () => {
  withWindow(800, 600);

  assert.deepEqual(centeredEditorWindow(500, 300, 320, 200), {
    left: 150,
    top: 150,
    width: 500,
    height: 300,
  });

  assert.deepEqual(
    anchoredEditorWindow({ current: { getBoundingClientRect: () => ({ left: 700, bottom: 570 }) } }, 300, 200, 200, 150),
    {
      left: 484,
      top: 384,
      width: 300,
      height: 200,
    },
  );
});

test("stored editor windows round-trip valid rectangles and ignore invalid values", () => {
  const storage = withWindow(800, 600);

  assert.equal(readStoredEditorWindow("missing"), null);

  storage.set("bad-json", "{");
  assert.equal(readStoredEditorWindow("bad-json"), null);

  storage.set("partial", JSON.stringify({ left: 1, top: 2, width: 3 }));
  assert.equal(readStoredEditorWindow("partial"), null);

  writeStoredEditorWindow("valid", { left: 10, top: 20, width: 300, height: 200 });
  assert.deepEqual(readStoredEditorWindow("valid"), { left: 10, top: 20, width: 300, height: 200 });
});

test("resizeCursorForDirections maps drag handles to CSS cursors", () => {
  assert.equal(resizeCursorForDirections(["left"]), "ew-resize");
  assert.equal(resizeCursorForDirections(["top"]), "ns-resize");
  assert.equal(resizeCursorForDirections(["bottom", "left"]), "nesw-resize");
  assert.equal(resizeCursorForDirections(["bottom", "right"]), "nwse-resize");
  assert.equal(resizeCursorForDirections([]), "");
});
