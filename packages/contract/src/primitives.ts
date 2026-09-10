/** Canonical LifeOS / Digiconomy primitives. The OS Shell is not one of them. */
export const LIFEOS_PRIMITIVE_IDS = [
  "trust-id",
  "elfcom",
  "sovereign-drive",
  "platform-jobs",
  "master-distributor",
  "fundzman",
] as const;

export type LifeOsPrimitiveId = (typeof LIFEOS_PRIMITIVE_IDS)[number];

export const PRIMITIVE_ALIASES = {
  identity: "trust-id",
  messaging: "elfcom",
  storage: "sovereign-drive",
  datazone: "sovereign-drive",
  jobs: "platform-jobs",
  billing: "fundzman",
  wallet: "fundzman",
} as const;

export function isLifeOsPrimitiveId(value: string): value is LifeOsPrimitiveId {
  return (LIFEOS_PRIMITIVE_IDS as readonly string[]).includes(value);
}
