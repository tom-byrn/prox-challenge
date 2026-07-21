import assert from "node:assert/strict";
import test from "node:test";
import { runAgentTurn, type AgentTurnInput } from "./agent.js";
import { getTurnPolicy } from "./turn-policy.js";
import type { AgentEvent } from "./types.js";

test("requires agent-selected grounding and prefers a metric summary for duty-cycle questions", () => {
  const policy = getTurnPolicy("What's the duty cycle for MIG welding at 200A on 240V?");
  assert.equal(policy.requiredTools.includes("request_clarification"), false);
  assert.deepEqual(policy.requiredTools, ["lookup_duty_cycle"]);
  assert.deepEqual(policy.requiredVisuals, []);
  assert.equal(policy.presentation.level, "preferred");
  assert.equal(policy.presentation.kinds?.includes("metric-summary"), true);
  assert.equal(policy.requireCitation, true);
});

test("recognizes a paraphrased duty-cycle question", () => {
  const policy = getTurnPolicy("On 240 volts in MIG mode at 200 amps, how long can I weld before it needs to rest?");
  assert.equal(policy.requiredTools.includes("request_clarification"), false);
  assert.deepEqual(policy.requiredTools, ["lookup_duty_cycle"]);
  assert.equal(policy.presentation.level, "preferred");
  assert.equal(policy.presentation.kinds?.includes("metric-summary"), true);
});

test("requires Claude to request interactive clarification for an ambiguous duty-cycle question", () => {
  const policy = getTurnPolicy("What's my duty cycle at 200 amps for MIG?");
  assert.deepEqual(policy.requiredTools, ["request_clarification"]);
  assert.deepEqual(policy.requiredVisuals, []);
  assert.equal(policy.presentation.level, "text-first");
  assert.equal(policy.requireCitation, false);
});

test("restores the original response contract after a clarification answer", () => {
  const continuation = `The user is answering a clarification request. Continue the original task using this context:\n${JSON.stringify({
    originalQuestion: "What's my duty cycle at 200 amps for MIG?",
    answer: "240 V"
  })}`;
  const policy = getTurnPolicy(continuation);
  assert.deepEqual(policy.requiredTools, ["lookup_duty_cycle"]);
  assert.equal(policy.presentation.level, "preferred");
  assert.equal(policy.presentation.kinds?.includes("metric-summary"), true);
  assert.equal(policy.requireCitation, true);
});

test("requires agent-selected polarity tools and visuals for routing paraphrases", () => {
  const policy = getTurnPolicy("For lift TIG, where do I plug in the torch and work lead?");
  assert.deepEqual(policy.requiredTools, ["lookup_polarity"]);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "visual" && requirement.kinds?.includes("connection-diagram")), true);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "figure"), false);
  assert.equal(policy.presentation.level, "required");
});

test("requires appropriate presentations for held-out visual intents", () => {
  const manualFigure = getTurnPolicy("Show me where the feed roller is on this welder.");
  const procedure = getTurnPolicy("Give me a step-by-step walkthrough for loading wire.");
  const comparison = getTurnPolicy("Compare MIG versus flux-core welding setup.");

  assert.equal(manualFigure.requiredVisuals.some((requirement) => requirement.type === "presentation"), true);
  assert.equal(manualFigure.presentation.level, "required");
  assert.equal(procedure.requiredVisuals.some((requirement) => requirement.type === "visual" && requirement.kinds?.includes("procedure")), true);
  assert.equal(comparison.requiredVisuals.some((requirement) => requirement.type === "visual" && requirement.kinds?.includes("comparison")), true);
});

test("requires grounded troubleshooting and prefers a procedure for defect paraphrases", () => {
  const policy = getTurnPolicy("My gasless flux-core bead has tiny pinholes. What is going wrong?");
  assert.deepEqual(policy.requiredTools, ["lookup_troubleshooting"]);
  assert.deepEqual(policy.requiredVisuals, []);
  assert.equal(policy.presentation.level, "preferred");
  assert.equal(policy.presentation.kinds?.includes("procedure"), true);
});

test("uses a generic grounding contract for held-out product questions", () => {
  const policy = getTurnPolicy("Can this machine TIG weld aluminum?");
  assert.deepEqual(policy.requiredTools, ["any_grounding_tool"]);
  assert.equal(policy.requireCitation, true);
});

test("requires grounded annotation for a user photo diagnosis", () => {
  const policy = getTurnPolicy("What should I check here?", { hasPhoto: true });
  assert.deepEqual(policy.requiredTools, ["any_grounding_tool"]);
  assert.equal(policy.requiredVisuals.some((requirement) => requirement.type === "visual" && requirement.kinds?.includes("annotated-image")), true);
  assert.equal(policy.requireCitation, true);
  assert.equal(policy.allowClarification, true);
  assert.equal(policy.presentation.level, "required");
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

test("prefers a generic reference card for a fully specified settings request", () => {
  const policy = getTurnPolicy("What MIG settings should I use for quarter-inch steel?");
  assert.deepEqual(policy.requiredTools, ["get_settings_guide"]);
  assert.deepEqual(policy.requiredVisuals, []);
  assert.equal(policy.presentation.level, "preferred");
  assert.equal(policy.presentation.kinds?.includes("reference-card"), true);
});

test("buffers a rejected answer and performs only one repair turn", async () => {
  const events: AgentEvent[] = [];
  const results = ["Unsourced first answer.", "Complete replacement answer."];
  const costs = [1.25, 0.5];
  const seenOptions: Array<Record<string, unknown>> = [];
  let calls = 0;
  const queryAgent = (({ options }: { options: Record<string, unknown> }) => {
    seenOptions.push(options);
    const result = results[calls] ?? "Unexpected extra attempt";
    const cost = costs[calls] ?? 0;
    calls += 1;
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "result",
          subtype: "success",
          session_id: "00000000-0000-4000-8000-000000000001",
          total_cost_usd: cost,
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
  const done = events.find((event): event is Extract<AgentEvent, { type: "done" }> => event.type === "done");
  assert.equal(calls, 2);
  assert.equal(outcome.repaired, true);
  assert.equal(text, "Complete replacement answer.");
  assert.equal(text.includes("Unsourced first answer"), false);
  assert.ok(done?.metrics);
  assert.equal(done.metrics.repaired, true);
  assert.equal(done.metrics.status, "degraded");
  assert.equal(done.metrics.validationIssues > 0, true);
  assert.equal(done.metrics.model, "claude-sonnet-4-6");
  assert.equal(seenOptions.length, 2);
  assert.deepEqual(seenOptions.map((options) => options.maxBudgetUsd), [3, 1.75]);
  assert.equal(outcome.costUsd, 1.75);
});
