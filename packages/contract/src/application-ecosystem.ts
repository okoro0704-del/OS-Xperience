import type { OSShellIntentHandler } from "./intent-handlers.js";
import { defaultIntentHandlersFor } from "./intent-defaults.js";
import { defaultObjectiveDeclarationFor } from "./objective-defaults.js";
import type { OSShellObjectiveDeclaration } from "./objectives.js";
import type { PublicCapability } from "./capability-registry.js";
import { allowedCapabilitiesForClass } from "./capability-registry.js";
import type { AppClass } from "./identity.js";
import { DEFAULT_DEMO_ORIGINS, NATIVE_APP_DESCRIPTORS } from "./origin-policy.js";
import { builtinAppRegistry, type ShellAppRecord } from "./registry.js";
import type { ApplicationTrustState } from "./trust.js";
import { resolveApplicationTrust } from "./trust.js";
import { originOf } from "./url.js";
import { WELL_KNOWN_MANIFEST_PATH } from "./version.js";
import { jsonLeaksSecrets } from "./permissions.js";
import type { OSShellApplicationManifest } from "./developer-manifest.js";

/**
 * Application ecosystem / distribution contract (1.2).
 * Knows about applications. Does not own Digiconomy primitives.
 * Not a store, marketplace, or backend.
 */

export const APPLICATION_SOURCES = ["FIRST_PARTY", "DEVELOPER", "LOCAL", "EXTERNAL"] as const;
export type OSShellApplicationSource = (typeof APPLICATION_SOURCES)[number];

/** Registration/install participation — distinct from runtime lifecycle. */
export const APPLICATION_PRESENCE_STATES = ["DISCOVERED", "REGISTERED", "INSTALLED", "RUNNING", "REMOVED"] as const;
export type OSShellApplicationPresence = (typeof APPLICATION_PRESENCE_STATES)[number];

export interface OSShellApplicationIdentity {
  appId: string;
  name: string;
  version: string;
  origin: string;
  class: AppClass;
  trustState: ApplicationTrustState;
}

export interface OSShellApplicationRecord {
  appId: string;
  name: string;
  origin: string;
  version: string;
  class: AppClass;
  trustState: ApplicationTrustState;
  requestedCapabilities: PublicCapability[];
  source: OSShellApplicationSource;
  presence: Exclude<OSShellApplicationPresence, "REMOVED">;
  installedAt: string;
  updatedAt: string;
  /** Optional declared newer version from manifest/source. Never invents a store. */
  availableVersion?: string | null;
  /** Explicit URL patterns this app may claim. Empty = origin only. */
  urlPatterns?: string[];
  /** Minimum developer contract version this app requires. */
  minContractVersion?: string;
  purpose?: string;
  removable: boolean;
  /** Declared intent handlers. Declaration ≠ privilege. */
  intentHandlers?: OSShellIntentHandler[];
  /** Whether the application can interpret Shell resume context. Not state ownership. */
  resumeSupport?: { supported: boolean };
  /** Declared search participation. Declaration ≠ permission to search all user data. */
  search?: { supportedTypes: Array<"application" | "object" | string> };
  /** Declared objectives. Declaration ≠ availability. */
  objectives?: OSShellObjectiveDeclaration;
}

export function applicationIdentityOf(record: OSShellApplicationRecord): OSShellApplicationIdentity {
  return {
    appId: record.appId,
    name: record.name,
    version: record.version,
    origin: record.origin,
    class: record.class,
    trustState: record.trustState,
  };
}

export function sourceForBuiltin(appId: string, appClass: AppClass): OSShellApplicationSource {
  if (appId === "mybrandos" || appId === "lifeos" || appClass === "native") return "FIRST_PARTY";
  if (appId === "shell-demo-notes") return "EXTERNAL";
  return "DEVELOPER";
}

export function seedApplicationCatalog(now = new Date()): OSShellApplicationRecord[] {
  const at = now.toISOString();
  return builtinAppRegistry().map((item) => recordFromBuiltin(item, at));
}

export function recordFromBuiltin(item: ShellAppRecord, at = new Date().toISOString()): OSShellApplicationRecord {
  const trustState = resolveApplicationTrust({
    origin: item.origin,
    appClass: item.class,
    manifestPresent: true,
  });
  return {
    appId: item.id,
    name: item.name,
    origin: item.origin,
    version: item.version ?? "0.0.0",
    class: item.class,
    trustState,
    requestedCapabilities: [...item.allowedCapabilities],
    source: sourceForBuiltin(item.id, item.class),
    presence: "INSTALLED",
    installedAt: at,
    updatedAt: at,
    availableVersion: null,
    urlPatterns: [],
    minContractVersion: "1.1",
    purpose: item.purpose,
    removable: item.class !== "native",
    intentHandlers: defaultIntentHandlersFor(item.id),
    resumeSupport: { supported: item.id === "shell-demo-notes" || item.id === "mybrandos" || item.id === "lifeos" },
    search:
      item.id === "shell-demo-notes"
        ? { supportedTypes: ["object", "text"] }
        : item.id === "mybrandos"
          ? { supportedTypes: ["object", "asset", "project", "media"] }
          : item.id === "lifeos"
            ? { supportedTypes: ["object", "asset", "digital_life"] }
            : undefined,
    objectives: defaultObjectiveDeclarationFor(item.id),
  };
}

export function recordFromValidatedManifest(input: {
  manifest: OSShellApplicationManifest;
  source?: OSShellApplicationSource;
  effectiveClass: AppClass;
  trustState: ApplicationTrustState;
  now?: Date;
}): OSShellApplicationRecord {
  const at = (input.now ?? new Date()).toISOString();
  return {
    appId: input.manifest.appId,
    name: input.manifest.name,
    origin: input.manifest.origin,
    version: input.manifest.version,
    class: input.effectiveClass,
    trustState: input.trustState,
    requestedCapabilities: [...input.manifest.requestedCapabilities],
    source: input.source ?? "DEVELOPER",
    presence: "INSTALLED",
    installedAt: at,
    updatedAt: at,
    availableVersion: null,
    urlPatterns: [],
    minContractVersion: "1.1",
    purpose: input.manifest.publisher,
    removable: true,
    intentHandlers: input.manifest.intentHandlers ?? [],
    search: input.manifest.search,
    objectives: input.manifest.objectives,
  };
}

export type InstallReject =
  | "manifest_invalid"
  | "origin_unverified"
  | "origin_mismatch"
  | "capability_unknown"
  | "secret_payload"
  | "application_duplicate"
  | "application_incompatible";

export type InstallPreview = {
  identity: OSShellApplicationIdentity;
  requestedCapabilities: PublicCapability[];
  source: OSShellApplicationSource;
  capabilitiesGrantedOnInstall: false;
  note: string;
};

export function installPreviewFromRecord(record: OSShellApplicationRecord): InstallPreview {
  return {
    identity: applicationIdentityOf(record),
    requestedCapabilities: [...record.requestedCapabilities],
    source: record.source,
    capabilitiesGrantedOnInstall: false,
    note: "Installation registers the application. Capabilities are requested later at runtime.",
  };
}

/** appId is stable across versions. Same origin + new version updates in place. */
export function upsertInstalledApplication(
  list: readonly OSShellApplicationRecord[],
  next: OSShellApplicationRecord,
): { ok: true; list: OSShellApplicationRecord[] } | { ok: false; code: "application_duplicate" | "origin_change_required"; detail: string } {
  if (jsonLeaksSecrets(next)) {
    return { ok: false, code: "application_duplicate", detail: "Application record must not contain secrets." };
  }
  const byId = list.find((item) => item.appId === next.appId);
  if (byId && byId.origin !== next.origin) {
    return {
      ok: false,
      code: "origin_change_required",
      detail: "Same appId with a different origin requires explicit origin-change handling. Grants are not transferred.",
    };
  }
  const byOrigin = list.find((item) => item.origin === next.origin && item.appId !== next.appId);
  if (byOrigin) {
    return {
      ok: false,
      code: "application_duplicate",
      detail: `Origin ${next.origin} is already registered as ${byOrigin.appId}.`,
    };
  }
  if (byId) {
    const merged: OSShellApplicationRecord = {
      ...byId,
      name: next.name,
      version: next.version,
      class: next.class,
      trustState: next.trustState,
      requestedCapabilities: next.requestedCapabilities,
      source: next.source,
      presence: "INSTALLED",
      updatedAt: next.updatedAt,
      availableVersion: next.availableVersion ?? null,
      urlPatterns: next.urlPatterns ?? byId.urlPatterns,
      minContractVersion: next.minContractVersion ?? byId.minContractVersion,
      purpose: next.purpose ?? byId.purpose,
      removable: next.removable,
      installedAt: byId.installedAt,
      intentHandlers: next.intentHandlers ?? byId.intentHandlers,
    };
    return { ok: true, list: list.map((item) => (item.appId === next.appId ? merged : item)) };
  }
  return { ok: true, list: [...list, { ...next, presence: "INSTALLED" }] };
}

export function removeInstalledApplication(
  list: readonly OSShellApplicationRecord[],
  appId: string,
): { list: OSShellApplicationRecord[]; removed: OSShellApplicationRecord | null } {
  const removed = list.find((item) => item.appId === appId) ?? null;
  if (!removed) return { list: [...list], removed: null };
  if (!removed.removable) return { list: [...list], removed: null };
  return { list: list.filter((item) => item.appId !== appId), removed };
}

export function findApplicationById(list: readonly OSShellApplicationRecord[], appId: string): OSShellApplicationRecord | null {
  return list.find((item) => item.appId === appId) ?? null;
}

export function findApplicationByOrigin(list: readonly OSShellApplicationRecord[], origin: string): OSShellApplicationRecord | null {
  const normalized = originOf(origin) ?? origin;
  return list.find((item) => item.origin === normalized) ?? null;
}

export function markApplicationRunning(
  list: readonly OSShellApplicationRecord[],
  appId: string,
): OSShellApplicationRecord[] {
  return list.map((item) => (item.appId === appId ? { ...item, presence: "RUNNING" as const } : item));
}

export function markApplicationInstalled(
  list: readonly OSShellApplicationRecord[],
  appId: string,
): OSShellApplicationRecord[] {
  return list.map((item) =>
    item.appId === appId && item.presence === "RUNNING" ? { ...item, presence: "INSTALLED" as const } : item,
  );
}

/** First-party catalog entries for reinstall after user removal of remountables. */
export function availableCatalogEntries(installed: readonly OSShellApplicationRecord[]): OSShellApplicationRecord[] {
  const seeded = seedApplicationCatalog();
  const installedIds = new Set(installed.map((item) => item.appId));
  return seeded.filter((item) => !installedIds.has(item.appId)).map((item) => ({ ...item, presence: "DISCOVERED" as const }));
}

export function threeApplicationTestIds(): readonly string[] {
  return ["lifeos", "mybrandos", "shell-demo-notes"] as const;
}

export function isSeededEcosystemApp(appId: string): boolean {
  return threeApplicationTestIds().includes(appId) || NATIVE_APP_DESCRIPTORS.some((item) => item.id === appId);
}

export function demoNotesOrigin(): string {
  return DEFAULT_DEMO_ORIGINS[0]!;
}

export function defaultManifestPath(): string {
  return WELL_KNOWN_MANIFEST_PATH;
}

export function capabilitiesDoNotInstallWithApp(): false {
  return false;
}

export function classCapabilitiesHint(appClass: AppClass): readonly PublicCapability[] {
  return allowedCapabilitiesForClass(appClass);
}
