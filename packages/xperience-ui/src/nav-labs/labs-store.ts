import type {
  ExperimentId,
  LabsConfig,
  LabEvent,
  TestSession,
  EdgePullConfig,
  TwoFingerConfig,
  HoldFlickConfig,
  CornerPullConfig,
  AirSwipeConfig,
} from "./types.js";

export const NAV_LABS_ENABLED_KEY = "ox.navLabs.enabled";
export const NAV_LABS_ACTIVE_KEY = "ox.navLabs.activeExperiment";
export const NAV_LABS_DIAGNOSTICS_KEY = "ox.navLabs.diagnosticsOn";
export const NAV_LABS_CONFIG_KEY = "ox.navLabs.config";
export const NAV_LABS_SESSIONS_KEY = "ox.navLabs.testSessions";
export const NAV_LABS_EVENTS_KEY = "ox.navLabs.events";

export const DEFAULT_EDGE_PULL: EdgePullConfig = {
  edgeWidthPx: 24,
  commitThresholdRatio: 0.35,
  velocityAssistProgress: 0.55,
  velocityAssistPxPerMs: 0.85,
};

export const DEFAULT_TWO_FINGER: TwoFingerConfig = {
  minDistance: 72,
  minVelocity: 0.35,
  maxVerticalDrift: 0.55,
  maxPinchChange: 0.2,
  maxDurationMs: 750,
};

export const DEFAULT_HOLD_FLICK: HoldFlickConfig = {
  holdMs: 420,
  holdCancelPx: 12,
  flickMinPx: 64,
  maxVerticalRatio: 0.55,
};

export const DEFAULT_CORNER_PULL: CornerPullConfig = {
  zoneSizePx: 56,
  commitThresholdPx: 96,
  velocityAssistProgress: 0.55,
  velocityAssistPxPerMs: 0.85,
};

export const DEFAULT_AIR_SWIPE: AirSwipeConfig = {
  minDx: 0.14,
  minVelocity: 0.45,
  sampleWindowMs: 420,
};

export const DEFAULT_LABS_CONFIG: LabsConfig = {
  edgePull: DEFAULT_EDGE_PULL,
  twoFinger: DEFAULT_TWO_FINGER,
  holdFlick: DEFAULT_HOLD_FLICK,
  cornerPull: DEFAULT_CORNER_PULL,
  airSwipe: DEFAULT_AIR_SWIPE,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (Array.isArray(parsed) || Array.isArray(fallback)) return parsed;
    if (parsed && typeof parsed === "object" && fallback && typeof fallback === "object") {
      return { ...(fallback as object), ...(parsed as object) } as T;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function isNavLabsEnabled(): boolean {
  try {
    return localStorage.getItem(NAV_LABS_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNavLabsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NAV_LABS_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isLabsDiagnosticsOn(): boolean {
  try {
    return localStorage.getItem(NAV_LABS_DIAGNOSTICS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLabsDiagnosticsOn(on: boolean): void {
  try {
    localStorage.setItem(NAV_LABS_DIAGNOSTICS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function getActiveExperiment(): ExperimentId | null {
  try {
    const v = localStorage.getItem(NAV_LABS_ACTIVE_KEY);
    if (
      v === "edge-pull" ||
      v === "two-finger-sweep" ||
      v === "hold-flick" ||
      v === "corner-pull" ||
      v === "air-swipe" ||
      v === "palm-fist-throw"
    ) {
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setActiveExperiment(id: ExperimentId | null): void {
  try {
    if (!id) localStorage.removeItem(NAV_LABS_ACTIVE_KEY);
    else localStorage.setItem(NAV_LABS_ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getLabsConfig(): LabsConfig {
  const stored = readJson<Partial<LabsConfig>>(NAV_LABS_CONFIG_KEY, {});
  return {
    edgePull: { ...DEFAULT_EDGE_PULL, ...stored.edgePull },
    twoFinger: { ...DEFAULT_TWO_FINGER, ...stored.twoFinger },
    holdFlick: { ...DEFAULT_HOLD_FLICK, ...stored.holdFlick },
    cornerPull: { ...DEFAULT_CORNER_PULL, ...stored.cornerPull },
    airSwipe: { ...DEFAULT_AIR_SWIPE, ...stored.airSwipe },
  };
}

export function updateLabsConfig(patch: Partial<LabsConfig>): LabsConfig {
  const base = getLabsConfig();
  const merged: LabsConfig = {
    edgePull: { ...base.edgePull, ...patch.edgePull },
    twoFinger: { ...base.twoFinger, ...patch.twoFinger },
    holdFlick: { ...base.holdFlick, ...patch.holdFlick },
    cornerPull: { ...base.cornerPull, ...patch.cornerPull },
    airSwipe: { ...base.airSwipe, ...patch.airSwipe },
  };
  writeJson(NAV_LABS_CONFIG_KEY, merged);
  return merged;
}

function sessionsMap(): Record<string, TestSession> {
  return readJson<Record<string, TestSession>>(NAV_LABS_SESSIONS_KEY, {});
}

export function getTestSession(experiment: ExperimentId): TestSession {
  const map = sessionsMap();
  return (
    map[experiment] ?? {
      experiment,
      attempts: 0,
      recognized: 0,
      failed: 0,
      accidentalExits: 0,
    }
  );
}

export function updateTestSession(experiment: ExperimentId, patch: Partial<Omit<TestSession, "experiment">>): TestSession {
  const map = sessionsMap();
  const next: TestSession = { ...getTestSession(experiment), ...patch, experiment };
  map[experiment] = next;
  writeJson(NAV_LABS_SESSIONS_KEY, map);
  return next;
}

export function resetTestSession(experiment: ExperimentId): void {
  const map = sessionsMap();
  delete map[experiment];
  writeJson(NAV_LABS_SESSIONS_KEY, map);
}

/** Persist events list (also used by labs-log). Prefer appendLabEvent from labs-log. */
export function appendLabEvent(event: LabEvent): void {
  try {
    const list = readJson<LabEvent[]>(NAV_LABS_EVENTS_KEY, []);
    list.push(event);
    while (list.length > 200) list.shift();
    writeJson(NAV_LABS_EVENTS_KEY, list);
    try {
      sessionStorage.setItem(NAV_LABS_EVENTS_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}

export function getLabEvents(): LabEvent[] {
  try {
    const session = sessionStorage.getItem(NAV_LABS_EVENTS_KEY);
    if (session) return JSON.parse(session) as LabEvent[];
  } catch {
    /* ignore */
  }
  return readJson<LabEvent[]>(NAV_LABS_EVENTS_KEY, []);
}

export function clearLabEvents(): void {
  try {
    localStorage.removeItem(NAV_LABS_EVENTS_KEY);
    sessionStorage.removeItem(NAV_LABS_EVENTS_KEY);
  } catch {
    /* ignore */
  }
}
