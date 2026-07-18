import type { AgentEvent } from "./types.js";
import type { VisualPayload } from "./visual-spec.js";

export function toolStartsBefore(events: AgentEvent[], prerequisite: string, consumer: string): boolean {
  const prerequisiteIndex = events.findIndex((event) => event.type === "tool_start" && event.name === prerequisite);
  const consumerIndex = events.findIndex((event) => event.type === "tool_start" && event.name === consumer);
  return prerequisiteIndex >= 0 && consumerIndex > prerequisiteIndex;
}

function endpointText(visual: VisualPayload, endpoint: { node: string; port?: string }): string {
  if (visual.spec.kind !== "connection-diagram") return "";
  const node = visual.spec.nodes.find((candidate) => candidate.id === endpoint.node);
  const port = endpoint.port ? node?.ports?.find((candidate) => candidate.id === endpoint.port) : undefined;
  return [node?.id, node?.label, node?.detail, port?.id, port?.label].filter(Boolean).join(" ");
}

export function diagramConnects(visual: VisualPayload | undefined, left: RegExp, right: RegExp): boolean {
  if (!visual || visual.spec.kind !== "connection-diagram") return false;
  return visual.spec.connections.some((connection) => {
    const from = endpointText(visual, connection.from);
    const to = endpointText(visual, connection.to);
    left.lastIndex = 0;
    right.lastIndex = 0;
    const forward = left.test(from) && right.test(to);
    left.lastIndex = 0;
    right.lastIndex = 0;
    return forward || (left.test(to) && right.test(from));
  });
}

export function annotationTargetsRegion(
  visual: VisualPayload | undefined,
  matches: (target: { x: number; y: number }, normalized: { x: number; y: number }) => boolean
): boolean {
  if (!visual || visual.spec.kind !== "annotated-image") return false;
  const spec = visual.spec;
  const asset = visual.assets.find((candidate) => candidate.assetId === spec.image.assetId);
  if (!asset) return false;
  return spec.annotations.some((annotation) => {
    const target = annotation.shape === "pin" ? annotation.point
      : annotation.shape === "arrow" ? annotation.to
        : { x: (annotation.bounds.x1 + annotation.bounds.x2) / 2, y: (annotation.bounds.y1 + annotation.bounds.y2) / 2 };
    return matches(target, { x: target.x / asset.width, y: target.y / asset.height });
  });
}

export function containsUnsupportedExactMigOutput(text: string): boolean {
  const wireSpeed = /\b\d{2,4}(?:\.\d+)?\s*(?:ipm|in\.?\s*\/\s*min(?:ute)?)\b/i.test(text);
  const outputVoltage = /\b(?:1[4-9]|2\d|3\d)(?:\.\d+)?\s*(?:v|volts?)\b/i.test(text);
  return wireSpeed || outputVoltage;
}
