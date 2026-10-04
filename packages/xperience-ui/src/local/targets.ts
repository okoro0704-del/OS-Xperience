import {
  resolveExperienceTargets,
  type CatalogExecutionTarget,
  type ExperienceExecutionMode,
  type ExperienceTarget,
} from "@digiconomy/xperience-contract";
import { MYBRANDOS_PUBLIC_ID, bootstrapPublicEntry } from "./bootstrap.js";
import { readSignedCatalog, signedCatalogGovernsExecution } from "./catalog.js";
import { findRegistryEntry } from "./registry.js";
import { registeredSpaceMode } from "./space-registry.js";

export interface ProviderRef {
  id: string;
  entrypoint?: string;
  executionModes?: CatalogExecutionTarget[];
}

function declaredModes(provider: ProviderRef): CatalogExecutionTarget[] | undefined {
  if (provider.executionModes) return provider.executionModes;
  const registered = findRegistryEntry(provider.id)?.executionModes;
  if (registered) return registered;
  // Registries written before execution modes existed still hold the bootstrap provider without them.
  if (provider.id === MYBRANDOS_PUBLIC_ID) return bootstrapPublicEntry().executionModes;
  return undefined;
}

/** A verified Space Launch File registration contributes the SPACE mode only; the provider's APP stays as declared. */
function withRegisteredSpace(providerId: string, modes: CatalogExecutionTarget[] | undefined): CatalogExecutionTarget[] | undefined {
  const registered = registeredSpaceMode(providerId);
  if (!registered) return modes;
  const base = modes?.length ? modes : [{ mode: "APP" as const }];
  return base.some((mode) => mode.mode === "SPACE") ? base : [...base, registered];
}

/**
 * All declared (provider, mode) targets. A verified signed catalog entry is authoritative for
 * release, visibility and modes. Local registry data is used only when no governing catalog exists;
 * under a governing catalog a provider it does not carry is NOT_RELEASED — the same rule the lineup applies.
 */
export function providerTargets(provider: ProviderRef): ExperienceTarget[] {
  const entrypoint = provider.entrypoint || findRegistryEntry(provider.id)?.entrypoint || "";
  const catalog = readSignedCatalog();
  const catalogEntry = catalog?.payload.experiences.find((item) => item.experienceId === provider.id);
  if (catalogEntry) {
    return resolveExperienceTargets({ ...catalogEntry, entrypoint: entrypoint || catalogEntry.entrypoint });
  }
  const declared = resolveExperienceTargets({ experienceId: provider.id, entrypoint, executionModes: withRegisteredSpace(provider.id, declaredModes(provider)) });
  if (!signedCatalogGovernsExecution(catalog)) return declared;
  return declared.map((target) => ({ ...target, availability: "NOT_RELEASED" as const }));
}

export function availableProviderTargets(provider: ProviderRef): ExperienceTarget[] {
  return providerTargets(provider).filter((target) => target.availability === "AVAILABLE");
}

export function providerTarget(provider: ProviderRef, mode: ExperienceExecutionMode): ExperienceTarget | null {
  return availableProviderTargets(provider).find((target) => target.executionMode === mode) ?? null;
}

/**
 * Pick the mode to run. A fixed mode (locked host) is never substituted; otherwise the
 * requested mode wins when available, then APP, then whatever the provider offers.
 */
export function chooseExecutionTarget(
  targets: ExperienceTarget[],
  requested: ExperienceExecutionMode | null | undefined,
  fixed?: ExperienceExecutionMode | null,
): ExperienceTarget | null {
  const available = targets.filter((target) => target.availability === "AVAILABLE");
  const byMode = (mode: ExperienceExecutionMode) => available.find((target) => target.executionMode === mode) ?? null;
  if (fixed) return byMode(fixed);
  return (requested ? byMode(requested) : null) ?? byMode("APP") ?? available[0] ?? null;
}

/** An explicitly selected mode runs as that mode or not at all — never substituted with another. */
export function requireExecutionTarget(
  targets: ExperienceTarget[],
  mode: ExperienceExecutionMode,
  fixed?: ExperienceExecutionMode | null,
): ExperienceTarget | null {
  return chooseExecutionTarget(targets, mode, fixed ?? mode);
}

/** Next provider after `currentId` (wrapping) that offers `mode`; never the current provider. */
export function nextProviderWithMode<T extends ProviderRef>(
  providers: T[],
  currentId: string,
  mode: ExperienceExecutionMode,
): T | null {
  const start = providers.findIndex((item) => item.id === currentId);
  for (let step = 1; step <= providers.length; step += 1) {
    const candidate = providers[(start + step + providers.length) % providers.length];
    if (!candidate || candidate.id === currentId) continue;
    if (providerTarget(candidate, mode)) return candidate;
  }
  return null;
}
