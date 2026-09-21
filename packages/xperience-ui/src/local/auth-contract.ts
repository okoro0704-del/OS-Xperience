import {
  normalizeExperienceAuthMode,
  normalizeOfflineCapability,
  type ApplicationSurfaceType,
  type DirectoryApplicationView,
  type ExperienceAuthMode,
  type ExperienceRegistryEntry,
  type OfflineCapability,
  type OpenExperiencePayload,
} from "@digiconomy/xperience-contract";

/**
 * Xperience shell authentication posture for an Experience.
 * Opening the shell never equals authenticated.
 */
export type ShellAuthPosture =
  | { mode: "PUBLIC"; shellClaimsAuthenticated: false }
  | { mode: "APP_MANAGED"; shellClaimsAuthenticated: false; owner: "application" }
  | { mode: "TRUSTID"; shellClaimsAuthenticated: false; requiresTrustId: true };

export function shellAuthPosture(authMode: ExperienceAuthMode | undefined): ShellAuthPosture {
  const mode = normalizeExperienceAuthMode(authMode);
  if (mode === "TRUSTID") {
    return { mode: "TRUSTID", shellClaimsAuthenticated: false, requiresTrustId: true };
  }
  if (mode === "APP_MANAGED") {
    return { mode: "APP_MANAGED", shellClaimsAuthenticated: false, owner: "application" };
  }
  return { mode: "PUBLIC", shellClaimsAuthenticated: false };
}

/** Xperience never grants authenticated access for TRUSTID Experiences. */
export function canClaimAuthenticatedWithoutTrustId(authMode: ExperienceAuthMode | undefined): boolean {
  return normalizeExperienceAuthMode(authMode) !== "TRUSTID";
}

export function canOperateOffline(
  capability: OfflineCapability | undefined,
  online: boolean,
): { ok: boolean; reason?: string } {
  if (online) return { ok: true };
  const cap = normalizeOfflineCapability(capability);
  if (cap === "NONE") {
    return {
      ok: false,
      reason: "This Experience needs a connection to continue. Your previous state has been preserved.",
    };
  }
  return { ok: true };
}

export function buildLocalOpenPayload(
  app: Pick<
    DirectoryApplicationView,
    | "id"
    | "name"
    | "origin"
    | "productionUrl"
    | "xperienceUrl"
    | "managementUrl"
    | "canManage"
    | "experienceStatus"
    | "authMode"
    | "offlineCapability"
  >,
  surface: ApplicationSurfaceType = "PUBLIC",
): OpenExperiencePayload {
  if (surface === "MANAGEMENT") {
    if (!app.managementUrl || !app.canManage) {
      throw new Error("Management access is not available for this application.");
    }
  }
  const embedUrl =
    surface === "MANAGEMENT" && app.managementUrl
      ? app.managementUrl
      : app.xperienceUrl || app.productionUrl;
  return {
    applicationId: app.id,
    name: app.name,
    origin: app.origin,
    embedUrl,
    surface,
    status: app.experienceStatus ?? "ACTIVE",
  };
}

export function entryToOpenApp(entry: ExperienceRegistryEntry): DirectoryApplicationView {
  return {
    id: entry.experienceId,
    name: entry.name,
    version: entry.version,
    origin: entry.origin,
    productionUrl: entry.entrypoint,
    xperienceUrl: entry.entrypoint,
    ...(entry.managementUrl ? { managementUrl: entry.managementUrl } : {}),
    canManage: false,
    authMode: entry.authMode,
    offlineCapability: entry.offlineCapability,
    category: "General",
    capabilities: [],
    publicationState: "PUBLISHED",
    experienced: true,
    experienceStatus: "ACTIVE",
    description: entry.description,
  };
}
