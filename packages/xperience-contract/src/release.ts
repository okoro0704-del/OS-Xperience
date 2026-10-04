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

/**
 * Execution modes of one provider. APP runs the provider's own UI on the Online Kernel;
 * SPACE runs the provider through the Offline Kernel. Both share the provider identity.
 */
export const EXPERIENCE_EXECUTION_MODES = ["APP", "SPACE"] as const;
export type ExperienceExecutionMode = (typeof EXPERIENCE_EXECUTION_MODES)[number];

export function normalizeExecutionMode(value: unknown): ExperienceExecutionMode | null {
  return value === "APP" || value === "SPACE" ? value : null;
}

/** One execution mode declared on a provider's catalog entry. */
export interface CatalogExecutionTarget {
  mode: ExperienceExecutionMode;
  /** Defaults to the provider entrypoint. */
  entrypoint?: string;
  /** Mode-level gate; the provider-level release still applies first. */
  releaseState?: ExperienceReleaseState;
  visibility?: ExperienceVisibility;
  /** SPACE: broadcast channel the Offline Kernel hydrates for this provider. */
  broadcastChannelId?: string;
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
  /** Absent means APP only. */
  executionModes?: CatalogExecutionTarget[];
}

export type ExperienceTargetAvailability = "AVAILABLE" | "NOT_RELEASED" | "NOT_LISTED";

/** A launchable (provider, execution mode) pair resolved from catalog or registry data. */
export interface ExperienceTarget {
  providerId: string;
  executionMode: ExperienceExecutionMode;
  entrypoint: string;
  /** Undefined when the source carries no release data (local registry without a signed catalog). */
  releaseState?: ExperienceReleaseState;
  visibility?: ExperienceVisibility;
  availability: ExperienceTargetAvailability;
  broadcastChannelId?: string;
}

export interface ExperienceTargetSource {
  experienceId: string;
  entrypoint: string;
  releaseState?: ExperienceReleaseState;
  visibility?: ExperienceVisibility;
  executionModes?: CatalogExecutionTarget[];
}

function gateAvailability(
  releaseState: ExperienceReleaseState | undefined,
  visibility: ExperienceVisibility | undefined,
): ExperienceTargetAvailability {
  if (releaseState === undefined) return "AVAILABLE";
  if (releaseState !== "LIVE") return "NOT_RELEASED";
  return isConsumerDiscoverable(releaseState, visibility ?? "HIDDEN") ? "AVAILABLE" : "NOT_LISTED";
}

export function declaredExecutionModes(source: Pick<ExperienceTargetSource, "executionModes">): CatalogExecutionTarget[] {
  const declared = (source.executionModes ?? []).filter((item) => normalizeExecutionMode(item?.mode));
  if (declared.length === 0) return [{ mode: "APP" }];
  const seen = new Set<ExperienceExecutionMode>();
  return declared.filter((item) => (seen.has(item.mode) ? false : (seen.add(item.mode), true)));
}

/**
 * Every declared mode of a provider, gated by provider release first and mode release second.
 * Presentation (phone/tablet/desktop/TV) and platform never participate.
 */
export function resolveExperienceTargets(source: ExperienceTargetSource): ExperienceTarget[] {
  const providerGate = gateAvailability(source.releaseState, source.visibility);
  return declaredExecutionModes(source).map((mode) => {
    const modeGate = gateAvailability(mode.releaseState, mode.visibility);
    const providerBlocks = providerGate !== "AVAILABLE";
    return {
      providerId: source.experienceId,
      executionMode: mode.mode,
      entrypoint: mode.entrypoint || source.entrypoint,
      releaseState: providerBlocks ? source.releaseState : (mode.releaseState ?? source.releaseState),
      visibility: providerBlocks ? source.visibility : (mode.visibility ?? source.visibility),
      availability: providerBlocks ? providerGate : modeGate,
      ...(mode.broadcastChannelId ? { broadcastChannelId: mode.broadcastChannelId } : {}),
    };
  });
}

export function availableExperienceTargets(source: ExperienceTargetSource): ExperienceTarget[] {
  return resolveExperienceTargets(source).filter((target) => target.availability === "AVAILABLE");
}

export function findExperienceTarget(
  source: ExperienceTargetSource,
  mode: ExperienceExecutionMode,
): ExperienceTarget | null {
  return availableExperienceTargets(source).find((target) => target.executionMode === mode) ?? null;
}

/** Consumer catalogs only carry modes a consumer may discover. */
export function withDiscoverableExecutionModes(entry: CatalogExperienceEntry): CatalogExperienceEntry {
  if (!entry.executionModes) return entry;
  const allowed = new Set(availableExperienceTargets(entry).map((target) => target.executionMode));
  return { ...entry, executionModes: entry.executionModes.filter((mode) => allowed.has(mode.mode)) };
}

export interface ExperienceCatalogPayload {
  manifestVersion: number;
  generatedAt: string;
  expiresAt: string;
  experiences: CatalogExperienceEntry[];
}

export interface SignedExperienceCatalog {
  payload: ExperienceCatalogPayload;
  /** Base64 Ed25519 signature over canonical JSON of payload. */
  signature: string;
  algorithm: "Ed25519";
}

/** Deterministic JSON for signing — sorted object keys, no whitespace variance. */
export function canonicalCatalogJson(payload: ExperienceCatalogPayload): string {
  return canonicalJson(payload);
}

/** The signing canonicalization shared by every signed Xperience artifact. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
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

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]!);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

export interface CatalogKeyPairExport {
  publicKeySpkiBase64: string;
  privateKeyPkcs8Base64: string;
}

/** Generate an Ed25519 key pair. Private key must stay on the server only. */
export async function generateCatalogSigningKeyPair(): Promise<
  CatalogKeyPairExport & { publicKey: CryptoKey; privateKey: CryptoKey }
> {
  const pair = (await crypto.subtle.generateKey("Ed25519" as AlgorithmIdentifier, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeySpkiBase64: bytesToBase64(spki),
    privateKeyPkcs8Base64: bytesToBase64(pkcs8),
  };
}

export async function importCatalogPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    asBufferSource(base64ToBytes(spkiBase64)),
    "Ed25519" as AlgorithmIdentifier,
    true,
    ["verify"],
  );
}

export async function importCatalogPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    asBufferSource(base64ToBytes(pkcs8Base64)),
    "Ed25519" as AlgorithmIdentifier,
    false,
    ["sign"],
  );
}

export async function signExperienceCatalog(
  payload: ExperienceCatalogPayload,
  privateKey: CryptoKey | string,
): Promise<SignedExperienceCatalog> {
  const key =
    typeof privateKey === "string" ? await importCatalogPrivateKey(privateKey) : privateKey;
  const data = new TextEncoder().encode(canonicalCatalogJson(payload));
  const signature = await crypto.subtle.sign("Ed25519" as AlgorithmIdentifier, key, data);
  return { payload, signature: bytesToBase64(signature), algorithm: "Ed25519" };
}

export async function verifyExperienceCatalog(
  catalog: SignedExperienceCatalog,
  publicKey: CryptoKey | string,
): Promise<boolean> {
  if (catalog.algorithm !== "Ed25519") return false;
  if (!catalog.payload || !Array.isArray(catalog.payload.experiences)) return false;
  if (Date.parse(catalog.payload.expiresAt) < Date.now()) return false;
  try {
    const key =
      typeof publicKey === "string" ? await importCatalogPublicKey(publicKey) : publicKey;
    const data = new TextEncoder().encode(canonicalCatalogJson(catalog.payload));
    return await crypto.subtle.verify(
      "Ed25519" as AlgorithmIdentifier,
      key,
      asBufferSource(base64ToBytes(catalog.signature)),
      data,
    );
  } catch {
    return false;
  }
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
