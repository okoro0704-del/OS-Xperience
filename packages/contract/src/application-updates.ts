import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { originOf } from "./url.js";

export type OSShellUpdateStatus = "current" | "update_available" | "unknown" | "unavailable";

export interface OSShellUpdateInfo {
  currentVersion: string;
  availableVersion?: string;
  status: OSShellUpdateStatus;
}

export function updateInfoFor(record: OSShellApplicationRecord): OSShellUpdateInfo {
  const current = record.version;
  const available = record.availableVersion ?? undefined;
  if (!available) return { currentVersion: current, status: "unknown" };
  if (available === current) return { currentVersion: current, availableVersion: available, status: "current" };
  if (compareSemverLike(available, current) > 0) {
    return { currentVersion: current, availableVersion: available, status: "update_available" };
  }
  return { currentVersion: current, availableVersion: available, status: "current" };
}

/** DEVELOPMENT / SIMULATION ONLY helper for local update metadata. */
export function withSimulatedUpdate(
  record: OSShellApplicationRecord,
  availableVersion: string,
): OSShellApplicationRecord {
  return { ...record, availableVersion, updatedAt: new Date().toISOString() };
}

export type OriginChangeResult =
  | { ok: true; preserveGrants: false; preserveTrust: false; requiresReinstall: true }
  | { ok: false; code: "origin_unverified" | "origin_unchanged"; detail: string };

/**
 * Origin is security authority. Same appId + different origin never silently migrates grants/trust.
 */
export function evaluateOriginChange(input: {
  appId: string;
  previousOrigin: string;
  nextOrigin: string;
}): OriginChangeResult {
  const previous = originOf(input.previousOrigin);
  const next = originOf(input.nextOrigin);
  if (!previous || !next) {
    return { ok: false, code: "origin_unverified", detail: "Both previous and next origins must be valid http(s) origins." };
  }
  if (previous === next) {
    return { ok: false, code: "origin_unchanged", detail: "Origin did not change." };
  }
  return { ok: true, preserveGrants: false, preserveTrust: false, requiresReinstall: true };
}

/** Same appId + same origin + new version may preserve identity. */
export function applySameOriginUpdate(
  record: OSShellApplicationRecord,
  nextVersion: string,
  now = new Date(),
): OSShellApplicationRecord {
  return {
    ...record,
    version: nextVersion,
    availableVersion: null,
    updatedAt: now.toISOString(),
    presence: record.presence === "RUNNING" ? "RUNNING" : "INSTALLED",
  };
}

export function compareSemverLike(a: string, b: string): number {
  const pa = parseParts(a);
  const pb = parseParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i]! !== pb[i]!) return pa[i]! > pb[i]! ? 1 : -1;
  }
  return 0;
}

function parseParts(version: string): [number, number, number] {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
