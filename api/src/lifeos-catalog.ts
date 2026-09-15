import {
  isLifeOSDirectoryEligible,
  parseLifeOSCatalogPayload,
  type LifeOSCatalogApplicationClaim,
} from "@digiconomy/xperience-contract";

/**
 * Thin read-only LifeOS / Digiconomy catalog port.
 * Projects eligible verticals into Directory without owning them
 * and without creating a second application registry or store backend.
 */
export interface LifeOSCatalogPort {
  listEligible(): Promise<LifeOSCatalogApplicationClaim[]>;
  getEligibleById(applicationId: string): Promise<LifeOSCatalogApplicationClaim | null>;
}

export class EmptyLifeOSCatalog implements LifeOSCatalogPort {
  async listEligible(): Promise<LifeOSCatalogApplicationClaim[]> {
    return [];
  }

  async getEligibleById(): Promise<LifeOSCatalogApplicationClaim | null> {
    return null;
  }
}

/** In-memory catalog for tests and explicit local fixtures — not a second Application DB. */
export class StaticLifeOSCatalog implements LifeOSCatalogPort {
  constructor(private readonly claims: readonly LifeOSCatalogApplicationClaim[]) {}

  async listEligible(): Promise<LifeOSCatalogApplicationClaim[]> {
    return this.claims.filter(isLifeOSDirectoryEligible);
  }

  async getEligibleById(applicationId: string): Promise<LifeOSCatalogApplicationClaim | null> {
    const claim = this.claims.find((item) => item.applicationId === applicationId) ?? null;
    if (!claim || !isLifeOSDirectoryEligible(claim)) return null;
    return claim;
  }
}

/** HTTP projection of a LifeOS-published catalog endpoint. */
export class HttpLifeOSCatalog implements LifeOSCatalogPort {
  constructor(
    private readonly catalogUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async load(): Promise<LifeOSCatalogApplicationClaim[]> {
    try {
      const response = await this.fetchImpl(this.catalogUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`LifeOS catalog request failed (${response.status}).`);
      const payload = (await response.json()) as unknown;
      return parseLifeOSCatalogPayload(payload).filter(isLifeOSDirectoryEligible);
    } catch (error) {
      throw new Error(
        `LifeOS catalog is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async listEligible(): Promise<LifeOSCatalogApplicationClaim[]> {
    return this.load();
  }

  async getEligibleById(applicationId: string): Promise<LifeOSCatalogApplicationClaim | null> {
    const all = await this.load();
    return all.find((item) => item.applicationId === applicationId) ?? null;
  }
}

export function createLifeOSCatalogFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): LifeOSCatalogPort {
  const inline = env.LIFEOS_DIRECTORY_CATALOG_JSON?.trim();
  if (inline) {
    try {
      return new StaticLifeOSCatalog(parseLifeOSCatalogPayload(JSON.parse(inline)));
    } catch {
      return new EmptyLifeOSCatalog();
    }
  }
  const url = env.LIFEOS_DIRECTORY_CATALOG_URL?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return new HttpLifeOSCatalog(url, fetchImpl);
      }
    } catch {
      return new EmptyLifeOSCatalog();
    }
  }
  return new EmptyLifeOSCatalog();
}
