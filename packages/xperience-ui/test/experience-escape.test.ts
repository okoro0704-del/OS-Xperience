import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTwoFingerHorizontalEscape,
  DEFAULT_ESCAPE_THRESHOLDS,
} from "../src/experience-escape.js";

const t = DEFAULT_ESCAPE_THRESHOLDS;

test("two-finger swipe right escapes", () => {
  const result = classifyTwoFingerHorizontalEscape(
    [{ x: 100, y: 200 }, { x: 140, y: 210 }],
    [{ x: 220, y: 205 }, { x: 260, y: 215 }],
    300,
    t,
  );
  assert.equal(result, "escape-right");
});

test("two-finger swipe left escapes", () => {
  const result = classifyTwoFingerHorizontalEscape(
    [{ x: 300, y: 200 }, { x: 340, y: 210 }],
    [{ x: 180, y: 205 }, { x: 220, y: 215 }],
    280,
    t,
  );
  assert.equal(result, "escape-left");
});

test("pinch is not escape", () => {
  const result = classifyTwoFingerHorizontalEscape(
    [{ x: 200, y: 180 }, { x: 200, y: 260 }],
    [{ x: 200, y: 100 }, { x: 200, y: 340 }],
    300,
    t,
  );
  assert.equal(result, "pinch");
});

test("tiny movement stays pending", () => {
  const result = classifyTwoFingerHorizontalEscape(
    [{ x: 100, y: 200 }, { x: 140, y: 210 }],
    [{ x: 110, y: 202 }, { x: 150, y: 212 }],
    120,
    t,
  );
  assert.equal(result, "pending");
});

test("opposite horizontal directions are ambiguous", () => {
  const result = classifyTwoFingerHorizontalEscape(
    [{ x: 200, y: 200 }, { x: 240, y: 200 }],
    [{ x: 320, y: 205 }, { x: 120, y: 205 }],
    300,
    t,
  );
  assert.equal(result, "ambiguous");
});
