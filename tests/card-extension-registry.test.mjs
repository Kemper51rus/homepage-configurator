import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const registrySource = readFileSync(
  new URL("../overlay/src/mods/browser-editor/components/installed-card-extensions.js", import.meta.url),
  "utf8",
);
const currentPatch = readFileSync(new URL("../browser-editor.patch", import.meta.url), "utf8");
const v2Patch = readFileSync(new URL("../browser-editor-homepage-2.0.patch", import.meta.url), "utf8");

const patches = [
  ["current", currentPatch],
  ["Homepage v2.0.0", v2Patch],
];

test("default card extension registry is neutral and core-only", () => {
  assert.match(registrySource, /installedCardExtensions\s*=\s*Object\.freeze\(\[\]\)/);
  assert.match(registrySource, /export function getCardExtraStyle/);
  assert.match(registrySource, /export function getServiceBadgeComponents/);
  assert.match(registrySource, /export function renderServiceCardBadges/);
  assert.doesNotMatch(registrySource, /homepage-studio|studio\//i);
  assert.doesNotMatch(registrySource, /https?:\/\//i);
});

for (const [name, patch] of patches) {
  test(`${name} patch connects bookmark and service cards to the extension registry`, () => {
    assert.match(patch, /mods\/browser-editor\/components\/installed-card-extensions/);
    assert.match(patch, /getCardExtraStyle\("bookmark", bookmark\)/);
    assert.match(patch, /getCardExtraStyle\("service", service\)/);
    assert.match(patch, /renderServiceCardBadges\(service\)/);
  });
}

test("current patch preserves the upstream cardStyle classes", () => {
  assert.match(currentPatch, /const cardStyle\s*=/);
  assert.match(currentPatch, /\+?\s+cardStyle,/);
});
