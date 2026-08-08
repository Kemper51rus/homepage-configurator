import assert from "node:assert/strict";
import { test } from "node:test";

import { orderStudioItems } from "../overlay/src/mods/browser-editor/lib/studio-order.js";

function service(name, weight) {
  return {
    config: weight === undefined ? {} : { weight },
    name,
  };
}

test("studio service cards follow Homepage weight and name order", () => {
  const items = [
    service("Без веса"),
    service("Последний", 400),
    service("Бета", 100),
    service("Альфа", 100),
  ];

  assert.deepEqual(
    orderStudioItems(items, "services").map((item) => item.name),
    ["Альфа", "Без веса", "Бета", "Последний"],
  );
  assert.deepEqual(items.map((item) => item.name), [
    "Без веса",
    "Последний",
    "Бета",
    "Альфа",
  ]);
});

test("studio uses Homepage-compatible handling for string and invalid weights", () => {
  const items = [
    service("Строковый", "20"),
    service("Некорректный", "wrong"),
    service("Числовой", 10),
  ];

  assert.deepEqual(
    orderStudioItems(items, "services").map((item) => item.name),
    ["Некорректный", "Числовой", "Строковый"],
  );
});

test("studio keeps YAML order for bookmarks and does not mutate the list", () => {
  const items = [service("Вторая", 200), service("Первая", 100)];
  const ordered = orderStudioItems(items, "bookmarks");

  assert.equal(ordered, items);
  assert.deepEqual(ordered.map((item) => item.name), ["Вторая", "Первая"]);
});
