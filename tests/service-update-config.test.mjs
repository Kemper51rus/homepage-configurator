import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  normalizeServiceUpdateConfig,
  normalizeServiceUpdateRegistry,
  normalizeServiceUpdateStatus,
  serializeServiceUpdateConfig,
  validateServiceUpdateConfig,
} from "../overlay/src/mods/browser-editor/lib/service-update-config.js";

test("service update card config is normalized and serialized without runner details", () => {
  assert.deepEqual(normalizeServiceUpdateConfig(null), {
    enabled: false,
    source: "",
    target: "",
    type: "docker",
  });

  assert.deepEqual(
    serializeServiceUpdateConfig({
      enabled: true,
      source: "media-docker",
      target: "jellyfin",
      type: "docker",
    }),
    {
      source: "media-docker",
      target: "jellyfin",
      type: "docker",
    },
  );

  assert.equal(
    serializeServiceUpdateConfig({
      enabled: false,
      target: "jellyfin",
      type: "docker",
    }),
    null,
  );
});

test("service update card config rejects unsafe target identifiers", () => {
  assert.throws(
    () =>
      validateServiceUpdateConfig({
        enabled: true,
        target: "../runner",
        type: "lxc",
      }),
    /Выберите найденный сервис/,
  );
  assert.throws(
    () =>
      validateServiceUpdateConfig({
        enabled: true,
        target: "valid",
        type: "unknown",
      }),
    /Выберите тип/,
  );
});

test("service update registry validates target type and runner basename", () => {
  assert.deepEqual(
    normalizeServiceUpdateRegistry({
      targets: {
        jellyfin: {
          label: "Jellyfin",
          runner: "media-jellyfin",
          type: "docker",
        },
      },
    }),
    [
      {
        id: "jellyfin",
        label: "Jellyfin",
        runner: "media-jellyfin",
        type: "docker",
      },
    ],
  );

  assert.throws(
    () =>
      normalizeServiceUpdateRegistry({
        targets: { bad: { runner: "../../bin/sh", type: "lxc" } },
      }),
    /некорректное имя runner/,
  );
});

test("runner status is bounded and cannot inject arbitrary state", () => {
  const status = normalizeServiceUpdateStatus({
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    message: "ready",
    state: "made-up",
    updateAvailable: true,
  });

  assert.equal(status.state, "available");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.currentVersion, "1.0.0");
  assert.equal(status.latestVersion, "1.1.0");
});

test("dashboard badges use stored statuses without resolving Docker or Proxmox targets", () => {
  const badgeSource = readFileSync(
    new URL(
      "../overlay/src/mods/browser-editor/components/service-update.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  const apiSource = readFileSync(
    new URL(
      "../overlay/src/mods/browser-editor/api/service-updates.js",
      import.meta.url,
    ),
    "utf8",
  );
  const cachedBranch = apiSource.indexOf(
    'req.method === "GET" && req.query.cached === "true"',
  );
  const remoteResolution = apiSource.indexOf(
    "const target = await findTarget",
    cachedBranch,
  );

  assert.match(badgeSource, /service-updates\?cached=true/);
  assert.match(badgeSource, /data\?\.statuses\?\.\[statusKey\]/);
  assert.match(badgeSource, /revalidateOnFocus:\s*false/);
  assert.ok(cachedBranch >= 0);
  assert.ok(remoteResolution > cachedBranch);
  assert.match(
    apiSource.slice(cachedBranch, remoteResolution),
    /readCachedTargetStatus/,
  );
});

test("Docker inside running LXC is discovered and handled through the restricted Proxmox helper", () => {
  const dockerSource = readFileSync(
    new URL(
      "../overlay/src/mods/browser-editor/api/service-update-docker.js",
      import.meta.url,
    ),
    "utf8",
  );
  const lxcSource = readFileSync(
    new URL(
      "../overlay/src/mods/browser-editor/api/service-update-lxc.js",
      import.meta.url,
    ),
    "utf8",
  );
  const apiSource = readFileSync(
    new URL(
      "../overlay/src/mods/browser-editor/api/service-updates.js",
      import.meta.url,
    ),
    "utf8",
  );
  const helperSource = readFileSync(
    new URL("../scripts/proxmox-lxc-updater.sh", import.meta.url),
    "utf8",
  );

  assert.match(dockerSource, /discoverProxmoxNestedDockerTargets/);
  assert.match(dockerSource, /resolveProxmoxNestedDockerTarget/);
  assert.match(lxcSource, /\["docker-discover", node\]/);
  assert.match(lxcSource, /nestedDockerDiscoveryCache/);
  assert.match(lxcSource, /lxcDiscoveryCache/);
  assert.match(lxcSource, /mode: "proxmox-docker"/);
  assert.match(apiSource, /checkProxmoxNestedDockerTarget/);
  assert.match(apiSource, /updateProxmoxNestedDockerTarget/);
  assert.match(helperSource, /docker-discover/);
  assert.match(helperSource, /docker-check/);
  assert.match(helperSource, /docker-update/);
  assert.match(helperSource, /pct exec "\$vmid" -- docker ps/);
  assert.match(helperSource, /docker compose/);
  assert.match(helperSource, /create_safety_copy/);
});

test("service update badges resolve cached statuses when Docker source is omitted", () => {
  const badgeSource = readFileSync(
    new URL(
      "../overlay/src/mods/browser-editor/components/service-update.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(badgeSource, /matchingStatuses = Object\.values/);
  assert.match(badgeSource, /candidate\?\.id === target/);
  assert.match(badgeSource, /matchingStatuses\.length === 1/);
});

test("service update modal uses the shared Studio themed window", () => {
  const source = readFileSync(
    new URL(
      "../overlay/src/mods/browser-editor/components/service-update.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /import \{ StudioModalWindow \}/);
  assert.match(source, /<StudioModalWindow[\s\S]*?title=\{status\?\.label/);
  assert.match(source, /createPortal\([\s\S]*?document\.body/);
});
