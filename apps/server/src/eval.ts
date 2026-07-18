import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { annotationTargetsRegion, containsUnsupportedExactMigOutput, diagramConnects, toolStartsBefore } from "./evaluation-assertions.js";
import { runAgentTurn } from "./agent.js";
import type { AgentEvent } from "./types.js";
import { resolveVisualAsset, validateAnnotationGrounding } from "./visuals.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

type Evaluation = {
  name: string;
  question: string;
  check(events: AgentEvent[]): void | Promise<void>;
};

function responseText(events: AgentEvent[]): string {
  return events
    .filter((event): event is Extract<AgentEvent, { type: "text_delta" | "clarification" }> => event.type === "text_delta" || event.type === "clarification")
    .map((event) => event.text)
    .join("");
}

function widget(events: AgentEvent[], name: string) {
  return events.find((event): event is Extract<AgentEvent, { type: "widget" }> => event.type === "widget" && event.widget.name === name)?.widget;
}

function hasFigure(events: AgentEvent[], id: string): boolean {
  return events.some((event) => event.type === "figure" && event.figure.id === id);
}

function hasTool(events: AgentEvent[], name: string): boolean {
  return events.some((event) => event.type === "tool_start" && event.name === name);
}

function visual(events: AgentEvent[], kind: string) {
  return events.find((event): event is Extract<AgentEvent, { type: "visual" }> => event.type === "visual" && event.visual.spec.kind === kind)?.visual;
}

function clarification(events: AgentEvent[]) {
  return events.find((event): event is Extract<AgentEvent, { type: "clarification_request" }> => event.type === "clarification_request")?.clarification;
}

const evaluations: Evaluation[] = [
  {
    name: "MIG duty cycle",
    question: "What's the duty cycle for MIG welding at 200A on 240V?",
    check(events) {
      const text = responseText(events);
      assert.match(text, /25\s*%|25 percent/i);
      assert.match(text, /2\.5/);
      assert.match(text, /7\.5/);
      const data = widget(events, "duty_cycle")?.data as { exact?: boolean; rating?: { dutyPercent?: number; pages?: number[] } } | undefined;
      assert.equal(data?.exact, true);
      assert.equal(data?.rating?.dutyPercent, 25);
      assert.deepEqual(data?.rating?.pages, [7, 14, 23]);
      assert.equal(hasTool(events, "lookup_duty_cycle"), true);
      assert.equal(toolStartsBefore(events, "lookup_duty_cycle", "show_widget"), true);
    }
  },
  {
    name: "Flux-cored porosity",
    question: "I'm getting porosity in my flux-cored welds. What should I check?",
    check(events) {
      assert.ok(responseText(events).trim().length > 0, "Expected a textual diagnosis.");
      const data = widget(events, "troubleshooting")?.data as { matches?: Array<{ checks?: Array<{ cause: string }> }> } | undefined;
      assert.ok(data?.matches?.[0]?.checks?.length, "Expected a diagnostic checklist.");
      assert.equal(data?.matches?.[0]?.checks?.some((check) => /shielding gas/i.test(check.cause)), false);
      assert.equal(hasFigure(events, "wire-weld-defects-b"), true);
      assert.equal(hasTool(events, "lookup_troubleshooting"), true);
    }
  },
  {
    name: "TIG polarity",
    question: "What polarity setup do I need for TIG? Which socket gets the ground clamp?",
    check(events) {
      const text = responseText(events);
      assert.match(text, /DCEN|electrode negative/i);
      assert.match(text, /ground clamp.{0,80}positive|positive.{0,80}ground clamp/is);
      const diagram = visual(events, "connection-diagram");
      assert.ok(diagram, "Expected a dynamically composed connection diagram.");
      if (diagram?.spec.kind === "connection-diagram") {
        assert.equal(diagramConnects(diagram, /ground|work|clamp/i, /positive/i), true);
        assert.equal(diagramConnects(diagram, /torch|tungsten/i, /negative/i), true);
        assert.equal(diagramConnects(diagram, /torch|tungsten/i, /positive/i), false);
      }
      assert.equal(hasFigure(events, "tig-cable-setup"), true);
      assert.equal(hasTool(events, "lookup_polarity"), true);
      assert.equal(hasTool(events, "render_visual"), true);
      assert.equal(toolStartsBefore(events, "lookup_polarity", "render_visual"), true);
    }
  },
  {
    name: "Ambiguous duty cycle",
    question: "What's the MIG duty cycle at 200 amps?",
    check(events) {
      const request = clarification(events);
      assert.ok(request, "Expected an interactive clarification request.");
      assert.match(`${request.question} ${request.options.map((option) => option.label).join(" ")}`, /120\s*V/i);
      assert.match(`${request.question} ${request.options.map((option) => option.label).join(" ")}`, /240\s*V/i);
      assert.equal(request.allowOther, true);
      assert.equal(hasTool(events, "request_clarification"), true);
      assert.equal(hasTool(events, "lookup_duty_cycle"), false);
    }
  },
  {
    name: "Paraphrased duty cycle",
    question: "On a 240-volt supply in MIG mode at 200 amps, how long can I weld before the machine needs to rest?",
    check(events) {
      const text = responseText(events);
      assert.match(text, /25\s*%|25 percent/i);
      assert.match(text, /2\.5/);
      assert.match(text, /7\.5/);
      assert.equal(widget(events, "duty_cycle") !== undefined, true);
      assert.equal(hasTool(events, "lookup_duty_cycle"), true);
    }
  },
  {
    name: "Unpublished duty-cycle point",
    question: "What is the MIG duty cycle at 180 amps on 240 V?",
    check(events) {
      const text = responseText(events);
      assert.match(text, /unpublished|not published|nearest|does not (?:specify|list)|no certified/i);
      const data = widget(events, "duty_cycle")?.data as { exact?: boolean; nearestPublishedRatings?: unknown[] } | undefined;
      assert.equal(data?.exact, false);
      assert.ok(data?.nearestPublishedRatings?.length);
      assert.equal(hasTool(events, "lookup_duty_cycle"), true);
    }
  },
  {
    name: "Feed-roller visual",
    question: "I'm loading 0.035 self-shielded flux-core wire. Which feed-roller groove should I use? Show me the relevant manual image.",
    async check(events) {
      assert.ok(responseText(events).trim().length > 0);
      const annotation = visual(events, "annotated-image");
      assert.ok(annotation, "Expected a dynamically annotated manual image.");
      if (annotation?.spec.kind === "annotated-image") {
        assert.equal(annotation.spec.image.assetId, "figure:feed-roller-guide");
        assert.match(annotation.spec.annotations.map((item) => `${item.label} ${item.body ?? ""}`).join(" "), /0\.035|flux|knurl/i);
        const prepared = await resolveVisualAsset(annotation.spec.image.assetId);
        validateAnnotationGrounding(annotation.spec, prepared);
        assert.equal(annotationTargetsRegion(annotation, (_target, normalized) => normalized.x > 0.5 && normalized.x < 0.8 && normalized.y > 0.4 && normalized.y < 0.8), true);
      }
      assert.equal(hasTool(events, "search_manual") || hasTool(events, "read_manual_pages"), true);
      assert.equal(hasTool(events, "inspect_visual_source"), true);
      assert.equal(hasTool(events, "preview_visual_annotations"), true);
      assert.equal(hasTool(events, "render_visual"), true);
      assert.equal(toolStartsBefore(events, "inspect_visual_source", "preview_visual_annotations"), true);
      assert.equal(toolStartsBefore(events, "preview_visual_annotations", "render_visual"), true);
    }
  },
  {
    name: "Incorrect TIG polarity premise",
    question: "The TIG torch goes in positive and the ground clamp goes in negative, right? Show me the hookup.",
    check(events) {
      const text = responseText(events);
      assert.match(text, /torch.{0,100}negative|negative.{0,100}torch/is);
      assert.match(text, /ground|work clamp/i);
      assert.match(text, /positive/i);
      const diagram = visual(events, "connection-diagram");
      assert.equal(diagramConnects(diagram, /torch|tungsten/i, /negative/i), true);
      assert.equal(diagramConnects(diagram, /ground|work|clamp/i, /positive/i), true);
      assert.equal(diagramConnects(diagram, /torch|tungsten/i, /positive/i), false);
      assert.equal(hasTool(events, "lookup_polarity"), true);
      assert.equal(toolStartsBefore(events, "lookup_polarity", "render_visual"), true);
    }
  },
  {
    name: "Unsupported exact MIG settings",
    question: "Give me the exact voltage and wire speed for MIG welding quarter-inch mild steel.",
    check(events) {
      const text = responseText(events);
      assert.match(text, /not publish|does not (?:publish|list|provide)|LCD|synergic|scrap/i);
      assert.equal(containsUnsupportedExactMigOutput(text), false, `Response appears to invent an exact output setting: ${text}`);
      assert.equal(hasTool(events, "get_settings_guide"), true);
      assert.equal(toolStartsBefore(events, "get_settings_guide", "show_widget"), true);
    }
  },
  {
    name: "Machine-specific TIG aluminum limit",
    question: "Can this OmniPro TIG weld aluminum?",
    check(events) {
      const text = responseText(events);
      assert.match(text, /DC TIG|DC-only|does not support AC|cannot AC TIG|not.*TIG.*aluminum/is);
      assert.equal(hasTool(events, "get_specs") || hasTool(events, "search_manual") || hasTool(events, "read_manual_pages"), true);
    }
  }
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is required for the live acceptance evaluation. Copy .env.example to .env and add a key.");
  }

  let totalCost = 0;
  for (const evaluation of evaluations) {
    const events: AgentEvent[] = [];
    const outcome = await runAgentTurn({
      message: evaluation.question,
      emit: (event) => { events.push(event); }
    });
    await evaluation.check(events);
    assert.deepEqual(outcome.validationIssues, [], `Response contract failed: ${outcome.validationIssues.join(" ")}`);
    const done = events.find((event): event is Extract<AgentEvent, { type: "done" }> => event.type === "done");
    totalCost += done?.costUsd ?? 0;
    console.log(`PASS ${evaluation.name}`);
  }
  console.log(`Live acceptance evaluation passed (${evaluations.length} cases, $${totalCost.toFixed(4)}).`);
}

await main();
