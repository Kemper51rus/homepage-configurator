import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.HOMEPAGE_BROWSER_SMOKE_URL;
const site = process.env.HOMEPAGE_ICON_SMOKE_SITE_URL;
assert.ok(url && site, "Set HOMEPAGE_BROWSER_SMOKE_URL and HOMEPAGE_ICON_SMOKE_SITE_URL (a reachable site with favicon)");
const testName = `ICON_DISCOVERY_SMOKE_${Date.now()}`;
const testNames = new Set([testName, `${testName}_SERVICE`, `${testName}_FAILURE`]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const endpoint = new URL("/api/config/editor", url).href;
const customCssUrl = new URL("/api/config/custom.css", url).href;
const outsideTitleStyles = (css) => css.replace(/\/\* --- HOMEPAGE-CONFIGURATOR TITLE STYLES START --- \*\/[\s\S]*?\/\* --- HOMEPAGE-CONFIGURATOR TITLE STYLES END --- \*\//g, "").trim();
const originalCssResponse = await page.request.get(customCssUrl);
assert.ok(originalCssResponse.ok());
const originalCustomCss = outsideTitleStyles(await originalCssResponse.text());
const requestConfig = async () => {
  const response = await page.request.get(endpoint);
  assert.ok(response.ok());
  return response.json();
};
const findTestItem = (groups) => {
  for (const group of groups) for (const entries of Object.values(group)) {
    if (!Array.isArray(entries)) continue;
    const entry = entries.find((item) => Object.prototype.hasOwnProperty.call(item, testName));
    if (entry) return Array.isArray(entry[testName]) ? entry[testName][0] : entry[testName];
  }
  return null;
};
try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.mouse.move(20, 980);
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByLabel("Имя", { exact: true }).fill(testName);
  await page.getByLabel("URL", { exact: true }).fill(site);
  const discovery = page.waitForResponse((response) => response.url().endsWith("/api/config/icon/discover") && response.request().method() === "POST");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/config/editor") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const response = await discovery;
  assert.equal(response.status(), 200, await response.text());
  const icon = (await response.json()).localIcon;
  assert.match(icon, /^\/api\/config\/icon\/discovered-[a-f0-9]{64}\.(gif|ico|jpg|png|svg|webp)$/);
  assert.equal((await saved).status(), 200);
  assert.equal(findTestItem((await requestConfig()).bookmarks)?.icon, icon);
  const asset = await page.request.get(new URL(icon, url).href);
  assert.ok(asset.ok());
  assert.equal(asset.headers()["x-content-type-options"], "nosniff");
  console.log("New bookmark first-save icon discovery passed");

  let editedDiscovery = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/config/icon/discover")) editedDiscovery += 1; });
  await page.getByRole("button", { name: `Edit ${testName}`, exact: true }).click();
  const edited = page.waitForResponse((response) => response.url().endsWith("/api/config/editor") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  assert.equal((await edited).status(), 200);
  assert.equal(editedDiscovery, 0);
  console.log("Existing bookmark edit preserves icon without rediscovery");

  await page.getByRole("button", { name: "Add service", exact: true }).first().click();
  await page.getByLabel("Имя", { exact: true }).fill(`${testName}_SERVICE`);
  await page.getByLabel("URL", { exact: true }).fill(site);
  const serviceDiscovery = page.waitForResponse((r) => r.url().endsWith("/api/config/icon/discover") && r.request().method() === "POST");
  const serviceSave = page.waitForResponse((r) => r.url().endsWith("/api/config/editor") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  assert.equal((await serviceDiscovery).status(), 200);
  assert.equal((await serviceSave).status(), 200);
  const services = (await requestConfig()).services;
  const service = services.flatMap((g) => Object.values(g).flat()).find((e) => e[`${testName}_SERVICE`]);
  assert.equal(service?.[`${testName}_SERVICE`]?.icon, icon);
  console.log("New service first-save icon discovery passed");

  await page.route("**/api/config/icon/discover", (route) => route.fulfill({ status: 400, body: "No favicon" }));
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByLabel("Имя", { exact: true }).fill(`${testName}_FAILURE`);
  await page.getByLabel("URL", { exact: true }).fill(site);
  const failedDiscoverySave = page.waitForResponse((r) => r.url().endsWith("/api/config/editor") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  assert.equal((await failedDiscoverySave).status(), 200);
  console.log("Failed icon discovery does not block saving");
} finally {
  try {
    // Read current data: remove only our unique test entry, preserving other edits.
    const data = await requestConfig();
    for (const file of ["bookmarks", "services"]) {
      let changed = false;
      for (const group of data[file]) for (const [name, entries] of Object.entries(group)) {
        if (!Array.isArray(entries)) continue;
        const filtered = entries.filter((item) => !Object.keys(item).some((key) => testNames.has(key)));
        if (filtered.length !== entries.length) { group[name] = filtered; changed = true; }
      }
      if (changed) {
        const response = await page.request.put(endpoint, { data: { file, data: data[file] } });
        assert.ok(response.ok(), `Failed to remove test ${file} entries`);
      }
    }
    const cssResponse = await page.request.get(customCssUrl);
    assert.ok(cssResponse.ok());
    assert.equal(outsideTitleStyles(await cssResponse.text()), originalCustomCss, "Card saves lost custom CSS outside generated title styles");
    console.log("User and managed custom CSS preserved across all card saves");
  } finally {
    await browser.close();
  }
}
