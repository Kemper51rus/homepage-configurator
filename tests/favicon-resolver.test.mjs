import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  extractFaviconCandidates,
  fetchRemoteIcon,
  getSafeRemoteUrl,
} from "../overlay/src/mods/browser-editor/lib/favicon-resolver.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("getSafeRemoteUrl accepts public site URLs and rejects local targets", () => {
  assert.equal(getSafeRemoteUrl("example.com"), "https://example.com/");
  assert.equal(getSafeRemoteUrl("https://example.com/app"), "https://example.com/app");
  assert.equal(getSafeRemoteUrl("http://localhost:3000"), null);
  assert.equal(getSafeRemoteUrl("https://100.64.0.1/favicon.ico"), null);
  assert.equal(getSafeRemoteUrl("https://192.168.1.10/favicon.ico"), null);
  assert.equal(getSafeRemoteUrl("https://[::1]/favicon.ico"), null);
  assert.equal(getSafeRemoteUrl("https://[::ffff:127.0.0.1]/favicon.ico"), null);
});

test("extractFaviconCandidates resolves favicon links and standard fallbacks", () => {
  const html = `
    <html>
      <head>
        <link rel="shortcut icon" href="/favicon.svg">
        <link rel="apple-touch-icon" href="https://cdn.example.com/apple.png">
      </head>
    </html>
  `;

  assert.deepEqual(extractFaviconCandidates(html, "https://example.com/docs/page"), [
    "https://example.com/favicon.svg",
    "https://cdn.example.com/apple.png",
    "https://example.com/favicon.ico",
    "https://example.com/apple-touch-icon.png",
  ]);
});

test("fetchRemoteIcon follows a website page to its favicon", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (url === "https://example.com/") {
      return new Response('<link rel="icon" href="/favicon.svg">', {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url === "https://example.com/favicon.svg") {
      return new Response("<svg></svg>", {
        headers: { "content-type": "image/svg+xml" },
      });
    }

    return new Response("not found", { status: 404 });
  };

  const icon = await fetchRemoteIcon("https://example.com/");

  assert.equal(icon.error, undefined);
  assert.equal(icon.resolvedFromPage, true);
  assert.equal(icon.sourceUrl, "https://example.com/favicon.svg");
  assert.equal(icon.buffer.toString("utf8"), "<svg></svg>");
  assert.deepEqual(calls, ["https://example.com/", "https://example.com/favicon.svg"]);
});

test("fetchRemoteIcon rejects redirects to local targets", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));

    return new Response("", {
      headers: { location: "http://127.0.0.1/favicon.ico" },
      status: 302,
    });
  };

  const icon = await fetchRemoteIcon("https://example.com/");

  assert.equal(icon.error, "Remote URL is not allowed");
  assert.deepEqual(calls, ["https://example.com/"]);
});
