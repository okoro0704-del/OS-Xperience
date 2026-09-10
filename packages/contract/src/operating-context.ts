/**
 * Personal Operating Context (2.0).
 * Answers: "What is relevant to this person right now?"
 * Knows enough to orient — never enough to replace applications.
 * Context ≠ Permission ≠ Credential ≠ Ownership ≠ Workflow ≠ Universal profile.
 */
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById } from "./application-ecosystem.js";
import {
  discoverActions,
  OS_SHELL_ACTION_LABELS,
  type OSShellActionAvailability,
} from "./actions.js";
import {
  revalidateOperatingContext,
  type CurrentOperatingContext,
  type OSShellContinuityStatus,
} from "./continuity.js";
import type { OSShellContextReference } from "./intent-context.js";
import { validateContextReference } from "./intent-context.js";
import {
  parseObjectiveText,
  type OSShellObjective,
  type OSShellObjectiveType,
} from "./objectives.js";
import type { OSShellApplicationPreference } from "./preferences.js";
import { jsonLeaksSecrets } from "./permissions.js";
import type { OSShellSession } from "./sessions.js";

export const OS_SHELL_CONTEXT_SOURCES = [
  "CURRENT_SESSION",
  "APPLICATION",
  "OBJECT_REFERENCE",
  "USER_PREFERENCE",
  "RECENT_WORK",
  "CAPABILITY",
  "APPLICATION_MANIFEST",
] as const;

export type OSShellContextSource = (typeof OS_SHELL_CONTEXT_SOURCES)[number];

export const OS_SHELL_CONTEXT_SCOPES = [
  "CURRENT",
  "OBJECT",
  "SESSION",
  "APPLICATION",
  "OBJECTIVE",
] as const;

export type OSShellContextScope = (typeof OS_SHELL_CONTEXT_SCOPES)[number];

export const OS_SHELL_CONTEXT_KINDS = [
  "CURRENT",
  "RECENT",
  "PREFERENCE",
  "AVAILABILITY",
  "RELATIONSHIP",
  "ACTION",
] as const;

export type OSShellContextKind = (typeof OS_SHELL_CONTEXT_KINDS)[number];

export type OSShellContextAvailability =
  | OSShellContinuityStatus
  | "UNKNOWN"
  | OSShellActionAvailability;

export type OSShellContextFactOrSuggestion = "FACT" | "SUGGESTION";

/** Bounded, explainable context entry. Reference metadata only. */
export interface OSShellContextEntry {
  id: string;
  kind: OSShellContextKind;
  label: string;
  detail?: string;
  source: OSShellContextSource;
  availability?: OSShellContextAvailability;
  appId?: string;
  objectType?: string;
  objectiveType?: OSShellObjectiveType;
  sessionId?: string;
  actionId?: string;
  objectReference?: OSShellContextReference;
  /** Deterministic explanation — never AI. */
  why?: string;
  presentation: OSShellContextFactOrSuggestion;
  updatedAt?: string;
}

export interface OSShellCurrentContextPlane {
  objectiveType?: OSShellObjectiveType;
  applicationId?: string;
  applicationName?: string;
  sessionId?: string;
  sessionState?: string;
  object?: OSShellContextReference | null;
  actionId?: string;
  label?: string;
  availability: OSShellContextAvailability;
  why?: string;
}

/** Aggregated personal operating context — not a universal user profile. */
export interface OSShellPersonalOperatingContext {
  current: OSShellCurrentContextPlane | null;
  recent: OSShellContextEntry[];
  preferences: OSShellContextEntry[];
  availability: OSShellContextEntry[];
  relationships: OSShellContextEntry[];
  contextualActions: OSShellContextEntry[];
  /** Ambiguous candidates when pronoun resolution is unclear. */
  ambiguity?: OSShellContextEntry[];
  resolvedAt: string;
  grantsAuthorization: false;
  containsPrivateApplicationState: false;
  isUniversalProfile: false;
}

export interface OSShellContextSnapshot {
  scope: OSShellContextScope;
  current: OSShellCurrentContextPlane | null;
  entries: OSShellContextEntry[];
  object?: OSShellContextReference | null;
  resolvedAt: string;
  grantsAuthorization: false;
}

export type ContextualParseResult =
  | { ok: true; objective: OSShellObjective; ambiguous?: false }
  | {
      ok: true;
      objective: OSShellObjective;
      ambiguous: true;
      candidates: OSShellContextEntry[];
      detail: string;
    }
  | {
      ok: true;
      kind: "inspect";
      objective: OSShellObjective;
      label: string;
    }
  | { ok: false; code: "objective_not_understood" | "no_current_work" | "ambiguous"; detail: string };

export const PERSONAL_CONTEXT_LIMITS = {
  maxRecent: 4,
  maxPreferences: 8,
  maxAvailability: 12,
  maxActions: 8,
  maxRelationships: 6,
  maxAmbiguity: 6,
} as const;

export function personalContextDoesNotGrantPermission(): true {
  return true;
}

export function personalContextDoesNotGrantAuthorization(): true {
  return true;
}

export function personalContextIsNotCredential(): true {
  return true;
}

export function personalContextIsNotOwnership(): true {
  return true;
}

export function personalContextIsNotCapability(): true {
  return true;
}

export function personalContextIsNotWorkflow(): true {
  return true;
}

export function personalContextIsNotUniversalProfile(): true {
  return true;
}

export function shellDoesNotOwnApplicationPrivateState(): true {
  return true;
}

function entryId(prefix: string, key: string): string {
  return `${prefix}:${key}`.slice(0, 96);
}

/**
 * Deterministic Personal Operating Context resolver.
 * Priority: active session/app → current object → objective → preference → actions → recent → defaults.
 */
export function resolveOperatingContext(input: {
  continuity?: CurrentOperatingContext | null;
  recent?: readonly CurrentOperatingContext[];
  selectedObject?: OSShellContextReference | null;
  sessions?: readonly OSShellSession[];
  registry: readonly OSShellApplicationRecord[];
  preferences?: readonly OSShellApplicationPreference[];
  capabilityStatus?: Array<{ id: string; label?: string; status: string; appId?: string }>;
  grantedCapabilitiesByOrigin?: Record<string, string[]>;
  offline?: boolean;
  now?: Date;
}): OSShellPersonalOperatingContext {
  const now = (input.now ?? new Date()).toISOString();
  const continuity = input.continuity ?? null;
  const revalidated = revalidateOperatingContext({
    context: continuity,
    registry: input.registry,
    sessions: input.sessions,
  });

  const activeSession = input.sessions?.find((item) => item.state === "ACTIVE") ?? null;
  const object =
    continuity?.objectReference ??
    input.selectedObject ??
    activeSession?.context.activeContext ??
    null;

  const appId =
    continuity?.currentAppId ??
    activeSession?.context.activeApplicationId ??
    object?.originAppId ??
    object?.appId;
  const app = appId ? findApplicationById(input.registry, appId) : null;

  let availability: OSShellContextAvailability = revalidated.status;
  if (input.offline && availability === "AVAILABLE") {
    availability = "UNKNOWN";
  }

  const current: OSShellCurrentContextPlane | null =
    continuity || object || activeSession
      ? {
          objectiveType: continuity?.objectiveType,
          applicationId: app?.appId ?? appId,
          applicationName: app?.name,
          sessionId: continuity?.sessionId ?? activeSession?.sessionId,
          sessionState: activeSession?.state,
          object,
          actionId: continuity?.actionReference,
          label:
            continuity?.label ??
            object?.title ??
            activeSession?.context.label ??
            (app ? `Working in ${app.name}` : undefined),
          availability,
          why: whyForCurrent({ continuity, activeSession, app, object }),
        }
      : null;

  const recent: OSShellContextEntry[] = (input.recent ?? [])
    .slice(0, PERSONAL_CONTEXT_LIMITS.maxRecent)
    .map((item) => {
      const status = revalidateOperatingContext({
        context: item,
        registry: input.registry,
        sessions: input.sessions,
      }).status;
      const recentApp = item.currentAppId ? findApplicationById(input.registry, item.currentAppId) : null;
      return {
        id: entryId("recent", item.id),
        kind: "RECENT" as const,
        label: item.label ?? item.objectReference?.title ?? "Recent work",
        detail: recentApp?.name ?? item.currentAppId,
        source: "RECENT_WORK" as const,
        availability: input.offline && status === "AVAILABLE" ? "UNKNOWN" : status,
        appId: item.currentAppId,
        objectType: item.objectReference?.type,
        objectiveType: item.objectiveType,
        sessionId: item.sessionId,
        objectReference: item.objectReference,
        presentation: "FACT" as const,
        updatedAt: item.updatedAt,
        why: "From your recent work.",
      };
    });

  const preferences: OSShellContextEntry[] = (input.preferences ?? [])
    .filter((item) => item.source === "EXPLICIT" || item.source === "RECENT_SUCCESS")
    .slice(0, PERSONAL_CONTEXT_LIMITS.maxPreferences)
    .map((item) => {
      const prefApp = findApplicationById(input.registry, item.appId);
      return {
        id: entryId("pref", `${item.objectiveType}:${item.objectType ?? "*"}:${item.appId}`),
        kind: "PREFERENCE" as const,
        label: `${item.objectiveType}${item.objectType ? ` ${item.objectType}` : ""} → ${prefApp?.name ?? item.appId}`,
        detail: item.source === "EXPLICIT" ? "Explicit preference" : "Recent successful choice",
        source: "USER_PREFERENCE" as const,
        appId: item.appId,
        objectType: item.objectType,
        objectiveType: item.objectiveType,
        presentation: "FACT" as const,
        updatedAt: item.updatedAt,
        why:
          item.source === "EXPLICIT"
            ? "This is your preferred application for this objective."
            : "You recently used this application successfully.",
      };
    });

  const availabilityEntries: OSShellContextEntry[] = [];
  for (const record of input.registry.slice(0, PERSONAL_CONTEXT_LIMITS.maxAvailability)) {
    const present =
      record.presence === "INSTALLED" || record.presence === "RUNNING"
        ? ("AVAILABLE" as const)
        : ("UNAVAILABLE" as const);
    availabilityEntries.push({
      id: entryId("app", record.appId),
      kind: "AVAILABILITY",
      label: record.name,
      detail: present,
      source: "APPLICATION_MANIFEST",
      availability: input.offline ? "UNKNOWN" : present,
      appId: record.appId,
      presentation: "FACT",
      why: "Application install/presence state.",
    });
  }
  for (const cap of (input.capabilityStatus ?? []).slice(0, 6)) {
    availabilityEntries.push({
      id: entryId("cap", cap.id),
      kind: "AVAILABILITY",
      label: cap.label ?? cap.id,
      detail: cap.status,
      source: "CAPABILITY",
      availability: mapCapabilityStatus(cap.status, input.offline),
      appId: cap.appId,
      presentation: "FACT",
      why: "Capability broker status — not execution state.",
    });
  }

  const relationships: OSShellContextEntry[] = [];
  if (current?.object && current.applicationId) {
    relationships.push({
      id: entryId("rel", "object-app"),
      kind: "RELATIONSHIP",
      label: `${current.object.title ?? current.object.type} → ${current.applicationName ?? current.applicationId}`,
      source: "OBJECT_REFERENCE",
      appId: current.applicationId,
      objectType: current.object.type,
      objectReference: current.object,
      presentation: "FACT",
      why: "Current object is associated with this application (reference only).",
    });
  }
  if (current?.sessionId && current.applicationId) {
    relationships.push({
      id: entryId("rel", "session-app"),
      kind: "RELATIONSHIP",
      label: `Session → ${current.applicationName ?? current.applicationId}`,
      source: "CURRENT_SESSION",
      appId: current.applicationId,
      sessionId: current.sessionId,
      presentation: "FACT",
      why: "Active or remembered session participant.",
    });
  }

  const contextualActions = contextualActionsFromObject({
    object: current?.object ?? null,
    registry: input.registry,
    grantedCapabilitiesByOrigin: input.grantedCapabilitiesByOrigin,
    offline: input.offline,
  });

  return {
    current,
    recent,
    preferences,
    availability: availabilityEntries.slice(0, PERSONAL_CONTEXT_LIMITS.maxAvailability),
    relationships: relationships.slice(0, PERSONAL_CONTEXT_LIMITS.maxRelationships),
    contextualActions,
    resolvedAt: now,
    grantsAuthorization: false,
    containsPrivateApplicationState: false,
    isUniversalProfile: false,
  };
}

function whyForCurrent(input: {
  continuity: CurrentOperatingContext | null;
  activeSession: OSShellSession | null;
  app: OSShellApplicationRecord | null;
  object: OSShellContextReference | null;
}): string | undefined {
  if (input.activeSession?.state === "ACTIVE" && input.app) {
    return `${input.app.name} is your current application.`;
  }
  if (input.object && input.app) {
    return `Your current ${input.object.type} is associated with ${input.app.name}.`;
  }
  if (input.continuity?.label) {
    return "From your current operating place.";
  }
  return undefined;
}

function mapCapabilityStatus(status: string, offline?: boolean): OSShellContextAvailability {
  if (offline) return "UNKNOWN";
  const normalized = status.toLowerCase();
  if (normalized.includes("grant") || normalized === "available") return "AVAILABLE";
  if (normalized.includes("permission")) return "PERMISSION_REQUIRED";
  if (normalized.includes("unavail") || normalized.includes("denied") || normalized.includes("block")) {
    return "UNAVAILABLE";
  }
  return "UNKNOWN";
}

/** Reuses existing action discovery — not a second action engine. */
export function contextualActionsFromObject(input: {
  object: OSShellContextReference | null | undefined;
  registry: readonly OSShellApplicationRecord[];
  grantedCapabilitiesByOrigin?: Record<string, string[]>;
  offline?: boolean;
}): OSShellContextEntry[] {
  if (!input.object) return [];
  const validated = validateContextReference(input.object);
  if (!validated.ok) return [];
  const discovered = discoverActions({
    object: validated.context,
    registry: input.registry,
    grantedCapabilitiesByOrigin: input.grantedCapabilitiesByOrigin,
  });
  if (!discovered.ok) return [];

  const seen = new Set<string>();
  const entries: OSShellContextEntry[] = [];
  for (const item of discovered.actions) {
    if (seen.has(item.action.id)) continue;
    seen.add(item.action.id);
    const availability: OSShellContextAvailability = input.offline
      ? "UNKNOWN"
      : item.availability;
    entries.push({
      id: entryId("action", item.action.id),
      kind: "ACTION",
      label: OS_SHELL_ACTION_LABELS[item.action.id] ?? item.action.id,
      detail: `${item.handler.name} · ${availability}`,
      source: "APPLICATION_MANIFEST",
      availability,
      appId: item.handler.appId,
      actionId: item.action.id,
      objectType: validated.context.type,
      objectReference: validated.context,
      presentation: availability === "AVAILABLE" || availability === "PERMISSION_REQUIRED" ? "SUGGESTION" : "FACT",
      why:
        availability === "AVAILABLE"
          ? `You can ${OS_SHELL_ACTION_LABELS[item.action.id] ?? item.action.id} this ${validated.context.type}.`
          : `Action state: ${availability}.`,
    });
    if (entries.length >= PERSONAL_CONTEXT_LIMITS.maxActions) break;
  }
  return entries;
}

export { contextualActionsFromObject as contextualActions };

/** Scope-filtered snapshot for applications — Shell decides entitlement. */
export function snapshotOperatingContext(
  context: OSShellPersonalOperatingContext,
  scope: OSShellContextScope = "CURRENT",
  requestingAppId?: string,
): OSShellContextSnapshot {
  const entries: OSShellContextEntry[] = [];
  if (scope === "CURRENT" || scope === "OBJECTIVE" || scope === "OBJECT" || scope === "APPLICATION" || scope === "SESSION") {
    if (context.current) {
      entries.push({
        id: "current",
        kind: "CURRENT",
        label: context.current.label ?? "Current work",
        source: "CURRENT_SESSION",
        availability: context.current.availability,
        appId: context.current.applicationId,
        objectType: context.current.object?.type,
        objectiveType: context.current.objectiveType,
        sessionId: context.current.sessionId,
        objectReference: context.current.object ?? undefined,
        presentation: "FACT",
        why: context.current.why,
      });
    }
  }
  if (scope === "OBJECT") {
    entries.push(...context.contextualActions);
  }
  if (scope === "APPLICATION" && requestingAppId) {
    // Applications only receive their own preference/availability rows — not global history.
    entries.push(
      ...context.preferences.filter((item) => item.appId === requestingAppId),
      ...context.availability.filter((item) => item.appId === requestingAppId),
    );
  }
  if (scope === "SESSION" && context.current?.sessionId) {
    entries.push(
      ...context.relationships.filter((item) => item.sessionId === context.current?.sessionId),
    );
  }

  return {
    scope,
    current: context.current,
    entries: filterSnapshotForApp(entries, requestingAppId),
    object: scope === "OBJECT" || scope === "CURRENT" ? context.current?.object ?? null : null,
    resolvedAt: context.resolvedAt,
    grantsAuthorization: false,
  };
}

function filterSnapshotForApp(
  entries: OSShellContextEntry[],
  requestingAppId?: string,
): OSShellContextEntry[] {
  if (!requestingAppId) {
    // Shell UI / internal — still strip private-looking fields by construction.
    return entries;
  }
  return entries.filter((item) => {
    if (item.kind === "RECENT") return false;
    if (item.kind === "PREFERENCE" && item.appId && item.appId !== requestingAppId) return false;
    if (item.objectReference?.originAppId && item.objectReference.originAppId !== requestingAppId) {
      // Other apps' object references are not shared unless current handoff already stamped them.
      return item.kind === "CURRENT" || item.kind === "ACTION";
    }
    return true;
  });
}

/**
 * Resolve pronouns against safe current context.
 * Multiple plausible objects → ambiguous (never guess).
 */
export function resolveContextualObjective(input: {
  text: string;
  personal: OSShellPersonalOperatingContext;
  recent?: readonly CurrentOperatingContext[];
}): ContextualParseResult {
  const text = input.text.trim().toLowerCase().replace(/[?.!]+$/g, "");
  if (!text) {
    return { ok: false, code: "objective_not_understood", detail: "Empty objective." };
  }

  if (/^(what am i working on|where am i|current work|show current)$/.test(text)) {
    if (!input.personal.current) {
      return { ok: false, code: "no_current_work", detail: "No current operating context." };
    }
    return {
      ok: true,
      kind: "inspect",
      label: "What am I working on?",
      objective: {
        type: "continue",
        label: input.personal.current.label ?? "Current work",
        context: input.personal.current.object ?? undefined,
      },
    };
  }

  if (/^(what can i do( with this)?|what can i do with it|actions for this)$/.test(text)) {
    if (!input.personal.current?.object && !input.personal.contextualActions.length) {
      return { ok: false, code: "no_current_work", detail: "No current object for actions." };
    }
    return {
      ok: true,
      kind: "inspect",
      label: "What can I do with this?",
      objective: {
        type: "view",
        target: "this",
        context: input.personal.current?.object ?? undefined,
        label: "What can I do with this?",
      },
    };
  }

  const currentObject = input.personal.current?.object ?? null;
  const pronoun =
    /\b(this|it|that|my current project|what i'?m working on|current project)\b/.test(text) ||
    /^(edit|preview|share|publish|open|view|continue)\s+(this|it|that)$/.test(text);

  if (pronoun && !currentObject) {
    const candidates = ambiguousObjectCandidates(input.personal, input.recent);
    if (candidates.length > 1) {
      return {
        ok: true,
        ambiguous: true,
        objective: { type: "preview", target: "this", label: "Choose which one" },
        candidates,
        detail: "Multiple recent objects match. Which one?",
      };
    }
    if (candidates.length === 1 && candidates[0]?.objectReference) {
      const parsed = parseObjectiveText(text, candidates[0].objectReference);
      if (!parsed.ok) return parsed;
      return { ok: true, objective: parsed.objective, ambiguous: false };
    }
    return { ok: false, code: "no_current_work", detail: "No current object to resolve this/it against." };
  }

  const parsed = parseObjectiveText(text, currentObject);
  if (!parsed.ok) return parsed;
  return { ok: true, objective: parsed.objective, ambiguous: false };
}

function ambiguousObjectCandidates(
  personal: OSShellPersonalOperatingContext,
  recent?: readonly CurrentOperatingContext[],
): OSShellContextEntry[] {
  const fromRecent = (recent ?? [])
    .filter((item) => item.objectReference)
    .map((item) => ({
      id: entryId("amb", item.id),
      kind: "RECENT" as const,
      label: item.label ?? item.objectReference?.title ?? "Object",
      source: "RECENT_WORK" as const,
      appId: item.currentAppId,
      objectType: item.objectReference?.type,
      objectReference: item.objectReference,
      presentation: "FACT" as const,
      updatedAt: item.updatedAt,
    }));
  const fromPersonal = personal.recent.filter((item) => item.objectReference);
  const merged = [...fromPersonal, ...fromRecent];
  const seen = new Set<string>();
  return merged
    .filter((item) => {
      const key = item.objectReference?.id ?? item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, PERSONAL_CONTEXT_LIMITS.maxAmbiguity);
}

export function sessionResumeLabel(state: string | undefined): string {
  if (state === "ACTIVE") return "Continue";
  if (state === "BACKGROUND" || state === "SUSPENDED") return "Resume";
  if (state === "ENDED") return "Start Fresh";
  return "Continue";
}

export function validateContextProposal(input: unknown):
  | { ok: true }
  | { ok: false; code: "secret_payload" | "malformed_payload"; detail: string } {
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Context proposal must not contain secrets." };
  }
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    return { ok: false, code: "malformed_payload", detail: "Context proposal must be an object." };
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  if (raw.forceCurrent === true || raw.priority === 999 || raw.systemDefault === true) {
    return {
      ok: false,
      code: "malformed_payload",
      detail: "Applications cannot force Shell operating context priority.",
    };
  }
  return { ok: true };
}

export function publicPersonalContextView(
  context: OSShellPersonalOperatingContext,
): {
  currentLabel?: string;
  currentApp?: string;
  availability?: string;
  recentCount: number;
  actionCount: number;
  preferenceCount: number;
} {
  return {
    currentLabel: context.current?.label,
    currentApp: context.current?.applicationName ?? context.current?.applicationId,
    availability: context.current?.availability,
    recentCount: context.recent.length,
    actionCount: context.contextualActions.length,
    preferenceCount: context.preferences.length,
  };
}
