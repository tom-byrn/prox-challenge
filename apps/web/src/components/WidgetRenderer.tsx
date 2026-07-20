import { useId } from "react";
import type { ProcedureSpec, VisualPayload, VisualSourceRef } from "../visual-spec";
import type { WidgetPayload } from "../types";
import { VisualRenderer } from "./visuals/VisualRenderer";

type Props = {
  widget: WidgetPayload;
  onStepHelp: (stepNumber: number, step: ProcedureSpec["steps"][number]) => void;
  stepHelpDisabled: boolean;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function text(value: unknown, fallback = "Unavailable"): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0) : [];
}

function sourceRef(pages: number[]): VisualSourceRef {
  return { kind: "document", sourceId: "owner-manual", pages: pages.length ? [...new Set(pages)] : [1] };
}

function legacyWidgetToVisual(widget: WidgetPayload, id: string): VisualPayload {
  const data = asRecord(widget.data);

  if (widget.name === "duty_cycle" && data) {
    const exact = data.exact === true ? asRecord(data.rating) : undefined;
    const nearest = Array.isArray(data.nearestPublishedRatings)
      ? data.nearestPublishedRatings.map(asRecord).filter((rating): rating is UnknownRecord => Boolean(rating))
      : [];
    const ratings = exact ? [exact] : nearest;
    const pages = ratings.flatMap((rating) => numberList(rating.pages));
    return {
      id,
      assets: [],
      spec: {
        schemaVersion: 1,
        kind: "metric-summary",
        title: exact ? widget.title : "Nearest published duty-cycle ratings",
        description: exact ? `${text(exact.process)} · ${text(exact.inputVoltage)} V · ${text(exact.amps)} A` : "The requested operating point is not published, so these are reference points rather than an estimate.",
        sourceRefs: [sourceRef(pages)],
        metrics: ratings.length ? ratings.map((rating, index) => ({
          id: `rating-${index + 1}`,
          label: exact ? "Published duty cycle" : `${text(rating.amps)} A at ${text(rating.inputVoltage)} V`,
          value: text(rating.dutyPercent),
          unit: "%",
          detail: `${text(rating.weldMinutes)} min maximum welding · ${text(rating.restMinutes)} min cooling`,
          tone: exact ? "primary" as const : "neutral" as const
        })) : [{ id: "unavailable", label: "Published rating", value: "Unavailable", tone: "warning" as const }],
        callout: exact ? {
          title: `${text(data.periodMinutes, "10")}-minute rating period`,
          body: "Leave power on while cooling so the fan can run.",
          tone: "neutral"
        } : undefined
      }
    };
  }

  if (widget.name === "troubleshooting" && data) {
    const match = Array.isArray(data.matches) ? asRecord(data.matches[0]) : undefined;
    const checks = match && Array.isArray(match.checks)
      ? match.checks.map(asRecord).filter((check): check is UnknownRecord => Boolean(check))
      : [];
    if (match && checks.length) {
      const evidence = sourceRef(numberList(match.pages));
      return {
        id,
        assets: [],
        spec: {
          schemaVersion: 1,
          kind: "procedure",
          title: text(match.symptom, widget.title),
          description: "Work through these checks in order.",
          sourceRefs: [evidence],
          steps: checks.map((check, index) => ({
            id: `check-${index + 1}`,
            title: text(check.cause, `Check ${index + 1}`),
            body: text(check.action, "Inspect and correct this condition before continuing."),
            evidence
          }))
        }
      };
    }
  }

  if (widget.name === "settings_guide" && data) {
    const mode = asRecord(data.mode);
    if (mode) {
      const inputs = Array.isArray(mode.inputs) ? mode.inputs : [];
      const materials = Array.isArray(mode.supportedMaterials) ? mode.supportedMaterials : [];
      const wireSizes = Array.isArray(mode.wireDiameterIn) ? mode.wireDiameterIn : [];
      const evidence = sourceRef(numberList(data.pages));
      return {
        id,
        assets: [],
        spec: {
          schemaVersion: 1,
          kind: "reference-card",
          title: `${text(mode.process).replaceAll("_", "-")} starting point`,
          sourceRefs: [evidence],
          groups: [
            {
              id: "inputs",
              title: "Set these on the display",
              items: inputs.length ? inputs.map((input, index) => ({ id: `input-${index + 1}`, label: `Input ${index + 1}`, value: text(input) })) : [{ id: "input-none", label: "Inputs", value: "See the machine display" }]
            },
            {
              id: "support",
              title: "Supported setup",
              items: [
                { id: "materials", label: "Materials", value: materials.map((item) => text(item)).join(", ") || "See manual" },
                ...(wireSizes.length ? [{ id: "wire", label: "Wire diameter", value: wireSizes.map((size) => `${text(size)} in`).join(", ") }] : []),
                { id: "behavior", label: "Machine behavior", detail: text(mode.machineBehavior, "The display supplies the recommended starting marks.") }
              ]
            }
          ],
          callouts: [{
            id: "accuracy",
            body: text(mode.unsupportedNote ?? data.accuracyNote, "The supplied manual does not publish the full numeric synergic table."),
            tone: "warning"
          }]
        }
      };
    }
  }

  if (widget.name === "polarity" && data) {
    const pages = asRecord(data.pages);
    const evidence = sourceRef(numberList(pages?.ownerManual));
    const clampSocket = text(data.groundClampSocket, "negative");
    const electrodeSocket = text(data.electrodeSocket, "positive");
    return {
      id,
      assets: [],
      spec: {
        schemaVersion: 1,
        kind: "connection-diagram",
        title: widget.title,
        description: `${text(data.process)} · ${text(data.polarity)}`,
        sourceRefs: [evidence],
        layout: { direction: "left-to-right" },
        nodes: [
          { id: "machine", role: "device", label: "Output panel", ports: [{ id: "negative", label: "Negative" }, { id: "positive", label: "Positive" }] },
          { id: "clamp", role: "endpoint", label: "Work clamp", detail: `${clampSocket} socket` },
          { id: "electrode", role: "endpoint", label: text(data.electrodeLead, "Electrode lead"), detail: `${electrodeSocket} socket` }
        ],
        connections: [
          { id: "clamp-route", from: { node: "machine", port: clampSocket === "positive" ? "positive" : "negative" }, to: { node: "clamp" }, label: "Work lead", evidence },
          { id: "electrode-route", from: { node: "machine", port: electrodeSocket === "negative" ? "negative" : "positive" }, to: { node: "electrode" }, label: "Electrode path", tone: "primary", evidence }
        ],
        callouts: data.caution ? [{ target: { node: "machine" }, text: text(data.caution), tone: "warning" }] : undefined
      }
    };
  }

  return {
    id,
    assets: [],
    spec: {
      schemaVersion: 1,
      kind: "reference-card",
      title: widget.title,
      description: "This saved response used an older presentation format.",
      sourceRefs: [sourceRef([])],
      groups: [{ id: "legacy", title: "Saved information", items: [{ id: "unavailable", label: "Status", value: "Unable to reconstruct this legacy card" }] }]
    }
  };
}

export function WidgetRenderer({ widget, onStepHelp, stepHelpDisabled }: Props) {
  const reactId = useId().replaceAll(":", "");
  return <VisualRenderer visual={legacyWidgetToVisual(widget, `legacy-${reactId}`)} onStepHelp={onStepHelp} stepHelpDisabled={stepHelpDisabled} />;
}
