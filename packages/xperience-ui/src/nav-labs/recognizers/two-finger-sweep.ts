import type { Point, TwoFingerConfig } from "../types.js";
import { DEFAULT_TWO_FINGER } from "../labs-store.js";

export type TwoFingerClass =
  | "horizontal-left"
  | "horizontal-right"
  | "vertical"
  | "pinch"
  | "ambiguous"
  | "pending";

export interface TwoFingerHud {
  class: TwoFingerClass;
  avgDx: number;
  avgDy: number;
  pinchChange: number;
  velocity: number;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pure classifier for two-finger motion (horizontal sweep vs pinch vs vertical).
 */
export function classifyTwoFingerSweep(
  start: [Point, Point],
  current: [Point, Point],
  elapsedMs: number,
  config: TwoFingerConfig = DEFAULT_TWO_FINGER,
  velocity = 0,
): TwoFingerClass {
  if (elapsedMs > config.maxDurationMs) return "ambiguous";

  const d0 = { x: current[0].x - start[0].x, y: current[0].y - start[0].y };
  const d1 = { x: current[1].x - start[1].x, y: current[1].y - start[1].y };
  const avgAbsDx = (Math.abs(d0.x) + Math.abs(d1.x)) / 2;
  const avgAbsDy = (Math.abs(d0.y) + Math.abs(d1.y)) / 2;
  const sign0 = Math.sign(d0.x) || 0;
  const sign1 = Math.sign(d1.x) || 0;

  if (
    avgAbsDx >= config.minDistance * 0.35 &&
    sign0 !== 0 &&
    sign1 !== 0 &&
    sign0 !== sign1
  ) {
    return "ambiguous";
  }

  const startSpan = dist(start[0], start[1]) || 1;
  const pinchChange = Math.abs(dist(current[0], current[1]) - startSpan) / startSpan;
  if (pinchChange > config.maxPinchChange && Math.max(avgAbsDx, avgAbsDy) > config.minDistance * 0.35) {
    return "pinch";
  }

  if (avgAbsDx < config.minDistance * 0.35 && avgAbsDy < config.minDistance * 0.35) {
    return "pending";
  }

  if (avgAbsDy > avgAbsDx * config.maxVerticalDrift && avgAbsDy >= config.minDistance * 0.5) {
    return "vertical";
  }

  const horizOk =
    Math.abs(d0.x) >= Math.abs(d0.y) / Math.max(config.maxVerticalDrift, 0.01) &&
    Math.abs(d1.x) >= Math.abs(d1.y) / Math.max(config.maxVerticalDrift, 0.01);

  if (!horizOk) {
    return avgAbsDx >= config.minDistance || avgAbsDy >= config.minDistance ? "ambiguous" : "pending";
  }

  if (avgAbsDx < config.minDistance) return "pending";

  if (velocity > 0 && velocity < config.minVelocity && avgAbsDx < config.minDistance * 1.25) {
    return "pending";
  }

  const avgDx = (d0.x + d1.x) / 2;
  return avgDx < 0 ? "horizontal-left" : "horizontal-right";
}

export function attachTwoFingerSweep(
  host: HTMLElement,
  options: {
    onHud: (hud: TwoFingerHud) => void;
    onCommit: (direction: "left" | "right") => void;
    config?: Partial<TwoFingerConfig>;
  },
): () => void {
  const config: TwoFingerConfig = { ...DEFAULT_TWO_FINGER, ...options.config };
  const pointers = new Map<number, Point>();
  let start: [Point, Point] | null = null;
  let startedAt = 0;
  let lastAvg: Point | null = null;
  let lastAt = 0;
  let recognized = false;

  const sample = (): [Point, Point] | null => {
    if (pointers.size !== 2) return null;
    const pts = [...pointers.values()];
    return [pts[0]!, pts[1]!];
  };

  const reset = () => {
    start = null;
    startedAt = 0;
    lastAvg = null;
    lastAt = 0;
    recognized = false;
  };

  const onDown = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const pts = sample();
      if (!pts) return;
      start = pts;
      startedAt = performance.now();
      lastAvg = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      lastAt = startedAt;
      recognized = false;
    } else {
      reset();
    }
  };

  const onMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!start || recognized || pointers.size !== 2) return;
    const current = sample();
    if (!current) return;

    const now = performance.now();
    const avg = {
      x: (current[0].x + current[1].x) / 2,
      y: (current[0].y + current[1].y) / 2,
    };
    const dt = Math.max(1, now - (lastAt || now)) / 1000;
    const velocity = lastAvg ? Math.hypot(avg.x - lastAvg.x, avg.y - lastAvg.y) / dt / 1000 : 0;
    // velocity in "distance units / ms scaled": use px/ms for minVelocity compare
    const velocityPxPerMs = lastAvg
      ? Math.hypot(avg.x - lastAvg.x, avg.y - lastAvg.y) / Math.max(1, now - lastAt)
      : 0;
    lastAvg = avg;
    lastAt = now;

    const d0 = { x: current[0].x - start[0].x, y: current[0].y - start[0].y };
    const d1 = { x: current[1].x - start[1].x, y: current[1].y - start[1].y };
    const startSpan = dist(start[0], start[1]) || 1;
    const pinchChange = Math.abs(dist(current[0], current[1]) - startSpan) / startSpan;
    const cls = classifyTwoFingerSweep(start, current, now - startedAt, config, velocityPxPerMs);

    options.onHud({
      class: cls,
      avgDx: (d0.x + d1.x) / 2,
      avgDy: (d0.y + d1.y) / 2,
      pinchChange,
      velocity: velocityPxPerMs,
    });

    if (cls === "horizontal-left" || cls === "horizontal-right") {
      if (velocityPxPerMs >= config.minVelocity || Math.abs((d0.x + d1.x) / 2) >= config.minDistance) {
        recognized = true;
        options.onCommit(cls === "horizontal-left" ? "left" : "right");
        pointers.clear();
        reset();
      }
    } else if (cls === "pinch" || cls === "ambiguous" || cls === "vertical") {
      reset();
    }
    void velocity;
  };

  const onUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) reset();
  };

  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove, { passive: true });
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);

  return () => {
    host.removeEventListener("pointerdown", onDown);
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointercancel", onUp);
    pointers.clear();
    reset();
  };
}
