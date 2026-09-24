export type CapabilityId = string & {};
export type CapabilityState = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "NOT_IMPLEMENTED";
export type Requirement = "REQUIRED" | "OPTIONAL";
export type ExperienceState = "READY" | "DEGRADED" | "BLOCKED";
export type CapabilityRequirement = { id: CapabilityId; requirement: Requirement; minimumVersion?: string };
export type ResolutionContext = { spaceId?: string; experienceId?: string; [key: string]: unknown };
export type CapabilityResolution = { id: CapabilityId; state: CapabilityState; providerId: string; providerVersion: string; reason?: string; metadata?: Record<string, unknown> };
export interface CapabilityProvider { providerId: string; version: string; priority?: number; supports(id: CapabilityId): boolean; resolve(id: CapabilityId, context?: ResolutionContext): Promise<CapabilityResolution> | CapabilityResolution }
const validStates = new Set<CapabilityState>(["AVAILABLE", "DEGRADED", "UNAVAILABLE", "NOT_IMPLEMENTED"]);
const unavailable = (id: CapabilityId, reason: string): CapabilityResolution => ({ id, state: "UNAVAILABLE", providerId: "bridge", providerVersion: "1.0.0", reason });
export class CapabilityRegistry {
  #providers: CapabilityProvider[] = [];
  register(provider: CapabilityProvider) { this.unregister(provider.providerId); this.#providers.push(provider); }
  unregister(providerId: string) { this.#providers = this.#providers.filter((provider) => provider.providerId !== providerId); }
  list() { return [...this.#providers]; }
  providersFor(id: CapabilityId) { return this.#providers.filter((provider) => provider.supports(id)).sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0) || this.#providers.indexOf(a) - this.#providers.indexOf(b)); }
  async resolve(id: CapabilityId, context?: ResolutionContext): Promise<CapabilityResolution> {
    const provider = this.providersFor(id)[0]; if (!provider) return unavailable(id, "NO_PROVIDER");
    try { const result = await provider.resolve(id, context); if (!result || result.id !== id || !validStates.has(result.state)) return unavailable(id, "MALFORMED_PROVIDER_RESULT"); return { ...result, providerId: result.providerId || provider.providerId, providerVersion: result.providerVersion || provider.version }; }
    catch { return unavailable(id, "PROVIDER_FAILURE"); }
  }
}
export type ExperienceResolution = { experienceState: ExperienceState; capabilities: Record<string, CapabilityResolution> };
export async function resolveExperienceCapabilities(requirements: readonly CapabilityRequirement[], registry: CapabilityRegistry, context?: ResolutionContext): Promise<ExperienceResolution> {
  const capabilities: Record<string, CapabilityResolution> = {};
  const distinct = requirements.filter((item, index) => requirements.findIndex((other) => other.id === item.id) === index);
  for (const item of distinct) capabilities[item.id] = await registry.resolve(item.id, context);
  let experienceState: ExperienceState = "READY";
  for (const item of distinct) { const state = capabilities[item.id]!.state; if (item.requirement === "REQUIRED" && (state === "UNAVAILABLE" || state === "NOT_IMPLEMENTED")) return { experienceState: "BLOCKED", capabilities }; if (state === "DEGRADED") experienceState = "DEGRADED"; }
  return { experienceState, capabilities };
}
/** Adapts any descriptor-shaped capability source without coupling the core to it. */
export function createDescriptorProvider(providerId: string, version: string, supports: (id: CapabilityId) => boolean, lookup: (id: CapabilityId, context?: ResolutionContext) => { state: CapabilityState; reason?: string; metadata?: Record<string, unknown> }, priority = 0): CapabilityProvider { return { providerId, version, priority, supports, resolve: (id, context) => ({ id, providerId, providerVersion: version, ...lookup(id, context) }) }; }
