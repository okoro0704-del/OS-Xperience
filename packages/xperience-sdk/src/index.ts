import {
  isAllowedMessageOrigin,
  validateHandshake,
  type ApplicationManifestClaim,
  type ApplicationSurfaceType,
  type ApplicationView,
  type AuditEventView,
  type Capability,
  type CapabilityReviewState,
  type DirectoryApplicationView,
  type EvidenceType,
  type ExperienceMembershipView,
  type OpenExperiencePayload,
  type ReviewState,
  type VerificationEvidenceView,
  type XperienceReady,
} from "@digiconomy/xperience-contract";

export interface XperienceClientOptions {
  applicationId: string;
  origin: string;
  parentWindow?: Window;
}

/** Minimal channel only: no credentials, storage, identity proof, or authorization is transported. */
export function createXperienceClient(options: XperienceClientOptions) {
  const parent = options.parentWindow ?? window.parent;
  return {
    handshake(event: MessageEvent): XperienceReady | null {
      if (!isAllowedMessageOrigin(event.origin, options.origin)) return null;
      const result = validateHandshake(event.data, options);
      if (!result.ok) return null;
      const ready: XperienceReady = {
        type: "DIGICONOMY_XPERIENCE_READY",
        protocol: "1",
        applicationId: options.applicationId,
        nonce: result.value.nonce,
      };
      parent.postMessage(ready, event.origin);
      return ready;
    },
  };
}

export type DevActorHeader = `${"DEVELOPER" | "ADMIN" | "USER"}:${string}`;

export interface XperienceApiClientOptions {
  baseUrl: string;
  actor: DevActorHeader;
  email?: string;
  displayName?: string;
  fetchImpl?: typeof fetch;
}

export class XperienceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Typed HTTP client for developer, admin, and consumer Experience surfaces. */
export function createXperienceApiClient(options: XperienceApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Xperience-Dev-Actor": options.actor,
    };
    if (options.email) headers["X-Xperience-Dev-Email"] = options.email;
    if (options.displayName) headers["X-Xperience-Dev-Name"] = options.displayName;
    const response = await fetchImpl(`${options.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    if (!response.ok) {
      throw new XperienceApiError(data.error ?? `Request failed (${response.status})`, response.status, data.code);
    }
    return data as T;
  }

  return {
    me: () =>
      request<{ id: string; role: string; email?: string | null; displayName?: string | null }>("GET", "/v1/me"),
    listApplications: () => request<{ applications: ApplicationView[] }>("GET", "/v1/applications"),
    registerApplication: (manifest: ApplicationManifestClaim) =>
      request<ApplicationView>("POST", "/v1/applications", { manifest }),
    getApplication: (id: string) => request<ApplicationView>("GET", `/v1/applications/${encodeURIComponent(id)}`),
    updateManifest: (id: string, manifest: ApplicationManifestClaim) =>
      request<ApplicationView>("PATCH", `/v1/applications/${encodeURIComponent(id)}/manifest`, { manifest }),
    addEvidence: (id: string, type: EvidenceType, locator: string) =>
      request<{
        application: ApplicationView;
        verification: { status: string; detail: string };
      }>("POST", `/v1/applications/${encodeURIComponent(id)}/evidence`, { type, locator }),
    listEvidence: (id: string) =>
      request<{ evidence: VerificationEvidenceView[] }>("GET", `/v1/applications/${encodeURIComponent(id)}/evidence`),
    submit: (id: string) =>
      request<ApplicationView>("POST", `/v1/applications/${encodeURIComponent(id)}/submit`),
    transition: (id: string, state: ReviewState, reason?: string) =>
      request<ApplicationView>("POST", `/v1/applications/${encodeURIComponent(id)}/transition`, { state, reason }),
    reviewStatus: (id: string) =>
      request<{ applicationId: string; state: ReviewState; revision: number }>(
        "GET",
        `/v1/applications/${encodeURIComponent(id)}/review-status`,
      ),
    adminQueue: () => request<{ applications: ApplicationView[] }>("GET", "/v1/admin/queue"),
    adminGet: (id: string) =>
      request<ApplicationView>("GET", `/v1/admin/applications/${encodeURIComponent(id)}`),
    adminEvidence: (id: string) =>
      request<{ evidence: VerificationEvidenceView[] }>(
        "GET",
        `/v1/admin/applications/${encodeURIComponent(id)}/evidence`,
      ),
    adminAudit: (applicationId?: string) =>
      applicationId
        ? request<{ events: AuditEventView[] }>(
            "GET",
            `/v1/admin/applications/${encodeURIComponent(applicationId)}/audit`,
          )
        : request<{ events: AuditEventView[] }>("GET", "/v1/admin/audit"),
    reviewCapability: (
      id: string,
      capability: Capability,
      status: Exclude<CapabilityReviewState, "REQUESTED">,
      reason?: string,
    ) =>
      request<ApplicationView>("POST", `/v1/admin/applications/${encodeURIComponent(id)}/capabilities`, {
        capability,
        status,
        reason,
      }),
    adminAction: (id: string, action: string, reason?: string) =>
      request<ApplicationView>("POST", `/v1/admin/applications/${encodeURIComponent(id)}/actions/${action}`, {
        reason,
      }),
    listDirectory: (params?: { q?: string; category?: string }) => {
      const search = new URLSearchParams();
      if (params?.q) search.set("q", params.q);
      if (params?.category) search.set("category", params.category);
      const qs = search.toString();
      return request<{ applications: DirectoryApplicationView[] }>(
        "GET",
        `/v1/directory${qs ? `?${qs}` : ""}`,
      );
    },
    featuredDirectory: () =>
      request<{ applications: DirectoryApplicationView[] }>("GET", "/v1/directory/featured"),
    getDirectoryApplication: (id: string) =>
      request<DirectoryApplicationView>("GET", `/v1/directory/${encodeURIComponent(id)}`),
    listMyExperience: (filter?: string) => {
      const qs = filter ? `?filter=${encodeURIComponent(filter)}` : "";
      return request<{ experiences: ExperienceMembershipView[] }>("GET", `/v1/experience${qs}`);
    },
    startExperience: (id: string) =>
      request<ExperienceMembershipView>("POST", `/v1/experience/${encodeURIComponent(id)}`),
    stopExperience: (id: string) =>
      request<{ removed: true }>("DELETE", `/v1/experience/${encodeURIComponent(id)}`),
    pauseExperience: (id: string) =>
      request<ExperienceMembershipView>("POST", `/v1/experience/${encodeURIComponent(id)}/pause`),
    resumeExperience: (id: string) =>
      request<ExperienceMembershipView>("POST", `/v1/experience/${encodeURIComponent(id)}/resume`),
    openExperience: (id: string, options?: { surface?: ApplicationSurfaceType }) =>
      request<OpenExperiencePayload>("POST", `/v1/experience/${encodeURIComponent(id)}/open`, {
        surface: options?.surface === "MANAGEMENT" ? "MANAGEMENT" : "PUBLIC",
      }),
    getCatalogManifest: () =>
      request<import("@digiconomy/xperience-contract").SignedExperienceCatalog>(
        "GET",
        "/v1/catalog/manifest",
      ),
    getConsumerCatalog: () =>
      request<import("@digiconomy/xperience-contract").SignedExperienceCatalog>(
        "GET",
        "/v1/catalog/consumer",
      ),
    listReleases: () =>
      request<{
        experiences: import("@digiconomy/xperience-contract").CatalogExperienceEntry[];
        audits: unknown[];
        manifestVersion: number;
      }>("GET", "/v1/admin/releases"),
    releaseAction: (
      id: string,
      action: "preload" | "lock" | "go-live" | "pause" | "retire",
      body?: { visibility?: string; confirmLive?: boolean },
    ) =>
      request<{
        experience: import("@digiconomy/xperience-contract").CatalogExperienceEntry;
        catalog: import("@digiconomy/xperience-contract").SignedExperienceCatalog;
      }>("POST", `/v1/admin/releases/${encodeURIComponent(id)}/${action}`, body ?? {}),
  };
}

export type XperienceApiClient = ReturnType<typeof createXperienceApiClient>;
