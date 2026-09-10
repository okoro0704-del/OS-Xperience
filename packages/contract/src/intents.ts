/**
 * Application intents & handler discovery (1.3).
 * Intent ≠ permission. Handoff ≠ credential delegation.
 */
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById } from "./application-ecosystem.js";
import {
  validateContextReference,
  type OSShellContextReference,
  type OSShellContextType,
} from "./intent-context.js";
import {
  INTENT_CONTEXT_COMPAT,
  isOSShellIntent,
  type OSShellIntent,
  type OSShellIntentHandler,
} from "./intent-handlers.js";
import { jsonLeaksSecrets } from "./permissions.js";

export type { OSShellIntent, OSShellIntentHandler } from "./intent-handlers.js";
export { OS_SHELL_INTENTS, isOSShellIntent, validateIntentHandlers, INTENT_CONTEXT_COMPAT } from "./intent-handlers.js";

export interface OSShellIntentRequest {
  intent: OSShellIntent;
  /** Derived by Shell from the authenticated connection — never trusted from payload alone. */
  sourceAppId: string;
  targetAppId?: string;
  context: OSShellContextReference;
  requestId: string;
  /** Shell coordination id only — never a credential or auth assertion. */
  sessionId?: string;
}

export interface OSShellIntentHandlerDescriptor {
  appId: string;
  name: string;
  origin: string;
  trustState: string;
  source: string;
  route: string;
  available: boolean;
}

export type IntentReject =
  | "intent_unsupported"
  | "context_invalid"
  | "context_unavailable"
  | "unknown_application"
  | "no_handler"
  | "secret_payload"
  | "malformed_payload"
  | "self_intent"
  | "permission_inheritance_forbidden";

export type IntentRequestValidation =
  | {
      ok: true;
      request: OSShellIntentRequest;
      grantsCapability: false;
      grantsPermission: false;
    }
  | { ok: false; code: IntentReject; detail: string };

export function validateIntentRequest(input: {
  sourceAppId: string;
  payload: unknown;
}): IntentRequestValidation {
  if (!input.payload || typeof input.payload !== "object") {
    return { ok: false, code: "malformed_payload", detail: "Intent request must be an object." };
  }
  if (jsonLeaksSecrets(input.payload)) {
    return { ok: false, code: "secret_payload", detail: "Intent payload must not contain secrets." };
  }
  const raw = input.payload as Record<string, unknown>;
  if (raw.permissions != null || raw.grants != null || raw.authority != null) {
    return {
      ok: false,
      code: "permission_inheritance_forbidden",
      detail: "Intent cannot transfer permissions or authority.",
    };
  }
  if (typeof raw.intent !== "string" || !isOSShellIntent(raw.intent)) {
    return { ok: false, code: "intent_unsupported", detail: `Unsupported intent: ${String(raw.intent)}.` };
  }
  if (typeof raw.requestId !== "string" || !raw.requestId.trim()) {
    return { ok: false, code: "malformed_payload", detail: "requestId is required." };
  }
  const targetAppId = typeof raw.targetAppId === "string" && raw.targetAppId.trim() ? raw.targetAppId.trim() : undefined;
  if (targetAppId && targetAppId === input.sourceAppId) {
    return { ok: false, code: "self_intent", detail: "Target must be a different application." };
  }
  const contextResult = validateContextReference(raw.context);
  if (!contextResult.ok) {
    return {
      ok: false,
      code: contextResult.code === "secret_payload" ? "secret_payload" : "context_invalid",
      detail: contextResult.detail,
    };
  }
  if (!(INTENT_CONTEXT_COMPAT[raw.intent] as readonly string[]).includes(contextResult.context.type)) {
    return {
      ok: false,
      code: "context_invalid",
      detail: `Intent ${raw.intent} is incompatible with context type ${contextResult.context.type}.`,
    };
  }
  const sessionId =
    typeof raw.sessionId === "string" && raw.sessionId.trim() ? raw.sessionId.trim() : undefined;
  if (sessionId && !/^sess-[a-z0-9]+-[a-z0-9]+$/i.test(sessionId)) {
    return { ok: false, code: "malformed_payload", detail: "sessionId is not a valid Shell session identifier." };
  }
  return {
    ok: true,
    request: {
      intent: raw.intent,
      sourceAppId: input.sourceAppId,
      targetAppId,
      context: contextResult.context,
      requestId: raw.requestId.trim(),
      sessionId,
    },
    grantsCapability: false,
    grantsPermission: false,
  };
}

export function discoverIntentHandlers(input: {
  intent: OSShellIntent;
  contextType: OSShellContextType;
  registry: readonly OSShellApplicationRecord[];
  excludeAppId?: string;
}): OSShellIntentHandlerDescriptor[] {
  const handlers: OSShellIntentHandlerDescriptor[] = [];
  for (const app of input.registry) {
    if (app.appId === input.excludeAppId) continue;
    for (const handler of app.intentHandlers ?? []) {
      if (handler.intent !== input.intent) continue;
      if (!handler.contextTypes.includes(input.contextType)) continue;
      handlers.push({
        appId: app.appId,
        name: app.name,
        origin: app.origin,
        trustState: app.trustState,
        source: app.source,
        route: handler.route ?? "/",
        available: app.presence === "INSTALLED" || app.presence === "RUNNING",
      });
    }
  }
  return handlers;
}

export function resolveIntentTarget(input: {
  request: OSShellIntentRequest;
  registry: readonly OSShellApplicationRecord[];
  defaultHandlerAppId?: string | null;
}):
  | {
      ok: true;
      mode: "explicit" | "default" | "chooser";
      handlers: OSShellIntentHandlerDescriptor[];
      selected?: OSShellIntentHandlerDescriptor;
    }
  | { ok: false; code: IntentReject; detail: string } {
  if (input.request.targetAppId) {
    const app = findApplicationById(input.registry, input.request.targetAppId);
    if (!app) return { ok: false, code: "unknown_application", detail: "Target application is not installed." };
    const handlers = discoverIntentHandlers({
      intent: input.request.intent,
      contextType: input.request.context.type,
      registry: [app],
    });
    if (!handlers.length) {
      return { ok: false, code: "no_handler", detail: `${app.name} does not handle this intent/context.` };
    }
    return { ok: true, mode: "explicit", handlers, selected: handlers[0] };
  }

  const handlers = discoverIntentHandlers({
    intent: input.request.intent,
    contextType: input.request.context.type,
    registry: input.registry,
    excludeAppId: input.request.sourceAppId,
  }).filter((item) => item.available);

  if (!handlers.length) {
    return { ok: false, code: "no_handler", detail: "No installed application handles this intent." };
  }

  if (input.defaultHandlerAppId) {
    const selected = handlers.find((item) => item.appId === input.defaultHandlerAppId);
    if (selected) return { ok: true, mode: "default", handlers, selected };
  }

  return { ok: true, mode: "chooser", handlers };
}

export function intentToHandoffPayload(input: {
  targetAppId: string;
  route: string;
  intent: OSShellIntent;
  context: OSShellContextReference;
  sourceAppId: string;
  sessionId?: string;
}): { targetAppId: string; route: string; context: Record<string, unknown> } {
  return {
    targetAppId: input.targetAppId,
    route: input.route,
    context: {
      kind: "os-shell.intent",
      intent: input.intent,
      sourceAppId: input.sourceAppId,
      reference: input.context,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    },
  };
}

export function intentDoesNotGrantCapability(): true {
  return true;
}

export function handoffDoesNotTransferPermission(): true {
  return true;
}
