import type { EdgePullConfig, Point } from "../types.js";
import { DEFAULT_EDGE_PULL } from "../labs-store.js";
import { computeEdgeProgress, shouldCommitEdgePull } from "../transition.js";

export type EdgeSide = "left" | "right" | "both";

export interface EdgePullHandlers {
  onProgress: (progress: number, side: "left" | "right", delta: Point) => void;
  onCancel: () => void;
  onCommit: (side: "left" | "right") => void;
  config?: Partial<EdgePullConfig>;
  side?: EdgeSide;
}

export function resolveCommitThresholdPx(hostWidth: number, config: EdgePullConfig): number {
  if (config.commitThresholdPx != null && config.commitThresholdPx > 0) {
    return config.commitThresholdPx;
  }
  return Math.max(48, hostWidth * config.commitThresholdRatio);
}

/** Create absolute edge hit zones; returns cleanup. */
export function createEdgeZones(
  host: HTMLElement,
  side: EdgeSide = "both",
  edgeWidthPx = 24,
): () => void {
  const style = getComputedStyle(host);
  if (style.position === "static") {
    host.style.position = "relative";
  }

  const zones: HTMLElement[] = [];
  const make = (edge: "left" | "right") => {
    const el = document.createElement("div");
    el.className = "ox-nav-edge-zone";
    el.dataset.edge = edge;
    el.setAttribute("aria-hidden", "true");
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.bottom = "0";
    el.style.width = `${edgeWidthPx}px`;
    el.style.zIndex = "40";
    el.style.touchAction = "none";
    el.style.pointerEvents = "auto";
    if (edge === "left") el.style.left = "0";
    else el.style.right = "0";
    host.appendChild(el);
    zones.push(el);
  };

  if (side === "left" || side === "both") make("left");
  if (side === "right" || side === "both") make("right");

  return () => {
    for (const z of zones) z.remove();
  };
}

function edgeFromTarget(target: EventTarget | null, host: HTMLElement): "left" | "right" | null {
  const el = target instanceof Element ? target.closest(".ox-nav-edge-zone") : null;
  if (el instanceof HTMLElement) {
    const e = el.dataset.edge;
    if (e === "left" || e === "right") return e;
  }
  void host;
  return null;
}

function detectEdgeStart(host: HTMLElement, x: number, side: EdgeSide, edgeWidthPx: number): "left" | "right" | null {
  const rect = host.getBoundingClientRect();
  const localX = x - rect.left;
  if ((side === "left" || side === "both") && localX <= edgeWidthPx) return "left";
  if ((side === "right" || side === "both") && localX >= rect.width - edgeWidthPx) return "right";
  return null;
}

export function attachEdgePull(host: HTMLElement, handlers: EdgePullHandlers): () => void {
  const config: EdgePullConfig = { ...DEFAULT_EDGE_PULL, ...handlers.config };
  const side: EdgeSide = handlers.side ?? "both";
  const removeZones = createEdgeZones(host, side, config.edgeWidthPx);

  let activeId: number | null = null;
  let activeSide: "left" | "right" | null = null;
  let origin: Point | null = null;
  let last: Point | null = null;
  let lastAt = 0;
  let velocity = 0;

  const reset = () => {
    activeId = null;
    activeSide = null;
    origin = null;
    last = null;
    lastAt = 0;
    velocity = 0;
  };

  const onDown = (event: PointerEvent) => {
    if (activeId != null) return;
    let edge = edgeFromTarget(event.target, host);
    if (!edge) edge = detectEdgeStart(host, event.clientX, side, config.edgeWidthPx);
    if (!edge) return;
    if (side !== "both" && side !== edge) return;

    activeId = event.pointerId;
    activeSide = edge;
    origin = { x: event.clientX, y: event.clientY };
    last = origin;
    lastAt = performance.now();
    velocity = 0;
    try {
      (event.target as Element)?.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== activeId || !origin || !activeSide) return;
    const now = performance.now();
    const cur: Point = { x: event.clientX, y: event.clientY };
    const dt = Math.max(1, now - (lastAt || now));
    if (last) {
      velocity = Math.abs(cur.x - last.x) / dt;
    }
    last = cur;
    lastAt = now;

    const rawDx = cur.x - origin.x;
    const distance =
      activeSide === "left" ? Math.max(0, rawDx) : Math.max(0, -rawDx);
    const threshold = resolveCommitThresholdPx(host.getBoundingClientRect().width, config);
    const progress = computeEdgeProgress(distance, threshold);
    handlers.onProgress(progress, activeSide, { x: rawDx, y: cur.y - origin.y });
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== activeId || !origin || !activeSide) {
      if (event.pointerId === activeId) reset();
      return;
    }
    const cur: Point = { x: event.clientX, y: event.clientY };
    const rawDx = cur.x - origin.x;
    const distance =
      activeSide === "left" ? Math.max(0, rawDx) : Math.max(0, -rawDx);
    const threshold = resolveCommitThresholdPx(host.getBoundingClientRect().width, config);
    const progress = computeEdgeProgress(distance, threshold);
    const commit = shouldCommitEdgePull(
      progress,
      velocity,
      config.velocityAssistProgress,
      config.velocityAssistPxPerMs,
    );
    const committedSide = activeSide;
    reset();
    if (commit) handlers.onCommit(committedSide);
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
    removeZones();
    reset();
  };
}
