import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.HOMEPAGE_BROWSER_SMOKE_URL ?? "http://127.0.0.1:3000/";
const browser = await chromium.launch();
try {
  for (const width of [1440, 1920, 2816]) {
    const page = await browser.newPage({ viewport: { width, height: 1080 } });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator("#ip").waitFor({ state: "visible" });
    const result = await page.evaluate(() => {
      const size = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      };
      return {
        ip: size(document.getElementById("ip")),
        flag: size(document.querySelector("#ip .ipimg")),
        radio: size(document.getElementById("homepage-radio-root")),
        customCssRules: [...document.styleSheets].filter((sheet) => sheet.href?.includes("/api/config/custom.css")).reduce((total, sheet) => total + sheet.cssRules.length, 0),
      };
    });
    assert.ok(result.customCssRules > 10, "Managed custom CSS is missing");
    assert.ok(result.ip?.height <= 64, "IP widget expanded vertically");
    if (result.flag) assert.ok(result.flag.width <= 48 && result.flag.height <= 48, "IP flag expanded to natural asset dimensions");
    if (result.radio) assert.ok(result.radio.height <= 64, "Radio controls expanded vertically");
    console.log(JSON.stringify({ width, ...result }));
    await page.close();
  }
  console.log("IP/radio topbar layout smoke passed");
} finally {
  await browser.close();
}
