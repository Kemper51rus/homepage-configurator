import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../overlay/src/mods/browser-editor/components/editor.jsx", import.meta.url), "utf8");
const hook = source.slice(source.indexOf("function useServiceRowHeightBalancer()"), source.indexOf("export function useEditableGroupHeader"));

function harness() {
  const frames = new Map();
  const listeners = new Map();
  const writes = [];
  const measurements = [];
  const clones = [];
  let nextFrame = 1;
  let cleanup;
  let resizeObserver;
  let mutationObserver;
  const parent = {};
  const groups = [];
  const cards = [];
  function makeNode(group = null) {
    return {
      nodeType: 1, dataset: {},
      closest: () => group,
      matches: () => false,
      querySelector: () => null,
    };
  }
  for (let index = 0; index < 2; index += 1) {
    const group = makeNode();
    group.dataset.editorAlignRowHeights = "true";
    group.parentElement = parent;
    group.offsetParent = parent;
    group.closest = () => group;
    group.matches = () => true;
    group.getBoundingClientRect = () => ({ top: 100, left: index * 300 });
    let height = "90px";
    const card = makeNode(group);
    card.natural = index ? 120 : 100;
    card.style = {};
    Object.defineProperty(card.style, "height", {
      get: () => height,
      set: (value) => { writes.push({ index, value }); height = value; },
    });
    card.getBoundingClientRect = () => ({ width: 280, height: Number.parseFloat(height) || card.natural });
    card.parentElement = {
      appendChild: (clone) => { clones.push(clone); clone.attached = true; },
    };
    card.cloneNode = () => ({
      ...makeNode(group), style: {},
      setAttribute() {}, removeAttribute() {}, querySelectorAll: () => [],
      getBoundingClientRect() {
        assert.equal(this.style.height, "auto");
        assert.equal(this.style.width, "280px");
        assert.equal(this.style.position, "fixed");
        assert.equal(this.inert, true);
        measurements.push(cards.map((live) => live.style.height));
        return { height: card.natural };
      },
      remove() { this.attached = false; },
    });
    group.querySelector = () => ({ querySelectorAll: () => [card] });
    groups.push(group);
    cards.push(card);
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); resizeObserver = this; }
    observe(node) { this.observed.add(node); }
    disconnect() { this.disconnected = true; }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; mutationObserver = this; }
    observe(node, options) { this.target = node; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const context = vm.createContext({
    useEffect: (callback) => { cleanup = callback(); }, ResizeObserver, MutationObserver,
    document: { body: makeNode(), querySelectorAll: () => groups },
    window: {
      requestAnimationFrame: (callback) => { const id = nextFrame++; frames.set(id, callback); return id; },
      cancelAnimationFrame: (id) => frames.delete(id),
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    },
  });
  vm.runInContext(`${hook}\nuseServiceRowHeightBalancer();`, context);
  const flush = () => {
    const queued = [...frames.values()]; frames.clear(); queued.forEach((callback) => callback());
  };
  const mutation = (target, addedNodes = [], removedNodes = []) => mutationObserver.callback([{ target, addedNodes, removedNodes }]);
  return { cards, groups, writes, measurements, clones, frames, listeners, resizeObserver, mutationObserver, flush, mutation, cleanup: () => cleanup(), makeNode };
}

test("Natural measurement never clears live heights; unchanged balancing does not write", () => {
  const h = harness();
  h.flush();
  assert.deepEqual(h.measurements, [["90px", "90px"], ["90px", "90px"]]);
  assert.deepEqual(h.cards.map((card) => card.style.height), ["120px", "120px"]);
  assert.equal(h.writes.length, 2);
  assert.ok(h.clones.every((clone) => !clone.attached));
  h.resizeObserver.callback(); h.flush();
  assert.equal(h.writes.length, 2);
  assert.ok(h.measurements.slice(2).every((heights) => heights.every((height) => height === "120px")));
});

test("Balancing follows natural content growth AND shrink", () => {
  const h = harness(); h.flush();
  h.cards[0].natural = 160;
  h.mutation(h.cards[0]); h.flush();
  assert.deepEqual(h.cards.map((card) => card.style.height), ["160px", "160px"]);
  h.cards[0].natural = 70; h.cards[1].natural = 80;
  h.mutation({ nodeType: 3, parentElement: h.cards[1] }); h.flush();
  assert.deepEqual(h.cards.map((card) => card.style.height), ["80px", "80px"]);
  assert.equal(h.writes.length, 6);
});

test("Topbar changes and measurement clone mutations do not schedule work", () => {
  const h = harness(); h.flush();
  h.mutation(h.makeNode(), [h.makeNode()]);
  assert.equal(h.frames.size, 0);
  const clone = h.clones[0];
  h.mutation(h.cards[0], [clone]);
  h.mutation(h.cards[0], [], [clone]);
  assert.equal(h.frames.size, 0);
  h.mutation(h.cards[0], [h.makeNode(h.groups[0])]);
  assert.equal(h.frames.size, 1);
  h.flush(); assert.equal(h.writes.length, 2);
});

test("Cleanup cancels pending work, disconnects observers and releases heights", () => {
  const h = harness(); h.flush();
  assert.equal(h.resizeObserver.observed.size, 2);
  assert.equal(h.mutationObserver.options.characterData, true);
  h.resizeObserver.callback(); assert.equal(h.frames.size, 1);
  h.cleanup();
  assert.equal(h.frames.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.resizeObserver.disconnected, true);
  assert.equal(h.mutationObserver.disconnected, true);
  assert.deepEqual(h.cards.map((card) => card.style.height), ["", ""]);
});
