import { jsonLeaksSecrets } from "./permissions.js";
import { isForbiddenCapability, resolveCapabilityName } from "./capabilities.js";
import { SHELL_CHANNEL, SHELL_MESSAGE_VERSION } from "./version.js";

export const INCOMING_MESSAGE_TYPES = [
  "ready",
  "application.ready",
  "application.title",
  "application.navigation",
  "application.lifecycle",
  "capability.request",
  "capability.status",
  "capability.execution",
  "capability.discover",
  "permission.request",
  "context.request",
  "application.handoff",
  "intent.request",
  "intent.discover",
  "session.current",
  "session.create",
  "session.resume",
  "session.end",
  "session.join",
  "session.leave",
  "action.discover",
  "action.request",
  "action.result",
  "context.current",
  "context.select",
  "search.query",
  "search.provider.result",
  "search.clearHistory",
  "objective.discover",
  "objective.start",
  "objective.current",
  "objective.cancel",
  "preference.get",
  "preference.set",
  "preference.clear",
  "preference.list",
  "context.clear",
  "context.clearCurrent",
  "context.clearRecent",
  "context.snapshot",
  "objective.continue",
  "continuity.recent",
  "continuity.open",
  "continuity.clear",
  "handoff.accepted",
  "handoff.rejected",
  "context.propose",
] as const;

export type IncomingMessageType = (typeof INCOMING_MESSAGE_TYPES)[number];

export type CanonicalIncomingType =
  | "ready"
  | "application.title"
  | "application.navigation"
  | "application.lifecycle"
  | "capability.request"
  | "capability.status"
  | "capability.execution"
  | "capability.discover"
  | "context.request"
  | "application.handoff"
  | "intent.request"
  | "intent.discover"
  | "session.current"
  | "session.create"
  | "session.resume"
  | "session.end"
  | "session.join"
  | "session.leave"
  | "action.discover"
  | "action.request"
  | "action.result"
  | "context.current"
  | "context.select"
  | "search.query"
  | "search.provider.result"
  | "search.clearHistory"
  | "objective.discover"
  | "objective.start"
  | "objective.current"
  | "objective.cancel"
  | "preference.get"
  | "preference.set"
  | "preference.clear"
  | "preference.list"
  | "context.clear"
  | "context.clearCurrent"
  | "context.clearRecent"
  | "context.snapshot"
  | "objective.continue"
  | "continuity.recent"
  | "continuity.open"
  | "continuity.clear"
  | "handoff.accepted"
  | "handoff.rejected"
  | "context.propose";

export interface TrustedIncomingMessage {
  channel: typeof SHELL_CHANNEL;
  version: typeof SHELL_MESSAGE_VERSION;
  type: CanonicalIncomingType;
  requestId?: string;
  capability?: string;
  scope?: string;
  title?: string;
  path?: string;
  canGoBack?: boolean;
  executionStarted?: boolean;
  executionResult?: string;
  targetAppId?: string;
  route?: string;
  context?: Record<string, unknown>;
  intent?: string;
  contextType?: string;
  sessionId?: string;
  label?: string;
  action?: string;
  object?: Record<string, unknown>;
  status?: string;
  query?: string;
  types?: string[];
  appIds?: string[];
  limit?: number;
  results?: unknown[];
  objectiveType?: string;
  target?: string;
  contextId?: string;
}

export type EnvelopeReject =
  | "unknown_origin"
  | "unknown_application"
  | "spoofed_source"
  | "unknown_message_type"
  | "malformed_payload"
  | "wildcard_rejected"
  | "secret_payload"
  | "version_rejected"
  | "unexpected_capability";

export function normalizeIncomingType(type: string): CanonicalIncomingType | null {
  if (type === "ready" || type === "application.ready") return "ready";
  if (type === "permission.request") return "capability.request";
  if (type === "application.title") return "application.title";
  if (type === "application.navigation") return "application.navigation";
  if (type === "application.lifecycle") return "application.lifecycle";
  if (type === "capability.request") return "capability.request";
  if (type === "capability.status") return "capability.status";
  if (type === "capability.execution") return "capability.execution";
  if (type === "capability.discover") return "capability.discover";
  if (type === "context.request") return "context.request";
  if (type === "application.handoff") return "application.handoff";
  if (type === "intent.request") return "intent.request";
  if (type === "intent.discover") return "intent.discover";
  if (type === "session.current") return "session.current";
  if (type === "session.create") return "session.create";
  if (type === "session.resume") return "session.resume";
  if (type === "session.end") return "session.end";
  if (type === "session.join") return "session.join";
  if (type === "session.leave") return "session.leave";
  if (type === "action.discover") return "action.discover";
  if (type === "action.request") return "action.request";
  if (type === "action.result") return "action.result";
  if (type === "context.current") return "context.current";
  if (type === "context.select") return "context.select";
  if (type === "search.query") return "search.query";
  if (type === "search.provider.result") return "search.provider.result";
  if (type === "search.clearHistory") return "search.clearHistory";
  if (type === "objective.discover") return "objective.discover";
  if (type === "objective.start") return "objective.start";
  if (type === "objective.current") return "objective.current";
  if (type === "objective.cancel") return "objective.cancel";
  if (type === "preference.get") return "preference.get";
  if (type === "preference.set") return "preference.set";
  if (type === "preference.clear") return "preference.clear";
  if (type === "preference.list") return "preference.list";
  if (type === "context.clear") return "context.clear";
  if (type === "context.clearCurrent") return "context.clearCurrent";
  if (type === "context.clearRecent") return "context.clearRecent";
  if (type === "context.snapshot") return "context.snapshot";
  if (type === "objective.continue") return "objective.continue";
  if (type === "continuity.recent") return "continuity.recent";
  if (type === "continuity.open") return "continuity.open";
  if (type === "continuity.clear") return "continuity.clear";
  if (type === "handoff.accepted") return "handoff.accepted";
  if (type === "handoff.rejected") return "handoff.rejected";
  if (type === "context.propose") return "context.propose";
  return null;
}

const CAPABILITY_HANDLE_KEYS = new Set([
  "stream",
  "mediastream",
  "mediastreamtrack",
  "videoframe",
  "imagebitmap",
  "camerabuffer",
  "frames",
  "tracks",
]);

export function jsonLeaksCapabilityHandles(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(jsonLeaksCapabilityHandles);
  if (typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (CAPABILITY_HANDLE_KEYS.has(normalized)) return true;
    if (jsonLeaksCapabilityHandles(nested)) return true;
  }
  return false;
}

export function envelope(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type,
    ...extra,
  };
}

export function postTargetIsSafe(targetOrigin: string): boolean {
  return Boolean(targetOrigin) && targetOrigin !== "*";
}

export function parseTrustedMessage(input: {
  data: unknown;
  eventOrigin: string;
  eventSource: unknown;
  expectedOrigin: string;
  expectedSource: unknown;
}): { ok: true; message: TrustedIncomingMessage } | { ok: false; code: EnvelopeReject } {
  if (input.eventOrigin !== input.expectedOrigin) return { ok: false, code: "unknown_origin" };
  if (input.eventSource !== input.expectedSource) return { ok: false, code: "spoofed_source" };
  if (!input.data || typeof input.data !== "object") return { ok: false, code: "malformed_payload" };
  if (jsonLeaksSecrets(input.data)) return { ok: false, code: "secret_payload" };
  if (jsonLeaksCapabilityHandles(input.data)) return { ok: false, code: "malformed_payload" };
  const raw = input.data as Record<string, unknown>;
  if (raw.channel !== SHELL_CHANNEL) return { ok: false, code: "malformed_payload" };
  if (raw.version !== SHELL_MESSAGE_VERSION) return { ok: false, code: "version_rejected" };
  if (typeof raw.type !== "string") return { ok: false, code: "unknown_message_type" };
  const type = normalizeIncomingType(raw.type);
  if (!type) return { ok: false, code: "unknown_message_type" };
  if (type === "capability.request" || type === "capability.status") {
    if (typeof raw.capability !== "string") return { ok: false, code: "malformed_payload" };
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
    if (isForbiddenCapability(resolveCapabilityName(raw.capability))) return { ok: false, code: "unexpected_capability" };
  }
  if (type === "capability.execution") {
    if (typeof raw.capability !== "string") return { ok: false, code: "malformed_payload" };
    if (isForbiddenCapability(resolveCapabilityName(raw.capability))) return { ok: false, code: "unexpected_capability" };
    if (raw.executionStarted !== undefined && typeof raw.executionStarted !== "boolean") {
      return { ok: false, code: "malformed_payload" };
    }
    if (raw.executionResult !== undefined && typeof raw.executionResult !== "string") {
      return { ok: false, code: "malformed_payload" };
    }
  }
  if ((type === "capability.discover" || type === "context.request") && typeof raw.requestId !== "string") {
    return { ok: false, code: "malformed_payload" };
  }
  if (type === "application.handoff") {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
    if (typeof raw.targetAppId !== "string" || !raw.targetAppId.trim()) return { ok: false, code: "malformed_payload" };
  }
  if (type === "intent.request") {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
    if (typeof raw.intent !== "string") return { ok: false, code: "malformed_payload" };
    if (!raw.context || typeof raw.context !== "object" || Array.isArray(raw.context)) {
      return { ok: false, code: "malformed_payload" };
    }
  }
  if (type === "intent.discover") {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
    if (typeof raw.intent !== "string") return { ok: false, code: "malformed_payload" };
    if (typeof raw.contextType !== "string") return { ok: false, code: "malformed_payload" };
  }
  if (
    type === "session.current" ||
    type === "session.create" ||
    type === "session.resume" ||
    type === "session.end" ||
    type === "session.join" ||
    type === "session.leave"
  ) {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
  }
  if ((type === "session.resume" || type === "session.end" || type === "session.join" || type === "session.leave") &&
    raw.sessionId != null &&
    typeof raw.sessionId !== "string") {
    return { ok: false, code: "malformed_payload" };
  }
  if (type === "action.discover" || type === "action.request" || type === "context.current" || type === "context.select") {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
  }
  if (type === "action.discover" || type === "action.request" || type === "context.select") {
    const object = raw.object ?? raw.context;
    if (!object || typeof object !== "object" || Array.isArray(object)) {
      return { ok: false, code: "malformed_payload" };
    }
  }
  if (type === "action.request" && typeof raw.action !== "string" && typeof raw.intent !== "string") {
    return { ok: false, code: "malformed_payload" };
  }
  if (type === "action.result") {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
    if (typeof raw.status !== "string") return { ok: false, code: "malformed_payload" };
  }
  if (type === "search.query") {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
    if (typeof raw.query !== "string") return { ok: false, code: "malformed_payload" };
  }
  if (type === "search.provider.result") {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
    if (!Array.isArray(raw.results)) return { ok: false, code: "malformed_payload" };
  }
  if (
    type === "objective.discover" ||
    type === "objective.start" ||
    type === "objective.current" ||
    type === "objective.cancel" ||
    type === "objective.continue" ||
    type === "preference.get" ||
    type === "preference.set" ||
    type === "preference.clear" ||
    type === "preference.list" ||
    type === "context.clear" ||
    type === "context.clearCurrent" ||
    type === "context.clearRecent" ||
    type === "context.snapshot" ||
    type === "continuity.recent" ||
    type === "continuity.open" ||
    type === "continuity.clear" ||
    type === "handoff.accepted" ||
    type === "handoff.rejected" ||
    type === "context.propose"
  ) {
    if (typeof raw.requestId !== "string") return { ok: false, code: "malformed_payload" };
  }
  return {
    ok: true,
    message: {
      channel: SHELL_CHANNEL,
      version: SHELL_MESSAGE_VERSION,
      type,
      requestId: typeof raw.requestId === "string" ? raw.requestId : undefined,
      capability: typeof raw.capability === "string" ? raw.capability : undefined,
      scope: typeof raw.scope === "string" ? raw.scope : undefined,
      title: typeof raw.title === "string" ? raw.title : undefined,
      path: typeof raw.path === "string" ? raw.path : undefined,
      canGoBack: typeof raw.canGoBack === "boolean" ? raw.canGoBack : undefined,
      executionStarted: typeof raw.executionStarted === "boolean" ? raw.executionStarted : undefined,
      executionResult: typeof raw.executionResult === "string" ? raw.executionResult : undefined,
      targetAppId: typeof raw.targetAppId === "string" ? raw.targetAppId : undefined,
      route: typeof raw.route === "string" ? raw.route : undefined,
      intent: typeof raw.intent === "string" ? raw.intent : undefined,
      contextType: typeof raw.contextType === "string" ? raw.contextType : undefined,
      sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
      label: typeof raw.label === "string" ? raw.label : undefined,
      action: typeof raw.action === "string" ? raw.action : undefined,
      status: typeof raw.status === "string" ? raw.status : undefined,
      query: typeof raw.query === "string" ? raw.query : undefined,
      types: Array.isArray(raw.types) ? raw.types.filter((item): item is string => typeof item === "string") : undefined,
      appIds: Array.isArray(raw.appIds) ? raw.appIds.filter((item): item is string => typeof item === "string") : undefined,
      limit: typeof raw.limit === "number" ? raw.limit : undefined,
      results: Array.isArray(raw.results) ? raw.results : undefined,
      objectiveType: typeof raw.objectiveType === "string" ? raw.objectiveType : undefined,
      target: typeof raw.target === "string" ? raw.target : undefined,
      contextId: typeof raw.contextId === "string" ? raw.contextId : undefined,
      object:
        (raw.object ?? raw.context) &&
        typeof (raw.object ?? raw.context) === "object" &&
        !Array.isArray(raw.object ?? raw.context)
          ? ((raw.object ?? raw.context) as Record<string, unknown>)
          : undefined,
      context:
        raw.context && typeof raw.context === "object" && !Array.isArray(raw.context)
          ? (raw.context as Record<string, unknown>)
          : undefined,
    },
  };
}

/** 0.6 helper — origin-only. Prefer parseTrustedMessage for privileged paths. */
export function parseIncomingMessage(
  data: unknown,
  eventOrigin: string,
  expectedOrigin: string,
): TrustedIncomingMessage | null {
  const parsed = parseTrustedMessage({
    data,
    eventOrigin,
    eventSource: expectedOrigin,
    expectedOrigin,
    expectedSource: expectedOrigin,
  });
  return parsed.ok ? parsed.message : null;
}
