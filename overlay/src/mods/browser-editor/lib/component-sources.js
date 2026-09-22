const identifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const releaseTagPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

const componentSources = Object.freeze({
  "homepage-studio": Object.freeze({
    "github-stable": Object.freeze({
      id: "github-stable",
      componentId: "homepage-studio",
      label: "Homepage Studio · GitHub stable",
      provider: "github-release",
      repository: "Kemper51rus/homepage-studio",
      channel: "stable",
      releaseManifestUrl:
        "https://github.com/Kemper51rus/homepage-studio/releases/latest/download/homepage-component-release.json",
      artifactName: "homepage-studio-component.tar.gz",
    }),
  }),
});

function requireIdentifier(value, name) {
  const normalized = String(value ?? "").trim();
  if (!identifierPattern.test(normalized)) {
    throw new Error(`Invalid ${name}`);
  }
  return normalized;
}

export function listComponentSources() {
  return Object.values(componentSources).flatMap((sources) =>
    Object.values(sources).map(({ id, componentId, label, channel }) => ({
      id,
      componentId,
      label,
      channel,
    })),
  );
}

export function resolveComponentSource(componentId, sourceId) {
  const safeComponentId = requireIdentifier(componentId, "component id");
  const safeSourceId = requireIdentifier(sourceId, "source id");
  const source = componentSources[safeComponentId]?.[safeSourceId];

  if (!source) {
    throw new Error(`Unsupported component source: ${safeComponentId}/${safeSourceId}`);
  }

  return { ...source };
}

export function resolveComponentReleaseArtifact(componentId, sourceId, release) {
  const source = resolveComponentSource(componentId, sourceId);
  const tag = String(release?.tag ?? "").trim();
  const sha256 = String(release?.sha256 ?? "").trim().toLowerCase();
  const artifactName = String(release?.artifactName ?? "").trim();

  if (!releaseTagPattern.test(tag)) {
    throw new Error("Invalid component release tag");
  }
  if (!sha256Pattern.test(sha256)) {
    throw new Error("Invalid component release SHA-256");
  }
  if (artifactName !== source.artifactName) {
    throw new Error("Unexpected component release artifact name");
  }

  return {
    ...source,
    tag,
    sha256,
    artifactName,
    artifactUrl: `https://github.com/${source.repository}/releases/download/${encodeURIComponent(tag)}/${source.artifactName}`,
  };
}
