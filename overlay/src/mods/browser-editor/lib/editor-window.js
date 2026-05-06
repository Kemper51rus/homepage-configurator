export const EDITOR_WINDOW_MARGIN = 16;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function readStoredEditorWindow(storageKey) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (
      Number.isFinite(parsed?.left) &&
      Number.isFinite(parsed?.top) &&
      Number.isFinite(parsed?.width) &&
      Number.isFinite(parsed?.height)
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function writeStoredEditorWindow(storageKey, rect) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(rect));
}

export function viewportBounds() {
  if (typeof window === "undefined") {
    return { width: 1440, height: 900 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function clampEditorWindow(rect, minWidth, minHeight) {
  const viewport = viewportBounds();
  const maxWidth = Math.max(minWidth, viewport.width - EDITOR_WINDOW_MARGIN * 2);
  const maxHeight = Math.max(minHeight, viewport.height - EDITOR_WINDOW_MARGIN * 2);
  const width = clamp(rect.width, minWidth, maxWidth);
  const height = clamp(rect.height, minHeight, maxHeight);
  const left = clamp(rect.left, EDITOR_WINDOW_MARGIN, viewport.width - width - EDITOR_WINDOW_MARGIN);
  const top = clamp(rect.top, EDITOR_WINDOW_MARGIN, viewport.height - height - EDITOR_WINDOW_MARGIN);

  return { left, top, width, height };
}

export function resizeEditorWindow(rect, deltaX, deltaY, directions, minWidth, minHeight) {
  const viewport = viewportBounds();
  const startLeft = rect.left;
  const startTop = rect.top;
  const startRight = rect.left + rect.width;
  const startBottom = rect.top + rect.height;

  let nextLeft = startLeft;
  let nextTop = startTop;
  let nextRight = startRight;
  let nextBottom = startBottom;

  if (directions.includes("left")) {
    nextLeft = clamp(startLeft + deltaX, EDITOR_WINDOW_MARGIN, startRight - minWidth);
  }

  if (directions.includes("right")) {
    nextRight = clamp(startRight + deltaX, startLeft + minWidth, viewport.width - EDITOR_WINDOW_MARGIN);
  }

  if (directions.includes("top")) {
    nextTop = clamp(startTop + deltaY, EDITOR_WINDOW_MARGIN, startBottom - minHeight);
  }

  if (directions.includes("bottom")) {
    nextBottom = clamp(startBottom + deltaY, startTop + minHeight, viewport.height - EDITOR_WINDOW_MARGIN);
  }

  return clampEditorWindow(
    {
      left: nextLeft,
      top: nextTop,
      width: nextRight - nextLeft,
      height: nextBottom - nextTop,
    },
    minWidth,
    minHeight,
  );
}

export function resizeCursorForDirections(directions) {
  const hasLeftOrRight = directions.includes("left") || directions.includes("right");
  const hasTopOrBottom = directions.includes("top") || directions.includes("bottom");

  if (hasLeftOrRight && hasTopOrBottom) {
    return directions.includes("left") ? "nesw-resize" : "nwse-resize";
  }

  if (hasLeftOrRight) {
    return "ew-resize";
  }

  if (hasTopOrBottom) {
    return "ns-resize";
  }

  return "";
}

export function setGlobalResizeCursor(cursor) {
  if (typeof document === "undefined") {
    return;
  }

  document.body.style.cursor = cursor || "";
}

export function centeredEditorWindow(defaultWidth, defaultHeight, minWidth, minHeight) {
  const viewport = viewportBounds();
  const width = Math.min(defaultWidth, viewport.width - EDITOR_WINDOW_MARGIN * 2);
  const height = Math.min(defaultHeight, viewport.height - EDITOR_WINDOW_MARGIN * 2);

  return clampEditorWindow(
    {
      left: Math.round((viewport.width - width) / 2),
      top: Math.round((viewport.height - height) / 2),
      width,
      height,
    },
    minWidth,
    minHeight,
  );
}

export function anchoredEditorWindow(anchorRef, defaultWidth, defaultHeight, minWidth, minHeight) {
  const anchorRect = anchorRef?.current?.getBoundingClientRect?.();
  if (!anchorRect) {
    return centeredEditorWindow(defaultWidth, defaultHeight, minWidth, minHeight);
  }

  return clampEditorWindow(
    {
      left: anchorRect.left,
      top: Math.max(EDITOR_WINDOW_MARGIN, anchorRect.bottom + 12),
      width: defaultWidth,
      height: defaultHeight,
    },
    minWidth,
    minHeight,
  );
}
