import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.HOMEPAGE_BROWSER_SMOKE_URL ?? "http://127.0.0.1:3000/";
const duration = Number(process.env.SCROLL_SMOKE_DURATION_MS ?? 8000);
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1100, height: 800 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    for (const position of [1100, "bottom"]) {
      const result = await page.evaluate(async ({ position, duration }) => {
        const scroller = document.querySelector("#inner_wrapper") ?? document.scrollingElement;
        scroller.scrollTop = position === "bottom" ? scroller.scrollHeight : position;
        // Settle the wheel/layout frame before tracking unintended movement.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const start = scroller.scrollTop;
        let min = start;
        let max = start;
        const card = document.querySelector(".service-card");
        for (let elapsed = 0; elapsed < duration; elapsed += 100) {
          // Non-layout card mutations simulate widget refreshes without moving
          // the document. This exercises balancing even when FPS is paused.
          if (card && elapsed % 500 === 0) {
            const tick = document.createComment("scroll-regression-tick");
            card.appendChild(tick);
            tick.remove();
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          min = Math.min(min, scroller.scrollTop);
          max = Math.max(max, scroller.scrollTop);
        }
        return { start, end: scroller.scrollTop, min, max, height: scroller.scrollHeight };
      }, { position, duration });
      console.log(JSON.stringify({ viewport, position, ...result }));
      assert.ok(result.max - result.min <= 1, `Dashboard scroll drifted ${result.max - result.min}px at ${viewport.width}px/${position}`);
    }
    assert.deepEqual(errors, [], "Dashboard raised browser errors");
    await page.close();
  }
  console.log("Dashboard scroll smoke passed");
} finally {
  await browser.close();
}
