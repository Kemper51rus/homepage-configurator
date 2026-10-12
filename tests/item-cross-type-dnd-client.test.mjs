import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../overlay/src/mods/browser-editor/components/editor.jsx", import.meta.url), "utf8");
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const dragHelpers = slice("function readDragPayload(", "function readTopWidgetDragPayload(");
const itemHook = slice("export function useEditableItem(", "export function useEditableTopWidget(").replace("export ", "");
const groupHook = slice("export function useGroupInsideDropTarget(", "export function RootGroupDropZone(").replace("export ", "");
const moveItem = slice("      moveItem: async (", "      moveTopWidget: async (").trim().replace(/^moveItem: /, "").replace(/,$/, "");
const item = { scope: "item", type: "services", groupName: "Source", itemName: "App", itemMatcher: { name: "App", config: { href: "https://app.example" } }, itemIndex: 2 };

function event(payload = item) {
  const raw = payload === null ? "" : JSON.stringify(payload);
  return {
    dataTransfer: { getData: () => raw, setData() {}, types: [] },
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

function dragHarness(fallback = null) {
  const calls = [];
  const context = vm.createContext({
    JSON_DRAG_TYPE: "application/json", ITEM_DRAG_TYPE: "item", GROUP_DRAG_TYPE: "group", TAB_DRAG_TYPE: "tab",
    activeDragPayload: fallback,
    hasDragType: () => false,
    isGroupDragOver: (_event, payload) => payload?.scope === "group",
    useMemo: (callback) => callback(),
    createItemMatcher: (_type, _name, value) => value,
    useConfigEditor: () => ({ editMode: true, draggedGroup: fallback, moveItem: (...args) => calls.push(JSON.parse(JSON.stringify(args))), moveGroup: (...args) => calls.push(JSON.parse(JSON.stringify(args))), openItem() {} }),
  });
  vm.runInContext(`${dragHelpers}\n${itemHook}\n${groupHook}`, context);
  return { context, calls };
}

test("Item payload validator rejects groups, tabs and incomplete items, including active fallbacks", () => {
  for (const payload of [
    { ...item, scope: "group" }, { ...item, scope: "tab" }, { ...item, scope: "top-widget" },
    { ...item, type: "widgets" }, { ...item, itemName: undefined }, { ...item, groupName: "" },
  ]) {
    const { context } = dragHarness(payload);
    assert.equal(context.readItemDragPayload(event(payload)), null);
    assert.equal(context.readItemDragPayload(event(null)), null);
  }
  const { context } = dragHarness(item);
  assert.equal(context.readItemDragPayload(event(null)), item);
  assert.equal(context.readItemDragPayload(event({ ...item, scope: "group" })), null);
  assert.equal(context.readItemDragPayload(event({ ...item, scope: undefined })).itemName, "App");
});

test("Cards route both types with target matcher/index and stop bubbling to group-end target", () => {
  const { context, calls } = dragHarness();
  const matcher = { name: "Link", config: { href: "https://target.example" } };
  const props = context.useEditableItem("bookmarks", "Target", "Link", matcher, 0).itemProps;
  const dropped = event();
  props.onDrop(dropped);
  assert.deepEqual(calls[0], ["services", "Source", "App", "Target", "Link", item.itemMatcher, matcher, 2, 0, "bookmarks"]);
  assert.equal(dropped.stopped, true);
  for (const scope of ["group", "tab"]) {
    const invalid = event({ ...item, scope });
    props.onDragOver(invalid);
    props.onDrop(invalid);
    assert.equal(invalid.prevented, undefined);
  }
  assert.equal(calls.length, 1);
});

test("Group body appends items of either type while preserving inside group moves", () => {
  const { context, calls } = dragHarness();
  const props = context.useGroupInsideDropTarget("bookmarks", "Target");
  const dropped = event();
  props.onDragOver(dropped);
  props.onDrop(dropped);
  assert.deepEqual(calls[0], ["services", "Source", "App", "Target", null, item.itemMatcher, null, 2, null, "bookmarks"]);
  assert.equal(dropped.stopped, true);
  props.onDrop(event({ scope: "group", type: "bookmarks", groupName: "Other" }));
  assert.deepEqual(calls[1], ["bookmarks", "Other", "Target", "inside"]);
  assert.deepEqual(Object.keys(context.useGroupInsideDropTarget("bookmarks", "Target", false)), []);
});

test("Add tile validates item scope and forwards nullable end destination", () => {
  const tile = slice("export function EditorAddTile(", "function EditorUiScaleControl(");
  const handler = tile.match(/onDrop=\{\(event\) => \{([\s\S]*?)\n        \}\}/)[1];
  const { context, calls } = dragHarness();
  Object.assign(context, { type: "services", groupName: "Target", moveItem: (...args) => calls.push(JSON.parse(JSON.stringify(args))) });
  const drop = vm.runInContext(`(event) => {${handler}}`, context);
  const dropped = event({ ...item, type: "bookmarks" });
  drop(dropped);
  assert.deepEqual(calls[0], ["bookmarks", "Source", "App", "Target", null, item.itemMatcher, null, 2, null, "services"]);
  assert.equal(dropped.stopped, true);
  drop(event({ ...item, scope: "group" }));
  assert.equal(calls.length, 1);
  assert.match(tile, /onDragOver=\{\(event\) => \{\s*if \(!readItemDragPayload\(event\)\)/);
});

function moveHarness({ failure = null, gate = null } = {}) {
  const actions = [];
  const refreshes = [];
  const notices = [];
  const writes = [];
  let reordered = 0;
  const data = { services: [{ Source: [] }], bookmarks: [{ Target: [] }] };
  const context = vm.createContext({
    data, mutate() {},
    namesEqual: (left, right) => left === right,
    postEditorAction: async (body) => { actions.push(JSON.parse(JSON.stringify(body))); if (failure) throw new Error(failure); if (gate) await gate; },
    refreshConfigData: async (...args) => refreshes.push(args),
    handleSaved: (notice) => notices.push(notice),
    reorderRawEntry: () => { reordered += 1; return { moved: true, nextGroups: ["reordered"] }; },
    editorWriteFetch: async (_url, options) => { writes.push(options); return { ok: true }; },
  });
  return { move: vm.runInContext(`(${moveItem})`, context), actions, refreshes, notices, writes, data, reordered: () => reordered };
}

test("Cross-type action has exact endpoints, refreshes after success and does not rewrite client YAML", async () => {
  const h = moveHarness();
  await h.move("services", "Same", "App", "Same", "App", item.itemMatcher, { name: "App", config: { href: "target" } }, 2, 0, "bookmarks");
  assert.deepEqual(h.actions, [{ action: "move-item-between-types", source: { type: "services", group: "Same", name: "App", matcher: item.itemMatcher, index: 2 }, target: { type: "bookmarks", group: "Same", name: "App", matcher: { name: "App", config: { href: "target" } }, index: 0 } }]);
  assert.equal(h.refreshes.length, 1);
  assert.equal(h.reordered(), 0);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.notices, ["Элемент перемещён"]);
  assert.match(source, /async function refreshConfigData\(mutate, keys = \["\/api\/config\/editor", "\/api\/services", "\/api\/bookmarks"\]/);
});

test("Cross-type refresh and success wait for the server action to resolve", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const h = moveHarness({ gate });
  const moving = h.move("services", "Source", "App", "Target", null, item.itemMatcher, null, 2, null, "bookmarks");
  assert.equal(h.actions.length, 1);
  assert.equal(h.refreshes.length, 0);
  assert.equal(h.notices.length, 0);
  release();
  await moving;
  assert.equal(h.refreshes.length, 1);
  assert.deepEqual(h.notices, ["Элемент перемещён"]);
});

test("Reverse conversion appends with explicit null destination fields", async () => {
  const h = moveHarness();
  await h.move("bookmarks", "Source", "Link", "Target", null, null, null, null, null, "services");
  assert.deepEqual(h.actions[0].target, { type: "services", group: "Target", name: null, matcher: null, index: null });
});

test("Rejected cross-type action leaves source intact and skips refresh/success", async () => {
  const h = moveHarness({ failure: "Target is stale" });
  const original = JSON.stringify(h.data);
  await h.move("services", "Source", "App", "Target", null, null, null, 2, null, "bookmarks");
  assert.equal(JSON.stringify(h.data), original);
  assert.equal(h.refreshes.length, 0);
  assert.equal(h.reordered(), 0);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.notices, ["Target is stale"]);
});

test("Same-type move defaults to legacy PUT/reorder and original success toast", async () => {
  const h = moveHarness();
  await h.move("services", "Source", "App", "Target");
  assert.equal(h.actions.length, 0);
  assert.equal(h.reordered(), 1);
  assert.equal(h.writes[0].method, "PUT");
  assert.deepEqual(JSON.parse(h.writes[0].body), { file: "services", data: ["reordered"] });
  assert.deepEqual(h.notices, ["Порядок сохранён"]);
});
