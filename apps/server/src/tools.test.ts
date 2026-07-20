import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolArgument } from "./tools.js";

test("explicit user context wins over conflicting model arguments", () => {
  assert.equal(resolveToolArgument("MIG", "FLUX_CORED"), "FLUX_CORED");
  assert.equal(resolveToolArgument(200, 180), 180);
  assert.equal(resolveToolArgument("MIG", undefined), "MIG");
});
