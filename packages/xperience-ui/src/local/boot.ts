import type {
  DirectoryApplicationView,
  ExperienceMembershipView,
  ExperienceRegistryEntry,
  LastExperienceState,
  OpenExperiencePayload,
  XperienceInstallation,
} from "@digiconomy/xperience-contract";
import { canOperateOffline, buildLocalOpenPayload, entryToOpenApp, shellAuthPosture } from "./auth-contract.js";
import { MYBRANDOS_PUBLIC_ENTRY, MYBRANDOS_PUBLIC_ID } from "./bootstrap.js";
import { ensureInstallation, updateInstallationLastExperience } from "./installation.js";
import {
  ensureBootstrapRegistry,
  findRegistryEntry,
  isMybrandPublic,
  readRegistry,
  registryToDirectoryView,
  syncRegistryFromDirectory,
} from "./registry.js";
import { getExperienceSlot, readLastExperience, touchExperienceSlot } from "./session.js";

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
    payload: OpenExperiencePayload | null;
    offlineBlocked: boolean;
    offlineMessage?: string;
    shellAuth: ReturnType<typeof shellAuthPosture>;
  } | null;
  /** True when no network API was used for this boot path. */
  usedNetwork: boolean;
  /** Always false — Xperience has no login gate. */
  requiresXperienceLogin: false;
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

export function bootFromLocal(options?: { online?: boolean }): XperienceBootResult {
  const online = options?.online ?? (typeof navigator !== "undefined" ? navigator.onLine : false);
  const installation = ensureInstallation();
  let registry = ensureBootstrapRegistry();
  if (registry.length === 0) {
    registry = [MYBRANDOS_PUBLIC_ENTRY];
  }

  const directory = registry.map(registryToDirectoryView);
  const featured = directory.filter(isMybrandPublic).slice(0, 4);
  const featuredFallback = featured.length ? featured : directory.slice(0, 4);
  const memberships = registry.map(membershipFromEntry);

  const lastExperience = readLastExperience();
  let restore: XperienceBootResult["restore"] = null;

  const targetId =
    lastExperience?.lastExperienceId ??
    installation.lastExperienceId ??
    (registry.some((e) => e.experienceId === MYBRANDOS_PUBLIC_ID)
      ? MYBRANDOS_PUBLIC_ID
      : registry.find(isMybrandPublic)?.experienceId);

  if (targetId) {
    const entry = findRegistryEntry(targetId) ?? registry.find((e) => e.experienceId === targetId);
    if (entry) {
      const app = entryToOpenApp(entry);
      const shellAuth = shellAuthPosture(entry.authMode);
      const offlineCheck = canOperateOffline(entry.offlineCapability, online);
      if (!offlineCheck.ok) {
        restore = {
          app,
          payload: null,
          offlineBlocked: true,
          offlineMessage: offlineCheck.reason,
          shellAuth,
        };
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
        restore = { app, payload, offlineBlocked: false, shellAuth };
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
): void {
  touchExperienceSlot({
    experienceId: app.id,
    surface,
    route,
  });
  updateInstallationLastExperience(app.id);
}

export { MYBRANDOS_PUBLIC_ENTRY, MYBRANDOS_PUBLIC_ID };
