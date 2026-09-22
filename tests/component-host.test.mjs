import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  EDITOR_COMPONENT_HOST_VERSION,
  createEditorComponentHost,
  validateInstalledEditorComponents,
} from "../overlay/src/mods/browser-editor/lib/component-host.js";

const registrySource = readFileSync(
  new URL("../overlay/src/mods/browser-editor/components/installed-components.js", import.meta.url),
  "utf8",
);

test("Classic registry is core-only and has no remote or Studio imports", () => {
  assert.match(registrySource, /installedEditorComponents\s*=\s*Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(registrySource, /homepage-studio|https?:\/\//i);
  assert.doesNotMatch(registrySource, /^\s*import\s/m);
});

test("component registry validates ids, slots and uniqueness", () => {
  const ToolbarAction = () => null;
  const Overlay = () => null;
  const validated = validateInstalledEditorComponents([{ id: "homepage-studio", ToolbarAction, Overlay }]);
  assert.equal(validated[0].id, "homepage-studio");
  assert.equal(validated[0].ToolbarAction, ToolbarAction);
  assert.throws(() => validateInstalledEditorComponents([{ id: "../studio" }]), /invalid id/);
  assert.throws(() => validateInstalledEditorComponents([{ id: "studio" }, { id: "studio" }]), /Duplicate/);
  assert.throws(() => validateInstalledEditorComponents([{ id: "studio", Overlay: "bad" }]), /must be a component function/);
});

test("host adapter exposes a frozen versioned contract", () => {
  const actions = { refresh: () => undefined };
  const host = createEditorComponentHost({ snapshot: { services: [] }, actions, editor: {}, ui: {} });
  assert.equal(host.version, EDITOR_COMPONENT_HOST_VERSION);
  assert.equal(host.version, 1);
  assert.equal(Object.isFrozen(host), true);
  assert.equal(Object.isFrozen(host.actions), true);
  assert.notEqual(host.actions, actions);
  assert.throws(() => createEditorComponentHost({}), /actions are required/);
});
