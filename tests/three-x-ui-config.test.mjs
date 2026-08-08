import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateThreeXuiSummary,
  buildThreeXuiWidget,
  defaultThreeXuiMetricKeys,
  isThreeXuiWidget,
  threeXuiMetricDefinitions,
  threeXuiMetricKeysFromWidget,
  threeXuiMappings,
  threeXuiSourceFromWidget,
} from "../overlay/src/mods/browser-editor/lib/three-x-ui-config.js";

test("3x-ui summary exposes only the compact connection, client and traffic data", () => {
  const summary = aggregateThreeXuiSummary(
    {
      success: true,
      obj: {
        appStats: { mem: 1024, threads: 9, uptime: 100 },
        cpu: 12.5,
        cpuCores: 4,
        disk: { current: 40, total: 100 },
        loads: [0.1, 0.2, 0.3],
        mem: { current: 25, total: 100 },
        netIO: { down: 22, pktDown: 2, pktUp: 1, up: 11 },
        netTraffic: { pktRecv: 20, pktSent: 10, recv: 2000, sent: 1000 },
        panelGuid: "panel-guid",
        panelVersion: "v2.6.3",
        publicIP: { ipv4: "203.0.113.1", ipv6: "::1" },
        swap: { current: 5, total: 20 },
        tcpCount: 30,
        udpCount: 4,
        uptime: 500,
        xray: { errorMsg: "", state: "running", version: "25.1.1" },
      },
    },
    { success: true, obj: ["a", "b"] },
  );

  assert.equal(summary.tcp, 30);
  assert.equal(summary.udp, 4);
  assert.equal(summary.online, 2);
  assert.equal(summary.sent, 1000);
  assert.equal(summary.received, 2000);
  assert.equal(summary.xrayState, "running");
  assert.deepEqual(Object.keys(summary), [
    "tcp",
    "udp",
    "online",
    "sent",
    "received",
    "xrayState",
  ]);
});

test("3x-ui widget stores only local source id and selected mappings", () => {
  const widget = buildThreeXuiWidget("vpn-panel", ["online", "tcp", "received"]);

  assert.equal(widget.type, "customapi");
  assert.equal(widget.url, "http://127.0.0.1:3000/api/config/three-x-ui?source=vpn-panel");
  assert.deepEqual(
    widget.mappings.map((mapping) => mapping.field),
    ["tcp", "online", "received"],
  );
  assert.equal(threeXuiSourceFromWidget(widget), "vpn-panel");
  assert.equal(isThreeXuiWidget(widget), true);
  assert.deepEqual(threeXuiMetricKeysFromWidget(widget), ["tcp", "online", "received"]);
  assert.equal(JSON.stringify(widget).includes("token"), false);

  const port80Widget = buildThreeXuiWidget("vpn-panel", ["online"], "http://127.0.0.1:80");
  assert.equal(port80Widget.url, "http://127.0.0.1:80/api/config/three-x-ui?source=vpn-panel");
});

test("3x-ui defaults and mappings expose safe known metrics only", () => {
  assert.equal(threeXuiMetricDefinitions.length, 6);
  assert.deepEqual(defaultThreeXuiMetricKeys(), ["tcp", "udp", "online", "sent", "received"]);
  assert.deepEqual(threeXuiMappings(["tcp", "../token"]).map((mapping) => mapping.field), ["tcp"]);
  assert.equal(isThreeXuiWidget({ type: "customapi", url: "http://example.test/api" }), false);
  assert.equal(threeXuiSourceFromWidget(buildThreeXuiWidget("../unsafe")), "main");
});
