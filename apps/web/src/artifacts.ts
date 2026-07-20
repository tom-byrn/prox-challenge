export const ARTIFACT_TYPES = [
  "text/html",
  "image/svg+xml",
  "text/markdown",
  "application/vnd.ant.mermaid",
  "application/vnd.ant.react",
  "application/vnd.ant.code"
] as const;

export type ArtifactType = typeof ARTIFACT_TYPES[number];

export type ArtifactPayload = {
  id: string;
  identifier: string;
  title: string;
  type: ArtifactType;
  content: string;
  revision: number;
  language?: string;
};

export type LegacyArtifactPayload = {
  id: string;
  title: string;
  html: string;
};

export type StoredArtifactPayload = ArtifactPayload | LegacyArtifactPayload;

export function normalizeArtifact(artifact: StoredArtifactPayload): ArtifactPayload {
  if ("content" in artifact) return artifact;
  return {
    id: artifact.id,
    identifier: `legacy-${artifact.id}`,
    title: artifact.title,
    type: "text/html",
    content: artifact.html,
    revision: 1
  };
}

export function artifactTypeLabel(type: ArtifactType): string {
  return ({
    "text/html": "HTML",
    "image/svg+xml": "SVG",
    "text/markdown": "Markdown",
    "application/vnd.ant.mermaid": "Mermaid",
    "application/vnd.ant.react": "React",
    "application/vnd.ant.code": "Code"
  } as const)[type];
}
