import type { ExperienceRegistryEntry } from "@digiconomy/xperience-contract";

/** Phase X1 first Experience — public mybrandOS (not Studio). */
export const MYBRANDOS_PUBLIC_ID = "bootstrap.mybrandos.public";

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
};

/** Explicit host-provided bootstrap override for controlled shells; production keeps the canonical entry. */
export function bootstrapPublicEntry(): ExperienceRegistryEntry {
  const injected = typeof window !== "undefined" ? (window as Window & { __oxBootstrapEntry?: ExperienceRegistryEntry }).__oxBootstrapEntry : undefined;
  return injected && injected.experienceId === MYBRANDOS_PUBLIC_ID ? injected : MYBRANDOS_PUBLIC_ENTRY;
}

/** Studio remains separately protected — never seeded as PUBLIC bootstrap. */
export const MYBRANDOS_STUDIO_ID = "bootstrap.mybrandos.studio";
