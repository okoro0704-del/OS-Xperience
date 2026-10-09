import { readJson, writeJson } from "../local/storage.js";
import { MAX_TARGET_NAME, isTargetId, targetKey, type InstallTargetType } from "./target.js";

/**
 * Local installation registry: which targets this installation has given a launch entry, and
 * where that entry stands on the platform. It is an index, not a store of continuity — a SPACE
 * row points at its Space Launch File V1 registration, Space Installation V1 home-entry record
 * and Offline Kernel state, and never copies them.
 */
export const INSTALLED_TARGETS_KEY = "ox.installed-targets.v1";

export type InstallationPlatform = "ANDROID" | "IOS" | "WEB";

/**
 * PENDING_CONFIRMATION — the platform must still confirm (launcher dialog, browser prompt, Share sheet).
 * CONFIRMED            — the platform reported the entry created or already present.
 */
export type LaunchEntryState = "PENDING_CONFIRMATION" | "CONFIRMED";

export interface InstalledTarget {
  type: InstallTargetType;
  id: string;
  key: string;
  /** Trusted presentation name at install time — never identity. */
  label: string;
  version?: string;
  platform: InstallationPlatform;
  launchEntryState: LaunchEntryState;
  installedAt: string;
  updatedAt: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const PLATFORMS = new Set<InstallationPlatform>(["ANDROID", "IOS", "WEB"]);
const ROW_KEYS = new Set(["type", "id", "key", "label", "version", "platform", "launchEntryState", "installedAt", "updatedAt"]);

function isRow(value: unknown): value is InstalledTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<InstalledTarget>;
  return (
    Object.keys(row).every((key) => ROW_KEYS.has(key)) &&
    (row.type === "APP" || row.type === "SPACE") &&
    isTargetId(row.id) &&
    row.key === targetKey(row.type, row.id) &&
    typeof row.label === "string" && row.label.trim().length > 0 && row.label.length <= MAX_TARGET_NAME && !CONTROL.test(row.label) &&
    (row.version === undefined || (typeof row.version === "string" && row.version.length <= 64)) &&
    PLATFORMS.has(row.platform as InstallationPlatform) &&
    (row.launchEntryState === "PENDING_CONFIRMATION" || row.launchEntryState === "CONFIRMED") &&
    typeof row.installedAt === "string" && typeof row.updatedAt === "string"
  );
}

/** Malformed, forged (key not derived from type+id) or duplicated rows are ignored. */
export function readInstalledTargets(): InstalledTarget[] {
  const raw = readJson<{ schemaVersion?: unknown; targets?: unknown }>(INSTALLED_TARGETS_KEY);
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.targets)) return [];
  const seen = new Set<string>();
  return raw.targets.filter((row): row is InstalledTarget => {
    if (!isRow(row) || seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}

function write(targets: InstalledTarget[]): void {
  writeJson(INSTALLED_TARGETS_KEY, { schemaVersion: 1, targets });
}

export function findInstalledTarget(type: InstallTargetType, id: string): InstalledTarget | null {
  const key = targetKey(type, id);
  return readInstalledTargets().find((row) => row.key === key) ?? null;
}

/** One row per (type, id): reinstalling refreshes it, never duplicates it. */
export function recordInstalledTarget(
  input: { type: InstallTargetType; id: string; label: string; version?: string; platform: InstallationPlatform; launchEntryState: LaunchEntryState },
  now = new Date(),
): InstalledTarget {
  const rows = readInstalledTargets();
  const key = targetKey(input.type, input.id);
  const existing = rows.find((row) => row.key === key);
  const row: InstalledTarget = {
    type: input.type,
    id: input.id,
    key,
    label: input.label.trim().slice(0, MAX_TARGET_NAME),
    ...(input.version ? { version: input.version.slice(0, 64) } : {}),
    platform: input.platform,
    launchEntryState: input.launchEntryState,
    installedAt: existing?.installedAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  if (!isRow(row)) throw new Error("INVALID_INSTALLED_TARGET");
  write([...rows.filter((item) => item.key !== key), row]);
  return row;
}

export function confirmInstalledTarget(type: InstallTargetType, id: string, now = new Date()): InstalledTarget | null {
  const existing = findInstalledTarget(type, id);
  if (!existing || existing.launchEntryState === "CONFIRMED") return existing;
  return recordInstalledTarget({ ...existing, launchEntryState: "CONFIRMED" }, now);
}

/** Removes the index row only. Space registration, home-entry record and offline data are untouched. */
export function removeInstalledTarget(type: InstallTargetType, id: string): boolean {
  const rows = readInstalledTargets();
  const key = targetKey(type, id);
  const next = rows.filter((row) => row.key !== key);
  if (next.length === rows.length) return false;
  write(next);
  return true;
}
