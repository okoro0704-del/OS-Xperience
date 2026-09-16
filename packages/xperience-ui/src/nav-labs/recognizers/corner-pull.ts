import type { CornerPullConfig, Point } from "../types.js";
import { DEFAULT_CORNER_PULL } from "../labs-store.js";
import { computeEdgeProgress, shouldCommitEdgePull } from "../transition.js";

export type CornerId = "br" | "bl" | "tr" | "tl";

export interface CornerPullHandlers {
  corner: CornerId;
  onProgress: (progress: number) => void;
  onCancel: () => void;
  onCommit: () => void;
  config?: Partial<CornerPullConfig>;
}

/** Inward diagonal distance from a corner toward host center. */
export function computeCornerInwardDistance(
  corner: CornerId,
  origin: Point,
  current: Point,
): number {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  // Positive inward components only
  const ix =
    corner === "bl" || corner === "tl" ? Math.max(0, dx) : Math.max(0, -dx);
  const iy =
    corner === "tr" || corner === "tl" ? Math.max(0, dy) : Math.max(0, -dy);
  // Diagonal inward = geometric mean / projection along 45°
  return Math.min(ix, iy) > 0 ? Math.hypot(ix, iy) : Math.max(ix, iy) * 0.5;
}

export function createCornerZone(
  host: HTMLElement,
  corner: CornerId,
  sizePx: number,
): () => void {
  const style = getComputedStyle(host);
  if (style.position === "static") host.style.position = "relative";

  const el = document.createElement("div");
  el.className = "ox-nav-corner-zone";
  el.dataset.corner = corner;
  el.setAttribute("aria-hidden", "true");
  const pos: Record<string, string> = {
    position: "absolute",
    width: `${sizePx}px`,
    height: `${sizePx}px`,
    zIndex: "40",
    touchAction: "none",
    pointerEvents: "auto",
  };
  if (corner.includes("b")) pos.bottom = "0";
  else pos.top = "0";
  if (corner.includes("r")) pos.right = "0";
  else pos.left = "0";
  Object.assign(el.style, pos);
  host.appendChild(el);

  return () => el.remove();
}

export function attachCornerPull(host: HTMLElement, handlers: CornerPullHandlers): () => void {
  const config: CornerPullConfig = { ...DEFAULT_CORNER_PULL, ...handlers.config };
  const removeZone = createCornerZone(host, handlers.corner, config.zoneSizePx);

  let activeId: number | null = null;
  let origin: Point | null = null;
  let last: Point | null = null;
  let lastAt = 0;
  let velocity = 0;

  const reset = () => {
    activeId = null;
    origin = null;
    last = null;
    lastAt = 0;
    velocity = 0;
  };

  const inZone = (target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest(".ox-nav-corner-zone") : null;
    return el instanceof HTMLElement && el.dataset.corner === handlers.corner;
  };

  const onDown = (event: PointerEvent) => {
    if (activeId != null || !inZone(event.target)) return;
    activeId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    last = origin;
    lastAt = performance.now();
    velocity = 0;
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== activeId || !origin) return;
    const now = performance.now();
    const cur: Point = { x: event.clientX, y: event.clientY };
    if (last) {
      const dist = Math.hypot(cur.x - last.x, cur.y - last.y);
      velocity = dist / Math.max(1, now - lastAt);
    }
    last = cur;
    lastAt = now;
    const distance = computeCornerInwardDistance(handlers.corner, origin, cur);
    const progress = computeEdgeProgress(distance, config.commitThresholdPx);
    handlers.onProgress(progress);
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== activeId || !origin) {
      if (event.pointerId === activeId) reset();
      return;
    }
    const cur: Point = { x: event.clientX, y: event.clientY };
    const distance = computeCornerInwardDistance(handlers.corner, origin, cur);
    const progress = computeEdgeProgress(distance, config.commitThresholdPx);
    const commit = shouldCommitEdgePull(
      progress,
      velocity,
      config.velocityAssistProgress,
      config.velocityAssistPxPerMs,
    );
    reset();
    if (commit) handlers.onCommit();
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
    removeZone();
    reset();
  };
}
