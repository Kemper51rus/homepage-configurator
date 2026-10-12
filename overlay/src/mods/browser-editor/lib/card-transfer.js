import { knownFields, bookmarkFields, validateItemConfig } from "./item-config.js";

const types = new Set(["services", "bookmarks"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sameName = (a, b) => String(a).trim() === String(b).trim();
const fail = (message, statusCode = 422) => { throw Object.assign(new Error(message), { statusCode }); };
function exactKeys(value, keys) {
  if (!object(value) || Object.keys(value).some((key) => !keys.includes(key))) fail("Некорректные поля переноса карточки");
}
function text(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

// Only bounded identities are accepted, never a client-supplied replacement config.
export function validateCardTransfer(body) {
  exactKeys(body, ["action", "source", "target"]);
  if (body.action !== "move-item-between-types" || JSON.stringify(body).length > 16384) fail("Некорректный запрос переноса");
  for (const [role, identity] of [["source", body.source], ["target", body.target]]) {
    exactKeys(identity, ["type", "group", "name", "matcher", "index"]);
    if (!types.has(identity.type) || !text(identity.group)) fail("Некорректная группа или тип карточки");
    if (identity.index != null && (!Number.isInteger(identity.index) || identity.index < 0 || identity.index > 100000)) fail("Некорректный индекс карточки");
    if (role === "target" && identity.name == null) {
      if (identity.matcher != null || identity.index != null) fail("Для вставки в конец не нужна идентичность карточки");
      continue;
    }
    if (!text(identity.name)) fail("Не указано имя карточки");
    exactKeys(identity.matcher, ["name", "config"]);
    if (identity.matcher.name !== identity.name || !object(identity.matcher.config)) fail("Некорректная идентичность карточки");
    for (const [key, value] of Object.entries(identity.matcher.config)) {
      if (!knownFields[identity.type].includes(key) || (identity.type === "services" && key === "weight") ||
          (value !== null && !["string", "number", "boolean"].includes(typeof value)) ||
          (typeof value === "string" && value.length > 4096) || (typeof value === "number" && !Number.isFinite(value))) fail("Некорректный matcher карточки");
    }
  }
  if (body.source.type === body.target.type) fail("Для сортировки используется обычный перенос");
  return body;
}

function singleEntry(entry) {
  if (!object(entry) || Object.keys(entry).length !== 1) fail("Некорректная структура YAML");
  const name = Object.keys(entry)[0];
  return [name, entry[name]];
}
function groupEntries(groups, type, groupName) {
  if (!Array.isArray(groups)) fail("Конфигурация должна быть списком");
  const matches = [];
  function visit(nodes) {
    for (const node of nodes) {
      const [name, value] = singleEntry(node);
      if (!Array.isArray(value)) fail("Некорректная группа YAML");
      if (sameName(name, groupName)) matches.push(value);
      if (type === "services") {
        for (const entry of value) {
          const [, nested] = singleEntry(entry);
          if (Array.isArray(nested)) visit([entry]);
        }
      }
    }
  }
  visit(groups);
  if (matches.length !== 1) fail("Группа отсутствует или неоднозначна. Обновите страницу.", 409);
  return matches[0];
}
function configOf(entry, type) {
  const [, value] = singleEntry(entry);
  if (type === "services") return object(value) ? value : null;
  // Refuse multi-config bookmarks rather than silently discard their siblings.
  return Array.isArray(value) && value.length === 1 && object(value[0]) ? value[0] : null;
}
function renderedIndexes(entries, type) {
  const items = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => configOf(entry, type));
  if (type === "bookmarks") return items.map(({ index }) => index);
  return items.map((item, order) => ({ ...item, weight: typeof configOf(item.entry, type).weight === "number" ? configOf(item.entry, type).weight : (order + 1) * 100 }))
    .sort((a, b) => a.weight - b.weight || Object.keys(a.entry)[0].localeCompare(Object.keys(b.entry)[0]))
    .map(({ index }) => index);
}
function matches(entry, identity) {
  const [name] = singleEntry(entry);
  const config = configOf(entry, identity.type);
  if (!config || !sameName(name, identity.name)) return false;
  const current = {};
  for (const key of knownFields[identity.type]) {
    if (!(identity.type === "services" && key === "weight") && config[key] !== undefined) current[key] = config[key];
  }
  const keys = Object.keys(current).sort();
  return JSON.stringify(keys) === JSON.stringify(Object.keys(identity.matcher.config).sort()) &&
    keys.every((key) => JSON.stringify(current[key]) === JSON.stringify(identity.matcher.config[key]));
}
function resolveItem(entries, identity) {
  if (identity.type === "bookmarks" && entries.some((entry) => {
    const [name, value] = singleEntry(entry);
    return sameName(name, identity.name) && Array.isArray(value) && value.length !== 1;
  })) fail("Закладка содержит несколько конфигураций; разделите её перед переносом.", 409);
  if (identity.index != null) {
    const index = renderedIndexes(entries, identity.type)[identity.index];
    if (index === undefined || !matches(entries[index], identity)) fail("Карточка изменилась или исчезла. Обновите страницу.", 409);
    return index;
  }
  const indexes = entries.flatMap((entry, index) => matches(entry, identity) ? [index] : []);
  if (indexes.length !== 1) fail("Карточка отсутствует или неоднозначна. Обновите страницу.", 409);
  return indexes[0];
}

export function convertCardConfig(config, targetType) {
  if (!object(config) || !types.has(targetType)) fail("Некорректная карточка");
  const allowed = bookmarkFields.map(([key]) => key).filter((key) => targetType === "bookmarks" || key !== "showLink");
  const converted = Object.fromEntries(allowed.filter((key) => Object.hasOwn(config, key)).map((key) => [key, structuredClone(config[key])]));
  if (typeof converted.href !== "string" || !converted.href.trim()) fail("URL карточки обязателен");
  let protocol;
  try { protocol = new URL(converted.href).protocol.toLowerCase(); } catch { /* Bookmark validation below reports invalid absolute URLs. */ }
  if (["javascript:", "data:", "vbscript:"].includes(protocol)) fail("Небезопасная схема URL карточки");
  try { validateItemConfig(targetType, converted); } catch (error) { fail(error.message); }
  return converted;
}

// Pure transform: source resolution and insertion both succeed before any write.
export function moveCardBetweenTypes(configs, body) {
  const { source, target } = validateCardTransfer(body);
  const next = structuredClone(configs);
  const sourceEntries = groupEntries(next[source.type], source.type, source.group);
  const targetEntries = groupEntries(next[target.type], target.type, target.group);
  const sourceIndex = resolveItem(sourceEntries, source);
  const insertion = target.name == null ? targetEntries.length : resolveItem(targetEntries, target);
  const [name] = singleEntry(sourceEntries[sourceIndex]);
  const config = convertCardConfig(configOf(sourceEntries[sourceIndex], source.type), target.type);
  const entry = { [name]: target.type === "bookmarks" ? [config] : config };
  // Preserve all destination entries, including cards with exactly the same name.
  // Use rendered order for service insertion, retaining nested group positions.
  if (target.type === "services") {
    const indexes = renderedIndexes(targetEntries, target.type);
    const ordered = indexes.map((index) => targetEntries[index]);
    let order = target.name == null ? ordered.length : indexes.indexOf(insertion);
    ordered.splice(order, 0, entry);
    const slots = new Set(indexes);
    let cursor = 0;
    const rebuilt = targetEntries.map((existing, index) => slots.has(index) ? ordered[cursor++] : existing);
    rebuilt.push(...ordered.slice(cursor));
    let weight = 0;
    for (const item of rebuilt) {
      const service = configOf(item, "services");
      if (service) service.weight = (++weight) * 100;
    }
    targetEntries.splice(0, targetEntries.length, ...rebuilt);
  } else targetEntries.splice(insertion, 0, entry);
  sourceEntries.splice(sourceIndex, 1);
  return next;
}
