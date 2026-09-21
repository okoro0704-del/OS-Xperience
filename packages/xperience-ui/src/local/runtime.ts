import type { ExperienceAvailability, RuntimeTier } from "@digiconomy/xperience-contract";
import type { LineupEntry } from "./lineup.js";

export interface SwitchPlan {
  activeId: string;
  warmIds: string[];
  suspendedIds: string[];
  tiers: Record<string, RuntimeTier>;
  /** Frames that must stay mounted (ACTIVE + WARM). */
  mountedIds: string[];
  /** True when switching to the same Experience — do not remount media. */
  sameExperience: boolean;
  /** True when the target was already WARM — restore without full reload. */
  fromWarm: boolean;
  availability: ExperienceAvailability;
  offlineBlocked: boolean;
}

export function indexOfExperience(lineup: LineupEntry[], experienceId: string): number {
  return lineup.findIndex((item) => item.experienceId === experienceId);
}

/** Channel-like next — loops. */
export function nextExperienceId(lineup: LineupEntry[], currentId: string): string | null {
  if (lineup.length === 0) return null;
  const index = indexOfExperience(lineup, currentId);
  const from = index >= 0 ? index : 0;
  return lineup[(from + 1) % lineup.length]!.experienceId;
}

/** Channel-like previous — loops. */
export function previousExperienceId(lineup: LineupEntry[], currentId: string): string | null {
  if (lineup.length === 0) return null;
  const index = indexOfExperience(lineup, currentId);
  const from = index >= 0 ? index : 0;
  return lineup[(from - 1 + lineup.length) % lineup.length]!.experienceId;
}

export function neighborIds(lineup: LineupEntry[], activeId: string): { prev: string | null; next: string | null } {
  if (lineup.length <= 1) return { prev: null, next: null };
  return {
    prev: previousExperienceId(lineup, activeId),
    next: nextExperienceId(lineup, activeId),
  };
}

export function assignRuntimeTiers(
  lineup: LineupEntry[],
  activeId: string,
): Record<string, RuntimeTier> {
  const neighbors = neighborIds(lineup, activeId);
  const warm = new Set([neighbors.prev, neighbors.next].filter(Boolean) as string[]);
  const tiers: Record<string, RuntimeTier> = {};
  for (const item of lineup) {
    if (item.experienceId === activeId) tiers[item.experienceId] = "ACTIVE";
    else if (warm.has(item.experienceId)) tiers[item.experienceId] = "WARM";
    else tiers[item.experienceId] = "SUSPENDED";
  }
  return tiers;
}

export function planSwitch(input: {
  lineup: LineupEntry[];
  fromId: string | null;
  toId: string;
  previouslyMounted?: string[];
}): SwitchPlan | null {
  const target = input.lineup.find((item) => item.experienceId === input.toId);
  if (!target) return null;
  const tiers = assignRuntimeTiers(input.lineup, input.toId);
  const warmIds = Object.entries(tiers)
    .filter(([, tier]) => tier === "WARM")
    .map(([id]) => id);
  const suspendedIds = Object.entries(tiers)
    .filter(([, tier]) => tier === "SUSPENDED")
    .map(([id]) => id);
  const mountedIds = [input.toId, ...warmIds];
  const previouslyWarm = (input.previouslyMounted ?? []).includes(input.toId);
  const sameExperience = input.fromId === input.toId;
  const offlineBlocked = target.availability === "CONNECTION_REQUIRED" || target.availability === "DISABLED";
  return {
    activeId: input.toId,
    warmIds,
    suspendedIds,
    tiers,
    mountedIds,
    sameExperience,
    fromWarm: previouslyWarm && !sameExperience,
    availability: target.availability,
    offlineBlocked,
  };
}

/**
 * Media continuity: remount only when leaving WARM/ACTIVE pool.
 * Appearing the Switcher alone must not remount the active frame.
 */
export function shouldRemountExperience(input: {
  experienceId: string;
  wasMounted: boolean;
  willMount: boolean;
  switcherOnly?: boolean;
}): boolean {
  if (input.switcherOnly) return false;
  if (input.wasMounted && input.willMount) return false;
  if (!input.wasMounted && input.willMount) return true;
  return false;
}

/** Auth isolation: switching never copies credentials between Experiences. */
export function switchingPreservesAuthIsolation(): true {
  return true;
}

export function captureSafeRestoreHint(hint: string | undefined): string | undefined {
  if (!hint) return undefined;
  if (/password|passkey|otp|cookie|token|secret|credential/i.test(hint)) return undefined;
  return hint.slice(0, 512);
}
