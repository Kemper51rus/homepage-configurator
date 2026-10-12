import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.HOMEPAGE_BROWSER_SMOKE_URL;
assert.ok(url, "Set HOMEPAGE_BROWSER_SMOKE_URL");
const tag = `TRANSFER_SMOKE_${Date.now()}`;
const serviceGroup = `${tag}_SERVICES`;
const bookmarkGroup = `${tag}_BOOKMARKS`;
const serviceName = `${tag}_SERVICE`;
const bookmarkName = `${tag}_BOOKMARK`;
const anchorName = `${tag}_ANCHOR`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const api = new URL("/api/config/editor", url).href;
const cssUrl = new URL("/api/config/custom.css", url).href;
const config = async () => {
  const response = await page.request.get(api);
  assert.ok(response.ok());
  return response.json();
};
const put = async (file, data) => {
  const response = await page.request.put(api, { data: { file, data } });
  assert.ok(response.ok(), await response.text());
};
const entry = (data, type, group, name) => data[type].find((g) => g[group])?.[group].find((item) => Object.prototype.hasOwnProperty.call(item, name))?.[name];
const groupSelector = (name, type) => `[data-editor-group-name="${name}"][data-editor-group-type="${type}"]`;
const cardSelector = (name, type) => `li.${type === "services" ? "service" : "bookmark"}[data-name="${name}"]`;
const outsideTitleCss = (css) => css.replace(/\/\* --- HOMEPAGE-CONFIGURATOR TITLE STYLES START --- \*\/[\s\S]*?\/\* --- HOMEPAGE-CONFIGURATOR TITLE STYLES END --- \*\//g, "").trim();
let initialCss;
let discoveryRequests = 0;
page.on("request", (request) => { if (request.url().endsWith("/api/config/icon/discover")) discoveryRequests += 1; });
async function drop(source, target) {
  await source.waitFor({ state: "attached" });
  await target.waitFor({ state: "attached" });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const responsePromise = page.waitForResponse((response) => {
    if (!response.url().endsWith("/api/config/editor") || response.request().method() !== "POST") return false;
    try { return response.request().postDataJSON()?.action === "move-item-between-types"; } catch { return false; }
  }, { timeout: 15000 });
  // Exercise native HTML drag events and the real card/drop handlers.
  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  await target.dispatchEvent("dragover", { dataTransfer: transfer });
  await target.dispatchEvent("drop", { dataTransfer: transfer });
  await source.dispatchEvent("dragend", { dataTransfer: transfer }).catch(() => {});
  const response = await responsePromise;
  assert.equal(response.status(), 200, await response.text());
  await transfer.dispose();
}
try {
  const cssResponse = await page.request.get(cssUrl);
  assert.ok(cssResponse.ok());
  initialCss = outsideTitleCss(await cssResponse.text());
  let data = await config();
  await put("services", [...data.services, { [serviceGroup]: [{ [serviceName]: {
    href: "https://example.com/service", icon: "mdi-test-tube", id: `${tag}_service_id`, description: "kept description", weight: 100, ping: false, showStats: false, internalOnly: { test: "discard" },
  } }] }]);
  data = await config();
  await put("bookmarks", [...data.bookmarks, { [bookmarkGroup]: [
    { [bookmarkName]: [{ href: "https://example.com/bookmark", icon: "mdi-book-open-page-variant", id: `${tag}_bookmark_id`, abbr: "BM", showLink: false }] },
    { [anchorName]: [{ href: "https://example.com/anchor", icon: "mdi-anchor" }] },
  ] }]);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.move(20, 980);
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const serviceCard = () => page.locator(cardSelector(serviceName, "services"));
  const bookmarkCard = () => page.locator(cardSelector(bookmarkName, "bookmarks"));
  const services = () => page.locator(groupSelector(serviceGroup, "services"));
  const bookmarks = () => page.locator(groupSelector(bookmarkGroup, "bookmarks"));

  await drop(serviceCard(), bookmarkCard());
  data = await config();
  assert.equal(entry(data, "services", serviceGroup, serviceName), undefined);
  const convertedBookmark = entry(data, "bookmarks", bookmarkGroup, serviceName)?.[0];
  assert.equal(convertedBookmark?.href, "https://example.com/service");
  assert.equal(convertedBookmark?.icon, "mdi-test-tube");
  assert.equal(convertedBookmark?.id, `${tag}_service_id`);
  assert.equal(convertedBookmark?.description, "kept description");
  for (const key of ["weight", "ping", "showStats", "internalOnly"]) assert.equal(Object.prototype.hasOwnProperty.call(convertedBookmark, key), false);
  assert.equal(Object.keys(data.bookmarks.find((g) => g[bookmarkGroup])[bookmarkGroup][0])[0], serviceName);
  console.log("Service -> bookmark card: common fields retained, service-only data discarded");

  await bookmarkCard().waitFor({ state: "attached" });
  await services().getByRole("button", { name: "Add service", exact: true }).waitFor({ state: "attached" });
  await drop(bookmarkCard(), services().getByRole("button", { name: "Add service", exact: true }));
  data = await config();
  assert.equal(entry(data, "bookmarks", bookmarkGroup, bookmarkName), undefined);
  assert.equal(entry(data, "services", serviceGroup, bookmarkName)?.href, "https://example.com/bookmark");
  assert.equal(entry(data, "services", serviceGroup, bookmarkName)?.abbr, "BM");
  assert.equal(entry(data, "services", serviceGroup, bookmarkName)?.showLink, undefined);
  console.log("Bookmark -> empty service group passed");

  await page.locator(cardSelector(bookmarkName, "services")).waitFor({ state: "attached" });
  await drop(page.locator(cardSelector(serviceName, "bookmarks")), page.locator(cardSelector(bookmarkName, "services")));
  data = await config();
  const serviceEntries = data.services.find((g) => g[serviceGroup])[serviceGroup];
  assert.deepEqual(serviceEntries.map((item) => Object.keys(item)[0]), [serviceName, bookmarkName]);
  assert.ok(serviceEntries[0][serviceName].weight < serviceEntries[1][bookmarkName].weight);
  assert.equal(serviceEntries[0][serviceName].internalOnly, undefined);
  console.log("Bookmark -> service before card preserves visual weight ordering");

  await drop(page.locator(cardSelector(bookmarkName, "services")), bookmarks().getByRole("button", { name: "Add", exact: true }));
  data = await config();
  const bookmarkEntries = data.bookmarks.find((g) => g[bookmarkGroup])[bookmarkGroup];
  assert.equal(Object.keys(bookmarkEntries.at(-1))[0], bookmarkName);
  assert.equal(discoveryRequests, 0);
  console.log("Service -> bookmark group end passed; no icon rediscovery");
} finally {
  try {
    // Remove only our isolated groups from CURRENT config, not stale snapshots.
    for (const [type, name] of [["services", serviceGroup], ["bookmarks", bookmarkGroup]]) {
      const data = await config();
      const next = data[type].filter((group) => !Object.prototype.hasOwnProperty.call(group, name));
      if (next.length !== data[type].length) await put(type, next);
    }
    if (initialCss !== undefined) {
      const response = await page.request.get(cssUrl);
      assert.ok(response.ok());
      assert.equal(outsideTitleCss(await response.text()), initialCss, "Cross-type transfers changed user/managed CSS");
    }
  } finally {
    await browser.close();
  }
}
