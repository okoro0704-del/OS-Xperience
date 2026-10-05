import type { DirectoryApplicationView, ExperienceExecutionMode, ExperienceTarget } from "@digiconomy/xperience-contract";
import { MYBRANDOS_PUBLIC_ID, bootstrapPublicEntry } from "./bootstrap.js";
import { readSignedCatalog } from "./catalog.js";
import { findRegistryEntry, registryToDirectoryView } from "./registry.js";
import { findSpaceRegistration } from "./space-registry.js";
import { readJson, writeJson } from "./storage.js";
import { providerTargets, requireExecutionTarget, type ProviderRef } from "./targets.js";
import type { SpaceReadiness } from "./xperience-browsers.js";

/**
 * Space Installation V1: an Android home-screen entry into a Space hosted by OS Xperience.
 * The entry is not an APK and not a second application — it carries only the Space's stable
 * identity, and OS Xperience decides on every launch what that identity resolves to.
 * Registration (Space Launch File V1) and preparation (Offline Kernel) stay authoritative for
 * their own state; this module only adds the home-entry record.
 */
export const SPACE_HOME_ENTRIES_KEY = "ox.space-home-entries.v1";
/** Explicit-component intent action of every Space shortcut. */
export const SPACE_LAUNCH_ACTION = "com.digiconomy.osexperience.action.OPEN_SPACE";
/** The only intent extra a Space shortcut carries: the Space (provider) identity. */
export const SPACE_LAUNCH_EXTRA = "ox.space.id";
const SHORTCUT_PREFIX = "space:";
const RESERVED_EXTRA_NAMESPACE = "ox.";
const MAX_EXTRA_KEYS = 32;
const SPACE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Same identifier grammar as a launch file's providerId: no path, URL or script can be expressed. */
export function isSpaceId(value: unknown): value is string {
  return typeof value === "string" && SPACE_ID.test(value) && !value.includes("..");
}

/** Stable per Space: independent of display name, icon, version and channel. */
export function spaceShortcutId(spaceId: string): string {
  return `${SHORTCUT_PREFIX}${spaceId}`;
}

export function spaceIdFromShortcutId(shortcutId: string): string | null {
  if (!shortcutId.startsWith(SHORTCUT_PREFIX)) return null;
  const spaceId = shortcutId.slice(SHORTCUT_PREFIX.length);
  return isSpaceId(spaceId) ? spaceId : null;
}

/* ------------------------------------------------------------------ presentation */

export type SpacePresentationSource = "LAUNCH_FILE" | "SIGNED_CATALOG";

export interface SpaceTrustedPresentation {
  spaceId: string;
  name: string;
  source: SpacePresentationSource;
  publisherName?: string;
  version?: string;
  channelId?: string;
}

export type SpaceHomeEntryEligibility =
  | { eligible: true; presentation: SpaceTrustedPresentation; target: ExperienceTarget }
  | { eligible: false; reason: "INVALID_SPACE" | "NOT_RELEASED" | "NOT_VERIFIED" };

/**
 * A home entry needs a released SPACE target and a presentation from a verified signed source:
 * the publisher-signed launch file registration first, else the signed catalog entry that
 * releases the SPACE. Bundled/declared data alone is never enough to put an icon on Android.
 */
export function spaceHomeEntryEligibility(provider: ProviderRef): SpaceHomeEntryEligibility {
  if (!isSpaceId(provider.id)) return { eligible: false, reason: "INVALID_SPACE" };
  const target = requireExecutionTarget(providerTargets(provider), "SPACE");
  if (!target || target.executionMode !== "SPACE") return { eligible: false, reason: "NOT_RELEASED" };
  const channelId = target.broadcastChannelId;
  const registration = findSpaceRegistration(provider.id);
  if (registration && (!channelId || registration.broadcastChannelId === channelId)) {
    return {
      eligible: true,
      target,
      presentation: { spaceId: provider.id, name: registration.name, source: "LAUNCH_FILE", publisherName: registration.publisherName, version: registration.version, channelId: registration.broadcastChannelId },
    };
  }
  const catalogEntry = readSignedCatalog()?.payload.experiences.find((entry) => entry.experienceId === provider.id);
  if (catalogEntry?.executionModes?.some((mode) => mode.mode === "SPACE")) {
    return {
      eligible: true,
      target,
      presentation: { spaceId: provider.id, name: catalogEntry.name, source: "SIGNED_CATALOG", version: catalogEntry.version, ...(channelId ? { channelId } : {}) },
    };
  }
  return { eligible: false, reason: "NOT_VERIFIED" };
}

/** What Android receives to draw the entry. Label and monogram come from the trusted presentation only. */
export interface SpaceShortcutRequest {
  shortcutId: string;
  spaceId: string;
  label: string;
  monogram: string;
  color: string;
}

const PALETTE = ["#2f7bff", "#13a89e", "#8b5cf6", "#e4572e", "#d4a017", "#2fa84f", "#d6336c", "#0b7285"];

/** Deterministic tile colour from identity, so a renamed Space keeps its colour and two Spaces with one name differ. */
function identityColor(spaceId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < spaceId.length; i += 1) hash = Math.imul(hash ^ spaceId.charCodeAt(i), 0x01000193) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

function monogram(name: string): string {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]?.[0] ?? "S";
  return letters.slice(0, 2);
}

export function spaceShortcutRequest(presentation: Pick<SpaceTrustedPresentation, "spaceId" | "name">): SpaceShortcutRequest {
  const label = presentation.name.trim().slice(0, 64);
  return { shortcutId: spaceShortcutId(presentation.spaceId), spaceId: presentation.spaceId, label, monogram: monogram(label), color: identityColor(presentation.spaceId) };
}

/* ------------------------------------------------------------------ home-entry records */

export interface SpaceHomeEntry {
  spaceId: string;
  shortcutId: string;
  /** Trusted presentation name when the entry was created or last refreshed — never identity. */
  label: string;
  presentationSource: SpacePresentationSource;
  createdAt: string;
  updatedAt: string;
}

function isEntry(value: unknown): value is SpaceHomeEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SpaceHomeEntry>;
  return (
    isSpaceId(row.spaceId) &&
    row.shortcutId === spaceShortcutId(row.spaceId) &&
    typeof row.label === "string" && row.label.trim().length > 0 && row.label.length <= 64 && !CONTROL.test(row.label) &&
    (row.presentationSource === "LAUNCH_FILE" || row.presentationSource === "SIGNED_CATALOG") &&
    typeof row.createdAt === "string" && typeof row.updatedAt === "string"
  );
}

/** Malformed or duplicated rows are ignored rather than trusted. */
export function readSpaceHomeEntries(): SpaceHomeEntry[] {
  const raw = readJson<{ schemaVersion?: unknown; entries?: unknown }>(SPACE_HOME_ENTRIES_KEY);
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) return [];
  const seen = new Set<string>();
  return raw.entries.filter((entry): entry is SpaceHomeEntry => {
    if (!isEntry(entry) || seen.has(entry.spaceId)) return false;
    seen.add(entry.spaceId);
    return true;
  });
}

function writeEntries(entries: SpaceHomeEntry[]): void {
  writeJson(SPACE_HOME_ENTRIES_KEY, { schemaVersion: 1, entries });
}

export function findSpaceHomeEntry(spaceId: string): SpaceHomeEntry | null {
  return readSpaceHomeEntries().find((entry) => entry.spaceId === spaceId) ?? null;
}

/** One entry per Space identity: a new version or name refreshes the label, never adds a second entry. */
export function recordSpaceHomeEntry(presentation: SpaceTrustedPresentation, now = new Date()): SpaceHomeEntry {
  const entries = readSpaceHomeEntries();
  const existing = entries.find((entry) => entry.spaceId === presentation.spaceId);
  const entry: SpaceHomeEntry = {
    spaceId: presentation.spaceId,
    shortcutId: spaceShortcutId(presentation.spaceId),
    label: spaceShortcutRequest(presentation).label,
    presentationSource: presentation.source,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  writeEntries([...entries.filter((item) => item.spaceId !== presentation.spaceId), entry]);
  return entry;
}

/** Removes the home-entry record only — never the registration and never prepared Offline Kernel data. */
export function removeSpaceHomeEntry(spaceId: string): boolean {
  const entries = readSpaceHomeEntries();
  const next = entries.filter((entry) => entry.spaceId !== spaceId);
  if (next.length === entries.length) return false;
  writeEntries(next);
  return true;
}

/** Pinned Android entries OS Xperience no longer records (removed here, or app data cleared). */
export function staleSpaceShortcuts(pinnedShortcutIds: readonly string[]): string[] {
  const recorded = new Set(readSpaceHomeEntries().map((entry) => entry.shortcutId));
  return pinnedShortcutIds.filter((id) => id.startsWith(SHORTCUT_PREFIX) && !recorded.has(id));
}

/* ------------------------------------------------------------------ launch contract */

/** Normalized, still-untrusted launch request from the native shell. */
export interface RawSpaceLaunch {
  action?: unknown;
  spaceId?: unknown;
  extraKeys?: unknown;
  hasData?: unknown;
}

export type SpaceLaunchParse = { ok: true; spaceId: string } | { ok: false; code: "INVALID_TARGET" };

/**
 * Android intents are untrusted input. A valid Space launch is exactly: the Space action, no data
 * URI, one Space identity extra, and no other OS Xperience-namespaced parameter (mode, url, …).
 */
export function parseSpaceLaunch(raw: unknown): SpaceLaunchParse {
  const invalid = { ok: false as const, code: "INVALID_TARGET" as const };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid;
  const request = raw as RawSpaceLaunch;
  if (request.action !== SPACE_LAUNCH_ACTION || request.hasData !== false) return invalid;
  if (!Array.isArray(request.extraKeys) || request.extraKeys.length > MAX_EXTRA_KEYS) return invalid;
  const keys = request.extraKeys;
  if (!keys.every((key): key is string => typeof key === "string")) return invalid;
  if (keys.filter((key) => key === SPACE_LAUNCH_EXTRA).length !== 1) return invalid;
  if (keys.some((key) => key !== SPACE_LAUNCH_EXTRA && key.startsWith(RESERVED_EXTRA_NAMESPACE))) return invalid;
  if (!isSpaceId(request.spaceId)) return invalid;
  return { ok: true, spaceId: request.spaceId };
}

export type SpaceLaunchResolution =
  | { kind: "INVALID_TARGET" }
  | { kind: "NOT_INSTALLED"; spaceId: string }
  | { kind: "UNAVAILABLE"; spaceId: string; entry: SpaceHomeEntry }
  | { kind: "RESOLVED"; spaceId: string; entry: SpaceHomeEntry; app: DirectoryApplicationView; target: ExperienceTarget };

/** The provider record a Space identity runs under, from trusted local state only. */
export function spaceProviderView(spaceId: string, apps: readonly DirectoryApplicationView[] = []): DirectoryApplicationView | null {
  const known = apps.find((app) => app.id === spaceId);
  if (known) return known;
  const entry = findRegistryEntry(spaceId) ?? (spaceId === MYBRANDOS_PUBLIC_ID ? bootstrapPublicEntry() : null);
  return entry ? registryToDirectoryView(entry) : null;
}

/**
 * Shortcut → identity → SPACE target, or a refusal. Resolution reads only local state, so it
 * needs no network; it never substitutes APP, never opens a URL and never creates anything.
 */
export function resolveSpaceLaunch(
  raw: unknown,
  options: { apps?: readonly DirectoryApplicationView[]; fixedMode?: ExperienceExecutionMode | null } = {},
): SpaceLaunchResolution {
  const parsed = parseSpaceLaunch(raw);
  if (!parsed.ok) return { kind: "INVALID_TARGET" };
  return resolveInstalledSpace(parsed.spaceId, options);
}

export function resolveInstalledSpace(
  spaceId: string,
  options: { apps?: readonly DirectoryApplicationView[]; fixedMode?: ExperienceExecutionMode | null } = {},
): SpaceLaunchResolution {
  if (!isSpaceId(spaceId)) return { kind: "INVALID_TARGET" };
  const entry = findSpaceHomeEntry(spaceId);
  if (!entry) return { kind: "NOT_INSTALLED", spaceId };
  // A host locked to another mode can never run a Space; it must not hand back its own target.
  if (options.fixedMode && options.fixedMode !== "SPACE") return { kind: "UNAVAILABLE", spaceId, entry };
  const app = spaceProviderView(spaceId, options.apps);
  if (!app) return { kind: "UNAVAILABLE", spaceId, entry };
  const target = requireExecutionTarget(
    providerTargets({ id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes }),
    "SPACE",
  );
  if (!target || target.executionMode !== "SPACE") return { kind: "UNAVAILABLE", spaceId, entry };
  return { kind: "RESOLVED", spaceId, entry, app, target };
}

/* ------------------------------------------------------------------ installation states */

export type SpaceHomeEntryState = "UNSUPPORTED" | "NOT_ELIGIBLE" | "AVAILABLE" | "REQUESTED" | "INSTALLED";

/** INSTALLED is what Android reports as pinned; a record alone is only a request. */
export function spaceHomeEntryState(input: { supported: boolean; eligible: boolean; recorded: boolean; pinned: boolean }): SpaceHomeEntryState {
  if (!input.supported) return "UNSUPPORTED";
  if (input.recorded && input.pinned) return "INSTALLED";
  if (!input.eligible) return "NOT_ELIGIBLE";
  return input.recorded ? "REQUESTED" : "AVAILABLE";
}

export type SpaceInstallationStage =
  | "NOT_INSTALLED"
  | "REGISTERED"
  | "PREPARING"
  | "READY_OFFLINE"
  | "HOME_ENTRY_AVAILABLE"
  | "HOME_ENTRY_INSTALLED";

/**
 * Display stage derived from the canonical owners — registration, Offline Kernel readiness and
 * Android's pinned state. Never persisted. HOME_ENTRY_INSTALLED does not imply READY OFFLINE.
 */
export function spaceInstallationStage(input: {
  registered: boolean;
  readiness: SpaceReadiness | "CHECKING";
  preparing: boolean;
  homeEntry: SpaceHomeEntryState;
}): SpaceInstallationStage {
  if (input.homeEntry === "INSTALLED") return "HOME_ENTRY_INSTALLED";
  if (input.preparing) return "PREPARING";
  const ready = input.readiness === "READY_OFFLINE" || input.readiness === "PREPARED";
  if (ready && (input.homeEntry === "AVAILABLE" || input.homeEntry === "REQUESTED")) return "HOME_ENTRY_AVAILABLE";
  if (ready) return "READY_OFFLINE";
  return input.registered ? "REGISTERED" : "NOT_INSTALLED";
}

/* ------------------------------------------------------------------ platform boundary */

/**
 * Platform integration only. The host never decides trust: it pins, updates, disables and lists
 * launcher entries, and hands back raw launch requests for OS Xperience to validate.
 */
export interface SpaceHomeEntryHost {
  supported(): Promise<boolean>;
  pinnedShortcutIds(): Promise<string[]>;
  requestPin(request: SpaceShortcutRequest): Promise<{ requested: boolean; alreadyPinned?: boolean }>;
  update(request: SpaceShortcutRequest): Promise<void>;
  disable(shortcutId: string): Promise<void>;
  /** Consumes the pending launch request, if any. */
  takeLaunch(): Promise<unknown>;
  /** Called when a launch request arrives while OS Xperience is running. */
  onLaunch(listener: () => void): () => void;
  /** Called when Android's pinned entries may have changed (e.g. back from the launcher's confirmation). */
  onPinnedChange(listener: () => void): () => void;
}

/** Android native shell: SUPPORTED when the launcher accepts pin requests. Browsers and PWAs: UNSUPPORTED. */
export async function canInstallSpaceHomeEntry(host: SpaceHomeEntryHost | null | undefined): Promise<boolean> {
  if (!host) return false;
  try {
    return await host.supported();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ acquisition */

/**
 * Signed .space artifacts shipped inside this build. INSTALL SPACE reads them from the bundle
 * (no network) and runs the same Space Launch File V1 verifier as a picked file.
 */
export const BUNDLED_SPACE_ARTIFACTS: Readonly<Record<string, string>> = {
  [MYBRANDOS_PUBLIC_ID]: "spaces/mrfundzman.space",
};

export function bundledSpaceArtifact(providerId: string): string | null {
  return Object.prototype.hasOwnProperty.call(BUNDLED_SPACE_ARTIFACTS, providerId) ? BUNDLED_SPACE_ARTIFACTS[providerId]! : null;
}
