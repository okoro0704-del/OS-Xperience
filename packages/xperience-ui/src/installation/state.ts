import type { SpaceReadiness } from "../local/xperience-browsers.js";
import { routeTargetLaunch } from "./launch.js";
import type { InstalledTarget } from "./registry.js";

/**
 * How this runtime was entered. Decided BEFORE the first render, from the launch request alone:
 *
 *   XPERIENCE_NORMAL — the OS Xperience icon or web address → OS Xperience Home.
 *   DIRECT_APP       — an installed App entry → the App is the visible root.
 *   DIRECT_SPACE     — an installed Space entry → the Space is the visible root.
 *   DIRECT_INVALID   — an entry that names no valid target → a target recovery screen, never Home.
 *
 * In every DIRECT mode OS Xperience is the hidden runtime: Home, Directory, navigation and
 * branding never mount, and leaving the target returns to the operating system.
 */
export type LaunchMode =
  | { kind: "XPERIENCE_NORMAL" }
  | { kind: "DIRECT_APP"; appId: string; source: "ANDROID" | "WEB"; standalone: boolean }
  | { kind: "DIRECT_SPACE"; spaceId: string; source: "ANDROID" | "WEB"; standalone: boolean }
  | { kind: "DIRECT_INVALID" };

export function resolveLaunchMode(raw: unknown): LaunchMode {
  if (raw == null) return { kind: "XPERIENCE_NORMAL" };
  const route = routeTargetLaunch(raw);
  if (route.kind === "APP") return { kind: "DIRECT_APP", appId: route.appId, source: route.source, standalone: route.standalone };
  if (route.kind === "SPACE") return { kind: "DIRECT_SPACE", spaceId: route.spaceId, source: route.source, standalone: route.standalone };
  return { kind: "DIRECT_INVALID" };
}

export function isDirectLaunch(mode: LaunchMode): boolean {
  return mode.kind !== "XPERIENCE_NORMAL";
}

/* ------------------------------------------------------------------ installed state */

export type InstallationState = "NOT_INSTALLED" | "INSTALLING" | "INSTALLED" | "UPDATE_AVAILABLE" | "BROKEN" | "REMOVING";

/** Launch-entry state is the platform's; Space continuity integrity is the Space owners'. Kept apart. */
export type LaunchEntryPresence = "NONE" | "PENDING_CONFIRMATION" | "PRESENT" | "UNKNOWN";
export type SpaceContinuity = "READY" | "NEEDS_PREPARATION" | "MISSING_REGISTRATION" | "CHECKING";

export interface TargetInstallationView {
  state: InstallationState;
  launchEntry: LaunchEntryPresence;
  /** SPACE only. */
  continuity?: SpaceContinuity;
}

/**
 * Derived, never persisted. `present` is the platform's own report (Android pinned shortcuts), or
 * null where the platform cannot tell (browsers, Safari handoff) — then the record's confirmation
 * is the best available evidence and is reported as such.
 */
export function targetInstallationView(input: {
  type: "APP" | "SPACE";
  record: InstalledTarget | null;
  present: boolean | null;
  installing?: boolean;
  removing?: boolean;
  currentVersion?: string;
  /** SPACE: the V1 registration and home-entry record. */
  spaceRegistered?: boolean;
  spaceHomeRecord?: boolean;
  spaceReadiness?: SpaceReadiness | "CHECKING";
}): TargetInstallationView {
  const launchEntry: LaunchEntryPresence = !input.record
    ? "NONE"
    : input.present === true
      ? "PRESENT"
      : input.present === false
        ? input.record.launchEntryState === "PENDING_CONFIRMATION" ? "PENDING_CONFIRMATION" : "NONE"
        : input.record.launchEntryState === "CONFIRMED" ? "UNKNOWN" : "PENDING_CONFIRMATION";
  const continuity: SpaceContinuity | undefined = input.type !== "SPACE"
    ? undefined
    : !input.spaceRegistered
      ? "MISSING_REGISTRATION"
      : input.spaceReadiness === "CHECKING"
        ? "CHECKING"
        : input.spaceReadiness === "READY_OFFLINE" || input.spaceReadiness === "PREPARED"
          ? "READY"
          : "NEEDS_PREPARATION";
  const view = (state: InstallationState): TargetInstallationView => ({ state, launchEntry, ...(continuity ? { continuity } : {}) });
  if (input.removing) return view("REMOVING");
  if (input.installing) return view("INSTALLING");
  if (!input.record || launchEntry === "NONE" || launchEntry === "PENDING_CONFIRMATION") return view("NOT_INSTALLED");
  // An icon alone is not a Space: without its registration or home-entry record it cannot open.
  if (input.type === "SPACE" && (continuity === "MISSING_REGISTRATION" || input.spaceHomeRecord === false)) return view("BROKEN");
  if (input.currentVersion && input.record.version && input.currentVersion !== input.record.version) return view("UPDATE_AVAILABLE");
  return view("INSTALLED");
}
