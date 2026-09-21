import {
  normalizeExperienceAuthMode,
  normalizeOfflineCapability,
  type DirectoryApplicationView,
  type ExperienceRegistryEntry,
} from "@digiconomy/xperience-contract";
import { MYBRANDOS_PUBLIC_ENTRY } from "./bootstrap.js";
import { readJson, writeJson } from "./storage.js";

export const REGISTRY_KEY = "ox.experience-registry.v1";

function isEntry(value: unknown): value is ExperienceRegistryEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.experienceId === "string" &&
    typeof row.name === "string" &&
    typeof row.entrypoint === "string" &&
    typeof row.origin === "string"
  );
}

export function readRegistry(): ExperienceRegistryEntry[] {
  const raw = readJson<unknown>(REGISTRY_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isEntry).map((entry) => ({
    ...entry,
    authMode: normalizeExperienceAuthMode(entry.authMode),
    offlineCapability: normalizeOfflineCapability(entry.offlineCapability),
    version: entry.version || "0.0.0",
    status: entry.status === "UNAVAILABLE" || entry.status === "ONLINE_ONLY" ? entry.status : "READY",
    lastUpdatedAt: entry.lastUpdatedAt || new Date(0).toISOString(),
  }));
}

export function writeRegistry(entries: ExperienceRegistryEntry[]): void {
  writeJson(REGISTRY_KEY, entries);
}

export function upsertRegistryEntry(entry: ExperienceRegistryEntry): ExperienceRegistryEntry[] {
  const current = readRegistry();
  const next = [...current.filter((item) => item.experienceId !== entry.experienceId), entry];
  writeRegistry(next);
  return next;
}

export function findRegistryEntry(experienceId: string): ExperienceRegistryEntry | null {
  return readRegistry().find((item) => item.experienceId === experienceId) ?? null;
}

export function directoryToRegistryEntry(app: DirectoryApplicationView): ExperienceRegistryEntry {
  return {
    experienceId: app.id,
    name: app.name,
    version: app.version,
    entrypoint: app.xperienceUrl || app.productionUrl,
    origin: app.origin,
    authMode: normalizeExperienceAuthMode(app.authMode),
    offlineCapability: normalizeOfflineCapability(app.offlineCapability),
    status: app.publicationState === "PUBLISHED" ? "READY" : "UNAVAILABLE",
    lastUpdatedAt: new Date().toISOString(),
    ...(app.managementUrl ? { managementUrl: app.managementUrl } : {}),
    category: app.category,
    description: app.description,
  };
}

export function syncRegistryFromDirectory(apps: DirectoryApplicationView[]): ExperienceRegistryEntry[] {
  const byId = new Map<string, ExperienceRegistryEntry>();
  for (const entry of readRegistry()) byId.set(entry.experienceId, entry);
  for (const app of apps) {
    byId.set(app.id, directoryToRegistryEntry(app));
  }
  // Keep bootstrap mybrandOS if directory has no public mybrandOS yet.
  if (![...byId.values()].some(isMybrandPublic)) {
    byId.set(MYBRANDOS_PUBLIC_ENTRY.experienceId, MYBRANDOS_PUBLIC_ENTRY);
  }
  const next = [...byId.values()];
  writeRegistry(next);
  return next;
}

export function ensureBootstrapRegistry(): ExperienceRegistryEntry[] {
  const current = readRegistry();
  if (current.length > 0) return current;
  writeRegistry([MYBRANDOS_PUBLIC_ENTRY]);
  return [MYBRANDOS_PUBLIC_ENTRY];
}

export function isMybrandPublic(entry: {
  name: string;
  origin: string;
  experienceId?: string;
  id?: string;
}): boolean {
  const id = entry.experienceId ?? entry.id;
  if (id === MYBRANDOS_PUBLIC_ENTRY.experienceId) return true;
  const name = entry.name.toLowerCase();
  if (name.includes("mybrandos") && !name.includes("studio")) return true;
  try {
    const host = new URL(entry.origin).hostname.toLowerCase();
    return host.includes("mrfundzman") || host.includes("mybrandos");
  } catch {
    return false;
  }
}

export function registryToDirectoryView(entry: ExperienceRegistryEntry): DirectoryApplicationView {
  return {
    id: entry.experienceId,
    name: entry.name,
    version: entry.version,
    origin: entry.origin,
    productionUrl: entry.entrypoint,
    xperienceUrl: entry.entrypoint,
    ...(entry.managementUrl ? { managementUrl: entry.managementUrl } : {}),
    canManage: false,
    authMode: entry.authMode,
    offlineCapability: entry.offlineCapability,
    category: (entry.category as DirectoryApplicationView["category"]) || "General",
    capabilities: [],
    publicationState: entry.status === "UNAVAILABLE" ? "NOT_PUBLISHED" : "PUBLISHED",
    experienced: true,
    experienceStatus: "ACTIVE",
    description: entry.description,
    ecosystemSource: "LIFEOS",
  };
}
