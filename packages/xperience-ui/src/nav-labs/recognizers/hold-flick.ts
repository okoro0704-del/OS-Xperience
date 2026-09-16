import type { HoldFlickConfig, Point } from "../types.js";
import { DEFAULT_HOLD_FLICK } from "../labs-store.js";

export interface HoldFlickHandlers {
  onHold: () => void;
  onProgress: (progress: number, direction: "left" | "right" | null) => void;
  onCommit: (direction: "left" | "right") => void;
  onCancel: () => void;
  config?: Partial<HoldFlickConfig>;
}

/** Pure: whether hold should cancel due to movement. */
export function shouldCancelHold(origin: Point, current: Point, cancelPx: number): boolean {
  return Math.hypot(current.x - origin.x, current.y - origin.y) > cancelPx;
}

/** Pure flick progress 0–1 and direction once held. */
export function classifyHoldFlick(
  origin: Point,
  current: Point,
  config: HoldFlickConfig,
): { progress: number; direction: "left" | "right" | null; commit: boolean } {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx < 8) {
    return { progress: 0, direction: null, commit: false };
  }
  if (absDy > absDx * config.maxVerticalRatio) {
    return { progress: Math.min(1, absDx / config.flickMinPx), direction: null, commit: false };
  }
  const direction: "left" | "right" = dx < 0 ? "left" : "right";
  const progress = Math.min(1, absDx / config.flickMinPx);
  return { progress, direction, commit: progress >= 1 };
}

export function attachHoldFlick(host: HTMLElement, handlers: HoldFlickHandlers): () => void {
  const config: HoldFlickConfig = { ...DEFAULT_HOLD_FLICK, ...handlers.config };

  let pointerId: number | null = null;
  let origin: Point | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let flickOrigin: Point | null = null;

  const clearHoldTimer = () => {
    if (holdTimer != null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const reset = (cancel = false) => {
    clearHoldTimer();
    if (cancel && (held || pointerId != null)) handlers.onCancel();
    pointerId = null;
    origin = null;
    held = false;
    flickOrigin = null;
  };

  const onDown = (event: PointerEvent) => {
    if (pointerId != null) return;
    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    held = false;
    flickOrigin = null;
    clearHoldTimer();
    holdTimer = setTimeout(() => {
      if (pointerId == null || !origin) return;
      held = true;
      flickOrigin = { ...origin };
      handlers.onHold();
    }, config.holdMs);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || !origin) return;
    const cur: Point = { x: event.clientX, y: event.clientY };

    if (!held) {
      if (shouldCancelHold(origin, cur, config.holdCancelPx)) {
        reset(true);
      }
      return;
    }

    const base = flickOrigin ?? origin;
    const result = classifyHoldFlick(base, cur, config);
    handlers.onProgress(result.progress, result.direction);
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || !origin) {
      if (event.pointerId === pointerId) reset(false);
      return;
    }
    const cur: Point = { x: event.clientX, y: event.clientY };
    if (!held) {
      reset(true);
      return;
    }
    const result = classifyHoldFlick(flickOrigin ?? origin, cur, config);
    const direction = result.direction;
    const commit = result.commit;
    reset(false);
    if (commit && direction) handlers.onCommit(direction);
    else handlers.onCancel();
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
    clearHoldTimer();
    pointerId = null;
    origin = null;
    held = false;
    flickOrigin = null;
  };
}
