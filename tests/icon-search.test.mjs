import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  iconBaseNameWithoutVariant,
  iconFileName,
  iconNameMatchesQuery,
  iconRepositorySearchPrefixes,
  iconSearchScore,
  isSupportedIconFile,
  normalizeIconSearchText,
} from "../overlay/src/mods/browser-editor/lib/icon-search.js";

test("icon search matches base query against light and dark variants", () => {
  const files = [
    "png/vaultwarden-light.png",
    "png/vaultwarden.png",
    "svg/vaultwarden-dark.svg",
    "meta/vaultwarden.json",
    "png/other.png",
  ];

  const matches = files.filter((file) => isSupportedIconFile(file) && iconNameMatchesQuery(file, "vaultwarden"));

  assert.deepEqual(matches, ["png/vaultwarden-light.png", "png/vaultwarden.png", "svg/vaultwarden-dark.svg"]);
  assert.equal(iconNameMatchesQuery("png/vaultwarden-light.png", "vaultwarden-light"), true);
  assert.equal(iconNameMatchesQuery("png/home-assistant.png", "homeassistant"), true);
  assert.equal(iconFileName("png/vaultwarden-light.png"), "vaultwarden-light.png");
  assert.equal(normalizeIconSearchText("si-vaultwarden-light.svg"), "vaultwarden-light");
  assert.equal(iconBaseNameWithoutVariant("vaultwarden-light.svg"), "vaultwarden");
});

test("icon search scores exact icon before variants", () => {
  const files = ["vaultwarden-light.png", "vaultwarden.svg", "vaultwarden.png"];
  const sorted = [...files].sort((left, right) => iconSearchScore(left, "vaultwarden") - iconSearchScore(right, "vaultwarden"));

  assert.deepEqual(sorted, ["vaultwarden.png", "vaultwarden.svg", "vaultwarden-light.png"]);
});

test("icon repository search expands format directories to sibling icon formats", () => {
  assert.deepEqual(iconRepositorySearchPrefixes("/png"), ["png/", "svg/", "webp/", "avif/", "ico/", "jpg/", "jpeg/", "gif/"]);
  assert.deepEqual(iconRepositorySearchPrefixes("/assets/png"), [
    "assets/png/",
    "assets/svg/",
    "assets/webp/",
    "assets/avif/",
    "assets/ico/",
    "assets/jpg/",
    "assets/jpeg/",
    "assets/gif/",
  ]);
  assert.deepEqual(iconRepositorySearchPrefixes("/icons"), ["icons/"]);
  assert.deepEqual(iconRepositorySearchPrefixes(""), [""]);
});

test("managed title CSS consumes card-level configurator variables", () => {
  const extrasCss = readFileSync(new URL("../custom-config/extras/custom.css", import.meta.url), "utf8");
  const patch = readFileSync(new URL("../browser-editor.patch", import.meta.url), "utf8");

  assert.match(extrasCss, /color:\s*var\(--homepage-configurator-title-color,\s*#f5f5f583\)\s*!important;/);
  assert.match(extrasCss, /font-size:\s*var\(--homepage-configurator-title-size,/);
  assert.match(patch, /--homepage-configurator-title-color/);
  assert.match(patch, /style=\{titleCustomProperties\(service\)\}/);
  assert.match(patch, /style=\{titleCustomProperties\(bookmark\)\}/);
});
