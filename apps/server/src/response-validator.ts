import type { AgentEvent } from "./types.js";
import type { TurnPolicy, VisualRequirement } from "./turn-policy.js";

export type ResponseEvidence = {
  text: string;
  events: AgentEvent[];
  calledTools: ReadonlySet<string>;
};

const GROUNDING_TOOLS = new Set([
  "search_manual",
  "read_manual_pages",
  "lookup_duty_cycle",
  "lookup_polarity",
  "lookup_troubleshooting",
  "get_specs",
  "get_settings_guide",
  "search_parts"
]);

function hasCitation(text: string): boolean {
  return /\b(?:Owner(?:'|’)?s Manual|Quick Start Guide|Process Selection Chart)\s*,?\s*pp?\.\s*\d+/i.test(text);
}

function hasPresentation(events: AgentEvent[]): boolean {
  return events.some((event) => event.type === "figure" || event.type === "video" || event.type === "widget" || event.type === "visual" || event.type === "artifact");
}

function satisfiesVisual(requirement: VisualRequirement, events: AgentEvent[]): boolean {
  if (requirement.type === "presentation") return hasPresentation(events);
  if (requirement.type === "figure") return events.some((event) => event.type === "figure");
  if (requirement.type === "visual") return events.some((event) => event.type === "visual" && (!requirement.kinds || requirement.kinds.includes(event.visual.spec.kind)));
  return events.some((event) => event.type === "widget" && event.widget.name === requirement.name);
}

function describeVisual(requirement: VisualRequirement): string {
  if (requirement.type === "presentation") return "a visual or interactive presentation";
  if (requirement.type === "figure") return "a relevant source figure";
  if (requirement.type === "visual") return requirement.kinds?.length ? `a dynamic ${requirement.kinds.join(" or ")}` : "a dynamic visual";
  return `the ${requirement.name.replaceAll("_", "-")} widget`;
}

export function validateAgentResponse(policy: TurnPolicy, evidence: ResponseEvidence): string[] {
  const issues: string[] = [];
  const clarificationRequested = evidence.events.some((event) => event.type === "clarification_request");
  if (clarificationRequested) {
    if (!policy.allowClarification) {
      issues.push("The original question already contains the setup context needed to answer it; answer directly instead of asking another question.");
    } else if (!evidence.calledTools.has("request_clarification")) {
      issues.push("Use request_clarification to ask for the missing context.");
    }
    return issues;
  }
  if (!evidence.text.trim()) issues.push("Provide a direct textual answer.");

  for (const requiredTool of policy.requiredTools) {
    if (requiredTool === "any_grounding_tool") {
      if (![...evidence.calledTools].some((toolName) => GROUNDING_TOOLS.has(toolName))) {
        issues.push("Use at least one authoritative manual search, page read, or deterministic lookup tool.");
      }
    } else if (!evidence.calledTools.has(requiredTool)) {
      issues.push(`Call ${requiredTool} before answering.`);
    }
  }

  const missingVisuals = policy.requiredVisuals.filter((requirement) => !satisfiesVisual(requirement, evidence.events));
  for (const requirement of missingVisuals) issues.push(`Include ${describeVisual(requirement)} in the response.`);

  if (policy.requireCitation && !hasCitation(evidence.text)) {
    issues.push("Cite the supporting manual page in the response text.");
  }

  return [...new Set(issues)];
}

export function makeRepairPrompt(originalMessage: string, issues: string[]): string {
  return `<response-repair>
The application withheld your previous response because it did not satisfy the response contract.
Produce a complete replacement answer to the original user request below. Do not discuss validation or apologize.
Repeat every figure, widget, dynamic visual, or artifact the user should see because prior presentation output was also withheld.

Original request:
${originalMessage}

Fix all of these issues:
${issues.map((issue) => `- ${issue}`).join("\n")}
</response-repair>`;
}
