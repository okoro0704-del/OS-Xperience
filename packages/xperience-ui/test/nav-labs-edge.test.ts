import test from "node:test";
import assert from "node:assert/strict";
import { computeEdgeProgress, shouldCommitEdgePull } from "../src/nav-labs/transition.js";
import { resolveCommitThresholdPx } from "../src/nav-labs/recognizers/edge-pull.js";
import { DEFAULT_EDGE_PULL } from "../src/nav-labs/labs-store.js";

test("computeEdgeProgress clamps 0–1", () => {
  assert.equal(computeEdgeProgress(0, 100), 0);
  assert.equal(computeEdgeProgress(50, 100), 0.5);
  assert.equal(computeEdgeProgress(100, 100), 1);
  assert.equal(computeEdgeProgress(200, 100), 1);
  assert.equal(computeEdgeProgress(-10, 100), 0);
});

test("computeEdgeProgress handles zero threshold", () => {
  assert.equal(computeEdgeProgress(1, 0), 1);
  assert.equal(computeEdgeProgress(0, 0), 0);
});

test("shouldCommitEdgePull at full progress", () => {
  assert.equal(shouldCommitEdgePull(1, 0), true);
  assert.equal(shouldCommitEdgePull(0.99, 0), false);
});

test("shouldCommitEdgePull velocity assist", () => {
  assert.equal(shouldCommitEdgePull(0.55, 0.85), true);
  assert.equal(shouldCommitEdgePull(0.55, 0.2), false);
  assert.equal(shouldCommitEdgePull(0.4, 2), false);
});

test("resolveCommitThresholdPx uses ratio of host width", () => {
  const px = resolveCommitThresholdPx(400, DEFAULT_EDGE_PULL);
  assert.equal(px, Math.max(48, 400 * 0.35));
});

test("resolveCommitThresholdPx absolute override", () => {
  const px = resolveCommitThresholdPx(400, { ...DEFAULT_EDGE_PULL, commitThresholdPx: 90 });
  assert.equal(px, 90);
});
