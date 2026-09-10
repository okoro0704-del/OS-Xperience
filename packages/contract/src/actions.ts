/**
 * Universal Object & Action contract (1.5).
 * Action → user-facing label → Intent → handler.
 * Object reference ≠ ownership. Action ≠ capability. Handler ≠ privilege.
 */
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById } from "./application-ecosystem.js";
import type { PublicCapability } from "./capability-registry.js";
import {
  validateContextReference,
  type OSShellContextReference,
  type OSShellObjectReference,
} from "./intent-context.js";
import {
  INTENT_CONTEXT_COMPAT,
  OS_SHELL_INTENTS,
  isOSShellIntent,
  type OSShellIntent,
  type OSShellIntentHandler,
} from "./intent-handlers.js";
import {
  discoverIntentHandlers,
  resolveIntentTarget,
  type OSShellIntentHandlerDescriptor,
  type OSShellIntentRequest,
} from "./intents.js";
import { jsonLeaksSecrets } from "./permissions.js";

export type { OSShellObjectReference };

/** Actions reuse the intent vocabulary — no parallel universe. */
export const OS_SHELL_ACTIONS = OS_SHELL_INTENTS;
export type OSShellActionId = OSShellIntent;

export const OS_SHELL_ACTION_LABELS: Record<OSShellActionId, string> = {
  open: "Open",
  view: "View",
  edit: "Edit",
  create: "Create",
  share: "Share",
  import: "Import",
  export: "Export",
  publish: "Publish",
};

export const OS_SHELL_ACTION_AVAILABILITIES = [
  "AVAILABLE",
  "UNAVAILABLE",
  "PERMISSION_REQUIRED",
  "INCOMPATIBLE",
  "NOT_CONNECTED",
] as const;

export type OSShellActionAvailability = (typeof OS_SHELL_ACTION_AVAILABILITIES)[number];

export const OS_SHELL_ACTION_RESULT_STATUSES = [
  "completed",
  "cancelled",
  "failed",
  "unavailable",
] as const;

export type OSShellActionResultStatus = (typeof OS_SHELL_ACTION_RESULT_STATUSES)[number];

export interface OSShellAction {
  id: OSShellActionId;
  label: string;
  objectTypes: string[];
  /** Maps 1:1 to the interoperability intent. */
  intent: OSShellIntent;
  sourceAppId?: string;
  targetAppId?: string;
}

export interface OSShellActionHandler {
  action: OSShellActionId;
  objectTypes: string[];
  intent: OSShellIntent;
  route?: string;
}

export interface OSShellActionDescriptor {
  action: OSShellAction;
  handler: OSShellIntentHandlerDescriptor;
  availability: OSShellActionAvailability;
  /** Capability that may be required later — discovery never grants it. */
  requiredCapability?: PublicCapability | null;
}

export interface OSShellActionResult {
  status: OSShellActionResultStatus;
  action?: OSShellActionId;
  targetAppId?: string;
  detail?: string;
  returnContext?: OSShellContextReference;
}

/** Optional capability hint for consequential actions — never auto-granted. */
export const ACTION_CAPABILITY_HINT: Partial<Record<OSShellActionId, PublicCapability>> = {
  publish: "commerce",
};

export type ActionReject =
  | "action_unsupported"
  | "no_handler"
  | "context_invalid"
  | "context_unavailable"
  | "secret_payload"
  | "malformed_payload"
  | "unknown_application"
  | "permission_inheritance_forbidden"
  | "action_unavailable";

export function isOSShellAction(value: string): value is OSShellActionId {
  return isOSShellIntent(value);
}

export function actionFromIntent(intent: OSShellIntent): OSShellAction {
  return {
    id: intent,
    label: OS_SHELL_ACTION_LABELS[intent],
    objectTypes: [...INTENT_CONTEXT_COMPAT[intent]],
    intent,
  };
}

export function intentHandlersToActionHandlers(handlers: readonly OSShellIntentHandler[]): OSShellActionHandler[] {
  return handlers.map((item) => ({
    action: item.intent,
    objectTypes: [...item.contextTypes],
    intent: item.intent,
    route: item.route,
  }));
}

export function validateObjectReference(input: unknown) {
  return validateContextReference(input);
}

export function objectReferenceDoesNotGrantAuthorization(_object: OSShellObjectReference): true {
  return true;
}

export function actionDoesNotGrantCapability(): true {
  return true;
}

export function handlerDoesNotImplyPrivilege(): true {
  return true;
}

export function publicObjectView(object: OSShellObjectReference | null | undefined): {
  type?: string;
  subtype?: string;
  title?: string;
  id?: string;
  mimeType?: string;
  originAppId?: string;
} | null {
  if (!object) return null;
  return {
    type: object.type,
    subtype: object.subtype ?? (typeof object.metadata?.assetType === "string" ? object.metadata.assetType : undefined),
    title: object.title,
    id: object.id,
    mimeType: object.mimeType,
    originAppId: object.originAppId ?? object.appId,
  };
}

function availabilityForAction(
  action: OSShellActionId,
  handler: OSShellIntentHandlerDescriptor,
  input?: {
    grantedCapabilitiesByOrigin?: Record<string, readonly string[]>;
    capabilityAvailability?: Partial<Record<string, { available?: boolean; code?: string }>>;
  },
): OSShellActionAvailability {
  if (!handler.available) return "UNAVAILABLE";
  const required = ACTION_CAPABILITY_HINT[action];
  if (required) {
    const infra = input?.capabilityAvailability?.[required];
    if (infra && infra.available === false) return "UNAVAILABLE";
    const grants = input?.grantedCapabilitiesByOrigin?.[handler.origin] ?? [];
    if (!grants.includes(required)) return "PERMISSION_REQUIRED";
  }
  return "AVAILABLE";
}

export function discoverActions(input: {
  object: unknown;
  registry: readonly OSShellApplicationRecord[];
  excludeAppId?: string;
  grantedCapabilitiesByOrigin?: Record<string, readonly string[]>;
  capabilityAvailability?: Partial<Record<string, { available?: boolean; code?: string }>>;
}):
  | { ok: true; object: OSShellObjectReference; actions: OSShellActionDescriptor[]; grantsAuthorization: false }
  | { ok: false; code: ActionReject; detail: string } {
  if (jsonLeaksSecrets(input.object)) {
    return { ok: false, code: "secret_payload", detail: "Object reference must not contain secrets." };
  }
  const validated = validateObjectReference(input.object);
  if (!validated.ok) {
    return {
      ok: false,
      code: validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
      detail: validated.detail,
    };
  }
  const object = validated.context;
  const actions: OSShellActionDescriptor[] = [];
  const seen = new Set<string>();

  for (const intent of OS_SHELL_INTENTS) {
    if (!(INTENT_CONTEXT_COMPAT[intent] as readonly string[]).includes(object.type)) continue;
    const handlers = discoverIntentHandlers({
      intent,
      contextType: object.type,
      registry: input.registry,
      excludeAppId: input.excludeAppId,
    });
    for (const handler of handlers) {
      const key = `${intent}:${handler.appId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const action = actionFromIntent(intent);
      actions.push({
        action: { ...action, targetAppId: handler.appId },
        handler,
        availability: availabilityForAction(intent, handler, {
          grantedCapabilitiesByOrigin: input.grantedCapabilitiesByOrigin,
          capabilityAvailability: input.capabilityAvailability,
        }),
        requiredCapability: ACTION_CAPABILITY_HINT[intent] ?? null,
      });
    }
  }

  return { ok: true, object, actions, grantsAuthorization: false };
}

export function groupActionsById(descriptors: readonly OSShellActionDescriptor[]): Array<{
  action: OSShellAction;
  handlers: OSShellActionDescriptor[];
  bestAvailability: OSShellActionAvailability;
}> {
  const map = new Map<OSShellActionId, OSShellActionDescriptor[]>();
  for (const item of descriptors) {
    const list = map.get(item.action.id) ?? [];
    list.push(item);
    map.set(item.action.id, list);
  }
  const rank: Record<OSShellActionAvailability, number> = {
    AVAILABLE: 0,
    PERMISSION_REQUIRED: 1,
    NOT_CONNECTED: 2,
    UNAVAILABLE: 3,
    INCOMPATIBLE: 4,
  };
  return [...map.entries()].map(([id, handlers]) => {
    const best = [...handlers].sort((a, b) => rank[a.availability] - rank[b.availability])[0]!;
    return {
      action: actionFromIntent(id),
      handlers,
      bestAvailability: best.availability,
    };
  });
}

export function validateActionRequest(input: {
  sourceAppId: string;
  payload: unknown;
}):
  | {
      ok: true;
      action: OSShellActionId;
      intent: OSShellIntent;
      object: OSShellObjectReference;
      targetAppId?: string;
      requestId: string;
      sessionId?: string;
      grantsCapability: false;
      grantsPermission: false;
    }
  | { ok: false; code: ActionReject; detail: string } {
  if (!input.payload || typeof input.payload !== "object") {
    return { ok: false, code: "malformed_payload", detail: "Action request must be an object." };
  }
  if (jsonLeaksSecrets(input.payload)) {
    return { ok: false, code: "secret_payload", detail: "Action payload must not contain secrets." };
  }
  const raw = input.payload as Record<string, unknown>;
  if (raw.permissions != null || raw.grants != null || raw.authority != null) {
    return {
      ok: false,
      code: "permission_inheritance_forbidden",
      detail: "Action cannot transfer permissions or authority.",
    };
  }
  const actionRaw = typeof raw.action === "string" ? raw.action : typeof raw.intent === "string" ? raw.intent : null;
  if (!actionRaw || !isOSShellAction(actionRaw)) {
    return { ok: false, code: "action_unsupported", detail: `Unsupported action: ${String(actionRaw)}.` };
  }
  if (typeof raw.requestId !== "string" || !raw.requestId.trim()) {
    return { ok: false, code: "malformed_payload", detail: "requestId is required." };
  }
  const objectRaw = raw.object ?? raw.context;
  const objectResult = validateObjectReference(objectRaw);
  if (!objectResult.ok) {
    return {
      ok: false,
      code: objectResult.code === "secret_payload" ? "secret_payload" : "context_invalid",
      detail: objectResult.detail,
    };
  }
  if (!(INTENT_CONTEXT_COMPAT[actionRaw] as readonly string[]).includes(objectResult.context.type)) {
    return {
      ok: false,
      code: "context_invalid",
      detail: `Action ${actionRaw} is incompatible with object type ${objectResult.context.type}.`,
    };
  }
  const targetAppId =
    typeof raw.targetAppId === "string" && raw.targetAppId.trim() ? raw.targetAppId.trim() : undefined;
  if (targetAppId && targetAppId === input.sourceAppId) {
    return { ok: false, code: "malformed_payload", detail: "Target must be a different application." };
  }
  const sessionId =
    typeof raw.sessionId === "string" && raw.sessionId.trim() ? raw.sessionId.trim() : undefined;
  if (sessionId && !/^sess-[a-z0-9]+-[a-z0-9]+$/i.test(sessionId)) {
    return { ok: false, code: "malformed_payload", detail: "sessionId is not a valid Shell session identifier." };
  }
  return {
    ok: true,
    action: actionRaw,
    intent: actionRaw,
    object: objectResult.context,
    targetAppId,
    requestId: raw.requestId.trim(),
    sessionId,
    grantsCapability: false,
    grantsPermission: false,
  };
}

export function actionRequestToIntentRequest(input: {
  sourceAppId: string;
  action: OSShellActionId;
  object: OSShellObjectReference;
  requestId: string;
  targetAppId?: string;
  sessionId?: string;
}): OSShellIntentRequest {
  return {
    intent: input.action,
    sourceAppId: input.sourceAppId,
    targetAppId: input.targetAppId,
    context: input.object,
    requestId: input.requestId,
    sessionId: input.sessionId,
  };
}

export function resolveActionTarget(input: {
  action: OSShellActionId;
  object: OSShellObjectReference;
  sourceAppId: string;
  targetAppId?: string;
  registry: readonly OSShellApplicationRecord[];
  defaultHandlerAppId?: string | null;
  requestId: string;
  sessionId?: string;
}) {
  const request = actionRequestToIntentRequest({
    sourceAppId: input.sourceAppId,
    action: input.action,
    object: input.object,
    requestId: input.requestId,
    targetAppId: input.targetAppId,
    sessionId: input.sessionId,
  });
  return resolveIntentTarget({
    request,
    registry: input.registry,
    defaultHandlerAppId: input.defaultHandlerAppId,
  });
}

export function createActionResult(input: {
  status: OSShellActionResultStatus;
  action?: OSShellActionId;
  targetAppId?: string;
  detail?: string;
  returnContext?: unknown;
}): { ok: true; result: OSShellActionResult } | { ok: false; code: ActionReject; detail: string } {
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Action result must not contain secrets." };
  }
  let returnContext: OSShellContextReference | undefined;
  if (input.returnContext != null) {
    const validated = validateObjectReference(input.returnContext);
    if (!validated.ok) {
      return {
        ok: false,
        code: validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
        detail: validated.detail,
      };
    }
    returnContext = validated.context;
  }
  return {
    ok: true,
    result: {
      status: input.status,
      action: input.action,
      targetAppId: input.targetAppId,
      detail: input.detail,
      returnContext,
    },
  };
}

export function assertHandlerRegistered(input: {
  registry: readonly OSShellApplicationRecord[];
  appId: string;
  action: OSShellActionId;
  objectType: string;
}): boolean {
  const app = findApplicationById(input.registry, input.appId);
  if (!app) return false;
  return (app.intentHandlers ?? []).some(
    (handler) => handler.intent === input.action && handler.contextTypes.includes(input.objectType as never),
  );
}

/** Destructive actions may require Shell confirmation before routing — Shell still does not execute. */
export const ACTIONS_REQUIRING_CONFIRMATION: readonly OSShellActionId[] = ["publish", "export"];

export function actionRequiresConfirmation(action: OSShellActionId): boolean {
  return ACTIONS_REQUIRING_CONFIRMATION.includes(action);
}
