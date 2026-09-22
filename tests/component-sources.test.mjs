import assert from "node:assert/strict";
import { test } from "node:test";

import {
  listComponentSources,
  resolveComponentReleaseArtifact,
  resolveComponentSource,
} from "../overlay/src/mods/browser-editor/lib/component-sources.js";

test("component source catalog exposes only safe display fields", () => {
  assert.deepEqual(listComponentSources(), [
    {
      id: "github-stable",
      componentId: "homepage-studio",
      label: "Homepage Studio · GitHub stable",
      channel: "stable",
    },
  ]);
});

test("component source resolution is server-owned", () => {
  const source = resolveComponentSource("homepage-studio", "github-stable");
  assert.equal(source.repository, "Kemper51rus/homepage-studio");
  assert.equal(source.provider, "github-release");
  assert.match(source.releaseManifestUrl, /^https:\/\/github\.com\/Kemper51rus\/homepage-studio\//);

  assert.throws(
    () => resolveComponentSource("homepage-studio", "https://evil.example/component"),
    /Invalid source id/,
  );
  assert.throws(
    () => resolveComponentSource("../../etc", "github-stable"),
    /Invalid component id/,
  );
  assert.throws(
    () => resolveComponentSource("homepage-studio", "github-preview"),
    /Unsupported component source/,
  );
});

test("release artifact URL is derived from validated metadata", () => {
  const release = resolveComponentReleaseArtifact("homepage-studio", "github-stable", {
    tag: "v0.1.0-beta.1",
    sha256: "a".repeat(64),
    artifactName: "homepage-studio-component.tar.gz",
  });

  assert.equal(
    release.artifactUrl,
    "https://github.com/Kemper51rus/homepage-studio/releases/download/v0.1.0-beta.1/homepage-studio-component.tar.gz",
  );
  assert.equal(release.sha256, "a".repeat(64));

  for (const tag of ["../main", "v1/../../main", "https://evil.example/x", "v1?x=1"]) {
    assert.throws(
      () => resolveComponentReleaseArtifact("homepage-studio", "github-stable", {
        tag,
        sha256: "a".repeat(64),
        artifactName: "homepage-studio-component.tar.gz",
      }),
      /Invalid component release tag/,
    );
  }

  assert.throws(
    () => resolveComponentReleaseArtifact("homepage-studio", "github-stable", {
      tag: "v0.1.0",
      sha256: "not-a-digest",
      artifactName: "homepage-studio-component.tar.gz",
    }),
    /Invalid component release SHA-256/,
  );
  assert.throws(
    () => resolveComponentReleaseArtifact("homepage-studio", "github-stable", {
      tag: "v0.1.0",
      sha256: "b".repeat(64),
      artifactName: "../../payload.tar.gz",
    }),
    /Unexpected component release artifact name/,
  );
});
