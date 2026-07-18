import assert from "node:assert/strict";
import test from "node:test";
import { lookupTroubleshooting } from "./knowledge.js";
import { buildWidget, resolveToolArgument } from "./tools.js";

test("explicit user context wins over conflicting model arguments", () => {
  assert.equal(resolveToolArgument("MIG", "FLUX_CORED"), "FLUX_CORED");
  assert.equal(resolveToolArgument(200, 180), 180);
  assert.equal(resolveToolArgument("MIG", undefined), "MIG");
});

test("troubleshooting widget reuses the process-filtered lookup result", () => {
  const symptom = "porosity in my flux-cored weld";
  const cachedLookup = lookupTroubleshooting(symptom, "flux-cored");
  const widget = buildWidget({ name: "troubleshooting", symptom }, cachedLookup);
  const data = widget.data as { matches: Array<{ checks: Array<{ cause: string }> }> };

  assert.equal(widget.name, "troubleshooting");
  assert.equal(data.matches[0]?.checks.some((check) => /shielding gas/i.test(check.cause)), false);
});

test("troubleshooting widget can still compute data when no lookup is cached", () => {
  const widget = buildWidget({
    name: "troubleshooting",
    symptom: "porosity in my MIG weld",
    process: "MIG"
  });
  const data = widget.data as { matches: Array<{ checks: Array<{ cause: string }> }> };

  assert.equal(data.matches[0]?.checks.some((check) => /shielding gas/i.test(check.cause)), true);
});

test("troubleshooting widget filters flux-cored advice without relying on cache order", () => {
  const widget = buildWidget({
    name: "troubleshooting",
    symptom: "porosity in my flux-cored weld",
    process: "FLUX_CORED"
  });
  const data = widget.data as { matches: Array<{ checks: Array<{ cause: string }> }> };

  assert.equal(data.matches[0]?.checks.some((check) => /shielding gas/i.test(check.cause)), false);
});
