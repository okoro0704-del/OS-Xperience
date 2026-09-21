import {
  canPreloadByRelease,
  isConsumerDiscoverable,
  normalizePreloadPolicy,
  normalizeReleaseState,
  normalizeVisibility,
  releaseTransitionAllowed,
  signExperienceCatalog,
  type CatalogExperienceEntry,
  type ExperienceCatalogPayload,
  type ExperienceReleaseState,
  type ExperienceVisibility,
  type PreloadPolicy,
  type SignedExperienceCatalog,
} from "@digiconomy/xperience-contract";
import { DomainError, type Actor } from "./domain.js";

export interface ReleaseChangeAudit {
  action: "experience.release.changed";
  experienceId: string;
  from: ExperienceReleaseState;
  to: ExperienceReleaseState;
  visibilityFrom: ExperienceVisibility;
  visibilityTo: ExperienceVisibility;
  actorId: string;
  actorType: string;
  at: string;
  confirmedLive?: boolean;
}

type CatalogListener = (manifestVersion: number) => void;

function catalogSecret(): string {
  return (
    process.env.XPERIENCE_CATALOG_SIGNING_SECRET?.trim() ||
    "xperience-dev-catalog-hmac-not-for-production"
  );
}

function seedEntries(): CatalogExperienceEntry[] {
  const now = new Date().toISOString();
  return [
    {
      experienceId: "bootstrap.mybrandos.public",
      name: "mybrandOS",
      version: "1.0.0",
      entrypoint: "https://mrfundzman.getlifeos.app/",
      origin: "https://mrfundzman.getlifeos.app/",
      authMode: "PUBLIC",
      offlineCapability: "PARTIAL",
      releaseState: "LIVE",
      visibility: "FEATURED",
      preloadPolicy: "BACKGROUND",
      packageVersion: "1.0.0",
      contentHash: "sha256:mybrandos-public-v1",
      packageUrl: "https://mrfundzman.getlifeos.app/",
      releasedAt: now,
      updatedAt: now,
    },
    {
      experienceId: "lifeos",
      name: "LifeOS",
      version: "1.0.0",
      entrypoint: "https://app.getlifeos.app/",
      origin: "https://app.getlifeos.app/",
      authMode: "APP_MANAGED",
      offlineCapability: "PARTIAL",
      releaseState: "PRELOADED",
      visibility: "HIDDEN",
      preloadPolicy: "BACKGROUND",
      packageVersion: "1.0.0",
      contentHash: "sha256:lifeos-preload-v1",
      packageUrl: "https://app.getlifeos.app/",
      updatedAt: now,
    },
  ];
}

/**
 * In-memory signed Experience release catalog.
 * Clients must verify signatures; local edits without a valid signature are rejected.
 */
export class ExperienceReleaseCatalog {
  private manifestVersion = 1;
  private entries = new Map<string, CatalogExperienceEntry>();
  private audits: ReleaseChangeAudit[] = [];
  private listeners = new Set<CatalogListener>();

  constructor(seed = true) {
    if (seed) {
      for (const entry of seedEntries()) this.entries.set(entry.experienceId, entry);
    }
  }

  onChange(listener: CatalogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.manifestVersion);
  }

  listAdmin(): CatalogExperienceEntry[] {
    return [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(experienceId: string): CatalogExperienceEntry | null {
    return this.entries.get(experienceId) ?? null;
  }

  async buildSignedCatalog(): Promise<SignedExperienceCatalog> {
    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const payload: ExperienceCatalogPayload = {
      manifestVersion: this.manifestVersion,
      generatedAt,
      expiresAt,
      experiences: this.listAdmin(),
    };
    return signExperienceCatalog(payload, catalogSecret());
  }

  /** Public consumer catalog — only discoverable LIVE Experiences. */
  async buildConsumerSignedCatalog(): Promise<SignedExperienceCatalog> {
    const full = await this.buildSignedCatalog();
    const payload: ExperienceCatalogPayload = {
      ...full.payload,
      experiences: full.payload.experiences.filter((item) =>
        isConsumerDiscoverable(item.releaseState, item.visibility),
      ),
    };
    return signExperienceCatalog(payload, catalogSecret());
  }

  /** Full catalog for preload clients (includes PRELOADED/LOCKED, excludes DRAFT). */
  async buildDeviceSignedCatalog(): Promise<SignedExperienceCatalog> {
    const full = await this.buildSignedCatalog();
    const payload: ExperienceCatalogPayload = {
      ...full.payload,
      experiences: full.payload.experiences.filter(
        (item) =>
          item.releaseState !== "DRAFT" &&
          item.releaseState !== "RETIRED" &&
          (item.releaseState !== "PRIVATE_TEST" || true),
      ),
    };
    // PRIVATE_TEST stays in device catalog only when marked — for X3 keep out of public consumer list.
    payload.experiences = full.payload.experiences.filter((item) => {
      if (item.releaseState === "DRAFT" || item.releaseState === "RETIRED") return false;
      if (item.releaseState === "PRIVATE_TEST") return false;
      return true;
    });
    return signExperienceCatalog(payload, catalogSecret());
  }

  upsertDraft(entry: Omit<CatalogExperienceEntry, "updatedAt" | "releaseState" | "visibility" | "preloadPolicy"> & {
    releaseState?: ExperienceReleaseState;
    visibility?: ExperienceVisibility;
    preloadPolicy?: PreloadPolicy;
  }): CatalogExperienceEntry {
    const now = new Date().toISOString();
    const next: CatalogExperienceEntry = {
      ...entry,
      releaseState: normalizeReleaseState(entry.releaseState ?? "DRAFT"),
      visibility: normalizeVisibility(entry.visibility ?? "HIDDEN"),
      preloadPolicy: normalizePreloadPolicy(entry.preloadPolicy ?? "NONE"),
      updatedAt: now,
    };
    this.entries.set(next.experienceId, next);
    this.manifestVersion += 1;
    this.notify();
    return next;
  }

  changeRelease(
    actor: Actor,
    experienceId: string,
    input: {
      releaseState: ExperienceReleaseState;
      visibility?: ExperienceVisibility;
      confirmLive?: boolean;
    },
  ): CatalogExperienceEntry {
    const current = this.entries.get(experienceId);
    if (!current) throw new DomainError("Experience not found in release catalog.", "not_found");
    const to = normalizeReleaseState(input.releaseState);
    if (!releaseTransitionAllowed(current.releaseState, to)) {
      throw new DomainError(
        `Invalid release transition ${current.releaseState} → ${to}.`,
        "conflict",
      );
    }
    if (to === "LIVE" && !input.confirmLive) {
      throw new DomainError("Going LIVE requires explicit confirmation (confirmLive: true).");
    }
    const visibilityTo = normalizeVisibility(input.visibility ?? current.visibility);
    if (to === "LIVE" && visibilityTo === "HIDDEN") {
      // Allow hidden live for soft launch, but default FEATURED when going live without visibility.
    }
    const next: CatalogExperienceEntry = {
      ...current,
      releaseState: to,
      visibility: visibilityTo,
      releasedAt: to === "LIVE" ? new Date().toISOString() : current.releasedAt,
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(experienceId, next);
    this.manifestVersion += 1;
    this.audits.unshift({
      action: "experience.release.changed",
      experienceId,
      from: current.releaseState,
      to,
      visibilityFrom: current.visibility,
      visibilityTo,
      actorId: actor.id,
      actorType: actor.role,
      at: next.updatedAt,
      confirmedLive: to === "LIVE" ? Boolean(input.confirmLive) : undefined,
    });
    this.notify();
    return next;
  }

  /** Convenience admin actions. */
  preload(actor: Actor, experienceId: string): CatalogExperienceEntry {
    return this.changeRelease(actor, experienceId, {
      releaseState: "PRELOADED",
      visibility: "HIDDEN",
    });
  }

  lock(actor: Actor, experienceId: string): CatalogExperienceEntry {
    return this.changeRelease(actor, experienceId, { releaseState: "LOCKED", visibility: "HIDDEN" });
  }

  goLive(
    actor: Actor,
    experienceId: string,
    visibility: ExperienceVisibility = "FEATURED",
  ): CatalogExperienceEntry {
    return this.changeRelease(actor, experienceId, {
      releaseState: "LIVE",
      visibility,
      confirmLive: true,
    });
  }

  pause(actor: Actor, experienceId: string): CatalogExperienceEntry {
    return this.changeRelease(actor, experienceId, { releaseState: "PAUSED" });
  }

  retire(actor: Actor, experienceId: string): CatalogExperienceEntry {
    return this.changeRelease(actor, experienceId, {
      releaseState: "RETIRED",
      visibility: "HIDDEN",
    });
  }

  listAudits(limit = 100): ReleaseChangeAudit[] {
    return this.audits.slice(0, limit);
  }

  preloadTargets(): CatalogExperienceEntry[] {
    return this.listAdmin().filter((item) => canPreloadByRelease(item.releaseState));
  }

  signingSecretForTests(): string {
    return catalogSecret();
  }
}

let shared: ExperienceReleaseCatalog | null = null;

export function getReleaseCatalog(): ExperienceReleaseCatalog {
  if (!shared) shared = new ExperienceReleaseCatalog(true);
  return shared;
}

export function resetReleaseCatalogForTests(): ExperienceReleaseCatalog {
  shared = new ExperienceReleaseCatalog(true);
  return shared;
}
