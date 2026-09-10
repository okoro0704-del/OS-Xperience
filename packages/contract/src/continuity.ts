/**
 * Cross-Application Continuity & Handoff (1.9).
 * The Shell remembers the user's place — not application state.
 * Context ≠ Permission. Reference ≠ Authorization. Handoff ≠ Credential.
 * Continuity ≠ Workflow automation. No AI planner. No cloud context backend.
 */
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById } from "./application-ecosystem.js";
import {
  discoverObjectiveRoutes,
  type OSShellObjective,
  type OSShellObjectiveRoute,
  type OSShellObjectiveType,
} from "./objectives.js";
import {
  validateContextReference,
  type OSShellContextReference,
  type OSShellObjectReference,
} from "./intent-context.js";
import { isOSShellIntent, type OSShellIntent } from "./intent-handlers.js";
import { jsonLeaksSecrets } from "./permissions.js";
import type { OSShellSession } from "./sessions.js";
import type { OSShellApplicationPreference } from "./preferences.js";

export const OS_SHELL_CONTINUITY_STATUSES = [
  "AVAILABLE",
  "PERMISSION_REQUIRED",
  "UNAVAILABLE",
  "NOT_FOUND",
  "STALE",
  "SESSION_ENDED",
  "NO_CURRENT_WORK",
  "RESUME_UNAVAILABLE",
  "CONTINUATION_UNAVAILABLE",
  "APPLICATION_UNAVAILABLE",
  "OBJECT_NOT_FOUND",
] as const;

export type OSShellContinuityStatus = (typeof OS_SHELL_CONTINUITY_STATUSES)[number];

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

/** Shell-owned lightweight place memory. Reference metadata only. */
export interface CurrentOperatingContext {
  id: string;
  sessionId?: string;
  objectiveId?: string;
  objectiveType?: OSShellObjectiveType;
  currentAppId?: string;
  objectReference?: OSShellObjectReference;
  actionReference?: string;
  intentReference?: OSShellIntent;
  returnPath?: string;
  label?: string;
  /** Suggestions only — never auto-executed. */
  suggestedNextObjectives?: Array<{
    type: OSShellObjectiveType;
    target?: string;
    label?: string;
  }>;
  updatedAt: string;
}

/** Thin public reference for recent lists. */
export interface OperatingContextReference {
  id: string;
  label?: string;
  appId?: string;
  objectType?: string;
  objectiveType?: OSShellObjectiveType;
  updatedAt: string;
  status?: OSShellContinuityStatus;
}

export interface ContinueObjectiveRequest {
  contextId?: string;
  /** Optional next objective (e..g. preview after create). Independent objective, not a workflow. */
  objectiveType?: OSShellObjectiveType;
  target?: string;
}

export interface ContinuationResult {
  status: OSShellContinuityStatus;
  context?: CurrentOperatingContext;
  routes: OSShellObjectiveRoute[];
  detail?: string;
  grantsAuthorization: false;
  grantsCapability: false;
  isWorkflow: false;
}

export interface OSShellContinuityHandoff {
  sourceAppId: string;
  targetAppId: string;
  objectiveId?: string;
  sessionId?: string;
  objectReference?: OSShellObjectReference;
  actionReference?: string;
  returnPath?: string;
  route?: string;
  context?: Record<string, unknown>;
}

export type HandoffAckStatus = "accepted" | "rejected" | "unavailable";

export interface OSShellHandoffAcknowledgement {
  status: HandoffAckStatus;
  requestId: string;
  detail?: string;
  targetAppId?: string;
}

/** Application → Shell return metadata. Shell decides what becomes current. */
export interface OSShellReturnHandoff {
  objective?: { type: OSShellObjectiveType; target?: string; label?: string };
  objectReference?: OSShellObjectReference;
  sessionId?: string;
  suggestedNextObjectives?: Array<{
    type: OSShellObjectiveType;
    target?: string;
    label?: string;
  }>;
  returnPath?: string;
  label?: string;
}

export type ContinuityReject =
  | "context_invalid"
  | "secret_payload"
  | "malformed_payload"
  | "oversized_context"
  | "continuation_unavailable";

export const OPERATING_CONTEXT_LIMITS = {
  maxRecent: 4,
  maxLabel: 160,
  maxId: 64,
  maxReturnPath: 256,
  maxSuggestions: 6,
} as const;

export function contextDoesNotGrantPermission(): true {
  return true;
}

export function referenceDoesNotGrantAuthorization(): true {
  return true;
}

export function handoffDoesNotDelegateCredentials(): true {
  return true;
}

export function continuityIsNotWorkflow(): true {
  return true;
}

export function continuityDoesNotOwnApplicationState(): true {
  return true;
}

export function shellDoesNotExecuteApplicationActions(): true {
  return true;
}

function newContextId(now = new Date()): string {
  return `ctx-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function publicOperatingContextView(
  context: CurrentOperatingContext | null | undefined,
): OperatingContextReference | null {
  if (!context) return null;
  return {
    id: context.id,
    label: context.label,
    appId: context.currentAppId,
    objectType: context.objectReference?.type,
    objectiveType: context.objectiveType,
    updatedAt: context.updatedAt,
  };
}

export function validateOperatingContext(input: unknown):
  | { ok: true; context: CurrentOperatingContext }
  | { ok: false; code: ContinuityReject; detail: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "malformed_payload", detail: "Operating context must be an object." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Operating context must not contain secrets." };
  }
  const raw = input as Record<string, unknown>;
  if (
    raw.bytes != null ||
    raw.content != null ||
    raw.body != null ||
    raw.token != null ||
    raw.password != null ||
    raw.cookie != null ||
    raw.stream != null ||
    raw.camera != null ||
    raw.audio != null
  ) {
    return {
      ok: false,
      code: "secret_payload",
      detail: "Operating context is reference-only — no private application state or media.",
    };
  }
  if (raw.permissions != null || raw.grants != null || raw.authority != null) {
    return { ok: false, code: "secret_payload", detail: "Context is not authorization." };
  }

  const id =
    typeof raw.id === "string" && raw.id.trim() && raw.id.length <= OPERATING_CONTEXT_LIMITS.maxId
      ? raw.id.trim()
      : newContextId();

  const context: CurrentOperatingContext = {
    id,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : new Date().toISOString(),
  };

  if (raw.sessionId != null) {
    if (typeof raw.sessionId !== "string" || raw.sessionId.length > 128) {
      return { ok: false, code: "context_invalid", detail: "sessionId is invalid." };
    }
    context.sessionId = raw.sessionId;
  }
  if (raw.objectiveId != null) {
    if (typeof raw.objectiveId !== "string" || raw.objectiveId.length > 128) {
      return { ok: false, code: "context_invalid", detail: "objectiveId is invalid." };
    }
    context.objectiveId = raw.objectiveId;
  }
  if (raw.objectiveType != null) {
    if (typeof raw.objectiveType !== "string" || !isObjectiveType(raw.objectiveType)) {
      return { ok: false, code: "context_invalid", detail: "Unknown objective type." };
    }
    context.objectiveType = raw.objectiveType;
  }
  if (raw.currentAppId != null) {
    if (typeof raw.currentAppId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(raw.currentAppId)) {
      return { ok: false, code: "context_invalid", detail: "currentAppId is invalid." };
    }
    context.currentAppId = raw.currentAppId;
  }
  if (raw.objectReference != null) {
    const validated = validateContextReference(raw.objectReference);
    if (!validated.ok) {
      return {
        ok: false,
        code: validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
        detail: validated.detail,
      };
    }
    context.objectReference = validated.context;
  }
  if (raw.actionReference != null) {
    if (typeof raw.actionReference !== "string" || raw.actionReference.length > 64) {
      return { ok: false, code: "context_invalid", detail: "actionReference is invalid." };
    }
    context.actionReference = raw.actionReference;
  }
  if (raw.intentReference != null) {
    if (typeof raw.intentReference !== "string" || !isOSShellIntent(raw.intentReference)) {
      return { ok: false, code: "context_invalid", detail: "intentReference is invalid." };
    }
    context.intentReference = raw.intentReference;
  }
  if (raw.returnPath != null) {
    if (typeof raw.returnPath !== "string" || raw.returnPath.length > OPERATING_CONTEXT_LIMITS.maxReturnPath) {
      return { ok: false, code: "oversized_context", detail: "returnPath exceeds limit." };
    }
    if (/^https?:\/\//i.test(raw.returnPath) || raw.returnPath.includes("://")) {
      return { ok: false, code: "context_invalid", detail: "returnPath must be a relative path." };
    }
    context.returnPath = raw.returnPath.startsWith("/") ? raw.returnPath : `/${raw.returnPath}`;
  }
  if (raw.label != null) {
    if (typeof raw.label !== "string" || raw.label.length > OPERATING_CONTEXT_LIMITS.maxLabel) {
      return { ok: false, code: "oversized_context", detail: "label exceeds limit." };
    }
    context.label = raw.label;
  }
  if (raw.suggestedNextObjectives != null) {
    if (!Array.isArray(raw.suggestedNextObjectives) || raw.suggestedNextObjectives.length > OPERATING_CONTEXT_LIMITS.maxSuggestions) {
      return { ok: false, code: "malformed_payload", detail: "suggestedNextObjectives is invalid." };
    }
    const suggestions: NonNullable<CurrentOperatingContext["suggestedNextObjectives"]> = [];
    for (const item of raw.suggestedNextObjectives) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, code: "malformed_payload", detail: "Invalid suggestion." };
      }
      const row = item as Record<string, unknown>;
      if (typeof row.type !== "string" || !isObjectiveType(row.type)) {
        return { ok: false, code: "malformed_payload", detail: "Suggestion type is invalid." };
      }
      const suggestion: { type: OSShellObjectiveType; target?: string; label?: string } = {
        type: row.type,
      };
      if (row.target != null) {
        if (typeof row.target !== "string" || row.target.length > 40) {
          return { ok: false, code: "malformed_payload", detail: "Suggestion target is invalid." };
        }
        suggestion.target = row.target.trim().toLowerCase();
      }
      if (row.label != null) {
        if (typeof row.label !== "string" || row.label.length > 160) {
          return { ok: false, code: "malformed_payload", detail: "Suggestion label is invalid." };
        }
        suggestion.label = row.label;
      }
      suggestions.push(suggestion);
    }
    context.suggestedNextObjectives = suggestions;
  }

  return { ok: true, context };
}

export function parseOperatingContexts(input: unknown): CurrentOperatingContext[] {
  if (!Array.isArray(input)) return [];
  const out: CurrentOperatingContext[] = [];
  for (const item of input.slice(0, OPERATING_CONTEXT_LIMITS.maxRecent + 1)) {
    const validated = validateOperatingContext(item);
    if (validated.ok) out.push(validated.context);
  }
  return out;
}

export function createOperatingContext(
  input: Omit<Partial<CurrentOperatingContext>, "id" | "updatedAt"> & {
    id?: string;
    updatedAt?: string;
  },
):
  | { ok: true; context: CurrentOperatingContext }
  | { ok: false; code: ContinuityReject; detail: string } {
  return validateOperatingContext({
    ...input,
    id: input.id ?? newContextId(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

export function rememberRecentContinuity(
  recent: readonly CurrentOperatingContext[],
  current: CurrentOperatingContext | null,
): CurrentOperatingContext[] {
  if (!current) return recent.slice(0, OPERATING_CONTEXT_LIMITS.maxRecent);
  const next = [current, ...recent.filter((item) => item.id !== current.id)].slice(
    0,
    OPERATING_CONTEXT_LIMITS.maxRecent,
  );
  return next;
}

export function applyReturnHandoff(
  current: CurrentOperatingContext | null,
  proposal: unknown,
  proposingAppId?: string,
):
  | { ok: true; context: CurrentOperatingContext; proposalAccepted: true }
  | { ok: false; code: ContinuityReject; detail: string } {
  if (jsonLeaksSecrets(proposal)) {
    return { ok: false, code: "secret_payload", detail: "Return handoff must not contain secrets." };
  }
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    return { ok: false, code: "malformed_payload", detail: "Return handoff must be an object." };
  }
  const raw = proposal as Record<string, unknown>;
  const objectReference =
    raw.objectReference != null
      ? validateContextReference(raw.objectReference)
      : raw.object != null
        ? validateContextReference(raw.object)
        : null;
  if (objectReference && !objectReference.ok) {
    return {
      ok: false,
      code: objectReference.code === "secret_payload" ? "secret_payload" : "context_invalid",
      detail: objectReference.detail,
    };
  }

  let objectiveType: OSShellObjectiveType | undefined = current?.objectiveType;
  let objectiveTarget: string | undefined;
  if (raw.objective != null && typeof raw.objective === "object" && !Array.isArray(raw.objective)) {
    const obj = raw.objective as Record<string, unknown>;
    if (typeof obj.type === "string" && isObjectiveType(obj.type)) objectiveType = obj.type;
    if (typeof obj.target === "string") objectiveTarget = obj.target.trim().toLowerCase();
  }

  const suggestionsRaw = raw.suggestedNextObjectives;
  let suggestions: CurrentOperatingContext["suggestedNextObjectives"];
  if (Array.isArray(suggestionsRaw)) {
    suggestions = [];
    for (const item of suggestionsRaw.slice(0, OPERATING_CONTEXT_LIMITS.maxSuggestions)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.type !== "string" || !isObjectiveType(row.type)) continue;
      suggestions.push({
        type: row.type,
        target: typeof row.target === "string" ? row.target.trim().toLowerCase() : undefined,
        label: typeof row.label === "string" ? row.label.slice(0, 160) : undefined,
      });
    }
  }

  const stampedObject = objectReference?.ok
    ? {
        ...objectReference.context,
        originAppId: objectReference.context.originAppId ?? proposingAppId ?? current?.currentAppId,
      }
    : current?.objectReference;

  const label =
    (typeof raw.label === "string" ? raw.label.slice(0, OPERATING_CONTEXT_LIMITS.maxLabel) : undefined) ??
    stampedObject?.title ??
    current?.label ??
    (objectiveType ? `${capitalize(objectiveType)}${objectiveTarget ? ` ${capitalize(objectiveTarget)}` : ""}` : "Current work");

  const created = createOperatingContext({
    id: current?.id,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : current?.sessionId,
    objectiveType,
    objectiveId: current?.objectiveId ?? (objectiveType ? `obj-${objectiveType}` : undefined),
    currentAppId: proposingAppId ?? current?.currentAppId,
    objectReference: stampedObject,
    actionReference: typeof raw.actionReference === "string" ? raw.actionReference : current?.actionReference,
    intentReference: current?.intentReference,
    returnPath: typeof raw.returnPath === "string" ? raw.returnPath : current?.returnPath,
    label,
    suggestedNextObjectives: suggestions ?? defaultSuggestionsFor(objectiveType, stampedObject),
  });
  if (!created.ok) return created;
  return { ok: true, context: created.context, proposalAccepted: true };
}

function defaultSuggestionsFor(
  objectiveType: OSShellObjectiveType | undefined,
  object: OSShellObjectReference | undefined,
): CurrentOperatingContext["suggestedNextObjectives"] {
  if (!object) return undefined;
  if (objectiveType === "create" || objectiveType === "edit") {
    return [
      { type: "preview", target: "this", label: "Preview" },
      { type: "edit", target: "this", label: "Edit" },
      { type: "share", target: "this", label: "Share" },
      { type: "publish", target: "this", label: "Publish" },
    ];
  }
  return [
    { type: "view", target: "this", label: "View" },
    { type: "edit", target: "this", label: "Edit" },
    { type: "share", target: "this", label: "Share" },
  ];
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

/**
 * Revalidate a remembered place against live registry/sessions.
 * Never fabricates continuity. Never silently repairs by guessing.
 */
export function revalidateOperatingContext(input: {
  context: CurrentOperatingContext | null | undefined;
  registry: readonly OSShellApplicationRecord[];
  sessions?: readonly OSShellSession[];
}): {
  status: OSShellContinuityStatus;
  context: CurrentOperatingContext | null;
  detail?: string;
} {
  if (!input.context) {
    return { status: "NO_CURRENT_WORK", context: null, detail: "No current operating context." };
  }
  const context = input.context;

  if (context.sessionId && input.sessions) {
    const session = input.sessions.find((item) => item.sessionId === context.sessionId);
    if (!session) {
      return { status: "SESSION_ENDED", context, detail: "Referenced session is unknown." };
    }
    if (session.state === "ENDED") {
      return { status: "SESSION_ENDED", context, detail: "Session has ended." };
    }
  }

  if (context.currentAppId) {
    const app = findApplicationById(input.registry, context.currentAppId);
    if (!app) {
      return {
        status: "APPLICATION_UNAVAILABLE",
        context,
        detail: `Application ${context.currentAppId} is not installed.`,
      };
    }
    if (app.presence !== "INSTALLED" && app.presence !== "RUNNING") {
      return {
        status: "APPLICATION_UNAVAILABLE",
        context,
        detail: `${app.name} is unavailable.`,
      };
    }
  }

  if (context.objectReference) {
    const validated = validateContextReference(context.objectReference);
    if (!validated.ok) {
      return {
        status: validated.code === "secret_payload" ? "STALE" : "OBJECT_NOT_FOUND",
        context,
        detail: validated.detail,
      };
    }
  }

  return { status: "AVAILABLE", context };
}

/**
 * Resolve a Continue (or related) objective from operating context.
 * Each step remains an independent objective — not a workflow graph.
 */
export function continueFromOperatingContext(input: {
  request?: ContinueObjectiveRequest;
  current: CurrentOperatingContext | null;
  recent?: readonly CurrentOperatingContext[];
  registry: readonly OSShellApplicationRecord[];
  sessions?: readonly OSShellSession[];
  preferences?: readonly OSShellApplicationPreference[];
  runtimeHints?: {
    softwareRuntime?: boolean;
    connectedAppIds?: string[];
    grantedCapabilitiesByOrigin?: Record<string, string[]>;
  };
  defaultHandlerAppIds?: Partial<Record<string, string>>;
}): ContinuationResult {
  const empty = (status: OSShellContinuityStatus, detail?: string): ContinuationResult => ({
    status,
    routes: [],
    detail,
    grantsAuthorization: false,
    grantsCapability: false,
    isWorkflow: false,
  });

  let context = input.current;
  if (input.request?.contextId) {
    const fromRecent = (input.recent ?? []).find((item) => item.id === input.request?.contextId);
    if (fromRecent) context = fromRecent;
    else if (input.current?.id !== input.request.contextId) {
      return empty("NOT_FOUND", "Continuity entry not found.");
    }
  }

  const revalidated = revalidateOperatingContext({
    context,
    registry: input.registry,
    sessions: input.sessions,
  });

  if (revalidated.status === "NO_CURRENT_WORK") {
    return empty("NO_CURRENT_WORK", revalidated.detail);
  }
  if (revalidated.status === "SESSION_ENDED") {
    return { ...empty("SESSION_ENDED", revalidated.detail), context: revalidated.context ?? undefined };
  }
  if (revalidated.status === "APPLICATION_UNAVAILABLE") {
    return {
      ...empty("APPLICATION_UNAVAILABLE", revalidated.detail),
      context: revalidated.context ?? undefined,
      routes: compatibleFallbackRoutes({
        context: revalidated.context,
        registry: input.registry,
        preferences: input.preferences,
        sessions: input.sessions,
        runtimeHints: input.runtimeHints,
        defaultHandlerAppIds: input.defaultHandlerAppIds,
        nextObjective: input.request?.objectiveType ?? "continue",
        target: input.request?.target,
      }),
    };
  }
  if (revalidated.status === "OBJECT_NOT_FOUND" || revalidated.status === "STALE") {
    return { ...empty(revalidated.status, revalidated.detail), context: revalidated.context ?? undefined };
  }
  if (!revalidated.context) {
    return empty("CONTINUATION_UNAVAILABLE", "Continuation could not be resolved.");
  }

  const nextType: OSShellObjectiveType = input.request?.objectiveType ?? "continue";
  const selectedObject = revalidated.context.objectReference ?? null;

  if (nextType === "continue") {
    const discovered = discoverObjectiveRoutes({
      objective: {
        type: "continue",
        label: revalidated.context.label ?? "Continue",
        context: selectedObject ?? undefined,
      },
      registry: input.registry,
      selectedObject,
      sessions: input.sessions,
      preferences: input.preferences,
      runtimeHints: input.runtimeHints,
      defaultHandlerAppIds: input.defaultHandlerAppIds,
      operatingContext: revalidated.context,
    });
    if (!discovered.ok) {
      return empty("CONTINUATION_UNAVAILABLE", discovered.detail);
    }
    const routes = prioritizeContextApp(discovered.routes, revalidated.context);
    if (!routes.length) {
      return {
        ...empty("CONTINUATION_UNAVAILABLE", "No valid continuation route."),
        context: revalidated.context,
      };
    }
    const preferred = routes[0];
    if (preferred.availability === "PERMISSION_REQUIRED") {
      return {
        status: "PERMISSION_REQUIRED",
        context: revalidated.context,
        routes,
        detail: preferred.reason,
        grantsAuthorization: false,
        grantsCapability: false,
        isWorkflow: false,
      };
    }
    if (preferred.availability !== "AVAILABLE") {
      return {
        status: "RESUME_UNAVAILABLE",
        context: revalidated.context,
        routes,
        detail: preferred.reason ?? preferred.availability,
        grantsAuthorization: false,
        grantsCapability: false,
        isWorkflow: false,
      };
    }
    return {
      status: "AVAILABLE",
      context: revalidated.context,
      routes,
      grantsAuthorization: false,
      grantsCapability: false,
      isWorkflow: false,
    };
  }

  const objective: OSShellObjective = {
    type: nextType,
    target: input.request?.target ?? (selectedObject ? "this" : undefined),
    context: selectedObject ?? undefined,
    label: `${capitalize(nextType)}${selectedObject?.title ? ` ${selectedObject.title}` : ""}`.trim(),
  };

  const discovered = discoverObjectiveRoutes({
    objective,
    registry: input.registry,
    selectedObject,
    sessions: input.sessions,
    preferences: input.preferences,
    runtimeHints: input.runtimeHints,
    defaultHandlerAppIds: input.defaultHandlerAppIds,
    operatingContext: revalidated.context,
  });
  if (!discovered.ok) {
    return empty("CONTINUATION_UNAVAILABLE", discovered.detail);
  }
  const routes = prioritizeContextApp(discovered.routes, revalidated.context);
  if (!routes.length) {
    return {
      ...empty("CONTINUATION_UNAVAILABLE", "No compatible handler for continuation."),
      context: revalidated.context,
    };
  }
  const top = routes[0];
  if (top.availability === "PERMISSION_REQUIRED") {
    return {
      status: "PERMISSION_REQUIRED",
      context: revalidated.context,
      routes,
      detail: top.reason,
      grantsAuthorization: false,
      grantsCapability: false,
      isWorkflow: false,
    };
  }
  if (top.availability !== "AVAILABLE") {
    return {
      status: "CONTINUATION_UNAVAILABLE",
      context: revalidated.context,
      routes,
      detail: top.reason ?? top.availability,
      grantsAuthorization: false,
      grantsCapability: false,
      isWorkflow: false,
    };
  }
  return {
    status: "AVAILABLE",
    context: revalidated.context,
    routes,
    grantsAuthorization: false,
    grantsCapability: false,
    isWorkflow: false,
  };
}

function prioritizeContextApp(
  routes: OSShellObjectiveRoute[],
  context: CurrentOperatingContext,
): OSShellObjectiveRoute[] {
  if (!context.currentAppId) return routes;
  return [...routes].sort((a, b) => {
    const aMatch = a.appId === context.currentAppId ? 1 : 0;
    const bMatch = b.appId === context.currentAppId ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return (b.score ?? 0) - (a.score ?? 0) || a.appId.localeCompare(b.appId);
  });
}

function compatibleFallbackRoutes(input: {
  context: CurrentOperatingContext | null;
  registry: readonly OSShellApplicationRecord[];
  preferences?: readonly OSShellApplicationPreference[];
  sessions?: readonly OSShellSession[];
  runtimeHints?: {
    softwareRuntime?: boolean;
    connectedAppIds?: string[];
    grantedCapabilitiesByOrigin?: Record<string, string[]>;
  };
  defaultHandlerAppIds?: Partial<Record<string, string>>;
  nextObjective: OSShellObjectiveType;
  target?: string;
}): OSShellObjectiveRoute[] {
  if (!input.context?.objectReference || input.nextObjective === "continue") {
    return [];
  }
  const discovered = discoverObjectiveRoutes({
    objective: {
      type: input.nextObjective,
      target: input.target ?? "this",
      context: input.context.objectReference,
    },
    registry: input.registry,
    selectedObject: input.context.objectReference,
    sessions: input.sessions,
    preferences: input.preferences,
    runtimeHints: input.runtimeHints,
    defaultHandlerAppIds: input.defaultHandlerAppIds,
  });
  if (!discovered.ok) return [];
  return discovered.routes.filter(
    (route) => route.availability === "AVAILABLE" || route.availability === "PERMISSION_REQUIRED",
  );
}

export function validateContinuityHandoff(input: {
  sourceAppId: string;
  handoff: unknown;
  registry: readonly OSShellApplicationRecord[];
}):
  | { ok: true; handoff: OSShellContinuityHandoff; transfersCredentials: false; transfersOwnership: false }
  | { ok: false; code: ContinuityReject | "unknown_application" | "self_handoff"; detail: string } {
  if (!input.handoff || typeof input.handoff !== "object" || Array.isArray(input.handoff)) {
    return { ok: false, code: "malformed_payload", detail: "Handoff must be an object." };
  }
  if (jsonLeaksSecrets(input.handoff)) {
    return { ok: false, code: "secret_payload", detail: "Handoff must not contain credentials." };
  }
  const raw = input.handoff as Record<string, unknown>;
  if (raw.permissions != null || raw.grants != null || raw.token != null || raw.password != null) {
    return { ok: false, code: "secret_payload", detail: "Handoff cannot transfer credentials or authority." };
  }
  const targetAppId = typeof raw.targetAppId === "string" ? raw.targetAppId.trim() : "";
  if (!targetAppId) {
    return { ok: false, code: "malformed_payload", detail: "targetAppId is required." };
  }
  if (targetAppId === input.sourceAppId) {
    return { ok: false, code: "self_handoff", detail: "Handoff target must be a different application." };
  }
  const target = findApplicationById(input.registry, targetAppId);
  if (!target) {
    return { ok: false, code: "unknown_application", detail: "Target application is not installed." };
  }

  let objectReference: OSShellObjectReference | undefined;
  if (raw.objectReference != null) {
    const validated = validateContextReference(raw.objectReference);
    if (!validated.ok) {
      return {
        ok: false,
        code: validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
        detail: validated.detail,
      };
    }
    objectReference = validated.context;
  }

  const handoff: OSShellContinuityHandoff = {
    sourceAppId: input.sourceAppId,
    targetAppId,
    objectReference,
  };
  if (typeof raw.objectiveId === "string") handoff.objectiveId = raw.objectiveId.slice(0, 128);
  if (typeof raw.sessionId === "string") handoff.sessionId = raw.sessionId.slice(0, 128);
  if (typeof raw.actionReference === "string") handoff.actionReference = raw.actionReference.slice(0, 64);
  if (typeof raw.returnPath === "string" && raw.returnPath.length <= OPERATING_CONTEXT_LIMITS.maxReturnPath) {
    handoff.returnPath = raw.returnPath.startsWith("/") ? raw.returnPath : `/${raw.returnPath}`;
  }
  if (typeof raw.route === "string") {
    handoff.route = raw.route.startsWith("/") ? raw.route.slice(0, 256) : `/${raw.route.slice(0, 255)}`;
  }
  if (raw.context != null && typeof raw.context === "object" && !Array.isArray(raw.context)) {
    handoff.context = raw.context as Record<string, unknown>;
  }

  return {
    ok: true,
    handoff,
    transfersCredentials: false,
    transfersOwnership: false,
  };
}

export function operatingContextToSelectedObject(
  context: CurrentOperatingContext | null | undefined,
): OSShellContextReference | null {
  return context?.objectReference ?? null;
}
