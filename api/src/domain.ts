import {
  capabilityApprovalIsNotRuntimeAuthorization,
  directoryCategory,
  isConsumerDiscoverable,
  normalizeExperienceAuthMode,
  normalizeManagementUrl,
  normalizeOfflineCapability,
  reviewTransitionAllowed,
  safeHttpsUrl,
  validateManifest,
  type ApplicationCapabilityView,
  type ApplicationSurfaceType,
  type ApplicationView,
  type AuditEventView,
  type Capability,
  type CapabilityReviewState,
  type DirectoryApplicationView,
  type EvidenceStatus,
  type EvidenceType,
  type ExperienceMembershipStatus,
  type ExperienceMembershipView,
  type ExperienceReleaseState,
  type ExperienceVisibility,
  type LifeOSCatalogApplicationClaim,
  type OpenExperiencePayload,
  type ReviewState,
  type VerificationEvidenceView,
} from "@digiconomy/xperience-contract";
import { EmptyLifeOSCatalog, type LifeOSCatalogPort } from "./lifeos-catalog.js";
import { getCatalogSigningKeys } from "./catalog-keys.js";
import { EmptyManagementAccess, type ManagementAccessPort } from "./management-access.js";
import { getPresentationControl } from "./presentation-control.js";
import { getReleaseCatalog, type ExperienceReleaseCatalog } from "./release-catalog.js";
import type { ApplicationRepository } from "./repository.js";
import type { VerificationService } from "./verification.js";

export type Role = "DEVELOPER" | "ADMIN" | "USER";
export interface Actor {
  id: string;
  role: Role;
  email?: string;
  displayName?: string;
}

export interface ApplicationRecord {
  id: string;
  developerId: string;
  state: ReviewState;
  manifest: import("@digiconomy/xperience-contract").ApplicationManifestClaim;
  revision: number;
  capabilities: ApplicationCapabilityView[];
  evidence: VerificationEvidenceView[];
}

export type AuditEvent = AuditEventView;

function toView(app: ApplicationRecord): ApplicationView {
  const hasChannel = Boolean(app.manifest.xperienceUrl);
  return {
    ...app,
    integrationStatus: hasChannel ? "DECLARED" : "NOT_CONFIGURED",
  };
}

function unwrapManifest(input: unknown): unknown {
  if (input && typeof input === "object" && "manifest" in input) {
    return (input as { manifest: unknown }).manifest;
  }
  return input;
}

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code:
      | "forbidden"
      | "not_found"
      | "conflict"
      | "invalid"
      | "unauthorized" = "invalid",
  ) {
    super(message);
  }
}

type ResolvedPublished =
  | { kind: "xperience"; app: ApplicationRecord }
  | { kind: "lifeos"; claim: LifeOSCatalogApplicationClaim };

export class XperienceService {
  constructor(
    private readonly repository: ApplicationRepository,
    private readonly verification?: VerificationService,
    private readonly lifeosCatalog: LifeOSCatalogPort = new EmptyLifeOSCatalog(),
    private readonly managementAccess: ManagementAccessPort = new EmptyManagementAccess(),
    private readonly releaseCatalog: ExperienceReleaseCatalog = getReleaseCatalog(),
  ) {}

  private releaseOverlay(experienceId: string): {
    releaseState?: ExperienceReleaseState;
    visibility?: ExperienceVisibility;
  } {
    const entry = this.releaseCatalog.get(experienceId);
    if (!entry) return {};
    return { releaseState: entry.releaseState, visibility: entry.visibility };
  }

  private isDirectoryEligible(experienceId: string): boolean {
    const entry = this.releaseCatalog.get(experienceId);
    // Apps not yet in release catalog remain visible (legacy published) — X3 seeds cover known ones.
    if (!entry) return true;
    return isConsumerDiscoverable(entry.releaseState, entry.visibility);
  }
  private async log(
    action: string,
    actor: Actor,
    applicationId: string,
    detail?: string,
    previousState?: ReviewState,
    newState?: ReviewState,
  ): Promise<void> {
    const safeDetail =
      detail && /password|secret|private.?key|credential|session.?cookie|biometric/i.test(detail)
        ? "[redacted]"
        : detail;
    await this.repository.audit({
      action,
      actorId: actor.id,
      actorType: actor.role,
      applicationId,
      at: new Date().toISOString(),
      detail: safeDetail,
      reason: safeDetail,
      previousState,
      newState,
    });
  }

  private requireDeveloper(actor: Actor): void {
    if (actor.role !== "DEVELOPER") throw new DomainError("Developer role required.", "forbidden");
  }

  private requireAdmin(actor: Actor): void {
    if (actor.role !== "ADMIN") throw new DomainError("Admin role required.", "forbidden");
  }

  private requireUser(actor: Actor): void {
    if (actor.role !== "USER") throw new DomainError("User role required.", "forbidden");
  }

  private declaredManagementUrl(resolved: ResolvedPublished): string | undefined {
    if (resolved.kind === "xperience") {
      return normalizeManagementUrl(resolved.app.manifest.managementUrl);
    }
    return normalizeManagementUrl(resolved.claim.managementUrl);
  }

  private declaredOperatorIds(resolved: ResolvedPublished): readonly string[] {
    if (resolved.kind === "xperience") {
      return resolved.app.manifest.managementOperatorIds ?? [];
    }
    return resolved.claim.managementOperatorIds ?? [];
  }

  /** Entry visibility only — target app still authorizes detailed capabilities. */
  private async evaluateCanManage(
    actor: Actor,
    applicationId: string,
    managementUrl: string | undefined,
    operatorIds: readonly string[],
  ): Promise<boolean> {
    if (!managementUrl) return false;
    if (operatorIds.includes(actor.id)) return true;
    return this.managementAccess.hasManagementEntry(actor.id, applicationId);
  }

  private async toDirectoryView(
    actor: Actor,
    app: ApplicationRecord,
    membership?: { status: "ACTIVE" | "PAUSED" } | null,
  ): Promise<DirectoryApplicationView> {
    const published = app.state === "PUBLISHED";
    let experienceStatus: ExperienceMembershipStatus | undefined;
    if (membership) {
      experienceStatus = published ? membership.status : "UNAVAILABLE";
    }
    const managementUrl = published
      ? normalizeManagementUrl(app.manifest.managementUrl)
      : undefined;
    const canManage = published
      ? await this.evaluateCanManage(
          actor,
          app.id,
          managementUrl,
          app.manifest.managementOperatorIds ?? [],
        )
      : false;
    return {
      id: app.id,
      name: app.manifest.name,
      version: app.manifest.version,
      origin: app.manifest.origin,
      productionUrl: app.manifest.productionUrl,
      xperienceUrl: app.manifest.xperienceUrl,
      ...(managementUrl ? { managementUrl } : {}),
      canManage,
      authMode: normalizeExperienceAuthMode(app.manifest.authMode),
      offlineCapability: normalizeOfflineCapability(app.manifest.offlineCapability),
      category: directoryCategory(app.manifest.capabilities),
      capabilities: [...app.manifest.capabilities],
      publicationState: published ? "PUBLISHED" : "NOT_PUBLISHED",
      experienced: Boolean(membership),
      experienceStatus,
      ecosystemSource: "XPERIENCE",
    };
  }

  private async toDirectoryViewFromLifeOS(
    actor: Actor,
    claim: LifeOSCatalogApplicationClaim,
    membership?: { status: "ACTIVE" | "PAUSED" } | null,
  ): Promise<DirectoryApplicationView> {
    const managementUrl = normalizeManagementUrl(claim.managementUrl);
    const canManage = await this.evaluateCanManage(
      actor,
      claim.applicationId,
      managementUrl,
      claim.managementOperatorIds ?? [],
    );
    return {
      id: claim.applicationId,
      name: claim.name,
      version: claim.version,
      origin: claim.origin,
      productionUrl: claim.productionUrl,
      xperienceUrl: claim.xperienceUrl,
      ...(managementUrl ? { managementUrl } : {}),
      canManage,
      authMode: normalizeExperienceAuthMode(claim.authMode),
      offlineCapability: normalizeOfflineCapability(claim.offlineCapability),
      category: directoryCategory(claim.capabilities),
      capabilities: [...claim.capabilities],
      publicationState: "PUBLISHED",
      experienced: Boolean(membership),
      experienceStatus: membership?.status,
      description: claim.description,
      developerName: claim.developerName,
      ecosystemSource: "LIFEOS",
    };
  }

  private async resolvePublished(applicationId: string): Promise<ResolvedPublished | null> {
    const app = await this.repository.find(applicationId);
    if (app?.state === "PUBLISHED") return { kind: "xperience", app };
    const claim = await this.lifeosCatalog.getEligibleById(applicationId);
    if (claim) return { kind: "lifeos", claim };
    return null;
  }

  private async directoryFromResolved(
    actor: Actor,
    resolved: ResolvedPublished,
    membership?: { status: "ACTIVE" | "PAUSED" } | null,
  ): Promise<DirectoryApplicationView> {
    return resolved.kind === "xperience"
      ? this.toDirectoryView(actor, resolved.app, membership)
      : this.toDirectoryViewFromLifeOS(actor, resolved.claim, membership);
  }

  private openPayloadFromResolved(
    resolved: ResolvedPublished,
    status: ExperienceMembershipStatus,
    surface: ApplicationSurfaceType,
    embedUrl: string,
  ): OpenExperiencePayload {
    if (resolved.kind === "xperience") {
      return {
        applicationId: resolved.app.id,
        name: resolved.app.manifest.name,
        origin: resolved.app.manifest.origin,
        embedUrl,
        surface,
        status,
      };
    }
    return {
      applicationId: resolved.claim.applicationId,
      name: resolved.claim.name,
      origin: resolved.claim.origin,
      embedUrl,
      surface,
      status,
    };
  }

  async ensureDeveloperProfile(actor: Actor): Promise<{ id: string; email: string }> {
    this.requireDeveloper(actor);
    const email = actor.email ?? `${actor.id}@developers.local`;
    return this.repository.ensureDeveloper({ id: actor.id, email });
  }

  async register(actor: Actor, input: unknown): Promise<ApplicationView> {
    this.requireDeveloper(actor);
    const valid = validateManifest(unwrapManifest(input));
    if (!valid.ok) throw new DomainError(valid.errors.join(" "));
    await this.ensureDeveloperProfile(actor);
    const existing = await this.repository.find(valid.value.applicationId);
    if (existing) throw new DomainError("Application already exists.", "conflict");
    const capabilities: ApplicationCapabilityView[] = valid.value.capabilities.map((capability) => ({
      capability,
      status: "REQUESTED",
    }));
    const app: ApplicationRecord = {
      id: valid.value.applicationId,
      developerId: actor.id,
      state: "DRAFT",
      manifest: valid.value,
      revision: 1,
      capabilities,
      evidence: [],
    };
    await this.repository.create(app);
    await this.log("APPLICATION_REGISTERED", actor, app.id);
    return toView(app);
  }

  async listMine(actor: Actor): Promise<ApplicationView[]> {
    this.requireDeveloper(actor);
    const apps = await this.repository.byDeveloper(actor.id);
    return apps.map(toView);
  }

  async get(actor: Actor, id: string): Promise<ApplicationView> {
    const app = await this.repository.find(id);
    if (!app) throw new DomainError("Application not found.", "not_found");
    if (actor.role !== "ADMIN" && app.developerId !== actor.id) {
      throw new DomainError("Application access denied.", "forbidden");
    }
    return toView(app);
  }

  async listReviewQueue(actor: Actor): Promise<ApplicationView[]> {
    this.requireAdmin(actor);
    const apps = await this.repository.listByStates(["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED"]);
    return apps.map(toView);
  }

  async transition(actor: Actor, id: string, to: ReviewState, reason?: string): Promise<ApplicationView> {
    const app = await this.repository.find(id);
    if (!app) throw new DomainError("Application not found.", "not_found");
    if (actor.role !== "ADMIN" && app.developerId !== actor.id) {
      throw new DomainError("Application access denied.", "forbidden");
    }

    const adminOnly: ReviewState[] = ["UNDER_REVIEW", "APPROVED", "PUBLISHED", "SUSPENDED", "REVOKED"];
    if (adminOnly.includes(to)) this.requireAdmin(actor);
    if (to === "SUBMITTED") this.requireDeveloper(actor);
    if (to === "DRAFT" && actor.role === "ADMIN") {
      throw new DomainError("Developers return applications to draft.", "forbidden");
    }
    if (to === "CHANGES_REQUIRED") this.requireAdmin(actor);
    if (!reviewTransitionAllowed(app.state, to)) {
      throw new DomainError(`Invalid transition ${app.state} -> ${to}.`);
    }
    if (to === "SUBMITTED" && app.capabilities.length === 0) {
      throw new DomainError("Declare at least one capability before submission.");
    }

    const previous = app.state;
    app.state = to;
    await this.repository.save(app);
    await this.repository.recordReviewAction({
      applicationId: app.id,
      reviewerId: actor.id,
      state: to,
      action: `STATE:${to}`,
      detail: reason,
    });
    if (to === "PUBLISHED") {
      await this.repository.recordPublication(app.id, "PUBLISHED");
    }
    await this.log(`STATE:${to}`, actor, id, reason, previous, to);
    return toView(app);
  }

  async reject(actor: Actor, id: string, reason?: string): Promise<ApplicationView> {
    this.requireAdmin(actor);
    const app = await this.transition(actor, id, "CHANGES_REQUIRED", reason ?? "Rejected with changes required.");
    await this.log("REJECT", actor, id, reason);
    return app;
  }

  async updateManifest(actor: Actor, id: string, input: unknown): Promise<ApplicationView> {
    this.requireDeveloper(actor);
    await this.get(actor, id);
    const valid = validateManifest(unwrapManifest(input));
    if (!valid.ok) throw new DomainError(valid.errors.join(" "));
    if (valid.value.applicationId !== id) {
      throw new DomainError("Manifest applicationId must match path id.");
    }
    const app = await this.repository.find(id);
    if (!app) throw new DomainError("Application not found.", "not_found");

    const previous = app.state;
    if (app.state === "APPROVED" || app.state === "PUBLISHED") {
      app.state = "CHANGES_REQUIRED";
    }
    app.manifest = valid.value;
    app.revision += 1;
    app.capabilities = syncCapabilities(app.capabilities, valid.value.capabilities);
    await this.repository.save(app);
    await this.log("MANIFEST_REVISED", actor, id, undefined, previous, app.state);
    return toView(app);
  }

  async reviewCapability(
    actor: Actor,
    id: string,
    capability: Capability,
    status: Exclude<CapabilityReviewState, "REQUESTED">,
    reason?: string,
  ): Promise<ApplicationView> {
    this.requireAdmin(actor);
    void capabilityApprovalIsNotRuntimeAuthorization();
    const app = await this.repository.find(id);
    if (!app) throw new DomainError("Application not found.", "not_found");
    const row = app.capabilities.find((item) => item.capability === capability);
    if (!row) throw new DomainError("Capability not declared on application.", "not_found");
    row.status = status;
    await this.repository.save(app);
    await this.log(`CAPABILITY_${status}:${capability}`, actor, id, reason);
    return toView(app);
  }

  async addEvidence(
    actor: Actor,
    id: string,
    type: EvidenceType,
    locator: string,
  ): Promise<{ application: ApplicationView; verification: { status: EvidenceStatus; detail: string } }> {
    this.requireDeveloper(actor);
    const appRecord = await this.repository.find(id);
    if (!appRecord) throw new DomainError("Application not found.", "not_found");
    if (appRecord.developerId !== actor.id) throw new DomainError("Application access denied.", "forbidden");

    const verification = this.verification
      ? await this.verification.verify({
          type,
          locator,
          applicationOrigin: appRecord.manifest.origin,
        })
      : { status: "UNAVAILABLE" as const, detail: "Verification provider is not connected." };

    if (verification.status === "FAILED") {
      throw new DomainError(verification.detail || "Evidence locator rejected.");
    }

    const evidence = await this.repository.addEvidence({
      applicationId: id,
      type,
      locator,
      status: verification.status,
      detail: verification.detail,
    });
    await this.log(`EVIDENCE_CLAIMED:${type}`, actor, id, verification.detail);
    const app = await this.get(actor, id);
    return { application: app, verification: { status: evidence.status, detail: verification.detail } };
  }

  async listEvidence(actor: Actor, id: string): Promise<VerificationEvidenceView[]> {
    await this.get(actor, id);
    return this.repository.listEvidence(id);
  }

  async listAudit(actor: Actor, applicationId?: string): Promise<AuditEventView[]> {
    this.requireAdmin(actor);
    return this.repository.listAudit(applicationId);
  }

  async listDirectory(
    actor: Actor,
    query?: { q?: string; category?: string },
  ): Promise<DirectoryApplicationView[]> {
    this.requireUser(actor);
    const published = await this.repository.listByStates(["PUBLISHED"]);
    const selections = await this.repository.listExperienceSelections(actor.id);
    const byApp = new Map(selections.map((row) => [row.applicationId, row]));
    const q = query?.q?.trim().toLowerCase();
    const category = query?.category && query.category !== "All" ? query.category : undefined;

    const byId = new Map<string, DirectoryApplicationView>();
    for (const app of published) {
      byId.set(app.id, await this.toDirectoryView(actor, app, byApp.get(app.id) ?? null));
    }
    // LifeOS eligible verticals project into Directory without duplicating Application rows.
    for (const claim of await this.lifeosCatalog.listEligible()) {
      if (byId.has(claim.applicationId)) continue;
      byId.set(
        claim.applicationId,
        await this.toDirectoryViewFromLifeOS(actor, claim, byApp.get(claim.applicationId) ?? null),
      );
    }

    return [...byId.values()].filter((app) => {
      if (!this.isDirectoryEligible(app.id)) return false;
      if (category && app.category !== category) return false;
      if (!q) return true;
      const hay =
        `${app.name} ${app.id} ${app.category} ${app.capabilities.join(" ")} ${app.developerName ?? ""} ${app.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    }).map((app) => {
      const overlay = this.releaseOverlay(app.id);
      return { ...app, ...overlay };
    });
  }

  async getDirectoryApplication(actor: Actor, id: string): Promise<DirectoryApplicationView> {
    this.requireUser(actor);
    const resolved = await this.resolvePublished(id);
    if (!resolved) throw new DomainError("Published application not found.", "not_found");
    const membership = await this.repository.findExperienceSelection(actor.id, id);
    return this.directoryFromResolved(actor, resolved, membership);
  }

  async listMyExperience(
    actor: Actor,
    filter?: "All" | "Active" | "Paused" | "Recently Used",
  ): Promise<ExperienceMembershipView[]> {
    this.requireUser(actor);
    const selections = await this.repository.listExperienceSelections(actor.id);
    const items: ExperienceMembershipView[] = [];
    for (const selection of selections) {
      const resolved = await this.resolvePublished(selection.applicationId);
      if (!resolved) {
        // Membership may outlive Directory eligibility; keep UNAVAILABLE without inventing app data.
        const orphan = await this.repository.find(selection.applicationId);
        if (!orphan) continue;
        const directory = await this.toDirectoryView(actor, orphan, selection);
        items.push({
          applicationId: selection.applicationId,
          status: "UNAVAILABLE",
          addedAt: selection.addedAt,
          lastOpenedAt: selection.lastOpenedAt,
          application: { ...directory, experienceStatus: "UNAVAILABLE", experienced: true },
        });
        continue;
      }
      const directory = await this.directoryFromResolved(actor, resolved, selection);
      items.push({
        applicationId: selection.applicationId,
        status: selection.status,
        addedAt: selection.addedAt,
        lastOpenedAt: selection.lastOpenedAt,
        application: { ...directory, experienceStatus: selection.status, experienced: true },
      });
    }
    const filtered = items.filter((item) => {
      if (!filter || filter === "All") return true;
      if (filter === "Active") return item.status === "ACTIVE";
      if (filter === "Paused") return item.status === "PAUSED";
      if (filter === "Recently Used") return Boolean(item.lastOpenedAt);
      return true;
    });
    if (filter === "Recently Used") {
      filtered.sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
    }
    return filtered;
  }

  async startExperience(actor: Actor, applicationId: string): Promise<ExperienceMembershipView> {
    this.requireUser(actor);
    const resolved = await this.resolvePublished(applicationId);
    if (!resolved) {
      throw new DomainError("Only published applications can be experienced.", "forbidden");
    }
    const existing = await this.repository.findExperienceSelection(actor.id, applicationId);
    if (existing) {
      throw new DomainError("Application is already in your Experience.", "conflict");
    }
    const selection = await this.repository.upsertExperienceSelection({
      participantId: actor.id,
      applicationId,
      status: "ACTIVE",
      addedAt: new Date().toISOString(),
    });
    await this.log("EXPERIENCE_STARTED", actor, applicationId);
    return {
      applicationId,
      status: "ACTIVE",
      addedAt: selection.addedAt,
      application: await this.directoryFromResolved(actor, resolved, selection),
    };
  }

  async pauseExperience(actor: Actor, applicationId: string): Promise<ExperienceMembershipView> {
    return this.setExperienceStatus(actor, applicationId, "PAUSED");
  }

  async resumeExperience(actor: Actor, applicationId: string): Promise<ExperienceMembershipView> {
    return this.setExperienceStatus(actor, applicationId, "ACTIVE");
  }

  private async setExperienceStatus(
    actor: Actor,
    applicationId: string,
    status: "ACTIVE" | "PAUSED",
  ): Promise<ExperienceMembershipView> {
    this.requireUser(actor);
    const selection = await this.repository.findExperienceSelection(actor.id, applicationId);
    if (!selection) throw new DomainError("Application is not in your Experience.", "not_found");
    const resolved = await this.resolvePublished(applicationId);
    if (!resolved) {
      throw new DomainError("Application is unavailable to experience.", "forbidden");
    }
    const updated = await this.repository.upsertExperienceSelection({ ...selection, status });
    await this.log(status === "PAUSED" ? "EXPERIENCE_PAUSED" : "EXPERIENCE_RESUMED", actor, applicationId);
    return {
      applicationId,
      status,
      addedAt: updated.addedAt,
      lastOpenedAt: updated.lastOpenedAt,
      application: await this.directoryFromResolved(actor, resolved, updated),
    };
  }

  async stopExperience(actor: Actor, applicationId: string): Promise<{ removed: true }> {
    this.requireUser(actor);
    const selection = await this.repository.findExperienceSelection(actor.id, applicationId);
    if (!selection) throw new DomainError("Application is not in your Experience.", "not_found");
    await this.repository.deleteExperienceSelection(actor.id, applicationId);
    await this.log("EXPERIENCE_STOPPED", actor, applicationId);
    return { removed: true };
  }

  async openExperience(
    actor: Actor,
    applicationId: string,
    options?: { surface?: ApplicationSurfaceType },
  ): Promise<OpenExperiencePayload> {
    this.requireUser(actor);
    const release = this.releaseCatalog.get(applicationId);
    if (release && release.releaseState !== "LIVE") {
      throw new DomainError(
        release.releaseState === "PAUSED"
          ? "This Experience is temporarily paused."
          : "This Experience is not available yet.",
        "forbidden",
      );
    }
    const selection = await this.repository.findExperienceSelection(actor.id, applicationId);
    if (!selection) throw new DomainError("Application is not in your Experience.", "not_found");
    const resolved = await this.resolvePublished(applicationId);
    if (!resolved) {
      throw new DomainError("Unpublished applications cannot be opened.", "forbidden");
    }
    if (selection.status === "PAUSED") {
      throw new DomainError("Resume the experience before opening.", "invalid");
    }

    const surface: ApplicationSurfaceType = options?.surface === "MANAGEMENT" ? "MANAGEMENT" : "PUBLIC";
    let embedUrl: string;
    if (surface === "PUBLIC") {
      embedUrl =
        resolved.kind === "xperience"
          ? resolved.app.manifest.productionUrl
          : resolved.claim.productionUrl;
    } else {
      const managementUrl = this.declaredManagementUrl(resolved);
      const canManage = await this.evaluateCanManage(
        actor,
        applicationId,
        managementUrl,
        this.declaredOperatorIds(resolved),
      );
      if (!managementUrl || !canManage) {
        throw new DomainError(
          "Management surface is not available for this participant.",
          "forbidden",
        );
      }
      embedUrl = managementUrl;
    }

    const draft = this.openPayloadFromResolved(resolved, selection.status, surface, embedUrl);
    if (!safeHttpsUrl(draft.embedUrl) || !safeHttpsUrl(draft.origin)) {
      throw new DomainError("Application origin failed safety validation.", "forbidden");
    }
    const updated = await this.repository.upsertExperienceSelection({
      ...selection,
      lastOpenedAt: new Date().toISOString(),
    });
    await this.log(
      surface === "MANAGEMENT" ? "EXPERIENCE_MANAGE_OPENED" : "EXPERIENCE_OPENED",
      actor,
      applicationId,
    );
    return { ...draft, status: updated.status };
  }

  /** Featured / recently published directory ordering — not personalized recommendations. */
  async listFeaturedDirectory(actor: Actor): Promise<DirectoryApplicationView[]> {
    const apps = await this.listDirectory(actor);
    return apps
      .filter((app) => {
        const entry = this.releaseCatalog.get(app.id);
        if (!entry) return true;
        return entry.visibility === "FEATURED" && entry.releaseState === "LIVE";
      })
      .slice(0, 12);
  }

  // --- Phase X3 release control ---

  async getDeviceCatalog(_actor: Actor | null) {
    return this.releaseCatalog.buildDeviceSignedCatalog();
  }

  async getConsumerCatalog(actor: Actor) {
    this.requireUser(actor);
    return this.releaseCatalog.buildConsumerSignedCatalog();
  }

  async listReleaseCatalog(actor: Actor) {
    this.requireAdmin(actor);
    return {
      experiences: this.releaseCatalog.listAdmin(),
      audits: this.releaseCatalog.listAudits(),
      manifestVersion: (await this.releaseCatalog.buildSignedCatalog()).payload.manifestVersion,
    };
  }

  async changeExperienceRelease(
    actor: Actor,
    experienceId: string,
    input: {
      releaseState: ExperienceReleaseState;
      visibility?: ExperienceVisibility;
      confirmLive?: boolean;
      action?: "preload" | "lock" | "go-live" | "pause" | "retire";
    },
  ) {
    this.requireAdmin(actor);
    let entry;
    if (input.action === "preload") entry = this.releaseCatalog.preload(actor, experienceId);
    else if (input.action === "lock") entry = this.releaseCatalog.lock(actor, experienceId);
    else if (input.action === "go-live") {
      entry = this.releaseCatalog.goLive(actor, experienceId, input.visibility ?? "FEATURED");
    } else if (input.action === "pause") entry = this.releaseCatalog.pause(actor, experienceId);
    else if (input.action === "retire") entry = this.releaseCatalog.retire(actor, experienceId);
    else {
      entry = this.releaseCatalog.changeRelease(actor, experienceId, {
        releaseState: input.releaseState,
        visibility: input.visibility,
        confirmLive: input.confirmLive,
      });
    }
    await this.log(
      "experience.release.changed",
      actor,
      experienceId,
      `${entry.releaseState}/${entry.visibility}`,
    );
    return {
      experience: entry,
      catalog: await this.releaseCatalog.buildDeviceSignedCatalog(),
    };
  }

  releaseCatalogPort(): ExperienceReleaseCatalog {
    return this.releaseCatalog;
  }

  async getCatalogPublicKey() {
    const keys = await getCatalogSigningKeys();
    return { algorithm: "Ed25519" as const, publicKeySpkiBase64: keys.publicKeySpkiBase64 };
  }

  private presentations() {
    return getPresentationControl(this.releaseCatalog);
  }

  listPresentations(actor: Actor) {
    this.requireAdmin(actor);
    return { presentations: this.presentations().list() };
  }

  getPresentation(actor: Actor, id: string) {
    this.requireAdmin(actor);
    return this.presentations().get(id);
  }

  createPresentation(
    actor: Actor,
    body: {
      title: string;
      chapters: Array<{
        title: string;
        experienceId: string;
        action?: string;
        visibility?: string;
        notes?: string;
      }>;
      skipRevealConfirm?: boolean;
    },
  ) {
    this.requireAdmin(actor);
    return this.presentations().create(actor, {
      title: body.title,
      skipRevealConfirm: body.skipRevealConfirm,
      chapters: (body.chapters ?? []).map((chapter) => ({
        title: chapter.title,
        experienceId: chapter.experienceId,
        action: chapter.action as import("@digiconomy/xperience-contract").ChapterAction | undefined,
        visibility: chapter.visibility as import("@digiconomy/xperience-contract").ExperienceVisibility | undefined,
        notes: chapter.notes,
      })),
    });
  }

  presentationAction(
    actor: Actor,
    id: string,
    action:
      | "ready"
      | "start"
      | "pause"
      | "resume"
      | "end"
      | "next"
      | "previous"
      | "reveal-current"
      | "select-chapter",
    body?: { chapterId?: string; confirm?: boolean },
  ) {
    this.requireAdmin(actor);
    const ctrl = this.presentations();
    switch (action) {
      case "ready":
        return { presentation: ctrl.markReady(actor, id) };
      case "start":
        return { presentation: ctrl.start(actor, id) };
      case "pause":
        return { presentation: ctrl.pause(actor, id) };
      case "resume":
        return { presentation: ctrl.resume(actor, id) };
      case "end":
        return { presentation: ctrl.end(actor, id) };
      case "next":
        return { presentation: ctrl.nextChapter(actor, id) };
      case "previous":
        return { presentation: ctrl.previousChapter(actor, id) };
      case "select-chapter":
        if (!body?.chapterId) throw new DomainError("chapterId required.");
        return { presentation: ctrl.goToChapter(actor, id, body.chapterId) };
      case "reveal-current":
        return ctrl.revealCurrent(actor, id, { confirm: body?.confirm });
      default:
        throw new DomainError("Unknown presentation action.", "not_found");
    }
  }

  audiencePresentationState(_actor: Actor | null) {
    return { presentation: this.presentations().audienceState() };
  }
}

function syncCapabilities(
  existing: ApplicationCapabilityView[],
  next: Capability[],
): ApplicationCapabilityView[] {
  const byCap = new Map(existing.map((item) => [item.capability, item]));
  return next.map((capability) => {
    const prior = byCap.get(capability);
    if (prior?.status === "APPROVED") {
      return { capability, status: "REQUIRES_CHANGES" };
    }
    return prior ?? { capability, status: "REQUESTED" };
  });
}
