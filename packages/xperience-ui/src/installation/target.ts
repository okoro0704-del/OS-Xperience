import {
  normalizeExperienceAuthMode,
  normalizeOfflineCapability,
  type DirectoryApplicationView,
  type ExperienceAuthMode,
  type OfflineCapability,
} from "@digiconomy/xperience-contract";
import { readSignedCatalog, signedCatalogGovernsExecution } from "../local/catalog.js";
import { findSpaceRegistration } from "../local/space-registry.js";
import {
  bundledSpaceArtifact,
  isSpaceId,
  spaceHomeEntryEligibility,
  spaceShortcutRequest,
} from "../local/space-home-entry.js";
import { providerTargets, requireExecutionTarget, type ProviderRef } from "../local/targets.js";

/**
 * OS Xperience installation domain. INSTALL is one product action for two different things:
 *
 *   APP   — an application experience. Network-first. Installing records WHAT launches.
 *   SPACE — a continuity environment. Continuity-first. Installing registers it (Space Launch
 *           File V1), prepares it in the Offline Kernel, then adds its launch entry (Space
 *           Installation V1). Space continuity state stays in those owners.
 *
 * Installation is never authentication: no target, record or launch entry carries a credential.
 */
export type InstallTargetType = "APP" | "SPACE";

export interface InstallTargetIcon {
  /** One or two letters drawn locally on the device. Never a remote image. */
  monogram: string;
  /** #rrggbb derived from the target identity. */
  color: string;
}

interface InstallTargetBase {
  id: string;
  /** Trusted presentation name (signed catalog, verified launch file, or the Directory record). */
  name: string;
  icon: InstallTargetIcon;
  version?: string;
  source: InstallTargetSource;
}

export type InstallTargetSource = "SIGNED_CATALOG" | "LAUNCH_FILE" | "DIRECTORY" | "BUNDLED_LAUNCH_FILE";

export interface AppInstallTarget extends InstallTargetBase {
  type: "APP";
  launchTarget: { mode: "APP" };
  /** What the App itself declares. Installing never upgrades it: an online-only App stays online-only. */
  offlineCapability: OfflineCapability;
  authMode: ExperienceAuthMode;
}

export interface SpaceInstallTarget extends InstallTargetBase {
  type: "SPACE";
  launchTarget: { mode: "SPACE"; broadcastChannelId: string | null };
  /** Space continuity: verified registration present, or a signed artifact bundled with this build. */
  launchFile: { registered: boolean; bundledArtifact: string | null };
}

export type InstallableTarget = AppInstallTarget | SpaceInstallTarget;

/* ------------------------------------------------------------------ identity */

const KEY_PREFIX: Record<InstallTargetType, string> = { APP: "app:", SPACE: "space:" };
const CONTROL = /[\u0000-\u001f\u007f]/;
const MONOGRAM = /^[A-Z0-9]{1,2}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const MAX_TARGET_NAME = 64;

/** Same grammar as a Space identity: no path, URL, query or script can be expressed. */
export function isTargetId(value: unknown): value is string {
  return isSpaceId(value);
}

/**
 * Stable per (type, id), on every platform. `space:<id>` is exactly the Space Installation V1
 * shortcut ID; one provider can hold both `app:<id>` and `space:<id>` without collision.
 */
export function targetKey(type: InstallTargetType, id: string): string {
  return `${KEY_PREFIX[type]}${id}`;
}

export function parseTargetKey(key: unknown): { type: InstallTargetType; id: string } | null {
  if (typeof key !== "string") return null;
  for (const type of ["APP", "SPACE"] as const) {
    if (!key.startsWith(KEY_PREFIX[type])) continue;
    const id = key.slice(KEY_PREFIX[type].length);
    return isTargetId(id) ? { type, id } : null;
  }
  return null;
}

/* ------------------------------------------------------------------ validation */

export type InstallTargetInvalidReason =
  | "MALFORMED"
  | "UNKNOWN_TYPE"
  | "INVALID_ID"
  | "INVALID_NAME"
  | "INVALID_ICON"
  | "INVALID_LAUNCH_TARGET"
  | "UNSAFE_METADATA";

export type InstallTargetValidation =
  | { ok: true; target: InstallableTarget }
  | { ok: false; code: "INVALID_TARGET"; reason: InstallTargetInvalidReason };

const SHARED_KEYS = ["type", "id", "name", "icon", "version", "source", "launchTarget"];
const APP_KEYS = new Set([...SHARED_KEYS, "offlineCapability", "authMode"]);
const SPACE_KEYS = new Set([...SHARED_KEYS, "launchFile"]);
const SOURCES = new Set<InstallTargetSource>(["SIGNED_CATALOG", "LAUNCH_FILE", "DIRECTORY", "BUNDLED_LAUNCH_FILE"]);

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TARGET_NAME && !CONTROL.test(value);
}

/**
 * Structural validation of an untrusted target description. Unknown fields are refused rather
 * than carried along, so nothing (a token, a URL, a mode override) can ride into an install.
 */
export function validateInstallableTarget(raw: unknown): InstallTargetValidation {
  const invalid = (reason: InstallTargetInvalidReason) => ({ ok: false as const, code: "INVALID_TARGET" as const, reason });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("MALFORMED");
  const row = raw as Record<string, unknown>;
  if (row.type !== "APP" && row.type !== "SPACE") return invalid("UNKNOWN_TYPE");
  const allowed = row.type === "APP" ? APP_KEYS : SPACE_KEYS;
  if (Object.keys(row).some((key) => !allowed.has(key))) return invalid("UNSAFE_METADATA");
  if (!isTargetId(row.id)) return invalid("INVALID_ID");
  if (!validName(row.name)) return invalid("INVALID_NAME");
  const icon = row.icon as Partial<InstallTargetIcon> | undefined;
  if (!icon || typeof icon !== "object" || !MONOGRAM.test(String(icon.monogram)) || !COLOR.test(String(icon.color)) || Object.keys(icon).length !== 2) {
    return invalid("INVALID_ICON");
  }
  if (row.version !== undefined && (typeof row.version !== "string" || row.version.length > 64 || CONTROL.test(row.version))) return invalid("MALFORMED");
  if (!SOURCES.has(row.source as InstallTargetSource)) return invalid("MALFORMED");
  const launch = row.launchTarget as Record<string, unknown> | undefined;
  if (!launch || typeof launch !== "object" || launch.mode !== row.type) return invalid("INVALID_LAUNCH_TARGET");
  if (row.type === "APP") {
    if (Object.keys(launch).length !== 1) return invalid("INVALID_LAUNCH_TARGET");
    return { ok: true, target: row as unknown as AppInstallTarget };
  }
  if (Object.keys(launch).some((key) => key !== "mode" && key !== "broadcastChannelId")) return invalid("INVALID_LAUNCH_TARGET");
  if (launch.broadcastChannelId !== null && launch.broadcastChannelId !== undefined && !isTargetId(launch.broadcastChannelId)) return invalid("INVALID_LAUNCH_TARGET");
  const launchFile = row.launchFile as Record<string, unknown> | undefined;
  if (!launchFile || typeof launchFile.registered !== "boolean" || (launchFile.bundledArtifact !== null && typeof launchFile.bundledArtifact !== "string")) {
    return invalid("MALFORMED");
  }
  return { ok: true, target: row as unknown as SpaceInstallTarget };
}

/* ------------------------------------------------------------------ targets from trusted local state */

function providerRef(app: DirectoryApplicationView): ProviderRef {
  return { id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes };
}

function iconFor(id: string, name: string): InstallTargetIcon {
  // Same deterministic monogram/colour as Space Installation V1 entries.
  const { monogram, color } = spaceShortcutRequest({ spaceId: id, name });
  return { monogram, color };
}

/** APP installs a released APP target only, named from the signed catalog when one carries it. */
export function appInstallTarget(app: DirectoryApplicationView): AppInstallTarget | null {
  if (!isTargetId(app.id)) return null;
  const target = requireExecutionTarget(providerTargets(providerRef(app)), "APP");
  if (!target || target.executionMode !== "APP") return null;
  const catalogEntry = readSignedCatalog()?.payload.experiences.find((entry) => entry.experienceId === app.id);
  const name = (catalogEntry?.name ?? app.name).trim().slice(0, MAX_TARGET_NAME);
  if (!validName(name)) return null;
  return {
    type: "APP",
    id: app.id,
    name,
    icon: iconFor(app.id, name),
    version: catalogEntry?.version ?? app.version,
    source: catalogEntry ? "SIGNED_CATALOG" : "DIRECTORY",
    launchTarget: { mode: "APP" },
    offlineCapability: normalizeOfflineCapability(app.offlineCapability),
    authMode: normalizeExperienceAuthMode(app.authMode),
  };
}

/**
 * SPACE is installable when it can be verified — an existing Space Launch File V1 registration, a
 * signed catalog release, or a signed artifact bundled with this build (verified at install time by
 * the same V1 verifier) — and is released, or would be released by that verified registration
 * (V1: a registration contributes the SPACE mode where no signed catalog governs the provider).
 */
export function spaceInstallTarget(app: DirectoryApplicationView): SpaceInstallTarget | null {
  if (!isTargetId(app.id)) return null;
  const targets = providerTargets(providerRef(app));
  const released = requireExecutionTarget(targets, "SPACE");
  const registration = findSpaceRegistration(app.id);
  const bundledArtifact = bundledSpaceArtifact(app.id);
  const catalog = readSignedCatalog();
  const registrationWouldRelease = !registration && Boolean(bundledArtifact)
    && !targets.some((item) => item.executionMode === "SPACE")
    && !catalog?.payload.experiences.some((entry) => entry.experienceId === app.id)
    && !signedCatalogGovernsExecution(catalog);
  if ((!released || released.executionMode !== "SPACE") && !registrationWouldRelease) return null;
  const eligibility = spaceHomeEntryEligibility(providerRef(app));
  if (!registration && !bundledArtifact && !eligibility.eligible) return null;
  const name = (registration?.name ?? (eligibility.eligible ? eligibility.presentation.name : app.name)).trim().slice(0, MAX_TARGET_NAME);
  if (!validName(name)) return null;
  const source: InstallTargetSource = registration
    ? "LAUNCH_FILE"
    : eligibility.eligible
      ? eligibility.presentation.source
      : "BUNDLED_LAUNCH_FILE";
  const version = registration?.version ?? (eligibility.eligible ? eligibility.presentation.version : undefined);
  return {
    type: "SPACE",
    id: app.id,
    name,
    icon: iconFor(app.id, name),
    ...(version ? { version } : {}),
    source,
    // Before registration the channel comes from the signed launch file; the V1 record carries it afterwards.
    launchTarget: { mode: "SPACE", broadcastChannelId: released?.broadcastChannelId ?? null },
    launchFile: { registered: Boolean(registration), bundledArtifact },
  };
}

/** Every installable target a Directory provider offers, APP first. */
export function installableTargetsFor(app: DirectoryApplicationView): InstallableTarget[] {
  return [appInstallTarget(app), spaceInstallTarget(app)].filter((target): target is InstallableTarget => target !== null);
}
