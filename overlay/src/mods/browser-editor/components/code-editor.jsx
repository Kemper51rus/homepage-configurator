import classNames from "classnames";
import Prism from "prismjs";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const CODE_EDITOR_ZOOM_STORAGE_KEY = "homepage-browser-editor-code-zoom";
const CODE_EDITOR_MIN_ZOOM = 1;
const CODE_EDITOR_MAX_ZOOM = 500;

function CodeEditorTheme() {
  return (
    <style jsx global>{`
      .homepage-editor-code .token.comment,
      .homepage-editor-code .token.prolog,
      .homepage-editor-code .token.doctype,
      .homepage-editor-code .token.cdata {
        color: #7c8798;
      }

      .dark .homepage-editor-code .token.comment,
      .dark .homepage-editor-code .token.prolog,
      .dark .homepage-editor-code .token.doctype,
      .dark .homepage-editor-code .token.cdata {
        color: #7f8ea3;
      }

      .homepage-editor-code .token.punctuation {
        color: #67758a;
      }

      .dark .homepage-editor-code .token.punctuation {
        color: #94a3b8;
      }

      .homepage-editor-code .token.property,
      .homepage-editor-code .token.tag,
      .homepage-editor-code .token.constant,
      .homepage-editor-code .token.symbol,
      .homepage-editor-code .token.deleted {
        color: #9f2d56;
      }

      .dark .homepage-editor-code .token.property,
      .dark .homepage-editor-code .token.tag,
      .dark .homepage-editor-code .token.constant,
      .dark .homepage-editor-code .token.symbol,
      .dark .homepage-editor-code .token.deleted {
        color: #f472b6;
      }

      .homepage-editor-code .token.boolean,
      .homepage-editor-code .token.number {
        color: #b45309;
      }

      .dark .homepage-editor-code .token.boolean,
      .dark .homepage-editor-code .token.number {
        color: #fbbf24;
      }

      .homepage-editor-code .token.selector,
      .homepage-editor-code .token.attr-name,
      .homepage-editor-code .token.string,
      .homepage-editor-code .token.char,
      .homepage-editor-code .token.builtin,
      .homepage-editor-code .token.inserted {
        color: #0f766e;
      }

      .dark .homepage-editor-code .token.selector,
      .dark .homepage-editor-code .token.attr-name,
      .dark .homepage-editor-code .token.string,
      .dark .homepage-editor-code .token.char,
      .dark .homepage-editor-code .token.builtin,
      .dark .homepage-editor-code .token.inserted {
        color: #5eead4;
      }

      .homepage-editor-code .token.operator,
      .homepage-editor-code .token.entity,
      .homepage-editor-code .token.url,
      .homepage-editor-code .language-css .token.string,
      .homepage-editor-code .style .token.string {
        color: #2563eb;
      }

      .dark .homepage-editor-code .token.operator,
      .dark .homepage-editor-code .token.entity,
      .dark .homepage-editor-code .token.url,
      .dark .homepage-editor-code .language-css .token.string,
      .dark .homepage-editor-code .style .token.string {
        color: #7dd3fc;
      }

      .homepage-editor-code .token.atrule,
      .homepage-editor-code .token.attr-value,
      .homepage-editor-code .token.keyword {
        color: #7c3aed;
      }

      .dark .homepage-editor-code .token.atrule,
      .dark .homepage-editor-code .token.attr-value,
      .dark .homepage-editor-code .token.keyword {
        color: #c4b5fd;
      }

      .homepage-editor-code .token.function,
      .homepage-editor-code .token.class-name {
        color: #c2410c;
      }

      .dark .homepage-editor-code .token.function,
      .dark .homepage-editor-code .token.class-name {
        color: #fdba74;
      }

      .homepage-editor-scroll {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      .homepage-editor-scroll::-webkit-scrollbar {
        width: 0;
        height: 0;
        display: none;
      }

      .homepage-editor-highlight,
      .homepage-editor-textarea,
      .homepage-editor-code {
        margin: 0;
        border: 0;
        box-sizing: border-box;
        font-family: inherit !important;
        font-size: inherit !important;
        font-style: inherit;
        font-variant-ligatures: inherit;
        font-weight: inherit;
        letter-spacing: inherit;
        line-height: inherit !important;
        tab-size: 2;
        text-indent: inherit;
        text-rendering: inherit;
        text-transform: inherit;
      }

      .homepage-editor-code {
        padding: 0 !important;
        margin: 0 !important;
        background: transparent !important;
        border: 0 !important;
        display: block !important;
        white-space: pre !important;
      }

      .homepage-editor-highlight {
        pointer-events: none;
      }

      .homepage-editor-highlight,
      .homepage-editor-highlight code {
        white-space: pre !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
      }

      .homepage-editor-textarea {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        resize: none;
        background: transparent;
        overflow: auto;
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
        caret-color: #111827 !important;
        white-space: pre !important;
        overflow-wrap: normal !important;
        word-break: normal !important;
        scrollbar-width: thin !important;
        scrollbar-color: rgba(156, 163, 175, 0.4) transparent !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar {
        width: 10px !important;
        height: 10px !important;
        display: block !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar-track {
        background: transparent !important;
        display: block !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar-thumb {
        background: rgba(156, 163, 175, 0.4) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
        border-radius: 9999px !important;
        display: block !important;
      }

      .homepage-editor-textarea::-webkit-scrollbar-thumb:hover {
        background: rgba(156, 163, 175, 0.6) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
      }

      .dark .homepage-editor-textarea::-webkit-scrollbar-thumb {
        background: rgba(156, 163, 175, 0.3) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
      }

      .dark .homepage-editor-textarea::-webkit-scrollbar-thumb:hover {
        background: rgba(156, 163, 175, 0.5) !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
      }

      .dark .homepage-editor-textarea {
        caret-color: #f8fafc !important;
      }

      .homepage-editor-textarea:focus {
        outline: none;
      }

    `}</style>
  );
}

function escapeCodeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightEditorCode(value, language) {
  if (!value) {
    return "";
  }

  if (language === "plain" || !Prism.languages[language]) {
    return escapeCodeHtml(value);
  }

  try {
    return Prism.highlight(value, Prism.languages[language], language);
  } catch {
    return escapeCodeHtml(value);
  }
}

function lineCommentSyntax(language) {
  if (language === "javascript") {
    return { kind: "line", token: "//" };
  }

  if (language === "css") {
    return { kind: "block", start: "/*", end: "*/" };
  }

  return { kind: "line", token: "#" };
}

function selectedLineRange(value, selectionStart, selectionEnd) {
  const start = Math.max(0, Number(selectionStart) || 0);
  const end = Math.max(start, Number(selectionEnd) || start);
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = value.indexOf("\n", end);

  if (lineEnd === -1) {
    lineEnd = value.length;
  }

  return { lineStart, lineEnd };
}

function toggleLineComments(value, selectionStart, selectionEnd, language) {
  const syntax = lineCommentSyntax(language);
  const { lineStart, lineEnd } = selectedLineRange(value, selectionStart, selectionEnd);
  const before = value.slice(0, lineStart);
  const selected = value.slice(lineStart, lineEnd);
  const after = value.slice(lineEnd);
  const lines = selected.split("\n");
  const hasCodeLines = lines.some((line) => line.trim().length > 0);
  const activeLines = hasCodeLines ? lines.filter((line) => line.trim().length > 0) : lines;

  const allCommented = activeLines.length
    ? activeLines.every((line) => {
        const indent = line.match(/^\s*/)?.[0] ?? "";
        const body = line.slice(indent.length);

        if (syntax.kind === "block") {
          return body.startsWith(syntax.start) && body.trimEnd().endsWith(syntax.end);
        }

        return body.startsWith(syntax.token);
      })
    : false;

  const nextLines = lines.map((line) => {
    if (hasCodeLines && !line.trim()) {
      return line;
    }

    const indent = line.match(/^\s*/)?.[0] ?? "";
    const body = line.slice(indent.length);

    if (syntax.kind === "block") {
      if (allCommented) {
        const withoutStart = body.startsWith(syntax.start) ? body.slice(syntax.start.length).replace(/^ ?/, "") : body;
        const withoutEnd = withoutStart.endsWith(syntax.end)
          ? withoutStart.slice(0, -syntax.end.length).replace(/ ?$/, "")
          : withoutStart;
        return `${indent}${withoutEnd}`;
      }

      return `${indent}${syntax.start} ${body} ${syntax.end}`;
    }

    if (allCommented) {
      const withoutToken = body.startsWith(syntax.token) ? body.slice(syntax.token.length).replace(/^ ?/, "") : body;
      return `${indent}${withoutToken}`;
    }

    return `${indent}${syntax.token} ${body}`;
  });

  const nextSelected = nextLines.join("\n");

  return {
    value: `${before}${nextSelected}${after}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextSelected.length,
  };
}

export function CodeEditor({
  label,
  value,
  onChange,
  language = "plain",
  placeholder = "",
  minHeightClassName = "min-h-[16rem]",
  fillAvailableHeight = false,
  zoomStorageKey = CODE_EDITOR_ZOOM_STORAGE_KEY,
  readOnly = false,
}) {
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const [zoom, setZoom] = useState(() => {
    if (typeof window === "undefined" || !zoomStorageKey) {
      return 100;
    }

    const stored = Number.parseInt(window.localStorage.getItem(zoomStorageKey) ?? "", 10);
    return Number.isFinite(stored) ? Math.min(CODE_EDITOR_MAX_ZOOM, Math.max(CODE_EDITOR_MIN_ZOOM, stored)) : 100;
  });
  const highlightedCode = useMemo(() => highlightEditorCode(value, language), [language, value]);
  const editorFontSize = Math.round((13 * zoom) / 100 * 100) / 100;
  const editorLineHeight = `${Math.round((24 * zoom) / 100 * 100) / 100}px`;
  const zoomDecreaseStep = zoom <= 10 ? 1 : 10;
  const zoomIncreaseStep = zoom < 10 ? 1 : 10;

  const syncScrollPosition = useCallback((source) => {
    if (!highlightRef.current) {
      return;
    }

    highlightRef.current.scrollTop = source.scrollTop;
    highlightRef.current.scrollLeft = source.scrollLeft;
  }, []);

  const handleScroll = useCallback(
    (event) => {
      syncScrollPosition(event.currentTarget);
    },
    [syncScrollPosition],
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (readOnly) {
        return;
      }

      if (event.key !== "/" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
        return;
      }

      event.preventDefault();
      const target = event.currentTarget;
      const next = toggleLineComments(value, target.selectionStart, target.selectionEnd, language);
      onChange(next.value);

      window.requestAnimationFrame(() => {
        target.selectionStart = next.selectionStart;
        target.selectionEnd = next.selectionEnd;
        syncScrollPosition(target);
      });
    },
    [language, onChange, readOnly, syncScrollPosition, value],
  );

  const jumpToMarker = useCallback(
    (marker) => {
      const index = value.indexOf(marker);
      if (index !== -1 && textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(index, index + marker.length);
        
        // Рассчитываем скролл
        const textBefore = value.substring(0, index);
        const lines = textBefore.split("\n").length;
        const lineVal = Math.round((24 * zoom) / 100 * 100) / 100; // Высота строки
        const targetScrollTop = Math.max(0, (lines - 2) * lineVal);
        textareaRef.current.scrollTop = targetScrollTop;
        syncScrollPosition(textareaRef.current);
      }
    },
    [value, zoom, syncScrollPosition],
  );

  const jumpButtons = useMemo(() => {
    if (placeholder === "custom.css") {
      return [
        {
          marker: "/* --- HOMEPAGE-CONFIGURATOR TITLE STYLES START --- */",
          label: "Стили configurator",
        },
        {
          marker: "/* >>> HOMEPAGE-EDITOR COLOR CARDS CSS START >>> */",
          label: "Цветные карточки",
        },
        {
          marker: "/* >>> HOMEPAGE-EDITOR CUSTOM EXTRAS CSS START >>> */",
          label: "Дополнительные стили",
        },
        {
          marker: "/* >>> HOMEPAGE-EDITOR PARTICLES CSS START >>> */",
          label: "Стили живых обоев",
        },
        {
          marker: "/* >>> HOMEPAGE-EDITOR RADIO CSS START >>> */",
          label: "Стили радио",
        },
      ].filter(btn => value.includes(btn.marker));
    }
    if (placeholder === "custom.js") {
      return [
        {
          marker: "/* >>> HOMEPAGE-EDITOR RADIO JS START >>> */",
          label: "Скрипт радио",
        },
        {
          marker: "/* >>> HOMEPAGE-EDITOR PARTICLES JS START >>> */",
          label: "Скрипт живых обоев",
        },
      ].filter(btn => value.includes(btn.marker));
    }
    return [];
  }, [placeholder, value]);

  useEffect(() => {
    if (textareaRef.current) {
      syncScrollPosition(textareaRef.current);
    }
  }, [syncScrollPosition, value]);

  useEffect(() => {
    if (typeof window === "undefined" || !zoomStorageKey) {
      return;
    }

    window.localStorage.setItem(zoomStorageKey, String(zoom));
  }, [zoom, zoomStorageKey]);

  return (
    <label
      className={classNames(
        "min-h-0 text-xs text-theme-600 dark:text-theme-300",
        fillAvailableHeight ? "flex flex-1 flex-col" : "block",
      )}
    >
      {label}
      <CodeEditorTheme />
      <div
        className={classNames(
          "homepage-editor-surface mt-1 overflow-hidden rounded-md border border-theme-300/50 bg-theme-50 shadow-sm dark:border-white/10 dark:bg-theme-800",
          fillAvailableHeight && "flex min-h-0 flex-1 flex-col",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-theme-300/40 px-3 py-2 dark:border-white/10">
          <span className="font-medium uppercase tracking-[0.18em] opacity-70">{language === "plain" ? "text" : language}</span>
          <div className="flex items-center gap-2">
            <span className="opacity-60">{value.length} симв.</span>
            {jumpButtons.map((btn) => (
              <button
                key={btn.marker}
                type="button"
                onClick={() => jumpToMarker(btn.marker)}
                className="rounded border border-theme-300/50 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-theme-100/70 dark:border-white/10 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400"
              >
                {btn.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setZoom((current) => Math.max(CODE_EDITOR_MIN_ZOOM, current - zoomDecreaseStep))}
              className="rounded border border-theme-300/50 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-theme-100/70 dark:border-white/10 dark:hover:bg-white/10"
            >
              A-
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              className="rounded border border-theme-300/50 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-theme-100/70 dark:border-white/10 dark:hover:bg-white/10"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((current) => Math.min(CODE_EDITOR_MAX_ZOOM, current + zoomIncreaseStep))}
              className="rounded border border-theme-300/50 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-theme-100/70 dark:border-white/10 dark:hover:bg-white/10"
            >
              A+
            </button>
          </div>
        </div>
        <div
          className={classNames(
            "homepage-editor-scroll relative overflow-hidden overscroll-contain",
            fillAvailableHeight ? "flex-1" : "max-h-[min(70vh,42rem)]",
            minHeightClassName,
          )}
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: editorFontSize,
            lineHeight: editorLineHeight,
          }}
        >
          <pre
            ref={highlightRef}
            aria-hidden="true"
            className="homepage-editor-highlight absolute inset-0 overflow-hidden px-3 py-3 text-theme-900 dark:text-theme-100"
          >
            {value ? (
              <code className="homepage-editor-code" dangerouslySetInnerHTML={{ __html: `${highlightedCode}\n` }} />
            ) : (
              <code className="homepage-editor-code opacity-40">{placeholder || " "}</code>
            )}
          </pre>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              if (!readOnly) {
                onChange(event.target.value);
              }
            }}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            className="homepage-editor-textarea selection:bg-theme-300/30 px-3 py-3 dark:selection:bg-white/20"
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            data-gramm="false"
            placeholder={placeholder}
          />
        </div>
      </div>
    </label>
  );
}

