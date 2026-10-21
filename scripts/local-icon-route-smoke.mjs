import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const base = process.env.HOMEPAGE_BROWSER_SMOKE_URL;
assert.ok(base, "Задайте HOMEPAGE_BROWSER_SMOKE_URL");
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.locator("li.bookmark").first().waitFor({ state: "attached" });
  await page.waitForFunction(() => [...document.querySelectorAll("li.bookmark img")].every((image) => image.complete), null, { timeout: 15000 });
  const images = await page.locator("li.bookmark img").evaluateAll((elements) => elements.map((image) => ({
    src: image.getAttribute("src"), loaded: image.naturalWidth > 0,
  })));
  assert.ok(images.length > 0, "Нет иконок для проверки");
  assert.deepEqual(images.filter((image) => !image.loaded), [], "Есть неработающие изображения закладок");
  const icons = [...new Set(images.map((image) => image.src).filter((src) => src?.startsWith("/api/config/icon/")))];
  assert.ok(icons.length > 0, "Нет локальных API-иконок для проверки старых маршрутов");
  const sample = new Map();
  for (const icon of icons) {
    const extension = icon.split(".").at(-1).toLowerCase();
    if (!sample.has(extension)) sample.set(extension, icon);
  }
  for (const icon of sample.values()) {
    const canonical = await page.request.get(new URL(icon, base).href);
    assert.equal(canonical.status(), 200);
    assert.match(canonical.headers()["content-type"], /^image\//);
    const hash = createHash("sha256").update(await canonical.body()).digest("hex");
    for (const depth of [1, 2, 4]) {
      const legacy = "/api/ingress/homepage_ingress".repeat(depth) + icon;
      const redirect = await page.request.get(new URL(legacy, base).href, { maxRedirects: 0 });
      assert.equal(redirect.status(), 307, `Нет совместимости для ${depth} префиксов`);
      assert.equal(redirect.headers().location, icon);
      assert.equal(redirect.headers()["cache-control"], "no-store");
      const response = await page.request.get(new URL(legacy, base).href);
      assert.equal(response.status(), 200);
      assert.match(response.headers()["content-type"], /^image\//);
      assert.equal(createHash("sha256").update(await response.body()).digest("hex"), hash);
      const loaded = await page.evaluate((src) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0);
        image.onerror = () => resolve(false);
        image.src = src;
      }), legacy);
      assert.ok(loaded, "Браузер не декодировал старый URL изображения");
    }
  }
  const invalid = await page.request.get(new URL("/api/ingress/homepage_ingress/api/config/editor", base).href, { maxRedirects: 0 });
  assert.equal(invalid.status(), 404);
  console.log(JSON.stringify({ images: images.length, localIcons: icons.length, checkedFormats: [...sample.keys()], legacyDepths: [1, 2, 4], result: "Все иконки и старые маршруты работают" }));
} finally {
  await browser.close();
}
