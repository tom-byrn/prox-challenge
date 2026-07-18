import assert from "node:assert/strict";
import test from "node:test";
import { runAgentTurn, type AgentTurnInput } from "./agent.js";
import { getTurnPolicy } from "./turn-policy.js";
import type { AgentEvent } from "./types.js";

function hasWidgetRequirement(message: string, name: string): boolean {
  return getTurnPolicy(message).requiredVisuals.some((requirement) => requirement.type === "widget" && requirement.name === name);
}

test("requires agent-selected grounding and a widget for duty-cycle questions", () => {
  const policy = getTurnPolicy("What's the duty cycle for MIG welding at 200A on 240V?");
  assert.equal(policy.requiredTools.includes("request_clarification"), false);
  assert.deepEqual(policy.requiredTools, ["lookup_duty_cycle"]);
  assert.equal(hasWidgetRequirement("What's the duty cycle for MIG welding at 200A on 240V?", "duty_cycle"), true);
  assert.equal(policy.requireCitation, true);
});

test("recognizes a paraphrased duty-cycle question", () => {
  const policy = getTurnPolicy("On 240 volts in MIG mode at 200 amps, how long can I weld before it needs to rest?");
  assert.equal(policy.requiredTools.includes("request_clarification"), false);
  assert.deepEqual(policy.requiredTools, ["lookup_duty_cycle"]);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "widget" && requirement.name === "duty_cycle"), true);
});

test("requires Claude to request interactive clarification for an ambiguous duty-cycle question", () => {
  const policy = getTurnPolicy("What's my duty cycle at 200 amps for MIG?");
  assert.deepEqual(policy.requiredTools, ["request_clarification"]);
  assert.deepEqual(policy.requiredVisuals, []);
  assert.equal(policy.requireCitation, false);
});

test("restores the original response contract after a clarification answer", () => {
  const continuation = `The user is answering a clarification request. Continue the original task using this context:\n${JSON.stringify({
    originalQuestion: "What's my duty cycle at 200 amps for MIG?",
    answer: "240 V"
  })}`;
  const policy = getTurnPolicy(continuation);
  assert.deepEqual(policy.requiredTools, ["lookup_duty_cycle"]);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "widget" && requirement.name === "duty_cycle"), true);
  assert.equal(policy.requireCitation, true);
});

test("requires agent-selected polarity tools and visuals for routing paraphrases", () => {
  const policy = getTurnPolicy("For lift TIG, where do I plug in the torch and work lead?");
  assert.deepEqual(policy.requiredTools, ["lookup_polarity"]);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "visual" && requirement.kinds?.includes("connection-diagram")), true);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "figure"), true);
});

test("requires appropriate presentations for held-out visual intents", () => {
  const manualFigure = getTurnPolicy("Show me where the feed roller is on this welder.");
  const procedure = getTurnPolicy("Give me a step-by-step walkthrough for loading wire.");
  const comparison = getTurnPolicy("Compare MIG versus flux-core welding setup.");

  assert.equal(manualFigure.requiredVisuals.some((requirement) => requirement.type === "figure"), true);
  assert.equal(procedure.requiredVisuals.some((requirement) => requirement.type === "visual" && requirement.kinds?.includes("procedure")), true);
  assert.equal(comparison.requiredVisuals.some((requirement) => requirement.type === "visual" && requirement.kinds?.includes("comparison")), true);
});

test("requires grounded troubleshooting and visuals for defect paraphrases", () => {
  const policy = getTurnPolicy("My gasless flux-core bead has tiny pinholes. What is going wrong?");
  assert.deepEqual(policy.requiredTools, ["lookup_troubleshooting"]);
  assert.equal(hasWidgetRequirement("My gasless flux-core bead has tiny pinholes. What is going wrong?", "troubleshooting"), true);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "figure"), true);
});

test("uses a generic grounding contract for held-out product questions", () => {
  const policy = getTurnPolicy("Can this machine TIG weld aluminum?");
  assert.deepEqual(policy.requiredTools, ["any_grounding_tool"]);
  assert.equal(policy.requireCitation, true);
});

test("does not mistake a general input-voltage question for a settings workflow", () => {
  const policy = getTurnPolicy("What input voltage does this welder support?");
  assert.equal(policy.requiredTools.includes("request_clarification"), false);
  assert.deepEqual(policy.requiredTools, ["any_grounding_tool"]);
});

test("clarifies missing setup state for settings recommendations", () => {
  const policy = getTurnPolicy("What settings should I use for quarter-inch steel?");
  assert.deepEqual(policy.requiredTools, ["request_clarification"]);
});

test("buffers a rejected answer and performs only one repair turn", async () => {
  const events: AgentEvent[] = [];
  const results = ["Unsourced first answer.", "Complete replacement answer."];
  let calls = 0;
  const queryAgent = (() => {
    const result = results[calls] ?? "Unexpected extra attempt";
    calls += 1;
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "result",
          subtype: "success",
          session_id: "00000000-0000-4000-8000-000000000001",
          total_cost_usd: 0,
          result
        };
      },
      close() {}
    };
  }) as unknown as AgentTurnInput["queryAgent"];

  const outcome = await runAgentTurn({
    message: "Can this welder TIG aluminum?",
    emit: (event) => { events.push(event); },
    queryAgent
  });

  const text = events.filter((event): event is Extract<AgentEvent, { type: "text_delta" }> => event.type === "text_delta").map((event) => event.text).join("");
  assert.equal(calls, 2);
  assert.equal(outcome.repaired, true);
  assert.equal(text, "Complete replacement answer.");
  assert.equal(text.includes("Unsourced first answer"), false);
});
