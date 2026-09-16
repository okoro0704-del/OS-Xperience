/**
 * Shared ExperienceMode escape contract.
 * Host container owns two-finger horizontal swipe → Home.
 * Experienced applications never implement this.
 */

export const EXPERIENCE_ESCAPE_EVENT = "ox-experience-escape";
export const EXPERIENCE_ESCAPE_HINT_KEY = "ox.experienceEscapeHint.v1";

export type Point = { x: number; y: number };

export interface EscapeGestureThresholds {
  /** Minimum average horizontal travel in CSS px. */
  minTravelPx: number;
  /** |dy|/|dx| must stay below this for each finger. */
  maxVerticalRatio: number;
  /** Relative change in finger distance above this → treat as pinch. */
  maxPinchChange: number;
  /** Max ms from two-finger down to recognition. */
  maxDurationMs: number;
  /** Fingers must agree on direction (dot product of unit dx). */
  minDirectionAgreement: number;
}

export const DEFAULT_ESCAPE_THRESHOLDS: EscapeGestureThresholds = {
  minTravelPx: 72,
  maxVerticalRatio: 0.55,
  maxPinchChange: 0.2,
  maxDurationMs: 750,
  minDirectionAgreement: 0.65,
};

/** Device-aware thresholds from CSS pixels / viewport. */
export function escapeThresholdsForViewport(
  width = typeof window !== "undefined" ? window.innerWidth : 390,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
): EscapeGestureThresholds {
  const minTravelPx = Math.max(64, Math.min(120, Math.round(width * 0.18)));
  void dpr;
  return { ...DEFAULT_ESCAPE_THRESHOLDS, minTravelPx };
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Classify a completed / in-progress two-finger sample.
 * Both fingers must travel together horizontally; pinch is rejected.
 */
export function classifyTwoFingerHorizontalEscape(
  start: [Point, Point],
  current: [Point, Point],
  elapsedMs: number,
  thresholds: EscapeGestureThresholds = DEFAULT_ESCAPE_THRESHOLDS,
): "escape-left" | "escape-right" | "pinch" | "ambiguous" | "pending" {
  if (elapsedMs > thresholds.maxDurationMs) return "ambiguous";

  const d0 = { x: current[0].x - start[0].x, y: current[0].y - start[0].y };
  const d1 = { x: current[1].x - start[1].x, y: current[1].y - start[1].y };
  const travel0 = Math.hypot(d0.x, d0.y);
  const travel1 = Math.hypot(d1.x, d1.y);
  const avgTravel = (Math.abs(d0.x) + Math.abs(d1.x)) / 2;

  const sign0 = Math.sign(d0.x) || 0;
  const sign1 = Math.sign(d1.x) || 0;
  if (
    avgTravel >= thresholds.minTravelPx * 0.35 &&
    sign0 !== 0 &&
    sign1 !== 0 &&
    sign0 !== sign1
  ) {
    return "ambiguous";
  }

  const startSpan = dist(start[0], start[1]) || 1;
  const currentSpan = dist(current[0], current[1]);
  const pinchChange = Math.abs(currentSpan - startSpan) / startSpan;
  if (pinchChange > thresholds.maxPinchChange && Math.max(travel0, travel1) > thresholds.minTravelPx * 0.35) {
    return "pinch";
  }

  if (avgTravel < thresholds.minTravelPx * 0.35) return "pending";

  const horiz0 = Math.abs(d0.x) >= Math.abs(d0.y) / Math.max(thresholds.maxVerticalRatio, 0.01);
  const horiz1 = Math.abs(d1.x) >= Math.abs(d1.y) / Math.max(thresholds.maxVerticalRatio, 0.01);
  if (!horiz0 || !horiz1) {
    return avgTravel >= thresholds.minTravelPx ? "ambiguous" : "pending";
  }

  if (sign0 === 0 || sign1 === 0 || sign0 !== sign1) {
    return avgTravel >= thresholds.minTravelPx ? "ambiguous" : "pending";
  }

  const n0 = travel0 || 1;
  const n1 = travel1 || 1;
  const agreement = (d0.x / n0) * (d1.x / n1) + (d0.y / n0) * (d1.y / n1);
  if (agreement < thresholds.minDirectionAgreement) {
    return avgTravel >= thresholds.minTravelPx ? "ambiguous" : "pending";
  }

  if (avgTravel < thresholds.minTravelPx) return "pending";
  return sign0 < 0 ? "escape-left" : "escape-right";
}

export function shouldShowExperienceEscapeHint(): boolean {
  try {
    return localStorage.getItem(EXPERIENCE_ESCAPE_HINT_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markExperienceEscapeHintSeen(): void {
  try {
    localStorage.setItem(EXPERIENCE_ESCAPE_HINT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function emitExperienceEscape(): void {
  window.dispatchEvent(new CustomEvent(EXPERIENCE_ESCAPE_EVENT));
}

export function vibrateEscapeFeedback(): void {
  try {
    navigator.vibrate?.(12);
  } catch {
    /* ignore */
  }
}

/**
 * Attach two-finger horizontal escape recognition to a host element.
 * Does not greedily preventDefault until escape is classified.
 */
export function attachTwoFingerHorizontalEscape(
  target: HTMLElement,
  onEscape: () => void,
  thresholds: EscapeGestureThresholds = escapeThresholdsForViewport(),
): () => void {
  let start: [Point, Point] | null = null;
  let startedAt = 0;
  let active = false;
  let recognized = false;
  const pointers = new Map<number, Point>();

  const sample = (): [Point, Point] | null => {
    if (pointers.size !== 2) return null;
    const pts = [...pointers.values()];
    return [pts[0]!, pts[1]!];
  };

  const reset = () => {
    active = false;
    recognized = false;
    start = null;
    startedAt = 0;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary && event.pointerType === "mouse") return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const pts = sample();
      if (!pts) return;
      active = true;
      recognized = false;
      start = pts;
      startedAt = performance.now();
    } else {
      active = false;
      start = null;
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!active || !start || recognized || pointers.size !== 2) return;
    const current = sample();
    if (!current) return;
    const result = classifyTwoFingerHorizontalEscape(start, current, performance.now() - startedAt, thresholds);
    if (result === "escape-left" || result === "escape-right") {
      recognized = true;
      vibrateEscapeFeedback();
      try {
        event.preventDefault();
      } catch {
        /* ignore */
      }
      onEscape();
      reset();
      pointers.clear();
    } else if (result === "pinch" || result === "ambiguous") {
      reset();
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) reset();
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove, { passive: false });
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("lostpointercapture", onPointerUp);

  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("pointercancel", onPointerUp);
    target.removeEventListener("lostpointercapture", onPointerUp);
    pointers.clear();
    reset();
  };
}
