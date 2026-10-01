import type { XperienceInstallation } from "@digiconomy/xperience-contract";
import { readJson, writeJson } from "./storage.js";

export const INSTALLATION_KEY = "ox.installation.v1";
/** Recorded when the host supplies no generated runtime stamp; OS Xperience passes its ox-versions.json stamp. */
export const UNSTAMPED_RUNTIME_VERSION = "unstamped";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ox-install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isInstallation(value: unknown): value is XperienceInstallation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.installationId === "string" &&
    row.installationId.length > 0 &&
    typeof row.createdAt === "string" &&
    typeof row.lastOpenedAt === "string" &&
    typeof row.runtimeVersion === "string"
  );
}

/**
 * Ensure a local installation identity exists.
 * This is device/install continuity — never TrustID / PDI / human verification.
 */
export function ensureInstallation(now = new Date(), runtimeVersion?: string): XperienceInstallation {
  const existing = readJson<unknown>(INSTALLATION_KEY);
  if (isInstallation(existing)) {
    const next: XperienceInstallation = {
      ...existing,
      lastOpenedAt: now.toISOString(),
      runtimeVersion: runtimeVersion || existing.runtimeVersion || UNSTAMPED_RUNTIME_VERSION,
    };
    writeJson(INSTALLATION_KEY, next);
    return next;
  }
  const created: XperienceInstallation = {
    installationId: newId(),
    createdAt: now.toISOString(),
    lastOpenedAt: now.toISOString(),
    runtimeVersion: runtimeVersion || UNSTAMPED_RUNTIME_VERSION,
  };
  writeJson(INSTALLATION_KEY, created);
  return created;
}

export function readInstallation(): XperienceInstallation | null {
  const existing = readJson<unknown>(INSTALLATION_KEY);
  return isInstallation(existing) ? existing : null;
}

export function updateInstallationLastExperience(experienceId: string, now = new Date()): XperienceInstallation {
  const base = ensureInstallation(now);
  const next: XperienceInstallation = {
    ...base,
    lastExperienceId: experienceId,
    lastOpenedAt: now.toISOString(),
  };
  writeJson(INSTALLATION_KEY, next);
  return next;
}
