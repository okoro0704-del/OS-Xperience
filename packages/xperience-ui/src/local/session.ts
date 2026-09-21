import type {
  ApplicationSurfaceType,
  ExperienceSlot,
  LastExperienceState,
} from "@digiconomy/xperience-contract";
import { getKvStore, readJson, writeJson } from "./storage.js";

export const LAST_EXPERIENCE_KEY = "ox.last-experience.v1";
export const SLOTS_KEY = "ox.experience-slots.v1";

/** Forbidden keys — never persist auth secrets in Xperience local state. */
const FORBIDDEN = /password|passkey|biometric|otp|cookie|token|secret|credential|session.?id|authorization/i;

export function assertSafeRestoreState(value: string | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  if (FORBIDDEN.test(value) || value.length > 2048) {
    throw new Error("Restore state rejected: must not contain authentication material.");
  }
  return value;
}

export function readLastExperience(): LastExperienceState | null {
  const raw = readJson<unknown>(LAST_EXPERIENCE_KEY);
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.lastExperienceId !== "string" || !row.lastExperienceId) return null;
  return {
    lastExperienceId: row.lastExperienceId,
    lastRoute: typeof row.lastRoute === "string" ? row.lastRoute : undefined,
    lastOpenedAt: typeof row.lastOpenedAt === "string" ? row.lastOpenedAt : new Date(0).toISOString(),
    surface: row.surface === "MANAGEMENT" ? "MANAGEMENT" : "PUBLIC",
    experienceStateReference:
      typeof row.experienceStateReference === "string" ? row.experienceStateReference : undefined,
  };
}

export function writeLastExperience(state: LastExperienceState): void {
  writeJson(LAST_EXPERIENCE_KEY, {
    ...state,
    experienceStateReference: assertSafeRestoreState(state.experienceStateReference),
  });
}

export function clearLastExperience(): void {
  getKvStore().removeItem(LAST_EXPERIENCE_KEY);
}

export function readSlots(): Record<string, ExperienceSlot> {
  const raw = readJson<unknown>(SLOTS_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ExperienceSlot> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (typeof row.experienceId !== "string") continue;
    out[id] = {
      experienceId: row.experienceId,
      route: typeof row.route === "string" ? row.route : undefined,
      lastActiveAt: typeof row.lastActiveAt === "string" ? row.lastActiveAt : new Date(0).toISOString(),
      surface: row.surface === "MANAGEMENT" ? "MANAGEMENT" : "PUBLIC",
      restoreState:
        typeof row.restoreState === "string" ? assertSafeRestoreState(row.restoreState) : undefined,
    };
  }
  return out;
}

export function writeSlots(slots: Record<string, ExperienceSlot>): void {
  writeJson(SLOTS_KEY, slots);
}

/**
 * Persist a runtime slot for Experience switching.
 * Never copies passwords, passkeys, OTPs, cookies, or private tokens.
 */
export function touchExperienceSlot(input: {
  experienceId: string;
  route?: string;
  surface?: ApplicationSurfaceType;
  restoreState?: string;
  now?: Date;
}): ExperienceSlot {
  const now = (input.now ?? new Date()).toISOString();
  const slots = readSlots();
  const slot: ExperienceSlot = {
    experienceId: input.experienceId,
    route: input.route,
    lastActiveAt: now,
    surface: input.surface ?? "PUBLIC",
    restoreState: assertSafeRestoreState(input.restoreState),
  };
  slots[input.experienceId] = slot;
  writeSlots(slots);
  writeLastExperience({
    lastExperienceId: input.experienceId,
    lastRoute: input.route,
    lastOpenedAt: now,
    surface: slot.surface,
    experienceStateReference: slot.restoreState,
  });
  return slot;
}

export function getExperienceSlot(experienceId: string): ExperienceSlot | null {
  return readSlots()[experienceId] ?? null;
}

/** Prove sessions are isolated — slot A must not equal slot B restore material. */
export function sessionsAreIsolated(a: string, b: string): boolean {
  if (a === b) return true;
  const slots = readSlots();
  const left = slots[a];
  const right = slots[b];
  if (!left || !right) return true;
  if (!left.restoreState || !right.restoreState) return true;
  return left.restoreState !== right.restoreState;
}
