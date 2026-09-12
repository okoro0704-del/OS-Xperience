export const CAPABILITIES = [
  "IDENTITY",
  "MESSAGING",
  "FILES",
  "PAYMENTS",
  "CAMERA",
  "DEVICE_BRIDGE",
  "LIVE",
  "COMMERCE",
  "NOTIFICATIONS",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const REVIEW_STATES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CHANGES_REQUIRED",
  "APPROVED",
  "PUBLISHED",
  "SUSPENDED",
  "REVOKED",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const EVIDENCE_TYPES = [
  "DOMAIN",
  "WELL_KNOWN_ENDPOINT",
  "GITHUB",
  "DEPLOYMENT_PROVIDER",
  "XPERIENCE_ENDPOINT",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const CAPABILITY_REVIEW_STATES = ["REQUESTED", "APPROVED", "REJECTED", "REQUIRES_CHANGES"] as const;
export type CapabilityReviewState = (typeof CAPABILITY_REVIEW_STATES)[number];

export const EVIDENCE_STATUSES = ["PENDING", "VERIFIED", "FAILED", "UNAVAILABLE"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export interface ApplicationManifestClaim {
  schemaVersion: "1";
  applicationId: string;
  name: string;
  version: string;
  origin: string;
  productionUrl: string;
  xperienceUrl: string;
  capabilities: Capability[];
  repository?: { provider: "GITHUB"; url: string };
  deploymentClaims?: { provider: string; url: string }[];
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const forbidden = /password|private.?key|session.?cookie|biometric|payment.?credential|secret/i;

export function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function validateManifest(input: unknown): ValidationResult<ApplicationManifestClaim> {
  if (!input || typeof input !== "object") return { ok: false, errors: ["Manifest must be an object."] };
  const m = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of ["applicationId", "name", "version", "origin", "productionUrl", "xperienceUrl"]) {
    if (typeof m[key] !== "string" || !m[key]) errors.push(`${key} is required.`);
  }
  if (m.schemaVersion !== "1") errors.push("Unsupported schemaVersion.");
  if (typeof m.origin !== "string" || !safeHttpsUrl(m.origin) || new URL(m.origin).pathname !== "/") {
    errors.push("origin must be a public HTTPS origin.");
  }
  for (const key of ["productionUrl", "xperienceUrl"]) {
    if (typeof m[key] !== "string" || !safeHttpsUrl(m[key] as string)) errors.push(`${key} must be a public HTTPS URL.`);
  }
  const capabilities = m.capabilities;
  if (
    !Array.isArray(capabilities) ||
    capabilities.some((x) => typeof x !== "string" || !(CAPABILITIES as readonly string[]).includes(x))
  ) {
    errors.push("Capabilities must use the Xperience allowlist.");
  }
  if (forbidden.test(JSON.stringify(input))) {
    errors.push("Manifest must not contain credentials or sensitive identity data.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: m as unknown as ApplicationManifestClaim };
}

export function reviewTransitionAllowed(from: ReviewState, to: ReviewState): boolean {
  const graph: Record<ReviewState, ReviewState[]> = {
    DRAFT: ["SUBMITTED"],
    SUBMITTED: ["UNDER_REVIEW", "CHANGES_REQUIRED"],
    UNDER_REVIEW: ["CHANGES_REQUIRED", "APPROVED", "SUSPENDED"],
    CHANGES_REQUIRED: ["DRAFT", "SUBMITTED"],
    APPROVED: ["PUBLISHED", "CHANGES_REQUIRED", "SUSPENDED"],
    PUBLISHED: ["SUSPENDED", "REVOKED"],
    SUSPENDED: ["APPROVED", "REVOKED"],
    REVOKED: [],
  };
  return graph[from].includes(to);
}

/** Capability approval is a review decision — never runtime authorization. */
export function capabilityApprovalIsNotRuntimeAuthorization(): true {
  return true;
}

/** APPROVED and PUBLISHED are deliberate, separate decisions. */
export function approvedDoesNotAutoPublish(state: ReviewState): boolean {
  return state !== "PUBLISHED";
}

export interface ApplicationCapabilityView {
  capability: Capability;
  status: CapabilityReviewState;
}

export interface VerificationEvidenceView {
  id: string;
  type: EvidenceType;
  locator: string;
  status: EvidenceStatus;
  detail?: string;
}

export interface AuditEventView {
  id?: string;
  action: string;
  actorId: string;
  actorType: "DEVELOPER" | "ADMIN" | "USER";
  applicationId?: string | null;
  at: string;
  previousState?: ReviewState;
  newState?: ReviewState;
  reason?: string;
  detail?: string;
}

/** User membership in My Experience — not Directory presence and not an install. */
export const EXPERIENCE_MEMBERSHIP_STATUSES = ["ACTIVE", "PAUSED", "UNAVAILABLE"] as const;
export type ExperienceMembershipStatus = (typeof EXPERIENCE_MEMBERSHIP_STATUSES)[number];

export const DIRECTORY_CATEGORIES = [
  "All",
  "Finance",
  "Lifestyle",
  "Identity",
  "Productivity",
  "Device",
  "Notifications",
  "General",
] as const;
export type DirectoryCategory = (typeof DIRECTORY_CATEGORIES)[number];

/** Deterministic category from declared capabilities — not a recommendation engine. */
export function directoryCategory(capabilities: Capability[]): Exclude<DirectoryCategory, "All"> {
  if (capabilities.includes("COMMERCE") || capabilities.includes("PAYMENTS")) return "Finance";
  if (capabilities.includes("LIVE") || capabilities.includes("MESSAGING")) return "Lifestyle";
  if (capabilities.includes("CAMERA") || capabilities.includes("DEVICE_BRIDGE")) return "Device";
  if (capabilities.includes("FILES")) return "Productivity";
  if (capabilities.includes("IDENTITY")) return "Identity";
  if (capabilities.includes("NOTIFICATIONS")) return "Notifications";
  return "General";
}

/** Public Directory listing — only published applications; no private review/admin fields. */
export interface DirectoryApplicationView {
  id: string;
  name: string;
  version: string;
  origin: string;
  productionUrl: string;
  xperienceUrl: string;
  category: Exclude<DirectoryCategory, "All">;
  capabilities: Capability[];
  publicationState: "PUBLISHED" | "NOT_PUBLISHED";
  experienced: boolean;
  experienceStatus?: ExperienceMembershipStatus;
  /** Optional public metadata — never invent when absent. */
  description?: string;
  developerName?: string;
  /** Where Directory discovered the eligible identity (not ownership). */
  ecosystemSource?: "LIFEOS" | "XPERIENCE";
}

/**
 * Read-only Digiconomy / LifeOS catalog claim.
 * LifeOS remains source of truth — OS Experience projects eligibility only.
 */
export interface LifeOSCatalogApplicationClaim {
  applicationId: string;
  name: string;
  version: string;
  origin: string;
  productionUrl: string;
  xperienceUrl: string;
  capabilities: Capability[];
  /** PUBLIC eligible for Directory; PRIVATE never listed. */
  visibility: "PUBLIC" | "PRIVATE";
  /** Only PUBLISHED is Directory-eligible. DRAFT / UNPUBLISHED excluded. */
  publicationState: "PUBLISHED" | "DRAFT" | "UNPUBLISHED";
  description?: string;
  developerName?: string;
}

/** Explicit eligibility — incomplete / private / draft never enter Directory. */
export function isLifeOSDirectoryEligible(claim: LifeOSCatalogApplicationClaim): boolean {
  if (claim.visibility !== "PUBLIC") return false;
  if (claim.publicationState !== "PUBLISHED") return false;
  if (!claim.applicationId?.trim() || !claim.name?.trim()) return false;
  if (!safeHttpsUrl(claim.origin) || new URL(claim.origin).pathname !== "/") return false;
  if (!safeHttpsUrl(claim.productionUrl) || !safeHttpsUrl(claim.xperienceUrl)) return false;
  if (
    !Array.isArray(claim.capabilities) ||
    claim.capabilities.some((c) => !(CAPABILITIES as readonly string[]).includes(c))
  ) {
    return false;
  }
  return true;
}

export function parseLifeOSCatalogPayload(input: unknown): LifeOSCatalogApplicationClaim[] {
  const raw = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { applications?: unknown }).applications)
      ? (input as { applications: unknown[] }).applications
      : null;
  if (!raw) return [];
  const out: LifeOSCatalogApplicationClaim[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const capabilities = Array.isArray(row.capabilities)
      ? row.capabilities.filter(
          (c): c is Capability => typeof c === "string" && (CAPABILITIES as readonly string[]).includes(c),
        )
      : [];
    const visibility = row.visibility === "PRIVATE" ? "PRIVATE" : row.visibility === "PUBLIC" ? "PUBLIC" : null;
    const publicationState =
      row.publicationState === "PUBLISHED" ||
      row.publicationState === "DRAFT" ||
      row.publicationState === "UNPUBLISHED"
        ? row.publicationState
        : null;
    if (
      typeof row.applicationId !== "string" ||
      typeof row.name !== "string" ||
      typeof row.version !== "string" ||
      typeof row.origin !== "string" ||
      typeof row.productionUrl !== "string" ||
      typeof row.xperienceUrl !== "string" ||
      !visibility ||
      !publicationState
    ) {
      continue;
    }
    out.push({
      applicationId: row.applicationId,
      name: row.name,
      version: row.version,
      origin: row.origin,
      productionUrl: row.productionUrl,
      xperienceUrl: row.xperienceUrl,
      capabilities,
      visibility,
      publicationState,
      description: typeof row.description === "string" ? row.description : undefined,
      developerName: typeof row.developerName === "string" ? row.developerName : undefined,
    });
  }
  return out;
}

export interface ExperienceMembershipView {
  applicationId: string;
  status: ExperienceMembershipStatus;
  addedAt: string;
  lastOpenedAt?: string;
  application: DirectoryApplicationView;
}

/** Safe open payload for the in-app experience frame. */
export interface OpenExperiencePayload {
  applicationId: string;
  name: string;
  origin: string;
  embedUrl: string;
  status: ExperienceMembershipStatus;
}

export interface ApplicationView {
  id: string;
  developerId: string;
  state: ReviewState;
  manifest: ApplicationManifestClaim;
  revision: number;
  capabilities: ApplicationCapabilityView[];
  evidence: VerificationEvidenceView[];
  integrationStatus: "NOT_CONFIGURED" | "DECLARED" | "TESTABLE";
}

export interface RegisterApplicationRequest {
  manifest: ApplicationManifestClaim;
}

export interface TransitionRequest {
  state: ReviewState;
  reason?: string;
}

export interface CapabilityReviewRequest {
  capability: Capability;
  status: Exclude<CapabilityReviewState, "REQUESTED">;
  reason?: string;
}

export interface EvidenceClaimRequest {
  type: EvidenceType;
  locator: string;
}

export interface XperienceHandshake {
  type: "DIGICONOMY_XPERIENCE_HANDSHAKE";
  protocol: "1";
  applicationId: string;
  origin: string;
  nonce: string;
}

export interface XperienceReady {
  type: "DIGICONOMY_XPERIENCE_READY";
  protocol: "1";
  applicationId: string;
  nonce: string;
}

export function validateHandshake(
  message: unknown,
  expected: { applicationId: string; origin: string },
): ValidationResult<XperienceHandshake> {
  const m = message as Partial<XperienceHandshake>;
  if (
    !m ||
    m.type !== "DIGICONOMY_XPERIENCE_HANDSHAKE" ||
    m.protocol !== "1" ||
    m.applicationId !== expected.applicationId ||
    m.origin !== expected.origin ||
    !m.nonce ||
    !safeHttpsUrl(m.origin)
  ) {
    return { ok: false, errors: ["Invalid Xperience handshake."] };
  }
  return { ok: true, value: m as XperienceHandshake };
}

export function isAllowedMessageOrigin(eventOrigin: string, applicationOrigin: string): boolean {
  return eventOrigin === applicationOrigin && safeHttpsUrl(eventOrigin);
}

export interface ShellRegistryPort {
  resolveApplication(applicationId: string): Promise<{ applicationId: string; origin: string } | null>;
}
