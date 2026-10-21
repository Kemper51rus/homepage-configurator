import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const routeUrl = new URL("../overlay/src/pages/api/ingress/[...path].js", import.meta.url);
const helperUrl = new URL("../overlay/src/mods/browser-editor/lib/local-icon-path.js", import.meta.url);
const source = await readFile(routeUrl, "utf8");
// Substitute only Next's import alias, then execute the complete real handler.
// The shared helper is real too, so Unicode/allowlist behavior cannot drift.
const transformed = source.replace('from "mods/browser-editor/lib/local-icon-path"', `from ${JSON.stringify(helperUrl.href)}`);
assert.notEqual(transformed, source);
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);

function request(method, query) {
  const headers = {};
  const response = {
    headers,
    statusCode: undefined,
    ended: false,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    end(...args) { assert.equal(args.length, 0); this.ended = true; return this; },
  };
  handler({ method, query }, response);
  assert.equal(response.ended, true);
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["x-content-type-options"], "nosniff");
  return response;
}

function iconSegments(count = 1, filename = "name.png") {
  return `${"/api/ingress/homepage_ingress".repeat(count)}/api/config/icon/${filename}`.slice("/api/ingress/".length).split("/");
}

function notFound(query, method = "GET") {
  const res = request(method, query);
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers.location, undefined);
}

test("GET/HEAD repair exactly one/four ingress prefixes with a bodyless 307", () => {
  for (const method of ["GET", "HEAD"]) {
    for (const count of [1, 4]) {
      for (const filename of ["name.png", "Моя иконка (1).PNG", "cafe\u0301.svg", "图标.webp"]) {
        const res = request(method, { path: iconSegments(count, filename) });
        assert.equal(res.statusCode, 307);
        assert.equal(res.headers.location, `/api/config/icon/${encodeURIComponent(filename)}`);
        assert.equal(new URL(res.headers.location, "https://homepage.invalid").origin, "https://homepage.invalid");
      }
    }
  }
});

test("foreign routes, unsafe filenames and malformed catch-all input fail closed", () => {
  for (const path of [
    undefined, null, "homepage_ingress/api/config/icon/name.png", [], [1], [null],
    ["homepage_ingress", "api", "config", "editor"],
    ["homepage_ingress", "api", "config", "background"],
    ["homepage_ingress", "images", "name.png"],
    ["homepage_ingress", "api", "config", "icon", "nested", "name.png"],
    ["homepage_ingress", "api", "config", "icon", "name.png", "extra"],
    ...["", ".", "..", ".hidden.png", "foo..png", "name.html", "name.png?token=secret", "name.png#hash", "name.png\n", "name\u0000.png", "name\u007f.png", "name\u0085.png", "../name.png", "a/name.png", "a\\name.png", "%2e%2e%2fname.png", "a%2Fname.png", "a%5cname.png", "%252f.png", "https://evil.test/name.png", "//evil.test/name.png"].map((name) => iconSegments(1, name)),
    // Decoded Next catch-all: encoded separators must not create boundaries.
    ["homepage_ingress/api/config/icon/name.png"],
    ["homepage_ingress", "api/config/icon", "name.png"],
    ["homepage_ingress", "api", "config", "icon", "a/name.png"],
    ["homepage_ingress", "api", "config", "icon", "a\\name.png"],
    ["homepage_ingress\\api", "config", "icon", "name.png"],
    ["..", "api", "config", "icon", "name.png"],
    ["https:", "", "evil.test", ...iconSegments()],
    ["", "evil.test", ...iconSegments()],
    ["homepage_ingress", "api", "ingress", "..", "api", "config", "icon", "name.png"],
  ]) {
    for (const method of ["GET", "HEAD"]) notFound({ path }, method);
  }
  notFound(undefined);
  notFound({});
});

test("extra query keys are rejected rather than silently stripping credentials", () => {
  for (const key of ["token", "auth", "url", "redirect", "filename", ""]) {
    for (const value of ["secret", "", ["a", "b"]]) {
      for (const method of ["GET", "HEAD"]) notFound({ path: iconSegments(4), [key]: value }, method);
    }
  }
});

test("unsupported methods return 405 and Allow without a redirect", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "get", undefined]) {
    for (const query of [{ path: iconSegments() }, { path: [".."], token: "secret" }]) {
      const res = request(method, query);
      assert.equal(res.statusCode, 405);
      assert.equal(res.headers.allow, "GET, HEAD");
      assert.equal(res.headers.location, undefined);
    }
  }
});

test("core installer recursively discovers the route without a manifest entry", async () => {
  const installer = await readFile(new URL("../install.mjs", import.meta.url), "utf8");
  assert.match(installer, /function overlayFiles\(\)\s*\{[\s\S]*?return walk\(overlayPath\)\.map/);
  assert.match(installer, /for \(const \{ sourcePath, relativePath \} of overlayFiles\(\)\)/);
});
