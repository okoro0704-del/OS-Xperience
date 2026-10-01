import type {
  DirectoryApplicationView,
  ExperienceExecutionMode,
  ExperienceMembershipView,
  ExperienceRegistryEntry,
  LastExperienceState,
  OpenExperiencePayload,
  XperienceInstallation,
} from "@digiconomy/xperience-contract";
import { canOperateOffline, buildLocalOpenPayload, entryToOpenApp, shellAuthPosture } from "./auth-contract.js";
import { MYBRANDOS_PUBLIC_ENTRY, MYBRANDOS_PUBLIC_ID, bootstrapPublicEntry } from "./bootstrap.js";
import { ensureInstallation, updateInstallationLastExperience } from "./installation.js";
import { canonicalProviderId, resolveDirectoryProviders, resolveMemberships } from "./providers.js";
import {
  ensureBootstrapRegistry,
  findRegistryEntry,
  isMybrandPublic,
  readRegistry,
  registryToDirectoryView,
  syncRegistryFromDirectory,
} from "./registry.js";
import { getExperienceSlot, readLastExperience, touchExperienceSlot } from "./session.js";
import { enterXperienceMode, readRuntimeMode } from "./mode.js";

export interface XperienceBootResult {
  installation: XperienceInstallation;
  registry: ExperienceRegistryEntry[];
  directory: DirectoryApplicationView[];
  featured: DirectoryApplicationView[];
  memberships: ExperienceMembershipView[];
  lastExperience: LastExperienceState | null;
  /** When set, UI should restore this Experience (or show offline gate). */
  restore: {
    app: DirectoryApplicationView;
    /** Mode the provider was last running in; undefined for records written before modes existed. */
    executionMode?: ExperienceExecutionMode;
    payload: OpenExperiencePayload | null;
    offlineBlocked: boolean;
    offlineMessage?: string;
    shellAuth: ReturnType<typeof shellAuthPosture>;
  } | null;
  /** True when no network API was used for this boot path. */
  usedNetwork: boolean;
  /** Always false — Xperience has no login gate. */
  requiresXperienceLogin: false;
  /** Last shell mode — XPERIENCE restores immediately without Home. */
  lastMode: "HOME" | "XPERIENCE";
}

function membershipFromEntry(entry: ExperienceRegistryEntry): ExperienceMembershipView {
  const application = registryToDirectoryView(entry);
  const slot = getExperienceSlot(entry.experienceId);
  return {
    applicationId: entry.experienceId,
    status: "ACTIVE",
    addedAt: entry.lastUpdatedAt,
    lastOpenedAt: slot?.lastActiveAt,
    application,
  };
}

export function bootFromLocal(options?: {
  online?: boolean;
  lockedExperienceId?: string | null;
  /** X1 first-open auto-entry. General directory hosts disable it so first open lands on the Directory. */
  restoreOnFirstOpen?: boolean;
  /** Host's generated runtime stamp (OS Xperience: ox-versions.json). */
  runtimeVersion?: string;
}): XperienceBootResult {
  const online = options?.online ?? (typeof navigator !== "undefined" ? navigator.onLine : false);
  const installation = ensureInstallation(new Date(), options?.runtimeVersion);
  const lastMode = readRuntimeMode();
  let registry = ensureBootstrapRegistry();
  if (registry.length === 0) {
    registry = [MYBRANDOS_PUBLIC_ENTRY];
  }

  const directory = resolveDirectoryProviders(registry.map(registryToDirectoryView));
  const featured = directory.filter(isMybrandPublic).slice(0, 4);
  const featuredFallback = featured.length ? featured : directory.slice(0, 4);
  const memberships = resolveMemberships(registry.map(membershipFromEntry));

  const lastExperience = readLastExperience();
  let restore: XperienceBootResult["restore"] = null;

  // X2: restore only when last mode was XPERIENCE, or first open (X1 bootstrap).
  // Leaving to Home sets mode HOME — do not force Experience again.
  const firstOpen = !lastExperience;
  const shouldRestore = lastMode === "XPERIENCE" || (firstOpen && options?.restoreOnFirstOpen !== false);

  const restoredTargetId =
    lastExperience?.lastExperienceId ??
    installation.lastExperienceId ??
    (registry.some((e) => e.experienceId === MYBRANDOS_PUBLIC_ID)
      ? MYBRANDOS_PUBLIC_ID
      : registry.find(isMybrandPublic)?.experienceId);
  // A restored live record resumes as the canonical provider it is bound to.
  const restoredRecord = restoredTargetId ? findRegistryEntry(restoredTargetId) : null;
  const canonicalRestoredId = restoredRecord
    ? canonicalProviderId({ id: restoredRecord.experienceId, origin: restoredRecord.origin })
    : restoredTargetId;
  // A host-configured lock normalizes stale state before any frame is resolved.
  const targetId = options?.lockedExperienceId ?? canonicalRestoredId;

  if (shouldRestore && targetId) {
    const entry =
      findRegistryEntry(targetId) ??
      registry.find((e) => e.experienceId === targetId) ??
      (targetId === MYBRANDOS_PUBLIC_ID ? bootstrapPublicEntry() : undefined);
    if (entry) {
      const app = entryToOpenApp(entry);
      const lastId = lastExperience?.lastExperienceId;
      const executionMode =
        lastId === entry.experienceId || (lastId && lastId === restoredTargetId) ? lastExperience?.executionMode : undefined;
      const shellAuth = shellAuthPosture(entry.authMode);
      const offlineCheck = canOperateOffline(entry.offlineCapability, online);
      if (!offlineCheck.ok) {
        restore = {
          app,
          ...(executionMode ? { executionMode } : {}),
          payload: null,
          offlineBlocked: true,
          offlineMessage: offlineCheck.reason,
          shellAuth,
        };
        enterXperienceMode();
      } else {
        const surface = lastExperience?.surface === "MANAGEMENT" ? "MANAGEMENT" : "PUBLIC";
        let payload: OpenExperiencePayload | null = null;
        try {
          payload = buildLocalOpenPayload(
            {
              ...app,
              canManage: surface === "MANAGEMENT" ? Boolean(app.managementUrl && app.canManage) : false,
            },
            surface === "MANAGEMENT" && app.managementUrl && app.canManage ? "MANAGEMENT" : "PUBLIC",
          );
        } catch {
          payload = buildLocalOpenPayload(app, "PUBLIC");
        }
        restore = { app, ...(executionMode ? { executionMode } : {}), payload, offlineBlocked: false, shellAuth };
        enterXperienceMode();
      }
    }
  }

  return {
    installation,
    registry,
    directory,
    featured: featuredFallback,
    memberships,
    lastExperience,
    restore,
    usedNetwork: false,
    requiresXperienceLogin: false,
    lastMode: restore ? "XPERIENCE" : lastMode,
  };
}

export function applyOnlineDirectory(
  apps: DirectoryApplicationView[],
  memberships: ExperienceMembershipView[],
): { registry: ExperienceRegistryEntry[]; directory: DirectoryApplicationView[] } {
  const registry = syncRegistryFromDirectory(apps);
  return { registry, directory: apps.length ? apps : registry.map(registryToDirectoryView) };
}

export function rememberOpenedExperience(
  app: DirectoryApplicationView,
  surface: "PUBLIC" | "MANAGEMENT" = "PUBLIC",
  route?: string,
  executionMode?: ExperienceExecutionMode,
): void {
  touchExperienceSlot({
    experienceId: app.id,
    surface,
    route,
    ...(executionMode ? { executionMode } : {}),
  });
  updateInstallationLastExperience(app.id);
  enterXperienceMode();
}

export { MYBRANDOS_PUBLIC_ENTRY, MYBRANDOS_PUBLIC_ID };
