import {
  capabilityApprovalIsNotRuntimeAuthorization,
  directoryCategory,
  reviewTransitionAllowed,
  safeHttpsUrl,
  validateManifest,
  type ApplicationCapabilityView,
  type ApplicationView,
  type AuditEventView,
  type Capability,
  type CapabilityReviewState,
  type DirectoryApplicationView,
  type EvidenceStatus,
  type EvidenceType,
  type ExperienceMembershipStatus,
  type ExperienceMembershipView,
  type OpenExperiencePayload,
  type ReviewState,
  type VerificationEvidenceView,
} from "@digiconomy/xperience-contract";
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

export class XperienceService {
  constructor(
    private readonly repository: ApplicationRepository,
    private readonly verification?: VerificationService,
  ) {}

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

  private toDirectoryView(
    app: ApplicationRecord,
    membership?: { status: "ACTIVE" | "PAUSED" } | null,
  ): DirectoryApplicationView {
    const published = app.state === "PUBLISHED";
    let experienceStatus: ExperienceMembershipStatus | undefined;
    if (membership) {
      experienceStatus = published ? membership.status : "UNAVAILABLE";
    }
    return {
      id: app.id,
      name: app.manifest.name,
      version: app.manifest.version,
      origin: app.manifest.origin,
      productionUrl: app.manifest.productionUrl,
      xperienceUrl: app.manifest.xperienceUrl,
      category: directoryCategory(app.manifest.capabilities),
      capabilities: [...app.manifest.capabilities],
      publicationState: published ? "PUBLISHED" : "NOT_PUBLISHED",
      experienced: Boolean(membership),
      experienceStatus,
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
    return published
      .map((app) => this.toDirectoryView(app, byApp.get(app.id) ?? null))
      .filter((app) => {
        if (category && app.category !== category) return false;
        if (!q) return true;
        const hay = `${app.name} ${app.id} ${app.category} ${app.capabilities.join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
  }

  async getDirectoryApplication(actor: Actor, id: string): Promise<DirectoryApplicationView> {
    this.requireUser(actor);
    const app = await this.repository.find(id);
    if (!app || app.state !== "PUBLISHED") {
      throw new DomainError("Published application not found.", "not_found");
    }
    const membership = await this.repository.findExperienceSelection(actor.id, id);
    return this.toDirectoryView(app, membership);
  }

  async listMyExperience(
    actor: Actor,
    filter?: "All" | "Active" | "Paused" | "Recently Used",
  ): Promise<ExperienceMembershipView[]> {
    this.requireUser(actor);
    const selections = await this.repository.listExperienceSelections(actor.id);
    const items: ExperienceMembershipView[] = [];
    for (const selection of selections) {
      const app = await this.repository.find(selection.applicationId);
      if (!app) continue;
      const directory = this.toDirectoryView(app, selection);
      // Directory presence is independent; membership may become UNAVAILABLE if unpublished.
      const status: ExperienceMembershipStatus =
        app.state === "PUBLISHED" ? selection.status : "UNAVAILABLE";
      items.push({
        applicationId: selection.applicationId,
        status,
        addedAt: selection.addedAt,
        lastOpenedAt: selection.lastOpenedAt,
        application: { ...directory, experienceStatus: status, experienced: true },
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
    const app = await this.repository.find(applicationId);
    if (!app || app.state !== "PUBLISHED") {
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
      application: this.toDirectoryView(app, selection),
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
    const app = await this.repository.find(applicationId);
    if (!app || app.state !== "PUBLISHED") {
      throw new DomainError("Application is unavailable to experience.", "forbidden");
    }
    const updated = await this.repository.upsertExperienceSelection({ ...selection, status });
    await this.log(status === "PAUSED" ? "EXPERIENCE_PAUSED" : "EXPERIENCE_RESUMED", actor, applicationId);
    return {
      applicationId,
      status,
      addedAt: updated.addedAt,
      lastOpenedAt: updated.lastOpenedAt,
      application: this.toDirectoryView(app, updated),
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

  async openExperience(actor: Actor, applicationId: string): Promise<OpenExperiencePayload> {
    this.requireUser(actor);
    const selection = await this.repository.findExperienceSelection(actor.id, applicationId);
    if (!selection) throw new DomainError("Application is not in your Experience.", "not_found");
    const app = await this.repository.find(applicationId);
    if (!app || app.state !== "PUBLISHED") {
      throw new DomainError("Unpublished applications cannot be opened.", "forbidden");
    }
    if (selection.status === "PAUSED") {
      throw new DomainError("Resume the experience before opening.", "invalid");
    }
    const embedUrl = app.manifest.productionUrl;
    if (!safeHttpsUrl(embedUrl) || !safeHttpsUrl(app.manifest.origin)) {
      throw new DomainError("Application origin failed safety validation.", "forbidden");
    }
    const updated = await this.repository.upsertExperienceSelection({
      ...selection,
      lastOpenedAt: new Date().toISOString(),
    });
    await this.log("EXPERIENCE_OPENED", actor, applicationId);
    return {
      applicationId: app.id,
      name: app.manifest.name,
      origin: app.manifest.origin,
      embedUrl,
      status: updated.status,
    };
  }

  /** Featured / recently published directory ordering — not personalized recommendations. */
  async listFeaturedDirectory(actor: Actor): Promise<DirectoryApplicationView[]> {
    const apps = await this.listDirectory(actor);
    return apps.slice(0, 12);
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
