import { chromium } from "playwright";

const url = process.env.HOMEPAGE_BROWSER_SMOKE_URL || "http://127.0.0.1:3000/";
const expectedText = process.env.HOMEPAGE_BROWSER_SMOKE_TEXT || "";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const failures = [];

page.on("pageerror", (error) => {
  failures.push(`pageerror: ${error.message}`);
});

page.on("console", (message) => {
  const text = message.text();
  const ignoredResourceError =
    text.includes("Failed to load resource") ||
    text.includes("ERR_BLOCKED_BY_RESPONSE") ||
    text.includes("ERR_BLOCKED_BY_CLIENT");

  if (message.type() === "error" && !ignoredResourceError) {
    failures.push(`console error: ${text}`);
  }
});

try {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!response || !response.ok()) {
    failures.push(`navigation failed: ${response?.status() ?? "no response"}`);
  }

  await page.waitForSelector("#__next", { timeout: 10000 });
  await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const title = await page.title();

  if (expectedText && !bodyText.includes(expectedText) && !title.includes(expectedText)) {
    failures.push(`expected ${expectedText} in title/body, got title: ${title}`);
  }

  if (bodyText.includes("Something went wrong")) {
    failures.push("Next.js error boundary is visible");
  }

  if (failures.length) {
    throw new Error(failures.join("\n"));
  }

  console.log(`Browser smoke passed: ${url}`);
} finally {
  await browser.close();
}
