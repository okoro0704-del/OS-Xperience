import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createHttpBroadcastSource, deletePreparedChannel, hydrateAndPrepareSpaceTv, IndexedDbBroadcastHydrationStore, localMediaBlob } from "@digiconomy/offline-kernel";
import {
  DIRECTORY_CATEGORIES,
  parseExperienceUtterance,
  SPACE_LAUNCH_EXTENSION,
  SPACE_LAUNCH_MAX_BYTES,
  SPACE_LAUNCH_MIME,
  type ApplicationSurfaceType,
  type DirectoryApplicationView,
  type ExperienceExecutionMode,
  type ExperienceMembershipView,
  type ExperienceTarget,
  type OpenExperiencePayload,
} from "@digiconomy/xperience-contract";
import {
  createXperienceApiClient,
  XperienceApiError,
  type XperienceApiClient,
} from "@digiconomy/xperience-sdk";
import {
  applyCatalogUpdate,
  applyOnlineDirectory,
  availableProviderTargets,
  bootFromLocal,
  buildLineup,
  buildLocalOpenPayload,
  canOperateOffline,
  catalogPublicKeySpki,
  chooseExecutionTarget,
  directoryRecordId,
  enterXperienceMode,
  getExperienceSlot,
  leaveXperienceMode,
  markRevealSeen,
  nextExperienceId,
  nextProviderWithMode,
  noRouteBroadcastSource,
  planSwitch,
  previousExperienceId,
  probeExperienceUrl,
  providerTarget,
  providerTargets,
  rememberOpenedExperience,
  requireExecutionTarget,
  resolveDirectoryProviders,
  resolveMemberships,
  shellAuthPosture,
  SPACE_IMPORT_MESSAGE,
  SPACE_READINESS_LABEL,
  classifySpaceReadiness,
  importSpaceLaunchFile,
  readSpaceRegistrations,
  removeSpaceRegistration,
  spaceLocallyPlayable,
  storeCatalogPublicKey,
  xperienceAppEntries,
  xperienceSpaceCandidates,
  bundledSpaceArtifact,
  findSpaceHomeEntry,
  findSpaceRegistration,
  parseSpaceLaunch,
  readSpaceHomeEntries,
  recordSpaceHomeEntry,
  removeSpaceHomeEntry,
  resolveInstalledSpace,
  spaceHomeEntryEligibility,
  spaceHomeEntryState,
  spaceInstallationStage,
  spaceShortcutId,
  spaceShortcutRequest,
  staleSpaceShortcuts,
  type LineupEntry,
  type SpaceHomeEntryHost,
  type SpaceHomeEntryState,
  type SpaceImportCode,
  type SpaceReadiness,
  type XperienceEntry,
} from "./local/index.js";
import { ExperienceSwitcher, attachDoubleTap } from "./switcher/index.js";
import { getSpeechRecognition, type SpeechRecognition, type VoiceState } from "./speech.js";
import {
  EXPERIENCE_ESCAPE_EVENT,
  attachTwoFingerHorizontalEscape,
  escapeThresholdsForViewport,
  markExperienceEscapeHintSeen,
  shouldShowExperienceEscapeHint,
  vibrateEscapeFeedback,
} from "./experience-escape.js";
import {
  isAirNavigationDebug,
  isAirNavigationEnabled,
  setAirNavigationEnabled,
  startAirNavigation,
  type AirNavDebugSnapshot,
  type AirNavigationController,
} from "./air-navigation.js";
import {
  NAV_LABS_BUILD_ID,
  attachNavLabsController,
  getActiveExperiment,
  getLabsConfig,
  isLabsDiagnosticsOn,
  isNavLabsEnabled,
  type ExperimentId,
  type NavLabsHud,
} from "./nav-labs/index.js";
import { NavigationLabsPanel } from "./nav-labs/NavigationLabsPanel.js";
import {
  beginLaunchTrace,
  markLaunch,
  preconnectOrigins,
  summarizeLaunch,
  type LaunchTrace,
} from "./launch-metrics.js";
import "./styles.css";
import { lockFrameLineup, lockedExecutionMode, lockedProviderId, resolveHostMode, resolveLockedExperience, type LockedExperienceConfig, type SpacePresentation } from "./locked-xperience.js";

declare global {
  interface Window {
    __oxLockedExperience?: LockedExperienceConfig;
    __oxExperienceActive?: boolean;
    __oxGestureDebug?: (phase: string, count: number, dx?: number, dy?: number) => void;
    __oxExitExperienceToHome?: () => void;
    __oxHardwareBack?: () => boolean;
  }
}

export interface ExperienceAppProps {
  apiBase?: string;
  userId?: string;
  userName?: string;
  /** Register hardware/system Back handler. Return true when UI consumed the event. */
  onHardwareBackReady?: (handler: () => boolean) => void;
  /** Open HTTPS destinations outside the OS Xperience WebView (Custom Tabs / browser). */
  openExternalUrl?: (url: string) => void | Promise<void>;
  /** Optional online/offline signal from the native shell. */
  online?: boolean | null;
  /** Host's generated runtime version stamp, recorded on the local installation. */
  runtimeVersion?: string;
  /** OS Xperience product version (semver), checked against a Space Launch File's minimum. */
  xperienceVersion?: string;
  /** Native launcher integration for Space home entries; absent where the platform has none. */
  spaceHomeEntryHost?: SpaceHomeEntryHost | null;
  /** Untrusted launch request the host received at cold start (a Space home entry tap). */
  initialSpaceLaunch?: unknown;
}

type SpaceLaunchStatus = "OPENING" | "NOT_READY" | "UNAVAILABLE" | "NOT_INSTALLED" | "INVALID";
type SpaceLaunchView = { status: SpaceLaunchStatus; spaceId?: string; name?: string; readiness?: SpaceReadiness; channelId?: string | null };

/** What the launch screen may show before anything is resolved: the recorded label only, never content. */
function openingSpaceLaunch(raw: unknown): SpaceLaunchView {
  const parsed = parseSpaceLaunch(raw);
  if (!parsed.ok) return { status: "OPENING" };
  const entry = findSpaceHomeEntry(parsed.spaceId);
  return { status: "OPENING", spaceId: parsed.spaceId, ...(entry ? { name: entry.label } : {}) };
}

const HOME_ENTRY_LABEL: Record<SpaceHomeEntryState, string> = {
  UNSUPPORTED: "Not available on this platform",
  NOT_ELIGIBLE: "Not available",
  AVAILABLE: "Not added",
  REQUESTED: "Not confirmed by the launcher",
  INSTALLED: "On your Home Screen",
};

type Screen =
  | "home"
  | "space-launch"
  | "directory"
  | "my-experience"
  | "profile"
  | "labs"
  | "search"
  | "detail"
  | "experience"
  | "xperience"
  | "xperience-apps"
  | "xperience-space"
  | "voice";
type MembershipFilter = "All" | "Active" | "Paused" | "Recently Used";
type Participant = { id: string; role: string; email?: string | null; displayName?: string | null };

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

/**
 * Picker filter for Import Space — acquisition only. Android types `.space` as application/octet-stream and
 * Capacitor drops extensions Android cannot map, so without it the standard picker disables every launch file.
 * Whatever is picked still passes the full verifier before anything is registered.
 */
const SPACE_IMPORT_ACCEPT = [SPACE_LAUNCH_EXTENSION, SPACE_LAUNCH_MIME, "application/octet-stream"].join(",");

/** Broadcast route for preparing a Space: host-injected, else the signed launch file's endpoint, else installation config. */
function broadcastBaseFor(providerId: string | null): string | undefined {
  const injected = typeof window !== "undefined" ? (window as Window & { __oxBroadcastApiBase?: string }).__oxBroadcastApiBase : undefined;
  const registered = providerId ? readSpaceRegistrations().find((item) => item.providerId === providerId)?.preparationEndpoint : undefined;
  return injected ?? registered ?? env?.VITE_MYBRANDOS_PUBLIC_API_BASE;
}

function initials(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "OS"
  );
}

function Icon({
  name,
}: {
  name:
    | "home"
    | "directory"
    | "voice"
    | "xperience"
    | "experience"
    | "profile"
    | "search"
    | "bell"
    | "back"
    | "more"
    | "view";
}) {
  const paths = {
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    directory: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    voice: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    xperience: <><path d="M12 3 13.8 9.2 20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8z" /><circle cx="12" cy="11" r="1.6" fill="currentColor" /></>,
    experience: <><path d="M4 5h16v14H4z" /><path d="m8 9 3 3-3 3M13 15h3" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    back: <path d="m15 18-6-6 6-6" />,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    view: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  };
  return <svg className="ox-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Brand() {
  return <span className="ox-brand"><span className="ox-logo" aria-hidden="true"><i /></span><strong>OS Xperience</strong></span>;
}

function AppGlyph({ app, compact = false }: { app: DirectoryApplicationView; compact?: boolean }) {
  return <span className={`ox-app-glyph ox-tone-${app.category.toLowerCase()} ${compact ? "is-compact" : ""}`} aria-hidden="true">{initials(app.name)}</span>;
}

function ErrorBanner({ message, onRetry }: { message?: string | null; onRetry: () => void }) {
  return (
    <div className="ox-error-banner" role="alert" data-testid="error">
      <span>!</span>
      <p>{message?.trim() || "We couldn't load your Xperience right now."}</p>
      <button className="ox-button secondary compact" onClick={onRetry} data-testid="retry">
        Try again
      </button>
    </div>
  );
}

function Skeletons({ count = 4, home = false }: { count?: number; home?: boolean }) {
  return <div className={`ox-grid ox-skeleton-grid${home ? " ox-home-grid" : ""}`} aria-label="Loading applications">{Array.from({ length: count }, (_, index) => <div className="ox-skeleton" key={index}><i /><b /><span /></div>)}</div>;
}

const EXECUTION_MODE_LABEL: Record<ExperienceExecutionMode, string> = {
  APP: "Xperience App",
  SPACE: "Xperience Space",
};

const XPERIENCE_SCREENS: readonly Screen[] = ["xperience", "xperience-apps", "xperience-space"];
const ENTRY_BROWSER: Record<XperienceEntry, Screen> = { APPS: "xperience-apps", SPACE: "xperience-space" };

/** A live record bound to a trusted provider never relocates it: the public destination stays the trusted entrypoint. */
function trustedOpenPayload(payload: OpenExperiencePayload, app: DirectoryApplicationView): OpenExperiencePayload {
  if (directoryRecordId(app.id) === app.id || payload.surface !== "PUBLIC") return payload;
  return { ...payload, applicationId: app.id, origin: app.origin, embedUrl: app.xperienceUrl || app.productionUrl };
}

/** Why a provider that is not in the lineup cannot run, from the same admission rule the Directory shows. */
function notAdmittedNotice(providerId: string, name: string | undefined): string {
  const targets = providerTargets({ id: providerId });
  const label = name || "That Experience";
  if (targets.some((target) => target.availability === "NOT_LISTED")) {
    return `${label} is not listed for OS Xperience on this installation.`;
  }
  if (targets.length > 0 && targets.every((target) => target.availability === "NOT_RELEASED")) {
    return `${label} is listed in the Directory but has not been released for OS Xperience on this installation.`;
  }
  return "That Experience is not available on this installation.";
}

function AppCard({
  app,
  modes,
  onSelect,
  onPrimary,
  busy,
  dense = false,
}: {
  app: DirectoryApplicationView;
  modes: ExperienceExecutionMode[];
  onSelect: () => void;
  onPrimary: () => void;
  busy: boolean;
  dense?: boolean;
}) {
  return <article className={`ox-app-card${dense ? " is-dense" : ""}`} data-testid={`provider-card-${app.id}`}>
    <button className="ox-card-main" onClick={onSelect} aria-label={`View ${app.name} details`}>
      <AppGlyph app={app} compact={dense} />
      <span>
        <small>{app.category}</small>
        <strong>{app.name}</strong>
        {modes.length
          ? <span className="ox-mode-badges" data-testid={`provider-modes-${app.id}`}>{modes.map((mode) => <em key={mode}>{mode}</em>)}</span>
          : <span className="ox-mode-badges" data-testid={`provider-not-released-${app.id}`}><em>NOT RELEASED</em></span>}
        {!dense ? <p>{app.description || "No description provided."}</p> : null}
      </span>
    </button>
    <div className="ox-card-footer">
      {!dense ? <span>{app.developerName || "Published application"}</span> : <span />}
      <div className="ox-card-actions">
        <button
          type="button"
          className="ox-icon-button ox-view-button"
          aria-label={`View ${app.name} details`}
          onClick={onSelect}
        >
          <Icon name="view" />
        </button>
        <button className="ox-button compact" disabled={busy || modes.length === 0} onClick={onPrimary}>
          {busy ? "Working…" : app.experienced ? "Open" : "Xperience"}
        </button>
      </div>
    </div>
  </article>;
}

function BottomNav({
  screen,
  go,
}: {
  screen: Screen;
  go: (screen: Screen) => void;
}) {
  return (
    <nav className="ox-bottom-nav" aria-label="Primary navigation">
      <button
        type="button"
        data-testid="nav-home"
        className={`ox-nav-dest${screen === "home" ? " active" : ""}`}
        onClick={() => go("home")}
      >
        <Icon name="home" />
        <span>Home</span>
      </button>
      <button
        type="button"
        data-testid="nav-directory"
        className={`ox-nav-dest${screen === "directory" || screen === "search" || screen === "detail" ? " active" : ""}`}
        onClick={() => go("directory")}
      >
        <Icon name="directory" />
        <span>Directory</span>
      </button>

      <button type="button" data-testid="nav-xperience" className={`ox-nav-dest${XPERIENCE_SCREENS.includes(screen) ? " active" : ""}`} onClick={() => go("xperience")}>
        <Icon name="xperience" /><span>Xperience</span>
      </button>

      <button
        type="button"
        data-testid="nav-my-experience"
        className={`ox-nav-dest${screen === "my-experience" ? " active" : ""}`}
        onClick={() => go("my-experience")}
      >
        <Icon name="experience" />
        <span>My Experience</span>
      </button>
      <button
        type="button"
        data-testid="nav-profile"
        className={`ox-nav-dest${screen === "profile" ? " active" : ""}`}
        onClick={() => go("profile")}
      >
        <Icon name="profile" />
        <span>Profile</span>
      </button>
    </nav>
  );
}

export function ExperienceApp(props: ExperienceAppProps) {
  const apiBase = props.apiBase ?? env?.VITE_XPERIENCE_API_URL ?? "http://localhost:4100";
  const userId = props.userId ?? env?.VITE_XPERIENCE_USER_ID ?? "user-1";
  const userName = props.userName ?? env?.VITE_XPERIENCE_USER_NAME ?? "Member";
  const openExternalUrl = props.openExternalUrl;
  const hostMode = useMemo(() => resolveHostMode({
    env: {
      lockedId: env?.VITE_LOCKED_XPERIENCE_ID,
      lockedMode: env?.VITE_LOCKED_XPERIENCE_MODE,
      lockedPurpose: env?.VITE_LOCKED_XPERIENCE_PURPOSE,
    },
    runtime: typeof window !== "undefined" ? window.__oxLockedExperience ?? null : null,
  }), []);
  const lockedExperienceId = lockedProviderId(hostMode);
  const fixedExecutionMode = lockedExecutionMode(hostMode);
  const api = useMemo<XperienceApiClient>(() => createXperienceApiClient({
    baseUrl: apiBase,
    actor: `USER:${userId}`,
    email: `${userId}@xperience.local`,
    displayName: userName,
  }), [apiBase, userId, userName]);

  // A home-entry tap opens straight into the launch screen: OS Xperience Home is never shown first.
  const [screen, setScreen] = useState<Screen>(() => (props.initialSpaceLaunch != null ? "space-launch" : "home"));
  const [screenStack, setScreenStack] = useState<Screen[]>([]);
  const [directory, setDirectory] = useState<DirectoryApplicationView[]>([]);
  const [featured, setFeatured] = useState<DirectoryApplicationView[]>([]);
  const [memberships, setMemberships] = useState<ExperienceMembershipView[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [selected, setSelected] = useState<DirectoryApplicationView | null>(null);
  const [opened, setOpened] = useState<OpenExperiencePayload | null>(null);
  const [launchingApp, setLaunchingApp] = useState<DirectoryApplicationView | null>(null);
  const launchTraceRef = useRef<LaunchTrace | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const directoryScrollRef = useRef(0);
  const [frameReady, setFrameReady] = useState(false);
  const [category, setCategory] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [membershipFilter, setMembershipFilter] = useState<MembershipFilter>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<ExperienceMembershipView | null>(null);
  const [frameFailed, setFrameFailed] = useState(false);
  const [escapeHint, setEscapeHint] = useState(false);
  const [exitingExperience, setExitingExperience] = useState(false);
  const [airGrabbed, setAirGrabbed] = useState(false);
  const [airEnabled, setAirEnabled] = useState(() => isAirNavigationEnabled());
  const [airDebug, setAirDebug] = useState<AirNavDebugSnapshot | null>(null);
  const [gestureDebug, setGestureDebug] = useState<string>("");
  const [exitProbe, setExitProbe] = useState<"idle" | "requested" | "home">("idle");
  const [pointerCount, setPointerCount] = useState(0);
  const [labsEnabled, setLabsEnabledState] = useState(() => isNavLabsEnabled());
  const [labsExperiment, setLabsExperiment] = useState<ExperimentId | null>(() => getActiveExperiment());
  const [labsHud, setLabsHud] = useState<NavLabsHud | null>(null);
  const [labsDiagnostics, setLabsDiagnostics] = useState(() => isLabsDiagnosticsOn());
  const [navProgress, setNavProgress] = useState(0);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceText, setVoiceText] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("Say what you want to do.");
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 960px)").matches);
  const [offline, setOffline] = useState(false);
  const [experienceOfflineMessage, setExperienceOfflineMessage] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [lineup, setLineup] = useState<LineupEntry[]>([]);
  const [activeExperienceId, setActiveExperienceId] = useState<string | null>(null);
  const [mountedFrames, setMountedFrames] = useState<
    { id: string; embedUrl: string; name: string }[]
  >([]);
  const [executionMode, setExecutionMode] = useState<ExperienceExecutionMode>("APP");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [spacePresentation, setSpacePresentation] = useState<SpacePresentation>("IMMERSIVE");
  const [hostMenuOpen, setHostMenuOpen] = useState(false);
  const [spaceNotice, setSpaceNotice] = useState<string | null>(null);
  const [tvState, setTvState] = useState<"idle" | "preparing" | "playing" | "unavailable">("idle");
  const [tvSource, setTvSource] = useState<string | null>(null);
  const [tvTitle, setTvTitle] = useState<string | null>(null);
  const [revealBanner, setRevealBanner] = useState<{ id: string; name: string } | null>(null);
  const [xperienceEntry, setXperienceEntry] = useState<XperienceEntry | null>(null);
  const [spacePlayable, setSpacePlayable] = useState<Record<string, boolean> | null>(null);
  /** Bumped when a Space registration or its prepared state changes. */
  const [spaceRevision, setSpaceRevision] = useState(0);
  const playableCheckKeyRef = useRef("");
  const [spaceImport, setSpaceImport] = useState<{ code: SpaceImportCode | "REGISTERED" | "UPDATED"; pending?: Uint8Array; offeredVersion?: string } | null>(null);
  const [preparingSpaceId, setPreparingSpaceId] = useState<string | null>(null);
  const [prepareNotice, setPrepareNotice] = useState<string | null>(null);
  const homeEntryHost = props.spaceHomeEntryHost ?? null;
  const [homeEntrySupported, setHomeEntrySupported] = useState(false);
  const [pinnedShortcuts, setPinnedShortcuts] = useState<string[]>([]);
  const [homeEntryNotice, setHomeEntryNotice] = useState<string | null>(null);
  const pendingPinRef = useRef<{ spaceId: string; name: string } | null>(null);
  const [spaceManageId, setSpaceManageId] = useState<string | null>(null);
  const [deleteOfflineTarget, setDeleteOfflineTarget] = useState<{ providerId: string; name: string; channelId: string } | null>(null);
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null);
  const [spaceLaunch, setSpaceLaunch] = useState<SpaceLaunchView | null>(() => (props.initialSpaceLaunch != null ? openingSpaceLaunch(props.initialSpaceLaunch) : null));
  const pendingSpaceLaunchRef = useRef<unknown>(props.initialSpaceLaunch ?? null);
  const localBootDoneRef = useRef(false);
  const autoplaySpaceRef = useRef<string | null>(null);
  const leaveSpaceLaunchRef = useRef<() => void>(() => undefined);
  const processSpaceLaunchRef = useRef<(raw: unknown, context?: { apps?: DirectoryApplicationView[]; online?: boolean }) => Promise<void>>(async () => undefined);
  const spaceFileRef = useRef<HTMLInputElement | null>(null);
  const xperienceEntryRef = useRef<XperienceEntry | null>(null);
  const bootRestoreDoneRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const immersiveRef = useRef<HTMLDivElement | null>(null);
  const switcherEdgeLeftRef = useRef<HTMLDivElement | null>(null);
  const switcherEdgeRightRef = useRef<HTMLDivElement | null>(null);
  const switcherIdleRef = useRef<number | null>(null);
  const mountedIdsRef = useRef<string[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const executionModeRef = useRef<ExperienceExecutionMode>("APP");
  const airNavRef = useRef<AirNavigationController | null>(null);
  const tvUrlRef = useRef<string | null>(null);
  const screenRef = useRef(screen);
  const stackRef = useRef(screenStack);
  const exitingRef = useRef(false);
  screenRef.current = screen;
  stackRef.current = screenStack;
  mountedIdsRef.current = mountedFrames.map((frame) => frame.id);
  activeIdRef.current = activeExperienceId;
  executionModeRef.current = executionMode;

  const navigate = useCallback((next: Screen, options?: { replace?: boolean }) => {
    setScreen((current) => {
      if (!options?.replace && next !== current) {
        setScreenStack((stack) => (stack[stack.length - 1] === current ? stack : [...stack, current]).slice(-24));
      }
      return next;
    });
  }, []);

  const refreshLineup = useCallback(
    (apps?: DirectoryApplicationView[]) => {
      const next = buildLineup({
        online: !offline,
        membershipIds: memberships.map((item) => item.applicationId),
        apps: apps ?? [
          ...memberships.map((item) => item.application),
          ...directory,
        ],
      });
      const locked = lockFrameLineup(next, lockedExperienceId);
      setLineup(locked);
      return locked;
    },
    [directory, memberships, offline, lockedExperienceId],
  );

  const dismissSwitcher = useCallback(() => {
    setSwitcherOpen(false);
    if (switcherIdleRef.current != null) {
      window.clearTimeout(switcherIdleRef.current);
      switcherIdleRef.current = null;
    }
  }, []);

  const bumpSwitcherIdle = useCallback(() => {
    if (switcherIdleRef.current != null) window.clearTimeout(switcherIdleRef.current);
    switcherIdleRef.current = window.setTimeout(() => setSwitcherOpen(false), 4200);
  }, []);

  const openSwitcher = useCallback(() => {
    setSwitcherOpen(true);
    bumpSwitcherIdle();
  }, [bumpSwitcherIdle]);

  const abortExperienceToHome = useCallback(
    (message: string) => {
      leaveXperienceMode();
      setMountedFrames([]);
      setOpened(null);
      setLaunchingApp(null);
      setFrameFailed(false);
      setFrameReady(false);
      setExperienceOfflineMessage(null);
      setActiveExperienceId(null);
      setSwitcherOpen(false);
      setRestoreNotice(message);
      const entry = xperienceEntryRef.current;
      navigate(entry ? ENTRY_BROWSER[entry] : "home", { replace: true });
    },
    [navigate],
  );

  const ensureEntrypointReachable = useCallback(async (url: string | null | undefined) => {
    if (!url) {
      return { ok: false as const, reason: "Experience entrypoint is missing." };
    }
    return probeExperienceUrl(url, 2500);
  }, []);

  const applyMountPlan = useCallback(
    (
      nextLineup: LineupEntry[],
      toId: string,
      fromId: string | null,
      options?: {
        offlineMessage?: string | null;
        app?: DirectoryApplicationView;
        executionMode?: ExperienceExecutionMode | null;
        /** The mode was chosen explicitly: run it or refuse, never substitute the other mode. */
        strict?: boolean;
      },
    ) => {
      const resolvedToId = resolveLockedExperience(toId, lockedExperienceId);
      if (!resolvedToId) return;
      const lockedLineup = lockFrameLineup(nextLineup, lockedExperienceId);
      const toEntry = lockedLineup.find((entry) => entry.experienceId === resolvedToId);
      if (!toEntry) {
        abortExperienceToHome(
          lockedExperienceId
            ? "The configured locked Experience is unavailable on this installation."
            : notAdmittedNotice(resolvedToId, options?.app?.name ?? directory.find((item) => item.id === resolvedToId)?.name),
        );
        return;
      }
      const requestedMode =
        options?.executionMode ??
        (resolvedToId === activeIdRef.current ? executionModeRef.current : getExperienceSlot(resolvedToId)?.executionMode) ??
        null;
      const toTargets = providerTargets({
        id: resolvedToId,
        entrypoint: toEntry.entrypoint,
        executionModes: toEntry.executionModes ?? options?.app?.executionModes,
      });
      const explicitMode = options?.strict ? options.executionMode ?? null : null;
      const target = explicitMode
        ? requireExecutionTarget(toTargets, explicitMode, fixedExecutionMode)
        : chooseExecutionTarget(toTargets, requestedMode, fixedExecutionMode);
      if (!target) {
        abortExperienceToHome(explicitMode
          ? `${toEntry.name} has no released ${EXECUTION_MODE_LABEL[explicitMode]} on this installation.`
          : `${toEntry.name} has no released Xperience mode on this installation.`);
        return;
      }
      const targetChanged = resolvedToId !== activeIdRef.current || target.executionMode !== executionModeRef.current;
      if (targetChanged) {
        setTvState("idle");
        setSpacePresentation("IMMERSIVE");
        setSpaceNotice(null);
      }
      setHostMenuOpen(false);
      executionModeRef.current = target.executionMode;
      setExecutionMode(target.executionMode);
      const plan = planSwitch({
        lineup: lockedLineup,
        fromId: resolveLockedExperience(fromId, lockedExperienceId),
        toId: resolvedToId,
        previouslyMounted: mountedIdsRef.current,
      });
      if (!plan) return;

      enterXperienceMode();
      setActiveExperienceId(plan.activeId);
      setSwitcherOpen(false);

      if (plan.offlineBlocked || options?.offlineMessage) {
        setExperienceOfflineMessage(
          options?.offlineMessage ??
            "This Experience needs a connection to continue. Your previous state has been preserved.",
        );
        const entry = lockedLineup.find((item) => item.experienceId === resolvedToId);
        if (entry) {
          setLaunchingApp(
            options?.app ?? {
              id: entry.experienceId,
              name: entry.name,
              version: "1.0.0",
              origin: entry.origin,
              productionUrl: entry.entrypoint,
              xperienceUrl: entry.entrypoint,
              canManage: false,
              authMode: entry.authMode,
              offlineCapability: entry.offlineCapability,
              category: "General",
              capabilities: [],
              publicationState: "PUBLISHED",
              experienced: true,
              experienceStatus: "ACTIVE",
            },
          );
          setOpened(null);
        }
        navigate("experience");
        return;
      }

      setExperienceOfflineMessage(null);
      setMountedFrames((previous) => {
        const existing = new Map(previous.map((frame) => [frame.id, frame]));
        const next: { id: string; embedUrl: string; name: string }[] = [];
        for (const id of plan.mountedIds) {
          const kept = existing.get(id);
          if (kept && (id !== resolvedToId || kept.embedUrl === target.entrypoint)) {
            next.push(kept);
            continue;
          }
          if (id === resolvedToId) {
            next.push({ id, embedUrl: target.entrypoint, name: toEntry.name });
            continue;
          }
          const entry = lockedLineup.find((item) => item.experienceId === id);
          if (!entry) continue;
          next.push({ id, embedUrl: entry.entrypoint, name: entry.name });
        }
        return next;
      });

      const activeEntry = lockedLineup.find((item) => item.experienceId === resolvedToId);
      if (activeEntry) {
        const app =
          options?.app ??
          directory.find((item) => item.id === resolvedToId) ??
          memberships.find((item) => item.applicationId === resolvedToId)?.application;
        const payloadApp = app ?? {
          id: activeEntry.experienceId,
          name: activeEntry.name,
          version: "1.0.0",
          origin: activeEntry.origin,
          productionUrl: activeEntry.entrypoint,
          xperienceUrl: activeEntry.entrypoint,
          canManage: false,
          authMode: activeEntry.authMode,
          offlineCapability: activeEntry.offlineCapability,
          category: "General" as const,
          capabilities: [],
          publicationState: "PUBLISHED" as const,
          experienced: true,
          experienceStatus: "ACTIVE" as const,
        };
        const payload = buildLocalOpenPayload(payloadApp, "PUBLIC");
        setOpened(payload);
        setFrameReady(plan.fromWarm || plan.sameExperience);
        setFrameFailed(false);
        setLaunchingApp(null);
        rememberOpenedExperience(payloadApp, "PUBLIC", undefined, target.executionMode);
      }
      navigate("experience");
    },
    [abortExperienceToHome, directory, fixedExecutionMode, lockedExperienceId, memberships, navigate],
  );

  /** Mode the running Experience is confined to by the Xperience browser it was launched from. */
  const isolatedExecutionMode = useCallback((): ExperienceExecutionMode | null => {
    const entry = xperienceEntryRef.current;
    if (entry === "APPS") return "APP";
    if (entry === "SPACE") return executionModeRef.current;
    return null;
  }, []);

  const isolateLineup = useCallback(
    (entries: LineupEntry[], mode: ExperienceExecutionMode | null) => mode
      ? entries.filter((entry) => providerTarget({ id: entry.experienceId, entrypoint: entry.entrypoint, executionModes: entry.executionModes }, mode))
      : entries,
    [],
  );

  /** APP ↔ SPACE on the active provider; provider identity and lineup position are unchanged. */
  const switchExecutionMode = useCallback(
    (mode: ExperienceExecutionMode) => {
      const id = activeIdRef.current;
      if (!id || mode === executionModeRef.current) return;
      if (fixedExecutionMode && mode !== fixedExecutionMode) return;
      if (xperienceEntryRef.current === "APPS" && mode !== "APP") return;
      const nextLineup = refreshLineup();
      if (mode === "APP" && executionModeRef.current === "SPACE") {
        // Leaving a Space for its App is network-first; an unreachable App never tears the Space down.
        const entry = nextLineup.find((item) => item.experienceId === id);
        const appTarget = providerTarget({ id, entrypoint: entry?.entrypoint, executionModes: entry?.executionModes }, "APP");
        void (async () => {
          const probe = await ensureEntrypointReachable(appTarget?.entrypoint);
          if (activeIdRef.current !== id || executionModeRef.current !== "SPACE") return;
          if (!probe.ok) {
            setSpaceNotice(`${entry?.name ?? "This"} App needs a connection. This Space keeps running on this installation.`);
            return;
          }
          applyMountPlan(nextLineup, id, id, { executionMode: "APP", strict: true });
        })();
        return;
      }
      applyMountPlan(nextLineup, id, id, { executionMode: mode, strict: true });
    },
    [applyMountPlan, ensureEntrypointReachable, fixedExecutionMode, refreshLineup],
  );

  const switchToExperience = useCallback(
    (experienceId: string) => {
      const nextLineup = refreshLineup();
      void (async () => {
        const entry = nextLineup.find((item) => item.experienceId === experienceId);
        const isolated = isolatedExecutionMode();
        const targets = providerTargets({ id: experienceId, entrypoint: entry?.entrypoint, executionModes: entry?.executionModes });
        const planned = isolated
          ? requireExecutionTarget(targets, isolated, fixedExecutionMode)
          : chooseExecutionTarget(targets, getExperienceSlot(experienceId)?.executionMode ?? null, fixedExecutionMode);
        if (isolated && !planned) return;
        if (!mountedIdsRef.current.includes(experienceId) && planned?.executionMode !== "SPACE") {
          const probe = await ensureEntrypointReachable(entry?.entrypoint);
          if (!probe.ok) {
            abortExperienceToHome(
              probe.reason ?? "OS Xperience could not open that Experience. Returning Home.",
            );
            return;
          }
        }
        applyMountPlan(nextLineup, experienceId, activeIdRef.current, isolated ? { executionMode: isolated, strict: true } : undefined);
        dismissSwitcher();
      })();
    },
    [abortExperienceToHome, applyMountPlan, dismissSwitcher, ensureEntrypointReachable, fixedExecutionMode, isolatedExecutionMode, refreshLineup],
  );

  const switchNext = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const nextLineup = refreshLineup();
    const isolated = isolatedExecutionMode();
    const nextId = nextExperienceId(isolateLineup(nextLineup, isolated), id);
    if (nextId) applyMountPlan(nextLineup, nextId, id, isolated ? { executionMode: isolated, strict: true } : undefined);
    bumpSwitcherIdle();
  }, [applyMountPlan, bumpSwitcherIdle, isolateLineup, isolatedExecutionMode, refreshLineup]);

  const switchPrevious = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const nextLineup = refreshLineup();
    const isolated = isolatedExecutionMode();
    const prevId = previousExperienceId(isolateLineup(nextLineup, isolated), id);
    if (prevId) applyMountPlan(nextLineup, prevId, id, isolated ? { executionMode: isolated, strict: true } : undefined);
    bumpSwitcherIdle();
  }, [applyMountPlan, bumpSwitcherIdle, isolateLineup, isolatedExecutionMode, refreshLineup]);

  const load = useCallback(async () => {
    setLoading(true);
    const isOnline =
      typeof props.online === "boolean"
        ? props.online
        : typeof navigator === "undefined"
          ? true
          : navigator.onLine;

    try {
      // Local-first: installation identity + registry + restore — no Xperience login.
      const local = bootFromLocal({
        online: isOnline,
        lockedExperienceId,
        restoreOnFirstOpen: hostMode.kind === "LOCKED",
        runtimeVersion: props.runtimeVersion,
      });
      setDirectory(local.directory);
      setFeatured(local.featured);
      setMemberships(local.memberships);
      setParticipant({
        id: local.installation.installationId,
        role: "INSTALLATION",
        displayName: "This installation",
      });
      setError(null);

      // A home-entry launch decides what opens: the previous Experience is not restored underneath it.
      const pendingLaunch = pendingSpaceLaunchRef.current;
      pendingSpaceLaunchRef.current = null;
      const bootRestorePending = !bootRestoreDoneRef.current && pendingLaunch == null;
      bootRestoreDoneRef.current = true;
      if (local.restore && bootRestorePending) {
        try {
          const nextLineup = lockFrameLineup(buildLineup({
            online: isOnline,
            membershipIds: local.memberships.map((item) => item.applicationId),
            apps: local.directory,
          }), lockedExperienceId);
          setLineup(nextLineup);
          setExperienceOfflineMessage(local.restore.offlineBlocked ? (local.restore.offlineMessage ?? null) : null);
          setLaunchingApp(local.restore.app);
          if (local.restore.payload && !local.restore.offlineBlocked) {
            const restoreTarget = chooseExecutionTarget(
              providerTargets({ id: local.restore.app.id, entrypoint: local.restore.payload.embedUrl }),
              local.restore.executionMode ?? null,
              fixedExecutionMode,
            );
            // A prepared Space restores without its provider's APP origin answering.
            const probe = isOnline && restoreTarget?.executionMode !== "SPACE"
              ? await ensureEntrypointReachable(local.restore.payload.embedUrl)
              : { ok: true as const };
            if (!probe.ok) {
              console.warn("[ox-boot] Experience restore unreachable — falling back to Home", probe.reason);
              leaveXperienceMode();
              setLaunchingApp(null);
              setOpened(null);
              setMountedFrames([]);
              setExperienceOfflineMessage(null);
              setRestoreNotice(
                probe.reason ??
                  "OS Xperience could not restore the previous Experience. Returning Home.",
              );
              navigate("home", { replace: true });
            } else {
              applyMountPlan(nextLineup, local.restore.app.id, null, {
                app: local.restore.app,
                executionMode: local.restore.executionMode ?? null,
              });
            }
          } else if (local.restore.offlineBlocked) {
            // Keep shell usable: do not stay on a white iframe — show Home with notice.
            leaveXperienceMode();
            setLaunchingApp(null);
            setOpened(null);
            setExperienceOfflineMessage(null);
            setRestoreNotice(
              local.restore.offlineMessage ??
                "The previous Experience needs a connection. Your installation was preserved.",
            );
            navigate("home", { replace: true });
          }
        } catch (restoreError) {
          console.warn("[ox-boot] Experience restore failed — falling back to Home", restoreError);
          leaveXperienceMode();
          setLaunchingApp(null);
          setOpened(null);
          setExperienceOfflineMessage(null);
          setRestoreNotice("OS Xperience could not restore the previous Experience. Returning Home.");
          navigate("home", { replace: true });
        }
      }

      // Resolved from local state only, before any Directory or catalog request.
      const lateLaunch = pendingSpaceLaunchRef.current;
      pendingSpaceLaunchRef.current = null;
      localBootDoneRef.current = true;
      const launch = pendingLaunch ?? lateLaunch;
      if (launch != null) {
        void processSpaceLaunchRef.current(launch, { apps: [...local.memberships.map((item) => item.application), ...local.directory], online: isOnline });
      }

      // Local shell is usable immediately — never hold skeletons on network/probe.
      setLoading(false);

      if (!isOnline) {
        return;
      }

      try {
        const [directoryResult, featuredResult, membershipResult, catalog, publicKey] = await Promise.all([
          api.listDirectory(),
          api.featuredDirectory(),
          api.listMyExperience(),
          api.getCatalogManifest().catch(() => null),
          api.getCatalogPublicKey().catch(() => null),
        ]);
        if (publicKey?.publicKeySpkiBase64) {
          storeCatalogPublicKey(publicKey.publicKeySpkiBase64);
        }
        if (catalog) {
          const applied = await applyCatalogUpdate(catalog, {
            publicKeySpki: publicKey?.publicKeySpkiBase64 ?? catalogPublicKeySpki() ?? undefined,
          });
          if (applied.ok) setCatalogRevision((value) => value + 1);
          if (applied.ok && applied.newlyLive[0]) {
            const first = applied.newlyLive[0];
            setRevealBanner({ id: first.experienceId, name: first.name });
          }
        }
        // Resolved after the catalog update so live records bind to the freshly verified release.
        const providers = resolveDirectoryProviders(directoryResult.applications);
        const featuredProviders = resolveDirectoryProviders(featuredResult.applications, { includeUnlistedTrusted: false });
        const providerMemberships = resolveMemberships(membershipResult.experiences);
        applyOnlineDirectory(providers, providerMemberships);
        setDirectory(providers);
        setFeatured(featuredProviders);
        setMemberships(providerMemberships);
        refreshLineup([
          ...providerMemberships.map((item) => item.application),
          ...providers,
        ]);
        preconnectOrigins([
          ...providers.map((a) => a.xperienceUrl || a.productionUrl),
          ...featuredProviders.map((a) => a.xperienceUrl || a.productionUrl),
        ]);
        // Optional profile enrichment — never gates shell entry.
        try {
          const me = await api.me();
          setParticipant((current) => ({
            id: current?.id ?? local.installation.installationId,
            role: me.role || "PARTICIPANT",
            email: me.email,
            displayName: me.displayName || current?.displayName,
          }));
        } catch {
          /* ignore — installation identity remains */
        }
      } catch (reason) {
        // Soft failure: local shell already usable offline.
        if (!local.directory.length) {
          setError(reason instanceof XperienceApiError ? reason.message : "Directory sync unavailable.");
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "OS Xperience could not start.");
    } finally {
      setLoading(false);
    }
  }, [api, navigate, props.online, applyMountPlan, refreshLineup, ensureEntrypointReachable, lockedExperienceId, fixedExecutionMode, hostMode.kind]);

  useEffect(() => {
    const poll = () => {
      void (async () => {
        try {
          let publicKeySpki = catalogPublicKeySpki();
          if (!publicKeySpki) {
            const key = await api.getCatalogPublicKey();
            storeCatalogPublicKey(key.publicKeySpkiBase64);
            publicKeySpki = key.publicKeySpkiBase64;
          }
          // Presentation pointer is informative only — never auto-enters an Experience (X4).
          await api.getActivePresentation().catch(() => null);
          const catalog = await api.getCatalogManifest();
          const applied = await applyCatalogUpdate(catalog, { publicKeySpki });
          if (applied.ok) setCatalogRevision((value) => value + 1);
          if (applied.ok && applied.newlyLive[0]) {
            setRevealBanner({
              id: applied.newlyLive[0].experienceId,
              name: applied.newlyLive[0].name,
            });
          }
        } catch {
          /* soft poll failure — offline catalog continuity remains */
        }
      })();
    };
    const timer = window.setInterval(poll, 20_000);
    return () => window.clearInterval(timer);
  }, [api]);

  // load's identity follows directory/lineup state that load itself sets; re-running on identity
  // change loops forever. Boot once; online recovery and Retry call load explicitly.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current();
  }, [api]);

  useEffect(() => {
    if (typeof props.online === "boolean") {
      setOffline(!props.online);
      return;
    }
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [props.online]);

  // Reconnect refreshes Directory/catalog in the background; the running Experience stays mounted.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (!offline && wasOfflineRef.current) void loadRef.current();
    wasOfflineRef.current = offline;
  }, [offline]);

  useEffect(() => {
    if (screen === "experience" || XPERIENCE_SCREENS.includes(screen)) return;
    xperienceEntryRef.current = null;
    setXperienceEntry(null);
  }, [screen]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 960px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const handleHardwareBack = useCallback(() => {
    if (switcherOpen) {
      dismissSwitcher();
      return true;
    }
    const current = screenRef.current;
    if (current === "experience") {
      leaveXperienceMode();
      setOpened(null);
      setLaunchingApp(null);
      setMountedFrames([]);
      setActiveExperienceId(null);
      setFrameFailed(false);
      setSwitcherOpen(false);
      const entry = xperienceEntryRef.current;
      setScreen(entry ? ENTRY_BROWSER[entry] : "my-experience");
      return true;
    }
    if (current === "xperience-apps" || current === "xperience-space" || current === "xperience") {
      const parent: Screen = current === "xperience" ? "home" : "xperience";
      setScreenStack((stack) => stack.filter((item) => !XPERIENCE_SCREENS.includes(item) && item !== "experience"));
      setScreen(parent);
      return true;
    }
    if (current === "space-launch") {
      leaveSpaceLaunchRef.current();
      return true;
    }
    if (current === "detail") {
      setScreen(stackRef.current.includes("directory") ? "directory" : "home");
      setScreenStack((stack) => stack.filter((item) => item !== "detail"));
      return true;
    }
    if (current === "voice" || current === "search" || current === "profile" || current === "labs" || current === "directory" || current === "my-experience") {
      const stack = stackRef.current;
      const previous = [...stack].reverse().find((item) => item !== current) ?? "home";
      setScreenStack((items) => items.filter((item) => item !== current));
      setScreen(previous === current ? "home" : previous);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const syncVisualViewport = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      document.documentElement.style.setProperty("--ox-visual-height", `${Math.round(vv.height)}px`);
    };
    syncVisualViewport();
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);
    window.addEventListener("orientationchange", syncVisualViewport);
    return () => {
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      window.removeEventListener("orientationchange", syncVisualViewport);
    };
  }, []);

  const exitExperienceToHome = useCallback(() => {
    if (exitingRef.current) return;
    if (screenRef.current !== "experience") return;
    exitingRef.current = true;
    setExitProbe("requested");
    setExitingExperience(true);
    dismissSwitcher();
    leaveXperienceMode();
    vibrateEscapeFeedback();
    window.setTimeout(() => {
      setOpened(null);
      setLaunchingApp(null);
      setMountedFrames([]);
      setActiveExperienceId(null);
      setFrameFailed(false);
      setFrameReady(false);
      setEscapeHint(false);
      setExperienceOfflineMessage(null);
      setExitingExperience(false);
      setAirGrabbed(false);
      exitingRef.current = false;
      setScreen("home");
      setScreenStack([]);
      setExitProbe("home");
    }, 220);
  }, [dismissSwitcher]);

  useEffect(() => {
    window.__oxExperienceActive = screen === "experience";
    window.__oxExitExperienceToHome = exitExperienceToHome;
    (window as Window & { __oxNavLabsEnabled?: boolean; __oxNavLabsExperiment?: string | null }).__oxNavLabsEnabled =
      labsEnabled;
    (window as Window & { __oxNavLabsExperiment?: string | null }).__oxNavLabsExperiment = labsExperiment;
    return () => {
      window.__oxExperienceActive = false;
      if (window.__oxExitExperienceToHome === exitExperienceToHome) {
        delete window.__oxExitExperienceToHome;
      }
    };
  }, [screen, exitExperienceToHome, labsEnabled, labsExperiment]);

  useEffect(() => {
    const onEscape = () => exitExperienceToHome();
    window.addEventListener(EXPERIENCE_ESCAPE_EVENT, onEscape);
    return () => window.removeEventListener(EXPERIENCE_ESCAPE_EVENT, onEscape);
  }, [exitExperienceToHome]);

  useEffect(() => {
    if (!isAirNavigationDebug()) return;
    window.__oxGestureDebug = (phase, count) => {
      setPointerCount(count);
      setGestureDebug(`${phase} · pointers=${count}`);
    };
    return () => {
      delete window.__oxGestureDebug;
    };
  }, []);

  useEffect(() => {
    if (screen !== "experience" || !opened) {
      airNavRef.current?.stop();
      airNavRef.current = null;
      setAirDebug(null);
      setAirGrabbed(false);
      return;
    }
    /* When Navigation Labs owns an air experiment, skip legacy auto air-nav. */
    if (labsEnabled && (labsExperiment === "air-swipe" || labsExperiment === "palm-fist-throw")) return;
    if (!airEnabled) return;
    let cancelled = false;
    void startAirNavigation({
      onExitHome: exitExperienceToHome,
      onGrabbed: setAirGrabbed,
      onDebug: (snap) => {
        if (isAirNavigationDebug() || labsDiagnostics) setAirDebug(snap);
      },
    }).then((controller) => {
      if (cancelled) {
        controller.stop();
        return;
      }
      airNavRef.current = controller;
    });
    return () => {
      cancelled = true;
      airNavRef.current?.stop();
      airNavRef.current = null;
      setAirGrabbed(false);
    };
  }, [screen, opened, airEnabled, exitExperienceToHome, labsEnabled, labsExperiment, labsDiagnostics]);

  useEffect(() => {
    if (screen !== "experience" || !opened) return;
    if (shouldShowExperienceEscapeHint()) {
      setEscapeHint(true);
      const hide = window.setTimeout(() => {
        setEscapeHint(false);
        markExperienceEscapeHintSeen();
      }, 3200);
      return () => window.clearTimeout(hide);
    }
    setEscapeHint(false);
    return undefined;
  }, [screen, opened?.applicationId]);

  useEffect(() => {
    if (screen !== "experience" || !opened) return;
    /* Labs two-finger experiment owns recognition when enabled. */
    if (labsEnabled && labsExperiment === "two-finger-sweep") return;
    if (labsEnabled && labsExperiment) return; /* other labs experiments: no legacy two-finger */
    const node = immersiveRef.current;
    if (!node) return;
    return attachTwoFingerHorizontalEscape(node, exitExperienceToHome, escapeThresholdsForViewport());
  }, [screen, opened, exitExperienceToHome, labsEnabled, labsExperiment]);

  useEffect(() => {
    if (screen !== "experience") return;
    const cleanups: (() => void)[] = [];
    for (const node of [switcherEdgeLeftRef.current, switcherEdgeRightRef.current]) {
      if (!node) continue;
      cleanups.push(attachDoubleTap(node, openSwitcher));
    }
    return () => {
      for (const stop of cleanups) stop();
    };
  }, [screen, opened, openSwitcher, experienceOfflineMessage]);

  useEffect(() => {
    window.__oxHardwareBack = handleHardwareBack;
    return () => {
      if (window.__oxHardwareBack === handleHardwareBack) delete window.__oxHardwareBack;
    };
  }, [handleHardwareBack]);

  useEffect(() => {
    if (!props.onHardwareBackReady) return;
    props.onHardwareBackReady(() => handleHardwareBack());
  }, [props, handleHardwareBack]);

  useEffect(() => {
    if (screen !== "experience" || !opened) {
      setLabsHud(null);
      setNavProgress(0);
      return;
    }
    if (!labsEnabled || !labsExperiment) {
      setLabsHud(null);
      return;
    }
    const node = immersiveRef.current;
    if (!node) return;
    const config = getLabsConfig();
    return attachNavLabsController({
      host: node,
      experiment: labsExperiment,
      enabled: true,
      config,
      onExitHome: exitExperienceToHome,
      onGrabbed: setAirGrabbed,
      onHud: (hud) => {
        setLabsHud(hud);
        if (typeof hud.progress === "number") setNavProgress(hud.progress);
      },
    });
  }, [screen, opened, labsEnabled, labsExperiment, exitExperienceToHome]);

  const openHttps = useCallback(
    (url: string) => {
      if (openExternalUrl) {
        void openExternalUrl(url);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [openExternalUrl],
  );

  const refreshMemberships = useCallback(async () => {
    const [directoryResult, membershipResult] = await Promise.all([api.listDirectory(), api.listMyExperience()]);
    const providers = resolveDirectoryProviders(directoryResult.applications);
    setDirectory(providers);
    setMemberships(resolveMemberships(membershipResult.experiences));
    setFeatured((current) => current.map((app) => providers.find((fresh) => fresh.id === app.id) ?? app));
    setSelected((current) => current ? providers.find((fresh) => fresh.id === current.id) ?? current : null);
  }, [api]);

  const findApplication = useCallback(async (query: string) => {
    const result = await api.listDirectory({ q: query });
    const matches = resolveDirectoryProviders(result.applications, { includeUnlistedTrusted: false });
    const normalized = query.trim().toLowerCase();
    return matches.find((app) => app.name.toLowerCase() === normalized) ?? matches[0] ?? null;
  }, [api]);

  const openLocalExperience = useCallback(
    (
      app: DirectoryApplicationView,
      surface: ApplicationSurfaceType = "PUBLIC",
      executionMode?: ExperienceExecutionMode,
    ) => {
      const posture = shellAuthPosture(app.authMode);
      void posture;
      const nextLineup = refreshLineup([app, ...directory]);
      const online = !offline;
      const gate = canOperateOffline(app.offlineCapability, online);
      const targets = providerTargets({ id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes });
      // An explicitly selected mode is honoured or refused; only unselected launches resume the slot's mode.
      const target = executionMode
        ? requireExecutionTarget(targets, executionMode, fixedExecutionMode)
        : chooseExecutionTarget(targets, getExperienceSlot(app.id)?.executionMode ?? null, fixedExecutionMode);
      if (!target) {
        abortExperienceToHome(executionMode && targets.some((item) => item.availability === "AVAILABLE")
          ? `${app.name} has no released ${EXECUTION_MODE_LABEL[executionMode]} on this installation.`
          : notAdmittedNotice(app.id, app.name));
        return;
      }
      if (target.executionMode === "SPACE") {
        // SPACE is continuity-first: readiness is the provider's local preparation, never APP reachability.
        if (!gate.ok) {
          abortExperienceToHome(`${app.name} Space is not prepared for offline use on this installation.`);
          return;
        }
        applyMountPlan(nextLineup, app.id, activeIdRef.current, { app, offlineMessage: null, executionMode: "SPACE", strict: true });
        return;
      }
      if (!gate.ok) {
        abortExperienceToHome(
          gate.reason ??
            "This Experience needs a connection to continue. Your previous state has been preserved.",
        );
        return;
      }
      void (async () => {
        const url = app.xperienceUrl || app.productionUrl;
        const probe = await ensureEntrypointReachable(url);
        if (!probe.ok) {
          abortExperienceToHome(
            probe.reason ?? "This Experience could not be opened. Returning to OS Xperience Home.",
          );
          return;
        }
        applyMountPlan(nextLineup, app.id, activeIdRef.current, {
          app,
          offlineMessage: null,
          executionMode: "APP",
          strict: true,
        });
      })();
      void surface;
    },
    [abortExperienceToHome, applyMountPlan, directory, ensureEntrypointReachable, fixedExecutionMode, offline, refreshLineup],
  );

  const startApplication = useCallback(async (app: DirectoryApplicationView, executionMode?: ExperienceExecutionMode) => {
    const trace = beginLaunchTrace(app);
    launchTraceRef.current = trace;
    markLaunch(trace, "identity");
    setBusyId(app.id);
    setError(null);
    setFrameFailed(false);
    setFrameReady(false);
    setLaunchingApp(app);
    setOpened(null);
    setExperienceOfflineMessage(null);
    setExitingExperience(false);
    exitingRef.current = false;
    markLaunch(trace, "mode_entered");
    navigate("experience");
    try {
      markLaunch(trace, "request");
      if (offline) {
        openLocalExperience({ ...app, experienced: true }, "PUBLIC", executionMode);
        summarizeLaunch(trace);
        return;
      }
      if (!app.experienced) {
        try {
          await api.startExperience(directoryRecordId(app.id));
        } catch {
          /* local open still allowed for PUBLIC / offline-capable */
        }
      }
      markLaunch(trace, "destination");
      try {
        const payload = await api.openExperience(directoryRecordId(app.id), { surface: "PUBLIC" });
        markLaunch(trace, "response");
        const nextLineup = refreshLineup([{ ...app, experienced: true }]);
        applyMountPlan(nextLineup, app.id, activeIdRef.current, {
          app: { ...app, experienced: true },
          executionMode: executionMode ?? null,
          strict: Boolean(executionMode),
        });
        // Prefer server embed URL when available without remounting if already warm.
        setOpened(trustedOpenPayload(payload, app));
        setLaunchingApp(null);
        void refreshMemberships();
      } catch {
        openLocalExperience({ ...app, experienced: true }, "PUBLIC", executionMode);
      }
      summarizeLaunch(trace);
    } catch (reason) {
      setLaunchingApp(null);
      setOpened(null);
      setError(reason instanceof Error ? reason.message : "The application could not be added.");
      navigate("detail");
      setSelected(app);
    } finally {
      setBusyId(null);
    }
  }, [api, refreshMemberships, navigate, offline, openLocalExperience, applyMountPlan, refreshLineup]);

  const openApplication = useCallback(async (
    app: DirectoryApplicationView,
    surface: ApplicationSurfaceType = "PUBLIC",
    executionMode?: ExperienceExecutionMode,
  ) => {
    if (!app.experienced) {
      setSelected(app);
      navigate("detail");
      return;
    }
    if (surface === "MANAGEMENT" && !app.canManage) {
      setError("Management access is not available for this application.");
      return;
    }
    const trace = beginLaunchTrace(app);
    launchTraceRef.current = trace;
    markLaunch(trace, "identity");
    setBusyId(app.id);
    setError(null);
    setFrameFailed(false);
    setFrameReady(false);
    setLaunchingApp(app);
    setOpened(null);
    setExperienceOfflineMessage(null);
    setExitingExperience(false);
    exitingRef.current = false;
    markLaunch(trace, "mode_entered");
    navigate("experience");
    try {
      markLaunch(trace, "request");
      if (offline || surface === "PUBLIC") {
        openLocalExperience(app, surface, executionMode);
        if (!offline) {
          try {
            const payload = await api.openExperience(directoryRecordId(app.id), { surface });
            setOpened(trustedOpenPayload(payload, app));
          } catch {
            /* local mount already active */
          }
          void refreshMemberships();
        }
        summarizeLaunch(trace);
        return;
      }
      try {
        const payload = await api.openExperience(directoryRecordId(app.id), { surface });
        markLaunch(trace, "response");
        markLaunch(trace, "destination");
        setOpened(payload);
        setLaunchingApp(null);
        rememberOpenedExperience(app, surface);
        void refreshMemberships();
      } catch {
        openLocalExperience(app, surface);
      }
      summarizeLaunch(trace);
    } catch (reason) {
      setLaunchingApp(null);
      setOpened(null);
      setError(reason instanceof Error ? reason.message : `Could not open ${app.name}.`);
      navigate(surface === "MANAGEMENT" ? "detail" : "my-experience");
    } finally {
      setBusyId(null);
    }
  }, [api, refreshMemberships, navigate, offline, openLocalExperience]);

  const routeObjective = useCallback(async (text: string) => {
    const utterance = parseExperienceUtterance(text);
    setVoiceState("resolving");
    if (utterance.kind === "show_experience") {
      navigate("my-experience");
      setVoiceMessage("Opening My Xperience.");
      setVoiceState("ready");
      return;
    }
    if (utterance.kind === "category") {
      setCategory(utterance.category);
      setSearchQuery("");
      navigate("directory");
      setVoiceMessage(`Showing ${utterance.category} applications.`);
      setVoiceState("ready");
      return;
    }
    if (utterance.kind === "search") {
      setSearchText(utterance.query);
      setSearchQuery(utterance.query);
      navigate("search");
      setVoiceMessage(`Searching for ${utterance.query}.`);
      setVoiceState("ready");
      return;
    }
    if (utterance.kind === "open" || utterance.kind === "start_experience") {
      try {
        const app = await findApplication(utterance.query);
        if (!app) {
          setSearchText(utterance.query);
          setSearchQuery(utterance.query);
          navigate("search");
          setVoiceMessage(`No matching application was found for ${utterance.query}.`);
          setVoiceState("ready");
          return;
        }
        if (utterance.kind === "start_experience") {
          await startApplication(app);
          navigate("my-experience");
          setVoiceMessage(`${app.name} was added to My Xperience.`);
        } else {
          await openApplication(app);
          setVoiceMessage(app.experienced ? `Opening ${app.name}.` : `Review ${app.name} before adding it.`);
        }
        setVoiceState("ready");
      } catch (reason) {
        setVoiceMessage(reason instanceof Error ? reason.message : "That objective could not be completed.");
        setVoiceState("error");
      }
      return;
    }
    setVoiceMessage("Try asking to open an application, browse a category, or show your applications.");
    setVoiceState("ready");
  }, [findApplication, openApplication, startApplication]);

  function submitObjective(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = searchText.trim();
    if (text) void routeObjective(text);
  }

  async function searchApplications(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchText.trim();
    setSearchQuery(query);
    navigate("search");
  }

  async function beginListening() {
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setVoiceState("unavailable");
      setVoiceMessage("Voice input is not available in this browser. Use an example or type an objective.");
      return;
    }
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
      } catch {
        setVoiceState("unavailable");
        setVoiceMessage("Microphone permission was not granted. Enable it in your device or browser settings, then return here.");
        return;
      }
    }
    recognitionRef.current?.abort();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setVoiceState("listening");
      setVoiceMessage("Listening…");
    };
    recognition.onresult = (event) => {
      let transcript = "";
      let complete = false;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
        complete ||= event.results[index].isFinal;
      }
      setVoiceText(transcript.trim());
      if (complete && transcript.trim()) {
        setVoiceState("understanding");
        setVoiceMessage("Understanding your objective…");
        recognition.stop();
        void routeObjective(transcript.trim());
      }
    };
    recognition.onerror = (event) => {
      setVoiceState(event.error === "not-allowed" || event.error === "service-not-allowed" ? "unavailable" : "error");
      setVoiceMessage(event.error === "not-allowed" ? "Microphone permission was not granted." : "Voice input ended unexpectedly. You can try again.");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceState((current) => current === "listening" ? "idle" : current);
      setVoiceMessage((current) => current === "Listening…" ? "No speech was detected. Try again." : current);
    };
    try {
      recognition.start();
    } catch {
      setVoiceState("error");
      setVoiceMessage("Voice input could not start. Try again.");
    }
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setVoiceState("idle");
    setVoiceMessage("Voice input stopped.");
  }

  async function confirmStop() {
    if (!stopTarget) return;
    setBusyId(stopTarget.applicationId);
    try {
      await api.stopExperience(directoryRecordId(stopTarget.applicationId));
      setStopTarget(null);
      await refreshMemberships();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This membership could not be removed.");
    } finally {
      setBusyId(null);
    }
  }

  const activeProvider = useMemo(
    () => lineup.find((entry) => entry.experienceId === activeExperienceId) ?? null,
    [lineup, activeExperienceId],
  );
  const activeTargets = useMemo<ExperienceTarget[]>(
    () => activeExperienceId
      ? availableProviderTargets({
          id: activeExperienceId,
          entrypoint: activeProvider?.entrypoint,
          executionModes: activeProvider?.executionModes,
        })
      : [],
    // catalogRevision / spaceRevision: targets re-resolve when a verified catalog or Space registration changes.
    [activeExperienceId, activeProvider, catalogRevision, spaceRevision],
  );
  const activeAppTarget = activeTargets.find((target) => target.executionMode === "APP") ?? null;
  const activeSpaceTarget = activeTargets.find((target) => target.executionMode === "SPACE") ?? null;
  const modeSwitchAllowed = !fixedExecutionMode;
  const tvChannelId = executionMode === "SPACE" ? activeSpaceTarget?.broadcastChannelId ?? null : null;

  const openTv = useCallback(async () => {
    setTvState("preparing"); setSpaceNotice(null);
    const base = broadcastBaseFor(activeExperienceId);
    if (!tvChannelId) { setTvState("unavailable"); return; }
    try {
      const store = new IndexedDbBroadcastHydrationStore();
      // Without a broadcast route the kernel still serves media this installation already holds.
      const result = await hydrateAndPrepareSpaceTv({ channelId: tvChannelId, routeAvailable: !offline && Boolean(base), now: () => new Date(), store, source: base ? createHttpBroadcastSource(base) : noRouteBroadcastSource });
      const playback = result.playback;
      if (!playback || playback.state !== "LOCAL_PLAYING") { setTvState("unavailable"); return; }
      const local = await store.loadMedia(playback.media.mediaId) as (typeof playback.media & { bytes?: Uint8Array });
      const blob = localMediaBlob(local);
      if (!blob) { setTvState("unavailable"); return; }
      if (tvUrlRef.current) URL.revokeObjectURL(tvUrlRef.current);
      tvUrlRef.current = URL.createObjectURL(blob); setTvSource(tvUrlRef.current); setTvTitle(playback.media.title); setTvState("playing");
    } catch { setTvState("unavailable"); }
  }, [activeExperienceId, offline, tvChannelId]);

  const revolveSpace = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const nextLineup = refreshLineup();
    const next = nextProviderWithMode(
      nextLineup.map((entry) => ({ id: entry.experienceId, entrypoint: entry.entrypoint, executionModes: entry.executionModes })),
      id,
      "SPACE",
    );
    if (!next) { setSpaceNotice("NO OTHER EXTERNAL SPACES"); return; }
    applyMountPlan(nextLineup, next.id, id, { executionMode: "SPACE" });
  }, [applyMountPlan, refreshLineup]);

  const directoryModes = useCallback(
    (app: DirectoryApplicationView) =>
      availableProviderTargets({ id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes })
        .map((target) => target.executionMode),
    [catalogRevision],
  );
  const selectedModes = selected ? directoryModes(selected) : [];

  useEffect(() => () => { if (tvUrlRef.current) URL.revokeObjectURL(tvUrlRef.current); }, []);

  const filteredDirectory = directory.filter((app) => category === "All" || app.category === category);
  const searchResults = directory.filter((app) => {
    const query = searchQuery.toLowerCase();
    return !query || `${app.name} ${app.category} ${app.description ?? ""} ${app.developerName ?? ""}`.toLowerCase().includes(query);
  });
  const filteredMemberships = memberships.filter((item) => {
    if (membershipFilter === "Active") return item.status === "ACTIVE";
    if (membershipFilter === "Paused") return item.status === "PAUSED";
    if (membershipFilter === "Recently Used") return Boolean(item.lastOpenedAt);
    return true;
  }).sort((a, b) => membershipFilter === "Recently Used"
    ? new Date(b.lastOpenedAt ?? 0).getTime() - new Date(a.lastOpenedAt ?? 0).getTime()
    : 0);
  const continueItems = [...memberships]
    .filter((item) => item.status === "ACTIVE")
    .sort((a, b) => new Date(b.lastOpenedAt ?? b.addedAt).getTime() - new Date(a.lastOpenedAt ?? a.addedAt).getTime())
    .slice(0, 4);
  const forYouItems = featured.slice(0, 4);

  const xperienceProviders = useMemo(
    () => [...memberships.map((item) => item.application), ...directory],
    [directory, memberships],
  );
  const appEntries = useMemo(
    () => xperienceAppEntries(xperienceProviders, !offline),
    // catalogRevision: a newly verified signed catalog can release or withdraw targets.
    [xperienceProviders, offline, catalogRevision],
  );
  const spaceCandidates = useMemo(
    () => xperienceSpaceCandidates(xperienceProviders),
    [xperienceProviders, catalogRevision, spaceRevision],
  );
  const spaceRegistrations = useMemo(() => readSpaceRegistrations(), [spaceRevision]);

  const importSpace = async (bytes: Uint8Array, acceptUpdate = false) => {
    const result = await importSpaceLaunchFile(bytes, { xperienceVersion: props.xperienceVersion ?? "0.0.0", acceptUpdate });
    if (result.ok) {
      setSpaceImport({ code: result.outcome });
      setSpaceRevision((value) => value + 1);
      // A newer version keeps the same home entry; only its trusted label is refreshed.
      const { providerId, name } = result.registration;
      if (result.outcome === "UPDATED" && findSpaceHomeEntry(providerId)) {
        recordSpaceHomeEntry({ spaceId: providerId, name, source: "LAUNCH_FILE" });
        if (homeEntryHost && pinnedShortcuts.includes(spaceShortcutId(providerId))) {
          await homeEntryHost.update(spaceShortcutRequest({ spaceId: providerId, name })).catch(() => undefined);
        }
      }
      return;
    }
    setSpaceImport({ code: result.code, ...(result.code === "UPDATE_AVAILABLE" ? { pending: bytes, offeredVersion: result.offeredVersion } : {}) });
  };

  const onSpaceFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // The picker admits any octet-stream: refuse oversized picks before reading them into memory.
    if (file.size > SPACE_LAUNCH_MAX_BYTES) {
      setSpaceImport({ code: "LAUNCH_FILE_TOO_LARGE" });
      return;
    }
    try {
      await importSpace(new Uint8Array(await file.arrayBuffer()));
    } catch {
      setSpaceImport({ code: "IMPORT_FAILED" });
    }
  };

  // Preparation acquires published state into the Offline Kernel; the launch file itself carries none of it.
  const prepareSpace = async (providerId: string, channelId: string) => {
    const base = broadcastBaseFor(providerId);
    if (!base || offline) { setPrepareNotice("Preparing this Space needs a connection and a broadcast route on this installation."); return; }
    setPreparingSpaceId(providerId);
    setPrepareNotice(null);
    try {
      const result = await hydrateAndPrepareSpaceTv({ channelId, routeAvailable: true, now: () => new Date(), store: new IndexedDbBroadcastHydrationStore(), source: createHttpBroadcastSource(base) });
      if (result.state !== "LOCAL_PLAYING") setPrepareNotice("This Space couldn't be prepared yet. Try again while connected.");
    } catch {
      setPrepareNotice("This Space couldn't be prepared yet. Try again while connected.");
    } finally {
      setPreparingSpaceId(null);
      setSpaceRevision((value) => value + 1);
    }
  };
  const spaceEntries = spaceCandidates.map((candidate) => {
    const checking = Boolean(candidate.target && candidate.channelId && spacePlayable === null);
    const classified = classifySpaceReadiness({
      released: Boolean(candidate.target),
      offlineCapability: candidate.app.offlineCapability,
      channelId: candidate.channelId,
      locallyPlayable: spacePlayable?.[candidate.app.id] ?? false,
      online: !offline,
    });
    return { ...candidate, ...classified, checking, enterable: classified.enterable && !checking };
  });

  // Space readiness reads only the local Offline Kernel store — no Directory, App or broadcast request.
  useEffect(() => {
    if (screen !== "xperience" && screen !== "xperience-space" && screen !== "detail") {
      playableCheckKeyRef.current = "";
      return;
    }
    let cancelled = false;
    // Background catalog refreshes re-check quietly; entering the screen, a connectivity change or a
    // registration/prepared-state change is shown as CHECKING (a running Space may have prepared itself).
    const checkKey = `${screen}|${offline}|${spaceRevision}`;
    if (playableCheckKeyRef.current !== checkKey) {
      playableCheckKeyRef.current = checkKey;
      setSpacePlayable(null);
    }
    void (async () => {
      const store = new IndexedDbBroadcastHydrationStore();
      const next: Record<string, boolean> = {};
      for (const candidate of spaceCandidates) {
        if (candidate.target && candidate.channelId) next[candidate.app.id] = await spaceLocallyPlayable(store, candidate.channelId);
      }
      if (!cancelled) setSpacePlayable(next);
    })();
    return () => { cancelled = true; };
  }, [screen, spaceCandidates, spaceRevision, offline]);

  const launchFromXperience = (app: DirectoryApplicationView, mode: ExperienceExecutionMode) => {
    const entry: XperienceEntry = mode === "APP" ? "APPS" : "SPACE";
    xperienceEntryRef.current = entry;
    setXperienceEntry(entry);
    setRestoreNotice(null);
    if (mode === "APP") {
      void (app.experienced ? openApplication(app, "PUBLIC", "APP") : startApplication(app, "APP"));
      return;
    }
    // Space consumption is public and local: no Directory server, membership call or App probe.
    setError(null);
    setFrameFailed(false);
    setFrameReady(false);
    setLaunchingApp(app);
    setOpened(null);
    setExperienceOfflineMessage(null);
    setExitingExperience(false);
    exitingRef.current = false;
    navigate("experience");
    openLocalExperience({ ...app, experienced: true }, "PUBLIC", "SPACE");
  };

  /* Space Installation V1 — home entries. Android lists and pins; OS Xperience decides what an entry resolves to. */
  const homeEntries = useMemo(() => readSpaceHomeEntries(), [spaceRevision]);
  const homeEntryStatus = (app: DirectoryApplicationView) => {
    const eligibility = spaceHomeEntryEligibility({ id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes });
    const recorded = homeEntries.some((entry) => entry.spaceId === app.id);
    const pinned = pinnedShortcuts.includes(spaceShortcutId(app.id));
    return { eligibility, recorded, pinned, state: spaceHomeEntryState({ supported: homeEntrySupported, eligible: eligibility.eligible, recorded, pinned }) };
  };

  const refreshHomeEntries = useCallback(async () => {
    if (!homeEntryHost) return;
    try {
      const supported = await homeEntryHost.supported();
      setHomeEntrySupported(supported);
      if (!supported) return;
      const pinned = await homeEntryHost.pinnedShortcutIds();
      // An Android entry OS Xperience no longer records is disabled rather than left live.
      const stale = staleSpaceShortcuts(pinned);
      for (const id of stale) await homeEntryHost.disable(id).catch(() => undefined);
      setPinnedShortcuts(pinned.filter((id) => !stale.includes(id)));
      const pending = pendingPinRef.current;
      if (pending && pinned.includes(spaceShortcutId(pending.spaceId))) {
        pendingPinRef.current = null;
        setHomeEntryNotice(`${pending.name} is on your Home Screen.`);
      }
    } catch {
      setHomeEntrySupported(false);
    }
  }, [homeEntryHost]);

  useEffect(() => {
    if (!homeEntryHost) return;
    void refreshHomeEntries();
    // The launcher's pin confirmation is a separate window: re-read Android's pinned state when OS Xperience regains focus.
    const onReturn = () => { if (document.visibilityState === "visible") void refreshHomeEntries(); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const unsubscribe = homeEntryHost.onPinnedChange(() => {
      void refreshHomeEntries();
      window.setTimeout(() => void refreshHomeEntries(), 1000);
    });
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [homeEntryHost, refreshHomeEntries]);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setStoragePersisted).catch(() => setStoragePersisted(null));
  }, []);

  const addSpaceToHomeScreen = async (app: DirectoryApplicationView) => {
    if (!homeEntryHost || !homeEntrySupported) return;
    const eligibility = spaceHomeEntryEligibility({ id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes });
    if (!eligibility.eligible) {
      setHomeEntryNotice("This Space can't be added to the Home Screen until it is installed from a verified source.");
      return;
    }
    const { presentation } = eligibility;
    recordSpaceHomeEntry(presentation);
    setSpaceRevision((value) => value + 1);
    try {
      const result = await homeEntryHost.requestPin(spaceShortcutRequest(presentation));
      if (!result.requested) throw new Error("PIN_NOT_REQUESTED");
      pendingPinRef.current = result.alreadyPinned ? null : { spaceId: presentation.spaceId, name: presentation.name };
      setHomeEntryNotice(result.alreadyPinned ? `${presentation.name} is on your Home Screen.` : `Confirm on your Home Screen to add ${presentation.name}.`);
    } catch {
      removeSpaceHomeEntry(app.id);
      setSpaceRevision((value) => value + 1);
      setHomeEntryNotice(`${presentation.name} couldn't be added to the Home Screen.`);
      return;
    }
    for (const delay of [1500, 5000, 12000]) window.setTimeout(() => void refreshHomeEntries(), delay);
  };

  const removeFromHomeScreen = async (app: DirectoryApplicationView, name: string) => {
    removeSpaceHomeEntry(app.id);
    setSpaceRevision((value) => value + 1);
    // Android does not let an app unpin an icon; the entry is disabled so it can no longer open the Space.
    await homeEntryHost?.disable(spaceShortcutId(app.id)).catch(() => undefined);
    await refreshHomeEntries();
    setHomeEntryNotice(`${name} was removed from the Home Screen. If your launcher still shows the icon, it is disabled and can be dragged away. Registration and offline data are unchanged.`);
  };

  const deleteOfflineData = async (target: { providerId: string; name: string; channelId: string }) => {
    setDeleteOfflineTarget(null);
    try {
      await deletePreparedChannel(new IndexedDbBroadcastHydrationStore(), target.channelId);
      setHomeEntryNotice(`${target.name} offline data was deleted. Prepare it again to run offline.`);
    } catch {
      setHomeEntryNotice(`${target.name} offline data couldn't be deleted.`);
    } finally {
      setSpaceRevision((value) => value + 1);
    }
  };

  /** INSTALL SPACE: the build's signed artifact goes through the same verifier as a picked file. */
  const installBundledSpace = async (providerId: string) => {
    const path = bundledSpaceArtifact(providerId);
    if (!path) return;
    try {
      const response = await fetch(new URL(path, document.baseURI));
      if (!response.ok) throw new Error("ARTIFACT_UNAVAILABLE");
      await importSpace(new Uint8Array(await response.arrayBuffer()));
    } catch {
      setSpaceImport({ code: "IMPORT_FAILED" });
    }
  };

  /** Home entry → Space identity → SPACE, opened directly; anything else is shown honestly, never substituted. */
  const openHomeEntrySpace = async (spaceId: string, context?: { apps?: DirectoryApplicationView[]; online?: boolean }) => {
    const apps = context?.apps ?? [...memberships.map((item) => item.application), ...directory];
    const online = context?.online ?? !offline;
    const show = (view: SpaceLaunchView) => {
      setSpaceLaunch(view);
      navigate("space-launch", { replace: true });
    };
    const resolution = resolveInstalledSpace(spaceId, { apps, fixedMode: fixedExecutionMode });
    if (resolution.kind === "INVALID_TARGET") return show({ status: "INVALID" });
    if (resolution.kind === "NOT_INSTALLED") return show({ status: "NOT_INSTALLED", spaceId });
    const name = findSpaceRegistration(spaceId)?.name ?? resolution.entry.label;
    if (resolution.kind === "UNAVAILABLE") return show({ status: "UNAVAILABLE", spaceId, name });
    const { app, target } = resolution;
    const channelId = target.broadcastChannelId ?? null;
    const playable = channelId ? await spaceLocallyPlayable(new IndexedDbBroadcastHydrationStore(), channelId) : false;
    const { readiness } = classifySpaceReadiness({ released: true, offlineCapability: app.offlineCapability, channelId, locallyPlayable: playable, online });
    if (readiness !== "READY_OFFLINE" && readiness !== "PREPARED") return show({ status: "NOT_READY", spaceId, name, readiness, channelId });
    setSpaceLaunch(null);
    autoplaySpaceRef.current = channelId ? app.id : null;
    launchFromXperience(app, "SPACE");
  };

  /** Leaving the launch screen goes to OS Xperience Home and leaves no Experience running underneath. */
  leaveSpaceLaunchRef.current = () => {
    setSpaceLaunch(null);
    if (activeIdRef.current) {
      leaveXperienceMode();
      setMountedFrames([]);
      setOpened(null);
      setLaunchingApp(null);
      setActiveExperienceId(null);
    }
    setScreenStack([]);
    setScreen("home");
  };

  processSpaceLaunchRef.current = async (raw, context) => {
    const parsed = parseSpaceLaunch(raw);
    if (!parsed.ok) {
      setSpaceLaunch({ status: "INVALID" });
      navigate("space-launch", { replace: true });
      return;
    }
    await openHomeEntrySpace(parsed.spaceId, context);
  };

  // Warm start: the running process receives the launch and switches directly; no restart, no second runtime.
  useEffect(() => {
    if (!homeEntryHost) return;
    return homeEntryHost.onLaunch(() => {
      void homeEntryHost.takeLaunch().then((raw) => {
        if (raw == null) return;
        if (!localBootDoneRef.current) {
          pendingSpaceLaunchRef.current = raw;
          return;
        }
        setSpaceLaunch(openingSpaceLaunch(raw));
        navigate("space-launch", { replace: true });
        void processSpaceLaunchRef.current(raw);
      }).catch(() => undefined);
    });
  }, [homeEntryHost, navigate]);

  // A home-entry launch enters the running Space with its local broadcast on air.
  useEffect(() => {
    const id = autoplaySpaceRef.current;
    if (!id || screen !== "experience" || executionMode !== "SPACE" || activeExperienceId !== id || !tvChannelId || tvState !== "idle") return;
    autoplaySpaceRef.current = null;
    void openTv();
  }, [screen, executionMode, activeExperienceId, tvChannelId, tvState, openTv]);

  const restoreNoticeView = restoreNotice ? (
    <p className="ox-restore-notice" role="status" data-testid="restore-notice">
      {restoreNotice}{" "}
      <button type="button" className="ox-text-link" onClick={() => setRestoreNotice(null)}>
        Dismiss
      </button>
    </p>
  ) : null;
  const readySpaceCount = spaceEntries.filter((entry) => entry.readiness === "READY_OFFLINE" || entry.readiness === "PREPARED").length;
  const homeEntryNoticeView = homeEntryNotice ? (
    <p className="ox-restore-notice" role="status" data-testid="home-entry-notice">
      {homeEntryNotice}{" "}
      <button type="button" className="ox-text-link" onClick={() => setHomeEntryNotice(null)}>Dismiss</button>
    </p>
  ) : null;

  const renderSpaceManage = (app: DirectoryApplicationView, name: string, channelId: string | null, readinessLabel: string, home: ReturnType<typeof homeEntryStatus>) => {
    const registration = spaceRegistrations.find((item) => item.providerId === app.id) ?? null;
    const presentation = home.eligibility.eligible ? home.eligibility.presentation : null;
    return <div className="ox-space-manage" data-testid={`space-manage-${app.id}`}>
      <dl>
        <div><dt>Publisher</dt><dd>{registration?.publisherName ?? (presentation ? "OS Xperience signed catalog" : "Not verified")}</dd></div>
        <div><dt>Verification</dt><dd data-testid={`space-verification-${app.id}`}>{registration ? "Verified publisher signature" : presentation ? "Verified signed catalog release" : "Not verified"}</dd></div>
        <div><dt>Version</dt><dd>{registration?.version ?? presentation?.version ?? "—"}</dd></div>
        <div><dt>Channel</dt><dd>{channelId ?? "—"}</dd></div>
        <div><dt>Offline status</dt><dd>{readinessLabel}</dd></div>
        <div><dt>Home Screen</dt><dd data-testid={`space-home-state-${app.id}`}>{HOME_ENTRY_LABEL[home.state]}</dd></div>
        <div><dt>Offline storage</dt><dd>{storagePersisted ? "Persistent" : storagePersisted === false ? "Best effort — the system may clear it when storage is low" : "Unknown"}</dd></div>
      </dl>
      <div className="ox-space-manage-actions">
        {home.recorded || home.pinned ? <button type="button" className="ox-button secondary compact" data-testid={`remove-home-${app.id}`} onClick={() => void removeFromHomeScreen(app, name)}>Remove from Home Screen</button> : null}
        {channelId ? <button type="button" className="ox-button secondary compact" data-testid={`delete-offline-${app.id}`} onClick={() => setDeleteOfflineTarget({ providerId: app.id, name, channelId })}>Delete offline data</button> : null}
      </div>
      <p className="ox-space-manage-help">Remove from Home Screen removes only the icon. Remove registration removes only the verified registration. Delete offline data removes only the prepared media and schedule.</p>
    </div>;
  };

  /** Directory → Space details: INSTALL SPACE → PREPARE FOR OFFLINE → ADD TO HOME SCREEN / ENTER. */
  const renderSpaceInstall = (app: DirectoryApplicationView) => {
    const artifact = bundledSpaceArtifact(app.id);
    const registration = spaceRegistrations.find((item) => item.providerId === app.id) ?? null;
    if (!artifact && !registration) return null;
    const entry = spaceEntries.find((item) => item.app.id === app.id) ?? null;
    const home = homeEntryStatus(app);
    const name = registration?.name ?? app.name;
    const preparing = preparingSpaceId === app.id;
    const checking = !entry || entry.checking;
    const ready = !checking && (entry!.readiness === "READY_OFFLINE" || entry!.readiness === "PREPARED");
    const stage = spaceInstallationStage({ registered: Boolean(registration), readiness: checking ? "CHECKING" : entry!.readiness, preparing, homeEntry: home.state });
    return <section className="ox-space-install" data-testid={`space-install-${app.id}`} data-stage={stage} data-home-entry={home.state}>
      <small>SPACE</small>
      <h2>{name}</h2>
      <p>{registration?.description ?? "Your own digital environment, running on this installation."}</p>
      {registration ? <ul className="ox-space-steps"><li>✓ Publisher verified</li><li>✓ Space registered</li></ul> : (
        <button type="button" className="ox-button primary wide" data-testid={`install-space-${app.id}`} onClick={() => void installBundledSpace(app.id)}>Install Space</button>
      )}
      {spaceImport ? <p className="ox-restore-notice" role="status" data-testid="space-install-status" data-code={spaceImport.code}>{spaceImport.code === "REGISTERED" ? `${name} Space added.` : SPACE_IMPORT_MESSAGE[spaceImport.code]}</p> : null}
      {registration && preparing ? <div className="ox-space-preparing" role="status" data-testid={`install-preparing-${app.id}`}><p>Preparing for offline use…</p><span className="ox-progress is-indeterminate" aria-hidden="true"><i /></span></div> : null}
      {registration && !preparing && !checking && entry!.readiness === "NOT_PREPARED" && entry!.channelId ? (
        <button type="button" className="ox-button primary wide" data-testid={`install-prepare-${app.id}`} disabled={preparingSpaceId !== null} onClick={() => void prepareSpace(app.id, entry!.channelId!)}>Prepare for offline</button>
      ) : null}
      {registration && !checking && entry!.readiness === "ONLINE_PREPARATION_REQUIRED" ? <p className="ox-empty-copy">Connect when available to prepare this Space.</p> : null}
      {ready ? <p className="ox-space-ready" data-testid={`install-ready-${app.id}`}>{home.state === "INSTALLED" ? "Installed on this device." : "Ready offline."}</p> : null}
      {ready && (home.state === "AVAILABLE" || home.state === "REQUESTED") ? <button type="button" className="ox-button primary wide" data-testid={`install-add-home-${app.id}`} onClick={() => void addSpaceToHomeScreen(app)}>Add to Home Screen</button> : null}
      {registration && entry?.enterable ? <button type="button" className={`ox-button ${ready ? "secondary" : "primary"} wide`} data-testid={`install-enter-${app.id}`} onClick={() => launchFromXperience(app, "SPACE")}>{home.state === "INSTALLED" ? "Enter Space" : "Enter now"}</button> : null}
      {registration ? <button type="button" className="ox-text-link" data-testid={`install-manage-${app.id}`} onClick={() => { setSpaceManageId(app.id); navigate("xperience-space"); }}>Manage</button> : null}
      {prepareNotice ? <p className="ox-restore-notice" role="status">{prepareNotice}</p> : null}
      {homeEntryNoticeView}
    </section>;
  };
  const appsEntry = xperienceEntry === "APPS";
  const switcherIsolation: ExperienceExecutionMode | null = xperienceEntry === "APPS" ? "APP" : xperienceEntry === "SPACE" ? executionMode : null;

  const renderGrid = (apps: DirectoryApplicationView[], options?: { home?: boolean; dense?: boolean }) => loading
    ? <Skeletons count={options?.home ? 4 : 6} home={options?.home} />
    : apps.length === 0
    ? <div className="ox-inline-empty"><p>No applications match this view.</p></div>
    : <div className={`ox-grid${options?.home ? " ox-home-grid" : ""}${options?.dense ? " ox-dense-grid" : ""}`}>{apps.map((app) => <AppCard key={app.id} app={app} modes={directoryModes(app)} dense={Boolean(options?.home || options?.dense)} busy={busyId === app.id} onSelect={() => {
      const scroller = mainScrollRef.current;
      if (scroller && (screen === "directory" || screen === "search" || screen === "home")) {
        directoryScrollRef.current = scroller.scrollTop;
      }
      setSelected(app);
      navigate("detail");
    }} onPrimary={() => void (app.experienced ? openApplication(app, "PUBLIC") : startApplication(app))} />)}</div>;

  function PageHeader({ eyebrow, title, copy }: { eyebrow?: string; title: string; copy?: string }) {
    return <header className="ox-page-header">{eyebrow ? <small>{eyebrow}</small> : null}<h1>{title}</h1>{copy ? <p>{copy}</p> : null}</header>;
  }

  function BackButton({ destination = "directory" }: { destination?: Screen }) {
    return (
      <button
        className="ox-icon-button"
        type="button"
        aria-label="Go back"
        onClick={() => {
          navigate(destination);
          window.requestAnimationFrame(() => {
            if (mainScrollRef.current && (destination === "directory" || destination === "search" || destination === "home")) {
              mainScrollRef.current.scrollTop = directoryScrollRef.current;
            }
          });
        }}
      >
        <Icon name="back" />
      </button>
    );
  }

  return <div className="ox-root" data-testid="os-experience">
    {isDesktop ? <aside className="ox-sidebar">
      <Brand />
      <nav className="ox-side-nav" aria-label="Primary navigation">
        <button data-testid="nav-home" className={screen === "home" ? "active" : ""} onClick={() => navigate("home")}><Icon name="home" />Home</button>
        <button data-testid="nav-directory" className={screen === "directory" || screen === "search" || screen === "detail" ? "active" : ""} onClick={() => navigate("directory")}><Icon name="directory" />Directory</button>
        <button data-testid="nav-xperience" className={XPERIENCE_SCREENS.includes(screen) ? "active" : ""} onClick={() => navigate("xperience")}><Icon name="xperience" />Xperience</button>
        <button data-testid="nav-my-experience" className={screen === "my-experience" ? "active" : ""} onClick={() => navigate("my-experience")}><Icon name="experience" />My Xperience</button>
        <button className={screen === "profile" ? "active" : ""} onClick={() => navigate("profile")}><Icon name="profile" />Profile</button>
      </nav>
      <div className="ox-side-user"><span>{initials(userName)}</span><div><strong>{userName}</strong><small>Participant</small></div></div>
    </aside> : null}

    <main className="ox-main" ref={(node) => { mainScrollRef.current = node; }}>
      <div className="ox-topbar"><Brand /><div><button className="ox-icon-button" aria-label="Voice" data-testid="top-voice" onClick={() => navigate("voice")}><Icon name="voice" /></button><button className="ox-icon-button" aria-label="Notifications"><Icon name="bell" /></button><button className="ox-avatar" aria-label="Open profile" onClick={() => navigate("profile")}>{initials(userName)}</button></div></div>
      {offline ? <div className="ox-offline-banner" role="status" data-testid="offline-banner">You&apos;re offline. OS Xperience is running from this installation — online sync will resume when you reconnect.</div> : null}
      {revealBanner && screen !== "experience" ? (
        <div className="ox-reveal-banner" role="status" data-testid="reveal-banner">
          <div>
            <strong>{revealBanner.name} is now available</strong>
            <p>A new Experience was revealed for this installation.</p>
          </div>
          <button
            type="button"
            className="ox-button primary compact"
            onClick={() => {
              markRevealSeen([revealBanner.id]);
              const next = refreshLineup();
              applyMountPlan(next, revealBanner.id, activeIdRef.current);
              setRevealBanner(null);
            }}
          >
            Enter
          </button>
          <button
            type="button"
            className="ox-button secondary compact"
            onClick={() => {
              markRevealSeen([revealBanner.id]);
              setRevealBanner(null);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {error && screen !== "experience" ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {screen === "home" ? <div data-testid="home" className="ox-screen ox-home">
        {restoreNoticeView}
        <div className="ox-home-search-wrap">
          <form data-testid="home-search" className="ox-home-search ox-objective" onSubmit={submitObjective}>
            <Icon name="search" />
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="What do you want to do?" aria-label="Your objective" />
            <button type="button" aria-label="Use voice" onClick={() => navigate("voice")}><Icon name="voice" /></button>
            <button type="submit">Go</button>
          </form>
        </div>

        <section className="ox-section">
          <div className="ox-section-heading"><div><h2>Continue</h2></div><button type="button" onClick={() => navigate("my-experience")}>See all <span>→</span></button></div>
          {loading ? <Skeletons count={4} home /> : continueItems.length ? renderGrid(continueItems.map((item) => item.application), { home: true }) : <div className="ox-inline-empty"><p>Your active applications will appear here.</p><button type="button" onClick={() => navigate("directory")}>Explore Directory</button></div>}
        </section>

        <section className="ox-section">
          <div className="ox-section-heading"><div><h2>For You</h2></div><button type="button" data-testid="explore-directory" onClick={() => navigate("directory")}>See all <span>→</span></button></div>
          {renderGrid(forYouItems, { home: true })}
          {!loading && forYouItems.length === 0 ? <p className="ox-empty-copy">No directory applications are available right now.</p> : null}
        </section>
      </div> : null}

      {screen === "space-launch" ? (() => {
        const view = spaceLaunch ?? { status: "OPENING" as const };
        const name = view.name ?? "Space";
        const routeAvailable = !offline && Boolean(broadcastBaseFor(view.spaceId ?? null));
        return <div data-testid="space-launch" className="ox-screen ox-space-launch" data-status={view.status} data-space-id={view.spaceId}>
          {view.status === "OPENING" ? (
            <section className="ox-launch-shell" aria-live="polite" aria-busy="true">
              <span className="ox-app-glyph" aria-hidden="true">{initials(name)}</span>
              <h1>{view.name ?? "Opening Space"}</h1>
              <p>Opening…</p>
            </section>
          ) : (
            <section className="ox-space-launch-card" role="status">
              <span className="ox-app-glyph" aria-hidden="true">{initials(name)}</span>
              <h1>{view.status === "INVALID" ? "This shortcut can't be opened" : view.status === "NOT_INSTALLED" ? "This Space isn't installed" : name}</h1>
              {view.status === "NOT_READY" ? <>
                <p data-testid="space-launch-message">{name} needs preparation before it can run on this device.</p>
                <span className="ox-mode-badges"><em className="is-blocked">{SPACE_READINESS_LABEL[view.readiness ?? "NOT_PREPARED"]}</em></span>
                {preparingSpaceId === view.spaceId ? <div className="ox-space-preparing" role="status"><p>Preparing for offline use…</p><span className="ox-progress is-indeterminate" aria-hidden="true"><i /></span></div> : null}
                {routeAvailable && view.channelId ? (
                  <button type="button" className="ox-button primary" data-testid="space-launch-prepare" disabled={preparingSpaceId !== null} onClick={() => void (async () => { await prepareSpace(view.spaceId!, view.channelId!); await openHomeEntrySpace(view.spaceId!); })()}>Prepare</button>
                ) : (
                  <p data-testid="space-launch-connect">{offline ? "Connect when available to prepare this Space." : "This device has no preparation route for this Space yet."}</p>
                )}
                {prepareNotice ? <p className="ox-restore-notice" role="status">{prepareNotice}</p> : null}
              </> : null}
              {view.status === "UNAVAILABLE" ? <p data-testid="space-launch-message">{name} isn&apos;t available as a Space on this device right now.</p> : null}
              {view.status === "NOT_INSTALLED" ? <p data-testid="space-launch-message">Install it again from OS Xperience to use this Home Screen entry.</p> : null}
              {view.status === "INVALID" ? <p data-testid="space-launch-message">The request didn&apos;t identify a Space installed on this device. Nothing was opened.</p> : null}
              <button type="button" className="ox-button secondary" data-testid="space-launch-home" onClick={() => leaveSpaceLaunchRef.current()}>Open OS Xperience</button>
            </section>
          )}
        </div>;
      })() : null}

      {screen === "directory" ? <div data-testid="directory" className="ox-screen">
        <PageHeader title="Directory" />
        <form className="ox-search" onSubmit={searchApplications}><Icon name="search" /><input data-testid="search-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search applications" /><button>Search</button></form>
        <div className="ox-filter-row" aria-label="Directory categories">{DIRECTORY_CATEGORIES.map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        {renderGrid(filteredDirectory, { dense: true })}
        {!loading && filteredDirectory.length === 0 ? <div className="ox-inline-empty"><p>No applications match this category.</p><button onClick={() => setCategory("All")}>Show all</button></div> : null}
      </div> : null}

      {screen === "xperience" ? <div data-testid="xperience-chooser" className="ox-screen ox-xperience">
        <PageHeader eyebrow="XPERIENCE" title="What would you like to experience?" copy="The Directory shows what exists. Xperience runs it — as the provider's own App, or as its Space on this installation." />
        {restoreNoticeView}
        <div className="ox-xperience-choices">
          <button type="button" className="ox-xperience-choice is-apps" data-testid="xperience-choice-apps" onClick={() => navigate("xperience-apps")}>
            <span className="ox-xperience-choice-icon" aria-hidden="true"><Icon name="experience" /></span>
            <small>Online-first experiences</small>
            <strong>XPERIENCE APPS</strong>
            <p>Open a provider&apos;s own app, live from its origin.</p>
            <em data-testid="xperience-choice-apps-count">{appEntries.length} {appEntries.length === 1 ? "App" : "Apps"}{offline ? " · connection required" : ""}</em>
          </button>
          <button type="button" className="ox-xperience-choice is-space" data-testid="xperience-choice-space" onClick={() => navigate("xperience-space")}>
            <span className="ox-xperience-choice-icon" aria-hidden="true"><Icon name="xperience" /></span>
            <small>Offline-ready experiences</small>
            <strong>XPERIENCE SPACE</strong>
            <p>Enter a provider&apos;s Space from what this installation has prepared.</p>
            <em data-testid="xperience-choice-space-count">{spaceEntries.length} {spaceEntries.length === 1 ? "Space" : "Spaces"} · {spaceEntries.some((entry) => entry.checking) ? "checking this installation…" : `${readySpaceCount} ready offline`}</em>
          </button>
        </div>
      </div> : null}

      {screen === "xperience-apps" ? <div data-testid="xperience-apps" className="ox-screen ox-xperience-browser">
        <BackButton destination="xperience" />
        <PageHeader eyebrow="XPERIENCE APPS" title="Xperience Apps" copy={offline ? "You're offline. Apps open live from their provider and need a connection." : "Online-first. Each opens the provider's own app."} />
        {restoreNoticeView}
        {appEntries.length ? <div className="ox-xperience-list">{appEntries.map(({ app, availability }) => (
          <article key={app.id} className="ox-xperience-row" data-testid={`xperience-app-${app.id}`} data-availability={availability}>
            <AppGlyph app={app} compact />
            <div>
              <small>{app.category}</small>
              <strong>{app.name}</strong>
              <span className="ox-mode-badges"><em className={availability === "AVAILABLE" ? "is-ok" : "is-blocked"}>{availability === "AVAILABLE" ? "AVAILABLE" : "CONNECTION REQUIRED"}</em></span>
            </div>
            <button type="button" className="ox-button primary compact" data-testid={`open-app-${app.id}`} disabled={busyId === app.id} onClick={() => launchFromXperience(app, "APP")}>
              {busyId === app.id ? "Opening…" : "Open App"}
            </button>
          </article>
        ))}</div> : <div className="ox-inline-empty"><p>No Xperience Apps are released on this installation.</p></div>}
      </div> : null}

      {screen === "xperience-space" ? <div data-testid="xperience-space" className="ox-screen ox-xperience-browser">
        <BackButton destination="xperience" />
        <PageHeader eyebrow="XPERIENCE SPACE" title="Xperience Space" copy="Offline-ready. Spaces run on this installation from what it has prepared." />
        {restoreNoticeView}
        <div className="ox-space-import">
          <input ref={spaceFileRef} type="file" accept={SPACE_IMPORT_ACCEPT} hidden data-testid="space-import-input" onChange={(event) => void onSpaceFileChosen(event)} />
          <button type="button" className="ox-button compact" data-testid="import-space" onClick={() => spaceFileRef.current?.click()}>Import Space</button>
          {spaceImport ? (
            <p className="ox-restore-notice" role="status" data-testid="space-import-status" data-code={spaceImport.code}>
              {SPACE_IMPORT_MESSAGE[spaceImport.code]}
              {spaceImport.pending ? <> <button type="button" className="ox-text-link" data-testid="space-import-accept-update" onClick={() => void importSpace(spaceImport.pending!, true)}>Update to {spaceImport.offeredVersion}</button></> : null}
            </p>
          ) : null}
          {prepareNotice ? <p className="ox-restore-notice" role="status" data-testid="space-prepare-notice">{prepareNotice}</p> : null}
          {homeEntryNoticeView}
        </div>
        {spaceEntries.length ? <div className="ox-xperience-list">{spaceEntries.map((entry) => {
          const registration = spaceRegistrations.find((item) => item.providerId === entry.app.id) ?? null;
          const home = homeEntryStatus(entry.app);
          const name = registration?.name ?? entry.app.name;
          const ready = !entry.checking && (entry.readiness === "READY_OFFLINE" || entry.readiness === "PREPARED");
          const readinessLabel = entry.checking ? "CHECKING" : SPACE_READINESS_LABEL[entry.readiness];
          const stage = spaceInstallationStage({ registered: Boolean(registration), readiness: entry.checking ? "CHECKING" : entry.readiness, preparing: preparingSpaceId === entry.app.id, homeEntry: home.state });
          const managing = spaceManageId === entry.app.id;
          return (
          <article key={entry.app.id} className="ox-xperience-row" data-testid={`xperience-space-${entry.app.id}`} data-readiness={entry.checking ? "CHECKING" : entry.readiness} data-registered={registration ? "true" : "false"} data-home-entry={home.state} data-stage={stage}>
            <AppGlyph app={registration ? { ...entry.app, name: registration.name } : entry.app} compact />
            <div>
              <small>{registration ? `${registration.publisherName} · v${registration.version}` : entry.app.category}</small>
              <strong>{name}</strong>
              <span className="ox-mode-badges">
                <em className={entry.readiness === "READY_OFFLINE" || entry.readiness === "PREPARED" ? "is-ok" : entry.enterable ? "" : "is-blocked"}>{readinessLabel}</em>
                {home.state === "INSTALLED" ? <em className="is-ok" data-testid={`on-home-${entry.app.id}`}>ON HOME SCREEN</em> : null}
              </span>
            </div>
            <div className="ox-xperience-row-actions">
              {!registration && bundledSpaceArtifact(entry.app.id) ? (
                <button type="button" className="ox-button compact" data-testid={`install-space-${entry.app.id}`} onClick={() => void installBundledSpace(entry.app.id)}>Install Space</button>
              ) : null}
              {!entry.checking && entry.readiness === "NOT_PREPARED" && entry.channelId ? (
                <button type="button" className="ox-button compact" data-testid={`prepare-space-${entry.app.id}`} disabled={preparingSpaceId !== null} onClick={() => void prepareSpace(entry.app.id, entry.channelId!)}>
                  {preparingSpaceId === entry.app.id ? "Preparing…" : "Prepare"}
                </button>
              ) : null}
              <button type="button" className="ox-button primary compact" data-testid={`enter-space-${entry.app.id}`} disabled={!entry.enterable || preparingSpaceId === entry.app.id} onClick={() => launchFromXperience(entry.app, "SPACE")}>
                Enter Space
              </button>
              {ready && (home.state === "AVAILABLE" || home.state === "REQUESTED") ? (
                <button type="button" className="ox-button compact" data-testid={`add-home-${entry.app.id}`} onClick={() => void addSpaceToHomeScreen(entry.app)}>Add to Home Screen</button>
              ) : null}
              {registration ? (
                <button type="button" className="ox-text-link" data-testid={`remove-space-${entry.app.id}`} onClick={() => { removeSpaceRegistration(entry.app.id); setSpaceImport(null); setSpaceRevision((value) => value + 1); }}>
                  Remove registration
                </button>
              ) : null}
              <button type="button" className="ox-text-link" data-testid={`manage-space-${entry.app.id}`} aria-expanded={managing} onClick={() => setSpaceManageId(managing ? null : entry.app.id)}>
                {managing ? "Close" : "Manage"}
              </button>
            </div>
            {managing ? renderSpaceManage(entry.app, name, entry.channelId, readinessLabel, home) : null}
          </article>
          );
        })}</div> : <div className="ox-inline-empty"><p>No Xperience Spaces are released on this installation.</p></div>}
      </div> : null}

      {screen === "search" ? <div data-testid="search" className="ox-screen">
        <PageHeader eyebrow="DIRECTORY SEARCH" title={searchQuery ? `Results for “${searchQuery}”` : "Search applications"} copy={`${searchResults.length} result${searchResults.length === 1 ? "" : "s"} from the directory.`} />
        <form className="ox-search" onSubmit={searchApplications}><Icon name="search" /><input data-testid="search-input" autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search applications" /><button>Search</button></form>
        {renderGrid(searchResults)}
        {!loading && searchResults.length === 0 ? <div className="ox-inline-empty"><p>No matching applications were found.</p><button onClick={() => { setSearchText(""); setSearchQuery(""); navigate("directory"); }}>Browse Directory</button></div> : null}
      </div> : null}

      {screen === "detail" && selected ? <div className="ox-screen ox-detail" data-testid="app-details">
        <BackButton />
        <section className="ox-detail-card">
          <div className="ox-detail-lead">
            <AppGlyph app={selected} />
            <div>
              <small>{selected.category}</small>
              <h1>{selected.name}</h1>
              <p>{selected.description || "No public description was provided."}</p>
            </div>
          </div>
          <dl>
            <div><dt>Publisher</dt><dd>{selected.developerName || "Not provided"}</dd></div>
            <div><dt>Version</dt><dd>{selected.version}</dd></div>
            <div><dt>Capabilities</dt><dd>{selected.capabilities.join(", ") || "None declared"}</dd></div>
            <div>
              <dt>Website</dt>
              <dd>
                <button type="button" className="ox-text-link" onClick={() => openHttps(selected.productionUrl)}>
                  {new URL(selected.productionUrl).hostname}
                </button>
              </dd>
            </div>
            {selected.ecosystemSource ? (
              <div><dt>Directory source</dt><dd>{selected.ecosystemSource === "LIFEOS" ? "LifeOS catalog" : "Xperience publication"}</dd></div>
            ) : null}
          </dl>
          <div className="ox-detail-actions">
            {selectedModes.length === 0 ? (
              <p className="ox-empty-copy" data-testid="provider-not-released">Listed in the Directory. No Xperience mode has been released for this provider on this installation yet.</p>
            ) : null}
            {selectedModes.map((mode, index) => (
              <button
                key={mode}
                type="button"
                className={`ox-button ${index === 0 ? "primary" : "secondary"} wide`}
                data-testid={`xperience-target-${selected.id}-${mode.toLowerCase()}`}
                disabled={busyId === selected.id}
                onClick={() => void (selected.experienced
                  ? openApplication(selected, "PUBLIC", mode)
                  : startApplication(selected, mode))}
              >
                {busyId === selected.id ? "Opening…" : EXECUTION_MODE_LABEL[mode]}
              </button>
            ))}
            {selected.experienced ? (
              <>
                {selected.canManage ? (
                  <button
                    type="button"
                    className="ox-button secondary wide"
                    disabled={busyId === selected.id}
                    onClick={() => void openApplication(selected, "MANAGEMENT")}
                  >
                    Manage
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ox-button ghost wide"
                  onClick={() => {
                    const membership = memberships.find((m) => m.applicationId === selected.id);
                    if (membership) setStopTarget(membership);
                  }}
                >
                  Remove from My Xperience
                </button>
              </>
            ) : null}
          </div>
        </section>
        {renderSpaceInstall(selected)}
      </div> : screen === "detail" ? <div className="ox-screen ox-detail"><BackButton /><div className="ox-inline-empty"><p>Select an application from Directory.</p></div></div> : null}

      {screen === "my-experience" ? <div data-testid="my-experience" className="ox-screen">
        <PageHeader title="My Xperience" copy="Manage your lineup. Enter Xperience to switch like channels." />
        {filteredMemberships.length || lineup.length ? (
          <button
            type="button"
            className="ox-button primary wide"
            data-testid="enter-xperience"
            style={{ marginBottom: 14 }}
            onClick={() => {
              const nextLineup = refreshLineup();
              const target =
                activeExperienceId ??
                nextLineup[0]?.experienceId ??
                memberships[0]?.applicationId;
              if (!target) return;
              applyMountPlan(nextLineup, target, null);
            }}
          >
            Enter Xperience
          </button>
        ) : null}
        <div className="ox-filter-row">{(["All", "Active", "Paused", "Recently Used"] as MembershipFilter[]).map((item) => <button className={membershipFilter === item ? "active" : ""} key={item} onClick={() => setMembershipFilter(item)}>{item}</button>)}</div>
        {loading ? <Skeletons /> : filteredMemberships.length ? <div className="ox-memberships">{filteredMemberships.map((item) => <article key={item.applicationId}>
          <AppGlyph compact app={item.application} /><div><strong>{item.application.name}</strong><small><i className={`ox-status ${item.status.toLowerCase()}`} />{item.status === "ACTIVE" ? "Active" : item.status === "PAUSED" ? "Paused" : "Unavailable"}{item.lastOpenedAt ? ` · Used ${new Date(item.lastOpenedAt).toLocaleDateString()}` : ""}</small></div>
          <div className="ox-membership-actions">
            <button className="ox-button compact" disabled={item.status === "UNAVAILABLE" || busyId === item.applicationId} onClick={() => void openApplication(item.application, "PUBLIC")}>Open</button>
            {item.application.canManage ? (
              <button className="ox-button compact secondary" disabled={item.status === "UNAVAILABLE" || busyId === item.applicationId} onClick={() => void openApplication(item.application, "MANAGEMENT")}>Manage</button>
            ) : null}
          </div>
          <button className="ox-icon-button" aria-label={`Remove ${item.application.name} from My Xperience`} onClick={() => setStopTarget(item)}><Icon name="more" /></button>
        </article>)}</div> : <section className="ox-state"><span>◇</span><h2>Your Xperience is ready to grow</h2><p>Add an application from Directory to see it here.</p><button className="ox-button primary" onClick={() => navigate("directory")}>Explore Directory</button></section>}
      </div> : null}

      {screen === "profile" ? <div className="ox-screen">
        <PageHeader eyebrow="INSTALLATION" title="This Xperience" copy="Local installation identity — not a login. Hosted apps keep their own authentication." />
        <section className="ox-profile-card" data-testid="installation-profile">
          <span className="ox-profile-avatar">{initials(participant?.displayName || "OX")}</span>
          <div>
            <h2>{participant?.displayName || "This installation"}</h2>
            <p>No Xperience account required</p>
          </div>
          <dl>
            <div><dt>Installation ID</dt><dd>{participant?.id || "initializing…"}</dd></div>
            <div><dt>Kind</dt><dd>{participant?.role || "INSTALLATION"}</dd></div>
          </dl>
        </section>
        <section className="ox-help-card">
          <small>GESTURES</small>
          <h2>Leave Xperience</h2>
          <p>While an application fills the screen, use system Back or an enabled Navigation Labs experiment to return Home. One-finger interaction stays with the application.</p>
          <label className="ox-toggle-row">
            <span>Air Navigation (legacy)</span>
            <input
              type="checkbox"
              checked={airEnabled}
              onChange={(event) => {
                const next = event.target.checked;
                setAirNavigationEnabled(next);
                setAirEnabled(next);
              }}
            />
          </label>
        </section>
        <section className="ox-help-card">
          <small>RESEARCH</small>
          <h2>Xperience Labs</h2>
          <p>Experimental navigation techniques for real-device testing. Not final consumer design.</p>
          <button
            type="button"
            className="ox-button primary wide"
            data-testid="open-nav-labs"
            onClick={() => {
              setLabsEnabledState(isNavLabsEnabled());
              setLabsExperiment(getActiveExperiment());
              setLabsDiagnostics(isLabsDiagnosticsOn());
              navigate("labs");
            }}
          >
            Navigation Experiments
          </button>
        </section>
      </div> : null}

      {screen === "labs" ? (
        <NavigationLabsPanel
          onBack={() => {
            setLabsEnabledState(isNavLabsEnabled());
            setLabsExperiment(getActiveExperiment());
            setLabsDiagnostics(isLabsDiagnosticsOn());
            navigate("profile");
          }}
        />
      ) : null}

      {screen === "voice" ? <div data-testid="voice" className="ox-screen ox-voice">
        <button className="ox-voice-close" onClick={() => navigate("home")} aria-label="Close voice"><Icon name="back" /> Back</button>
        <section>
          <small>VOICE</small><h1>What can we help you do?</h1>
          <button className={`ox-voice-orb state-${voiceState}`} onClick={voiceState === "listening" ? stopListening : beginListening} aria-label={voiceState === "listening" ? "Stop listening" : "Start listening"}><i /><Icon name="voice" /></button>
          <strong className="ox-voice-state">{voiceState === "listening" ? "Listening" : voiceState === "understanding" ? "Understanding" : voiceState === "resolving" ? "Resolving" : voiceState === "unavailable" ? "Voice unavailable" : voiceState === "error" ? "Try again" : voiceState === "ready" ? "Ready" : "Tap to speak"}</strong>
          {voiceText ? <blockquote>“{voiceText}”</blockquote> : null}<p>{voiceMessage}</p>
          {voiceState === "listening" ? <button className="ox-button secondary" onClick={stopListening}>Stop</button> : null}
          <div className="ox-voice-examples"><small>TRY AN EXAMPLE</small>{["Show my applications", "Find finance apps", "Open an application"].map((example) => <button key={example} onClick={() => { setVoiceText(example); setVoiceState("understanding"); void routeObjective(example); }}>{example}</button>)}</div>
        </section>
      </div> : null}

      {screen === "experience" && (opened || launchingApp || mountedFrames.length > 0) ? (
        <>
          {labsEnabled ? (
            <div className="ox-nav-peek" aria-hidden="true">
              <strong>OS Xperience</strong>
              <span>Home</span>
            </div>
          ) : null}
          <div
            ref={immersiveRef}
            data-testid="in-app-experience"
            data-xperience-mode="XPERIENCE"
            data-execution-mode={executionMode}
            data-provider-id={activeExperienceId ?? undefined}
            data-host-mode={hostMode.kind}
            data-switcher-open={switcherOpen ? "1" : "0"}
            className={`ox-in-app ox-immersive${exitingExperience ? " is-exiting" : ""}${airGrabbed ? " is-grabbed" : ""}${navProgress > 0.02 ? " is-nav-dragging" : ""}`}
          >
            {executionMode === "APP" ? <>
              <button type="button" className="ox-deliverable-trigger" aria-label="Xperience controls" data-testid="xperience-host-controls" aria-expanded={hostMenuOpen} onClick={() => setHostMenuOpen((open) => !open)}>☰</button>
              {hostMenuOpen ? <div className="ox-deliverable-menu" role="menu" aria-label="Xperience controls">
                {modeSwitchAllowed && activeSpaceTarget && !appsEntry ? <button type="button" role="menuitem" data-testid="switch-to-space" onClick={() => switchExecutionMode("SPACE")}>{EXECUTION_MODE_LABEL.SPACE}</button> : null}
                {hostMode.kind === "GENERAL" ? <button type="button" role="menuitem" onClick={() => { setHostMenuOpen(false); openSwitcher(); }}>Switch provider</button> : null}
                {hostMode.kind === "GENERAL" ? <button type="button" role="menuitem" onClick={() => { setHostMenuOpen(false); exitExperienceToHome(); }}>Leave Xperience</button> : null}
              </div> : null}
            </> : <>
              <button type="button" className="ox-space-summon" onClick={() => setSpacePresentation("CONTROLS_VISIBLE")}>Summon controls</button>
              {spacePresentation !== "IMMERSIVE" ? <div className="ox-space-controls" data-testid="space-controls">
                {tvChannelId ? <button type="button" onClick={() => void openTv()}>TV</button> : null}
                <button type="button" onClick={openSwitcher}>Space Switch</button>
                <button type="button" onClick={revolveSpace}>Revolve</button>
                {modeSwitchAllowed && activeAppTarget ? <button type="button" data-testid="switch-to-app" onClick={() => switchExecutionMode("APP")}>Return to App</button> : null}
              </div> : null}
            </>}
            {spaceNotice ? <div className="ox-frame-note" role="status" data-testid="space-notice">{spaceNotice}</div> : null}
            {executionMode === "SPACE" && tvState !== "idle" ? <section className="ox-tv-surface" data-testid="space-tv" data-channel={tvChannelId ?? undefined}>
              {tvState === "preparing" ? <div role="status">Preparing broadcast...</div> : null}
              {tvState === "unavailable" ? <div role="status">Broadcast unavailable</div> : null}
              {tvState === "playing" && tvSource ? <><small>{tvChannelId}</small><strong data-testid="space-tv-title">{tvTitle}</strong><video data-testid="space-tv-video" src={tvSource} autoPlay muted playsInline controls onLoadedMetadata={(event) => { const video = event.currentTarget; void video.play().catch(() => undefined); }} /></> : null}
            </section> : null}
            <div
              ref={switcherEdgeLeftRef}
              className="ox-switcher-edge is-left"
              data-testid="switcher-edge-left"
              aria-label="Double tap to open Switcher"
            />
            <div
              ref={switcherEdgeRightRef}
              className="ox-switcher-edge is-right"
              data-testid="switcher-edge-right"
              aria-label="Double tap to open Switcher"
            />
            {escapeHint && !labsEnabled && !switcherOpen ? (
              <div className="ox-escape-hint" role="status">
                Double-tap the edge to switch Experiences. Two-finger swipe returns Home.
              </div>
            ) : null}
            {labsEnabled ? (
              <div className="ox-labs-chrome">
                <button type="button" className="ox-button compact" onClick={() => exitExperienceToHome()}>
                  TEST EXIT TO HOME
                </button>
                <span className="ox-labs-chrome-id">{NAV_LABS_BUILD_ID}</span>
              </div>
            ) : null}
            <button type="button" className="ox-sr-only" onClick={exitExperienceToHome}>
              Return to OS Xperience Home
            </button>
            <button type="button" className="ox-sr-only" data-testid="summon-switcher" onClick={openSwitcher}>
              Open Switcher
            </button>
            {(launchingApp || (opened && !frameReady && !frameFailed && mountedFrames.length === 0)) && !experienceOfflineMessage ? (
              <section className="ox-launch-shell" aria-live="polite" aria-busy={!opened || !frameReady}>
                <span className="ox-app-glyph" aria-hidden="true">
                  {initials(launchingApp?.name || opened?.name || "OX")}
                </span>
                <h1>{launchingApp?.name || opened?.name}</h1>
                <p>Opening…</p>
              </section>
            ) : null}
            {experienceOfflineMessage ? (
              <section className="ox-frame-fallback ox-immersive-fallback" data-testid="experience-offline">
                <h1>{launchingApp?.name || opened?.name || "Experience"}</h1>
                <p>{experienceOfflineMessage}</p>
                <button
                  className="ox-button primary"
                  type="button"
                  onClick={() => {
                    setExperienceOfflineMessage(null);
                    openSwitcher();
                  }}
                >
                  Switch Experience
                </button>
                <button className="ox-button secondary" type="button" onClick={exitExperienceToHome}>
                  Leave Xperience
                </button>
              </section>
            ) : null}
            {(frameFailed || offline) && executionMode === "SPACE" && !experienceOfflineMessage ? (
              <div className="ox-frame-note" role="status" data-testid="space-provider-unreachable">
                {offline
                  ? "Offline. The live provider page needs a connection — this Space continues on this installation."
                  : "The live provider page is unreachable. This Space continues on this installation."}
              </div>
            ) : null}
            {frameFailed && executionMode === "APP" && opened && !experienceOfflineMessage ? (
              <section className="ox-frame-fallback ox-immersive-fallback" data-testid="experience-frame-failed">
                <h1>{opened.name} couldn&apos;t open</h1>
                <p>The Experience page failed to load. OS Xperience Home is still available.</p>
                <button className="ox-button primary" type="button" onClick={exitExperienceToHome}>
                  Back to Home
                </button>
                <button className="ox-button secondary" type="button" onClick={() => openHttps(opened.embedUrl)}>
                  Try again externally
                </button>
              </section>
            ) : null}
            {/* An offline Space never requests its provider's live page. */}
            {!experienceOfflineMessage && !frameFailed && !(executionMode === "SPACE" && offline)
              ? mountedFrames.map((frame) => {
                  const active = frame.id === activeExperienceId;
                  return (
                    <iframe
                      key={frame.id}
                      className={`ox-immersive-frame${active && frameReady ? " is-ready" : " is-loading"}${active ? " is-active" : " is-warm"}`}
                      title={frame.name}
                      src={frame.embedUrl}
                      hidden={!active}
                      aria-hidden={!active}
                      sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                      referrerPolicy="strict-origin-when-cross-origin"
                      onError={() => {
                        if (active) {
                          setFrameFailed(true);
                          setFrameReady(false);
                        }
                      }}
                      onLoad={() => {
                        if (!active) return;
                        if (executionMode === "SPACE") {
                          // Space readiness is local preparation; its provider's App URL is never probed.
                          setFrameReady(true);
                          return;
                        }
                        void (async () => {
                          // Error pages still fire onLoad; re-check reachability so we never
                          // leave a white WebView error covering the OS shell.
                          const probe = await ensureEntrypointReachable(frame.embedUrl);
                          if (!probe.ok) {
                            setFrameFailed(true);
                            setFrameReady(false);
                            return;
                          }
                          markLaunch(launchTraceRef.current, "first_pixel");
                          markLaunch(launchTraceRef.current, "interactive");
                          summarizeLaunch(launchTraceRef.current);
                          setFrameReady(true);
                          setFrameFailed(false);
                        })();
                      }}
                    />
                  );
                })
              : null}
            <ExperienceSwitcher
              open={switcherOpen}
              lineup={isolateLineup(lineup, switcherIsolation)}
              activeId={activeExperienceId}
              onSelect={switchToExperience}
              onNext={switchNext}
              onPrevious={switchPrevious}
              onDismiss={dismissSwitcher}
              activeMode={executionMode}
              activeModes={activeTargets.map((target) => target.executionMode)}
              modeSwitchAllowed={modeSwitchAllowed && !appsEntry}
              onSelectMode={(mode) => { switchExecutionMode(mode); dismissSwitcher(); }}
              modesFor={(id) => {
                const entry = lineup.find((item) => item.experienceId === id);
                return availableProviderTargets({ id, entrypoint: entry?.entrypoint, executionModes: entry?.executionModes })
                  .map((target) => target.executionMode);
              }}
            />
          </div>
        </>
      ) : null}
    </main>

    {!isDesktop && screen !== "experience" && screen !== "space-launch" ? (
      <BottomNav screen={screen} go={navigate} />
    ) : null}
    {deleteOfflineTarget ? <div className="ox-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteOfflineTarget(null); }}>
      <section data-testid="delete-offline-modal" className="ox-modal" role="dialog" aria-modal="true" aria-labelledby="delete-offline-title">
        <span className="ox-modal-icon">◇</span>
        <h2 id="delete-offline-title">Delete {deleteOfflineTarget.name} offline data?</h2>
        <p>This deletes the media and schedule prepared for {deleteOfflineTarget.name} on this device. Nothing else changes (any registration or Home Screen icon stays), but it needs preparation, and a connection, before it can run offline again.</p>
        <div>
          <button type="button" className="ox-button secondary" onClick={() => setDeleteOfflineTarget(null)}>Cancel</button>
          <button type="button" data-testid="confirm-delete-offline" className="ox-button danger" onClick={() => void deleteOfflineData(deleteOfflineTarget)}>Delete offline data</button>
        </div>
      </section>
    </div> : null}
    {stopTarget ? <div className="ox-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStopTarget(null); }}>
      <section data-testid="stop-modal" className="ox-modal" role="dialog" aria-modal="true" aria-labelledby="stop-title"><span className="ox-modal-icon">◇</span><h2 id="stop-title">Unxperience {stopTarget.application.name}?</h2><p>This removes it from My Xperience. You can add it again from Directory at any time.</p><div><button className="ox-button secondary" onClick={() => setStopTarget(null)}>Cancel</button><button data-testid="confirm-stop" className="ox-button danger" disabled={busyId === stopTarget.applicationId} onClick={() => void confirmStop()}>Unxperience</button></div></section>
    </div> : null}
  </div>;
}
