import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  cardBackgroundStyle,
  normalizeCardBackgroundPosition,
  resolveCardBackgroundSource,
} from "../overlay/src/mods/browser-editor/lib/card-background.js";

test("card backgrounds support uploaded, remote and catalog images", () => {
  assert.equal(
    resolveCardBackgroundSource("/api/config/icon/background.webp"),
    "/api/config/icon/background.webp",
  );
  assert.equal(
    resolveCardBackgroundSource("mdi-home"),
    "https://gcore.jsdelivr.net/npm/@mdi/svg@latest/svg/home.svg",
  );
  assert.equal(
    resolveCardBackgroundSource("poster.png"),
    "/api/config/icon/poster.png",
  );
  assert.equal(
    resolveCardBackgroundSource("https://images.example/card.jpg"),
    "https://images.example/card.jpg",
  );
});

test("card background follows card height while preserving image proportions", () => {
  assert.deepEqual(cardBackgroundStyle("poster.png", "20% 75%"), {
    backgroundImage: 'url("/api/config/icon/poster.png")',
    backgroundPosition: "20% 50%",
    backgroundRepeat: "no-repeat",
    backgroundSize: "auto 100%",
  });
});

test("card background position is bounded and normalized", () => {
  assert.equal(normalizeCardBackgroundPosition("25 80"), "25% 50%");
  assert.equal(normalizeCardBackgroundPosition("100% 0%"), "100% 50%");
  assert.equal(normalizeCardBackgroundPosition(""), "50% 50%");
  assert.equal(normalizeCardBackgroundPosition("101% 50%"), "");
  assert.equal(normalizeCardBackgroundPosition("left top"), "");
});

test("card backgrounds reject credentials, control characters and CSS fragments", () => {
  assert.equal(
    resolveCardBackgroundSource("https://user:pass@example.com/a"),
    "",
  );
  assert.equal(resolveCardBackgroundSource("javascript:alert(1)"), "");
  assert.equal(resolveCardBackgroundSource('x.png\"); color: red'), "");
  assert.equal(resolveCardBackgroundSource("bad\nimage.png"), "");
});

test("Studio preview and Homepage cards preserve proportions by height", async () => {
  const [studioSource, patchSource, cardCss] = await Promise.all([
    readFile(
      new URL(
        "../overlay/src/mods/browser-editor/components/dashboard-studio.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../browser-editor.patch", import.meta.url), "utf8"),
    readFile(
      new URL("../custom-config/cards/custom.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(studioSource, /data-studio-card-preview="true"/);
  assert.match(studioSource, /config\.cardBackgroundPosition/);
  assert.match(studioSource, /cardBackground:\s*cardBackground\.trim\(\)/);
  assert.match(studioSource, /Сдвинуть фон влево/);
  assert.match(studioSource, /Сдвинуть фон вправо/);
  assert.doesNotMatch(studioSource, /Сдвинуть фон вверх/);
  assert.doesNotMatch(studioSource, /Сдвинуть фон вниз/);
  assert.match(studioSource, /\["Слева", "0% 50%"\]/);
  assert.match(studioSource, /\["Справа", "100% 50%"\]/);
  assert.match(
    studioSource,
    /aria-label="Сдвинуть фон влево"[\s\S]*?nudgePosition\(-5\)/,
  );
  assert.match(
    studioSource,
    /aria-label="Сдвинуть фон вправо"[\s\S]*?nudgePosition\(5\)/,
  );
  assert.match(patchSource, /--homepage-configurator-card-background/);
  assert.match(patchSource, /--homepage-configurator-card-background-position/);
  assert.match(cardCss, /background-size:\s*auto 100% !important/);
  assert.match(cardCss, /--homepage-configurator-card-background-position/);
});
