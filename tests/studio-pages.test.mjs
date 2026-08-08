import assert from "node:assert/strict";
import { test } from "node:test";

import {
  studioPageGroupKey,
  studioPageRecords,
  studioPageStyleDraft,
  updateStudioPageSettings,
  updateStudioPageStyles,
} from "../overlay/src/mods/browser-editor/lib/studio-pages.js";

const services = [
  { Infrastructure: [{ Proxmox: { href: "#" } }] },
  { Media: [{ Jellyfin: { href: "#" } }] },
];
const bookmarks = [{ Sites: [{ Docs: [{ href: "#" }] }] }];
const settings = {
  layout: {
    Infrastructure: { tab: "Основное", columns: 3 },
    Media: { tab: "Медиа" },
    Bookmarks: { Sites: { tab: "Сайты", style: "row" } },
  },
  __browserEditorTabOrder: ["Основное", "Медиа", "Сайты"],
  __browserEditorGroupOrderByPage: {
    Медиа: [{ type: "services", groupName: "Media" }],
  },
  pageStyles: { icons: { Медиа: "mdi-play", Сайты: "mdi-web" } },
};

test("Studio discovers ordered pages and their assigned groups", () => {
  const result = studioPageRecords(settings, services, bookmarks);
  assert.deepEqual(
    result.pages.map((page) => page.name),
    ["Основное", "Медиа", "Сайты"],
  );
  assert.equal(result.pages[1].icon, "mdi-play");
  assert.deepEqual(
    result.pages[2].groups.map((group) => group.name),
    ["Sites"],
  );
});

test("Studio renames a page, moves group assignments and preserves layout", () => {
  const result = updateStudioPageSettings(settings, services, bookmarks, {
    icon: "mdi-multimedia",
    mode: "save",
    name: "Развлечения",
    previousName: "Медиа",
    selectedGroupKeys: [
      studioPageGroupKey("services", "Media"),
      studioPageGroupKey("bookmarks", "Sites"),
    ],
  });

  assert.equal(result.settings.layout.Media.tab, "Развлечения");
  assert.equal(result.settings.layout.Bookmarks.Sites.tab, "Развлечения");
  assert.equal(result.settings.layout.Bookmarks.Sites.style, "row");
  assert.equal(result.settings.pageStyles.icons.Медиа, undefined);
  assert.equal(result.settings.pageStyles.icons.Развлечения, "mdi-multimedia");
  assert.deepEqual(result.settings.__browserEditorTabOrder, [
    "Основное",
    "Развлечения",
  ]);
  assert.deepEqual(
    result.settings.__browserEditorGroupOrderByPage.Развлечения,
    settings.__browserEditorGroupOrderByPage.Медиа,
  );
  assert.equal(settings.layout.Media.tab, "Медиа");
});

test("Studio creates and deletes pages without deleting groups", () => {
  const created = updateStudioPageSettings(settings, services, bookmarks, {
    name: "Хосты",
    selectedGroupKeys: [studioPageGroupKey("services", "Infrastructure")],
  });
  assert.equal(created.settings.layout.Infrastructure.tab, "Хосты");
  assert.deepEqual(created.settings.__browserEditorTabOrder, [
    "Медиа",
    "Сайты",
    "Хосты",
  ]);

  const deleted = updateStudioPageSettings(settings, services, bookmarks, {
    mode: "delete",
    previousName: "Медиа",
  });
  assert.equal(deleted.settings.layout.Media.tab, undefined);
  assert.deepEqual(deleted.settings.__browserEditorTabOrder, [
    "Основное",
    "Сайты",
  ]);
  assert.equal(deleted.settings.pageStyles.icons.Медиа, undefined);
  assert.equal(services.length, 2);
});

test("Studio requires a unique page name and at least one group", () => {
  assert.throws(
    () =>
      updateStudioPageSettings(settings, services, bookmarks, {
        name: "Медиа",
        selectedGroupKeys: [studioPageGroupKey("services", "Infrastructure")],
      }),
    /уже существует/,
  );
  assert.throws(
    () =>
      updateStudioPageSettings(settings, services, bookmarks, {
        name: "Пустая",
        selectedGroupKeys: [],
      }),
    /хотя бы одну группу/,
  );
});

test("Studio reads and saves all page appearance settings without losing icons", () => {
  const styled = updateStudioPageStyles(settings, {
    activeColor: "#ffffff",
    align: "center",
    borderColor: "#3fb1db",
    borderStyle: "pill",
    fontFamily: "Comfortaa",
    fontSize: "16px",
    hideTabBackground: true,
    inactiveColor: "#a0aec0",
    serviceStatusOffsetX: 18,
    serviceStatusOffsetY: -11,
  });

  assert.deepEqual(styled.pageStyles.icons, settings.pageStyles.icons);
  assert.deepEqual(studioPageStyleDraft(styled), {
    activeColor: "#ffffff",
    align: "center",
    borderColor: "#3fb1db",
    borderStyle: "pill",
    fontFamily: "Comfortaa",
    fontSize: "16px",
    hideTabBackground: true,
    inactiveColor: "#a0aec0",
    serviceStatusOffsetX: 18,
    serviceStatusOffsetY: -11,
  });
  assert.equal(settings.pageStyles.fontFamily, undefined);
});


test("Studio validates page colors and clamps service status offsets", () => {
  const styled = updateStudioPageStyles(settings, {
    ...studioPageStyleDraft(settings),
    serviceStatusOffsetX: 999,
    serviceStatusOffsetY: -999,
  });
  assert.equal(styled.pageStyles.serviceStatusOffsetX, 48);
  assert.equal(styled.pageStyles.serviceStatusOffsetY, -48);

  assert.throws(
    () =>
      updateStudioPageStyles(settings, {
        ...studioPageStyleDraft(settings),
        activeColor: "red; background: url(javascript:alert(1))",
      }),
    /формате/,
  );
});
