import { useEffect, useRef, useState } from "react";
import {
  executeShellSearch,
  groupSearchResults,
  searchAuditEntry,
  searchResultActions,
  searchResultMessage,
  searchProviderQueryMessage,
  SEARCH_LIMITS,
  validateSearchResults,
  type OSShellSearchResult,
  type OSShellSearchScope,
  type OSShellSearchProviderState,
  resolveObjectiveFromText,
  suggestObjectives,
  contextStubForTarget,
  objectiveAuditEntry,
  objectiveDiscoverResultMessage,
  objectiveResultMessage,
  objectiveLabel,
  type OSShellObjectiveRoute,
  OS_SHELL_ACTION_LABELS,
  setApplicationPreference,
  clearApplicationPreference,
  clearAllApplicationPreferences,
  rememberRecentSuccess,
  groupRoutesByPreference,
  preferenceLabel,
  preferenceAuditEntry,
  preferenceResultMessage,
  type OSShellApplicationPreference,
  validateApplicationPreference,
  continueFromOperatingContext,
  applyReturnHandoff,
  createOperatingContext,
  publicOperatingContextView,
  revalidateOperatingContext,
  continuityResultMessage,
  continuityAuditEntry,
  type CurrentOperatingContext,
  resolveOperatingContext,
  resolveContextualObjective,
  snapshotOperatingContext,
  validateContextProposal,
  publicPersonalContextView,
  sessionResumeLabel,
  type OSShellPersonalOperatingContext,
  type OSShellContextEntry,
  actionAuditEntry,
  actionDiscoverResultMessage,
  actionResultMessage,
  actionRequiresConfirmation,
  discoverActions,
  groupActionsById,
  validateActionRequest,
  contextCurrentResultMessage,
  CAPABILITY_LABELS,
  OSSHELL_VERSION,
  appKindFromClass,
  applicationBackMessage,
  availableCatalogEntries,
  builtinAppRegistry,
  capabilityAuditEntry,
  capabilityDiscoverResultMessage,
  capabilityResultMessage,
  capabilityStatusResultMessage,
  capabilityStatusSurface,
  classifyNavigation,
  contextResultMessage,
  createGrant,
  decideBack,
  defaultAvailability,
  originPolicyFromEnvironment,
  readShellEnvironmentFromVite,
  discoverCapabilities,
  discoverIntentHandlers,
  findApplicationById,
  findApplicationByOrigin,
  grantedCapabilityNotes,
  handoffResultMessage,
  handshakeReply,
  installPreviewFromRecord,
  intentAuditEntry,
  intentDeliverMessage,
  intentDiscoverResultMessage,
  intentResultMessage,
  intentToHandoffPayload,
  isFavorite,
  isOSShellIntent,
  isShellCapability,
  lifecycleFor,
  lookupDefaultHandler,
  markApplicationRunning,
  nativeAppForOrigin,
  originOf,
  outcomeOf,
  permissionCenterRows,
  permissionResultMessage,
  postToApp,
  publicAppLabel,
  readLocalSimulationConfig,
  recordFromValidatedManifest,
  rememberRequest,
  resolveAppIdentity,
  resolveApplicationTrust,
  resolveCapabilityName,
  resolveIntentTarget,
  revokeGrant,
  sessionAuditEntry,
  sessionResultMessage,
  sessionResumeMessage,
  setDefaultHandler,
  shellCompatibility,
  toRecentApp,
  toggleFavorite,
  updateInfoFor,
  upsertDecision,
  validateApplicationHandoff,
  validateDeveloperManifest,
  validateIntentRequest,
  developerManifestToWellKnown,
  WELL_KNOWN_MANIFEST_PATH,
  withSimulatedUpdate,
  type CapabilityOutcome,
  type DefaultIntentHandler,
  type FavoriteApp,
  type LifecycleRecord,
  type OSShellActionId,
  type OSShellContextReference,
  type OSShellApplicationRecord,
  type OSShellIntentHandlerDescriptor,
  type OSShellIntentRequest,
  type OSShellSession,
  type PermissionDecision,
  type PermissionGrant,
  type RecentApp,
} from "@osshell/contract";
import {
  ClientApplicationStore,
  ClientAuditStore,
  ClientDecisionStore,
  ClientDefaultHandlerStore,
  ClientFavoriteStore,
  ClientGrantStore,
  ClientOperatingSessionStore,
  ClientRecentStore,
  ClientSearchHistoryStore,
  ClientObjectiveHistoryStore,
  ClientPreferenceStore,
  ClientOperatingContextStore,
  ClientSelectedObjectStore,
  applyActivate,
  applyClose,
  applyDisconnect,
  applyOpen,
  applyReady,
  applySuspend,
  authorizeSessionParticipation,
  cancelPendingForOrigin,
  coalesceCapabilityRequest,
  contextForSession,
  interpretAppEvent,
  mediateCapability,
  nativeLaunch,
  nextPrompt,
  openNewContext,
  planLoad,
  probeEmbedState,
  publicSessionView,
  resolveNavigation,
  sessionSourceOf,
  snapshotCapability,
  takePendingRequest,
  type PendingCapabilityRequest,
} from "@osshell/runtime";
import {
  ActionMenuSurface,
  SearchSurface,
  LauncherSurface,
  AddApplicationSurface,
  AppFallback,
  ApplicationDetailSurface,
  ApplicationsLauncher,
  DevicesPane,
  DigitalLifePane,
  FrameHost,
  HomeSurface,
  IntentChooserSurface,
  PermissionCenter,
  ResumeChooserSurface,
  SessionSurface,
  type ShellSession,
  type Surface,
} from "./surfaces";
import { attachNativeShellBridge, isNativeShell, openFirstPartyAndroidApp } from "./native-bridge";

type Place = { surface: Surface; origin: string | null; appId?: string | null; sessionId?: string };

type PendingIntent = {
  request: OSShellIntentRequest;
  sourceOrigin: string;
  handlers: OSShellIntentHandlerDescriptor[];
};

type PendingResume = {
  appId: string;
  route: string;
  label: string;
};

const grantsStore = new ClientGrantStore(window.localStorage);
const decisionsStore = new ClientDecisionStore(window.localStorage);
const auditStore = new ClientAuditStore(window.localStorage);
const recentsStore = new ClientRecentStore(window.localStorage);
const favoritesStore = new ClientFavoriteStore(window.localStorage);
const applicationsStore = new ClientApplicationStore(window.localStorage);
const defaultHandlersStore = new ClientDefaultHandlerStore(window.localStorage);
const operatingSessionsStore = new ClientOperatingSessionStore(window.sessionStorage, window.localStorage);
const selectedObjectStore = new ClientSelectedObjectStore(window.sessionStorage);
const searchHistoryStore = new ClientSearchHistoryStore(window.localStorage);
const objectiveHistoryStore = new ClientObjectiveHistoryStore(window.localStorage);
const preferenceStore = new ClientPreferenceStore(window.localStorage);
const operatingContextStore = new ClientOperatingContextStore(window.sessionStorage, window.localStorage);
const shellEnvironment = readShellEnvironmentFromVite();
const policy = originPolicyFromEnvironment(shellEnvironment);
const availability = defaultAvailability();
const natives = builtinAppRegistry();

function availabilityCodeFor(capability: string): string | undefined {
  const resolved = resolveCapabilityName(capability);
  if (isShellCapability(resolved)) return availability[resolved]?.code;
  return undefined;
}

/** DEVELOPMENT / SIMULATION ONLY — localhost Shell hosts with explicit localStorage opt-in. Impossible in production builds. */
function mediationExtras() {
  return {
    shellHostOrigin: window.location.origin,
    simulation: shellEnvironment.allowDevelopmentFeatures
      ? readLocalSimulationConfig(window.location.origin, window.localStorage)
      : null,
  };
}

function emptySessionFields(): Pick<ShellSession, "runtimeState" | "title" | "path" | "canGoBack" | "handshake"> {
  return { runtimeState: "application_loading", title: null, path: null, canGoBack: false, handshake: false };
}

export function App() {
  const [input, setInput] = useState("https://example.com");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ShellSession[]>([]);
  const [records, setRecords] = useState<LifecycleRecord[]>([]);
  const [surface, setSurface] = useState<Surface>("home");
  const [grants, setGrants] = useState<PermissionGrant[]>(() => grantsStore.load());
  const [decisions, setDecisions] = useState<PermissionDecision[]>(() => decisionsStore.load());
  const [pending, setPending] = useState<PendingCapabilityRequest[]>([]);
  const [prompt, setPrompt] = useState<PendingCapabilityRequest | null>(null);
  const [recents, setRecents] = useState<RecentApp[]>(() => recentsStore.load());
  const [favorites, setFavorites] = useState<FavoriteApp[]>(() => favoritesStore.load());
  const [installedApps, setInstalledApps] = useState<OSShellApplicationRecord[]>(() => applicationsStore.load());
  const [detailAppId, setDetailAppId] = useState<string | null>(null);
  const [addInput, setAddInput] = useState("https://");
  const [addPreview, setAddPreview] = useState<OSShellApplicationRecord | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [defaultHandlers, setDefaultHandlers] = useState<DefaultIntentHandler[]>(() => defaultHandlersStore.load());
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const [operatingSessions, setOperatingSessions] = useState<OSShellSession[]>(() => operatingSessionsStore.load());
  const [recoveryOffer, setRecoveryOffer] = useState<OSShellSession | null>(() => {
    const live = operatingSessionsStore.load();
    if (live.some((item) => item.state === "ACTIVE" || item.state === "SUSPENDED" || item.state === "BACKGROUND")) return null;
    return operatingSessionsStore.loadRecovery()[0] ?? null;
  });
  const [pendingResume, setPendingResume] = useState<PendingResume | null>(null);
  const [selectedObject, setSelectedObject] = useState<OSShellContextReference | null>(() => selectedObjectStore.current());
  const [recentActions, setRecentActions] = useState<string[]>(() => selectedObjectStore.recentActions());
  const [confirmAction, setConfirmAction] = useState<{
    actionId: OSShellActionId;
    label: string;
    appId: string;
    route: string;
  } | null>(null);
  const [openWithAction, setOpenWithAction] = useState<OSShellActionId | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<OSShellSearchScope>("all");
  const [searchResults, setSearchResults] = useState<OSShellSearchResult[]>([]);
  const [searchProviders, setSearchProviders] = useState<Array<{ appId: string; state: string }>>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => searchHistoryStore.load());
  const [selectedSearchResult, setSelectedSearchResult] = useState<OSShellSearchResult | null>(null);
  const [launcherQuery, setLauncherQuery] = useState("");
  const [objectiveRoutes, setObjectiveRoutes] = useState<OSShellObjectiveRoute[]>([]);
  const [selectedObjectiveRoute, setSelectedObjectiveRoute] = useState<OSShellObjectiveRoute | null>(null);
  const [objectiveHistory, setObjectiveHistory] = useState<string[]>(() => objectiveHistoryStore.load());
  const [objectiveFavorites, setObjectiveFavorites] = useState<string[]>(() => objectiveHistoryStore.favorites());
  const [applicationPreferences, setApplicationPreferences] = useState<OSShellApplicationPreference[]>(() =>
    preferenceStore.load(),
  );
  const [networkOnline, setNetworkOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [appSearch, setAppSearch] = useState("");
  const [operatingContext, setOperatingContext] = useState<CurrentOperatingContext | null>(() =>
    operatingContextStore.current(),
  );
  const [recentContinuity, setRecentContinuity] = useState<CurrentOperatingContext[]>(() =>
    operatingContextStore.recent(),
  );
  const [ambiguityChoices, setAmbiguityChoices] = useState<OSShellContextEntry[]>([]);
  const [personalContext, setPersonalContext] = useState<OSShellPersonalOperatingContext | null>(null);
  const [softwareRuntimeAvailable] = useState(false);
  const selectedObjectiveRouteRef = useRef<OSShellObjectiveRoute | null>(null);
  selectedObjectiveRouteRef.current = selectedObjectiveRoute;
  const pendingProviderSearchesRef = useRef(
    new Map<
      string,
      {
        appId: string;
        settle: (input: { results: OSShellSearchResult[]; timedOut: boolean }) => void;
      }
    >(),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [places, setPlaces] = useState<Place[]>([{ surface: "home", origin: null }]);
  const [placeIndex, setPlaceIndex] = useState(0);
  const [focusedOrigin, setFocusedOrigin] = useState<string | null>(null);
  const framesRef = useRef<Record<string, HTMLIFrameElement | null>>({});
  const sessionsRef = useRef(sessions);
  const recordsRef = useRef(records);
  const grantsRef = useRef(grants);
  const decisionsRef = useRef(decisions);
  const pendingRef = useRef(pending);
  const promptRef = useRef(prompt);
  const installedAppsRef = useRef(installedApps);
  sessionsRef.current = sessions;
  recordsRef.current = records;
  grantsRef.current = grants;
  decisionsRef.current = decisions;
  pendingRef.current = pending;
  promptRef.current = prompt;
  installedAppsRef.current = installedApps;

  const activeOrigin = records.find((item) => item.lifecycle === "ACTIVE" || item.lifecycle === "OPEN")?.origin ?? null;
  const active = sessions.find((item) => item.origin === activeOrigin) ?? null;
  const focused = sessions.find((item) => item.origin === (activeOrigin ?? focusedOrigin)) ?? active;
  const place = places[placeIndex] ?? { surface: "home", origin: null };
  const appCanGoBack = Boolean(active?.canGoBack);
  const canBack = appCanGoBack || placeIndex > 0;
  const activeOperating = operatingSessions.find((item) => item.state === "ACTIVE") ?? null;

  function refreshOperatingSessions(next?: OSShellSession[]) {
    const list = next ?? operatingSessionsStore.load();
    setOperatingSessions(list);
    return list;
  }

  function refreshOperatingContext(next?: CurrentOperatingContext | null) {
    const current = next === undefined ? operatingContextStore.current() : next;
    setOperatingContext(current);
    setRecentContinuity(operatingContextStore.recent());
    const personal = buildPersonalContext(current);
    setPersonalContext(personal);
    return current;
  }

  function buildPersonalContext(continuity?: CurrentOperatingContext | null): OSShellPersonalOperatingContext {
    const capRows = Object.entries(availability).map(([id, row]) => ({
      id,
      label: CAPABILITY_LABELS[id as keyof typeof CAPABILITY_LABELS] ?? id,
      status: row.bound && row.code === "ok" ? "available" : row.code,
    }));
    return resolveOperatingContext({
      continuity: continuity === undefined ? operatingContextStore.current() : continuity,
      recent: operatingContextStore.recent(),
      selectedObject: selectedObjectStore.current(),
      sessions: operatingSessionsStore.load(),
      registry: installedAppsRef.current,
      preferences: preferenceStore.load(),
      capabilityStatus: capRows,
      grantedCapabilitiesByOrigin: runtimeHints().grantedCapabilitiesByOrigin,
    });
  }

  function persistOperatingContext(input: unknown): CurrentOperatingContext | null {
    const saved = operatingContextStore.setCurrent(input);
    if (!saved.ok) return null;
    refreshOperatingContext(saved.context);
    if (saved.context.objectReference) {
      selectedObjectStore.select(saved.context.objectReference);
      setSelectedObject(saved.context.objectReference);
    }
    return saved.context;
  }

  function operatingContextPublicView(context: CurrentOperatingContext | null) {
    if (!context) return null;
    return {
      id: context.id,
      sessionId: context.sessionId,
      application: context.currentAppId,
      objective: context.objectiveType,
      action: context.actionReference,
      label: context.label,
      updatedAt: context.updatedAt,
      suggestedNextObjectives: context.suggestedNextObjectives,
    };
  }

  useEffect(() => {
    grantsStore.save(grants);
  }, [grants]);

  useEffect(() => {
    decisionsStore.save(decisions);
  }, [decisions]);

  useEffect(() => {
    function onHide() {
      setRecords((current) => applySuspend(current));
    }
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    function onBrowserOnline() {
      setNetworkOnline(true);
    }
    function onBrowserOffline() {
      setNetworkOnline(false);
    }
    window.addEventListener("online", onBrowserOnline);
    window.addEventListener("offline", onBrowserOffline);
    return () => {
      window.removeEventListener("online", onBrowserOnline);
      window.removeEventListener("offline", onBrowserOffline);
    };
  }, []);

  const backRef = useRef(back);
  backRef.current = back;
  const canBackRef = useRef(canBack);
  canBackRef.current = canBack;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void attachNativeShellBridge({
      onBackButton: () => {
        if (canBackRef.current || surfaceRef.current !== "home") {
          backRef.current();
          return true;
        }
        return false;
      },
      onNetworkChange: (online) => {
        if (!disposed) setNetworkOnline(online);
      },
      onAppState: (state) => {
        if (disposed) return;
        if (state === "background") setRecords((current) => applySuspend(current));
      },
    }).then((fn) => {
      if (disposed) fn();
      else cleanup = fn;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  function go(next: Place) {
    const withSession = {
      ...next,
      sessionId: next.sessionId ?? operatingSessionsStore.current()?.sessionId,
    };
    setPlaces((current) => [...current.slice(0, placeIndex + 1), withSession]);
    setPlaceIndex((index) => index + 1);
    setSurface(withSession.surface);
    setMenuOpen(false);
    if (withSession.appId) setDetailAppId(withSession.appId);
    if (withSession.surface !== "app") setRecords((current) => applySuspend(current));
  }

  function shellBack() {
    if (placeIndex === 0) return;
    const next = places[placeIndex - 1]!;
    const origin = next.origin;
    setPlaceIndex(placeIndex - 1);
    setSurface(next.surface);
    if (next.surface === "app" && origin) setRecords((current) => applyActivate(current, origin));
    else setRecords((current) => applySuspend(current));
  }

  function back() {
    const kind = classifyNavigation({
      shellSurface: surface !== "app",
      appClass: active?.identity.effectiveClass ?? null,
    });
    const owner = decideBack({ appCanGoBack, shellHasHistory: placeIndex > 0, kind });
    if (owner === "application" && active) {
      const frame = framesRef.current[active.origin]?.contentWindow;
      if (frame) postToApp(frame, active.origin, applicationBackMessage());
      return;
    }
    if (owner === "shell") {
      shellBack();
      return;
    }
    window.history.back();
  }

  function forward() {
    if (placeIndex >= places.length - 1) return;
    const next = places[placeIndex + 1]!;
    const origin = next.origin;
    setPlaceIndex(placeIndex + 1);
    setSurface(next.surface);
    if (next.surface === "app" && origin) setRecords((current) => applyActivate(current, origin));
    else setRecords((current) => applySuspend(current));
  }

  function postToOrigin(origin: string, message: Parameters<typeof postToApp>[2]) {
    const frame = framesRef.current[origin]?.contentWindow;
    if (!frame) return { ok: false as const, code: "application_disconnected" as const };
    return postToApp(frame, origin, message);
  }

  function postOutcome(origin: string, requestId: string, outcome: CapabilityOutcome) {
    postToOrigin(origin, capabilityResultMessage(requestId, outcome));
    postToOrigin(origin, permissionResultMessage(requestId, outcome));
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const session = sessionsRef.current.find((item) => item.origin === event.origin);
      const parsed = interpretAppEvent({
        data: event.data,
        eventOrigin: event.origin,
        eventSource: event.source,
        expectedOrigin: session?.origin ?? "",
        expectedSource: sessionSourceOf(framesRef.current[session?.origin ?? ""] ?? null),
        registered: Boolean(session),
      });
      if (!parsed.ok || !session) return;
      const incoming = parsed.message;
      const recordsNow = recordsRef.current;
      const grantsNow = grantsRef.current;
      const lifecycle = lifecycleFor(recordsNow, session.origin);
      const connected = lifecycle !== "CLOSED";

      if (incoming.type === "ready") {
        if (!connected) return;
        setRecords((current) => applyReady(current, session.origin));
        setSessions((current) =>
          current.map((item) =>
            item.origin === session.origin
              ? {
                  ...item,
                  handshake: true,
                  runtimeState: "application_ready",
                  title: incoming.title ?? item.title,
                  path: incoming.path ?? item.path,
                  canGoBack: incoming.canGoBack ?? item.canGoBack,
                }
              : item,
          ),
        );
        const context = contextForSession({
          identity: session.identity,
          grants: grantsNow,
          requested: session.requested,
          records: applyReady(recordsNow, session.origin),
          appId: registryAppIdForOrigin(session.origin),
        });
        for (const message of handshakeReply(context)) {
          postToOrigin(session.origin, message);
        }
        setInstalledApps((current) => {
          const app = findApplicationByOrigin(current, session.origin);
          return app ? markApplicationRunning(current, app.appId) : current;
        });
        return;
      }

      if (incoming.type === "application.title" || incoming.type === "application.navigation" || incoming.type === "application.lifecycle") {
        setSessions((current) =>
          current.map((item) =>
            item.origin === session.origin
              ? {
                  ...item,
                  title: incoming.title ?? item.title,
                  path: incoming.path ?? item.path,
                  canGoBack: incoming.canGoBack ?? item.canGoBack,
                }
              : item,
          ),
        );
        return;
      }

      if (!connected) return;

      if (incoming.type === "context.request" && incoming.requestId) {
        const context = contextForSession({
          identity: session.identity,
          grants: grantsNow,
          requested: session.requested,
          records: recordsNow,
          appId: registryAppIdForOrigin(session.origin),
        });
        postToOrigin(session.origin, contextResultMessage(incoming.requestId, context));
        return;
      }

      if (incoming.type === "application.handoff" && incoming.requestId && incoming.targetAppId) {
        const sourceAppId = registryAppIdForOrigin(session.origin) ?? session.origin;
        const validated = validateApplicationHandoff({
          sourceAppId,
          handoff: {
            targetAppId: incoming.targetAppId,
            route: incoming.route,
            context: incoming.context,
          },
          registry: installedAppsRef.current,
        });
        if (!validated.ok) {
          postToOrigin(
            session.origin,
            handoffResultMessage({
              requestId: incoming.requestId,
              ok: false,
              code: validated.code,
              detail: validated.detail,
            }),
          );
          return;
        }
        postToOrigin(
          session.origin,
          handoffResultMessage({
            requestId: incoming.requestId,
            ok: true,
            targetAppId: validated.target.appId,
            route: validated.route,
            detail: "Handoff is navigation only. No permissions or credentials were transferred.",
          }),
        );
        openInstalledApp(validated.target.appId, validated.route);
        return;
      }

      if (incoming.type === "intent.discover" && incoming.requestId && incoming.intent && incoming.contextType) {
        if (!isOSShellIntent(incoming.intent)) {
          postToOrigin(session.origin, intentDiscoverResultMessage(incoming.requestId, []));
          return;
        }
        const handlers = discoverIntentHandlers({
          intent: incoming.intent,
          contextType: incoming.contextType as OSShellIntentRequest["context"]["type"],
          registry: installedAppsRef.current,
          excludeAppId: registryAppIdForOrigin(session.origin) ?? undefined,
        });
        auditStore.append(
          intentAuditEntry({
            origin: session.origin,
            appId: registryAppIdForOrigin(session.origin),
            decision: "handler_discovered",
            result: `${handlers.length}`,
            intent: incoming.intent,
            contextType: incoming.contextType,
          }),
        );
        postToOrigin(session.origin, intentDiscoverResultMessage(incoming.requestId, handlers));
        return;
      }

      if (incoming.type === "intent.request" && incoming.requestId) {
        const sourceAppId = registryAppIdForOrigin(session.origin) ?? session.origin;
        const validated = validateIntentRequest({
          sourceAppId,
          payload: {
            intent: incoming.intent,
            requestId: incoming.requestId,
            targetAppId: incoming.targetAppId,
            context: incoming.context,
            sessionId: incoming.sessionId,
          },
        });
        if (!validated.ok) {
          auditStore.append(
            intentAuditEntry({
              origin: session.origin,
              appId: sourceAppId,
              decision: validated.code === "secret_payload" || validated.code === "context_invalid" ? "context_rejected" : "handoff_denied",
              result: validated.code,
              intent: incoming.intent,
            }),
          );
          postToOrigin(
            session.origin,
            intentResultMessage({
              requestId: incoming.requestId,
              ok: false,
              code: validated.code,
              detail: validated.detail,
            }),
          );
          return;
        }
        if (validated.request.sessionId) {
          const auth = authorizeSessionParticipation({
            session: operatingSessionsStore.list().find((item) => item.sessionId === validated.request.sessionId) ?? null,
            appId: sourceAppId,
            sessionId: validated.request.sessionId,
          });
          if (!auth.ok) {
            postToOrigin(
              session.origin,
              intentResultMessage({
                requestId: incoming.requestId,
                ok: false,
                code: auth.code,
                detail: auth.detail,
              }),
            );
            return;
          }
        }
        auditStore.append(
          intentAuditEntry({
            origin: session.origin,
            appId: sourceAppId,
            decision: "intent_requested",
            result: validated.request.intent,
            intent: validated.request.intent,
            contextType: validated.request.context.type,
            targetAppId: validated.request.targetAppId ?? null,
          }),
        );
        const defaultAppId = lookupDefaultHandler(
          defaultHandlers,
          validated.request.intent,
          validated.request.context.type,
        );
        const routed = resolveIntentTarget({
          request: validated.request,
          registry: installedAppsRef.current,
          defaultHandlerAppId: defaultAppId,
        });
        if (!routed.ok) {
          auditStore.append(
            intentAuditEntry({
              origin: session.origin,
              appId: sourceAppId,
              decision: "handoff_denied",
              result: routed.code,
              intent: validated.request.intent,
              contextType: validated.request.context.type,
            }),
          );
          postToOrigin(
            session.origin,
            intentResultMessage({
              requestId: validated.request.requestId,
              ok: false,
              code: routed.code,
              detail: routed.detail,
            }),
          );
          return;
        }
        if (routed.selected && (routed.mode === "explicit" || routed.mode === "default")) {
          completeIntent({
            request: validated.request,
            sourceOrigin: session.origin,
            targetAppId: routed.selected.appId,
            route: routed.selected.route,
          });
          return;
        }
        if (routed.handlers.length === 1 && routed.handlers[0]) {
          setPendingIntent({
            request: validated.request,
            sourceOrigin: session.origin,
            handlers: routed.handlers,
          });
          return;
        }
        setPendingIntent({
          request: validated.request,
          sourceOrigin: session.origin,
          handlers: routed.handlers,
        });
        return;
      }

      if (
        (incoming.type === "session.current" ||
          incoming.type === "session.create" ||
          incoming.type === "session.resume" ||
          incoming.type === "session.end" ||
          incoming.type === "session.join" ||
          incoming.type === "session.leave") &&
        incoming.requestId
      ) {
        const appId = registryAppIdForOrigin(session.origin) ?? session.origin;
        handleSessionApi({
          type: incoming.type,
          requestId: incoming.requestId,
          origin: session.origin,
          appId,
          sessionId: incoming.sessionId,
          label: incoming.label,
        });
        return;
      }

      if (
        (incoming.type === "action.discover" ||
          incoming.type === "action.request" ||
          incoming.type === "context.current" ||
          incoming.type === "context.select" ||
          incoming.type === "action.result") &&
        incoming.requestId
      ) {
        handleActionApi({
          type: incoming.type,
          requestId: incoming.requestId,
          origin: session.origin,
          appId: registryAppIdForOrigin(session.origin) ?? session.origin,
          action: incoming.action ?? incoming.intent,
          object: incoming.object ?? incoming.context,
          targetAppId: incoming.targetAppId,
          sessionId: incoming.sessionId,
          status: incoming.status,
        });
        return;
      }

      if (incoming.type === "search.clearHistory") {
        searchHistoryStore.clear();
        setSearchHistory([]);
        return;
      }

      if (incoming.type === "search.provider.result" && incoming.requestId) {
        const pending = pendingProviderSearchesRef.current.get(incoming.requestId);
        if (!pending) return;
        pendingProviderSearchesRef.current.delete(incoming.requestId);
        const validated = validateSearchResults(incoming.results ?? []);
        if (!validated.ok) {
          pending.settle({ results: [], timedOut: false });
          return;
        }
        const stamped = validated.results
          .filter((item) => !item.appId || item.appId === pending.appId)
          .map((item) => ({ ...item, appId: item.appId ?? pending.appId }));
        pending.settle({ results: stamped, timedOut: false });
        return;
      }

      if (incoming.type === "search.query" && incoming.requestId && typeof incoming.query === "string") {
        const executed = executeShellSearch({
          query: {
            query: incoming.query,
            types: incoming.types as never,
            appIds: incoming.appIds,
            limit: incoming.limit,
            scope: (incoming.scope as OSShellSearchScope | undefined) ?? "all",
          },
          registry: installedAppsRef.current,
          sessions: operatingSessionsStore.list(),
          selectedObject: selectedObjectStore.current(),
        });
        if (!executed.ok) {
          postToOrigin(
            session.origin,
            searchResultMessage({
              requestId: incoming.requestId,
              ok: false,
              code: executed.code,
              detail: executed.detail,
            }),
          );
          return;
        }
        postToOrigin(
          session.origin,
          searchResultMessage({
            requestId: incoming.requestId,
            ok: true,
            results: executed.results.map((item) => ({
              type: item.type,
              title: item.title,
              subtitle: item.subtitle,
              appId: item.appId,
              action: item.action,
              context: item.context,
            })),
            providers: executed.providers,
          }),
        );
        return;
      }

      if (
        (incoming.type === "objective.discover" ||
          incoming.type === "objective.start" ||
          incoming.type === "objective.current" ||
          incoming.type === "objective.cancel") &&
        incoming.requestId
      ) {
        if (incoming.type === "objective.current") {
          postToOrigin(
            session.origin,
            objectiveResultMessage({
              requestId: incoming.requestId,
              ok: true,
              status: selectedObjectiveRouteRef.current ? "active" : "none",
              targetAppId: selectedObjectiveRouteRef.current?.appId,
              sessionId: selectedObjectiveRouteRef.current?.sessionId,
            }),
          );
          return;
        }
        if (incoming.type === "objective.cancel") {
          setSelectedObjectiveRoute(null);
          setObjectiveRoutes([]);
          auditStore.append(
            objectiveAuditEntry({
              origin: window.location.origin,
              decision: "objective_cancelled",
              result: "cancelled",
            }),
          );
          postToOrigin(
            session.origin,
            objectiveResultMessage({ requestId: incoming.requestId, ok: true, status: "cancelled" }),
          );
          return;
        }
        const text =
          incoming.query ??
          [incoming.objectiveType, incoming.target].filter(Boolean).join(" ") ??
          "";
        const resolved = resolveObjectiveFromText({
          text: String(text || "continue"),
          registry: installedAppsRef.current,
          selectedObject: selectedObjectStore.current() ?? operatingContextStore.current()?.objectReference ?? null,
          sessions: operatingSessionsStore.list(),
          runtimeHints: {
            softwareRuntime: softwareRuntimeAvailable,
          },
          preferences: preferenceStore.load(),
          operatingContext: operatingContextStore.current(),
        });
        if (incoming.type === "objective.discover") {
          if (!resolved.ok) {
            postToOrigin(
              session.origin,
              objectiveDiscoverResultMessage({
                requestId: incoming.requestId,
                ok: false,
                code: resolved.code,
                detail: resolved.detail,
              }),
            );
            return;
          }
          postToOrigin(
            session.origin,
            objectiveDiscoverResultMessage({
              requestId: incoming.requestId,
              ok: true,
              routes: resolved.routes.map((route) => ({
                objectiveType: route.objective.type,
                target: route.objective.target,
                label: route.objective.label,
                appId: route.appId,
                appName: route.appName,
                intent: route.intent,
                availability: route.availability,
                reason: route.reason,
                sessionId: route.sessionId,
                routePath: route.routePath,
              })),
            }),
          );
          return;
        }
        if (!resolved.ok || !resolved.routes[0]) {
          postToOrigin(
            session.origin,
            objectiveResultMessage({
              requestId: incoming.requestId,
              ok: false,
              code: resolved.ok ? "objective_unavailable" : resolved.code,
              detail: resolved.ok ? "No route" : resolved.detail,
            }),
          );
          return;
        }
        const route =
          resolved.routes.find((item) => !incoming.targetAppId || item.appId === incoming.targetAppId) ??
          resolved.routes[0];
        startObjectiveRoute(route);
        postToOrigin(
          session.origin,
          objectiveResultMessage({
            requestId: incoming.requestId,
            ok: route.availability === "AVAILABLE" || route.availability === "PERMISSION_REQUIRED",
            code: route.availability === "AVAILABLE" || route.availability === "PERMISSION_REQUIRED" ? undefined : "objective_unavailable",
            targetAppId: route.appId,
            route: route.routePath,
            sessionId: route.sessionId,
            status: route.availability,
          }),
        );
        return;
      }

      if (
        (incoming.type === "preference.get" ||
          incoming.type === "preference.set" ||
          incoming.type === "preference.clear" ||
          incoming.type === "preference.list") &&
        incoming.requestId
      ) {
        // Applications may list/get their own preference metadata only through Shell-owned APIs.
        // They cannot write preferences for other apps or inject secrets.
        if (incoming.type === "preference.list" || incoming.type === "preference.get") {
          const list = preferenceStore.load().map((item) => ({
            appId: item.appId,
            objectiveType: item.objectiveType,
            objectType: item.objectType,
            source: item.source,
            updatedAt: item.updatedAt,
          }));
          auditStore.append(
            preferenceAuditEntry({
              origin: window.location.origin,
              decision: "preference_listed",
              result: `${list.length}`,
            }),
          );
          postToOrigin(
            session.origin,
            preferenceResultMessage({ requestId: incoming.requestId, ok: true, preferences: list }),
          );
          return;
        }
        if (incoming.type === "preference.clear") {
          const next = incoming.objectiveType
            ? clearApplicationPreference(preferenceStore.load(), {
                objectiveType: incoming.objectiveType as never,
                objectType: incoming.target,
              })
            : clearAllApplicationPreferences();
          persistPreferences(next);
          auditStore.append(
            preferenceAuditEntry({
              origin: window.location.origin,
              decision: "preference_cleared",
              result: incoming.objectiveType ?? "all",
              objectiveType: incoming.objectiveType ?? null,
            }),
          );
          postToOrigin(
            session.origin,
            preferenceResultMessage({
              requestId: incoming.requestId,
              ok: true,
              preferences: next.map((item) => ({
                appId: item.appId,
                objectiveType: item.objectiveType,
                objectType: item.objectType,
                source: item.source,
                updatedAt: item.updatedAt,
              })),
            }),
          );
          return;
        }
        // preference.set — only allow setting preference to the calling app itself (no elevation).
        const callerAppId = registryAppIdForOrigin(session.origin);
        const validated = validateApplicationPreference({
          appId: callerAppId ?? incoming.targetAppId,
          objectiveType: incoming.objectiveType,
          objectType: incoming.target,
          source: "EXPLICIT",
          preference: "preferred",
          updatedAt: new Date().toISOString(),
        });
        if (!validated.ok || !callerAppId || validated.preference.appId !== callerAppId) {
          postToOrigin(
            session.origin,
            preferenceResultMessage({
              requestId: incoming.requestId,
              ok: false,
              code: "preference_invalid",
              detail: "Applications may only set preferences for themselves.",
            }),
          );
          return;
        }
        const next = setApplicationPreference(preferenceStore.load(), validated.preference);
        persistPreferences(next);
        auditStore.append(
          preferenceAuditEntry({
            origin: window.location.origin,
            decision: "preference_set",
            result: "explicit",
            objectiveType: validated.preference.objectiveType,
            targetAppId: validated.preference.appId,
          }),
        );
        postToOrigin(
          session.origin,
          preferenceResultMessage({
            requestId: incoming.requestId,
            ok: true,
            preferences: next.map((item) => ({
              appId: item.appId,
              objectiveType: item.objectiveType,
              objectType: item.objectType,
              source: item.source,
              updatedAt: item.updatedAt,
            })),
          }),
        );
        return;
      }

      if (
        (incoming.type === "context.clear" ||
          incoming.type === "context.clearCurrent" ||
          incoming.type === "context.clearRecent" ||
          incoming.type === "context.snapshot" ||
          incoming.type === "objective.continue" ||
          incoming.type === "continuity.recent" ||
          incoming.type === "continuity.open" ||
          incoming.type === "continuity.clear" ||
          incoming.type === "handoff.accepted" ||
          incoming.type === "handoff.rejected" ||
          incoming.type === "context.propose") &&
        incoming.requestId
      ) {
        const callerAppId = registryAppIdForOrigin(session.origin);

        if (incoming.type === "context.snapshot") {
          const personal = buildPersonalContext();
          const scope = (incoming.scope as "CURRENT" | "OBJECT" | "SESSION" | "APPLICATION" | "OBJECTIVE" | undefined) ?? "CURRENT";
          const snap = snapshotOperatingContext(personal, scope, callerAppId ?? undefined);
          postToOrigin(
            session.origin,
            continuityResultMessage({
              requestId: incoming.requestId,
              ok: true,
              status: snap.current?.availability ?? "NO_CURRENT_WORK",
              operatingContext: snap.current
                ? {
                    id: "snapshot",
                    sessionId: snap.current.sessionId,
                    application: snap.current.applicationId,
                    objective: snap.current.objectiveType,
                    action: snap.current.actionId,
                    label: snap.current.label,
                    updatedAt: snap.resolvedAt,
                  }
                : null,
              entries: snap.entries.map((item) => ({
                id: item.id,
                label: item.label,
                appId: item.appId,
                objectType: item.objectType,
                objectiveType: item.objectiveType,
                updatedAt: item.updatedAt ?? snap.resolvedAt,
                status: item.availability,
              })),
            }),
          );
          return;
        }

        if (incoming.type === "handoff.accepted" || incoming.type === "handoff.rejected") {
          auditStore.append(
            continuityAuditEntry({
              origin: session.origin,
              appId: callerAppId,
              decision: incoming.type === "handoff.accepted" ? "handoff_accepted" : "handoff_rejected",
              result: incoming.status ?? incoming.type,
              targetAppId: incoming.targetAppId ?? null,
            }),
          );
          postToOrigin(
            session.origin,
            continuityResultMessage({
              requestId: incoming.requestId,
              ok: true,
              status: incoming.type === "handoff.accepted" ? "accepted" : "rejected",
            }),
          );
          return;
        }

        if (incoming.type === "context.clear" || incoming.type === "continuity.clear" || incoming.type === "context.clearCurrent" || incoming.type === "context.clearRecent") {
          if (incoming.type === "continuity.clear" || incoming.type === "context.clear") operatingContextStore.clearAll();
          else if (incoming.type === "context.clearCurrent") operatingContextStore.clearCurrent();
          else operatingContextStore.clearRecent();
          refreshOperatingContext(null);
          auditStore.append(
            continuityAuditEntry({
              origin: window.location.origin,
              decision: "context_cleared",
              result: incoming.type,
            }),
          );
          postToOrigin(
            session.origin,
            continuityResultMessage({ requestId: incoming.requestId, ok: true, status: "cleared", operatingContext: null }),
          );
          return;
        }

        if (incoming.type === "continuity.recent") {
          const entries = operatingContextStore.recent().map((item) => {
            const status = revalidateOperatingContext({
              context: item,
              registry: installedAppsRef.current,
              sessions: operatingSessionsStore.load(),
            }).status;
            return { ...publicOperatingContextView(item)!, status };
          });
          auditStore.append(
            continuityAuditEntry({
              origin: window.location.origin,
              decision: "continuity_listed",
              result: `${entries.length}`,
            }),
          );
          postToOrigin(
            session.origin,
            continuityResultMessage({ requestId: incoming.requestId, ok: true, entries }),
          );
          return;
        }

        if (incoming.type === "continuity.open") {
          const opened = incoming.contextId ? operatingContextStore.open(incoming.contextId) : null;
          if (!opened) {
            postToOrigin(
              session.origin,
              continuityResultMessage({
                requestId: incoming.requestId,
                ok: false,
                code: "continuation_unavailable",
                status: "NOT_FOUND",
                detail: "Continuity entry not found.",
              }),
            );
            return;
          }
          refreshOperatingContext(opened);
          postToOrigin(
            session.origin,
            continuityResultMessage({
              requestId: incoming.requestId,
              ok: true,
              status: "AVAILABLE",
              operatingContext: operatingContextPublicView(opened),
            }),
          );
          return;
        }

        if (incoming.type === "context.propose") {
          const proposalCheck = validateContextProposal({
            ...(incoming.context ?? {}),
            objectReference: incoming.object,
            forceCurrent: (incoming.context as { forceCurrent?: unknown } | undefined)?.forceCurrent,
          });
          if (!proposalCheck.ok) {
            postToOrigin(
              session.origin,
              continuityResultMessage({
                requestId: incoming.requestId,
                ok: false,
                code: proposalCheck.code,
                detail: proposalCheck.detail,
              }),
            );
            return;
          }
          // Shell decides — apps may only propose reference metadata for themselves.
          const applied = applyReturnHandoff(
            operatingContextStore.current(),
            {
              objectReference: incoming.object,
              sessionId: incoming.sessionId,
              label: incoming.label,
              suggestedNextObjectives: (incoming.context as { suggestedNextObjectives?: unknown } | undefined)
                ?.suggestedNextObjectives,
            },
            callerAppId ?? undefined,
          );
          if (!applied.ok) {
            postToOrigin(
              session.origin,
              continuityResultMessage({
                requestId: incoming.requestId,
                ok: false,
                code: applied.code,
                detail: applied.detail,
              }),
            );
            return;
          }
          persistOperatingContext(applied.context);
          auditStore.append(
            continuityAuditEntry({
              origin: session.origin,
              appId: callerAppId,
              decision: "context_updated",
              result: applied.context.id,
              sessionId: applied.context.sessionId ?? null,
            }),
          );
          postToOrigin(
            session.origin,
            continuityResultMessage({
              requestId: incoming.requestId,
              ok: true,
              status: "AVAILABLE",
              operatingContext: operatingContextPublicView(applied.context),
            }),
          );
          return;
        }

        // objective.continue
        const continued = continueFromOperatingContext({
          request: {
            contextId: incoming.contextId,
            objectiveType: incoming.objectiveType as never,
            target: incoming.target,
          },
          current: operatingContextStore.current(),
          recent: operatingContextStore.recent(),
          registry: installedAppsRef.current,
          sessions: operatingSessionsStore.load(),
          preferences: preferenceStore.load(),
          runtimeHints: runtimeHints(),
        });
        auditStore.append(
          continuityAuditEntry({
            origin: window.location.origin,
            decision: continued.status === "AVAILABLE" ? "continuation_started" : "continuation_unavailable",
            result: continued.status,
            objectiveType: incoming.objectiveType ?? "continue",
            targetAppId: continued.routes[0]?.appId ?? null,
            sessionId: continued.context?.sessionId ?? null,
          }),
        );
        postToOrigin(
          session.origin,
          continuityResultMessage({
            requestId: incoming.requestId,
            ok: continued.status === "AVAILABLE" || continued.status === "PERMISSION_REQUIRED",
            code:
              continued.status === "AVAILABLE" || continued.status === "PERMISSION_REQUIRED"
                ? undefined
                : continued.status.toLowerCase(),
            detail: continued.detail,
            status: continued.status,
            operatingContext: operatingContextPublicView(continued.context ?? null),
            routes: continued.routes.map((route) => ({
              objectiveType: route.objective.type,
              target: route.objective.target,
              label: route.objective.label,
              appId: route.appId,
              appName: route.appName,
              intent: route.intent,
              availability: route.availability,
              reason: route.reason,
              sessionId: route.sessionId,
              routePath: route.routePath,
            })),
          }),
        );
        if (
          (continued.status === "AVAILABLE" || continued.status === "PERMISSION_REQUIRED") &&
          continued.routes[0]
        ) {
          startObjectiveRoute(continued.routes[0]);
        }
        return;
      }

      const appId = registryAppIdForOrigin(session.origin);

      if (incoming.type === "capability.status" && incoming.capability && incoming.requestId) {
        const outcome = snapshotCapability({
          appClass: session.identity.effectiveClass,
          capability: incoming.capability,
          origin: session.origin,
          grants: grantsNow,
          decisions: decisionsRef.current,
          availability,
          appName: session.identity.name,
          ...mediationExtras(),
        });
        auditStore.append(
          capabilityAuditEntry({
            origin: session.origin,
            appId,
            capability: incoming.capability,
            request: "capability.status",
            decision: outcome.status === "granted" ? "grant" : outcome.status === "unavailable" ? "unavailable" : "blocked",
            result: outcome.reason ?? outcome.status,
            availability: availabilityCodeFor(incoming.capability),
          }),
        );
        postToOrigin(session.origin, capabilityStatusResultMessage(incoming.requestId, outcome));
        return;
      }

      if (incoming.type === "capability.discover" && incoming.requestId) {
        const capabilities = discoverCapabilities({
          appClass: session.identity.effectiveClass,
          origin: session.origin,
          grants: grantsNow,
          decisions: decisionsRef.current,
          availability,
        });
        postToOrigin(session.origin, capabilityDiscoverResultMessage(incoming.requestId, capabilities));
        return;
      }

      if (incoming.type === "capability.execution" && incoming.capability) {
        auditStore.append(
          capabilityAuditEntry({
            origin: session.origin,
            appId,
            capability: incoming.capability,
            request: "capability.execution",
            decision: "execution",
            result: incoming.executionResult ?? (incoming.executionStarted ? "started" : "reported"),
            availability: availabilityCodeFor(incoming.capability),
            executionStarted: incoming.executionStarted,
            executionResult: incoming.executionResult,
          }),
        );
        return;
      }

      if (incoming.type !== "capability.request" || !incoming.capability || !incoming.requestId) return;
      const capability = incoming.capability;
      const requestId = incoming.requestId;
      setSessions((current) =>
        current.map((item) =>
          item.origin === session.origin ? { ...item, requested: rememberRequest(item.requested, capability) } : item,
        ),
      );
      const mediated = mediateCapability({
        appClass: session.identity.effectiveClass,
        capability,
        origin: session.origin,
        grants: grantsNow,
        decisions: decisionsRef.current,
        availability,
        appName: session.identity.name,
        ...mediationExtras(),
      });
      if (mediated.status === "needs_permission") {
        const coalesced = coalesceCapabilityRequest(pendingRef.current, session.origin, mediated.capability, requestId);
        pendingRef.current = coalesced.pending;
        setPending(coalesced.pending);
        if (coalesced.duplicate) {
          auditStore.append(
            capabilityAuditEntry({
              origin: session.origin,
              appId,
              capability,
              decision: "duplicate",
              result: "coalesced",
              availability: availabilityCodeFor(capability),
            }),
          );
          if (!promptRef.current) setPrompt(nextPrompt(coalesced.pending));
          else if (promptRef.current.origin === session.origin && promptRef.current.capability === mediated.capability) {
            setPrompt(coalesced.item);
          }
          return;
        }
        setSessions((current) =>
          current.map((item) => (item.origin === session.origin ? { ...item, runtimeState: "permission_required" } : item)),
        );
        auditStore.append(
          capabilityAuditEntry({
            origin: session.origin,
            appId,
            capability,
            decision: "prompt",
            result: "REQUIRES_USER_ACTION",
            availability: availabilityCodeFor(capability),
          }),
        );
        if (!promptRef.current) {
          promptRef.current = coalesced.item;
          setPrompt(coalesced.item);
        }
        return;
      }
      auditStore.append(
        capabilityAuditEntry({
          origin: session.origin,
          appId,
          capability,
          decision: mediated.status === "class_a_blocked" || mediated.status === "denied" ? "blocked" : mediated.status === "unavailable" ? "unavailable" : "grant",
          result: mediated.reason ?? mediated.status,
          availability: availabilityCodeFor(capability),
        }),
      );
      if (mediated.status === "denied") {
        setSessions((current) =>
          current.map((item) => (item.origin === session.origin ? { ...item, runtimeState: "capability_denied" } : item)),
        );
      }
      postOutcome(session.origin, requestId, mediated);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function openHref(raw: string, preferEmbed: boolean, preferTopLevel = false) {
    setBusy(true);
    setError(null);
    try {
      const resolved = await resolveNavigation(raw, policy);
      if ("error" in resolved) {
        setError(resolved.error);
        return;
      }
      const decision = planLoad({
        href: resolved.href,
        origin: resolved.origin,
        preferEmbed,
        preferTopLevel,
        manifestEmbed: resolved.identity.embed,
        native: resolved.identity.effectiveClass === "native",
      });
      const session: ShellSession = {
        href: decision.href,
        origin: decision.origin,
        identity: resolved.identity,
        decision,
        embed: decision.mode === "embed" ? "probing" : "idle",
        requested: [...resolved.identity.requested],
        manifestError: resolved.manifestError,
        ...emptySessionFields(),
      };
      if (resolved.identity.effectiveClass === "web") {
        session.runtimeState = null;
      }
      if (decision.mode === "new_context") {
        const opened = openNewContext(decision.href);
        session.newContextOpened = opened;
        session.newContextBlocked = !opened;
      }
      if (decision.mode === "top_level") {
        window.location.assign(decision.href);
        return;
      }
      setSessions((current) => [...current.filter((item) => item.origin !== session.origin), session]);
      setFocusedOrigin(session.origin);
      setRecords((current) => {
        const opened = applyOpen(current, session.origin);
        return session.identity.effectiveClass === "web" ? applyReady(opened, session.origin) : opened;
      });
      setInput(session.href);
      const recent = toRecentApp({
        origin: session.origin,
        href: session.href,
        name: publicAppLabel(session.identity),
        class: session.identity.effectiveClass,
      });
      if (recent) {
        setRecents(recentsStore.remember(recent));
      }
      go({ surface: "app", origin: session.origin });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    applicationsStore.save(installedApps);
  }, [installedApps]);

  useEffect(() => {
    defaultHandlersStore.save(defaultHandlers);
  }, [defaultHandlers]);

  function registryAppIdForOrigin(origin: string): string | null {
    return findApplicationByOrigin(installedAppsRef.current, origin)?.appId ?? nativeAppForOrigin(origin)?.id ?? null;
  }

  function persistInstalled(next: OSShellApplicationRecord[]) {
    setInstalledApps(next);
    applicationsStore.save(next);
  }

  function openInstalledApp(appId: string, route = "/", options?: { skipResumePrompt?: boolean; forceFresh?: boolean }) {
    const app = findApplicationById(installedAppsRef.current, appId);
    if (!app) {
      setError(`application_not_installed: ${appId}`);
      return;
    }
    const compatibility = shellCompatibility({ minContractVersion: app.minContractVersion });
    if (!compatibility.supported) {
      setError(compatibility.reason ?? "application_incompatible");
      go({ surface: "app-detail", origin: null, appId });
      setDetailAppId(appId);
      return;
    }
    const current = operatingSessionsStore.current();
    const resumePoint = current?.resumePoints.find((item) => item.appId === appId);
    if (
      !options?.skipResumePrompt &&
      !options?.forceFresh &&
      app.resumeSupport?.supported &&
      resumePoint &&
      (resumePoint.route || resumePoint.label || resumePoint.context)
    ) {
      setPendingResume({
        appId,
        route: resumePoint.route || route || "/",
        label: resumePoint.label ?? resumePoint.context?.title ?? "Previous place",
      });
      return;
    }
    const href = new URL(route || "/", `${app.origin}/`).toString();
    if (current) {
      operatingSessionsStore.join(current.sessionId, appId);
      refreshOperatingSessions();
    }
    if (app.appId === "mybrandos" || app.appId === "lifeos") {
      launchNativeApp(app.appId);
      return;
    }
    void openHref(href, app.class !== "web");
  }

  async function probeAddManifest() {
    setAddError(null);
    setAddPreview(null);
    setBusy(true);
    try {
      const origin = originOf(addInput);
      if (!origin) {
        setAddError("origin_unverified");
        return;
      }
      const manifestUrl = new URL(WELL_KNOWN_MANIFEST_PATH, `${origin}/`).toString();
      const response = await fetch(manifestUrl, { credentials: "omit" });
      if (!response.ok) {
        setAddError("manifest_invalid");
        return;
      }
      const raw = await response.json();
      const validated = validateDeveloperManifest(raw, origin);
      if (!validated.ok) {
        setAddError(validated.code);
        return;
      }
      const identity = resolveAppIdentity({
        href: `${origin}/`,
        origin,
        manifest: developerManifestToWellKnown(validated.manifest),
        policy,
      });
      const trustState = resolveApplicationTrust({
        origin,
        appClass: identity.effectiveClass,
        manifestPresent: true,
      });
      const record = recordFromValidatedManifest({
        manifest: validated.manifest,
        source: "DEVELOPER",
        effectiveClass: identity.effectiveClass,
        trustState,
      });
      setAddPreview(record);
      installPreviewFromRecord(record);
    } catch {
      setAddError("manifest_invalid");
    } finally {
      setBusy(false);
    }
  }

  function confirmInstall() {
    if (!addPreview) return;
    const result = applicationsStore.install(installedApps, addPreview);
    if (!result.ok) {
      setAddError(result.code);
      return;
    }
    persistInstalled(result.list);
    setAddPreview(null);
    setDetailAppId(addPreview.appId);
    go({ surface: "app-detail", origin: null, appId: addPreview.appId });
  }

  function removeInstalled(appId: string) {
    const result = applicationsStore.remove(installedApps, appId);
    if (!result.removed) {
      setError("This application cannot be removed from the local registry.");
      return;
    }
    persistInstalled(result.list);
    setGrants(revokeGrant(grants, result.removed.origin));
    if (sessions.some((item) => item.origin === result.removed!.origin)) {
      closeApp(result.removed.origin);
    }
    const current = operatingSessionsStore.current();
    if (current?.participants.some((item) => item.appId === appId)) {
      operatingSessionsStore.leave(current.sessionId, appId);
      if (current.participants.length <= 1) operatingSessionsStore.end(current.sessionId);
      refreshOperatingSessions();
    }
    setDetailAppId(null);
    go({ surface: "apps", origin: null });
  }

  function checkForUpdate(appId: string) {
    const app = findApplicationById(installedApps, appId);
    if (!app) return;
    // DEVELOPMENT / SIMULATION ONLY — no update server in this phase.
    const simulated = withSimulatedUpdate(app, app.availableVersion ?? bumpPatch(app.version));
    persistInstalled(installedApps.map((item) => (item.appId === appId ? simulated : item)));
  }

  function bumpPatch(version: string): string {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return `${version}.1`;
    return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }

  function handleSessionApi(input: {
    type: "session.current" | "session.create" | "session.resume" | "session.end" | "session.join" | "session.leave";
    requestId: string;
    origin: string;
    appId: string;
    sessionId?: string;
    label?: string;
  }) {
    const reply = (result: {
      ok: boolean;
      code?: string;
      detail?: string;
      session?: ReturnType<typeof publicSessionView>;
    }) => {
      postToOrigin(
        input.origin,
        sessionResultMessage({
          requestId: input.requestId,
          ok: result.ok,
          code: result.code,
          detail: result.detail,
          session: result.session,
        }),
      );
    };

    if (input.type === "session.current") {
      const current = operatingSessionsStore.current();
      if (
        current &&
        !current.participants.some((item) => item.appId === input.appId) &&
        current.context.activeApplicationId !== input.appId
      ) {
        reply({ ok: true, session: null });
        return;
      }
      reply({ ok: true, session: publicSessionView(current) });
      return;
    }

    if (input.type === "session.create") {
      const created = operatingSessionsStore.create(input.label);
      const joined = operatingSessionsStore.join(created.sessionId, input.appId);
      refreshOperatingSessions();
      auditStore.append(
        sessionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "session_created",
          result: "ok",
          sessionId: created.sessionId,
        }),
      );
      reply({ ok: true, session: publicSessionView(joined.ok ? joined.value : created) });
      return;
    }

    if (input.type === "session.join") {
      if (!input.sessionId) {
        reply({ ok: false, code: "session_unknown", detail: "sessionId is required." });
        return;
      }
      const found = operatingSessionsStore.list().find((item) => item.sessionId === input.sessionId) ?? null;
      const auth = authorizeSessionParticipation({ session: found, appId: input.appId, sessionId: input.sessionId });
      if (!auth.ok) {
        reply({ ok: false, code: auth.code, detail: auth.detail });
        return;
      }
      const joined = operatingSessionsStore.join(input.sessionId, input.appId);
      refreshOperatingSessions();
      if (!joined.ok) {
        reply({ ok: false, code: joined.code, detail: joined.detail });
        return;
      }
      auditStore.append(
        sessionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "session_joined",
          result: "ok",
          sessionId: input.sessionId,
        }),
      );
      reply({ ok: true, session: publicSessionView(joined.value) });
      return;
    }

    if (input.type === "session.leave") {
      const sessionId = input.sessionId ?? operatingSessionsStore.current()?.sessionId;
      if (!sessionId) {
        reply({ ok: false, code: "session_unknown", detail: "No active session." });
        return;
      }
      const left = operatingSessionsStore.leave(sessionId, input.appId);
      refreshOperatingSessions();
      if (!left.ok) {
        reply({ ok: false, code: left.code, detail: left.detail });
        return;
      }
      auditStore.append(
        sessionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "session_left",
          result: "ok",
          sessionId,
        }),
      );
      reply({ ok: true, session: publicSessionView(left.value) });
      return;
    }

    if (input.type === "session.resume") {
      if (!input.sessionId) {
        reply({ ok: false, code: "session_unknown", detail: "sessionId is required." });
        return;
      }
      const resumed = operatingSessionsStore.resume(input.sessionId);
      refreshOperatingSessions();
      if (!resumed.ok) {
        reply({ ok: false, code: resumed.code, detail: resumed.detail });
        return;
      }
      auditStore.append(
        sessionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "session_resumed",
          result: "ok",
          sessionId: input.sessionId,
        }),
      );
      const point = resumed.value.resumePoint;
      if (point) {
        const target = findApplicationById(installedAppsRef.current, point.appId);
        if (target) {
          window.setTimeout(() => {
            postToOrigin(
              target.origin,
              sessionResumeMessage({
                sessionId: input.sessionId!,
                label: point.label ?? "Resume",
                route: point.route,
                context: point.context,
              }),
            );
          }, 350);
        }
      }
      reply({ ok: true, session: publicSessionView(resumed.value.session) });
      return;
    }

    if (input.type === "session.end") {
      const sessionId = input.sessionId ?? operatingSessionsStore.current()?.sessionId;
      if (!sessionId) {
        reply({ ok: false, code: "session_unknown", detail: "No active session." });
        return;
      }
      const ended = operatingSessionsStore.end(sessionId);
      refreshOperatingSessions();
      if (!ended.ok) {
        reply({ ok: false, code: ended.code, detail: ended.detail });
        return;
      }
      auditStore.append(
        sessionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "session_ended",
          result: "ok",
          sessionId,
        }),
      );
      reply({ ok: true, session: publicSessionView(ended.value) });
    }
  }

  function grantedByOrigin(): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const grant of grantsRef.current) {
      const list = map[grant.origin] ?? [];
      list.push(grant.capability);
      map[grant.origin] = list;
    }
    return map;
  }

  function handleActionApi(input: {
    type: "action.discover" | "action.request" | "context.current" | "context.select" | "action.result";
    requestId: string;
    origin: string;
    appId: string;
    action?: string;
    object?: Record<string, unknown>;
    targetAppId?: string;
    sessionId?: string;
    status?: string;
  }) {
    if (input.type === "context.current") {
      const object = selectedObjectStore.current() ?? operatingContextStore.current()?.objectReference ?? null;
      const op = operatingContextStore.current();
      postToOrigin(
        input.origin,
        contextCurrentResultMessage({
          requestId: input.requestId,
          ok: true,
          object,
          operatingContext: operatingContextPublicView(op),
        }),
      );
      return;
    }

    if (input.type === "context.select") {
      const selected = selectedObjectStore.select(input.object);
      if (!selected.ok) {
        postToOrigin(
          input.origin,
          contextCurrentResultMessage({
            requestId: input.requestId,
            ok: false,
            code: selected.code,
            detail: selected.detail,
          }),
        );
        return;
      }
      setSelectedObject(selected.object);
      const current = operatingSessionsStore.current();
      if (current) {
        operatingSessionsStore.setContext(current.sessionId, {
          context: selected.object,
          label: selected.object.title ?? current.context.label,
          appId: input.appId,
        });
        refreshOperatingSessions();
      }
      const existing = operatingContextStore.current();
      persistOperatingContext({
        id: existing?.id,
        sessionId: current?.sessionId ?? existing?.sessionId,
        currentAppId: input.appId,
        objectReference: selected.object,
        objectiveType: existing?.objectiveType,
        label: selected.object.title ?? existing?.label,
        suggestedNextObjectives: existing?.suggestedNextObjectives,
      });
      auditStore.append(
        actionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "object_selected",
          result: selected.object.type,
          contextType: selected.object.type,
          action: null,
        }),
      );
      postToOrigin(
        input.origin,
        contextCurrentResultMessage({
          requestId: input.requestId,
          ok: true,
          object: selected.object,
        }),
      );
      return;
    }

    if (input.type === "action.discover") {
      const discovered = discoverActions({
        object: input.object,
        registry: installedAppsRef.current,
        excludeAppId: input.appId,
        grantedCapabilitiesByOrigin: grantedByOrigin(),
        capabilityAvailability: {
          commerce: { available: availability["commerce.checkout"]?.bound !== false },
          identity: { available: availability["identity.authenticate"]?.bound !== false },
        },
      });
      if (!discovered.ok) {
        postToOrigin(
          input.origin,
          actionDiscoverResultMessage({
            requestId: input.requestId,
            ok: false,
            code: discovered.code,
            detail: discovered.detail,
          }),
        );
        return;
      }
      auditStore.append(
        actionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "action_discovered",
          result: `${discovered.actions.length}`,
          contextType: discovered.object.type,
        }),
      );
      postToOrigin(
        input.origin,
        actionDiscoverResultMessage({
          requestId: input.requestId,
          ok: true,
          actions: discovered.actions.map((item) => ({
            action: item.action.id,
            label: item.action.label,
            availability: item.availability,
            appId: item.handler.appId,
            name: item.handler.name,
            origin: item.handler.origin,
            route: item.handler.route,
            requiredCapability: item.requiredCapability ?? null,
          })),
        }),
      );
      return;
    }

    if (input.type === "action.result") {
      const status = input.status ?? "failed";
      auditStore.append(
        actionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision:
            status === "completed"
              ? "action_completed"
              : status === "cancelled"
                ? "action_cancelled"
                : "action_failed",
          result: status,
          action: input.action ?? null,
        }),
      );
      if (input.object) {
        const returned = selectedObjectStore.select(input.object);
        if (returned.ok) setSelectedObject(returned.object);
      }
      postToOrigin(
        input.origin,
        actionResultMessage({
          requestId: input.requestId,
          ok: true,
          status,
        }),
      );
      return;
    }

    if (input.type === "action.request") {
      const validated = validateActionRequest({
        sourceAppId: input.appId,
        payload: {
          action: input.action,
          requestId: input.requestId,
          targetAppId: input.targetAppId,
          object: input.object,
          sessionId: input.sessionId,
        },
      });
      if (!validated.ok) {
        auditStore.append(
          actionAuditEntry({
            origin: input.origin,
            appId: input.appId,
            decision: "action_failed",
            result: validated.code,
            action: input.action ?? null,
          }),
        );
        postToOrigin(
          input.origin,
          actionResultMessage({
            requestId: input.requestId,
            ok: false,
            code: validated.code,
            detail: validated.detail,
            status: "failed",
          }),
        );
        return;
      }
      selectedObjectStore.select(validated.object);
      setSelectedObject(validated.object);
      auditStore.append(
        actionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "action_requested",
          result: validated.action,
          action: validated.action,
          contextType: validated.object.type,
          targetAppId: validated.targetAppId ?? null,
          sessionId: validated.sessionId ?? null,
        }),
      );

      const defaultAppId = lookupDefaultHandler(defaultHandlers, validated.intent, validated.object.type);
      const discovered = discoverActions({
        object: validated.object,
        registry: installedAppsRef.current,
        excludeAppId: input.appId,
        grantedCapabilitiesByOrigin: grantedByOrigin(),
      });
      const matching = discovered.ok
        ? discovered.actions.filter((item) => item.action.id === validated.action && item.availability !== "INCOMPATIBLE")
        : [];

      let targetAppId = validated.targetAppId ?? defaultAppId ?? null;
      let route = "/";
      if (targetAppId) {
        const match = matching.find((item) => item.handler.appId === targetAppId);
        route = match?.handler.route ?? "/";
      } else if (matching.length === 1 && matching[0]) {
        targetAppId = matching[0].handler.appId;
        route = matching[0].handler.route;
      } else if (matching.length > 1) {
        setPendingIntent({
          request: {
            intent: validated.intent,
            sourceAppId: input.appId,
            context: validated.object,
            requestId: validated.requestId,
            sessionId: validated.sessionId,
          },
          sourceOrigin: input.origin,
          handlers: matching.map((item) => item.handler),
        });
        return;
      }

      if (!targetAppId) {
        postToOrigin(
          input.origin,
          actionResultMessage({
            requestId: input.requestId,
            ok: false,
            code: "no_handler",
            detail: "No compatible application available",
            status: "unavailable",
          }),
        );
        return;
      }

      completeIntent({
        request: {
          intent: validated.intent,
          sourceAppId: input.appId,
          targetAppId,
          context: validated.object,
          requestId: validated.requestId,
          sessionId: validated.sessionId,
        },
        sourceOrigin: input.origin,
        targetAppId,
        route,
      });
      setRecentActions(selectedObjectStore.rememberAction(OS_SHELL_ACTION_LABELS[validated.action]));
      auditStore.append(
        actionAuditEntry({
          origin: input.origin,
          appId: input.appId,
          decision: "action_started",
          result: targetAppId,
          action: validated.action,
          targetAppId,
          contextType: validated.object.type,
        }),
      );
      postToOrigin(
        input.origin,
        actionResultMessage({
          requestId: input.requestId,
          ok: true,
          targetAppId,
          route,
          status: "completed",
        }),
      );
    }
  }

  function runShellAction(actionId: OSShellActionId, appId: string, route: string) {
    if (!selectedObject) return;
    if (actionRequiresConfirmation(actionId)) {
      setConfirmAction({
        actionId,
        label: OS_SHELL_ACTION_LABELS[actionId],
        appId,
        route,
      });
      return;
    }
    dispatchShellAction(actionId, appId, route);
  }

  function dispatchShellAction(actionId: OSShellActionId, appId: string, route: string) {
    if (!selectedObject) return;
    const requestId = `action-ui-${Date.now().toString(36)}`;
    completeIntent({
      request: {
        intent: actionId,
        sourceAppId: selectedObject.originAppId ?? "shell",
        targetAppId: appId,
        context: selectedObject,
        requestId,
        sessionId: operatingSessionsStore.current()?.sessionId,
      },
      sourceOrigin: window.location.origin,
      targetAppId: appId,
      route,
    });
    setRecentActions(selectedObjectStore.rememberAction(OS_SHELL_ACTION_LABELS[actionId]));
    auditStore.append(
      actionAuditEntry({
        origin: window.location.origin,
        decision: "action_started",
        result: appId,
        action: actionId,
        targetAppId: appId,
        contextType: selectedObject.type,
      }),
    );
  }

  async function runShellSearch(rawQuery = searchQuery) {
    auditStore.append(
      searchAuditEntry({
        origin: window.location.origin,
        decision: "search_started",
        result: searchScope,
        searchScope,
      }),
    );

    const liveResults: OSShellSearchResult[] = [];
    const providerStatuses: Array<{ appId: string; state: OSShellSearchProviderState; detail?: string }> = [];
    const searchable = installedAppsRef.current.filter((app) => app.search?.supportedTypes?.length);
    const liveQueries = searchable
      .map((app) => {
        const session = sessionsRef.current.find(
          (item) => registryAppIdForOrigin(item.origin) === app.appId && framesRef.current[item.origin],
        );
        if (!session) return null;
        const requestId = `search-provider-${app.appId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return { app, session, requestId };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, SEARCH_LIMITS.maxProviders);

    await Promise.all(
      liveQueries.map(
        ({ app, session, requestId }) =>
          new Promise<void>((resolve) => {
            const timer = window.setTimeout(() => {
              pendingProviderSearchesRef.current.delete(requestId);
              providerStatuses.push({
                appId: app.appId,
                state: "SEARCH_UNAVAILABLE",
                detail: "provider_timeout",
              });
              auditStore.append(
                searchAuditEntry({
                  origin: window.location.origin,
                  appId: app.appId,
                  decision: "search_provider_timeout",
                  result: "timeout",
                  targetAppId: app.appId,
                }),
              );
              resolve();
            }, SEARCH_LIMITS.providerTimeoutMs);
            pendingProviderSearchesRef.current.set(requestId, {
              appId: app.appId,
              settle: ({ results, timedOut }) => {
                window.clearTimeout(timer);
                if (!timedOut) {
                  liveResults.push(...results);
                  providerStatuses.push({ appId: app.appId, state: "SEARCH_AVAILABLE" });
                }
                resolve();
              },
            });
            postToOrigin(
              session.origin,
              searchProviderQueryMessage({
                requestId,
                query: rawQuery,
                limit: SEARCH_LIMITS.maxPerProvider,
              }),
            );
          }),
      ),
    );

    const executed = executeShellSearch({
      query: { query: rawQuery, scope: searchScope, limit: SEARCH_LIMITS.maxResults },
      registry: installedAppsRef.current,
      sessions: operatingSessionsStore.list(),
      selectedObject: selectedObjectStore.current(),
      searchContext: {
        currentApplication: activeOperating?.context.activeApplicationId,
        currentObjectType: selectedObjectStore.current()?.type,
        currentSessionId: activeOperating?.sessionId,
      },
      liveProviderResults: liveResults,
      providerStatuses,
    });
    if (!executed.ok) {
      setError(executed.code);
      setSearchResults([]);
      return;
    }
    setSearchResults(executed.results);
    setSearchProviders(executed.providers.map((item) => ({ appId: item.appId, state: item.state })));
    if (rawQuery.trim()) setSearchHistory(searchHistoryStore.remember(rawQuery.trim()));
    auditStore.append(
      searchAuditEntry({
        origin: window.location.origin,
        decision: "search_completed",
        result: `${executed.results.length}`,
        searchScope,
        resultCount: executed.results.length,
      }),
    );
    for (const provider of executed.providers) {
      if (provider.state === "SEARCH_UNAVAILABLE") {
        auditStore.append(
          searchAuditEntry({
            origin: window.location.origin,
            appId: provider.appId,
            decision: "search_provider_unavailable",
            result: provider.state,
            targetAppId: provider.appId,
          }),
        );
      }
    }
  }

  function selectSearchResult(result: OSShellSearchResult) {
    setSelectedSearchResult(result);
    auditStore.append(
      searchAuditEntry({
        origin: window.location.origin,
        decision: "search_result_selected",
        result: result.type,
        targetAppId: result.appId ?? null,
      }),
    );
    if (result.type === "object" && result.context) {
      const selected = selectedObjectStore.select(result.context);
      if (selected.ok) setSelectedObject(selected.object);
    }
    if (result.type === "objective" && result.title) {
      setLauncherQuery(result.title);
      go({ surface: "launcher", origin: null });
      void resolveLauncherObjective(result.title);
    }
  }

  function persistPreferences(list: OSShellApplicationPreference[]) {
    preferenceStore.save(list);
    setApplicationPreferences(list);
  }

  function runtimeHints() {
    const grantedCapabilitiesByOrigin: Record<string, string[]> = {};
    for (const grant of grants) {
      const list = grantedCapabilitiesByOrigin[grant.origin] ?? [];
      if (grant.capability && !list.includes(grant.capability)) list.push(grant.capability);
      grantedCapabilitiesByOrigin[grant.origin] = list;
    }
    return {
      softwareRuntime: softwareRuntimeAvailable,
      grantedCapabilitiesByOrigin,
    };
  }

  function resolveLauncherObjective(raw = launcherQuery) {
    const op = operatingContextStore.current();
    const selected =
      selectedObjectStore.current() ??
      op?.objectReference ??
      null;
    const personal = buildPersonalContext(op);
    setPersonalContext(personal);
    const contextual = resolveContextualObjective({
      text: raw,
      personal,
      recent: operatingContextStore.recent(),
    });
    if (contextual.ok && "ambiguous" in contextual && contextual.ambiguous) {
      setAmbiguityChoices(contextual.candidates);
      setError(null);
      setObjectiveRoutes([]);
      setSelectedObjectiveRoute(null);
      go({ surface: "home", origin: null });
      return;
    }
    if (contextual.ok && "kind" in contextual && contextual.kind === "inspect") {
      setAmbiguityChoices([]);
      setError(null);
      if (contextual.label === "What can I do with this?") {
        setObjectiveRoutes([]);
        go({ surface: "home", origin: null });
        setPersonalContext(personal);
        return;
      }
      go({ surface: "recent-work", origin: null });
      return;
    }
    if (!contextual.ok && contextual.code === "no_current_work") {
      setError(contextual.code);
      setAmbiguityChoices([]);
      setObjectiveRoutes([]);
      return;
    }
    const textForResolve =
      contextual.ok && "objective" in contextual
        ? contextual.objective.label ?? raw
        : raw;
    const resolved = resolveObjectiveFromText({
      text: textForResolve,
      registry: installedAppsRef.current,
      selectedObject:
        contextual.ok && "objective" in contextual && contextual.objective.context
          ? contextual.objective.context
          : selected,
      sessions: operatingSessionsStore.list(),
      runtimeHints: runtimeHints(),
      preferences: preferenceStore.load(),
      operatingContext: op,
    });
    if (!resolved.ok) {
      setError(resolved.code);
      setObjectiveRoutes([]);
      setSelectedObjectiveRoute(null);
      return;
    }
    setAmbiguityChoices([]);
    setError(null);
    setObjectiveRoutes(resolved.routes);
    setSelectedObjectiveRoute(resolved.routes[0] ?? null);
    if (raw.trim()) setObjectiveHistory(objectiveHistoryStore.remember(objectiveLabel(resolved.objective)));
    auditStore.append(
      objectiveAuditEntry({
        origin: window.location.origin,
        decision: "objective_discovered",
        result: `${resolved.routes.length}`,
        objectiveType: resolved.objective.type,
      }),
    );
  }

  function alwaysUseRoute(route: OSShellObjectiveRoute) {
    const next = setApplicationPreference(preferenceStore.load(), {
      appId: route.appId,
      objectiveType: route.objective.type,
      objectType: route.objective.target,
      intentType: route.intent,
      preference: "preferred",
      source: "EXPLICIT",
      updatedAt: new Date().toISOString(),
    });
    persistPreferences(next);
    auditStore.append(
      preferenceAuditEntry({
        origin: window.location.origin,
        decision: "preference_set",
        result: "explicit",
        objectiveType: route.objective.type,
        targetAppId: route.appId,
      }),
    );
    resolveLauncherObjective(
      route.objective.label ?? `${route.objective.type} ${route.objective.target ?? ""}`.trim(),
    );
  }

  function startObjectiveRoute(route: OSShellObjectiveRoute) {
    setSelectedObjectiveRoute(route);
    if (route.availability === "CONTEXT_REQUIRED") {
      go({ surface: "search", origin: null });
      setSearchScope("objects");
      return;
    }
    if (route.availability === "UNAVAILABLE" || route.availability === "INCOMPATIBLE" || route.availability === "NOT_CONNECTED") {
      setError(route.reason ?? "objective_unavailable");
      auditStore.append(
        objectiveAuditEntry({
          origin: window.location.origin,
          decision: "objective_unavailable",
          result: route.reason ?? route.availability,
          objectiveType: route.objective.type,
          targetAppId: route.appId,
          availability: route.availability,
        }),
      );
      return;
    }
    if (route.objective.type === "continue") {
      const op = operatingContextStore.current();
      const revalidated = revalidateOperatingContext({
        context: op,
        registry: installedAppsRef.current,
        sessions: operatingSessionsStore.load(),
      });
      if (revalidated.status === "NO_CURRENT_WORK" && !route.sessionId) {
        setError("no_current_work");
        return;
      }
      if (revalidated.status === "SESSION_ENDED") {
        setError("session_ended");
        return;
      }
      if (revalidated.status === "APPLICATION_UNAVAILABLE") {
        setError("application_unavailable");
        setObjectiveRoutes(
          continueFromOperatingContext({
            current: op,
            registry: installedAppsRef.current,
            sessions: operatingSessionsStore.load(),
            preferences: preferenceStore.load(),
            runtimeHints: runtimeHints(),
          }).routes,
        );
        return;
      }
      if (route.sessionId) {
        const resumed = operatingSessionsStore.resume(route.sessionId);
        refreshOperatingSessions();
        if (!resumed.ok) {
          setError(resumed.code ?? "resume_unavailable");
          return;
        }
      }
      if (op) persistOperatingContext({ ...op, currentAppId: route.appId, sessionId: route.sessionId ?? op.sessionId });
      auditStore.append(
        objectiveAuditEntry({
          origin: window.location.origin,
          decision: "objective_started",
          result: "continue",
          objectiveType: "continue",
          targetAppId: route.appId,
          sessionId: route.sessionId,
        }),
      );
      openInstalledApp(route.appId, route.routePath ?? op?.returnPath ?? "/", { skipResumePrompt: true });
      return;
    }

    const context =
      route.objective.context ??
      selectedObjectStore.current() ??
      operatingContextStore.current()?.objectReference ??
      contextStubForTarget(route.objective.target);
    if (!context || !route.intent) {
      setError("context_required");
      go({ surface: "search", origin: null });
      return;
    }
    const stamped = {
      ...context,
      title: context.title ?? objectiveLabel(route.objective),
      originAppId: context.originAppId ?? route.appId,
      lifetime: context.lifetime ?? ("EPHEMERAL" as const),
    };
    selectedObjectStore.select(stamped);
    setSelectedObject(stamped);
    const created = createOperatingContext({
      currentAppId: route.appId,
      objectiveType: route.objective.type,
      objectReference: stamped,
      intentReference: route.intent,
      actionReference: route.action,
      sessionId: operatingSessionsStore.current()?.sessionId,
      label: stamped.title ?? objectiveLabel(route.objective),
      returnPath: route.routePath,
      suggestedNextObjectives:
        route.objective.type === "create" || route.objective.type === "edit"
          ? [
              { type: "preview", target: "this", label: "Preview" },
              { type: "edit", target: "this", label: "Edit" },
              { type: "share", target: "this", label: "Share" },
              { type: "publish", target: "this", label: "Publish" },
            ]
          : undefined,
    });
    if (created.ok) persistOperatingContext(created.context);
    persistPreferences(
      rememberRecentSuccess(preferenceStore.load(), {
        appId: route.appId,
        objectiveType: route.objective.type,
        objectType: route.objective.target,
        intentType: route.intent,
      }),
    );
    auditStore.append(
      objectiveAuditEntry({
        origin: window.location.origin,
        decision: "objective_started",
        result: route.appId,
        objectiveType: route.objective.type,
        targetAppId: route.appId,
        intent: route.intent,
        availability: route.availability,
      }),
    );
    completeIntent({
      request: {
        intent: route.intent,
        sourceAppId: "shell",
        targetAppId: route.appId,
        context: stamped,
        requestId: `objective-${Date.now()}`,
        sessionId: operatingSessionsStore.current()?.sessionId,
      },
      sourceOrigin: window.location.origin,
      targetAppId: route.appId,
      route: route.routePath ?? "/",
    });
  }

  function completeIntent(input: {
    request: OSShellIntentRequest;
    sourceOrigin: string;
    targetAppId: string;
    route: string;
    rememberDefault?: boolean;
  }) {
    const sessionRecord = operatingSessionsStore.recordIntent({
      sessionId: input.request.sessionId ?? operatingSessionsStore.current()?.sessionId,
      sourceAppId: input.request.sourceAppId,
      targetAppId: input.targetAppId,
      intent: input.request.intent,
      context: input.request.context,
      label: input.request.context.title ?? `${input.request.intent} · ${input.request.context.type}`,
    });
    refreshOperatingSessions();
    const continuitySessionId = sessionRecord.ok ? sessionRecord.value.sessionId : input.request.sessionId;

    const handoff = intentToHandoffPayload({
      targetAppId: input.targetAppId,
      route: input.route,
      intent: input.request.intent,
      context: input.request.context,
      sourceAppId: input.request.sourceAppId,
      sessionId: continuitySessionId,
    });
    if (input.rememberDefault) {
      setDefaultHandlers((current) =>
        setDefaultHandler(current, {
          intent: input.request.intent,
          contextType: input.request.context.type,
          appId: input.targetAppId,
        }),
      );
    }
    auditStore.append(
      intentAuditEntry({
        origin: input.sourceOrigin,
        appId: input.request.sourceAppId,
        decision: "intent_started",
        result: input.targetAppId,
        intent: input.request.intent,
        contextType: input.request.context.type,
        targetAppId: input.targetAppId,
        sessionId: continuitySessionId ?? null,
      }),
    );
    auditStore.append(
      intentAuditEntry({
        origin: input.sourceOrigin,
        appId: input.request.sourceAppId,
        decision: "handler_selected",
        result: input.targetAppId,
        intent: input.request.intent,
        contextType: input.request.context.type,
        targetAppId: input.targetAppId,
        sessionId: continuitySessionId ?? null,
      }),
    );
    auditStore.append(
      intentAuditEntry({
        origin: input.sourceOrigin,
        appId: input.request.sourceAppId,
        decision: "handoff_started",
        result: "ok",
        intent: input.request.intent,
        contextType: input.request.context.type,
        targetAppId: input.targetAppId,
        sessionId: continuitySessionId ?? null,
      }),
    );
    postToOrigin(
      input.sourceOrigin,
      intentResultMessage({
        requestId: input.request.requestId,
        ok: true,
        targetAppId: input.targetAppId,
        route: input.route,
        detail: "Intent routed. Context is a reference, not authorization.",
      }),
    );
    openInstalledApp(input.targetAppId, handoff.route, { skipResumePrompt: true });
    window.setTimeout(() => {
      const target = findApplicationById(installedAppsRef.current, input.targetAppId);
      if (!target) return;
      postToOrigin(
        target.origin,
        intentDeliverMessage({
          requestId: input.request.requestId,
          intent: input.request.intent,
          sourceAppId: input.request.sourceAppId,
          context: input.request.context,
          sessionId: continuitySessionId,
        }),
      );
      auditStore.append(
        intentAuditEntry({
          origin: input.sourceOrigin,
          appId: input.request.sourceAppId,
          decision: "intent_completed",
          result: "delivered",
          intent: input.request.intent,
          contextType: input.request.context.type,
          targetAppId: input.targetAppId,
          sessionId: continuitySessionId ?? null,
        }),
      );
      auditStore.append(
        intentAuditEntry({
          origin: input.sourceOrigin,
          appId: input.request.sourceAppId,
          decision: "handoff_completed",
          result: "delivered",
          intent: input.request.intent,
          contextType: input.request.context.type,
          targetAppId: input.targetAppId,
          sessionId: continuitySessionId ?? null,
        }),
      );
    }, 350);
    setPendingIntent(null);
  }

  async function launchNativeApp(id: "mybrandos" | "lifeos") {
    // On Android APK: prefer launching the installed first-party package.
    if (isNativeShell()) {
      const native = await openFirstPartyAndroidApp(id);
      if (native.ok) {
        setError(null);
        return;
      }
      if (native.reason === "not_installed") {
        setError(`${id === "lifeos" ? "LifeOS" : "mybrandOS"} is not installed on this device. Opening the web app instead.`);
      }
    }
    const launch = nativeLaunch(id, policy);
    if ("error" in launch) {
      setError(launch.error);
      return;
    }
    void openHref(launch.href, true);
  }

  function activate(origin: string) {
    const session = sessions.find((item) => item.origin === origin);
    if (session) setInput(session.href);
    setFocusedOrigin(origin);
    setRecords((current) => applyActivate(current, origin));
    go({ surface: "app", origin });
  }

  function cancelOriginRequests(origin: string, result: string) {
    const cancelled = cancelPendingForOrigin(pendingRef.current, origin);
    pendingRef.current = cancelled.pending;
    setPending(cancelled.pending);
    for (const item of cancelled.cancelled) {
      for (const requestId of item.requestIds) {
        postOutcome(
          origin,
          requestId,
          outcomeOf({
            capability: item.capability,
            status: "denied",
            reason: "application_disconnected",
            detail: "The application disconnected. The pending request was cancelled and was not granted.",
          }),
        );
      }
      auditStore.append(
        capabilityAuditEntry({
          origin,
          appId: nativeAppForOrigin(origin)?.id ?? null,
          capability: item.capability,
          decision: "cancelled",
          result,
        }),
      );
    }
    if (promptRef.current?.origin === origin) {
      const next = nextPrompt(cancelled.pending);
      promptRef.current = next;
      setPrompt(next);
    }
  }

  function closeApp(origin: string) {
    cancelOriginRequests(origin, "application_disconnected");
    const nextRecords = applyClose(records, origin);
    const nextActive = nextRecords.find((item) => item.lifecycle === "ACTIVE" || item.lifecycle === "OPEN")?.origin ?? null;
    setSessions((current) => current.filter((item) => item.origin !== origin));
    setRecords(nextRecords);
    delete framesRef.current[origin];
    if (focusedOrigin === origin) setFocusedOrigin(nextActive);
    if (nextActive) go({ surface: "app", origin: nextActive });
    else go({ surface: "home", origin: null });
  }

  function reload() {
    if (place.surface === "app" && active) {
      const frame = framesRef.current[active.origin];
      if (frame && active.decision.mode === "embed" && active.embed !== "frame_blocked") {
        frame.src = active.href;
        setSessions((current) =>
          current.map((item) =>
            item.origin === active.origin
              ? { ...item, handshake: false, runtimeState: item.identity.effectiveClass === "web" ? null : "application_loading" }
              : item,
          ),
        );
        if (active.identity.effectiveClass !== "web") setRecords((current) => applyOpen(current, active.origin));
        return;
      }
      void openHref(active.href, active.decision.mode === "embed");
    }
  }

  function decidePrompt(allow: boolean) {
    if (!prompt) return;
    const session = sessions.find((item) => item.origin === prompt.origin);
    const taken = takePendingRequest(pendingRef.current, prompt.origin, prompt.capability);
    pendingRef.current = taken.pending;
    setPending(taken.pending);
    const requestIds = taken.requestIds.length ? taken.requestIds : prompt.requestIds;
    const appId = nativeAppForOrigin(prompt.origin)?.id ?? null;
    if (!session) {
      cancelOriginRequests(prompt.origin, "application_disconnected");
      promptRef.current = nextPrompt(pendingRef.current);
      setPrompt(promptRef.current);
      return;
    }
    if (allow) {
      const nextGrants = [...grants, createGrant({ origin: prompt.origin, capability: prompt.capability })];
      const cleared = decisions.filter((item) => !(item.origin === prompt.origin && item.capability === prompt.capability));
      setGrants(nextGrants);
      setDecisions(cleared);
      const outcome = mediateCapability({
        appClass: session.identity.effectiveClass,
        capability: prompt.capability,
        origin: prompt.origin,
        grants: nextGrants,
        decisions: cleared,
        availability,
        grantedThisRequest: true,
        appName: session.identity.name,
        ...mediationExtras(),
      });
      auditStore.append(
        capabilityAuditEntry({
          origin: prompt.origin,
          appId,
          capability: prompt.capability,
          decision: "grant",
          result: outcome.status === "needs_permission" ? "prompt" : (outcome.reason ?? outcome.status),
          availability: availabilityCodeFor(prompt.capability),
        }),
      );
      if (outcome.status !== "needs_permission") {
        for (const requestId of requestIds) postOutcome(prompt.origin, requestId, outcome);
      }
      setSessions((current) =>
        current.map((item) =>
          item.origin === prompt.origin ? { ...item, runtimeState: item.handshake ? "application_ready" : item.runtimeState } : item,
        ),
      );
    } else {
      const denied = upsertDecision(decisions, {
        origin: prompt.origin,
        capability: prompt.capability,
        state: "DENIED",
        at: new Date().toISOString(),
      });
      setDecisions(denied);
      const outcome = outcomeOf({
        capability: prompt.capability,
        status: "denied",
        reason: "capability_denied",
        detail: "The user denied this capability for this application.",
      });
      auditStore.append(
        capabilityAuditEntry({
          origin: prompt.origin,
          appId,
          capability: prompt.capability,
          decision: "deny",
          result: "capability_denied",
          availability: availabilityCodeFor(prompt.capability),
        }),
      );
      for (const requestId of requestIds) postOutcome(prompt.origin, requestId, outcome);
      setSessions((current) =>
        current.map((item) => (item.origin === prompt.origin ? { ...item, runtimeState: "capability_denied" } : item)),
      );
    }
    const next = nextPrompt(taken.pending);
    promptRef.current = next;
    setPrompt(next);
  }

  const capabilityRows = active
    ? capabilityStatusSurface({
        appClass: active.identity.effectiveClass,
        origin: active.origin,
        requested: active.requested,
        grants,
        availability,
      })
    : [];

  const kindLabel = active && appKindFromClass(active.identity.effectiveClass) === "application" ? "Application" : "URL";
  const showingApp = surface === "app" && active;
  const showFallback = Boolean(
    showingApp && (active.decision.mode !== "embed" || active.embed === "frame_blocked"),
  );

  return (
    <div className="shell">
      {!networkOnline ? (
        <div className="network-banner" role="status">
          Offline — Shell available locally; application availability may be unknown.
        </div>
      ) : null}
      <header className="chrome">
        <div className="nav-row">
          <button className="icon-btn" type="button" aria-label="Back" disabled={!canBack} onClick={back}>
            ←
          </button>
          <button className="icon-btn" type="button" aria-label="Forward" disabled={placeIndex >= places.length - 1} onClick={forward}>
            →
          </button>
          <button className="icon-btn" type="button" aria-label="Reload" onClick={reload}>
            ⟳
          </button>
          <div className="address-wrap">
            <div className="kind">{kindLabel}</div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void openHref(input, false);
              }}
            >
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="https://example.com"
                aria-label="Application or URL"
              />
            </form>
          </div>
          <button className="btn primary" type="button" disabled={busy} onClick={() => void openHref(input, false)}>
            Load
          </button>
          <button className="btn embed" type="button" disabled={busy} onClick={() => void openHref(input, true)}>
            Embed
          </button>
          <button className="icon-btn" type="button" aria-label="More" onClick={() => setMenuOpen((value) => !value)}>
            ⋯
          </button>
        </div>
        {showingApp ? (
          <div className="identity">
            <span>
              <b>{active.title || publicAppLabel(active.identity)}</b>
            </span>
            <span>
              Class <b>{active.identity.effectiveClass}</b>
            </span>
            <span>
              {kindLabel} <b>{active.origin}</b>
            </span>
            {active.identity.version ? (
              <span>
                Version <b>{active.identity.version}</b>
              </span>
            ) : null}
            <span>
              State <b>{lifecycleFor(records, active.origin)}</b>
            </span>
            {active.runtimeState ? (
              <span>
                Runtime <b>{active.runtimeState}</b>
              </span>
            ) : null}
            {active.path ? (
              <span>
                Path <b>{active.path}</b>
              </span>
            ) : null}
            <span>
              Capabilities{" "}
              <b>
                {active.identity.effectiveClass === "web"
                  ? "No Digiconomy capabilities"
                  : capabilityRows.find((row) => row.state === "unavailable")?.code ?? "Mediated"}
              </b>
            </span>
          </div>
        ) : (
          <div className="identity">
            <span>
              OS Shell <b>{OSSHELL_VERSION}</b>
            </span>
            <span>Not a primitive</span>
          </div>
        )}
        {menuOpen ? (
          <div className="menu">
            {active ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const item = {
                      origin: active.origin,
                      name: active.identity.name,
                      class: active.identity.effectiveClass,
                      kind: appKindFromClass(active.identity.effectiveClass),
                    };
                    const next = toggleFavorite(favorites, item);
                    favoritesStore.save(next);
                    setFavorites(next);
                    setMenuOpen(false);
                  }}
                >
                  {isFavorite(favorites, active.origin) ? "Unpin" : "Pin"}
                </button>
                <button type="button" onClick={() => closeApp(active.origin)}>
                  Close
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => go({ surface: "user", origin: null })}>
              Permissions
            </button>
          </div>
        ) : null}
      </header>

      <main className="stage">
        {surface === "home" ? (
          <HomeSurface
            recents={recents}
            favorites={favorites}
            natives={natives.filter((app) => app.id === "lifeos" || app.id === "mybrandos")}
            input={input}
            busy={busy}
            error={error}
            onInput={setInput}
            onLoad={() => void openHref(input, false)}
            onOpenRecent={(item) => void openHref(item.href || item.origin, item.class !== "web")}
            onLaunchNative={(id) => void launchNativeApp(id)}
            onDigitalLife={() => go({ surface: "digitallife", origin: null })}
            appSearch={appSearch}
            onAppSearch={setAppSearch}
          />
        ) : null}
        {surface === "recent-work" ? (
          <div className="panel">
            <div className="eyebrow">Continuity</div>
            <h1>Recent Work</h1>
            <p>Reference-only place memory. Applications own the work. Continuity always revalidates.</p>
            <div className="list">
              {(recentContinuity.length ? recentContinuity : operatingContext ? [operatingContext] : []).map((item) => {
                const status = revalidateOperatingContext({
                  context: item,
                  registry: installedApps,
                  sessions: operatingSessions,
                }).status;
                const appName = item.currentAppId
                  ? findApplicationById(installedApps, item.currentAppId)?.name
                  : item.currentAppId;
                return (
                  <div key={item.id} className="note" style={{ marginBottom: 8 }}>
                    <div>{item.label ?? item.objectReference?.title ?? "Work"}</div>
                    <div className="muted">
                      {appName ?? "Application"}
                      {item.objectReference?.type ? ` · ${item.objectReference.type}` : ""}
                      {` · ${status}`}
                    </div>
                    <div className="actions" style={{ marginTop: 8 }}>
                      {status === "AVAILABLE" ? (
                        <>
                          <button
                            className="btn primary"
                            type="button"
                            onClick={() => {
                              operatingContextStore.open(item.id);
                              refreshOperatingContext();
                              setLauncherQuery("Continue");
                              go({ surface: "launcher", origin: null });
                              resolveLauncherObjective("Continue");
                            }}
                          >
                            Continue
                          </button>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              if (item.currentAppId) openInstalledApp(item.currentAppId, item.returnPath ?? "/");
                            }}
                          >
                            Open
                          </button>
                        </>
                      ) : (
                        <span className="muted">Unavailable — not executable</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {!recentContinuity.length && !operatingContext ? (
              <div className="muted">No recent work yet. Start an objective from Do.</div>
            ) : null}
            <div className="actions" style={{ marginTop: 12 }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  operatingContextStore.clearAll();
                  refreshOperatingContext(null);
                }}
              >
                Clear continuity
              </button>
            </div>
          </div>
        ) : null}
        {surface === "apps" ? (
          <ApplicationsLauncher
            installed={installedApps}
            available={availableCatalogEntries(installedApps)}
            sessions={sessions}
            recents={recents}
            favorites={favorites}
            updates={installedApps.filter((app) => updateInfoFor(app).status === "update_available")}
            onOpenApp={(appId) => openInstalledApp(appId)}
            onDetail={(appId) => {
              setDetailAppId(appId);
              go({ surface: "app-detail", origin: null, appId });
            }}
            onAdd={() => {
              setAddError(null);
              setAddPreview(null);
              go({ surface: "add-app", origin: null });
            }}
            onOpenRecent={(item) => void openHref(item.href || item.origin, item.class !== "web")}
          />
        ) : null}
        {surface === "app-detail" && detailAppId && findApplicationById(installedApps, detailAppId) ? (
          <ApplicationDetailSurface
            app={findApplicationById(installedApps, detailAppId)!}
            permissionRows={(() => {
              const app = findApplicationById(installedApps, detailAppId)!;
              const discovery = discoverCapabilities({
                appClass: app.class,
                origin: app.origin,
                grants,
                decisions,
                availability,
              });
              return app.requestedCapabilities.map((id) => {
                const row = discovery.find((item) => item.id === id);
                return {
                  id,
                  label: id,
                  state: row ? `${row.status}${row.status === "permission_required" ? " / Not Granted" : ""}` : "unknown",
                };
              });
            })()}
            compatibilitySupported={shellCompatibility({ minContractVersion: findApplicationById(installedApps, detailAppId)!.minContractVersion }).supported}
            compatibilityDetail={`protocol ${OSSHELL_VERSION} / contract ${shellCompatibility().contractVersion}`}
            onOpen={() => openInstalledApp(detailAppId)}
            onPermissions={() => go({ surface: "user", origin: null })}
            onRemove={findApplicationById(installedApps, detailAppId)!.removable ? () => removeInstalled(detailAppId) : null}
            onCheckUpdate={() => checkForUpdate(detailAppId)}
            updateLabel={updateInfoFor(findApplicationById(installedApps, detailAppId)!).status === "update_available" ? "Apply simulated update" : "Check for update"}
          />
        ) : null}
        {surface === "app-detail" && detailAppId && !findApplicationById(installedApps, detailAppId) ? (
          <div className="panel">
            <h1>Application not installed</h1>
            <p className="muted">This application is no longer in the local registry.</p>
            <button className="btn" type="button" onClick={() => go({ surface: "apps", origin: null })}>
              Back to Applications
            </button>
          </div>
        ) : null}
        {surface === "add-app" ? (
          <AddApplicationSurface
            input={addInput}
            busy={busy}
            error={addError}
            preview={
              addPreview
                ? {
                    name: addPreview.name,
                    origin: addPreview.origin,
                    version: addPreview.version,
                    trustState: addPreview.trustState,
                    source: addPreview.source,
                    requestedCapabilities: [...addPreview.requestedCapabilities],
                  }
                : null
            }
            onInput={setAddInput}
            onProbe={() => void probeAddManifest()}
            onInstall={confirmInstall}
            onCancel={() => go({ surface: "apps", origin: null })}
          />
        ) : null}
        {showFallback && active ? (
          <AppFallback
            session={active}
            error={error}
            capabilityRows={capabilityRows}
            onOpenContext={() => {
              const opened = openNewContext(active.href);
              setSessions((current) =>
                current.map((item) =>
                  item.origin === active.origin ? { ...item, newContextOpened: opened, newContextBlocked: !opened } : item,
                ),
              );
            }}
          />
        ) : null}
        <FrameHost
          sessions={sessions}
          activeOrigin={activeOrigin}
          visible={Boolean(showingApp && !showFallback)}
          onFrameRef={(origin, node) => {
            framesRef.current[origin] = node;
          }}
          onFrameLoad={(origin) => {
            const frame = framesRef.current[origin];
            if (!frame) return;
            const state = probeEmbedState(frame);
            setSessions((current) =>
              current.map((item) => (item.origin === origin ? { ...item, embed: state } : item)),
            );
          }}
          onFrameError={(origin) => {
            setSessions((current) =>
              current.map((item) =>
                item.origin === origin
                  ? { ...item, embed: "frame_blocked", runtimeState: "application_disconnected", handshake: false }
                  : item,
              ),
            );
            setRecords((current) => applyDisconnect(current, origin));
            cancelOriginRequests(origin, "application_disconnected");
          }}
        />
        {surface === "app" && !active ? (
          <div className="panel">
            <h1>No active application</h1>
            <p>Open an app from Home or Apps.</p>
          </div>
        ) : null}
        {surface === "digitallife" ? (
          <DigitalLifePane onLaunch={(id) => void launchNativeApp(id)} activeName={focused?.identity.name ?? null} />
        ) : null}
        {surface === "devices" ? <DevicesPane onLaunch={() => void launchNativeApp("mybrandos")} /> : null}
        {surface === "session" ? (
          <SessionSurface
            current={
              activeOperating
                ? {
                    label: activeOperating.context.label ?? "Untitled session",
                    state: activeOperating.state,
                    activeAppName: activeOperating.context.activeApplicationId
                      ? findApplicationById(installedApps, activeOperating.context.activeApplicationId)?.name
                      : undefined,
                    contextType: activeOperating.context.activeContext?.type,
                    contextTitle: activeOperating.context.activeContext?.title,
                    workflow: activeOperating.participants.map(
                      (item) => findApplicationById(installedApps, item.appId)?.name ?? item.appId,
                    ),
                  }
                : null
            }
            sessions={operatingSessions
              .filter((item) => item.state !== "ENDED")
              .map((item) => ({
                sessionId: item.sessionId,
                label: item.context.label ?? "Untitled session",
                state: item.state,
                active: item.state === "ACTIVE",
              }))}
            pinnedLabel={activeOperating?.context.activeContext?.title ?? null}
            onCreate={() => {
              operatingSessionsStore.create("New workflow");
              refreshOperatingSessions();
              auditStore.append(
                sessionAuditEntry({
                  origin: window.location.origin,
                  decision: "session_created",
                  result: "ui",
                  sessionId: operatingSessionsStore.current()?.sessionId ?? null,
                }),
              );
            }}
            onSwitch={(sessionId) => {
              const switched = operatingSessionsStore.switchTo(sessionId);
              refreshOperatingSessions();
              if (switched.ok) {
                auditStore.append(
                  sessionAuditEntry({
                    origin: window.location.origin,
                    decision: "session_switched",
                    result: "ok",
                    sessionId,
                  }),
                );
              }
            }}
            onEnd={() => {
              const current = operatingSessionsStore.current();
              if (!current) return;
              operatingSessionsStore.end(current.sessionId);
              refreshOperatingSessions();
              auditStore.append(
                sessionAuditEntry({
                  origin: window.location.origin,
                  decision: "session_ended",
                  result: "ui",
                  sessionId: current.sessionId,
                }),
              );
            }}
            onResumeApp={
              activeOperating?.resumePoints[0]
                ? () => {
                    const point = activeOperating.resumePoints[0]!;
                    openInstalledApp(point.appId, point.route ?? "/", { skipResumePrompt: true });
                    const target = findApplicationById(installedApps, point.appId);
                    if (target) {
                      window.setTimeout(() => {
                        postToOrigin(
                          target.origin,
                          sessionResumeMessage({
                            sessionId: activeOperating.sessionId,
                            label: point.label ?? "Resume",
                            route: point.route,
                            context: point.context,
                          }),
                        );
                      }, 350);
                    }
                  }
                : undefined
            }
            onPin={
              activeOperating?.context.activeContext
                ? () => {
                    operatingSessionsStore.pinContext(
                      activeOperating.sessionId,
                      activeOperating.context.activeContext,
                      activeOperating.context.activeContext?.title,
                    );
                    refreshOperatingSessions();
                  }
                : undefined
            }
          />
        ) : null}
        {surface === "actions" ? (
          <ActionMenuSurface
            object={
              selectedObject
                ? {
                    title: selectedObject.title,
                    type: selectedObject.type,
                    subtype:
                      selectedObject.subtype ??
                      (typeof selectedObject.metadata?.assetType === "string"
                        ? String(selectedObject.metadata.assetType)
                        : undefined),
                    originAppName: selectedObject.originAppId
                      ? findApplicationById(installedApps, selectedObject.originAppId)?.name
                      : undefined,
                  }
                : null
            }
            groups={(() => {
              if (!selectedObject) return [];
              const discovered = discoverActions({
                object: selectedObject,
                registry: installedApps,
                grantedCapabilitiesByOrigin: grantedByOrigin(),
                capabilityAvailability: {
                  commerce: { available: availability["commerce.checkout"]?.bound !== false },
                  identity: { available: availability["identity.authenticate"]?.bound !== false },
                },
              });
              if (!discovered.ok) return [];
              return groupActionsById(discovered.actions).map((group) => ({
                actionId: group.action.id,
                label: group.action.label,
                availability: group.bestAvailability,
                handlers: group.handlers.map((item) => ({
                  appId: item.handler.appId,
                  name: item.handler.name,
                  availability: item.availability,
                  route: item.handler.route,
                })),
              }));
            })()}
            recentActions={recentActions}
            confirmAction={confirmAction}
            onSelectSample={(kind) => {
              const object =
                kind === "asset"
                  ? {
                      type: "asset" as const,
                      id: "example-video",
                      title: "Example Video",
                      subtype: "VIDEO",
                      originAppId: "lifeos",
                      metadata: { assetType: "VIDEO" },
                      lifetime: "SESSION" as const,
                    }
                  : {
                      type: "text" as const,
                      title: "Example Article",
                      text: "Selected text for editing",
                      originAppId: "shell-demo-notes",
                      lifetime: "SESSION" as const,
                    };
              const selected = selectedObjectStore.select(object);
              if (selected.ok) {
                setSelectedObject(selected.object);
                auditStore.append(
                  actionAuditEntry({
                    origin: window.location.origin,
                    decision: "object_selected",
                    result: selected.object.type,
                    contextType: selected.object.type,
                  }),
                );
              }
            }}
            onClear={() => {
              selectedObjectStore.clear();
              setSelectedObject(null);
              setOpenWithAction(null);
              setConfirmAction(null);
            }}
            onAction={(actionId, appId, route) => runShellAction(actionId as OSShellActionId, appId, route)}
            onConfirm={() => {
              if (!confirmAction) return;
              const next = confirmAction;
              setConfirmAction(null);
              dispatchShellAction(next.actionId, next.appId, next.route);
            }}
            onCancelConfirm={() => {
              if (confirmAction) {
                auditStore.append(
                  actionAuditEntry({
                    origin: window.location.origin,
                    decision: "action_cancelled",
                    result: "cancelled",
                    action: confirmAction.actionId,
                  }),
                );
              }
              setConfirmAction(null);
            }}
            onOpenWith={(actionId) => setOpenWithAction(actionId as OSShellActionId)}
          />
        ) : null}
        {surface === "search" ? (
          <SearchSurface
            query={searchQuery}
            scope={searchScope}
            scopes={[
              { id: "all", label: "All" },
              { id: "applications", label: "Applications" },
              { id: "objects", label: "Objects" },
              { id: "actions", label: "Actions" },
              { id: "current_app", label: "Current App" },
              { id: "current_session", label: "Current Session" },
            ]}
            recent={searchHistory}
            providers={searchProviders.map((item) => ({
              appId: item.appId,
              name: findApplicationById(installedApps, item.appId)?.name ?? item.appId,
              state: item.state,
            }))}
            groups={(() => {
              const grouped = groupSearchResults(searchResults);
              return {
                applications: grouped.applications.map((item) => ({
                  title: item.title,
                  subtitle: item.subtitle,
                  appId: item.appId,
                  onOpen: () => {
                    selectSearchResult(item);
                    if (item.appId) openInstalledApp(item.appId, "/", { skipResumePrompt: true });
                  },
                })),
                objects: grouped.objects.map((item) => ({
                  title: item.title,
                  subtitle: item.subtitle,
                  onSelect: () => selectSearchResult(item),
                  actions: searchResultActions(item, installedApps).map((action) => ({
                    label: action.label,
                    onClick: () => {
                      selectSearchResult(item);
                      if (item.context && action.appId) {
                        selectedObjectStore.select(item.context);
                        setSelectedObject(item.context);
                        runShellAction(action.action, action.appId, "/");
                      }
                    },
                  })),
                })),
                actions: grouped.actions.map((item) => ({
                  title: item.title,
                  subtitle: item.subtitle,
                  onClick: () => {
                    selectSearchResult(item);
                    if (item.action && item.appId) {
                      if (item.context) {
                        selectedObjectStore.select(item.context);
                        setSelectedObject(item.context);
                      }
                      runShellAction(item.action, item.appId, "/");
                    }
                  },
                })),
                objectives: grouped.objectives.map((item) => ({
                  title: item.title,
                  subtitle: item.subtitle,
                  onClick: () => selectSearchResult(item),
                })),
              };
            })()}
            selected={
              selectedSearchResult
                ? {
                    title: selectedSearchResult.title,
                    detail: [
                      selectedSearchResult.type,
                      selectedSearchResult.subtitle,
                      selectedSearchResult.appId
                        ? findApplicationById(installedApps, selectedSearchResult.appId)?.name
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    actions: searchResultActions(selectedSearchResult, installedApps).map((action) => ({
                      label: action.label,
                      onClick: () => {
                        if (selectedSearchResult.type === "application" && selectedSearchResult.appId) {
                          openInstalledApp(selectedSearchResult.appId, "/", { skipResumePrompt: true });
                          return;
                        }
                        if (action.appId && action.action !== "open") {
                          if (selectedSearchResult.context) {
                            selectedObjectStore.select(selectedSearchResult.context);
                            setSelectedObject(selectedSearchResult.context);
                          }
                          runShellAction(action.action, action.appId, "/");
                        }
                      },
                    })),
                  }
                : null
            }
            onQuery={setSearchQuery}
            onScope={(value) => setSearchScope(value as OSShellSearchScope)}
            onSearch={() => void runShellSearch()}
            onRecent={(value) => {
              setSearchQuery(value);
              void runShellSearch(value);
            }}
            onClearHistory={() => {
              searchHistoryStore.clear();
              setSearchHistory([]);
            }}
          />
        ) : null}
        {surface === "launcher" ? (
          <LauncherSurface
            query={launcherQuery}
            recent={objectiveHistory}
            favorites={objectiveFavorites}
            suggestions={suggestObjectives({
              registry: installedApps,
              selectedObject: selectedObject ?? operatingContext?.objectReference ?? null,
              sessions: operatingSessions,
              runtimeHints: runtimeHints(),
              preferences: applicationPreferences,
              operatingContext,
            }).map((route) => ({
              title: objectiveLabel(route.objective),
              subtitle: route.appName,
              availability: route.availability,
              onStart: () => startObjectiveRoute(route),
            }))}
            recommended={groupRoutesByPreference(objectiveRoutes).recommended.map((route) => ({
              title: objectiveLabel(route.objective),
              subtitle: `${route.appName} · ${route.availability}`,
              availability: route.availability,
              reason: route.preferenceReason ?? route.reason,
              onStart: () => startObjectiveRoute(route),
              onAlways: () => alwaysUseRoute(route),
            }))}
            others={groupRoutesByPreference(objectiveRoutes).others.map((route) => ({
              title: objectiveLabel(route.objective),
              subtitle: `${route.appName} · ${route.availability}`,
              availability: route.availability,
              reason: route.preferenceReason ?? route.reason,
              onStart: () => startObjectiveRoute(route),
              onAlways: () => alwaysUseRoute(route),
            }))}
            selected={
              selectedObjectiveRoute
                ? {
                    title: objectiveLabel(selectedObjectiveRoute.objective),
                    detail: [
                      selectedObjectiveRoute.appName,
                      selectedObjectiveRoute.intent,
                      selectedObjectiveRoute.preferenceReason,
                      selectedObjectiveRoute.sessionId ? "session" : null,
                      selectedObjectiveRoute.reason,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    availability: selectedObjectiveRoute.availability,
                    actions: [
                      {
                        label:
                          selectedObjectiveRoute.availability === "CONTEXT_REQUIRED"
                            ? "Select context"
                            : selectedObjectiveRoute.availability === "AVAILABLE" ||
                                selectedObjectiveRoute.availability === "PERMISSION_REQUIRED"
                              ? "Use this app"
                              : "Unavailable",
                        onClick: () => startObjectiveRoute(selectedObjectiveRoute),
                      },
                      {
                        label: "Always use this app",
                        onClick: () => alwaysUseRoute(selectedObjectiveRoute),
                      },
                      {
                        label: objectiveFavorites.includes(objectiveLabel(selectedObjectiveRoute.objective))
                          ? "Unpin"
                          : "Pin",
                        onClick: () =>
                          setObjectiveFavorites(
                            objectiveHistoryStore.toggleFavorite(objectiveLabel(selectedObjectiveRoute.objective)),
                          ),
                      },
                    ],
                  }
                : null
            }
            contextNeeded={objectiveRoutes.some((item) => item.availability === "CONTEXT_REQUIRED")}
            onQuery={setLauncherQuery}
            onResolve={() => resolveLauncherObjective()}
            onRecent={(value) => {
              setLauncherQuery(value);
              resolveLauncherObjective(value);
            }}
            onClearHistory={() => {
              objectiveHistoryStore.clear();
              setObjectiveHistory([]);
            }}
            onPickContext={() => {
              go({ surface: "search", origin: null });
              setSearchScope("objects");
            }}
          />
        ) : null}
        {surface === "user" ? (
          <PermissionCenter
            origins={[...new Set([...sessions.map((item) => item.origin), ...grants.map((item) => item.origin)])]}
            sessions={sessions}
            current={focused}
            shellVersion={OSSHELL_VERSION}
            preferences={applicationPreferences.map((item) => ({
              label: preferenceLabel(item),
              appName: findApplicationById(installedApps, item.appId)?.name ?? item.appId,
              source: item.source,
              onClear: () => {
                const next = clearApplicationPreference(preferenceStore.load(), {
                  objectiveType: item.objectiveType,
                  objectType: item.objectType,
                  destination: item.destination,
                  source: item.source,
                });
                persistPreferences(next);
                auditStore.append(
                  preferenceAuditEntry({
                    origin: window.location.origin,
                    decision: "preference_cleared",
                    result: preferenceLabel(item),
                    objectiveType: item.objectiveType,
                    targetAppId: item.appId,
                  }),
                );
              },
              onChange: () => {
                setLauncherQuery(`${item.objectiveType} ${item.objectType ?? ""}`.trim());
                go({ surface: "launcher", origin: null });
                resolveLauncherObjective(`${item.objectiveType} ${item.objectType ?? ""}`.trim());
              },
            }))}
            onClearAllPreferences={() => {
              persistPreferences(clearAllApplicationPreferences());
              auditStore.append(
                preferenceAuditEntry({
                  origin: window.location.origin,
                  decision: "preference_cleared",
                  result: "all",
                }),
              );
            }}
            operatingContextPrivacy={{
              ...publicPersonalContextView(
                personalContext ??
                  resolveOperatingContext({
                    continuity: operatingContext,
                    recent: recentContinuity,
                    registry: installedApps,
                    preferences: applicationPreferences,
                  }),
              ),
              onClearCurrent: () => {
                operatingContextStore.clearCurrent();
                refreshOperatingContext(null);
              },
              onClearRecent: () => {
                operatingContextStore.clearRecent();
                setRecentContinuity([]);
                refreshOperatingContext();
              },
              onClearAll: () => {
                operatingContextStore.clearAll();
                refreshOperatingContext(null);
                setAmbiguityChoices([]);
              },
            }}
            rowsFor={(origin, appClass) =>
              permissionCenterRows({
                origin,
                appClass,
                grants,
                requested: sessions.find((item) => item.origin === origin)?.requested ?? [],
                decisions,
                availability,
              })
            }
            onRevoke={(origin, capability) => {
              setGrants(revokeGrant(grants, origin, capability));
              setDecisions(
                upsertDecision(decisions, {
                  origin,
                  capability,
                  state: "REVOKED",
                  at: new Date().toISOString(),
                }),
              );
              auditStore.append(
                capabilityAuditEntry({
                  origin,
                  appId: nativeAppForOrigin(origin)?.id ?? null,
                  capability,
                  decision: "revoke",
                  result: "permission_revoked",
                  availability: availabilityCodeFor(capability),
                }),
              );
              setSessions((current) =>
                current.map((item) => (item.origin === origin ? { ...item, runtimeState: "permission_revoked" } : item)),
              );
            }}
          />
        ) : null}
      </main>

      <nav className="dock" aria-label="Shell">
        <button className={surface === "home" || surface === "app" ? "active" : ""} type="button" onClick={() => go({ surface: "home", origin: null })}>
          Home
        </button>
        <button
          className={surface === "digitallife" ? "active" : ""}
          type="button"
          onClick={() => go({ surface: "digitallife", origin: null })}
        >
          Apps
        </button>
        <button type="button" onClick={back} disabled={!canBack} aria-label="Back">
          Back
        </button>
      </nav>

      {openWithAction && selectedObject ? (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-labelledby="openwith-title">
            <IntentChooserSurface
              intent={openWithAction}
              contextType={selectedObject.type}
              sourceName="OS Shell"
              handlers={(() => {
                const discovered = discoverActions({
                  object: selectedObject,
                  registry: installedApps,
                  grantedCapabilitiesByOrigin: grantedByOrigin(),
                });
                if (!discovered.ok) return [];
                return discovered.actions
                  .filter((item) => item.action.id === openWithAction)
                  .map((item) => item.handler);
              })()}
              onSelect={(appId, remember) => {
                const discovered = discoverActions({ object: selectedObject, registry: installedApps });
                const match =
                  discovered.ok
                    ? discovered.actions.find(
                        (item) => item.action.id === openWithAction && item.handler.appId === appId,
                      )
                    : null;
                if (remember) {
                  setDefaultHandlers((current) =>
                    setDefaultHandler(current, {
                      intent: openWithAction,
                      contextType: selectedObject.type,
                      appId,
                    }),
                  );
                }
                setOpenWithAction(null);
                if (match) runShellAction(openWithAction, appId, match.handler.route);
              }}
              onCancel={() => setOpenWithAction(null)}
            />
          </div>
        </div>
      ) : null}
      {pendingResume ? (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-labelledby="resume-title">
            <ResumeChooserSurface
              appName={findApplicationById(installedApps, pendingResume.appId)?.name ?? pendingResume.appId}
              resumeLabel={pendingResume.label}
              onResume={() => {
                const appId = pendingResume.appId;
                const route = pendingResume.route;
                const label = pendingResume.label;
                setPendingResume(null);
                openInstalledApp(appId, route, { skipResumePrompt: true });
                const current = operatingSessionsStore.current();
                const target = findApplicationById(installedAppsRef.current, appId);
                if (current && target) {
                  window.setTimeout(() => {
                    postToOrigin(
                      target.origin,
                      sessionResumeMessage({
                        sessionId: current.sessionId,
                        label,
                        route,
                        context: current.resumePoints.find((item) => item.appId === appId)?.context,
                      }),
                    );
                  }, 350);
                }
              }}
              onFresh={() => {
                const appId = pendingResume.appId;
                setPendingResume(null);
                openInstalledApp(appId, "/", { forceFresh: true, skipResumePrompt: true });
              }}
              onCancel={() => setPendingResume(null)}
            />
          </div>
        </div>
      ) : null}
      {pendingIntent ? (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-labelledby="intent-title">
            <IntentChooserSurface
              intent={pendingIntent.request.intent}
              contextType={pendingIntent.request.context.type}
              sourceName={
                findApplicationById(installedApps, pendingIntent.request.sourceAppId)?.name ??
                pendingIntent.request.sourceAppId
              }
              handlers={pendingIntent.handlers}
              onSelect={(appId, remember) => {
                const handler = pendingIntent.handlers.find((item) => item.appId === appId);
                if (!handler) return;
                completeIntent({
                  request: pendingIntent.request,
                  sourceOrigin: pendingIntent.sourceOrigin,
                  targetAppId: appId,
                  route: handler.route,
                  rememberDefault: remember,
                });
              }}
              onCancel={() => {
                postToOrigin(
                  pendingIntent.sourceOrigin,
                  intentResultMessage({
                    requestId: pendingIntent.request.requestId,
                    ok: false,
                    code: "handoff_rejected",
                    detail: "User cancelled the intent chooser.",
                  }),
                );
                auditStore.append(
                  intentAuditEntry({
                    origin: pendingIntent.sourceOrigin,
                    appId: pendingIntent.request.sourceAppId,
                    decision: "handoff_denied",
                    result: "cancelled",
                    intent: pendingIntent.request.intent,
                    contextType: pendingIntent.request.context.type,
                  }),
                );
                setPendingIntent(null);
              }}
            />
          </div>
        </div>
      ) : null}
      {prompt ? (
        <div className="modal-back">
          <div className="modal" role="dialog" aria-labelledby="perm-title">
            <div className="eyebrow">Shell permission</div>
            <h2 id="perm-title" style={{ margin: "6px 0 8px", fontSize: 18 }}>
              {CAPABILITY_LABELS[prompt.capability]}
            </h2>
            <p className="empty">
              <b>{sessions.find((item) => item.origin === prompt.origin)?.identity.name ?? prompt.origin}</b>
              <br />
              {prompt.origin} is asking for this capability. OS Shell only mediates access. It does not own the camera,
              Trust ID, FundzMan, files, Device Bridge, or Live.
            </p>
            <p className="empty">This grant applies only to this application origin. Other apps are not included.</p>
            <div className="actions">
              <button className="btn primary" type="button" onClick={() => decidePrompt(true)}>
                Grant
              </button>
              <button className="btn" type="button" onClick={() => decidePrompt(false)}>
                Deny
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
