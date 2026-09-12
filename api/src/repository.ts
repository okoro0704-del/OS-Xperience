import { Prisma, PrismaClient } from "@prisma/client";
import type {
  ApplicationCapabilityView,
  ApplicationManifestClaim,
  AuditEventView,
  Capability,
  CapabilityReviewState,
  EvidenceStatus,
  EvidenceType,
  ReviewState,
  VerificationEvidenceView,
} from "@digiconomy/xperience-contract";
import type { ApplicationRecord, AuditEvent } from "./domain.js";

export interface ApplicationRepository {
  ensureDeveloper(input: { id: string; email: string }): Promise<{ id: string; email: string }>;
  create(app: ApplicationRecord): Promise<void>;
  save(app: ApplicationRecord): Promise<void>;
  find(id: string): Promise<ApplicationRecord | null>;
  byDeveloper(developerId: string): Promise<ApplicationRecord[]>;
  listByStates(states: ReviewState[]): Promise<ApplicationRecord[]>;
  addEvidence(input: {
    applicationId: string;
    type: EvidenceType;
    locator: string;
    status: EvidenceStatus;
    detail: string;
  }): Promise<VerificationEvidenceView>;
  listEvidence(applicationId: string): Promise<VerificationEvidenceView[]>;
  recordReviewAction(input: {
    applicationId: string;
    reviewerId: string;
    state: ReviewState;
    action: string;
    detail?: string;
  }): Promise<void>;
  recordPublication(applicationId: string, status: string): Promise<void>;
  audit(event: AuditEvent): Promise<void>;
  listAudit(applicationId?: string): Promise<AuditEventView[]>;
}

function asJson(value: ApplicationManifestClaim): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function cloneApp(app: ApplicationRecord): ApplicationRecord {
  return {
    ...app,
    manifest: {
      ...app.manifest,
      capabilities: [...app.manifest.capabilities],
      deploymentClaims: app.manifest.deploymentClaims ? [...app.manifest.deploymentClaims] : undefined,
      repository: app.manifest.repository ? { ...app.manifest.repository } : undefined,
    },
    capabilities: app.capabilities.map((item) => ({ ...item })),
    evidence: app.evidence.map((item) => ({ ...item })),
  };
}

/** Explicit test/dev adapter. Forbidden in production. */
export class MemoryApplicationRepository implements ApplicationRepository {
  private readonly apps = new Map<string, ApplicationRecord>();
  private readonly developers = new Map<string, { id: string; email: string }>();
  private readonly audits: AuditEventView[] = [];
  private evidenceSeq = 1;

  async ensureDeveloper(input: { id: string; email: string }): Promise<{ id: string; email: string }> {
    const existing = this.developers.get(input.id);
    if (existing) return existing;
    this.developers.set(input.id, input);
    return input;
  }

  async create(app: ApplicationRecord): Promise<void> {
    if (this.apps.has(app.id)) throw new Error("Application already exists.");
    this.apps.set(app.id, cloneApp(app));
  }

  async save(app: ApplicationRecord): Promise<void> {
    this.apps.set(app.id, cloneApp(app));
  }

  async find(id: string): Promise<ApplicationRecord | null> {
    const app = this.apps.get(id);
    return app ? cloneApp(app) : null;
  }

  async byDeveloper(developerId: string): Promise<ApplicationRecord[]> {
    return [...this.apps.values()].filter((app) => app.developerId === developerId).map(cloneApp);
  }

  async listByStates(states: ReviewState[]): Promise<ApplicationRecord[]> {
    const set = new Set(states);
    return [...this.apps.values()].filter((app) => set.has(app.state)).map(cloneApp);
  }

  async addEvidence(input: {
    applicationId: string;
    type: EvidenceType;
    locator: string;
    status: EvidenceStatus;
    detail: string;
  }): Promise<VerificationEvidenceView> {
    const app = this.apps.get(input.applicationId);
    if (!app) throw new Error("Application missing");
    const evidence: VerificationEvidenceView = {
      id: `ev_${this.evidenceSeq++}`,
      type: input.type,
      locator: input.locator,
      status: input.status,
      detail: input.detail,
    };
    app.evidence.unshift(evidence);
    return { ...evidence };
  }

  async listEvidence(applicationId: string): Promise<VerificationEvidenceView[]> {
    return (this.apps.get(applicationId)?.evidence ?? []).map((item) => ({ ...item }));
  }

  async recordReviewAction(): Promise<void> {}

  async recordPublication(): Promise<void> {}

  async audit(event: AuditEvent): Promise<void> {
    this.audits.unshift({
      id: `audit_${this.audits.length + 1}`,
      ...event,
    });
  }

  async listAudit(applicationId?: string): Promise<AuditEventView[]> {
    return this.audits
      .filter((event) => !applicationId || event.applicationId === applicationId)
      .map((event) => ({ ...event }));
  }
}

type PrismaAppRow = {
  id: string;
  developerId: string;
  state: string;
  revision: number;
  manifest: unknown;
  capabilities: Array<{ capability: string; status: string }>;
  evidence: Array<{
    id: string;
    type: string;
    locator: string;
    status: string;
    attempts: Array<{ detail: string | null; outcome: string; createdAt: Date }>;
  }>;
};

function mapPrismaApp(row: PrismaAppRow): ApplicationRecord {
  const manifest = row.manifest as ApplicationManifestClaim;
  return {
    id: row.id,
    developerId: row.developerId,
    state: row.state as ReviewState,
    revision: row.revision,
    manifest,
    capabilities: row.capabilities.map((item) => ({
      capability: item.capability as Capability,
      status: item.status as CapabilityReviewState,
    })),
    evidence: row.evidence.map((item) => ({
      id: item.id,
      type: item.type as EvidenceType,
      locator: item.locator,
      status: item.status as EvidenceStatus,
      detail: item.attempts[0]?.detail ?? item.attempts[0]?.outcome,
    })),
  };
}

const includeRelations = {
  capabilities: true,
  evidence: {
    include: { attempts: { orderBy: { createdAt: "desc" as const }, take: 1 } },
    orderBy: { id: "desc" as const },
  },
} as const;

export class PrismaApplicationRepository implements ApplicationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureDeveloper(input: { id: string; email: string }): Promise<{ id: string; email: string }> {
    const row = await this.prisma.developer.upsert({
      where: { id: input.id },
      create: { id: input.id, email: input.email },
      update: { email: input.email },
    });
    return { id: row.id, email: row.email };
  }

  async create(app: ApplicationRecord): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.application.create({
        data: {
          id: app.id,
          developerId: app.developerId,
          state: app.state,
          revision: app.revision,
          manifest: asJson(app.manifest),
          capabilities: {
            create: app.capabilities.map((item) => ({
              capability: item.capability,
              status: item.status,
            })),
          },
        },
      }),
      this.prisma.applicationManifest.create({
        data: { applicationId: app.id, revision: app.revision, claim: asJson(app.manifest) },
      }),
      this.prisma.manifestRevision.create({
        data: { applicationId: app.id, revision: app.revision, claim: asJson(app.manifest) },
      }),
    ]);
  }

  async save(app: ApplicationRecord): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.application.update({
        where: { id: app.id },
        data: {
          state: app.state,
          revision: app.revision,
          manifest: asJson(app.manifest),
        },
      });
      await tx.applicationCapability.deleteMany({ where: { applicationId: app.id } });
      if (app.capabilities.length) {
        await tx.applicationCapability.createMany({
          data: app.capabilities.map((item) => ({
            applicationId: app.id,
            capability: item.capability,
            status: item.status,
          })),
        });
      }
      const existingRevision = await tx.manifestRevision.findUnique({
        where: { applicationId_revision: { applicationId: app.id, revision: app.revision } },
      });
      if (!existingRevision) {
        await tx.applicationManifest.create({
          data: { applicationId: app.id, revision: app.revision, claim: asJson(app.manifest) },
        });
        await tx.manifestRevision.create({
          data: { applicationId: app.id, revision: app.revision, claim: asJson(app.manifest) },
        });
      }
    });
  }

  async find(id: string): Promise<ApplicationRecord | null> {
    const row = await this.prisma.application.findUnique({
      where: { id },
      include: includeRelations,
    });
    return row ? mapPrismaApp(row) : null;
  }

  async byDeveloper(developerId: string): Promise<ApplicationRecord[]> {
    const rows = await this.prisma.application.findMany({
      where: { developerId },
      include: includeRelations,
    });
    return rows.map(mapPrismaApp);
  }

  async listByStates(states: ReviewState[]): Promise<ApplicationRecord[]> {
    const rows = await this.prisma.application.findMany({
      where: { state: { in: states } },
      include: includeRelations,
    });
    return rows.map(mapPrismaApp);
  }

  async addEvidence(input: {
    applicationId: string;
    type: EvidenceType;
    locator: string;
    status: EvidenceStatus;
    detail: string;
  }): Promise<VerificationEvidenceView> {
    const row = await this.prisma.verificationEvidence.create({
      data: {
        applicationId: input.applicationId,
        type: input.type,
        locator: input.locator,
        status: input.status,
        attempts: {
          create: { outcome: input.status, detail: input.detail },
        },
      },
      include: { attempts: true },
    });
    return {
      id: row.id,
      type: row.type as EvidenceType,
      locator: row.locator,
      status: row.status as EvidenceStatus,
      detail: row.attempts[0]?.detail ?? input.detail,
    };
  }

  async listEvidence(applicationId: string): Promise<VerificationEvidenceView[]> {
    const rows = await this.prisma.verificationEvidence.findMany({
      where: { applicationId },
      include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { id: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type as EvidenceType,
      locator: row.locator,
      status: row.status as EvidenceStatus,
      detail: row.attempts[0]?.detail ?? undefined,
    }));
  }

  async recordReviewAction(input: {
    applicationId: string;
    reviewerId: string;
    state: ReviewState;
    action: string;
    detail?: string;
  }): Promise<void> {
    await this.prisma.review.create({
      data: {
        applicationId: input.applicationId,
        reviewerId: input.reviewerId,
        state: input.state,
        note: input.detail,
        actions: {
          create: {
            action: input.action,
            actorId: input.reviewerId,
            detail: input.detail,
          },
        },
      },
    });
  }

  async recordPublication(applicationId: string, status: string): Promise<void> {
    await this.prisma.publication.create({
      data: { applicationId, status },
    });
  }

  async audit(event: AuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        action: event.action,
        actorId: event.actorId,
        actorType: event.actorType,
        applicationId: event.applicationId,
        reason: event.reason ?? event.detail,
        previousState: event.previousState,
        newState: event.newState,
      },
    });
  }

  async listAudit(applicationId?: string): Promise<AuditEventView[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: applicationId ? { applicationId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      actorType: row.actorType as "DEVELOPER" | "ADMIN",
      applicationId: row.applicationId ?? undefined,
      at: row.createdAt.toISOString(),
      detail: row.reason ?? undefined,
      reason: row.reason ?? undefined,
      previousState: (row.previousState as ReviewState | null) ?? undefined,
      newState: (row.newState as ReviewState | null) ?? undefined,
    }));
  }
}

export function createApplicationRepository(
  mode: "memory" | "prisma",
  prisma?: PrismaClient,
): ApplicationRepository {
  if (mode === "memory") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MemoryApplicationRepository is forbidden in production.");
    }
    return new MemoryApplicationRepository();
  }
  if (!prisma) throw new Error("Prisma client required for prisma repository mode.");
  return new PrismaApplicationRepository(prisma);
}

export function resolveRepositoryMode(): "memory" | "prisma" {
  const explicit = process.env.XPERIENCE_REPOSITORY;
  if (explicit === "memory") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("XPERIENCE_REPOSITORY=memory is forbidden in production.");
    }
    return "memory";
  }
  if (explicit === "prisma" || process.env.DATABASE_URL) return "prisma";
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required for Xperience persistence in production.");
  }
  throw new Error(
    "Persistence required: set DATABASE_URL for Prisma/PostgreSQL, or XPERIENCE_REPOSITORY=memory for explicit local tests only.",
  );
}
