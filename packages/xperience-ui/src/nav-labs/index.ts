export type {
  ExperimentId,
  Point,
  NavLabsHud,
  LabEvent,
  TestSession,
  EdgePullConfig,
  TwoFingerConfig,
  HoldFlickConfig,
  CornerPullConfig,
  AirSwipeConfig,
  AirSwipeState,
  LabsConfig,
} from "./types.js";
export { NAV_LABS_BUILD_ID } from "./types.js";

export {
  NAV_LABS_ENABLED_KEY,
  NAV_LABS_ACTIVE_KEY,
  NAV_LABS_DIAGNOSTICS_KEY,
  NAV_LABS_CONFIG_KEY,
  NAV_LABS_SESSIONS_KEY,
  NAV_LABS_EVENTS_KEY,
  DEFAULT_LABS_CONFIG,
  DEFAULT_EDGE_PULL,
  DEFAULT_TWO_FINGER,
  DEFAULT_HOLD_FLICK,
  DEFAULT_CORNER_PULL,
  DEFAULT_AIR_SWIPE,
  isNavLabsEnabled,
  setNavLabsEnabled,
  isLabsDiagnosticsOn,
  setLabsDiagnosticsOn,
  getActiveExperiment,
  setActiveExperiment,
  getLabsConfig,
  updateLabsConfig,
  getTestSession,
  updateTestSession,
  resetTestSession,
} from "./labs-store.js";

export { appendLabEvent, getLabEvents, clearLabEvents } from "./labs-log.js";

export {
  applyExperienceTransform,
  clearExperienceTransform,
  computeEdgeProgress,
  shouldCommitEdgePull,
} from "./transition.js";

export {
  attachEdgePull,
  createEdgeZones,
  resolveCommitThresholdPx,
} from "./recognizers/edge-pull.js";
export type { EdgeSide, EdgePullHandlers } from "./recognizers/edge-pull.js";

export {
  attachTwoFingerSweep,
  classifyTwoFingerSweep,
} from "./recognizers/two-finger-sweep.js";
export type { TwoFingerClass, TwoFingerHud } from "./recognizers/two-finger-sweep.js";

export {
  attachHoldFlick,
  shouldCancelHold,
  classifyHoldFlick,
} from "./recognizers/hold-flick.js";

export {
  attachCornerPull,
  createCornerZone,
  computeCornerInwardDistance,
} from "./recognizers/corner-pull.js";
export type { CornerId } from "./recognizers/corner-pull.js";

export { startAirSwipe, classifyAirSwipe } from "./recognizers/air-swipe.js";
export type { AirSwipeHud, AirSwipeController } from "./recognizers/air-swipe.js";

export { attachNavLabsController } from "./controller.js";
export type { NavLabsControllerOptions } from "./controller.js";
