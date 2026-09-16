/**
 * Server-side management-entry relationships.
 * Presence of a management URL is not authorization.
 * Grants come from Portal-declared operator IDs and/or explicit server grants —
 * never from frontend role flags, localStorage, or URL guessing.
 */

export interface ManagementAccessPort {
  hasManagementEntry(participantId: string, applicationId: string): Promise<boolean>;
}

export class EmptyManagementAccess implements ManagementAccessPort {
  async hasManagementEntry(): Promise<boolean> {
    return false;
  }
}

/** Explicit grants — typically from Trust ID / membership projection later. */
export class StaticManagementAccess implements ManagementAccessPort {
  private readonly grants: Map<string, Set<string>>;

  constructor(entries: ReadonlyArray<{ applicationId: string; participantIds: readonly string[] }>) {
    this.grants = new Map();
    for (const entry of entries) {
      const appId = entry.applicationId.trim();
      if (!appId) continue;
      const set = this.grants.get(appId) ?? new Set<string>();
      for (const id of entry.participantIds) {
        if (typeof id === "string" && id.trim()) set.add(id.trim());
      }
      if (set.size) this.grants.set(appId, set);
    }
  }

  async hasManagementEntry(participantId: string, applicationId: string): Promise<boolean> {
    return this.grants.get(applicationId)?.has(participantId) ?? false;
  }
}

/**
 * Env shape:
 * XPERIENCE_MANAGEMENT_ACCESS_JSON=
 *   [{"applicationId":"ins_…","participantIds":["user-1"]}]
 */
export function createManagementAccessFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ManagementAccessPort {
  const raw = env.XPERIENCE_MANAGEMENT_ACCESS_JSON?.trim();
  if (!raw) return new EmptyManagementAccess();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new EmptyManagementAccess();
    const entries: { applicationId: string; participantIds: string[] }[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.applicationId !== "string") continue;
      const participantIds = Array.isArray(row.participantIds)
        ? row.participantIds.filter((id): id is string => typeof id === "string")
        : [];
      entries.push({ applicationId: row.applicationId, participantIds });
    }
    return new StaticManagementAccess(entries);
  } catch {
    return new EmptyManagementAccess();
  }
}
