export interface ExperienceTransform {
  x?: number;
  y?: number;
  scale?: number;
  /** 0–1 progress; used for opacity / optional intensity. */
  progress?: number;
}

const TRANSFORM_PROP = "--ox-nav-labs-transform";
const PROGRESS_PROP = "--ox-nav-labs-progress";

export function applyExperienceTransform(
  el: HTMLElement,
  opts: ExperienceTransform,
): void {
  const x = opts.x ?? 0;
  const y = opts.y ?? 0;
  const scale = opts.scale ?? 1;
  const progress = opts.progress ?? 0;
  el.style.setProperty(TRANSFORM_PROP, `translate3d(${x}px, ${y}px, 0) scale(${scale})`);
  el.style.setProperty(PROGRESS_PROP, String(progress));
  el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  el.style.willChange = "transform";
}

export function clearExperienceTransform(el: HTMLElement): void {
  el.style.removeProperty(TRANSFORM_PROP);
  el.style.removeProperty(PROGRESS_PROP);
  el.style.transform = "";
  el.style.willChange = "";
}

/** Progress 0–1 from drag distance and commit threshold (px). */
export function computeEdgeProgress(distance: number, threshold: number): number {
  if (threshold <= 0) return distance > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, distance / threshold));
}

/** Commit when progress >= 1, or velocity-assisted at mid progress. */
export function shouldCommitEdgePull(
  progress: number,
  velocityPxPerMs: number,
  assistProgress = 0.55,
  assistVelocity = 0.85,
): boolean {
  if (progress >= 1) return true;
  return progress >= assistProgress && velocityPxPerMs >= assistVelocity;
}
