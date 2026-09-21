import type {
  DirectoryApplicationView,
  ExperienceAvailability,
  ExperienceRegistryEntry,
  OfflineCapability,
} from "@digiconomy/xperience-contract";
import { normalizeOfflineCapability } from "@digiconomy/xperience-contract";
import { MYBRANDOS_PUBLIC_ENTRY } from "./bootstrap.js";
import { filterDiscoverableCatalog, readSignedCatalog } from "./catalog.js";
import { readRegistry, registryToDirectoryView } from "./registry.js";

export const LINEUP_KEY = "ox.experience-lineup.v1";

export interface LineupEntry {
  experienceId: string;
  name: string;
  entrypoint: string;
  origin: string;
  authMode: ExperienceRegistryEntry["authMode"];
  offlineCapability: OfflineCapability;
  availability: ExperienceAvailability;
}

export function resolveAvailability(
  offlineCapability: OfflineCapability | undefined,
  online: boolean,
  status?: ExperienceRegistryEntry["status"],
): ExperienceAvailability {
  if (status === "UNAVAILABLE") return "DISABLED";
  const cap = normalizeOfflineCapability(offlineCapability);
  if (online) {
    if (status === "ONLINE_ONLY" || cap === "NONE") return "AVAILABLE";
    return "AVAILABLE";
  }
  if (cap === "NONE") return "CONNECTION_REQUIRED";
  if (cap === "SHELL_ONLY" || cap === "PARTIAL" || cap === "FULL") return "OFFLINE_AVAILABLE";
  return "CONNECTION_REQUIRED";
}

export function buildLineup(options?: {
  online?: boolean;
  membershipIds?: string[];
  apps?: DirectoryApplicationView[];
}): LineupEntry[] {
  const online = options?.online ?? true;
  const registry = readRegistry();
  const byId = new Map(registry.map((entry) => [entry.experienceId, entry]));

  // Prefer explicit membership order when provided; else registry order; always seed mybrandOS.
  let ids =
    options?.membershipIds?.filter(Boolean) ??
    registry.map((entry) => entry.experienceId);

  if (options?.apps?.length) {
    for (const app of options.apps) {
      if (!byId.has(app.id)) {
        byId.set(app.id, {
          experienceId: app.id,
          name: app.name,
          version: app.version,
          entrypoint: app.xperienceUrl || app.productionUrl,
          origin: app.origin,
          authMode: app.authMode ?? "PUBLIC",
          offlineCapability: app.offlineCapability ?? "NONE",
          status: "READY",
          lastUpdatedAt: new Date().toISOString(),
          managementUrl: app.managementUrl,
          category: app.category,
          description: app.description,
        });
      }
      if (!ids.includes(app.id)) ids.push(app.id);
    }
  }

  if (ids.length === 0) {
    ids = [MYBRANDOS_PUBLIC_ENTRY.experienceId];
    byId.set(MYBRANDOS_PUBLIC_ENTRY.experienceId, MYBRANDOS_PUBLIC_ENTRY);
  } else if (!ids.includes(MYBRANDOS_PUBLIC_ENTRY.experienceId) && !byId.has(MYBRANDOS_PUBLIC_ENTRY.experienceId)) {
    // Keep bootstrap available for X2 single-channel installs.
    byId.set(MYBRANDOS_PUBLIC_ENTRY.experienceId, MYBRANDOS_PUBLIC_ENTRY);
    ids = [MYBRANDOS_PUBLIC_ENTRY.experienceId, ...ids];
  }

  const seen = new Set<string>();
  const out: LineupEntry[] = [];
  const discoverable = new Set(
    filterDiscoverableCatalog(readSignedCatalog()).map((item) => item.experienceId),
  );
  // Until a signed catalog exists, keep X1/X2 bootstrap behavior.
  const catalogActive = Boolean(readSignedCatalog());

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) continue;
    if (catalogActive && discoverable.size > 0 && !discoverable.has(id)) continue;
    // Locked-by-release: show as LOCKED availability when present in device catalog but not discoverable
    out.push({
      experienceId: entry.experienceId,
      name: entry.name,
      entrypoint: entry.entrypoint,
      origin: entry.origin,
      authMode: entry.authMode,
      offlineCapability: entry.offlineCapability,
      availability: resolveAvailability(entry.offlineCapability, online, entry.status),
    });
  }
  return out;
}

export function lineupToApps(lineup: LineupEntry[]): DirectoryApplicationView[] {
  return lineup.map((item) => {
    const entry = readRegistry().find((row) => row.experienceId === item.experienceId);
    if (entry) return registryToDirectoryView(entry);
    return {
      id: item.experienceId,
      name: item.name,
      version: "1.0.0",
      origin: item.origin,
      productionUrl: item.entrypoint,
      xperienceUrl: item.entrypoint,
      canManage: false,
      authMode: item.authMode,
      offlineCapability: item.offlineCapability,
      category: "General" as const,
      capabilities: [],
      publicationState: "PUBLISHED" as const,
      experienced: true,
      experienceStatus: "ACTIVE" as const,
    };
  });
}
