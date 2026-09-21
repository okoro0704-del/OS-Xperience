import {
  assertCatalogReleaseIntegrity,
  canLaunchByRelease,
  canPreloadByRelease,
  isConsumerDiscoverable,
  verifyExperienceCatalog,
  type CatalogExperienceEntry,
  type LocalPackageState,
  type SignedExperienceCatalog,
} from "@digiconomy/xperience-contract";
import { readJson, writeJson } from "./storage.js";

export const CATALOG_KEY = "ox.signed-catalog.v1";
export const CATALOG_PUBLIC_KEY_KEY = "ox.catalog-public-key.v1";
export const PACKAGE_STATE_KEY = "ox.package-states.v1";
export const REVEAL_BANNER_KEY = "ox.reveal-banner.v1";

/** Public verification key only — never a private signing key. */
export function catalogPublicKeySpki(): string | null {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const fromEnv = env?.VITE_XPERIENCE_CATALOG_PUBLIC_KEY?.trim();
  if (fromEnv) return fromEnv;
  return readJson<{ publicKeySpkiBase64?: string }>(CATALOG_PUBLIC_KEY_KEY)?.publicKeySpkiBase64 ?? null;
}

export function storeCatalogPublicKey(publicKeySpkiBase64: string): void {
  writeJson(CATALOG_PUBLIC_KEY_KEY, { publicKeySpkiBase64, algorithm: "Ed25519" });
}

export function readSignedCatalog(): SignedExperienceCatalog | null {
  return readJson<SignedExperienceCatalog>(CATALOG_KEY);
}

export async function storeSignedCatalog(
  catalog: SignedExperienceCatalog,
  publicKeySpki = catalogPublicKeySpki(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!publicKeySpki) {
    return { ok: false, reason: "Catalog public key missing — cannot verify signature." };
  }
  const valid = await verifyExperienceCatalog(catalog, publicKeySpki);
  if (!valid) return { ok: false, reason: "Catalog signature invalid or expired." };
  writeJson(CATALOG_KEY, catalog);
  return { ok: true };
}

/** Refuse local releaseState promotion without matching signed catalog. */
export function localReleaseClaimAllowed(
  experienceId: string,
  claimed: CatalogExperienceEntry["releaseState"],
): boolean {
  return assertCatalogReleaseIntegrity(readSignedCatalog(), experienceId, claimed);
}

export function readPackageStates(): Record<string, LocalPackageState> {
  return readJson<Record<string, LocalPackageState>>(PACKAGE_STATE_KEY) ?? {};
}

export function writePackageState(experienceId: string, state: LocalPackageState): void {
  const all = readPackageStates();
  all[experienceId] = state;
  writeJson(PACKAGE_STATE_KEY, all);
}

export function getPackageState(experienceId: string): LocalPackageState {
  return readPackageStates()[experienceId] ?? "NOT_DOWNLOADED";
}

/**
 * Preload engine: fetch package URL, verify content hash marker, mark READY_BUT_LOCKED / READY.
 * Does not execute the Experience.
 */
export async function preloadExperiencePackage(
  entry: CatalogExperienceEntry,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalPackageState> {
  if (!canPreloadByRelease(entry.releaseState)) {
    writePackageState(entry.experienceId, "NOT_DOWNLOADED");
    return "NOT_DOWNLOADED";
  }
  writePackageState(entry.experienceId, "DOWNLOADING");
  try {
    const url = entry.packageUrl || entry.entrypoint;
    const response = await fetchImpl(url, { method: "GET", mode: "cors" });
    if (!response.ok && entry.releaseState === "LIVE") {
      writePackageState(entry.experienceId, "FAILED");
      return "FAILED";
    }
    if (entry.contentHash && !entry.contentHash.startsWith("sha256:")) {
      writePackageState(entry.experienceId, "FAILED");
      return "FAILED";
    }
    const state: LocalPackageState =
      entry.releaseState === "LIVE" ? "READY" : "READY_BUT_LOCKED";
    writePackageState(entry.experienceId, state);
    writeJson(`ox.package-meta.${entry.experienceId}`, {
      experienceId: entry.experienceId,
      packageVersion: entry.packageVersion,
      contentHash: entry.contentHash,
      entrypoint: entry.entrypoint,
      storedAt: new Date().toISOString(),
    });
    return state;
  } catch {
    if (entry.releaseState === "PRELOADED" || entry.releaseState === "LOCKED") {
      writePackageState(entry.experienceId, "READY_BUT_LOCKED");
      return "READY_BUT_LOCKED";
    }
    writePackageState(entry.experienceId, "FAILED");
    return "FAILED";
  }
}

export async function applyCatalogUpdate(
  catalog: SignedExperienceCatalog,
  options?: { fetchImpl?: typeof fetch; publicKeySpki?: string },
): Promise<{
  ok: boolean;
  reason?: string;
  newlyLive: CatalogExperienceEntry[];
  preloadResults: Record<string, LocalPackageState>;
}> {
  const stored = await storeSignedCatalog(catalog, options?.publicKeySpki ?? catalogPublicKeySpki());
  if (!stored.ok) return { ok: false, reason: stored.reason, newlyLive: [], preloadResults: {} };

  const previous = readJson<{ seenLive?: string[] }>(REVEAL_BANNER_KEY) ?? { seenLive: [] };
  const seen = new Set(previous.seenLive ?? []);
  const newlyLive: CatalogExperienceEntry[] = [];
  const preloadResults: Record<string, LocalPackageState> = {};

  for (const entry of catalog.payload.experiences) {
    if (canPreloadByRelease(entry.releaseState)) {
      preloadResults[entry.experienceId] = await preloadExperiencePackage(
        entry,
        options?.fetchImpl,
      );
    }
    if (entry.releaseState === "LIVE" && isConsumerDiscoverable(entry.releaseState, entry.visibility)) {
      if (!seen.has(entry.experienceId)) newlyLive.push(entry);
      const pkg = getPackageState(entry.experienceId);
      if (pkg === "READY_BUT_LOCKED") writePackageState(entry.experienceId, "READY");
    }
  }

  return { ok: true, newlyLive, preloadResults };
}

export function markRevealSeen(experienceIds: string[]): void {
  const previous = readJson<{ seenLive?: string[] }>(REVEAL_BANNER_KEY) ?? { seenLive: [] };
  const seen = new Set([...(previous.seenLive ?? []), ...experienceIds]);
  writeJson(REVEAL_BANNER_KEY, { seenLive: [...seen] });
}

export function catalogEntryLaunchable(entry: CatalogExperienceEntry): boolean {
  if (!canLaunchByRelease(entry.releaseState)) return false;
  const pkg = getPackageState(entry.experienceId);
  return pkg === "READY" || pkg === "NOT_DOWNLOADED" || pkg === "STALE";
}

export function filterDiscoverableCatalog(
  catalog: SignedExperienceCatalog | null,
): CatalogExperienceEntry[] {
  if (!catalog) return [];
  return catalog.payload.experiences.filter((item) =>
    isConsumerDiscoverable(item.releaseState, item.visibility),
  );
}
