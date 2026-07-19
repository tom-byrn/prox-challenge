import assert from "node:assert/strict";
import test from "node:test";
import { getFigure, lookupDutyCycle, lookupPolarity, lookupTroubleshooting, resolveEvidenceRef, searchParts, searchSources } from "./knowledge.js";

test("returns the sample MIG duty-cycle rating exactly", () => {
  const result = lookupDutyCycle("MIG", 240, 200);
  assert.equal(result.exact, true);
  if ("rating" in result && result.rating) {
    assert.equal(result.rating.dutyPercent, 25);
    assert.equal(result.rating.weldMinutes, 2.5);
    assert.equal(result.rating.restMinutes, 7.5);
  } else {
    assert.fail("Expected an exact duty-cycle rating");
  }
});

test("does not interpolate unpublished duty-cycle values", () => {
  const result = lookupDutyCycle("MIG", 240, 180);
  assert.equal(result.exact, false);
  assert.match("policy" in result ? result.policy ?? "" : "", /Do not interpolate/i);
});

test("returns TIG DCEN hookup with the ground clamp positive", () => {
  const result = lookupPolarity("TIG");
  assert.equal(result.polarity, "DCEN");
  assert.equal(result.groundClampSocket, "positive");
  assert.equal(result.electrodeSocket, "negative");
  assert.equal(result.figureId, "tig-cable-setup");
});

test("filters gas-only porosity advice out of self-shielded flux-cored checks", () => {
  const result = lookupTroubleshooting("porosity holes in bead", "flux-cored");
  assert.equal(result.matches[0]?.id, "wire-porosity");
  assert.equal(result.matches[0]?.checks.some((check) => check.cause.toLowerCase().includes("shielding gas")), false);
});

test("figure and parts catalogs resolve", () => {
  assert.equal(getFigure("tig-cable-setup").pages[0], 2);
  assert.equal(searchParts("fan").results.length, 2);
});

test("finds and resolves an exact timestamped product-video segment", () => {
  const result = searchSources("foot pedal lift start TIG");
  assert.equal(result.videos[0]?.id, "video:setup-demo@249-334");
  const source = resolveEvidenceRef({ kind: "video", segmentId: "video:setup-demo@249-334" });
  assert.equal(source.kind, "video");
  if (source.kind === "video") {
    assert.equal(source.startSeconds, 249);
    assert.equal(source.endSeconds, 334);
    assert.match(source.url ?? "", /t=249s/);
  }
});
