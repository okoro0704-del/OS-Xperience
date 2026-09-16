/** Navigation Labs experiment identifiers. */
export type ExperimentId =
  | "edge-pull"
  | "two-finger-sweep"
  | "hold-flick"
  | "corner-pull"
  | "air-swipe"
  | "palm-fist-throw";

export type Point = { x: number; y: number };

/** Build stamp for HUD / diagnostics (not a secret). */
export const NAV_LABS_BUILD_ID = "NAV-LABS-20260916-v1";

export type AirSwipeState =
  | "disabled"
  | "starting"
  | "ready"
  | "no_hand"
  | "tracking"
  | "recognized"
  | "error"
  | "denied"
  | "conflict";

export interface NavLabsHud {
  experiment: ExperimentId | null;
  state: string;
  progress?: number;
  detail?: string;
  buildId?: string;
}

export interface LabEvent {
  type: string;
  experiment: ExperimentId | null;
  detail?: string;
  at: number;
}

/** Human-entered ratings only — never auto-filled from sensors. */
export interface TestSession {
  experiment: ExperimentId;
  attempts: number;
  recognized: number;
  failed: number;
  accidentalExits: number;
  effort?: number;
  naturalness?: number;
  memorability?: number;
  delight?: number;
  comments?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface EdgePullConfig {
  /** Edge hit zone width in CSS px. Default 24. */
  edgeWidthPx: number;
  /** Drag distance (px) / (commitThreshold * hostWidth) → progress. Default 0.35. */
  commitThresholdRatio: number;
  /** Absolute px override for commit distance; if set, wins over ratio. */
  commitThresholdPx?: number;
  /** Progress floor for velocity-assisted commit. Default 0.55. */
  velocityAssistProgress: number;
  /** Min release velocity (px/ms) for assist. Default 0.85. */
  velocityAssistPxPerMs: number;
}

export interface TwoFingerConfig {
  minDistance: number;
  minVelocity: number;
  maxVerticalDrift: number;
  maxPinchChange: number;
  maxDurationMs: number;
}

export interface HoldFlickConfig {
  holdMs: number;
  /** Cancel hold if pointer moves more than this during arming. Default 12. */
  holdCancelPx: number;
  /** Min horizontal flick travel after hold. */
  flickMinPx: number;
  /** Max |dy|/|dx| for flick. */
  maxVerticalRatio: number;
}

export interface CornerPullConfig {
  zoneSizePx: number;
  commitThresholdPx: number;
  velocityAssistProgress: number;
  velocityAssistPxPerMs: number;
}

export interface AirSwipeConfig {
  minDx: number;
  minVelocity: number;
  sampleWindowMs: number;
}

export interface LabsConfig {
  edgePull: EdgePullConfig;
  twoFinger: TwoFingerConfig;
  holdFlick: HoldFlickConfig;
  cornerPull: CornerPullConfig;
  airSwipe: AirSwipeConfig;
}
