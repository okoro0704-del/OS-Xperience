/**
 * Phase X3 — Experience release control (separate from authMode).
 */

export const EXPERIENCE_RELEASE_STATES = [
  "DRAFT",
  "PRIVATE_TEST",
  "PRELOADED",
  "LOCKED",
  "LIVE",
  "PAUSED",
  "RETIRED",
] as const;
export type ExperienceReleaseState = (typeof EXPERIENCE_RELEASE_STATES)[number];

export const EXPERIENCE_VISIBILITIES = ["HIDDEN", "LISTED", "FEATURED"] as const;
export type ExperienceVisibility = (typeof EXPERIENCE_VISIBILITIES)[number];

export const PRELOAD_POLICIES = ["NONE", "BACKGROUND", "REQUIRED"] as const;
export type PreloadPolicy = (typeof PRELOAD_POLICIES)[number];

export const LOCAL_PACKAGE_STATES = [
  "NOT_DOWNLOADED",
  "DOWNLOADING",
  "READY",
  "FAILED",
  "STALE",
  "READY_BUT_LOCKED",
] as const;
export type LocalPackageState = (typeof LOCAL_PACKAGE_STATES)[number];

export function normalizeReleaseState(value: unknown): ExperienceReleaseState {
  if (typeof value === "string" && (EXPERIENCE_RELEASE_STATES as readonly string[]).includes(value)) {
    return value as ExperienceReleaseState;
  }
  return "DRAFT";
}

export function normalizeVisibility(value: unknown): ExperienceVisibility {
  if (value === "HIDDEN" || value === "LISTED" || value === "FEATURED") return value;
  return "HIDDEN";
}

export function normalizePreloadPolicy(value: unknown): PreloadPolicy {
  if (value === "NONE" || value === "BACKGROUND" || value === "REQUIRED") return value;
  return "NONE";
}

/** Explicit transition graph — clients cannot invent states. */
const RELEASE_GRAPH: Record<ExperienceReleaseState, ExperienceReleaseState[]> = {
  DRAFT: ["PRIVATE_TEST", "PRELOADED", "LOCKED", "RETIRED"],
  PRIVATE_TEST: ["DRAFT", "PRELOADED", "LOCKED", "LIVE", "RETIRED"],
  PRELOADED: ["LOCKED", "LIVE", "PRIVATE_TEST", "RETIRED"],
  LOCKED: ["PRELOADED", "LIVE", "PAUSED", "RETIRED"],
  LIVE: ["PAUSED", "LOCKED", "RETIRED"],
  PAUSED: ["LIVE", "LOCKED", "RETIRED"],
  RETIRED: [],
};

export function releaseTransitionAllowed(from: ExperienceReleaseState, to: ExperienceReleaseState): boolean {
  if (from === to) return true;
  return RELEASE_GRAPH[from].includes(to);
}

/** Consumer Directory / Switcher may see the Experience. */
export function isConsumerDiscoverable(
  releaseState: ExperienceReleaseState,
  visibility: ExperienceVisibility,
): boolean {
  if (releaseState !== "LIVE") return false;
  return visibility === "LISTED" || visibility === "FEATURED";
}

/** User may attempt to open (app still owns auth). */
export function canLaunchByRelease(releaseState: ExperienceReleaseState): boolean {
  return releaseState === "LIVE";
}

/** Background package fetch is allowed. */
export function canPreloadByRelease(releaseState: ExperienceReleaseState): boolean {
  return releaseState === "PRELOADED" || releaseState === "LOCKED" || releaseState === "LIVE";
}

export interface CatalogExperienceEntry {
  experienceId: string;
  name: string;
  version: string;
  entrypoint: string;
  origin: string;
  authMode: "PUBLIC" | "APP_MANAGED" | "TRUSTID";
  offlineCapability: "NONE" | "SHELL_ONLY" | "PARTIAL" | "FULL";
  releaseState: ExperienceReleaseState;
  visibility: ExperienceVisibility;
  preloadPolicy: PreloadPolicy;
  packageVersion: string;
  contentHash: string;
  packageUrl?: string;
  releasedAt?: string;
  updatedAt: string;
}

export interface ExperienceCatalogPayload {
  manifestVersion: number;
  generatedAt: string;
  expiresAt: string;
  experiences: CatalogExperienceEntry[];
}

export interface SignedExperienceCatalog {
  payload: ExperienceCatalogPayload;
  /** Hex HMAC-SHA256 over canonical JSON of payload. */
  signature: string;
  algorithm: "HMAC-SHA256";
}

/** Deterministic JSON for signing — sorted object keys, no whitespace variance. */
export function canonicalCatalogJson(payload: ExperienceCatalogPayload): string {
  return JSON.stringify(sortKeys(payload));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signExperienceCatalog(
  payload: ExperienceCatalogPayload,
  secret: string,
): Promise<SignedExperienceCatalog> {
  const signature = await hmacSha256Hex(secret, canonicalCatalogJson(payload));
  return { payload, signature, algorithm: "HMAC-SHA256" };
}

export async function verifyExperienceCatalog(
  catalog: SignedExperienceCatalog,
  secret: string,
): Promise<boolean> {
  if (catalog.algorithm !== "HMAC-SHA256") return false;
  if (!catalog.payload || !Array.isArray(catalog.payload.experiences)) return false;
  if (Date.parse(catalog.payload.expiresAt) < Date.now()) return false;
  const expected = await hmacSha256Hex(secret, canonicalCatalogJson(catalog.payload));
  return timingSafeEqualHex(expected, catalog.signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Reject unsigned local mutations that try to promote LOCKED → LIVE. */
export function assertCatalogReleaseIntegrity(
  stored: SignedExperienceCatalog | null,
  experienceId: string,
  claimedRelease: ExperienceReleaseState,
): boolean {
  if (!stored) return false;
  const entry = stored.payload.experiences.find((item) => item.experienceId === experienceId);
  if (!entry) return false;
  return entry.releaseState === claimedRelease;
}
