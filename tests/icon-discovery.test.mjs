import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { discoverNewItemIcon } from "../overlay/src/mods/browser-editor/client/icon-discovery.js";
import { fetchDiscoveryResponse, fetchRemoteIcon, getIconDiscoveryApprovedOrigins, getSafeRemoteUrl, maxIconBytes } from "../overlay/src/mods/browser-editor/lib/favicon-resolver.js";

const originalLookup = dns.lookup;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
// Adapt existing fake responses through native streaming transport, with public DNS.
beforeEach(() => {
  dns.lookup = (_hostname, _options, callback) => callback(null, [{ address: "93.184.216.34", family: 4 }]);
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      (async () => {
        if (!net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
          options.lookup(url.hostname, { all: true }, (error, addresses) => {
            assert.equal(error, null); assert.equal(addresses[0].address, "93.184.216.34");
          });
        }
        const response = await globalThis.fetch(url.toString(), { signal: options.signal });
        const incoming = response.body ? Readable.fromWeb(response.body) : Readable.from([]);
        incoming.statusCode = response.status; incoming.statusMessage = response.statusText;
        incoming.headers = Object.fromEntries(response.headers);
        callback(incoming);
      })().catch((error) => req.emit("error", error));
    };
    return req;
  };
  http.request = request; https.request = request;
});
const originalFetch = globalThis.fetch;
const originalImagesDir = process.env.IMAGES_REAL_DIR;
const originalOrigins = process.env.HOMEPAGE_ICON_DISCOVERY_ALLOWED_ORIGINS;
const modal = { mode: "add", type: "services" };
const localIcon = `/api/config/icon/discovered-${"a".repeat(64)}.png`;
afterEach(() => {
  dns.lookup = originalLookup; http.request = originalHttpRequest; https.request = originalHttpsRequest;
  globalThis.fetch = originalFetch;
  for (const [key, value] of [["IMAGES_REAL_DIR", originalImagesDir], ["HOMEPAGE_ICON_DISCOVERY_ALLOWED_ORIGINS", originalOrigins]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("new-item helper preserves edits, explicit icons, other types and invalid hrefs", async () => {
  const request = () => { throw new Error("must not request"); };
  for (const candidate of [{ ...modal, mode: "edit" }, { ...modal, type: "widgets" }, null]) {
    const config = { href: "https://example.com" };
    assert.equal(await discoverNewItemIcon(candidate, config, request), config);
  }
  for (const icon of ["mdi-home", false, 0, {}, []]) {
    const config = { href: "https://example.com", icon };
    assert.equal(await discoverNewItemIcon(modal, config, request), config);
  }
  for (const href of [undefined, 42, "", "example.com", "//example.com", "/app", "https://", "https://user:pass@example.com", "ftp://example.com", "http:example.com"]) {
    const config = { href };
    assert.equal(await discoverNewItemIcon(modal, config, request), config);
  }
});
test("services and bookmarks discover on first save, with url-only body", async () => {
  for (const type of ["services", "bookmarks"]) for (const icon of [undefined, null, "", "  "]) {
    const config = { href: " HTTPS://EXAMPLE.COM ", icon, description: "keep" };
    const result = await discoverNewItemIcon({ ...modal, type }, config, async (url, options) => {
      assert.equal(url, "/api/config/icon/discover");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { url: "https://example.com/" });
      return Response.json({ success: true, localIcon });
    });
    assert.deepEqual(result, { ...config, icon: localIcon });
    assert.equal(config.icon, icon);
  }
});
test("discovery failures never prevent saving", async () => {
  const config = { href: "https://example.com" };
  for (const request of [async () => { throw new Error("network"); }, async () => new Response("error", { status: 500 }), async () => new Response("not json"), ...[null, {}, { success: false, localIcon }, { success: true, localIcon: "https://evil.example/a.svg" }, { success: true, localIcon: "/api/config/icon/../../evil.svg" }].map((value) => async () => Response.json(value))]) {
    assert.equal(await discoverNewItemIcon(modal, config, request), config);
  }
});
test("client timeout bounds stalled request and JSON parser to 8 seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const config = { href: "https://example.com" };
  for (const pendingJson of [false, true]) {
    let signal;
    const pending = discoverNewItemIcon(modal, config, async (_url, options) => {
      signal = options.signal;
      return pendingJson ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {});
    });
    t.mock.timers.tick(7999); assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); assert.equal(await pending, config); assert.equal(signal.aborted, true);
  }
});
test("server allowlist accepts only exact RFC1918/CGNAT IPv4 origins, never DNS/metadata", () => {
  const approvedOrigins = getIconDiscoveryApprovedOrigins(JSON.stringify(["http://10.0.0.1:80", "https://172.16.1.2:8443", "http://192.168.1.2", "http://100.100.0.184", "http://127.0.0.1", "http://169.254.169.254", "http://localhost", "http://internal.example", "http://10.0.0.1/path", "http://user:pass@10.0.0.1", "http://10.0.0.1?x", "http://10.0.0.1#x"]));
  assert.deepEqual(approvedOrigins, ["http://10.0.0.1", "https://172.16.1.2:8443", "http://192.168.1.2", "http://100.100.0.184"]);
  assert.equal(getSafeRemoteUrl("http://100.100.0.184"), null);
  assert.equal(getSafeRemoteUrl("http://100.100.0.184/app", { approvedOrigins }), "http://100.100.0.184/app");
  for (const url of ["https://100.100.0.184", "http://100.100.0.184:81", "http://100.100.0.185", "http://127.0.0.1", "http://169.254.169.254"]) assert.equal(getSafeRemoteUrl(url, { approvedOrigins }), null);
  assert.deepEqual(getIconDiscoveryApprovedOrigins("invalid"), []);
  assert.deepEqual(getIconDiscoveryApprovedOrigins("{}"), []);
});

test("server discovery shares one total deadline across all favicon candidates", async () => {
  const originalNow = Date.now;
  let now = 0;
  const calls = [];
  Date.now = () => now;
  try {
    globalThis.fetch = async (url) => {
      calls.push(url);
      now += 3000;
      return url === "https://example.com/"
        ? new Response('<link rel="icon" href="/a.png"><link rel="icon" href="/b.png">', { headers: { "content-type": "text/html" } })
        : new Response("not found", { status: 404 });
    };
    const result = await fetchRemoteIcon("https://example.com/", { totalTimeoutMs: 7000 });
    assert.equal(result.error, "Icon discovery timed out");
    assert.deepEqual(calls, ["https://example.com/", "https://example.com/a.png", "https://example.com/b.png"]);
  } finally { Date.now = originalNow; }
});

test("discovery rejects every private/special DNS result before connecting, even mixed answers", async () => {
  let requests = 0;
  http.request = https.request = () => { requests++; throw new Error("must not connect"); };
  const forbidden = ["127.0.0.1", "10.0.0.1", "100.100.0.184", "169.254.169.254", "168.63.129.16", "192.88.99.1", "0.0.0.0", "224.0.0.1", "::1", "::2", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "2001:db8::1", "2002:7f00:1::1"];
  for (const address of forbidden) {
    dns.lookup = (_host, _options, callback) => callback(null, [{ address: "93.184.216.34", family: 4 }, { address, family: net.isIP(address) }]);
    await assert.rejects(fetchDiscoveryResponse("https://public.example/icon.png", { approvedOrigins: ["http://100.100.0.184"] }), /not allowed/);
  }
  assert.equal(requests, 0);
  assert.deepEqual(getIconDiscoveryApprovedOrigins('["http://100.100.100.200"]'), []);
  await assert.rejects(fetchDiscoveryResponse("http://100.100.100.200/favicon.png", { approvedOrigins: ["http://100.100.100.200"] }), /not allowed/);
});
test("discovery pins verified DNS address without a second lookup and preserves Host/TLS URL", async () => {
  let lookups = 0;
  dns.lookup = (hostname, options, callback) => {
    assert.equal(hostname, "public.example"); assert.equal(options.all, true); lookups++;
    callback(null, [{ address: "93.184.216.34", family: 4 }, { address: "1.1.1.1", family: 4 }]);
  };
  https.request = (url, options, callback) => {
    assert.equal(url.hostname, "public.example"); assert.equal(url.port, "8443");
    assert.equal(options.agent, false); assert.deepEqual(options.headers, { "Accept-Encoding": "identity" });
    for (let i = 0; i < 2; i++) {
      options.lookup(url.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, "93.184.216.34"); assert.equal(family, 4); });
      options.lookup(url.hostname, { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]); });
    }
    const req = new EventEmitter(); req.end = () => {
      const incoming = Readable.from([Buffer.from("png")]); incoming.statusCode = 200; incoming.statusMessage = "OK"; incoming.headers = { "content-type": "image/png" }; callback(incoming);
    }; return req;
  };
  const response = await fetchDiscoveryResponse("https://public.example:8443/icon.png");
  assert.equal(await response.text(), "png"); assert.equal(lookups, 1);
});
test("literal approved origins bypass DNS but never trust arbitrary private literals", async () => {
  dns.lookup = () => { throw new Error("must not resolve literal"); };
  globalThis.fetch = async () => new Response("png", { headers: { "content-type": "image/png" } });
  const response = await fetchDiscoveryResponse("http://100.100.0.184/favicon.png", { approvedOrigins: ["http://100.100.0.184"] });
  assert.equal(await response.text(), "png");
  await assert.rejects(fetchDiscoveryResponse("http://100.100.0.185/favicon.png", { approvedOrigins: ["http://100.100.0.184"] }), /not allowed/);
});
test("DNS is validated again for every redirect and linked favicon hop", async () => {
  const calls = [];
  dns.lookup = (hostname, _options, callback) => callback(null, [{ address: hostname === "evil.example" ? "127.0.0.1" : "93.184.216.34", family: 4 }]);
  globalThis.fetch = async (url) => { calls.push(url); return new Response("", { status: 302, headers: { location: "https://evil.example/icon.png" } }); };
  const redirect = await fetchRemoteIcon("https://public.example/", { discoveryTransport: true });
  assert.match(redirect.error, /not allowed/); assert.deepEqual(calls, ["https://public.example/"]);
  calls.length = 0;
  globalThis.fetch = async (url) => { calls.push(url); return url === "https://public.example/" ? new Response('<link rel="icon" href="https://evil.example/icon.png">', { headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404 }); };
  const linked = await fetchRemoteIcon("https://public.example/", { discoveryTransport: true });
  assert.ok(linked.error); assert.equal(calls.some((url) => url.includes("evil.example")), false);
});
test("abort races pending DNS and prevents connecting after lookup completes", async () => {
  let completeLookup; let requests = 0;
  dns.lookup = (_host, _options, callback) => { completeLookup = callback; };
  https.request = () => { requests++; throw new Error("must not connect"); };
  const controller = new AbortController();
  const pending = fetchDiscoveryResponse("https://public.example/", { signal: controller.signal });
  const rejection = assert.rejects(pending, /abort/i);
  controller.abort(); await rejection;
  completeLookup(null, [{ address: "93.184.216.34", family: 4 }]);
  await Promise.resolve(); assert.equal(requests, 0);
});
test("abort also terminates a pending native response body", async () => {
  const controller = new AbortController(); let incoming;
  https.request = (_url, options, callback) => {
    assert.equal(options.signal, controller.signal);
    const req = new EventEmitter(); req.end = () => {
      incoming = new Readable({ read() {} }); incoming.statusCode = 200; incoming.statusMessage = "OK"; incoming.headers = { "content-type": "image/png" }; callback(incoming);
    }; return req;
  };
  const response = await fetchDiscoveryResponse("https://public.example/", { signal: controller.signal });
  const rejection = assert.rejects(response.text(), /abort/i);
  controller.abort(); await rejection; assert.equal(incoming.destroyed, true);
});
test("identity-only native transport refuses compressed responses", async () => {
  globalThis.fetch = async () => new Response("gzip bytes", { headers: { "content-type": "image/png", "content-encoding": "gzip" } });
  await assert.rejects(fetchDiscoveryResponse("https://public.example/icon.png"), /Compressed/);
});

test("native rejected responses release streaming sockets without waiting for the body", async () => {
  for (const linkedIcon of [false, true]) for (const rejection of ["status", "length", "type"]) {
    if (linkedIcon && rejection === "type") continue;
    const streams = [];
    https.request = (url, _options, callback) => {
      const req = new EventEmitter(); req.end = () => {
        const isPage = linkedIcon && url.pathname === "/";
        const incoming = isPage ? Readable.from([Buffer.from('<link rel="icon" href="/icon.png">')]) : new Readable({ read() {} });
        incoming.statusCode = !isPage && rejection === "status" ? 404 : 200;
        incoming.statusMessage = "response";
        incoming.headers = isPage ? { "content-type": "text/html" } : rejection === "type" ? { "content-type": "text/plain" } : { "content-type": "image/png", ...(rejection === "length" ? { "content-length": String(maxIconBytes + 1) } : {}) };
        streams.push(incoming); callback(incoming);
      }; return req;
    };
    const result = await fetchRemoteIcon(linkedIcon ? "https://public.example/" : "https://public.example/icon", { discoveryTransport: true });
    assert.ok(result.error); assert.ok(streams.length > 0);
    assert.ok(streams.every((stream) => stream.destroyed), `${linkedIcon}/${rejection} leaked a native stream`);
  }
});

const resolverUrl = new URL("../overlay/src/mods/browser-editor/lib/favicon-resolver.js", import.meta.url).href;
for (const route of ["mods/browser-editor/api/icon.js", "pages/api/config/icon/[file].js"]) {
  const source = await readFile(new URL(`../overlay/src/${route}`, import.meta.url), "utf8");
  const transformed = source.replace('import createLogger from "utils/logger";', 'const createLogger = () => ({ error() {}, info() {} });').replace(/from "(?:\.\.\/lib\/favicon-resolver|mods\/browser-editor\/lib\/favicon-resolver)"/, `from ${JSON.stringify(resolverUrl)}`);
  const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`);
  const invoke = async (body, action = "discover", method = "POST") => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, send(value) { this.value = value; return this; }, status(code) { this.code = code; return this; }, end(value) { this.value = value; return this; }, json(value) { this.value = value; return this; } };
    await handler({ method, query: { file: action }, body }, res); return res;
  };
  test(`${route}: MIME/hash choose filename; extra client paths and names rejected`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "icon-discovery-")); process.env.IMAGES_REAL_DIR = directory;
    try {
      const buffer = Buffer.from("actual icon bytes");
      globalThis.fetch = async () => new Response(buffer, { headers: { "content-type": "image/jpeg; charset=binary" } });
      assert.equal((await invoke({ url: "https://example.com/a.svg", name: "../../evil.png" })).code, 400);
      assert.equal((await invoke({ url: "https://example.com/a.svg", path: "/tmp/evil" })).code, 400);
      assert.deepEqual(await readdir(directory), []);
      const response = await invoke({ url: "https://example.com/a.svg" });
      const safeName = `discovered-${createHash("sha256").update(buffer).digest("hex")}.jpg`;
      assert.equal(response.code, 200); assert.deepEqual(response.value, { success: true, localIcon: `/api/config/icon/${safeName}` });
      assert.deepEqual(await readdir(path.join(directory, "icons")), [safeName]);
      assert.deepEqual(await readFile(path.join(directory, "icons", safeName)), buffer);
      const served = await invoke(undefined, safeName, "GET");
      assert.equal(served.code, 200);
      assert.equal(served.headers["Content-Type"], "image/jpeg");
      assert.equal(served.headers["X-Content-Type-Options"], "nosniff");
      assert.equal(served.headers["Content-Security-Policy"], "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test(`${route}: invalid/private URLs and untrusted MIME/oversize never write`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "icon-discovery-")); process.env.IMAGES_REAL_DIR = directory; delete process.env.HOMEPAGE_ICON_DISCOVERY_ALLOWED_ORIGINS;
    try {
      let calls = 0; globalThis.fetch = async () => { calls++; return new Response("png", { headers: { "content-type": "image/png" } }); };
      for (const url of [undefined, {}, "example.com", "//example.com", "ftp://example.com", "http://127.0.0.1", "http://100.100.0.184", "https://user:pass@example.com"]) assert.equal((await invoke({ url })).code, 400);
      assert.equal((await invoke({ url: "http://100.100.0.184", approvedOrigins: ["http://100.100.0.184"] })).code, 400);
      assert.equal(calls, 0); assert.equal((await invoke({}, "discover", "DELETE")).code, 400);
      for (const fetcher of [async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/favicon.png" } }), async () => new Response("bad", { headers: { "content-type": "text/plain" } }), async () => new Response("bad", { headers: { "content-type": "image/avif" } }), async () => new Response("", { headers: { "content-type": "image/png" } }), async () => new Response(Buffer.alloc(maxIconBytes + 1), { headers: { "content-type": "image/png" } })]) {
        globalThis.fetch = fetcher; assert.equal((await invoke({ url: "https://example.com/favicon.png" })).code, 400); assert.deepEqual(await readdir(directory), []);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test(`${route}: server-approved exact private origin works, other private redirects/download stay blocked`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "icon-discovery-")); process.env.IMAGES_REAL_DIR = directory; process.env.HOMEPAGE_ICON_DISCOVERY_ALLOWED_ORIGINS = '["http://100.100.0.184"]';
    try {
      const calls = []; globalThis.fetch = async (url) => { calls.push(url); return url === "http://100.100.0.184/" ? new Response('<link rel="icon" href="/favicon.png">', { headers: { "content-type": "text/html" } }) : new Response("png", { headers: { "content-type": "image/png" } }); };
      assert.equal((await invoke({ url: "http://100.100.0.184" })).code, 200); assert.deepEqual(calls, ["http://100.100.0.184/", "http://100.100.0.184/favicon.png"]);
      assert.equal((await invoke({ url: "http://100.100.0.184", name: "test.png" }, "download")).code, 400);
      assert.equal((await invoke({ url: "http://100.100.0.185" })).code, 400);
      calls.length = 0; globalThis.fetch = async (url) => { calls.push(url); return new Response("", { status: 302, headers: { location: "http://100.100.0.185/favicon.png" } }); };
      assert.equal((await invoke({ url: "http://100.100.0.184" })).code, 400); assert.deepEqual(calls, ["http://100.100.0.184/"]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test(`${route}: unrelated login redirect rejected, same-host HTTPS upgrade allowed`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "icon-discovery-")); process.env.IMAGES_REAL_DIR = directory;
    try {
      const calls = []; globalThis.fetch = async (url) => { calls.push(url); return url === "http://example.com/" ? new Response("", { status: 302, headers: { location: "https://login.example.org/" } }) : new Response('<link rel="icon" href="/favicon.svg">', { headers: { "content-type": "text/html" } }); };
      assert.equal((await invoke({ url: "http://example.com/" })).code, 400); assert.deepEqual(calls, ["http://example.com/", "https://login.example.org/"]); assert.deepEqual(await readdir(directory), []);
      globalThis.fetch = async (url) => url === "http://example.com/" ? new Response("", { status: 302, headers: { location: "https://example.com/" } }) : url === "https://example.com/" ? new Response('<link rel="icon" href="/a.png">', { headers: { "content-type": "text/html" } }) : new Response("<svg></svg>", { headers: { "content-type": "image/svg+xml" } });
      const result = await invoke({ url: "http://example.com/" }); assert.equal(result.code, 200); assert.match(result.value.localIcon, /\.svg$/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
test("ItemModal discovers after validation only in handleSave, never clone", async () => {
  const source = await readFile(new URL("../overlay/src/mods/browser-editor/components/editor.jsx", import.meta.url), "utf8");
  const itemModal = source.slice(source.indexOf("function ItemModal("));
  const save = itemModal.slice(itemModal.indexOf("async function handleSave()"), itemModal.indexOf("async function handleDelete()"));
  assert.match(save, /validateItemConfig\(modal.type, config\);\s*config = await discoverNewItemIcon\(modal, config\);\s*const latestData = await loadLatestEditorData/);
  const clone = itemModal.slice(itemModal.indexOf("async function handleClone()"), itemModal.indexOf("async function handleClone()") + 2000); assert.doesNotMatch(clone, /discoverNewItemIcon/);
});
