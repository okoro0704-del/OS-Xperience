import test from "node:test";
import assert from "node:assert/strict";
import { classifyHandPose, handCentroid } from "../src/air-navigation.js";

function landmarks(overrides: Record<number, { x: number; y: number }> = {}) {
  const pts = Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.5 + i * 0.01 }));
  pts[0] = { x: 0.5, y: 0.7 };
  // Default curled (fist-like): tips close to wrist
  for (const tip of [8, 12, 16, 20]) pts[tip] = { x: 0.5, y: 0.62 };
  for (const pip of [6, 10, 14, 18]) pts[pip] = { x: 0.5, y: 0.64 };
  for (const [idx, point] of Object.entries(overrides)) pts[Number(idx)] = point;
  return pts;
}

test("open palm when fingertips are extended", () => {
  const pts = landmarks({
    8: { x: 0.5, y: 0.2 },
    6: { x: 0.5, y: 0.4 },
    12: { x: 0.55, y: 0.18 },
    10: { x: 0.55, y: 0.38 },
    16: { x: 0.6, y: 0.22 },
    14: { x: 0.6, y: 0.4 },
    20: { x: 0.65, y: 0.28 },
    18: { x: 0.65, y: 0.42 },
  });
  assert.equal(classifyHandPose(pts), "open_palm");
});

test("fist when fingertips are curled", () => {
  const pts = landmarks({
    8: { x: 0.5, y: 0.66 },
    6: { x: 0.5, y: 0.55 },
    12: { x: 0.52, y: 0.66 },
    10: { x: 0.52, y: 0.54 },
    16: { x: 0.54, y: 0.65 },
    14: { x: 0.54, y: 0.53 },
    20: { x: 0.56, y: 0.64 },
    18: { x: 0.56, y: 0.52 },
  });
  assert.equal(classifyHandPose(pts), "fist");
});

test("centroid averages palm anchors", () => {
  const c = handCentroid(landmarks({ 0: { x: 0, y: 0 }, 5: { x: 1, y: 0 }, 9: { x: 1, y: 1 }, 13: { x: 0, y: 1 }, 17: { x: 0.5, y: 0.5 } }));
  assert.ok(Math.abs(c.x - 0.5) < 0.01);
  assert.ok(Math.abs(c.y - 0.5) < 0.01);
});
