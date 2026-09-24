export { ExperienceApp } from "./ExperienceApp.js";
export type { ExperienceAppProps } from "./ExperienceApp.js";
export {
  EXPERIENCE_ESCAPE_EVENT,
  EXPERIENCE_ESCAPE_HINT_KEY,
  attachTwoFingerHorizontalEscape,
  classifyTwoFingerHorizontalEscape,
  escapeThresholdsForViewport,
  emitExperienceEscape,
} from "./experience-escape.js";
export type { EscapeGestureThresholds, Point } from "./experience-escape.js";
export {
  AIR_NAV_DEBUG_KEY,
  AIR_NAV_ENABLED_KEY,
  classifyHandPose,
  isAirNavigationDebug,
  isAirNavigationEnabled,
  setAirNavigationEnabled,
  startAirNavigation,
} from "./air-navigation.js";
export type { AirNavDebugSnapshot, AirNavState } from "./air-navigation.js";
export {
  SYSTEM_INSETS_EVENT,
  applySharedSystemInsets,
  detectOxPlatformId,
} from "./platform-contract.js";
export type {
  ExperienceEscapeDetail,
  OxPlatformId,
  PlatformAdapterCapabilities,
  SystemInsets,
} from "./platform-contract.js";
export {
  NAV_LABS_BUILD_ID,
  DEFAULT_LABS_CONFIG,
  isNavLabsEnabled,
  setNavLabsEnabled,
  getActiveExperiment,
  setActiveExperiment,
  getLabsConfig,
  updateLabsConfig,
  getTestSession,
  updateTestSession,
  resetTestSession,
  appendLabEvent,
  getLabEvents,
  clearLabEvents,
  applyExperienceTransform,
  clearExperienceTransform,
  computeEdgeProgress,
  shouldCommitEdgePull,
  attachEdgePull,
  createEdgeZones,
  attachTwoFingerSweep,
  classifyTwoFingerSweep,
  attachHoldFlick,
  attachCornerPull,
  startAirSwipe,
  classifyAirSwipe,
  attachNavLabsController,
} from "./nav-labs/index.js";
export type {
  ExperimentId,
  NavLabsHud,
  LabEvent,
  TestSession,
  LabsConfig,
  EdgePullConfig,
  TwoFingerConfig,
  HoldFlickConfig,
  CornerPullConfig,
  AirSwipeConfig,
  AirSwipeState,
  NavLabsControllerOptions,
} from "./nav-labs/index.js";

export {
  MYBRANDOS_PUBLIC_ENTRY,
  MYBRANDOS_PUBLIC_ID,
  applyOnlineDirectory,
  assertSafeRestoreState,
  bootFromLocal,
  buildLineup,
  buildLocalOpenPayload,
  canClaimAuthenticatedWithoutTrustId,
  canOperateOffline,
  clearMemoryKvStore,
  ensureInstallation,
  enterXperienceMode,
  leaveXperienceMode,
  memoryKvStore,
  nextExperienceId,
  planSwitch,
  previousExperienceId,
  probeExperienceUrl,
  readInstallation,
  readLastExperience,
  readRuntimeMode,
  rememberOpenedExperience,
  sessionsAreIsolated,
  setKvStoreForTests,
  shellAuthPosture,
  shouldRemountExperience,
  switchingPreservesAuthIsolation,
  touchExperienceSlot,
  writeRuntimeMode,
} from "./local/index.js";
export type { XperienceBootResult, ShellAuthPosture, KvStore, LineupEntry, SwitchPlan } from "./local/index.js";
export { ExperienceSwitcher, attachDoubleTap, classifyDoubleTap } from "./switcher/index.js";
