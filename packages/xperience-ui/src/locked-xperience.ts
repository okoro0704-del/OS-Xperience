export type LockedKernel = "APP" | "SPACE";
export type SpacePresentation = "IMMERSIVE" | "CONTROLS_VISIBLE" | "CONTROLS_PINNED";

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
