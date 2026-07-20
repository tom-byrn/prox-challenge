import assert from "node:assert/strict";
import test from "node:test";
import { makeRepairPrompt, validateAgentResponse } from "./response-validator.js";
import { getTurnPolicy } from "./turn-policy.js";
import type { AgentEvent } from "./types.js";
import { buildVisualPayload } from "./visuals.js";

const tigDiagram: AgentEvent = {
  type: "visual",
  visual: await buildVisualPayload("tig-routing", {
    schemaVersion: 1,
    kind: "connection-diagram",
    title: "TIG cable hookup",
    sourceRefs: [{ kind: "document", sourceId: "quick-start", pages: [2] }],
    layout: { direction: "left-to-right" },
    nodes: [
      { id: "torch", role: "endpoint", label: "TIG torch", ports: [{ id: "lead", label: "Torch lead" }] },
      { id: "welder", role: "device", label: "OmniPro 220", ports: [{ id: "negative", label: "Negative socket" }, { id: "positive", label: "Positive socket" }] },
      { id: "work", role: "endpoint", label: "Work clamp", ports: [{ id: "lead", label: "Work lead" }] }
    ],
    connections: [
      { id: "torch-negative", from: { node: "torch", port: "lead" }, to: { node: "welder", port: "negative" }, label: "DCEN" },
      { id: "work-positive", from: { node: "work", port: "lead" }, to: { node: "welder", port: "positive" }, label: "Positive" }
    ]
  })
};

const tigFigure: AgentEvent = {
  type: "figure",
  figure: {
    id: "tig-cable-setup",
    title: "TIG cable setup",
    caption: "Torch negative, work clamp positive.",
    url: "/knowledge/figures/tig-cable-setup.png",
    source: "quick-start",
    pages: [2]
  }
};

test("accepts a grounded, cited, multimodal polarity response", () => {
  const policy = getTurnPolicy("What polarity setup do I need for TIG?");
  const issues = validateAgentResponse(policy, {
    text: "Use DCEN: torch negative and work clamp positive (Quick Start Guide, p. 2).",
    events: [tigDiagram, tigFigure],
    calledTools: new Set(["lookup_polarity", "render_visual", "show_figure"])
  });
  assert.deepEqual(issues, []);
});

test("reports missing grounding, citation, and visuals without supplying the answer", () => {
  const policy = getTurnPolicy("What polarity setup do I need for TIG?");
  const issues = validateAgentResponse(policy, {
    text: "Put the work clamp in the positive socket.",
    events: [],
    calledTools: new Set()
  });
  assert.equal(issues.some((issue) => issue.includes("lookup_polarity")), true);
  assert.equal(issues.some((issue) => issue.includes("connection-diagram")), true);
  assert.equal(issues.some((issue) => issue.includes("manual page")), true);
});

test("generic product questions accept any authoritative knowledge tool", () => {
  const policy = getTurnPolicy("Can this welder TIG aluminum?");
  const issues = validateAgentResponse(policy, {
    text: "The machine is DC TIG only (Owner's Manual, p. 7).",
    events: [],
    calledTools: new Set(["get_specs"])
  });
  assert.deepEqual(issues, []);
});

test("accepts a tool-rendered clarification without requiring answer text or citations", () => {
  const policy = getTurnPolicy("What's the MIG duty cycle at 200 amps?");
  const issues = validateAgentResponse(policy, {
    text: "",
    events: [{
      type: "clarification_request",
      clarification: {
        id: "00000000-0000-4000-8000-000000000010",
        originalQuestion: "What's the MIG duty cycle at 200 amps?",
        question: "Which input supply are you using?",
        options: [{ id: "120v", label: "120 V" }, { id: "240v", label: "240 V" }],
        allowOther: true
      }
    }],
    calledTools: new Set(["request_clarification"])
  });
  assert.deepEqual(issues, []);
});

test("allows Claude to clarify a novel ambiguous product question", () => {
  const policy = getTurnPolicy("The arc keeps cutting out—what am I missing?");
  const issues = validateAgentResponse(policy, {
    text: "",
    events: [{
      type: "clarification_request",
      clarification: {
        id: "00000000-0000-4000-8000-000000000012",
        originalQuestion: "The arc keeps cutting out—what am I missing?",
        question: "Which welding process are you using?",
        options: [{ id: "wire", label: "MIG or flux-cored" }, { id: "tig", label: "TIG" }, { id: "stick", label: "Stick" }],
        allowOther: true
      }
    }],
    calledTools: new Set(["request_clarification"])
  });
  assert.deepEqual(issues, []);
});

test("rejects unnecessary clarification when the question is already answerable", () => {
  const policy = getTurnPolicy("What's the MIG duty cycle at 200 amps on 240 V?");
  const issues = validateAgentResponse(policy, {
    text: "",
    events: [{
      type: "clarification_request",
      clarification: {
        id: "00000000-0000-4000-8000-000000000011",
        originalQuestion: "What's the MIG duty cycle at 200 amps on 240 V?",
        question: "Which shielding gas are you using?",
        options: [{ id: "argon", label: "Argon" }, { id: "blend", label: "Argon/CO2 blend" }],
        allowOther: true
      }
    }],
    calledTools: new Set(["request_clarification"])
  });
  assert.equal(issues.some((issue) => /answer directly/i.test(issue)), true);
});

test("repair prompt requests a full replacement and repeats withheld visuals", () => {
  const prompt = makeRepairPrompt("Show the TIG hookup", ["Include a relevant source figure."]);
  assert.match(prompt, /complete replacement answer/i);
  assert.match(prompt, /Repeat every figure/i);
  assert.match(prompt, /Show the TIG hookup/);
});
