import { z } from "zod";

export const ArtifactTypeSchema = z.enum([
  "text/html",
  "image/svg+xml",
  "text/markdown",
  "application/vnd.ant.mermaid",
  "application/vnd.ant.react",
  "application/vnd.ant.code"
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactContextSchema = z.object({
  identifier: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  title: z.string().trim().min(2).max(100),
  type: ArtifactTypeSchema,
  content: z.string().min(1).max(50_000),
  revision: z.number().int().positive(),
  language: z.string().trim().min(1).max(30).optional()
});

export type ArtifactContext = z.infer<typeof ArtifactContextSchema>;

export type ArtifactPayload = ArtifactContext & {
  id: string;
};

export function artifactRevision(
  artifacts: readonly ArtifactContext[] | undefined,
  identifier: string,
  type: ArtifactType
): { revision: number; operation: "created" | "updated" } {
  const previous = artifacts?.find((artifact) => artifact.identifier === identifier);
  if (previous && previous.type !== type) {
    throw new Error(`Artifact ${identifier} already uses type ${previous.type}. Reuse its type or choose a new identifier.`);
  }
  return { revision: (previous?.revision ?? 0) + 1, operation: previous ? "updated" : "created" };
}

const FORBIDDEN_ACTIVE_CAPABILITIES = /<(?:iframe|object|embed|base|form)\b|https?:\/\/|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.(?:sendBeacon|serviceWorker)|localStorage|sessionStorage|indexedDB|document\.cookie/iu;
const FORBIDDEN_MODULE_IMPORTS = /\b(?:import\s*(?:\(|[\s{*])|require\s*\()/u;

export function validateArtifactContent(type: ArtifactType, content: string): string | undefined {
  if (type === "text/markdown" || type === "application/vnd.ant.mermaid" || type === "application/vnd.ant.code") {
    return /https?:\/\//iu.test(content) ? "Artifact content cannot load or link to external URLs." : undefined;
  }
  if (FORBIDDEN_ACTIVE_CAPABILITIES.test(content)) {
    return "Artifact contains a forbidden network, embedding, form, cookie, or storage capability.";
  }
  if (type === "application/vnd.ant.react" && FORBIDDEN_MODULE_IMPORTS.test(content)) {
    return "React artifacts must be self-contained and cannot import modules. React and its hooks are available through the React global.";
  }
  return undefined;
}
