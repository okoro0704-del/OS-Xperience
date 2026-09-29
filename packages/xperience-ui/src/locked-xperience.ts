import { normalizeExecutionMode, type ExperienceExecutionMode } from "@digiconomy/xperience-contract";

export type LockedKernel = "APP" | "SPACE";
export type SpacePresentation = "IMMERSIVE" | "CONTROLS_VISIBLE" | "CONTROLS_PINNED";

export const LOCKED_PURPOSES = ["PRESENTATION", "EVENT", "KIOSK", "ACCEPTANCE"] as const;
export type LockedPurpose = (typeof LOCKED_PURPOSES)[number];

/**
 * GENERAL: OS Xperience → Directory → Provider → APP | SPACE.
 * LOCKED: a host configuration pinning one provider (and optionally one mode) for
 * presentations, events, kiosks and acceptance runs. It never changes provider identity.
 */
export type XperienceHostMode =
  | { kind: "GENERAL" }
  | { kind: "LOCKED"; providerId: string; executionMode: ExperienceExecutionMode | null; purpose: LockedPurpose };

export interface LockedExperienceConfig {
  providerId?: string;
  executionMode?: string | null;
  purpose?: string | null;
}

function normalizePurpose(value: unknown): LockedPurpose {
  return typeof value === "string" && (LOCKED_PURPOSES as readonly string[]).includes(value)
    ? (value as LockedPurpose)
    : "PRESENTATION";
}

/**
 * A runtime host hook wins over build env. Absent, empty or "false" configuration is GENERAL.
 */
export function resolveHostMode(input: {
  env?: { lockedId?: string | null; lockedMode?: string | null; lockedPurpose?: string | null };
  runtime?: LockedExperienceConfig | null;
}): XperienceHostMode {
  const runtimeId = input.runtime?.providerId?.trim();
  if (runtimeId) {
    return {
      kind: "LOCKED",
      providerId: runtimeId,
      executionMode: normalizeExecutionMode(input.runtime?.executionMode),
      purpose: normalizePurpose(input.runtime?.purpose),
    };
  }
  const envId = input.env?.lockedId?.trim();
  if (!envId || envId === "false") return { kind: "GENERAL" };
  return {
    kind: "LOCKED",
    providerId: envId,
    executionMode: normalizeExecutionMode(input.env?.lockedMode),
    purpose: normalizePurpose(input.env?.lockedPurpose),
  };
}

export function lockedProviderId(mode: XperienceHostMode): string | null {
  return mode.kind === "LOCKED" ? mode.providerId : null;
}

export function lockedExecutionMode(mode: XperienceHostMode): ExperienceExecutionMode | null {
  return mode.kind === "LOCKED" ? mode.executionMode : null;
}

/** Canonical registry identity for the public mrfundzmanOS Experience. */
export const MRFUNDZMANOS_EXPERIENCE_ID = "bootstrap.mybrandos.public";

export function resolveLockedExperience(
  id: string | null | undefined,
  lockedExperienceId: string | null = MRFUNDZMANOS_EXPERIENCE_ID,
): string | null {
  return lockedExperienceId ?? id ?? null;
}

/** A locked installation exposes one registry-backed Experience frame only. */
export function lockFrameLineup<T extends { experienceId: string }>(
  lineup: T[],
  lockedExperienceId: string | null = MRFUNDZMANOS_EXPERIENCE_ID,
): T[] {
  if (!lockedExperienceId) return lineup;
  return lineup.filter((entry) => entry.experienceId === lockedExperienceId);
}

export function onlineDeliverableResult(online: boolean): "COMPLETED_SYNCED" | "ONLINE_REQUIRED" {
  return online ? "COMPLETED_SYNCED" : "ONLINE_REQUIRED";
}

/** The canonical offline kernel exposes local asset availability, not execution completion. */
export function localSpaceResult(availableLocal: boolean): "AVAILABLE_LOCAL" | "AWAITING_ROUTE" {
  return availableLocal ? "AVAILABLE_LOCAL" : "AWAITING_ROUTE";
}
