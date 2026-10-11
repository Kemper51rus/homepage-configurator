import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../custom-config/particles/custom.js", import.meta.url), "utf8");
const renderer = source.slice(
  source.indexOf("  function updateFpsButtonLabel("),
  source.indexOf("  function applyPauseState("),
);

function harness() {
  let markup = "";
  let writes = 0;
  const classes = new Set();
  const attributes = new Map();
  const button = {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; writes += 1; },
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
    setAttribute(name, value) { attributes.set(name, value); },
  };
  const state = { fpsButton: button, currentFps: 0, paused: false };
  const context = vm.createContext({ state });
  vm.runInContext(`${renderer}\nglobalThis.render = updateFpsButtonLabel;`, context);
  return { state, render: context.render, classes, attributes, writes: () => writes, markup: () => markup };
}

test("FPS placement re-render does not replace identical child nodes", () => {
  const h = harness();
  h.render(60);
  assert.equal(h.writes(), 1);
  for (let frame = 0; frame < 120; frame += 1) h.render();
  h.render(60);
  assert.equal(h.writes(), 1);
  assert.equal(h.markup(), '<span class="homepage-fps-label">60 FPS</span>');
});

test("FPS changes, pause, resume and remount still render legitimate updates", () => {
  const h = harness();
  h.render(60);
  h.render(59);
  assert.equal(h.writes(), 2);
  assert.match(h.markup(), /59 FPS/);
  h.state.paused = true;
  h.render();
  assert.equal(h.writes(), 3);
  assert.match(h.markup(), /homepage-fps-icon/);
  assert.equal(h.classes.has("is-paused"), true);
  assert.equal(h.attributes.get("aria-pressed"), "true");
  h.render();
  assert.equal(h.writes(), 3);
  h.state.paused = false;
  h.render();
  assert.equal(h.writes(), 4);
  assert.doesNotMatch(h.markup(), /homepage-fps-icon/);
  assert.equal(h.classes.has("is-paused"), false);
  assert.equal(h.attributes.get("aria-pressed"), "false");
  h.state.fpsButton.innerHTML = "";
  h.render();
  assert.equal(h.writes(), 6);
  assert.match(h.markup(), /59 FPS/);
});

test("Absent FPS button and invalid readings do not corrupt state", () => {
  const h = harness();
  h.render(60);
  h.render(Number.NaN);
  h.render(Number.POSITIVE_INFINITY);
  assert.equal(h.state.currentFps, 60);
  assert.equal(h.writes(), 1);
  h.state.fpsButton = null;
  assert.doesNotThrow(() => h.render(30));
  assert.equal(h.state.currentFps, 60);
});
