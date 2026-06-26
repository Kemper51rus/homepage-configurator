import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { mergeRadioCustomJsTemplate } from "../scripts/merge-radio-custom-js.mjs";
import {
  parseIpConfig,
  parseLinkIpFpsSizes,
  parseRadioButtonSize,
  parseRadioButtonsOrder,
  parseRadioButtonsStyle,
  parseRadioStations,
  parseRadioEnabled,
  parseRadioIconSize,
  updateRadioInCustomJs,
} from "../overlay/src/mods/browser-editor/lib/topbar-config-helper.js";

test("parseRadioStations defaults track display on and migrates legacy Hakuran vote key only to Hakuran", () => {
  const stations = parseRadioStations(`
    const hakuranVoteApiKey = "secret-key";
    const stationList = \`
      TNT, https://example.test/tnt.mp3
      * Hakuran, https://hfm.hakuran.ru/listen/hfm/radio.mp3, true, https://hfm.hakuran.ru/api/nowplaying/1, now_playing.song.text
    \`;
  `);

  assert.equal(stations.length, 2);
  assert.equal(stations[0].label, "TNT");
  assert.equal(stations[0].showTrackInfo, true);
  assert.equal(stations[0].voteApiEnabled, false);
  assert.equal(stations[0].voteApiKey, "");

  assert.equal(stations[1].label, "Hakuran");
  assert.equal(stations[1].isDefault, true);
  assert.equal(stations[1].showTrackInfo, true);
  assert.equal(stations[1].voteApiEnabled, true);
  assert.equal(stations[1].voteApiUrl, "https://hakuran.ru/custom-api/vote");
  assert.equal(stations[1].voteApiKey, "secret-key");
});

test("updateRadioInCustomJs serializes per-station vote API settings", () => {
  const updated = updateRadioInCustomJs(
    "",
    [
      {
        label: "Station A",
        url: "https://example.test/a.mp3",
        isDefault: true,
        showTrackInfo: false,
        trackInfoUrl: "",
        trackInfoKey: "",
        voteApiEnabled: false,
        voteApiUrl: "",
        voteApiKey: "",
      },
      {
        label: "Station B",
        url: "https://example.test/b.mp3",
        isDefault: false,
        showTrackInfo: true,
        trackInfoUrl: "https://example.test/nowplaying.json",
        trackInfoKey: "song.title",
        voteApiEnabled: true,
        voteApiUrl: "https://example.test/vote/{apiKey}/{songId}/{type}",
        voteApiKey: "station-secret",
      },
    ],
    true,
  );

  const stations = parseRadioStations(updated);

  assert.equal(stations.length, 2);
  assert.deepEqual(
    stations.map((station) => ({
      label: station.label,
      isDefault: station.isDefault,
      showTrackInfo: station.showTrackInfo,
      trackInfoUrl: station.trackInfoUrl,
      trackInfoKey: station.trackInfoKey,
      voteApiEnabled: station.voteApiEnabled,
      voteApiUrl: station.voteApiUrl,
      voteApiKey: station.voteApiKey,
    })),
    [
      {
        label: "Station A",
        isDefault: true,
        showTrackInfo: false,
        trackInfoUrl: "",
        trackInfoKey: "",
        voteApiEnabled: false,
        voteApiUrl: "",
        voteApiKey: "",
      },
      {
        label: "Station B",
        isDefault: false,
        showTrackInfo: true,
        trackInfoUrl: "https://example.test/nowplaying.json",
        trackInfoKey: "song.title",
        voteApiEnabled: true,
        voteApiUrl: "https://example.test/vote/{apiKey}/{songId}/{type}",
        voteApiKey: "station-secret",
      },
    ],
  );
});

test("mergeRadioCustomJsTemplate preserves user radio station order during installer update", () => {
  const template = readFileSync(new URL("../custom-config/radio/custom.js", import.meta.url), "utf8");
  const existing = updateRadioInCustomJs(
    "",
    [
      {
        label: "Station B",
        url: "https://example.test/b.mp3",
        isDefault: true,
        showTrackInfo: true,
        trackInfoUrl: "https://example.test/b.json",
        trackInfoKey: "song.title",
        voteApiEnabled: true,
        voteApiUrl: "https://example.test/vote/$&",
        voteApiKey: "station-$1-secret",
      },
      {
        label: "Station A",
        url: "https://example.test/a.mp3",
        isDefault: false,
        showTrackInfo: false,
        trackInfoUrl: "",
        trackInfoKey: "",
        voteApiEnabled: false,
        voteApiUrl: "",
        voteApiKey: "",
      },
    ],
    true,
    [{ label: "local", url: "https://ip.example.test/json", jsonKey: "ip" }],
    false,
    ["playlist", "trackinfo", "plapau"],
    "modern",
    14,
    26,
    true,
    false,
  );

  const { content, preserved } = mergeRadioCustomJsTemplate(template, existing);
  const stations = parseRadioStations(content);
  const ipConfig = parseIpConfig(content);

  assert.ok(preserved.includes("stationList"));
  assert.deepEqual(stations.map((station) => station.label), ["Station B", "Station A"]);
  assert.equal(stations[0].isDefault, true);
  assert.equal(stations[0].voteApiUrl, "https://example.test/vote/$&");
  assert.equal(stations[0].voteApiKey, "station-$1-secret");
  assert.equal(stations[1].showTrackInfo, false);
  assert.deepEqual(parseRadioButtonsOrder(content), ["playlist", "trackinfo", "plapau"]);
  assert.equal(parseRadioButtonsStyle(content), "modern");
  assert.equal(parseRadioIconSize(content), 14);
  assert.equal(parseRadioButtonSize(content), 26);
  assert.equal(parseLinkIpFpsSizes(content), true);
  assert.equal(parseRadioEnabled(content), true);
  assert.equal(ipConfig.ipEnabled, false);
  assert.deepEqual(
    ipConfig.ipProviders.map(({ label, url, jsonKey }) => ({ label, url, jsonKey })),
    [{ label: "local", url: "https://ip.example.test/json", jsonKey: "ip" }],
  );
});
