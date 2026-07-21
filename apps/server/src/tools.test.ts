import assert from "node:assert/strict";
import test from "node:test";
import { beginAnnotationPreview, resolveToolArgument, type AnnotationPreviewState } from "./tools.js";

test("explicit user context wins over conflicting model arguments", () => {
  assert.equal(resolveToolArgument("MIG", "FLUX_CORED"), "FLUX_CORED");
  assert.equal(resolveToolArgument(200, 180), 180);
  assert.equal(resolveToolArgument("MIG", undefined), "MIG");
});

test("annotation previews reject duplicate invalid specs and stop after two images", () => {
  const state: AnnotationPreviewState = {
    attempts: 0,
    approvedHashes: new Set(),
    rejectedHashes: new Set()
  };

  assert.equal(beginAnnotationPreview(state, "first"), "proceed");
  state.rejectedHashes.add("first");
  assert.equal(beginAnnotationPreview(state, "first"), "duplicate");
  assert.equal(state.attempts, 1);

  assert.equal(beginAnnotationPreview(state, "second"), "proceed");
  assert.equal(beginAnnotationPreview(state, "third"), "limit");
  assert.equal(state.attempts, 2);

  state.approvedHashes.add("approved");
  assert.equal(beginAnnotationPreview(state, "approved"), "approved");
});
