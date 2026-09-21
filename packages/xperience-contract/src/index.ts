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

/** Canonical launch surfaces for one Application identity — not separate Directory apps. */
export const APPLICATION_SURFACE_TYPES = ["PUBLIC", "MANAGEMENT"] as const;
export type ApplicationSurfaceType = (typeof APPLICATION_SURFACE_TYPES)[number];

/**
 * Who authenticates the human for an Experience.
 * Xperience launch ≠ authentication.
 */
export const EXPERIENCE_AUTH_MODES = ["PUBLIC", "APP_MANAGED", "TRUSTID"] as const;
export type ExperienceAuthMode = (typeof EXPERIENCE_AUTH_MODES)[number];

/** How much of an Experience can run without network. */
export const OFFLINE_CAPABILITIES = ["NONE", "SHELL_ONLY", "PARTIAL", "FULL"] as const;
export type OfflineCapability = (typeof OFFLINE_CAPABILITIES)[number];

export function normalizeExperienceAuthMode(value: unknown): ExperienceAuthMode {
  if (value === "PUBLIC" || value === "APP_MANAGED" || value === "TRUSTID") return value;
  return "PUBLIC";
}

export function normalizeOfflineCapability(value: unknown): OfflineCapability {
  if (value === "NONE" || value === "SHELL_ONLY" || value === "PARTIAL" || value === "FULL") return value;
  return "NONE";
}

/**
 * Local Xperience installation — device/install continuity, not human verification.
 * Must never be treated as TrustID / PDI identity.
 */
export interface XperienceInstallation {
  installationId: string;
  createdAt: string;
  lastOpenedAt: string;
  lastExperienceId?: string;
  runtimeVersion: string;
}

/** Local Experience registry row for offline restore and auth contract. */
export interface ExperienceRegistryEntry {
  experienceId: string;
  name: string;
  version: string;
  entrypoint: string;
  origin: string;
  authMode: ExperienceAuthMode;
  offlineCapability: OfflineCapability;
  status: "READY" | "UNAVAILABLE" | "ONLINE_ONLY";
  lastUpdatedAt: string;
  managementUrl?: string;
  category?: string;
  description?: string;
  /** Admin release control — never trust client-only edits without signed catalog. */
  releaseState?: import("./release.js").ExperienceReleaseState;
  visibility?: import("./release.js").ExperienceVisibility;
  preloadPolicy?: import("./release.js").PreloadPolicy;
  packageVersion?: string;
  contentHash?: string;
}

/**
 * Runtime slot for switching Experiences without owning app auth sessions.
 * Never stores passwords, passkeys, OTPs, cookies, or private tokens.
 */
export interface ExperienceSlot {
  experienceId: string;
  route?: string;
  lastActiveAt: string;
  surface: ApplicationSurfaceType;
  /** Opaque app-owned restore hint — never Xperience auth material. */
  restoreState?: string;
  /** Runtime tier assigned by the Xperience switcher. */
  runtimeTier?: RuntimeTier;
  offlineState?: "ok" | "blocked";
}

/** Shell mode — XPERIENCE is consumption; HOME covers Directory / My Experience / Profile. */
export const RUNTIME_MODES = ["HOME", "XPERIENCE"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/** Memory/battery tiers for hosted Experiences. */
export const RUNTIME_TIERS = ["ACTIVE", "WARM", "SUSPENDED"] as const;
export type RuntimeTier = (typeof RUNTIME_TIERS)[number];

/** Switcher-facing availability — never expose raw backend errors. */
export const EXPERIENCE_AVAILABILITIES = [
  "AVAILABLE",
  "OFFLINE_AVAILABLE",
  "CONNECTION_REQUIRED",
  "LOCKED",
  "DISABLED",
] as const;
export type ExperienceAvailability = (typeof EXPERIENCE_AVAILABILITIES)[number];

export interface LastExperienceState {
  lastExperienceId: string;
  lastRoute?: string;
  lastOpenedAt: string;
  surface: ApplicationSurfaceType;
  experienceStateReference?: string;
}

export interface ApplicationManifestClaim {
  schemaVersion: "1";
  applicationId: string;
  name: string;
  version: string;
  origin: string;
  /** Canonical USER / public surface destination. */
  productionUrl: string;
  xperienceUrl: string;
  /**
   * Optional canonical MANAGEMENT surface destination.
   * Must be an explicit HTTPS URL — never inferred as `${productionUrl}/admin`.
   */
  managementUrl?: string;
  /**
   * Participant IDs with a legitimate management-entry relationship.
   * Entry visibility only — the target app still authorizes real capabilities.
   */
  managementOperatorIds?: string[];
  /** Who owns authentication for the public Experience surface. */
  authMode?: ExperienceAuthMode;
  offlineCapability?: OfflineCapability;
  capabilities: Capability[];
  repository?: { provider: "GITHUB"; url: string };
  deploymentClaims?: { provider: string; url: string }[];
}

/** Normalize an optional management destination — absent or unsafe → undefined (never invent). */
export function normalizeManagementUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  return safeHttpsUrl(trimmed) ? trimmed : undefined;
}

export function normalizeManagementOperatorIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return ids.length ? [...new Set(ids)] : undefined;
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
  if (m.managementUrl != null) {
    if (typeof m.managementUrl !== "string" || !safeHttpsUrl(m.managementUrl)) {
      errors.push("managementUrl must be a public HTTPS URL when declared.");
    }
  }
  if (m.managementOperatorIds != null) {
    if (
      !Array.isArray(m.managementOperatorIds) ||
      m.managementOperatorIds.some((id) => typeof id !== "string" || !id.trim())
    ) {
      errors.push("managementOperatorIds must be an array of participant id strings when declared.");
    }
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
  if (errors.length) return { ok: false, errors };
  const value: ApplicationManifestClaim = {
    schemaVersion: "1",
    applicationId: m.applicationId as string,
    name: m.name as string,
    version: m.version as string,
    origin: m.origin as string,
    productionUrl: m.productionUrl as string,
    xperienceUrl: m.xperienceUrl as string,
    capabilities: m.capabilities as Capability[],
  };
  const managementUrl = normalizeManagementUrl(m.managementUrl);
  if (managementUrl) value.managementUrl = managementUrl;
  const managementOperatorIds = normalizeManagementOperatorIds(m.managementOperatorIds);
  if (managementOperatorIds) value.managementOperatorIds = managementOperatorIds;
  if (m.repository && typeof m.repository === "object") {
    value.repository = m.repository as ApplicationManifestClaim["repository"];
  }
  if (Array.isArray(m.deploymentClaims)) {
    value.deploymentClaims = m.deploymentClaims as ApplicationManifestClaim["deploymentClaims"];
  }
  value.authMode = normalizeExperienceAuthMode(m.authMode);
  value.offlineCapability = normalizeOfflineCapability(m.offlineCapability);
  return { ok: true, value };
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
  "Creator",
  "Finance",
  "Lifestyle",
  "Education",
  "Health",
  "Development",
  "Commerce",
  "Identity",
  "Productivity",
  "Device",
  "Notifications",
  "General",
] as const;
export type DirectoryCategory = (typeof DIRECTORY_CATEGORIES)[number];

/** Deterministic category from declared capabilities — not a recommendation engine. */
export function directoryCategory(capabilities: Capability[]): Exclude<DirectoryCategory, "All"> {
  if (capabilities.includes("COMMERCE")) return "Commerce";
  if (capabilities.includes("PAYMENTS")) return "Finance";
  if (capabilities.includes("LIVE")) return "Creator";
  if (capabilities.includes("MESSAGING")) return "Lifestyle";
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
  /** Canonical USER / public surface. */
  productionUrl: string;
  xperienceUrl: string;
  /**
   * Canonical MANAGEMENT surface when Portal/manifest declared one.
   * Omitted when undeclared — never synthesized from `/admin`.
   */
  managementUrl?: string;
  /**
   * Server-evaluated management-entry relationship for the current participant.
   * Presence of managementUrl alone is not sufficient.
   */
  canManage: boolean;
  /**
   * Who owns authentication for this Experience.
   * Default PUBLIC — Xperience never treats shell entry as authentication.
   */
  authMode?: ExperienceAuthMode;
  /** How far this Experience can operate without network. */
  offlineCapability?: OfflineCapability;
  /** Server release gate — separate from authMode. */
  releaseState?: import("./release.js").ExperienceReleaseState;
  visibility?: import("./release.js").ExperienceVisibility;
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
  /** Canonical USER / public surface. */
  productionUrl: string;
  xperienceUrl: string;
  /** Optional MANAGEMENT surface — Portal-declared only. */
  managementUrl?: string;
  /** Participant IDs with management-entry relationship (Portal-declared). */
  managementOperatorIds?: string[];
  /** Authentication owner for the public Experience surface. */
  authMode?: ExperienceAuthMode;
  offlineCapability?: OfflineCapability;
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
    // LifeOS gateway Directory rows use `id`; claim model uses applicationId.
    const applicationId =
      typeof row.applicationId === "string"
        ? row.applicationId
        : typeof row.id === "string"
          ? row.id
          : null;
    // LifeOS gateway Directory payloads omit visibility; published rows are PUBLIC.
    const visibility =
      row.visibility === "PRIVATE"
        ? "PRIVATE"
        : row.visibility === "PUBLIC" || row.visibility == null
          ? "PUBLIC"
          : null;
    const publicationState =
      row.publicationState === "PUBLISHED" ||
      row.publicationState === "DRAFT" ||
      row.publicationState === "UNPUBLISHED"
        ? row.publicationState
        : null;
    if (
      !applicationId ||
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
    const claim: LifeOSCatalogApplicationClaim = {
      applicationId,
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
    };
    const managementUrl = normalizeManagementUrl(row.managementUrl);
    if (managementUrl) claim.managementUrl = managementUrl;
    const managementOperatorIds = normalizeManagementOperatorIds(row.managementOperatorIds);
    if (managementOperatorIds) claim.managementOperatorIds = managementOperatorIds;
    claim.authMode = normalizeExperienceAuthMode(row.authMode);
    claim.offlineCapability = normalizeOfflineCapability(row.offlineCapability);
    out.push(claim);
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
  /** Resolved destination for the requested surface. */
  embedUrl: string;
  /** Which canonical surface was opened — PUBLIC never silently becomes MANAGEMENT. */
  surface: ApplicationSurfaceType;
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

export {
  parseExperienceUtterance,
  utteranceDoesNotGrantAuthorization,
  type ExperienceUtterance,
  type ExperienceRouteCategory,
} from "./experience-utterance.js";

export {
  EXPERIENCE_RELEASE_STATES,
  EXPERIENCE_VISIBILITIES,
  PRELOAD_POLICIES,
  LOCAL_PACKAGE_STATES,
  normalizeReleaseState,
  normalizeVisibility,
  normalizePreloadPolicy,
  releaseTransitionAllowed,
  isConsumerDiscoverable,
  canLaunchByRelease,
  canPreloadByRelease,
  canonicalCatalogJson,
  generateCatalogSigningKeyPair,
  importCatalogPublicKey,
  importCatalogPrivateKey,
  signExperienceCatalog,
  verifyExperienceCatalog,
  assertCatalogReleaseIntegrity,
  type ExperienceReleaseState,
  type ExperienceVisibility,
  type PreloadPolicy,
  type LocalPackageState,
  type CatalogExperienceEntry,
  type ExperienceCatalogPayload,
  type SignedExperienceCatalog,
  type CatalogKeyPairExport,
} from "./release.js";

export {
  PRESENTATION_STATUSES,
  CHAPTER_ACTIONS,
  normalizePresentationStatus,
  normalizeChapterAction,
  presentationStatusTransitionAllowed,
  type PresentationStatus,
  type ChapterAction,
  type Presentation,
  type PresentationChapter,
  type PresentationView,
  type PresentationAudienceState,
} from "./presentation.js";

