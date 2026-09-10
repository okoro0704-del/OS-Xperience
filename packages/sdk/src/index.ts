/**
 * Thin public OS Shell SDK.
 * Not a backend, LifeOS, mybrandOS, wallet, or primitive client.
 * Outside Shell: isAvailable === false and helpers degrade gracefully.
 */
import {
  CONTINUITY_CONTRACT_VERSION,
  DEFAULT_TRUSTED_SHELL_ORIGINS,
  DEVELOPER_CONTRACT_VERSION,
  DISTRIBUTION_CONTRACT_VERSION,
  INTEROPERABILITY_CONTRACT_VERSION,
  OBJECT_ACTION_CONTRACT_VERSION,
  SEARCH_CONTRACT_VERSION,
  OBJECTIVES_CONTRACT_VERSION,
  PREFERENCES_CONTRACT_VERSION,
  OPERATING_CONTEXT_CONTRACT_VERSION,
  OSSHELL_VERSION,
  SHELL_MESSAGE_VERSION,
  createContextReference,
  detectShellOrigin,
  envelope,
  postTargetIsSafe,
  shellCompatibility,
  shellError,
  validateContextReference,
  type OSShellActionId,
  type OSShellApplicationIdentity,
  type OSShellApplicationHandoff,
  type OSShellCapabilityDescriptor,
  type OSShellCompatibility,
  type OSShellContextReference,
  type OSShellIntent,
  type OSShellIntentHandlerDescriptor,
  type ShellDeveloperDiagnostics,
  type ShellError,
} from "@osshell/contract";

export type ShellCapabilityResult = {
  capability: string;
  status: string;
  reason?: string;
  detail?: string;
  scope?: string;
};

export type ShellHandoffResult =
  | { ok: true; targetAppId: string; route: string }
  | ShellError
  | { ok: false; code: string; detail?: string };

export type ShellIntentResult =
  | { ok: true; targetAppId: string; route: string }
  | ShellError
  | { ok: false; code: string; detail?: string };

export type ShellSessionView = {
  sessionId: string;
  state: string;
  label?: string;
  activeApplicationId?: string;
  activeIntent?: string;
  contextType?: string;
};

export type ShellSessionResult =
  | { ok: true; session: ShellSessionView | null }
  | ShellError
  | { ok: false; code: string; detail?: string };

export type ShellActionDescriptor = {
  action: string;
  label: string;
  availability: string;
  appId: string;
  name: string;
  origin: string;
  route: string;
  requiredCapability?: string | null;
};

export type ShellActionDiscoverResult =
  | { ok: true; actions: ShellActionDescriptor[] }
  | ShellError
  | { ok: false; code: string; detail?: string };

export type ShellActionRequestResult =
  | { ok: true; targetAppId: string; route: string; status?: string }
  | ShellError
  | { ok: false; code: string; detail?: string; status?: string };

export type ShellObjectResult =
  | {
      ok: true;
      object: OSShellContextReference | null;
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
  | ShellError
  | { ok: false; code: string; detail?: string };

export type ShellContinuityResult =
  | {
      ok: true;
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
  | ShellError
  | { ok: false; code: string; detail?: string; status?: string };

export type OSShellContext = {
  readonly isAvailable: boolean;
  readonly shellOrigin: string | null;
  readonly protocolVersion: typeof SHELL_MESSAGE_VERSION;
  readonly shellVersion: typeof OSSHELL_VERSION;
  readonly developerContractVersion: typeof DEVELOPER_CONTRACT_VERSION;
  readonly distributionContractVersion: typeof DISTRIBUTION_CONTRACT_VERSION;
  readonly interoperabilityContractVersion: typeof INTEROPERABILITY_CONTRACT_VERSION;
  readonly continuityContractVersion: typeof CONTINUITY_CONTRACT_VERSION;
  readonly objectActionContractVersion: typeof OBJECT_ACTION_CONTRACT_VERSION;
  readonly searchContractVersion: typeof SEARCH_CONTRACT_VERSION;
  readonly objectivesContractVersion: typeof OBJECTIVES_CONTRACT_VERSION;
  readonly preferencesContractVersion: typeof PREFERENCES_CONTRACT_VERSION;
  readonly operatingContextContractVersion: typeof OPERATING_CONTEXT_CONTRACT_VERSION;
  application: OSShellApplicationIdentity | null;
  lifecycle: string | null;
  compatibility: () => OSShellCompatibility;
  capabilities: {
    list: () => Promise<OSShellCapabilityDescriptor[] | ShellError>;
    request: (capability: string) => Promise<ShellCapabilityResult | ShellError>;
    status: (capability: string) => Promise<ShellCapabilityResult | ShellError>;
  };
  intents: {
    discover: (input: {
      intent: OSShellIntent;
      contextType: OSShellContextReference["type"];
    }) => Promise<OSShellIntentHandlerDescriptor[] | ShellError>;
    request: (input: {
      intent: OSShellIntent;
      context: OSShellContextReference;
      targetAppId?: string;
      sessionId?: string;
    }) => Promise<ShellIntentResult>;
  };
  actions: {
    discover: (input: { object: OSShellContextReference }) => Promise<ShellActionDiscoverResult>;
    request: (input: {
      action: OSShellActionId;
      object: OSShellContextReference;
      targetAppId?: string;
      sessionId?: string;
    }) => Promise<ShellActionRequestResult>;
  };
  context: {
    create: (input: OSShellContextReference) => ReturnType<typeof createContextReference>;
    validate: (input: unknown) => ReturnType<typeof validateContextReference>;
    current: () => Promise<ShellObjectResult>;
    select: (object: OSShellContextReference) => Promise<ShellObjectResult>;
    clear: () => Promise<ShellContinuityResult>;
    clearCurrent: () => Promise<ShellContinuityResult>;
    clearRecent: () => Promise<ShellContinuityResult>;
    /** Propose return metadata. Shell decides what becomes current. */
    propose: (input: {
      objectReference?: OSShellContextReference;
      sessionId?: string;
      label?: string;
      suggestedNextObjectives?: Array<{ type: string; target?: string; label?: string }>;
    }) => Promise<ShellContinuityResult>;
    snapshot: (input?: { scope?: "CURRENT" | "OBJECT" | "SESSION" | "APPLICATION" | "OBJECTIVE" }) => Promise<ShellContinuityResult>;
  };
  continuity: {
    recent: () => Promise<ShellContinuityResult>;
    open: (reference: { id: string } | string) => Promise<ShellContinuityResult>;
    clear: () => Promise<ShellContinuityResult>;
  };
  session: {
    current: () => Promise<ShellSessionResult>;
    create: (input?: { label?: string }) => Promise<ShellSessionResult>;
    resume: (sessionId: string) => Promise<ShellSessionResult>;
    end: (sessionId?: string) => Promise<ShellSessionResult>;
    join: (sessionId: string) => Promise<ShellSessionResult>;
    leave: (sessionId?: string) => Promise<ShellSessionResult>;
  };
  search: {
    query: (input: {
      query: string;
      types?: Array<"application" | "object" | "action" | "objective">;
      appIds?: string[];
      limit?: number;
      scope?: string;
    }) => Promise<
      | {
          ok: true;
          results: Array<{
            type: string;
            title: string;
            subtitle?: string;
            appId?: string;
            action?: string;
            context?: OSShellContextReference;
          }>;
          providers?: Array<{ appId: string; state: string; detail?: string }>;
        }
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
    clearHistory: () => Promise<{ ok: true } | ShellError>;
  };
  objectives: {
    discover: (input?: {
      query?: string;
      objectiveType?: string;
      target?: string;
    }) => Promise<
      | {
          ok: true;
          routes: Array<{
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
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
    start: (input: {
      query?: string;
      objectiveType?: string;
      target?: string;
      targetAppId?: string;
    }) => Promise<
      | { ok: true; targetAppId?: string; route?: string; sessionId?: string; status?: string }
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
    current: () => Promise<
      | { ok: true; status?: string; targetAppId?: string; sessionId?: string }
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
    cancel: () => Promise<{ ok: true; status?: string } | ShellError | { ok: false; code: string; detail?: string }>;
    continue: (input?: {
      contextId?: string;
      objectiveType?: string;
      target?: string;
    }) => Promise<ShellContinuityResult>;
  };
  preferences: {
    list: () => Promise<
      | {
          ok: true;
          preferences: Array<{
            appId: string;
            objectiveType: string;
            objectType?: string;
            source: string;
            updatedAt: string;
          }>;
        }
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
    get: (input?: { objectiveType?: string; objectType?: string }) => Promise<
      | {
          ok: true;
          preferences: Array<{
            appId: string;
            objectiveType: string;
            objectType?: string;
            source: string;
            updatedAt: string;
          }>;
        }
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
    set: (input: {
      objectiveType: string;
      objectType?: string;
      appId?: string;
    }) => Promise<
      | {
          ok: true;
          preferences: Array<{
            appId: string;
            objectiveType: string;
            objectType?: string;
            source: string;
            updatedAt: string;
          }>;
        }
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
    clear: (input?: { objectiveType?: string; objectType?: string }) => Promise<
      | {
          ok: true;
          preferences: Array<{
            appId: string;
            objectiveType: string;
            objectType?: string;
            source: string;
            updatedAt: string;
          }>;
        }
      | ShellError
      | { ok: false; code: string; detail?: string }
    >;
  };
  getDiagnostics: () => Promise<ShellDeveloperDiagnostics | ShellError>;
  reportExecution: (capability: string, started: boolean, result: string) => void;
  ready: (input?: { title?: string; path?: string; canGoBack?: boolean; name?: string }) => void;
  navigation: (input?: { title?: string; path?: string; canGoBack?: boolean; sessionId?: string }) => void;
  navigate: (input?: { title?: string; path?: string; canGoBack?: boolean; sessionId?: string }) => void;
  handoff: (input: OSShellApplicationHandoff) => Promise<ShellHandoffResult>;
  detach: () => void;
};

type Pending = { resolve: (value: unknown) => void };

function unavailable(): ShellError {
  return shellError(
    "shell_unavailable",
    "OS Shell is not available in this browsing context.",
    "Open this application inside OS Shell, or continue in standalone browser mode.",
  );
}

export function getOSShellContext(options?: {
  trustedShellOrigins?: readonly string[];
  getTitle?: () => string;
  getPath?: () => string;
  canGoBack?: () => boolean;
  onBack?: () => void;
  onContext?: (context: unknown) => void;
  onLifecycle?: (lifecycle: string) => void;
  onIntent?: (delivery: {
    intent: string;
    sourceAppId: string;
    context: OSShellContextReference;
    requestId: string;
    sessionId?: string;
  }) => void;
  onResume?: (delivery: {
    sessionId: string;
    label: string;
    route?: string;
    context?: OSShellContextReference;
  }) => void;
  onActionResult?: (result: {
    requestId: string;
    status: string;
    action?: string;
    targetAppId?: string;
  }) => void;
  onSearchProviderQuery?: (input: {
    requestId: string;
    query: string;
    types?: string[];
    limit?: number;
  }) => Array<{
    type: string;
    title: string;
    subtitle?: string;
    appId?: string;
    action?: string;
    context?: OSShellContextReference;
  }> | Promise<
    Array<{
      type: string;
      title: string;
      subtitle?: string;
      appId?: string;
      action?: string;
      context?: OSShellContextReference;
    }>
  >;
}): OSShellContext {
  const trusted = options?.trustedShellOrigins ?? DEFAULT_TRUSTED_SHELL_ORIGINS;
  const pending = new Map<string, Pending>();
  let requestCount = 0;
  let shellOrigin: string | null = null;
  let detachListener: (() => void) | null = null;
  let lastDiscovery: OSShellCapabilityDescriptor[] = [];
  let lastLifecycle: string | null = null;
  let lastContext: {
    appId?: string | null;
    name?: string;
    origin?: string;
    class?: string;
    version?: string | null;
  } | null = null;

  function send(message: unknown) {
    if (!shellOrigin || !postTargetIsSafe(shellOrigin) || typeof window === "undefined") return;
    window.parent.postMessage(message, shellOrigin);
  }

  function nextId(prefix: string) {
    requestCount += 1;
    return `${prefix}-${requestCount}`;
  }

  function waitFor(requestId: string) {
    return new Promise((resolve) => {
      pending.set(requestId, { resolve });
    });
  }

  function ready(input?: { title?: string; path?: string; canGoBack?: boolean; name?: string }) {
    if (!shellOrigin) return;
    send(
      envelope("application.ready", {
        title: input?.title ?? options?.getTitle?.() ?? (typeof document !== "undefined" ? document.title : "App"),
        path: input?.path ?? options?.getPath?.() ?? (typeof location !== "undefined" ? `${location.pathname}${location.search}` : "/"),
        canGoBack: input?.canGoBack ?? options?.canGoBack?.() ?? false,
        name: input?.name,
      }),
    );
  }

  function navigation(input?: { title?: string; path?: string; canGoBack?: boolean; sessionId?: string }) {
    if (!shellOrigin) return;
    const path = input?.path ?? options?.getPath?.() ?? (typeof location !== "undefined" ? `${location.pathname}${location.search}` : "/");
    const title = input?.title ?? options?.getTitle?.() ?? (typeof document !== "undefined" ? document.title : "App");
    const canGoBack = input?.canGoBack ?? options?.canGoBack?.() ?? false;
    send(envelope("application.navigation", { path, title, canGoBack, sessionId: input?.sessionId }));
    send(envelope("application.lifecycle", { path, canGoBack }));
    send(envelope("application.title", { title }));
  }

  async function sessionCall(
    type: "session.current" | "session.create" | "session.resume" | "session.end" | "session.join" | "session.leave",
    extra: Record<string, unknown> = {},
  ): Promise<ShellSessionResult> {
    if (!shellOrigin) return unavailable();
    const requestId = nextId("session");
    const promise = waitFor(requestId) as Promise<ShellSessionResult>;
    send(envelope(type, { requestId, ...extra }));
    return promise;
  }

  function attach() {
    if (typeof window === "undefined" || window.parent === window) return;
    const ancestorOrigins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    shellOrigin = detectShellOrigin(ancestorOrigins, document.referrer, trusted);
    if (!shellOrigin) return;

    function onMessage(event: MessageEvent) {
      if (!shellOrigin || event.origin !== shellOrigin) return;
      const data = event.data as {
        channel?: string;
        version?: string;
        type?: string;
        requestId?: string;
        outcome?: ShellCapabilityResult;
        capabilities?: OSShellCapabilityDescriptor[];
        handlers?: OSShellIntentHandlerDescriptor[];
        context?: {
          appId?: string | null;
          name?: string;
          origin?: string;
          class?: string;
          version?: string | null;
        } & OSShellContextReference;
        lifecycle?: string;
        ok?: boolean;
        code?: string;
        targetAppId?: string;
        route?: string;
        detail?: string;
        intent?: string;
        sourceAppId?: string;
        sessionId?: string;
        session?: ShellSessionView | null;
        label?: string;
        actions?: ShellActionDescriptor[];
        object?: OSShellContextReference | null;
        status?: string;
        query?: string;
        types?: string[];
        limit?: number;
        results?: Array<{
          type: string;
          title: string;
          subtitle?: string;
          appId?: string;
          action?: string;
          context?: OSShellContextReference;
        }>;
        providers?: Array<{ appId: string; state: string; detail?: string }>;
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
        preferences?: Array<{
          appId: string;
          objectiveType: string;
          objectType?: string;
          source: string;
          updatedAt: string;
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
        entries?: Array<{
          id: string;
          label?: string;
          appId?: string;
          objectType?: string;
          objectiveType?: string;
          updatedAt: string;
          status?: string;
        }>;
      } | null;
      if (!data || data.channel !== "os-shell" || data.version !== SHELL_MESSAGE_VERSION) return;
      if (data.type === "application.back") options?.onBack?.();
      if (data.type === "application.context" || data.type === "context.result") {
        if (data.context) lastContext = data.context;
        options?.onContext?.(data);
      }
      if (data.type === "application.lifecycle" && data.lifecycle) {
        lastLifecycle = data.lifecycle;
        options?.onLifecycle?.(data.lifecycle);
      }
      if (data.type === "intent.deliver" && data.intent && data.sourceAppId && data.context && data.requestId) {
        options?.onIntent?.({
          intent: data.intent,
          sourceAppId: data.sourceAppId,
          context: data.context as OSShellContextReference,
          requestId: data.requestId,
          sessionId: data.sessionId,
        });
      }
      if (data.type === "session.resume" && data.sessionId && data.label) {
        options?.onResume?.({
          sessionId: data.sessionId,
          label: data.label,
          route: data.route,
          context: data.context as OSShellContextReference | undefined,
        });
      }
      if (data.type === "search.provider.query" && data.requestId && typeof data.query === "string") {
        void (async () => {
          const results = options?.onSearchProviderQuery
            ? await options.onSearchProviderQuery({
                requestId: data.requestId!,
                query: data.query!,
                types: data.types,
                limit: data.limit,
              })
            : [];
          send(envelope("search.provider.result", { requestId: data.requestId, results }));
        })();
      }
      if (
        data.requestId &&
        (data.type === "capability.result" ||
          data.type === "permission.result" ||
          data.type === "capability.status.result" ||
          data.type === "capability.discover.result" ||
          data.type === "application.handoff.result" ||
          data.type === "intent.discover.result" ||
          data.type === "intent.result" ||
          data.type === "session.result" ||
          data.type === "action.discover.result" ||
          data.type === "action.result" ||
          data.type === "context.current.result" ||
          data.type === "search.result" ||
          data.type === "objective.discover.result" ||
          data.type === "objective.result" ||
          data.type === "preference.result" ||
          data.type === "continuity.result")
      ) {
        const waiter = pending.get(data.requestId);
        if (!waiter) return;
        pending.delete(data.requestId);
        if (data.type === "capability.discover.result") {
          lastDiscovery = data.capabilities ?? [];
          waiter.resolve(lastDiscovery);
          return;
        }
        if (data.type === "intent.discover.result") {
          waiter.resolve(data.handlers ?? []);
          return;
        }
        if (data.type === "application.handoff.result" || data.type === "intent.result") {
          if (data.ok) {
            waiter.resolve({ ok: true, targetAppId: data.targetAppId ?? "", route: data.route ?? "/" });
          } else {
            waiter.resolve({ ok: false, code: data.code ?? "handoff_rejected", detail: data.detail });
          }
          return;
        }
        if (data.type === "session.result") {
          if (data.ok) {
            waiter.resolve({ ok: true, session: data.session ?? null });
          } else {
            waiter.resolve({ ok: false, code: data.code ?? "session_unknown", detail: data.detail });
          }
          return;
        }
        if (data.type === "action.discover.result") {
          if (data.ok) {
            waiter.resolve({ ok: true, actions: data.actions ?? [] });
          } else {
            waiter.resolve({ ok: false, code: data.code ?? "action_unsupported", detail: data.detail });
          }
          return;
        }
        if (data.type === "action.result") {
          options?.onActionResult?.({
            requestId: data.requestId,
            status: data.status ?? (data.ok ? "completed" : "failed"),
            action: data.intent,
            targetAppId: data.targetAppId,
          });
          if (data.ok) {
            waiter.resolve({
              ok: true,
              targetAppId: data.targetAppId ?? "",
              route: data.route ?? "/",
              status: data.status,
            });
          } else {
            waiter.resolve({
              ok: false,
              code: data.code ?? "action_unavailable",
              detail: data.detail,
              status: data.status,
            });
          }
          return;
        }
        if (data.type === "context.current.result") {
          if (data.ok) {
            waiter.resolve({
              ok: true,
              object: data.object ?? null,
              operatingContext: data.operatingContext ?? null,
            });
          } else {
            waiter.resolve({ ok: false, code: data.code ?? "context_invalid", detail: data.detail });
          }
          return;
        }
        if (data.type === "continuity.result") {
          if (data.ok) {
            waiter.resolve({
              ok: true,
              status: data.status,
              entries: data.entries,
              operatingContext: data.operatingContext ?? null,
              routes: data.routes,
            });
          } else {
            waiter.resolve({
              ok: false,
              code: data.code ?? "continuation_unavailable",
              detail: data.detail,
              status: data.status,
            });
          }
          return;
        }
        if (data.type === "search.result") {
          if (data.ok) {
            waiter.resolve({
              ok: true,
              results: data.results ?? [],
              providers: data.providers,
            });
          } else {
            waiter.resolve({
              ok: false,
              code: data.code ?? "search_query_invalid",
              detail: data.detail,
            });
          }
          return;
        }
        if (data.type === "objective.discover.result") {
          if (data.ok) {
            waiter.resolve({ ok: true, routes: data.routes ?? [] });
          } else {
            waiter.resolve({
              ok: false,
              code: data.code ?? "objective_invalid",
              detail: data.detail,
            });
          }
          return;
        }
        if (data.type === "objective.result") {
          if (data.ok) {
            waiter.resolve({
              ok: true,
              targetAppId: data.targetAppId,
              route: data.route,
              sessionId: data.sessionId,
              status: data.status,
            });
          } else {
            waiter.resolve({
              ok: false,
              code: data.code ?? "objective_unavailable",
              detail: data.detail,
            });
          }
          return;
        }
        if (data.type === "preference.result") {
          if (data.ok) {
            waiter.resolve({ ok: true, preferences: data.preferences ?? [] });
          } else {
            waiter.resolve({
              ok: false,
              code: data.code ?? "preference_invalid",
              detail: data.detail,
            });
          }
          return;
        }
        waiter.resolve(data.outcome ?? { capability: "unknown", status: "denied", reason: "malformed_result" });
      }
    }

    window.addEventListener("message", onMessage);
    detachListener = () => window.removeEventListener("message", onMessage);
    ready();
    navigation();
  }

  attach();

  const api: OSShellContext = {
    get isAvailable() {
      return Boolean(shellOrigin);
    },
    get shellOrigin() {
      return shellOrigin;
    },
    protocolVersion: SHELL_MESSAGE_VERSION,
    shellVersion: OSSHELL_VERSION,
    developerContractVersion: DEVELOPER_CONTRACT_VERSION,
    distributionContractVersion: DISTRIBUTION_CONTRACT_VERSION,
    interoperabilityContractVersion: INTEROPERABILITY_CONTRACT_VERSION,
    continuityContractVersion: CONTINUITY_CONTRACT_VERSION,
    objectActionContractVersion: OBJECT_ACTION_CONTRACT_VERSION,
    searchContractVersion: SEARCH_CONTRACT_VERSION,
    objectivesContractVersion: OBJECTIVES_CONTRACT_VERSION,
    preferencesContractVersion: PREFERENCES_CONTRACT_VERSION,
    operatingContextContractVersion: OPERATING_CONTEXT_CONTRACT_VERSION,
    get application() {
      if (!lastContext?.origin) return null;
      return {
        appId: lastContext.appId ?? lastContext.origin,
        name: lastContext.name ?? "App",
        version: lastContext.version ?? "0.0.0",
        origin: lastContext.origin,
        class: (lastContext.class as OSShellApplicationIdentity["class"]) ?? "compatible",
        trustState: "REGISTERED" as OSShellApplicationIdentity["trustState"],
      };
    },
    get lifecycle() {
      return lastLifecycle;
    },
    compatibility() {
      return shellCompatibility();
    },
    capabilities: {
      async list() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("discover");
        const promise = waitFor(requestId) as Promise<OSShellCapabilityDescriptor[]>;
        send(envelope("capability.discover", { requestId }));
        return promise;
      },
      async request(capability: string) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("cap");
        const promise = waitFor(requestId) as Promise<ShellCapabilityResult>;
        send(envelope("capability.request", { capability, requestId }));
        return promise;
      },
      async status(capability: string) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("status");
        const promise = waitFor(requestId) as Promise<ShellCapabilityResult>;
        send(envelope("capability.status", { capability, requestId }));
        return promise;
      },
    },
    intents: {
      async discover(input) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("intent-discover");
        const promise = waitFor(requestId) as Promise<OSShellIntentHandlerDescriptor[]>;
        send(envelope("intent.discover", { requestId, intent: input.intent, contextType: input.contextType }));
        return promise;
      },
      async request(input) {
        if (!shellOrigin) return unavailable();
        const validated = validateContextReference(input.context);
        if (!validated.ok) {
          return shellError(
            validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
            validated.detail,
            "Fix the context reference and retry.",
          );
        }
        const requestId = nextId("intent");
        const promise = waitFor(requestId) as Promise<ShellIntentResult>;
        send(
          envelope("intent.request", {
            requestId,
            intent: input.intent,
            targetAppId: input.targetAppId,
            context: validated.context,
            sessionId: input.sessionId,
          }),
        );
        return promise;
      },
    },
    context: {
      create: createContextReference,
      validate: validateContextReference,
      async current() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("context-current");
        const promise = waitFor(requestId) as Promise<ShellObjectResult>;
        send(envelope("context.current", { requestId }));
        return promise;
      },
      async select(object) {
        if (!shellOrigin) return unavailable();
        const validated = validateContextReference(object);
        if (!validated.ok) {
          return shellError(
            validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
            validated.detail,
            "Fix the object reference and retry.",
          );
        }
        const requestId = nextId("context-select");
        const promise = waitFor(requestId) as Promise<ShellObjectResult>;
        send(envelope("context.select", { requestId, object: validated.context }));
        return promise;
      },
      async clear() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("context-clear");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(envelope("context.clear", { requestId }));
        return promise;
      },
      async clearCurrent() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("context-clear-current");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(envelope("context.clearCurrent", { requestId }));
        return promise;
      },
      async clearRecent() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("context-clear-recent");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(envelope("context.clearRecent", { requestId }));
        return promise;
      },
      async propose(input) {
        if (!shellOrigin) return unavailable();
        if (input.objectReference) {
          const validated = validateContextReference(input.objectReference);
          if (!validated.ok) {
            return shellError(
              validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
              validated.detail,
              "Fix the object reference and retry.",
            );
          }
        }
        const requestId = nextId("context-propose");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(
          envelope("context.propose", {
            requestId,
            object: input.objectReference,
            sessionId: input.sessionId,
            label: input.label,
            context: {
              suggestedNextObjectives: input.suggestedNextObjectives,
            },
          }),
        );
        return promise;
      },
      async snapshot(input = {}) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("context-snapshot");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(envelope("context.snapshot", { requestId, scope: input.scope ?? "CURRENT" }));
        return promise;
      },
    },
    continuity: {
      async recent() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("continuity-recent");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(envelope("continuity.recent", { requestId }));
        return promise;
      },
      async open(reference) {
        if (!shellOrigin) return unavailable();
        const id = typeof reference === "string" ? reference : reference.id;
        const requestId = nextId("continuity-open");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(envelope("continuity.open", { requestId, contextId: id }));
        return promise;
      },
      async clear() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("continuity-clear");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(envelope("continuity.clear", { requestId }));
        return promise;
      },
    },
    actions: {
      async discover(input) {
        if (!shellOrigin) return unavailable();
        const validated = validateContextReference(input.object);
        if (!validated.ok) {
          return shellError(
            validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
            validated.detail,
            "Fix the object reference and retry.",
          );
        }
        const requestId = nextId("action-discover");
        const promise = waitFor(requestId) as Promise<ShellActionDiscoverResult>;
        send(envelope("action.discover", { requestId, object: validated.context }));
        return promise;
      },
      async request(input) {
        if (!shellOrigin) return unavailable();
        const validated = validateContextReference(input.object);
        if (!validated.ok) {
          return shellError(
            validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
            validated.detail,
            "Fix the object reference and retry.",
          );
        }
        const requestId = nextId("action");
        const promise = waitFor(requestId) as Promise<ShellActionRequestResult>;
        send(
          envelope("action.request", {
            requestId,
            action: input.action,
            object: validated.context,
            targetAppId: input.targetAppId,
            sessionId: input.sessionId,
          }),
        );
        return promise;
      },
    },
    session: {
      current: () => sessionCall("session.current"),
      create: (input) => sessionCall("session.create", { label: input?.label }),
      resume: (sessionId) => sessionCall("session.resume", { sessionId }),
      end: (sessionId) => sessionCall("session.end", { sessionId }),
      join: (sessionId) => sessionCall("session.join", { sessionId }),
      leave: (sessionId) => sessionCall("session.leave", { sessionId }),
    },
    search: {
      async query(input) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("search");
        const promise = waitFor(requestId) as Promise<
          | {
              ok: true;
              results: Array<{
                type: string;
                title: string;
                subtitle?: string;
                appId?: string;
                action?: string;
                context?: OSShellContextReference;
              }>;
              providers?: Array<{ appId: string; state: string; detail?: string }>;
            }
          | { ok: false; code: string; detail?: string }
        >;
        send(
          envelope("search.query", {
            requestId,
            query: input.query,
            types: input.types,
            appIds: input.appIds,
            limit: input.limit,
            scope: input.scope,
          }),
        );
        return promise;
      },
      async clearHistory() {
        if (!shellOrigin) return unavailable();
        send(envelope("search.clearHistory", {}));
        return { ok: true as const };
      },
    },
    objectives: {
      async discover(input = {}) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("objective-discover");
        const promise = waitFor(requestId) as Promise<
          | {
              ok: true;
              routes: Array<{
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
          | { ok: false; code: string; detail?: string }
        >;
        send(
          envelope("objective.discover", {
            requestId,
            query: input.query,
            objectiveType: input.objectiveType,
            target: input.target,
          }),
        );
        return promise;
      },
      async start(input) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("objective-start");
        const promise = waitFor(requestId) as Promise<
          | { ok: true; targetAppId?: string; route?: string; sessionId?: string; status?: string }
          | { ok: false; code: string; detail?: string }
        >;
        send(
          envelope("objective.start", {
            requestId,
            query: input.query,
            objectiveType: input.objectiveType,
            target: input.target,
            targetAppId: input.targetAppId,
          }),
        );
        return promise;
      },
      async current() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("objective-current");
        const promise = waitFor(requestId) as Promise<
          | { ok: true; status?: string; targetAppId?: string; sessionId?: string }
          | { ok: false; code: string; detail?: string }
        >;
        send(envelope("objective.current", { requestId }));
        return promise;
      },
      async cancel() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("objective-cancel");
        const promise = waitFor(requestId) as Promise<
          { ok: true; status?: string } | { ok: false; code: string; detail?: string }
        >;
        send(envelope("objective.cancel", { requestId }));
        return promise;
      },
      async continue(input = {}) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("objective-continue");
        const promise = waitFor(requestId) as Promise<ShellContinuityResult>;
        send(
          envelope("objective.continue", {
            requestId,
            contextId: input.contextId,
            objectiveType: input.objectiveType,
            target: input.target,
          }),
        );
        return promise;
      },
    },
    preferences: {
      async list() {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("preference-list");
        const promise = waitFor(requestId) as Promise<
          | {
              ok: true;
              preferences: Array<{
                appId: string;
                objectiveType: string;
                objectType?: string;
                source: string;
                updatedAt: string;
              }>;
            }
          | { ok: false; code: string; detail?: string }
        >;
        send(envelope("preference.list", { requestId }));
        return promise;
      },
      async get(input = {}) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("preference-get");
        const promise = waitFor(requestId) as Promise<
          | {
              ok: true;
              preferences: Array<{
                appId: string;
                objectiveType: string;
                objectType?: string;
                source: string;
                updatedAt: string;
              }>;
            }
          | { ok: false; code: string; detail?: string }
        >;
        send(
          envelope("preference.get", {
            requestId,
            objectiveType: input.objectiveType,
            target: input.objectType,
          }),
        );
        return promise;
      },
      async set(input) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("preference-set");
        const promise = waitFor(requestId) as Promise<
          | {
              ok: true;
              preferences: Array<{
                appId: string;
                objectiveType: string;
                objectType?: string;
                source: string;
                updatedAt: string;
              }>;
            }
          | { ok: false; code: string; detail?: string }
        >;
        send(
          envelope("preference.set", {
            requestId,
            objectiveType: input.objectiveType,
            target: input.objectType,
            targetAppId: input.appId,
          }),
        );
        return promise;
      },
      async clear(input = {}) {
        if (!shellOrigin) return unavailable();
        const requestId = nextId("preference-clear");
        const promise = waitFor(requestId) as Promise<
          | {
              ok: true;
              preferences: Array<{
                appId: string;
                objectiveType: string;
                objectType?: string;
                source: string;
                updatedAt: string;
              }>;
            }
          | { ok: false; code: string; detail?: string }
        >;
        send(
          envelope("preference.clear", {
            requestId,
            objectiveType: input.objectiveType,
            target: input.objectType,
          }),
        );
        return promise;
      },
    },
    async getDiagnostics() {
      if (!shellOrigin) return unavailable();
      if (!lastDiscovery.length) {
        const listed = await api.capabilities.list();
        if ("code" in listed) return listed;
      }
      const discovery = lastDiscovery;
      const by = (status: string) => discovery.filter((item) => item.status === status).map((item) => item.id);
      return {
        application: lastContext?.name ?? (typeof document !== "undefined" ? document.title : "App"),
        origin: lastContext?.origin ?? (typeof location !== "undefined" ? location.origin : ""),
        trustClass: (lastContext?.class as ShellDeveloperDiagnostics["trustClass"]) ?? "compatible",
        trustState: "REGISTERED",
        manifestVersion: lastContext?.version ?? null,
        requestedCapabilities: discovery.map((item) => item.id),
        availableCapabilities: [...by("available"), ...by("permission_required"), ...by("granted")],
        grantedCapabilities: by("granted"),
        deniedCapabilities: by("denied"),
        unavailableCapabilities: [...by("unavailable"), ...by("class_a_blocked")],
        protocolVersion: SHELL_MESSAGE_VERSION,
        shellVersion: OSSHELL_VERSION,
        developerContractVersion: DEVELOPER_CONTRACT_VERSION,
      } satisfies ShellDeveloperDiagnostics;
    },
    reportExecution(capability, started, result) {
      if (!shellOrigin) return;
      send(
        envelope("capability.execution", {
          capability,
          executionStarted: started,
          executionResult: result,
        }),
      );
    },
    ready,
    navigation,
    navigate: navigation,
    async handoff(input) {
      if (!shellOrigin) return unavailable();
      const requestId = nextId("handoff");
      const promise = waitFor(requestId) as Promise<ShellHandoffResult>;
      send(
        envelope("application.handoff", {
          requestId,
          targetAppId: input.targetAppId,
          route: input.route,
          context: input.context ?? {},
        }),
      );
      return promise;
    },
    detach() {
      detachListener?.();
      detachListener = null;
      shellOrigin = null;
      pending.clear();
    },
  };

  return api;
}

export {
  OSSHELL_VERSION,
  SHELL_MESSAGE_VERSION,
  DEVELOPER_CONTRACT_VERSION,
  DISTRIBUTION_CONTRACT_VERSION,
  INTEROPERABILITY_CONTRACT_VERSION,
  CONTINUITY_CONTRACT_VERSION,
  OBJECT_ACTION_CONTRACT_VERSION,
  SEARCH_CONTRACT_VERSION,
  OBJECTIVES_CONTRACT_VERSION,
  PREFERENCES_CONTRACT_VERSION,
  shellError,
  shellCompatibility,
  createContextReference,
  validateContextReference,
};
