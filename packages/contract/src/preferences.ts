/**
 * Personal Preference & Routing contract (1.8).
 * Shell remembers how the person prefers to work — not application data.
 * Preference ≠ Authorization ≠ Credential ≠ Capability ≠ Ownership.
 */
import { jsonLeaksSecrets } from "./permissions.js";
import type { OSShellIntent } from "./intent-handlers.js";
import { isOSShellIntent } from "./intent-handlers.js";
import type { OSShellObjective, OSShellObjectiveRoute, OSShellObjectiveType } from "./objectives.js";

export const OS_SHELL_PREFERENCE_SOURCES = ["EXPLICIT", "RECENT_SUCCESS", "DEFAULT"] as const;
export type OSShellPreferenceSource = (typeof OS_SHELL_PREFERENCE_SOURCES)[number];

const OBJECTIVE_TYPES = [
  "create",
  "open",
  "view",
  "edit",
  "share",
  "import",
  "export",
  "publish",
  "preview",
  "continue",
] as const;

function isObjectiveType(value: string): value is OSShellObjectiveType {
  return (OBJECTIVE_TYPES as readonly string[]).includes(value);
}

export interface OSShellApplicationPreference {
  appId: string;
  objectiveType: OSShellObjectiveType;
  intentType?: OSShellIntent;
  objectType?: string;
  /** Optional destination preference (e.g. publish target). Not connectivity. */
  destination?: string;
  preference: "preferred";
  source: OSShellPreferenceSource;
  updatedAt: string;
}

export type PreferenceReject =
  | "preference_invalid"
  | "secret_payload"
  | "malformed_payload"
  | "unknown_application";

const APP_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const MAX_PREFERENCES = 64;

export function preferenceDoesNotGrantAuthorization(): true {
  return true;
}

export function preferenceDoesNotGrantCapability(): true {
  return true;
}

export function preferenceIsNotCredential(): true {
  return true;
}

export function preferenceDoesNotImplyOwnership(): true {
  return true;
}

export function preferenceKey(input: {
  objectiveType: OSShellObjectiveType;
  objectType?: string;
  destination?: string;
}): string {
  const object = input.objectType?.trim().toLowerCase() || "*";
  const dest = input.destination?.trim().toLowerCase() || "";
  return dest ? `${input.objectiveType}:${object}@${dest}` : `${input.objectiveType}:${object}`;
}

export function validateApplicationPreference(input: unknown):
  | { ok: true; preference: OSShellApplicationPreference }
  | { ok: false; code: PreferenceReject; detail: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "malformed_payload", detail: "Preference must be an object." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Preference must not contain secrets." };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.appId !== "string" || !APP_ID_RE.test(raw.appId)) {
    return { ok: false, code: "preference_invalid", detail: "appId is invalid." };
  }
  if (typeof raw.objectiveType !== "string" || !isObjectiveType(raw.objectiveType)) {
    return { ok: false, code: "preference_invalid", detail: "Unknown objective type." };
  }
  const source =
    typeof raw.source === "string" && (OS_SHELL_PREFERENCE_SOURCES as readonly string[]).includes(raw.source)
      ? (raw.source as OSShellPreferenceSource)
      : "EXPLICIT";
  const preference: OSShellApplicationPreference = {
    appId: raw.appId,
    objectiveType: raw.objectiveType,
    preference: "preferred",
    source,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.length <= 40 ? raw.updatedAt : new Date().toISOString(),
  };
  if (raw.intentType != null) {
    if (typeof raw.intentType !== "string" || !isOSShellIntent(raw.intentType)) {
      return { ok: false, code: "preference_invalid", detail: "intentType is invalid." };
    }
    preference.intentType = raw.intentType;
  }
  if (raw.objectType != null) {
    if (typeof raw.objectType !== "string" || !raw.objectType.trim() || raw.objectType.length > 40) {
      return { ok: false, code: "preference_invalid", detail: "objectType is invalid." };
    }
    preference.objectType = raw.objectType.trim().toLowerCase();
  }
  if (raw.destination != null) {
    if (typeof raw.destination !== "string" || !raw.destination.trim() || raw.destination.length > 64) {
      return { ok: false, code: "preference_invalid", detail: "destination is invalid." };
    }
    preference.destination = raw.destination.trim().toLowerCase();
  }
  return { ok: true, preference };
}

export function parseApplicationPreferences(raw: unknown): OSShellApplicationPreference[] {
  if (!Array.isArray(raw) || jsonLeaksSecrets(raw)) return [];
  const out: OSShellApplicationPreference[] = [];
  for (const item of raw) {
    const validated = validateApplicationPreference(item);
    if (validated.ok) out.push(validated.preference);
  }
  return out.slice(0, MAX_PREFERENCES);
}

export function setApplicationPreference(
  list: readonly OSShellApplicationPreference[],
  next: OSShellApplicationPreference,
): OSShellApplicationPreference[] {
  const key = preferenceKey(next);
  const rest = list.filter((item) => preferenceKey(item) !== key || item.source !== next.source);
  // One EXPLICIT and one RECENT_SUCCESS may coexist; EXPLICIT replaces EXPLICIT, etc.
  const sameSourceCleared = rest.filter(
    (item) => !(preferenceKey(item) === key && item.source === next.source),
  );
  return [...sameSourceCleared, { ...next, preference: "preferred" as const, updatedAt: next.updatedAt || new Date().toISOString() }].slice(
    0,
    MAX_PREFERENCES,
  );
}

export function clearApplicationPreference(
  list: readonly OSShellApplicationPreference[],
  input: {
    objectiveType: OSShellObjectiveType;
    objectType?: string;
    destination?: string;
    source?: OSShellPreferenceSource;
  },
): OSShellApplicationPreference[] {
  const key = preferenceKey(input);
  return list.filter((item) => {
    if (preferenceKey(item) !== key) return true;
    if (input.source && item.source !== input.source) return true;
    return false;
  });
}

export function clearAllApplicationPreferences(): OSShellApplicationPreference[] {
  return [];
}

export function lookupApplicationPreference(
  list: readonly OSShellApplicationPreference[],
  input: {
    objectiveType: OSShellObjectiveType;
    objectType?: string;
    destination?: string;
  },
): OSShellApplicationPreference | null {
  const exact = preferenceKey(input);
  const typeOnly = preferenceKey({ objectiveType: input.objectiveType, objectType: "*" });
  const ranked = [...list]
    .filter((item) => {
      const key = preferenceKey(item);
      return key === exact || key === typeOnly || preferenceKey({ objectiveType: item.objectiveType }) === preferenceKey({ objectiveType: input.objectiveType });
    })
    .sort((a, b) => sourceRank(b.source) - sourceRank(a.source) || b.updatedAt.localeCompare(a.updatedAt));

  const exactHit = ranked.find((item) => preferenceKey(item) === exact);
  if (exactHit) return exactHit;
  const typeHit = ranked.find(
    (item) => item.objectiveType === input.objectiveType && (!item.objectType || item.objectType === "*" || item.objectType === input.objectType),
  );
  return typeHit ?? null;
}

function sourceRank(source: OSShellPreferenceSource): number {
  if (source === "EXPLICIT") return 3;
  if (source === "RECENT_SUCCESS") return 2;
  return 1;
}

/** Map preferences into ranking keys used by objective routing. Explicit wins. */
export function preferencesToDefaultHandlerAppIds(
  list: readonly OSShellApplicationPreference[],
): Partial<Record<string, string>> {
  const sorted = [...list].sort((a, b) => sourceRank(b.source) - sourceRank(a.source) || b.updatedAt.localeCompare(a.updatedAt));
  const out: Partial<Record<string, string>> = {};
  const sourceByKey: Partial<Record<string, OSShellPreferenceSource>> = {};
  for (const item of sorted) {
    const exact = `${item.objectiveType}:${item.objectType ?? ""}`;
    const typeOnly = item.objectiveType;
    if (item.objectType && item.objectType !== "*") {
      const existing = sourceByKey[exact];
      if (!existing || sourceRank(item.source) > sourceRank(existing)) {
        out[exact] = item.appId;
        sourceByKey[exact] = item.source;
      }
    }
    const existingType = sourceByKey[typeOnly];
    if (!existingType || sourceRank(item.source) > sourceRank(existingType)) {
      out[typeOnly] = item.appId;
      sourceByKey[typeOnly] = item.source;
    }
  }
  return out;
}

export function preferenceMatchForRoute(
  list: readonly OSShellApplicationPreference[],
  route: OSShellObjectiveRoute,
): OSShellApplicationPreference | null {
  return lookupApplicationPreference(list, {
    objectiveType: route.objective.type,
    objectType: route.objective.target,
  });
}

export function applyPreferenceRanking(input: {
  routes: OSShellObjectiveRoute[];
  objective: OSShellObjective;
  preferences: readonly OSShellApplicationPreference[];
}): Array<OSShellObjectiveRoute & { preferenceSource?: OSShellPreferenceSource; preferenceReason?: string }> {
  const prefs = input.preferences;
  return [...input.routes]
    .map((route) => {
      let score = route.score ?? 0;
      let preferenceSource: OSShellPreferenceSource | undefined;
      let preferenceReason: string | undefined;

      const exact = prefs.filter(
        (item) =>
          item.appId === route.appId &&
          item.objectiveType === input.objective.type &&
          (item.objectType === input.objective.target ||
            (!item.objectType && !input.objective.target) ||
            item.objectType === "*" ||
            item.objectType === input.objective.target),
      );
      const typeOnly = prefs.filter(
        (item) => item.appId === route.appId && item.objectiveType === input.objective.type && (!item.objectType || item.objectType === "*"),
      );
      const hit = [...exact, ...typeOnly].sort((a, b) => sourceRank(b.source) - sourceRank(a.source))[0];
      if (hit) {
        preferenceSource = hit.source;
        if (hit.source === "EXPLICIT") {
          score += exact.includes(hit) ? 50 : 35;
          preferenceReason = "Your preferred app for this objective.";
        } else if (hit.source === "RECENT_SUCCESS") {
          score += 18;
          preferenceReason = "Recent successful choice.";
        } else {
          score += 8;
          preferenceReason = "Default preference.";
        }
      }

      // Preferred but unavailable must not win over available alternatives.
      if (
        preferenceSource &&
        route.availability !== "AVAILABLE" &&
        route.availability !== "PERMISSION_REQUIRED"
      ) {
        score -= preferenceSource === "EXPLICIT" ? 80 : 40;
        preferenceReason = `Preferred but ${route.reason ?? route.availability.toLowerCase()}.`;
      }

      return { ...route, score, preferenceSource, preferenceReason };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.appId.localeCompare(b.appId));
}

export function groupRoutesByPreference(
  routes: Array<OSShellObjectiveRoute & { preferenceSource?: OSShellPreferenceSource; preferenceReason?: string }>,
): {
  recommended: Array<OSShellObjectiveRoute & { preferenceSource?: OSShellPreferenceSource; preferenceReason?: string }>;
  others: Array<OSShellObjectiveRoute & { preferenceSource?: OSShellPreferenceSource; preferenceReason?: string }>;
} {
  const recommended = routes.filter(
    (item) =>
      item.preferenceSource === "EXPLICIT" ||
      (item.preferenceSource === "RECENT_SUCCESS" &&
        (item.availability === "AVAILABLE" || item.availability === "PERMISSION_REQUIRED")),
  );
  const recommendedIds = new Set(recommended.map((item) => item.appId));
  const others = routes.filter((item) => !recommendedIds.has(item.appId));
  if (!recommended.length && routes[0]) {
    return { recommended: [routes[0]], others: routes.slice(1) };
  }
  return { recommended, others };
}

export function rememberRecentSuccess(
  list: readonly OSShellApplicationPreference[],
  input: {
    appId: string;
    objectiveType: OSShellObjectiveType;
    objectType?: string;
    intentType?: OSShellIntent;
    now?: Date;
  },
): OSShellApplicationPreference[] {
  // Do not overwrite EXPLICIT with RECENT_SUCCESS.
  const existingExplicit = list.find(
    (item) =>
      item.source === "EXPLICIT" &&
      item.objectiveType === input.objectiveType &&
      (item.objectType ?? "") === (input.objectType ?? ""),
  );
  if (existingExplicit) return [...list];
  return setApplicationPreference(list, {
    appId: input.appId,
    objectiveType: input.objectiveType,
    objectType: input.objectType,
    intentType: input.intentType,
    preference: "preferred",
    source: "RECENT_SUCCESS",
    updatedAt: (input.now ?? new Date()).toISOString(),
  });
}

export function preferenceLabel(pref: OSShellApplicationPreference): string {
  const target = pref.objectType && pref.objectType !== "*" ? ` ${pref.objectType}` : "";
  const dest = pref.destination ? ` → ${pref.destination}` : "";
  return `${pref.objectiveType}${target}${dest}`;
}
