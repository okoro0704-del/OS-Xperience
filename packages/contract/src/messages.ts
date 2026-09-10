import type { ApplicationContext } from "./app-context.js";
import type { CapabilityOutcome } from "./outcome.js";
import type { DigitalLifeContext } from "./context.js";
import type { OSShellCapabilityDescriptor } from "./discovery.js";
import type { ShellDeveloperDiagnostics } from "./diagnostics.js";
import type { OSShellIntentHandlerDescriptor } from "./intents.js";
import type { OSShellContextReference } from "./intent-context.js";
import { postTargetIsSafe } from "./envelope.js";
import { SHELL_CHANNEL, SHELL_MESSAGE_VERSION } from "./version.js";

export type ShellOutgoingMessage =
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "capability.result"; requestId: string; outcome: CapabilityOutcome }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "capability.status.result"; requestId: string; outcome: CapabilityOutcome }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "capability.discover.result"; requestId: string; capabilities: OSShellCapabilityDescriptor[] }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "diagnostics.result"; requestId: string; diagnostics: ShellDeveloperDiagnostics }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "permission.result"; requestId: string; outcome: CapabilityOutcome }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "digitallife.context"; context: DigitalLifeContext }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "context.result"; requestId: string; context: ApplicationContext | null }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "application.context"; context: ApplicationContext }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "application.back" }
  | { channel: typeof SHELL_CHANNEL; version: typeof SHELL_MESSAGE_VERSION; type: "application.lifecycle"; lifecycle: string }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "application.handoff.result";
      requestId: string;
      ok: boolean;
      code?: string;
      targetAppId?: string;
      route?: string;
      detail?: string;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "intent.discover.result";
      requestId: string;
      handlers: OSShellIntentHandlerDescriptor[];
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "intent.result";
      requestId: string;
      ok: boolean;
      code?: string;
      targetAppId?: string;
      route?: string;
      detail?: string;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "intent.deliver";
      requestId: string;
      intent: string;
      sourceAppId: string;
      context: OSShellContextReference;
      sessionId?: string;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "session.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      session?: {
        sessionId: string;
        state: string;
        label?: string;
        activeApplicationId?: string;
        activeIntent?: string;
        contextType?: string;
      } | null;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "session.resume";
      sessionId: string;
      label: string;
      route?: string;
      context?: OSShellContextReference;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "action.discover.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      actions?: Array<{
        action: string;
        label: string;
        availability: string;
        appId: string;
        name: string;
        origin: string;
        route: string;
        requiredCapability?: string | null;
      }>;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "action.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      targetAppId?: string;
      route?: string;
      status?: string;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "context.current.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      object?: OSShellContextReference | null;
      operatingContext?: {
        id: string;
        sessionId?: string;
        application?: string;
        objective?: string;
        action?: string;
        label?: string;
        updatedAt: string;
      } | null;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "search.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      results?: Array<{
        type: string;
        title: string;
        subtitle?: string;
        appId?: string;
        action?: string;
        context?: OSShellContextReference;
      }>;
      providers?: Array<{ appId: string; state: string; detail?: string }>;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "search.provider.query";
      requestId: string;
      query: string;
      types?: string[];
      limit?: number;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "objective.discover.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      routes?: Array<{
        objectiveType: string;
        target?: string;
        label?: string;
        appId: string;
        appName: string;
        intent?: string;
        availability: string;
        reason?: string;
        sessionId?: string;
        routePath?: string;
      }>;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "objective.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      targetAppId?: string;
      route?: string;
      sessionId?: string;
      status?: string;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "continuity.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      status?: string;
      entries?: Array<{
        id: string;
        label?: string;
        appId?: string;
        objectType?: string;
        objectiveType?: string;
        updatedAt: string;
        status?: string;
      }>;
      operatingContext?: {
        id: string;
        sessionId?: string;
        application?: string;
        objective?: string;
        action?: string;
        label?: string;
        updatedAt: string;
        suggestedNextObjectives?: Array<{ type: string; target?: string; label?: string }>;
      } | null;
      routes?: Array<{
        objectiveType: string;
        target?: string;
        label?: string;
        appId: string;
        appName: string;
        intent?: string;
        availability: string;
        reason?: string;
        sessionId?: string;
        routePath?: string;
      }>;
    }
  | {
      channel: typeof SHELL_CHANNEL;
      version: typeof SHELL_MESSAGE_VERSION;
      type: "preference.result";
      requestId: string;
      ok: boolean;
      code?: string;
      detail?: string;
      preferences?: Array<{
        appId: string;
        objectiveType: string;
        objectType?: string;
        source: string;
        updatedAt: string;
      }>;
    };

export function handoffResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  targetAppId?: string;
  route?: string;
  detail?: string;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "application.handoff.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    targetAppId: input.targetAppId,
    route: input.route,
    detail: input.detail,
  };
}

export function intentDiscoverResultMessage(
  requestId: string,
  handlers: OSShellIntentHandlerDescriptor[],
): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "intent.discover.result",
    requestId,
    handlers,
  };
}

export function intentResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  targetAppId?: string;
  route?: string;
  detail?: string;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "intent.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    targetAppId: input.targetAppId,
    route: input.route,
    detail: input.detail,
  };
}

export function intentDeliverMessage(input: {
  requestId: string;
  intent: string;
  sourceAppId: string;
  context: OSShellContextReference;
  sessionId?: string;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "intent.deliver",
    requestId: input.requestId,
    intent: input.intent,
    sourceAppId: input.sourceAppId,
    context: input.context,
    sessionId: input.sessionId,
  };
}

export function sessionResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  session?: {
    sessionId: string;
    state: string;
    label?: string;
    activeApplicationId?: string;
    activeIntent?: string;
    contextType?: string;
  } | null;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "session.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    session: input.session ?? null,
  };
}

export function sessionResumeMessage(input: {
  sessionId: string;
  label: string;
  route?: string;
  context?: OSShellContextReference;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "session.resume",
    sessionId: input.sessionId,
    label: input.label,
    route: input.route,
    context: input.context,
  };
}

export function actionDiscoverResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  actions?: Array<{
    action: string;
    label: string;
    availability: string;
    appId: string;
    name: string;
    origin: string;
    route: string;
    requiredCapability?: string | null;
  }>;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "action.discover.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    actions: input.actions,
  };
}

export function actionResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  targetAppId?: string;
  route?: string;
  status?: string;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "action.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    targetAppId: input.targetAppId,
    route: input.route,
    status: input.status,
  };
}

export function contextCurrentResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  object?: OSShellContextReference | null;
  operatingContext?: {
    id: string;
    sessionId?: string;
    application?: string;
    objective?: string;
    action?: string;
    label?: string;
    updatedAt: string;
  } | null;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "context.current.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    object: input.object ?? null,
    operatingContext: input.operatingContext,
  };
}

export function continuityResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  status?: string;
  entries?: Array<{
    id: string;
    label?: string;
    appId?: string;
    objectType?: string;
    objectiveType?: string;
    updatedAt: string;
    status?: string;
  }>;
  operatingContext?: {
    id: string;
    sessionId?: string;
    application?: string;
    objective?: string;
    action?: string;
    label?: string;
    updatedAt: string;
    suggestedNextObjectives?: Array<{ type: string; target?: string; label?: string }>;
  } | null;
  routes?: Array<{
    objectiveType: string;
    target?: string;
    label?: string;
    appId: string;
    appName: string;
    intent?: string;
    availability: string;
    reason?: string;
    sessionId?: string;
    routePath?: string;
  }>;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "continuity.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    status: input.status,
    entries: input.entries,
    operatingContext: input.operatingContext,
    routes: input.routes,
  };
}

export function searchResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  results?: Array<{
    type: string;
    title: string;
    subtitle?: string;
    appId?: string;
    action?: string;
    context?: OSShellContextReference;
  }>;
  providers?: Array<{ appId: string; state: string; detail?: string }>;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "search.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    results: input.results,
    providers: input.providers,
  };
}

export function searchProviderQueryMessage(input: {
  requestId: string;
  query: string;
  types?: string[];
  limit?: number;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "search.provider.query",
    requestId: input.requestId,
    query: input.query,
    types: input.types,
    limit: input.limit,
  };
}

export function objectiveDiscoverResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  routes?: Array<{
    objectiveType: string;
    target?: string;
    label?: string;
    appId: string;
    appName: string;
    intent?: string;
    availability: string;
    reason?: string;
    sessionId?: string;
    routePath?: string;
  }>;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "objective.discover.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    routes: input.routes,
  };
}

export function objectiveResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  targetAppId?: string;
  route?: string;
  sessionId?: string;
  status?: string;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "objective.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    targetAppId: input.targetAppId,
    route: input.route,
    sessionId: input.sessionId,
    status: input.status,
  };
}

export function preferenceResultMessage(input: {
  requestId: string;
  ok: boolean;
  code?: string;
  detail?: string;
  preferences?: Array<{
    appId: string;
    objectiveType: string;
    objectType?: string;
    source: string;
    updatedAt: string;
  }>;
}): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "preference.result",
    requestId: input.requestId,
    ok: input.ok,
    code: input.code,
    detail: input.detail,
    preferences: input.preferences,
  };
}

export function capabilityResultMessage(requestId: string, outcome: CapabilityOutcome): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "capability.result",
    requestId,
    outcome,
  };
}

export function capabilityStatusResultMessage(requestId: string, outcome: CapabilityOutcome): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "capability.status.result",
    requestId,
    outcome,
  };
}

export function capabilityDiscoverResultMessage(
  requestId: string,
  capabilities: OSShellCapabilityDescriptor[],
): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "capability.discover.result",
    requestId,
    capabilities,
  };
}

export function diagnosticsResultMessage(requestId: string, diagnostics: ShellDeveloperDiagnostics): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "diagnostics.result",
    requestId,
    diagnostics,
  };
}

export function permissionResultMessage(requestId: string, outcome: CapabilityOutcome): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "permission.result",
    requestId,
    outcome,
  };
}

export function contextResultMessage(requestId: string, context: ApplicationContext | null): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "context.result",
    requestId,
    context,
  };
}

export function applicationContextMessage(context: ApplicationContext): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "application.context",
    context,
  };
}

export function applicationBackMessage(): ShellOutgoingMessage {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_MESSAGE_VERSION,
    type: "application.back",
  };
}

export function postToApp(win: { postMessage: (message: unknown, targetOrigin: string) => void }, origin: string, message: ShellOutgoingMessage): { ok: true } | { ok: false; code: "wildcard_rejected" } {
  if (!postTargetIsSafe(origin)) return { ok: false, code: "wildcard_rejected" };
  win.postMessage(message, origin);
  return { ok: true };
}

export function handshakeReply(context: ApplicationContext): ShellOutgoingMessage[] {
  return [
    applicationContextMessage(context),
    {
      channel: SHELL_CHANNEL,
      version: SHELL_MESSAGE_VERSION,
      type: "application.lifecycle",
      lifecycle: context.lifecycle,
    },
  ];
}
