import test from "node:test";
import assert from "node:assert/strict";
import { classifyTwoFingerSweep } from "../src/nav-labs/recognizers/two-finger-sweep.js";
import { DEFAULT_TWO_FINGER } from "../src/nav-labs/labs-store.js";

const t = DEFAULT_TWO_FINGER;

test("two-finger horizontal right", () => {
  const result = classifyTwoFingerSweep(
    [
      { x: 100, y: 200 },
      { x: 140, y: 210 },
    ],
    [
      { x: 220, y: 205 },
      { x: 260, y: 215 },
    ],
    300,
    t,
  );
  assert.equal(result, "horizontal-right");
});

test("two-finger horizontal left", () => {
  const result = classifyTwoFingerSweep(
    [
      { x: 300, y: 200 },
      { x: 340, y: 210 },
    ],
    [
      { x: 180, y: 205 },
      { x: 220, y: 215 },
    ],
    280,
    t,
  );
  assert.equal(result, "horizontal-left");
});

test("pinch is classified", () => {
  const result = classifyTwoFingerSweep(
    [
      { x: 200, y: 180 },
      { x: 200, y: 260 },
    ],
    [
      { x: 200, y: 100 },
      { x: 200, y: 340 },
    ],
    300,
    t,
  );
  assert.equal(result, "pinch");
});

test("vertical drift is vertical", () => {
  const result = classifyTwoFingerSweep(
    [
      { x: 100, y: 100 },
      { x: 140, y: 100 },
    ],
    [
      { x: 105, y: 220 },
      { x: 145, y: 230 },
    ],
    300,
    t,
  );
  assert.equal(result, "vertical");
});

test("tiny movement stays pending", () => {
  const result = classifyTwoFingerSweep(
    [
      { x: 100, y: 200 },
      { x: 140, y: 210 },
    ],
    [
      { x: 110, y: 202 },
      { x: 150, y: 212 },
    ],
    120,
    t,
  );
  assert.equal(result, "pending");
});

test("opposite horizontal directions are ambiguous", () => {
  const result = classifyTwoFingerSweep(
    [
      { x: 200, y: 200 },
      { x: 240, y: 200 },
    ],
    [
      { x: 320, y: 205 },
      { x: 120, y: 205 },
    ],
    300,
    t,
  );
  assert.equal(result, "ambiguous");
});
