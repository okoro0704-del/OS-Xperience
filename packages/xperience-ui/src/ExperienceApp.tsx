import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { adoptSpaceLibraryItems, createHttpBroadcastSource, deletePreparedChannel, deleteSpaceLibrary, hydrateAndPrepareSpaceTv, IndexedDbBroadcastHydrationStore, IndexedDbSpaceLibraryStore, libraryItemBlob, localMediaBlob, spaceLibraryItems, syncSpaceLibrary, type LibraryItem } from "@digiconomy/offline-kernel";
import {
  DIRECTORY_CATEGORIES,
  normalizeOfflineCapability,
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
  spaceLocallyReady,
  spaceLibraryRoute,
  createMybrandosLibrarySource,
  browserSpaceContentFetch,
  type SpaceBackgroundSync,
  type SpaceContentFetch,
  storeCatalogPublicKey,
  xperienceAppEntries,
  xperienceSpaceCandidates,
  bundledSpaceArtifact,
  findSpaceHomeEntry,
  findSpaceRegistration,
  readSpaceHomeEntries,
  recordSpaceHomeEntry,
  removeSpaceHomeEntry,
  resolveInstalledSpace,
  spaceHomeEntryEligibility,
  spaceHomeEntryState,
  spaceInstallationStage,
  spaceShortcutId,
  spaceProviderView,
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
import {
  appInstallTarget,
  confirmInstalledTarget,
  findInstalledTarget,
  installableTargetsFor,
  installResultMessage,
  installTarget,
  readInstalledTargets,
  recordInstalledTarget,
  removeInstalledTarget,
  resolveInstalledApp,
  resolveLaunchMode,
  routeTargetLaunch,
  parseTargetKey,
  spaceInstallTarget,
  targetInstallationView,
  targetKey,
  type InstallableTarget,
  type InstallationPlatformAdapter,
  type InstallResult,
  type InstallTargetType,
  type LaunchMode,
  type SpaceInstallationSteps,
  type SpacePreparationOutcome,
  type WebInstallationAdapter,
} from "./installation/index.js";

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
  /**
   * Untrusted launch request the host read before the first render: an installed App or Space entry
   * (Android intent, or a web launch URL). Present → a DIRECT launch: OS Xperience stays hidden.
   */
  initialSpaceLaunch?: unknown;
  /** The platform's installation adapter (Android launcher, web install, iOS Safari handoff). */
  installationAdapter?: InstallationPlatformAdapter | null;
  /** `<type>:<id>` from an install handoff (`?ox-install=`): opens that target's details to install. */
  initialInstallRequest?: string | null;
  /** Leaves a directly launched target for the operating system. Never OS Xperience Home. */
  onExitDirectLaunch?: () => void;
  /** Names a direct target's task/window (Android Recents) with its trusted presentation. */
  presentDirectTarget?: (presentation: { label: string; monogram: string; color: string }) => void;
  /** Transport for syncing a Space's published content (Android: native HTTP). Defaults to fetch. */
  spaceContentFetch?: SpaceContentFetch;
  /** The platform's background delivery of Space content while OS Xperience is closed (Android). */
  spaceBackgroundSync?: SpaceBackgroundSync | null;
}

/** A Space stays in sync with its publisher by itself: re-checked this often while connected. */
const SPACE_AUTO_SYNC_INTERVAL_MS = 30 * 60_000;
/** After a failed attempt (route down, partial delivery) it is retried sooner. */
const SPACE_AUTO_SYNC_RETRY_MS = 2 * 60_000;

type SpaceLaunchStatus = "OPENING" | "NOT_READY" | "UNAVAILABLE" | "NOT_INSTALLED" | "INVALID" | "ONLINE_REQUIRED" | "FAILED" | "REMOVED";
/** The launch surface of an installed target (APP or SPACE). `spaceId` is the target identity for either type. */
type SpaceLaunchView = { status: SpaceLaunchStatus; targetType?: InstallTargetType; spaceId?: string; name?: string; readiness?: SpaceReadiness; channelId?: string | null; detail?: string };

/** What the launch surface may show before anything is resolved: the recorded label only, never content. */
function openingSpaceLaunch(raw: unknown): SpaceLaunchView {
  const route = routeTargetLaunch(raw);
  if (route.kind === "APP") {
    const record = findInstalledTarget("APP", route.appId);
    return { status: "OPENING", targetType: "APP", spaceId: route.appId, ...(record ? { name: record.label } : {}) };
  }
  if (route.kind !== "SPACE") return { status: "OPENING" };
  const entry = findSpaceHomeEntry(route.spaceId);
  return { status: "OPENING", targetType: "SPACE", spaceId: route.spaceId, ...(entry ? { name: entry.label } : {}) };
}

/** Screens a DIRECT launch may show. OS Xperience Home, Directory and navigation are never among them. */
const DIRECT_SCREENS: readonly string[] = ["space-launch", "experience"];

const INSTALL_STATE_LABEL: Record<string, string> = {
  INSTALLED: "Installed",
  UPDATE_AVAILABLE: "Update available",
  BROKEN: "Needs repair",
  INSTALLING: "Installing…",
  REMOVING: "Removing…",
};

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

  /**
   * Fixed before the first render from the host's launch request. In a DIRECT mode this runtime is
   * the hidden host of one installed target: Home, Directory, navigation and branding never mount.
   */
  const launchMode = useMemo<LaunchMode>(() => resolveLaunchMode(props.initialSpaceLaunch ?? null), []);
  const direct = launchMode.kind !== "XPERIENCE_NORMAL";
  const directRef = useRef(direct);
  const exitDirectRef = useRef(props.onExitDirectLaunch);
  exitDirectRef.current = props.onExitDirectLaunch;
  /** The target this direct runtime hosts (type, identity, trusted name once known). */
  const directTargetRef = useRef<{ type: InstallTargetType; id: string; name?: string } | null>(
    launchMode.kind === "DIRECT_APP" ? { type: "APP", id: launchMode.appId } : launchMode.kind === "DIRECT_SPACE" ? { type: "SPACE", id: launchMode.spaceId } : null,
  );
  const installationAdapter = props.installationAdapter ?? null;
  const [installRevision, setInstallRevision] = useState(0);
  const [installBusyKey, setInstallBusyKey] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<{ key: string; code: InstallResult["code"]; text: string; continuable: boolean } | null>(null);
  const [installCapability, setInstallCapability] = useState<{ supported: boolean; mechanism: string } | null>(null);
  const pendingInstallRef = useRef<{ key: string; name: string } | null>(null);

  // A home-entry tap opens straight into the target's launch surface: OS Xperience Home is never shown first.
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
  /** The running Space's synced content, read from the Offline Kernel only. */
  const [spaceLibrary, setSpaceLibrary] = useState<{ spaceId: string; items: LibraryItem[] } | null>(null);
  const [libraryViewer, setLibraryViewer] = useState<{ item: LibraryItem; url: string } | null>(null);
  const [revealBanner, setRevealBanner] = useState<{ id: string; name: string } | null>(null);
  const [xperienceEntry, setXperienceEntry] = useState<XperienceEntry | null>(null);
  const [spacePlayable, setSpacePlayable] = useState<Record<string, boolean> | null>(null);
  /** Bumped when a Space registration or its prepared state changes. */
  const [spaceRevision, setSpaceRevision] = useState(0);
  const playableCheckKeyRef = useRef("");
  const [spaceImport, setSpaceImport] = useState<{ code: SpaceImportCode | "REGISTERED" | "UPDATED"; pending?: Uint8Array; offeredVersion?: string } | null>(null);
  const [preparingSpaceId, setPreparingSpaceId] = useState<string | null>(null);
  /** The Space whose publisher content is syncing automatically right now (never blocks entering it). */
  const [syncingSpaceId, setSyncingSpaceId] = useState<string | null>(null);
  const autoSyncRef = useRef(new Map<string, { at: number; ok: boolean }>());
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
    if (directRef.current && !DIRECT_SCREENS.includes(next)) {
      // A direct target has no OS Xperience screen to go to: anything else is that target's failure.
      setSpaceLaunch((view) => (view && view.status !== "OPENING" ? view : { ...(view ?? {}), status: "FAILED" }));
      setScreen("space-launch");
      return;
    }
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
      if (directRef.current) {
        // Never dump a direct launch into OS Xperience: the failure belongs to the target.
        const target = directTargetRef.current;
        setMountedFrames([]);
        setOpened(null);
        setLaunchingApp(null);
        setActiveExperienceId(null);
        setSpaceLaunch({ status: "FAILED", ...(target ? { targetType: target.type, spaceId: target.id, ...(target.name ? { name: target.name } : {}) } : {}), detail: message });
        setScreen("space-launch");
        return;
      }
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

      // A direct target is not OS Xperience's own session: it never becomes what OS Xperience restores.
      if (!directRef.current) enterXperienceMode();
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
        if (!directRef.current) rememberOpenedExperience(payloadApp, "PUBLIC", undefined, target.executionMode);
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
    // The directly launched target is the root: Back leaves to the operating system, never to OS Xperience.
    if (directRef.current) return false;
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
    if (directRef.current) {
      exitDirectRef.current?.();
      return;
    }
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
    // OS Xperience's escape gesture has no meaning inside a directly launched target.
    const onEscape = () => { if (!directRef.current) exitExperienceToHome(); };
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
    if (directRef.current) return;
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
    if (screen !== "experience" || !opened || directRef.current) return;
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
    if (screen !== "experience" || !opened || directRef.current) return;
    /* Labs two-finger experiment owns recognition when enabled. */
    if (labsEnabled && labsExperiment === "two-finger-sweep") return;
    if (labsEnabled && labsExperiment) return; /* other labs experiments: no legacy two-finger */
    const node = immersiveRef.current;
    if (!node) return;
    return attachTwoFingerHorizontalEscape(node, exitExperienceToHome, escapeThresholdsForViewport());
  }, [screen, opened, exitExperienceToHome, labsEnabled, labsExperiment]);

  useEffect(() => {
    if (screen !== "experience" || directRef.current) return;
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
    if (!labsEnabled || !labsExperiment || directRef.current) {
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

  // A running Space knows what it holds locally; no request is made to read it.
  useEffect(() => {
    if (executionMode !== "SPACE" || !activeExperienceId) {
      setSpaceLibrary(null);
      return;
    }
    let cancelled = false;
    const spaceId = activeExperienceId;
    void spaceLibraryItems(new IndexedDbSpaceLibraryStore(), spaceId).then((items) => {
      if (!cancelled) setSpaceLibrary({ spaceId, items });
    });
    return () => { cancelled = true; };
  }, [executionMode, activeExperienceId, spaceRevision]);

  const closeLibraryViewer = useCallback(() => {
    setLibraryViewer((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);
  const openLibraryItem = useCallback(async (item: LibraryItem) => {
    const bytes = await new IndexedDbSpaceLibraryStore().loadItemBytes(item.itemId).catch(() => undefined);
    if (!bytes?.byteLength) { setSpaceNotice(`${item.title} isn't on this device anymore.`); return; }
    const url = URL.createObjectURL(libraryItemBlob(bytes, item.contentType));
    setLibraryViewer((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return { item, url };
    });
  }, []);
  useEffect(() => { if (executionMode !== "SPACE") closeLibraryViewer(); }, [executionMode, activeExperienceId, closeLibraryViewer]);

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

  /** A Space's content route: its provider's own brand origin. No route is ever guessed. */
  const spaceLibrarySourceFor = (spaceId: string) => {
    const provider = spaceProviderView(spaceId, [...memberships.map((item) => item.application), ...directory]);
    const route = spaceLibraryRoute(provider?.xperienceUrl || provider?.productionUrl);
    return route ? createMybrandosLibrarySource(route, props.spaceContentFetch ?? browserSpaceContentFetch) : null;
  };
  const spacePreparationRouteAvailable = (spaceId: string, channelId: string | null) =>
    Boolean(spaceLibrarySourceFor(spaceId)) || Boolean(channelId && broadcastBaseFor(spaceId));

  /**
   * Preparation acquires the Space into the Offline Kernel: its published content always, and its
   * broadcast when it has one. A broadcast is one experience of a Space, never a precondition.
   */
  const prepareSpaceContent = async (spaceId: string, channelId: string | null, online: boolean, options: { quiet?: boolean; automatic?: boolean } = {}): Promise<SpacePreparationOutcome> => {
    if (!online) return "OFFLINE";
    const library = spaceLibrarySourceFor(spaceId);
    const base = channelId ? broadcastBaseFor(spaceId) : undefined;
    if (!library && !base) return "NO_ROUTE";
    if (options.automatic) setSyncingSpaceId(spaceId);
    else if (!options.quiet) setPreparingSpaceId(spaceId);
    try {
      let ready = false;
      if (library) {
        const synced = await syncSpaceLibrary({ spaceId, store: new IndexedDbSpaceLibraryStore(), source: library, now: () => new Date() }).catch(() => null);
        ready = (synced?.available ?? 0) > 0;
      }
      if (base && channelId) {
        const tv = await hydrateAndPrepareSpaceTv({ channelId, routeAvailable: true, now: () => new Date(), store: new IndexedDbBroadcastHydrationStore(), source: createHttpBroadcastSource(base) }).catch(() => null);
        ready = ready || tv?.state === "LOCAL_PLAYING";
      }
      return ready ? "READY" : "FAILED";
    } finally {
      if (options.automatic) setSyncingSpaceId((current) => (current === spaceId ? null : current));
      else if (!options.quiet) setPreparingSpaceId(null);
      autoSyncRef.current.set(spaceId, { at: Date.now(), ok: true });
      setSpaceRevision((value) => value + 1);
    }
  };

  /**
   * Nobody prepares a Space by hand. The creator's post is its preparation; while this device has any
   * connection, every registered Space syncs its publisher's content by itself (on start, on
   * reconnect, and periodically), and the platform keeps delivering it while OS Xperience is closed.
   */
  const registeredSpaceKey = readSpaceRegistrations().map((item) => item.providerId).sort().join("|");
  const prepareSpaceContentRef = useRef(prepareSpaceContent);
  prepareSpaceContentRef.current = prepareSpaceContent;
  useEffect(() => {
    if (offline || !registeredSpaceKey) return;
    // Reconnecting retries every Space whose last attempt failed, right away.
    for (const [spaceId, last] of autoSyncRef.current) if (!last.ok) autoSyncRef.current.delete(spaceId);
    let cancelled = false;
    let running = false;
    // Connectivity is re-read at run time: an offline device never sends a sync request.
    const connected = () => (props.online != null ? props.online : typeof navigator === "undefined" || navigator.onLine !== false);
    const run = async () => {
      if (running || !connected()) return;
      running = true;
      try {
        for (const space of readSpaceRegistrations()) {
          if (cancelled) return;
          const last = autoSyncRef.current.get(space.providerId);
          if (last && Date.now() - last.at < (last.ok ? SPACE_AUTO_SYNC_INTERVAL_MS : SPACE_AUTO_SYNC_RETRY_MS)) continue;
          autoSyncRef.current.set(space.providerId, { at: Date.now(), ok: false });
          const outcome = await prepareSpaceContentRef.current(space.providerId, space.broadcastChannelId || null, true, { automatic: true });
          autoSyncRef.current.set(space.providerId, { at: Date.now(), ok: outcome === "READY" });
        }
      } finally {
        running = false;
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), SPACE_AUTO_SYNC_RETRY_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [offline, registeredSpaceKey]);

  // The platform keeps these Spaces in sync while OS Xperience is closed: brand routes only.
  useEffect(() => {
    const host = props.spaceBackgroundSync;
    if (!host) return;
    const apps = [...memberships.map((item) => item.application), ...directory];
    const plan = readSpaceRegistrations().flatMap((registration) => {
      const provider = spaceProviderView(registration.providerId, apps);
      const route = spaceLibraryRoute(provider?.xperienceUrl || provider?.productionUrl);
      return route ? [{ spaceId: registration.providerId, origin: route.origin, slug: route.slug, name: registration.name }] : [];
    });
    void host.setPlan(plan).catch(() => undefined);
  }, [props.spaceBackgroundSync, registeredSpaceKey, catalogRevision]);

  // What the platform delivered while OS Xperience was closed enters the Offline Kernel, one item at a time.
  useEffect(() => {
    const host = props.spaceBackgroundSync;
    if (!host) return;
    let busy = false;
    const deliver = async () => {
      if (busy) return;
      busy = true;
      try {
        const store = new IndexedDbSpaceLibraryStore();
        let changed = false;
        for (const space of await host.readDelivered()) {
          for (const item of space.items) {
            let bytes: Uint8Array;
            try { bytes = await item.bytes(); } catch { continue; }
            await adoptSpaceLibraryItems({ spaceId: space.spaceId, publisherId: space.publisherId, store, now: () => new Date(), items: [{ entry: item.entry, bytes, contentType: item.contentType }] });
            await host.release(space.spaceId, [item.entry.itemId]).catch(() => undefined);
            changed = true;
          }
          await adoptSpaceLibraryItems({ spaceId: space.spaceId, publisherId: space.publisherId, store, now: () => new Date(), items: [], catalogItemIds: space.catalogItemIds });
        }
        if (changed) setSpaceRevision((value) => value + 1);
      } catch {
        /* delivery resumes on the next start or resume */
      } finally {
        busy = false;
      }
    };
    void deliver();
    const onVisible = () => { if (document.visibilityState === "visible") void deliver(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [props.spaceBackgroundSync]);

  const spaceEntries = spaceCandidates.map((candidate) => {
    const checking = Boolean(candidate.target && spacePlayable === null);
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
      const stores = { broadcast: new IndexedDbBroadcastHydrationStore(), library: new IndexedDbSpaceLibraryStore() };
      const next: Record<string, boolean> = {};
      for (const candidate of spaceCandidates) {
        if (candidate.target) next[candidate.app.id] = await spaceLocallyReady(stores, { spaceId: candidate.app.id, channelId: candidate.channelId });
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
      recordInstalledTarget({ type: "SPACE", id: presentation.spaceId, label: presentation.name, ...(presentation.version ? { version: presentation.version } : {}), platform: "ANDROID", launchEntryState: result.alreadyPinned ? "CONFIRMED" : "PENDING_CONFIRMATION" });
      setInstallRevision((value) => value + 1);
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
    removeInstalledTarget("SPACE", app.id);
    setInstallRevision((value) => value + 1);
    setSpaceRevision((value) => value + 1);
    // Android does not let an app unpin an icon; the entry is disabled so it can no longer open the Space.
    await homeEntryHost?.disable(spaceShortcutId(app.id)).catch(() => undefined);
    await refreshHomeEntries();
    setHomeEntryNotice(`${name} was removed from the Home Screen. If your launcher still shows the icon, it is disabled and can be dragged away. Registration and offline data are unchanged.`);
  };

  const deleteOfflineData = async (target: { providerId: string; name: string; channelId: string | null }) => {
    setDeleteOfflineTarget(null);
    try {
      if (target.channelId) await deletePreparedChannel(new IndexedDbBroadcastHydrationStore(), target.channelId);
      await deleteSpaceLibrary(new IndexedDbSpaceLibraryStore(), target.providerId);
      setHomeEntryNotice(`${target.name} offline data was deleted. It syncs again automatically the next time this device is connected.`);
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
  const openHomeEntrySpace = async (spaceId: string, context?: { apps?: DirectoryApplicationView[]; online?: boolean; adoptWebEntry?: boolean }) => {
    const apps = context?.apps ?? [...memberships.map((item) => item.application), ...directory];
    const online = context?.online ?? !offline;
    const show = (view: SpaceLaunchView) => {
      setSpaceLaunch({ targetType: "SPACE", ...view });
      navigate("space-launch", { replace: true });
    };
    let resolution = resolveInstalledSpace(spaceId, { apps, fixedMode: fixedExecutionMode });
    // An installed web entry can start in storage of its own (iOS Home Screen web apps): the entry itself
    // is the install. Re-verify the Space from its signed launch file and record it, then resolve again.
    if (resolution.kind === "NOT_INSTALLED" && context?.adoptWebEntry) {
      await repairTarget({ type: "SPACE", id: spaceId }, { apps, online, quiet: true });
      resolution = resolveInstalledSpace(spaceId, { apps, fixedMode: fixedExecutionMode });
    }
    if (resolution.kind === "INVALID_TARGET") return show({ status: "INVALID" });
    if (resolution.kind === "NOT_INSTALLED") return show({ status: "NOT_INSTALLED", spaceId });
    const name = findSpaceRegistration(spaceId)?.name ?? resolution.entry.label;
    if (directTargetRef.current?.id === spaceId) directTargetRef.current = { type: "SPACE", id: spaceId, name };
    if (resolution.kind === "UNAVAILABLE") return show({ status: "UNAVAILABLE", spaceId, name });
    const { app, target } = resolution;
    const channelId = target.broadcastChannelId ?? null;
    const playable = await spaceLocallyReady({ broadcast: new IndexedDbBroadcastHydrationStore(), library: new IndexedDbSpaceLibraryStore() }, { spaceId, channelId });
    const { readiness } = classifySpaceReadiness({ released: true, offlineCapability: app.offlineCapability, channelId, locallyPlayable: playable, online });
    // Online, an unprepared Space still opens (its live software) and syncs its content for offline use.
    if (readiness === "NOT_PREPARED" && online) void prepareSpaceContent(spaceId, channelId, true, { quiet: true });
    else if (readiness !== "READY_OFFLINE" && readiness !== "PREPARED") return show({ status: "NOT_READY", spaceId, name, readiness, channelId });
    setSpaceLaunch(null);
    autoplaySpaceRef.current = channelId ? app.id : null;
    launchFromXperience(app, "SPACE");
  };

  /**
   * Installed App entry → App identity → released APP target, opened directly. APP is network-first:
   * offline it honestly needs a connection unless the App itself declares full offline operation.
   * Opening is not authentication; a protected capability inside the App still summons TrustID.
   */
  const openInstalledApp = async (appId: string, context?: { apps?: DirectoryApplicationView[]; online?: boolean; adoptWebEntry?: boolean }) => {
    const apps = context?.apps ?? [...memberships.map((item) => item.application), ...directory];
    const online = context?.online ?? !offline;
    const show = (view: SpaceLaunchView) => {
      setSpaceLaunch({ targetType: "APP", spaceId: appId, ...view });
      navigate("space-launch", { replace: true });
    };
    let resolution = resolveInstalledApp(appId, { apps, fixedMode: fixedExecutionMode });
    if (resolution.kind === "NOT_INSTALLED" && context?.adoptWebEntry) {
      await repairTarget({ type: "APP", id: appId }, { apps, online, quiet: true });
      resolution = resolveInstalledApp(appId, { apps, fixedMode: fixedExecutionMode });
    }
    if (resolution.kind === "INVALID_TARGET") return show({ status: "INVALID" });
    if (resolution.kind === "NOT_INSTALLED") return show({ status: "NOT_INSTALLED" });
    const name = resolution.kind === "RESOLVED" ? resolution.app.name : resolution.record.label;
    if (directTargetRef.current?.id === appId) directTargetRef.current = { type: "APP", id: appId, name: resolution.record.label };
    if (resolution.kind === "UNAVAILABLE") return show({ status: "UNAVAILABLE", name: resolution.record.label });
    if (!online && normalizeOfflineCapability(resolution.app.offlineCapability) !== "FULL") {
      return show({ status: "ONLINE_REQUIRED", name: resolution.record.label ?? name });
    }
    setSpaceLaunch(null);
    launchFromXperience({ ...resolution.app, experienced: true }, "APP");
  };

  /**
   * Repair installation: re-establish what an entry needs from trusted local sources only — the
   * signed launch file (V1 verifier), released targets, the Offline Kernel — and record the entry.
   */
  const repairTarget = async (
    target: { type: InstallTargetType; id: string },
    context?: { apps?: DirectoryApplicationView[]; online?: boolean; quiet?: boolean },
  ): Promise<boolean> => {
    const apps = context?.apps ?? [...memberships.map((item) => item.application), ...directory];
    const provider = spaceProviderView(target.id, apps);
    const platform = installationAdapter?.platform ?? "WEB";
    if (target.type === "APP") {
      const app = provider ? appInstallTarget(provider) : null;
      if (!app) return false;
      recordInstalledTarget({ type: "APP", id: app.id, label: app.name, ...(app.version ? { version: app.version } : {}), platform, launchEntryState: "CONFIRMED" });
      setInstallRevision((value) => value + 1);
      return true;
    }
    const space = provider ? spaceInstallTarget(provider) : null;
    if (!space) return false;
    const steps = spaceInstallationSteps(context?.online ?? !offline);
    if (!steps.isRegistered(space.id)) {
      const registered = await steps.register(space);
      if (!registered.ok) return false;
    }
    if (!(await steps.locallyReady(space))) await steps.prepare(space);
    const eligibility = spaceHomeEntryEligibility({ id: space.id });
    if (!eligibility.eligible) return false;
    recordSpaceHomeEntry(eligibility.presentation);
    recordInstalledTarget({ type: "SPACE", id: space.id, label: eligibility.presentation.name, ...(eligibility.presentation.version ? { version: eligibility.presentation.version } : {}), platform, launchEntryState: "CONFIRMED" });
    setSpaceRevision((value) => value + 1);
    setInstallRevision((value) => value + 1);
    return true;
  };

  /** Remove: the entry stops launching; Space registration and offline data are left to Manage. */
  const removeInstalledEntry = async (target: { type: InstallTargetType; id: string; name: string }) => {
    removeInstalledTarget(target.type, target.id);
    if (target.type === "SPACE") removeSpaceHomeEntry(target.id);
    await installationAdapter?.disableEntry?.(targetKey(target.type, target.id)).catch(() => undefined);
    setSpaceRevision((value) => value + 1);
    setInstallRevision((value) => value + 1);
  };

  /** The Space path's frozen owners, handed to the installation orchestrator. */
  const spaceInstallationSteps = (online: boolean): SpaceInstallationSteps => ({
    isRegistered: (spaceId) => Boolean(findSpaceRegistration(spaceId)),
    register: async (target) => {
      const path = target.launchFile.bundledArtifact;
      if (!path) return { ok: false, code: "ARTIFACT_UNAVAILABLE" };
      try {
        const response = await fetch(new URL(path, document.baseURI));
        if (!response.ok) return { ok: false, code: "ARTIFACT_UNAVAILABLE" };
        const result = await importSpaceLaunchFile(new Uint8Array(await response.arrayBuffer()), { xperienceVersion: props.xperienceVersion ?? "0.0.0" });
        setSpaceRevision((value) => value + 1);
        return result.ok ? { ok: true } : { ok: false, code: result.code };
      } catch {
        return { ok: false, code: "ARTIFACT_UNAVAILABLE" };
      }
    },
    locallyReady: async (target) => {
      const provider = spaceProviderView(target.id, [...memberships.map((item) => item.application), ...directory]);
      // A Space installed from its bundled launch file learns its channel from the verified V1 registration.
      const channelId = target.launchTarget.broadcastChannelId ?? findSpaceRegistration(target.id)?.broadcastChannelId ?? null;
      const playable = await spaceLocallyReady({ broadcast: new IndexedDbBroadcastHydrationStore(), library: new IndexedDbSpaceLibraryStore() }, { spaceId: target.id, channelId });
      const { readiness } = classifySpaceReadiness({ released: true, offlineCapability: provider?.offlineCapability, channelId, locallyPlayable: playable, online: false });
      return readiness === "READY_OFFLINE" || readiness === "PREPARED";
    },
    prepare: async (target) => {
      // A Space installed from its bundled launch file learns its channel from the verified V1 registration.
      const channelId = target.launchTarget.broadcastChannelId ?? findSpaceRegistration(target.id)?.broadcastChannelId ?? null;
      return prepareSpaceContent(target.id, channelId, online);
    },
  });

  /** INSTALL — one action for App and Space, on every platform. */
  const installNow = async (target: InstallableTarget) => {
    const key = targetKey(target.type, target.id);
    setInstallBusyKey(key);
    setInstallNotice(null);
    try {
      const result = await installTarget(target, { adapter: installationAdapter, space: spaceInstallationSteps(!offline) });
      const continuable = result.code === "INSTALLATION_PENDING_PLATFORM_CONFIRMATION" && result.guidance === "BROWSER_PROMPT";
      setInstallNotice({ key, code: result.code, text: installResultMessage(result, target.name), continuable });
      pendingInstallRef.current = result.code === "INSTALLATION_PENDING_PLATFORM_CONFIRMATION" && result.guidance === "LAUNCHER" ? { key, name: target.name } : null;
      if (result.code === "INSTALLATION_PENDING_PLATFORM_CONFIRMATION" && result.guidance === "LAUNCHER") {
        for (const delay of [1500, 5000, 12000]) window.setTimeout(() => void refreshHomeEntries(), delay);
      }
    } finally {
      setInstallBusyKey(null);
      setSpaceRevision((value) => value + 1);
      setInstallRevision((value) => value + 1);
      void refreshHomeEntries();
    }
  };

  /** A browser prompt that needed a fresh tap: the second tap is the human's confirmation. */
  const continueInstall = async (key: string, name: string) => {
    const adapter = installationAdapter as WebInstallationAdapter | null;
    if (!adapter?.confirmPending) return;
    const result = await adapter.confirmPending();
    const parsed = parseTargetKey(key);
    if (parsed && (result.status === "CREATED" || result.status === "ALREADY_PRESENT")) confirmInstalledTarget(parsed.type, parsed.id);
    if (parsed && result.status === "DISMISSED") removeInstalledTarget(parsed.type, parsed.id);
    const code = result.status === "CREATED" ? "INSTALLED" : result.status === "ALREADY_PRESENT" ? "ALREADY_INSTALLED" : result.status === "PENDING_CONFIRMATION" ? "INSTALLATION_PENDING_PLATFORM_CONFIRMATION" : "INSTALLATION_FAILED";
    const reason = result.status === "DISMISSED" ? "USER_DISMISSED" : result.status === "FAILED" || result.status === "UNSUPPORTED" ? result.reason : undefined;
    setInstallNotice({ key, code, text: installResultMessage({ code, ...(reason ? { reason } : {}), ...(result.status === "PENDING_CONFIRMATION" ? { guidance: result.guidance } : {}) }, name), continuable: result.status === "PENDING_CONFIRMATION" && result.guidance === "BROWSER_PROMPT" });
    setInstallRevision((value) => value + 1);
  };

  /** Leaving the launch screen: a direct target leaves to the OS; otherwise OS Xperience Home, with nothing running underneath. */
  leaveSpaceLaunchRef.current = () => {
    if (directRef.current) {
      exitDirectRef.current?.();
      return;
    }
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

  /** One router for every installed entry: APP → App resolver, SPACE → the frozen Space resolver. */
  processSpaceLaunchRef.current = async (raw, context) => {
    const route = routeTargetLaunch(raw);
    if (route.kind === "INVALID") {
      setSpaceLaunch({ status: "INVALID", ...(directTargetRef.current ? { targetType: directTargetRef.current.type } : {}) });
      navigate("space-launch", { replace: true });
      return;
    }
    // Only an installed web app (its own Home Screen entry) may adopt itself; a link in a tab never installs.
    const adoptWebEntry = route.source === "WEB" && route.standalone;
    if (route.kind === "APP") {
      await openInstalledApp(route.appId, { ...context, adoptWebEntry });
      return;
    }
    await openHomeEntrySpace(route.spaceId, { ...context, adoptWebEntry });
  };

  /** Retry from a direct launch's recovery surface: the same launch, resolved again. */
  const retryDirectLaunch = () => {
    const target = directTargetRef.current;
    if (!target) return;
    setSpaceLaunch({ status: "OPENING", targetType: target.type, spaceId: target.id, ...(target.name ? { name: target.name } : {}) });
    if (target.type === "APP") void openInstalledApp(target.id);
    else void openHomeEntrySpace(target.id);
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

  // A direct target names its own window and Recents card — never "OS Xperience".
  const directName = spaceLaunch?.name ?? directTargetRef.current?.name ?? null;
  useEffect(() => {
    const target = directTargetRef.current;
    if (!direct || !target || !directName) return;
    document.title = directName;
    const { label, monogram, color } = spaceShortcutRequest({ spaceId: target.id, name: directName });
    props.presentDirectTarget?.({ label, monogram, color });
  }, [direct, directName]);

  useEffect(() => {
    if (direct || !installationAdapter) return;
    let cancelled = false;
    void installationAdapter.capability().then((capability) => {
      if (!cancelled) setInstallCapability({ supported: capability.supported, mechanism: capability.mechanism });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [direct, installationAdapter, homeEntrySupported]);

  // Web install borrows the page's manifest and title; give them back once the person leaves the target.
  useEffect(() => {
    if (direct || screen === "detail") return;
    (installationAdapter as WebInstallationAdapter | null)?.reset?.();
  }, [direct, screen, installationAdapter]);

  // Android: an APP entry is installed once the launcher reports it; entries no longer recorded are disabled.
  useEffect(() => {
    if (!homeEntrySupported || direct) return;
    const recorded = new Set(readInstalledTargets().filter((row) => row.type === "APP").map((row) => row.key));
    for (const id of pinnedShortcuts) {
      if (id.startsWith("app:") && !recorded.has(id)) void installationAdapter?.disableEntry?.(id).catch(() => undefined);
    }
    const pending = pendingInstallRef.current;
    if (pending && pinnedShortcuts.includes(pending.key)) {
      const parsed = parseTargetKey(pending.key);
      if (parsed) confirmInstalledTarget(parsed.type, parsed.id);
      pendingInstallRef.current = null;
      setInstallNotice({ key: pending.key, code: "INSTALLED", text: `${pending.name} is on your Home Screen.`, continuable: false });
      setInstallRevision((value) => value + 1);
    }
  }, [pinnedShortcuts, homeEntrySupported, direct, installationAdapter]);

  // Install handoff (`?ox-install=<type>:<id>`, e.g. from OS Xperience for iPhone): open that target ready to INSTALL.
  const installRequestDoneRef = useRef(false);
  useEffect(() => {
    if (direct || installRequestDoneRef.current || loading) return;
    installRequestDoneRef.current = true;
    const parsed = parseTargetKey(props.initialInstallRequest ?? null);
    if (!parsed) return;
    const provider = spaceProviderView(parsed.id, [...memberships.map((item) => item.application), ...directory]);
    if (!provider) return;
    setSelected(provider);
    navigate("detail");
  }, [direct, loading]);

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
      {registration && !preparing && !checking && entry!.readiness === "NOT_PREPARED" ? (
        <p className="ox-empty-copy" role="status" data-testid={`install-syncing-${app.id}`}>{spacePreparationRouteAvailable(app.id, entry!.channelId) ? (syncingSpaceId === app.id ? `Syncing ${name}…` : `${name} syncs automatically while this device is connected.`) : "This device has no content route for this Space yet."}</p>
      ) : null}
      {registration && !checking && entry!.readiness === "ONLINE_PREPARATION_REQUIRED" ? <p className="ox-empty-copy">{name} syncs automatically the next time this device is connected.</p> : null}
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


  /**
   * The launch surface of an installed target: its own name and monogram only — no OS Xperience
   * branding, navigation or Home. A failure stays with the target (Retry · Repair installation · Remove).
   */
  const launchView = spaceLaunch ?? { status: "OPENING" as const };
  const launchTargetType: InstallTargetType = launchView.targetType ?? directTargetRef.current?.type ?? "SPACE";
  const launchTargetId = launchView.spaceId ?? directTargetRef.current?.id ?? null;
  const launchName = launchView.name ?? directTargetRef.current?.name ?? (launchTargetType === "APP" ? "App" : "Space");
  const launchKindLabel = launchTargetType === "APP" ? "App" : "Space";
  const launchRouteAvailable = !offline && Boolean(launchView.spaceId) && spacePreparationRouteAvailable(launchView.spaceId!, launchView.channelId ?? null);
  const launchFailed = launchView.status === "INVALID" || launchView.status === "NOT_INSTALLED" || launchView.status === "UNAVAILABLE" || launchView.status === "FAILED";
  const targetLaunchView = <div data-testid="space-launch" className={`ox-screen ox-space-launch${direct ? " is-direct" : ""}`} data-status={launchView.status} data-space-id={launchView.spaceId} data-target-type={launchTargetType}>
    {launchView.status === "OPENING" ? (
      <section className="ox-launch-shell" aria-live="polite" aria-busy="true">
        <span className="ox-app-glyph" aria-hidden="true">{initials(launchName)}</span>
        <h1>{launchView.name ?? (direct ? "" : "Opening Space")}</h1>
        <p>Opening…</p>
      </section>
    ) : (
      <section className="ox-space-launch-card" role="status">
        <span className="ox-app-glyph" aria-hidden="true">{initials(launchName)}</span>
        <h1 data-testid="target-launch-title">{launchView.status === "REMOVED" ? `${launchName} was removed` : launchFailed ? (launchView.name ? `${launchName} couldn't be opened` : `This ${launchKindLabel} couldn't be opened`) : launchName}</h1>
        {launchView.status === "NOT_READY" ? <>
          <p data-testid="space-launch-message">{launchName} needs preparation before it can run on this device.</p>
          <span className="ox-mode-badges"><em className="is-blocked">{SPACE_READINESS_LABEL[launchView.readiness ?? "NOT_PREPARED"]}</em></span>
          {preparingSpaceId === launchView.spaceId ? <div className="ox-space-preparing" role="status"><p>Preparing for offline use…</p><span className="ox-progress is-indeterminate" aria-hidden="true"><i /></span></div> : null}
          {launchRouteAvailable ? (
            <p data-testid="space-launch-syncing">{syncingSpaceId === launchView.spaceId ? `Syncing ${launchName}…` : `${launchName} syncs automatically while this device is connected.`}</p>
          ) : (
            <p data-testid="space-launch-connect">{offline ? "Connect when available to prepare this Space." : "This device has no preparation route for this Space yet."}</p>
          )}
          {prepareNotice ? <p className="ox-restore-notice" role="status">{prepareNotice}</p> : null}
        </> : null}
        {launchView.status === "ONLINE_REQUIRED" ? <p data-testid="space-launch-message">{launchName} needs a connection to open. Nothing on this device was changed.</p> : null}
        {launchView.status === "UNAVAILABLE" ? <p data-testid="space-launch-message">{launchName} isn&apos;t available as {launchTargetType === "APP" ? "an App" : "a Space"} on this device right now.</p> : null}
        {launchView.status === "NOT_INSTALLED" ? <p data-testid="space-launch-message">This {launchKindLabel} isn&apos;t installed on this device. Repair the installation to use this icon again.</p> : null}
        {launchView.status === "INVALID" ? <p data-testid="space-launch-message">The icon didn&apos;t identify {launchTargetType === "APP" ? "an App" : "a Space"} installed on this device. Nothing was opened.</p> : null}
        {launchView.status === "FAILED" ? <p data-testid="space-launch-message">{launchView.detail ?? "Something went wrong while opening it."}</p> : null}
        {launchView.status === "REMOVED" ? <p data-testid="space-launch-message">Its icon can no longer open it. If your launcher still shows the icon, drag it away.</p> : null}
        <div className="ox-target-recovery">
          {launchView.status === "ONLINE_REQUIRED" || launchFailed ? <button type="button" className="ox-button primary" data-testid="target-launch-retry" onClick={() => (direct ? retryDirectLaunch() : launchTargetId ? void processSpaceLaunchRef.current(launchTargetType === "APP" ? { source: "WEB", key: targetKey("APP", launchTargetId), standalone: false } : { source: "WEB", key: targetKey("SPACE", launchTargetId), standalone: false }) : undefined)}>Retry</button> : null}
          {launchFailed && launchTargetId ? <button type="button" className="ox-button secondary" data-testid="target-launch-repair" onClick={() => void (async () => {
            const repaired = await repairTarget({ type: launchTargetType, id: launchTargetId });
            if (!repaired) {
              setSpaceLaunch({ ...launchView, status: "FAILED", detail: `${launchName} couldn't be repaired from this device. Connect and try again, or install it again from OS Xperience.` });
              return;
            }
            if (direct) retryDirectLaunch();
            else void processSpaceLaunchRef.current({ source: "WEB", key: targetKey(launchTargetType, launchTargetId), standalone: false });
          })()}>Repair installation</button> : null}
          {launchFailed && launchTargetId ? <button type="button" className="ox-button ghost" data-testid="target-launch-remove" onClick={() => void (async () => {
            await removeInstalledEntry({ type: launchTargetType, id: launchTargetId, name: launchName });
            setSpaceLaunch({ ...launchView, status: "REMOVED" });
          })()}>Remove</button> : null}
          {direct ? <button type="button" className="ox-button ghost" data-testid="target-launch-close" onClick={() => exitDirectRef.current?.()}>Close</button> : (
            <button type="button" className="ox-button secondary" data-testid="space-launch-home" onClick={() => leaveSpaceLaunchRef.current()}>Open OS Xperience</button>
          )}
        </div>
      </section>
    )}
  </div>;

  /** Directory → INSTALL for every installable target the provider offers: [OPEN|ENTER] [INSTALL]. */
  const renderInstallPanel = (app: DirectoryApplicationView) => {
    void installRevision;
    const targets = installableTargetsFor(app);
    if (targets.length === 0) return null;
    const androidPresence = installationAdapter?.platform === "ANDROID" && homeEntrySupported;
    return <section className="ox-install-panel" data-testid={`install-panel-${app.id}`} data-install-mechanism={installCapability?.mechanism ?? "UNKNOWN"}>
      {targets.map((target) => {
        const key = targetKey(target.type, target.id);
        const record = findInstalledTarget(target.type, target.id);
        const registration = target.type === "SPACE" ? spaceRegistrations.find((item) => item.providerId === target.id) ?? null : null;
        const spaceEntry = target.type === "SPACE" ? spaceEntries.find((item) => item.app.id === target.id) ?? null : null;
        const view = targetInstallationView({
          type: target.type,
          record,
          present: androidPresence ? pinnedShortcuts.includes(key) : null,
          installing: installBusyKey === key,
          ...(target.version ? { currentVersion: target.version } : {}),
          ...(target.type === "SPACE" ? {
            spaceRegistered: Boolean(registration),
            spaceHomeRecord: homeEntries.some((entry) => entry.spaceId === target.id),
            spaceReadiness: !spaceEntry || spaceEntry.checking ? "CHECKING" as const : spaceEntry.readiness,
          } : {}),
        });
        const installed = view.state === "INSTALLED" || view.state === "UPDATE_AVAILABLE";
        const canOpen = target.type === "APP" || Boolean(spaceEntry?.enterable);
        const supported = installCapability?.supported === true;
        const notice = installNotice?.key === key ? installNotice : null;
        return <article key={key} className="ox-install-row" data-testid={`install-target-row-${target.type.toLowerCase()}-${target.id}`} data-target-type={target.type} data-install-state={view.state} data-launch-entry={view.launchEntry} {...(view.continuity ? { "data-continuity": view.continuity } : {})}>
          <span className="ox-app-glyph" aria-hidden="true" style={{ background: target.icon.color }}>{target.icon.monogram}</span>
          <div>
            <small>{target.type === "APP" ? "App" : "Space"}</small>
            <strong>{target.name}</strong>
            {installed ? <em className="ox-install-state is-ok" data-testid={`install-state-${target.type.toLowerCase()}-${target.id}`}>{INSTALL_STATE_LABEL[view.state]}</em> : view.state === "BROKEN" ? <em className="ox-install-state is-blocked">{INSTALL_STATE_LABEL.BROKEN}</em> : null}
          </div>
          <div className="ox-install-actions">
            {canOpen ? <button type="button" className="ox-button secondary compact" data-testid={`open-target-${target.type.toLowerCase()}-${target.id}`} onClick={() => launchFromXperience(app, target.type)}>{target.type === "APP" ? "Open" : "Enter"}</button> : null}
            {!installed && supported ? <button type="button" className="ox-button primary compact" data-testid={`install-target-${target.type.toLowerCase()}-${target.id}`} disabled={installBusyKey !== null || preparingSpaceId !== null} onClick={() => void installNow(target)}>{installBusyKey === key ? "Installing…" : view.state === "BROKEN" ? "Repair" : "Install"}</button> : null}
            {view.state === "UPDATE_AVAILABLE" && supported ? <button type="button" className="ox-button compact" data-testid={`update-target-${target.type.toLowerCase()}-${target.id}`} disabled={installBusyKey !== null} onClick={() => void installNow(target)}>Update</button> : null}
            {installed && view.launchEntry === "UNKNOWN" && supported ? <button type="button" className="ox-text-link" data-testid={`reinstall-target-${target.type.toLowerCase()}-${target.id}`} onClick={() => void installNow(target)}>Add again</button> : null}
          </div>
          {!supported && installCapability ? <p className="ox-install-note" data-testid={`install-unavailable-${target.type.toLowerCase()}-${target.id}`}>Installing isn&apos;t available in this browser.</p> : null}
          {notice ? <p className="ox-restore-notice" role="status" data-testid="install-notice" data-code={notice.code}>
            {notice.text}{" "}
            {notice.continuable ? <button type="button" className="ox-text-link" data-testid="install-continue" onClick={() => void continueInstall(key, target.name)}>Install</button> : null}
            <button type="button" className="ox-text-link" onClick={() => { setInstallNotice(null); (installationAdapter as WebInstallationAdapter | null)?.reset?.(); }}>Dismiss</button>
          </p> : null}
        </article>;
      })}
    </section>;
  };

  const experienceView = screen === "experience" && (opened || launchingApp || mountedFrames.length > 0) ? (
        <>
          {labsEnabled && !direct ? (
            <div className="ox-nav-peek" aria-hidden="true">
              <strong>OS Xperience</strong>
              <span>Home</span>
            </div>
          ) : null}
          <div
            ref={immersiveRef}
            data-testid="in-app-experience"
            data-xperience-mode={direct ? "DIRECT" : "XPERIENCE"}
            data-execution-mode={executionMode}
            data-provider-id={activeExperienceId ?? undefined}
            data-host-mode={hostMode.kind}
            data-switcher-open={switcherOpen ? "1" : "0"}
            className={`ox-in-app ox-immersive${exitingExperience ? " is-exiting" : ""}${airGrabbed ? " is-grabbed" : ""}${navProgress > 0.02 ? " is-nav-dragging" : ""}`}
          >
            {executionMode === "APP" ? direct ? null : <>
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
                {direct ? null : <button type="button" onClick={openSwitcher}>Space Switch</button>}
                {direct ? null : <button type="button" onClick={revolveSpace}>Revolve</button>}
                {modeSwitchAllowed && activeAppTarget && !direct ? <button type="button" data-testid="switch-to-app" onClick={() => switchExecutionMode("APP")}>Return to App</button> : null}
              </div> : null}
            </>}
            {spaceNotice ? <div className="ox-frame-note" role="status" data-testid="space-notice">{spaceNotice}</div> : null}
            {executionMode === "SPACE" && tvState !== "idle" ? <section className="ox-tv-surface" data-testid="space-tv" data-channel={tvChannelId ?? undefined}>
              {tvState === "preparing" ? <div role="status">Preparing broadcast...</div> : null}
              {tvState === "unavailable" ? <div role="status">Broadcast unavailable</div> : null}
              {tvState === "playing" && tvSource ? <><small>{tvChannelId}</small><strong data-testid="space-tv-title">{tvTitle}</strong><video data-testid="space-tv-video" src={tvSource} autoPlay muted playsInline controls onLoadedMetadata={(event) => { const video = event.currentTarget; void video.play().catch(() => undefined); }} /></> : null}
            </section> : null}
            {direct ? null : <><div
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
            /></>}
            {escapeHint && !labsEnabled && !switcherOpen && !direct ? (
              <div className="ox-escape-hint" role="status">
                Double-tap the edge to switch Experiences. Two-finger swipe returns Home.
              </div>
            ) : null}
            {labsEnabled && !direct ? (
              <div className="ox-labs-chrome">
                <button type="button" className="ox-button compact" onClick={() => exitExperienceToHome()}>
                  TEST EXIT TO HOME
                </button>
                <span className="ox-labs-chrome-id">{NAV_LABS_BUILD_ID}</span>
              </div>
            ) : null}
            {direct ? null : <>
              <button type="button" className="ox-sr-only" onClick={exitExperienceToHome}>
                Return to OS Xperience Home
              </button>
              <button type="button" className="ox-sr-only" data-testid="summon-switcher" onClick={openSwitcher}>
                Open Switcher
              </button>
            </>}
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
                {direct ? <>
                  <button className="ox-button primary" type="button" data-testid="direct-retry" onClick={retryDirectLaunch}>Retry</button>
                  <button className="ox-button secondary" type="button" onClick={exitExperienceToHome}>Close</button>
                </> : <>
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
                </>}
              </section>
            ) : null}
            {(frameFailed || offline) && executionMode === "SPACE" && !experienceOfflineMessage && spaceLibrary?.items.length ? (
              <section className="ox-space-library" data-testid="space-library" data-space-id={spaceLibrary.spaceId}>
                <header><h2>{opened?.name ?? "This Space"}</h2><p>On this device</p></header>
                <ul>
                  {spaceLibrary.items.map((item) => (
                    <li key={item.itemId}>
                      <button type="button" data-testid={`space-library-item-${item.itemId}`} data-kind={item.kind} onClick={() => void openLibraryItem(item)}>
                        <span className="ox-space-library-kind">{item.kind === "VIDEO" ? "Video" : item.kind === "AUDIO" ? "Audio" : item.kind === "IMAGE" ? "Image" : "File"}</span>
                        <strong>{item.title}</strong>
                        {item.description ? <small>{item.description}</small> : null}
                      </button>
                    </li>
                  ))}
                </ul>
                {libraryViewer ? (
                  <div className="ox-space-library-viewer" role="dialog" aria-label={libraryViewer.item.title} data-testid="space-library-viewer">
                    {libraryViewer.item.kind === "VIDEO" ? <video data-testid="space-library-video" src={libraryViewer.url} autoPlay playsInline controls />
                      : libraryViewer.item.kind === "AUDIO" ? <audio data-testid="space-library-audio" src={libraryViewer.url} autoPlay controls />
                      : libraryViewer.item.kind === "IMAGE" ? <img data-testid="space-library-image" src={libraryViewer.url} alt={libraryViewer.item.title} />
                      : <p>{libraryViewer.item.title}</p>}
                    <button type="button" className="ox-button secondary" onClick={closeLibraryViewer}>Close</button>
                  </div>
                ) : null}
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
                <p>{direct ? "The page failed to load. Check your connection and try again." : "The Experience page failed to load. OS Xperience Home is still available."}</p>
                {direct ? <button className="ox-button primary" type="button" data-testid="direct-retry" onClick={retryDirectLaunch}>Retry</button> : (
                  <button className="ox-button primary" type="button" onClick={exitExperienceToHome}>
                    Back to Home
                  </button>
                )}
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
            {direct ? null : <ExperienceSwitcher
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
            />}
          </div>
        </>
      ) : null;

  // DIRECT launch: the target is the only visible root. OS Xperience Home, Directory, navigation,
  // banners and branding are never mounted — the runtime underneath is unchanged.
  if (direct) {
    return <div className="ox-root ox-direct-root" data-testid="direct-launch-root" data-launch-mode={launchMode.kind}>
      <main className="ox-main ox-direct-main">
        {screen === "experience" && experienceView ? experienceView : targetLaunchView}
      </main>
    </div>;
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

      {screen === "space-launch" ? targetLaunchView : null}

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
              {!entry.checking && entry.readiness === "NOT_PREPARED" && spacePreparationRouteAvailable(entry.app.id, entry.channelId) ? (
                <span className="ox-empty-copy" role="status" data-testid={`syncing-space-${entry.app.id}`}>
                  {syncingSpaceId === entry.app.id ? "Syncing…" : "Syncs automatically"}
                </span>
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
        {renderInstallPanel(selected)}
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

      {experienceView}
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
