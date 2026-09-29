import type { ExperienceRegistryEntry } from "@digiconomy/xperience-contract";

/** Phase X1 first Experience — public mybrandOS (not Studio). */
export const MYBRANDOS_PUBLIC_ID = "bootstrap.mybrandos.public";

/** Mirrors the signed catalog seed so the bootstrap provider keeps both modes before any catalog arrives. */
export const MYBRANDOS_PUBLIC_ENTRY: ExperienceRegistryEntry = {
  experienceId: MYBRANDOS_PUBLIC_ID,
  name: "mybrandOS",
  version: "1.0.0",
  entrypoint: "https://mrfundzman.getlifeos.app/",
  origin: "https://mrfundzman.getlifeos.app/",
  authMode: "PUBLIC",
  offlineCapability: "PARTIAL",
  status: "READY",
  lastUpdatedAt: "2026-01-01T00:00:00.000Z",
  category: "Lifestyle",
  description: "Public mybrandOS Experience",
  executionModes: [{ mode: "APP" }, { mode: "SPACE", broadcastChannelId: "mrfundzman.tv" }],
};

/** Explicit host-provided bootstrap override for controlled shells; production keeps the canonical entry. */
export function bootstrapPublicEntry(): ExperienceRegistryEntry {
  const injected = typeof window !== "undefined" ? (window as Window & { __oxBootstrapEntry?: ExperienceRegistryEntry }).__oxBootstrapEntry : undefined;
  if (!injected || injected.experienceId !== MYBRANDOS_PUBLIC_ID) return MYBRANDOS_PUBLIC_ENTRY;
  // The override relocates the same provider; its declared modes stay canonical unless the host supplies them.
  return injected.executionModes ? injected : { ...injected, executionModes: MYBRANDOS_PUBLIC_ENTRY.executionModes };
}

/** Studio remains separately protected — never seeded as PUBLIC bootstrap. */
export const MYBRANDOS_STUDIO_ID = "bootstrap.mybrandos.studio";
