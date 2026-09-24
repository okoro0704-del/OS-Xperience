import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DIRECTORY_CATEGORIES,
  parseExperienceUtterance,
  type ApplicationSurfaceType,
  type DirectoryApplicationView,
  type ExperienceMembershipView,
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
  bootFromLocal,
  buildLineup,
  buildLocalOpenPayload,
  canOperateOffline,
  catalogPublicKeySpki,
  enterXperienceMode,
  leaveXperienceMode,
  markRevealSeen,
  nextExperienceId,
  planSwitch,
  previousExperienceId,
  probeExperienceUrl,
  rememberOpenedExperience,
  shellAuthPosture,
  storeCatalogPublicKey,
  type LineupEntry,
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

declare global {
  interface Window {
    __oxExperienceActive?: boolean;
    __oxGestureDebug?: (phase: string, count: number, dx?: number, dy?: number) => void;
    __oxExitExperienceToHome?: () => void;
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
}

type Screen =
  | "home"
  | "directory"
  | "my-experience"
  | "profile"
  | "labs"
  | "search"
  | "detail"
  | "experience"
  | "voice";
type MembershipFilter = "All" | "Active" | "Paused" | "Recently Used";
type Participant = { id: string; role: string; email?: string | null; displayName?: string | null };

const env = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

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

function AppCard({
  app,
  onSelect,
  onPrimary,
  busy,
  dense = false,
}: {
  app: DirectoryApplicationView;
  onSelect: () => void;
  onPrimary: () => void;
  busy: boolean;
  dense?: boolean;
}) {
  return <article className={`ox-app-card${dense ? " is-dense" : ""}`}>
    <button className="ox-card-main" onClick={onSelect} aria-label={`View ${app.name} details`}>
      <AppGlyph app={app} compact={dense} />
      <span>
        <small>{app.category}</small>
        <strong>{app.name}</strong>
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
        <button className="ox-button compact" disabled={busy} onClick={onPrimary}>
          {busy ? "Working…" : app.experienced ? "Open" : "Xperience"}
        </button>
      </div>
    </div>
  </article>;
}

function BottomNav({
  screen,
  go,
  onEnterXperience,
}: {
  screen: Screen;
  go: (screen: Screen) => void;
  onEnterXperience: () => void;
}) {
  const runtimeMode = screen === "voice" ? "voice" : screen === "experience" ? "xperience" : null;
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

      <div
        className={`ox-mode-switch${runtimeMode ? " has-mode" : ""}`}
        role="group"
        aria-label="Xperience Voice mode switch"
        data-testid="nav-mode-switch"
        data-mode={runtimeMode ?? "idle"}
      >
        <button
          type="button"
          data-testid="nav-xperience"
          className={runtimeMode === "xperience" ? "is-active" : ""}
          aria-pressed={runtimeMode === "xperience"}
          onClick={onEnterXperience}
        >
          <Icon name="xperience" />
          <span>Xperience</span>
        </button>
        <span className="ox-mode-switch-divider" aria-hidden="true">
          ⇄
        </span>
        <button
          type="button"
          data-testid="nav-voice"
          className={runtimeMode === "voice" ? "is-active" : ""}
          aria-pressed={runtimeMode === "voice"}
          onClick={() => go("voice")}
        >
          <Icon name="voice" />
          <span>Voice</span>
        </button>
      </div>

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
  const api = useMemo<XperienceApiClient>(() => createXperienceApiClient({
    baseUrl: apiBase,
    actor: `USER:${userId}`,
    email: `${userId}@xperience.local`,
    displayName: userName,
  }), [apiBase, userId, userName]);

  const [screen, setScreen] = useState<Screen>("home");
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
  const [revealBanner, setRevealBanner] = useState<{ id: string; name: string } | null>(null);
  const bootRestoreDoneRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const immersiveRef = useRef<HTMLDivElement | null>(null);
  const switcherEdgeLeftRef = useRef<HTMLDivElement | null>(null);
  const switcherEdgeRightRef = useRef<HTMLDivElement | null>(null);
  const switcherIdleRef = useRef<number | null>(null);
  const mountedIdsRef = useRef<string[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const airNavRef = useRef<AirNavigationController | null>(null);
  const screenRef = useRef(screen);
  const stackRef = useRef(screenStack);
  const exitingRef = useRef(false);
  screenRef.current = screen;
  stackRef.current = screenStack;
  mountedIdsRef.current = mountedFrames.map((frame) => frame.id);
  activeIdRef.current = activeExperienceId;

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
      setLineup(next);
      return next;
    },
    [directory, memberships, offline],
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
      navigate("home", { replace: true });
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
      options?: { offlineMessage?: string | null; app?: DirectoryApplicationView },
    ) => {
      const plan = planSwitch({
        lineup: nextLineup,
        fromId,
        toId,
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
        const entry = nextLineup.find((item) => item.experienceId === toId);
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
          if (kept) {
            next.push(kept);
            continue;
          }
          const entry = nextLineup.find((item) => item.experienceId === id);
          if (!entry) continue;
          next.push({ id, embedUrl: entry.entrypoint, name: entry.name });
        }
        return next;
      });

      const activeEntry = nextLineup.find((item) => item.experienceId === toId);
      if (activeEntry) {
        const app =
          options?.app ??
          directory.find((item) => item.id === toId) ??
          memberships.find((item) => item.applicationId === toId)?.application;
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
        rememberOpenedExperience(payloadApp, "PUBLIC");
      }
      navigate("experience");
    },
    [directory, memberships, navigate],
  );

  const switchToExperience = useCallback(
    (experienceId: string) => {
      const nextLineup = refreshLineup();
      void (async () => {
        if (!mountedIdsRef.current.includes(experienceId)) {
          const entry = nextLineup.find((item) => item.experienceId === experienceId);
          const probe = await ensureEntrypointReachable(entry?.entrypoint);
          if (!probe.ok) {
            abortExperienceToHome(
              probe.reason ?? "OS Xperience could not open that Experience. Returning Home.",
            );
            return;
          }
        }
        applyMountPlan(nextLineup, experienceId, activeIdRef.current);
        dismissSwitcher();
      })();
    },
    [abortExperienceToHome, applyMountPlan, dismissSwitcher, ensureEntrypointReachable, refreshLineup],
  );

  const switchNext = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const nextLineup = refreshLineup();
    const nextId = nextExperienceId(nextLineup, id);
    if (nextId) applyMountPlan(nextLineup, nextId, id);
    bumpSwitcherIdle();
  }, [applyMountPlan, bumpSwitcherIdle, refreshLineup]);

  const switchPrevious = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const nextLineup = refreshLineup();
    const prevId = previousExperienceId(nextLineup, id);
    if (prevId) applyMountPlan(nextLineup, prevId, id);
    bumpSwitcherIdle();
  }, [applyMountPlan, bumpSwitcherIdle, refreshLineup]);

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
      const local = bootFromLocal({ online: isOnline });
      setDirectory(local.directory);
      setFeatured(local.featured);
      setMemberships(local.memberships);
      setParticipant({
        id: local.installation.installationId,
        role: "INSTALLATION",
        displayName: "This installation",
      });
      setError(null);

      if (local.restore && !bootRestoreDoneRef.current) {
        bootRestoreDoneRef.current = true;
        try {
          const nextLineup = buildLineup({
            online: isOnline,
            membershipIds: local.memberships.map((item) => item.applicationId),
            apps: local.directory,
          });
          setLineup(nextLineup);
          setExperienceOfflineMessage(local.restore.offlineBlocked ? (local.restore.offlineMessage ?? null) : null);
          setLaunchingApp(local.restore.app);
          if (local.restore.payload && !local.restore.offlineBlocked) {
            const probe = await ensureEntrypointReachable(local.restore.payload.embedUrl);
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
              applyMountPlan(nextLineup, local.restore.app.id, null, { app: local.restore.app });
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
          if (applied.ok && applied.newlyLive[0]) {
            const first = applied.newlyLive[0];
            setRevealBanner({ id: first.experienceId, name: first.name });
          }
        }
        applyOnlineDirectory(directoryResult.applications, membershipResult.experiences);
        setDirectory(directoryResult.applications);
        setFeatured(featuredResult.applications);
        setMemberships(membershipResult.experiences);
        refreshLineup([
          ...membershipResult.experiences.map((item) => item.application),
          ...directoryResult.applications,
        ]);
        preconnectOrigins([
          ...directoryResult.applications.map((a) => a.xperienceUrl || a.productionUrl),
          ...featuredResult.applications.map((a) => a.xperienceUrl || a.productionUrl),
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
  }, [api, navigate, props.online, applyMountPlan, refreshLineup, ensureEntrypointReachable]);

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

  useEffect(() => {
    void load();
  }, [load]);

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

  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (typeof props.online !== "boolean") return;
    if (props.online && wasOfflineRef.current) void load();
    wasOfflineRef.current = !props.online;
  }, [props.online, load]);

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
      setScreen("my-experience");
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
    setDirectory(directoryResult.applications);
    setMemberships(membershipResult.experiences);
    setFeatured((current) => current.map((app) => directoryResult.applications.find((fresh) => fresh.id === app.id) ?? app));
    setSelected((current) => current ? directoryResult.applications.find((fresh) => fresh.id === current.id) ?? current : null);
  }, [api]);

  const findApplication = useCallback(async (query: string) => {
    const result = await api.listDirectory({ q: query });
    const normalized = query.trim().toLowerCase();
    return result.applications.find((app) => app.name.toLowerCase() === normalized) ?? result.applications[0] ?? null;
  }, [api]);

  const openLocalExperience = useCallback(
    (app: DirectoryApplicationView, surface: ApplicationSurfaceType = "PUBLIC") => {
      const posture = shellAuthPosture(app.authMode);
      void posture;
      const nextLineup = refreshLineup([app, ...directory]);
      const online = !offline;
      const gate = canOperateOffline(app.offlineCapability, online);
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
        });
      })();
      void surface;
    },
    [abortExperienceToHome, applyMountPlan, directory, ensureEntrypointReachable, offline, refreshLineup],
  );

  const startApplication = useCallback(async (app: DirectoryApplicationView) => {
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
        openLocalExperience({ ...app, experienced: true }, "PUBLIC");
        summarizeLaunch(trace);
        return;
      }
      if (!app.experienced) {
        try {
          await api.startExperience(app.id);
        } catch {
          /* local open still allowed for PUBLIC / offline-capable */
        }
      }
      markLaunch(trace, "destination");
      try {
        const payload = await api.openExperience(app.id, { surface: "PUBLIC" });
        markLaunch(trace, "response");
        const nextLineup = refreshLineup([{ ...app, experienced: true }]);
        applyMountPlan(nextLineup, app.id, activeIdRef.current, { app: { ...app, experienced: true } });
        // Prefer server embed URL when available without remounting if already warm.
        setOpened(payload);
        setLaunchingApp(null);
        void refreshMemberships();
      } catch {
        openLocalExperience({ ...app, experienced: true }, "PUBLIC");
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

  const openApplication = useCallback(async (app: DirectoryApplicationView, surface: ApplicationSurfaceType = "PUBLIC") => {
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
        openLocalExperience(app, surface);
        if (!offline) {
          try {
            const payload = await api.openExperience(app.id, { surface });
            setOpened(payload);
          } catch {
            /* local mount already active */
          }
          void refreshMemberships();
        }
        summarizeLaunch(trace);
        return;
      }
      try {
        const payload = await api.openExperience(app.id, { surface });
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
      await api.stopExperience(stopTarget.applicationId);
      setStopTarget(null);
      await refreshMemberships();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This membership could not be removed.");
    } finally {
      setBusyId(null);
    }
  }

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

  const enterXperienceFromNav = () => {
    const lineupId = activeExperienceId ?? lineup[0]?.experienceId;
    const fromLineup = lineupId
      ? directory.find((app) => app.id === lineupId)
        ?? memberships.find((item) => item.applicationId === lineupId)?.application
        ?? continueItems.find((item) => item.applicationId === lineupId)?.application
      : undefined;
    const resume = fromLineup
      ?? continueItems[0]?.application
      ?? memberships[0]?.application;
    if (resume) {
      void (resume.experienced ? openApplication(resume, "PUBLIC") : startApplication(resume));
      return;
    }
    navigate("my-experience");
  };

  const renderGrid = (apps: DirectoryApplicationView[], options?: { home?: boolean; dense?: boolean }) => loading
    ? <Skeletons count={options?.home ? 4 : 6} home={options?.home} />
    : apps.length === 0
    ? <div className="ox-inline-empty"><p>No applications match this view.</p></div>
    : <div className={`ox-grid${options?.home ? " ox-home-grid" : ""}${options?.dense ? " ox-dense-grid" : ""}`}>{apps.map((app) => <AppCard key={app.id} app={app} dense={Boolean(options?.home || options?.dense)} busy={busyId === app.id} onSelect={() => {
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
        <button data-testid="nav-my-experience" className={screen === "my-experience" ? "active" : ""} onClick={() => navigate("my-experience")}><Icon name="experience" />My Xperience</button>
        <button className={screen === "profile" ? "active" : ""} onClick={() => navigate("profile")}><Icon name="profile" />Profile</button>
      </nav>
      <button data-testid="nav-voice" className="ox-voice-launch" onClick={() => navigate("voice")}><span><Icon name="voice" /></span><b>Use your voice</b><small>Tell OS Xperience your objective</small></button>
      <div className="ox-side-user"><span>{initials(userName)}</span><div><strong>{userName}</strong><small>Participant</small></div></div>
    </aside> : null}

    <main className="ox-main" ref={(node) => { mainScrollRef.current = node; }}>
      <div className="ox-topbar"><Brand /><div><button className="ox-icon-button" aria-label="Notifications"><Icon name="bell" /></button><button className="ox-avatar" aria-label="Open profile" onClick={() => navigate("profile")}>{initials(userName)}</button></div></div>
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
        {restoreNotice ? (
          <p className="ox-restore-notice" role="status" data-testid="restore-notice">
            {restoreNotice}{" "}
            <button type="button" className="ox-text-link" onClick={() => setRestoreNotice(null)}>
              Dismiss
            </button>
          </p>
        ) : null}
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

      {screen === "directory" ? <div data-testid="directory" className="ox-screen">
        <PageHeader title="Directory" />
        <form className="ox-search" onSubmit={searchApplications}><Icon name="search" /><input data-testid="search-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search applications" /><button>Search</button></form>
        <div className="ox-filter-row" aria-label="Directory categories">{DIRECTORY_CATEGORIES.map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        {renderGrid(filteredDirectory, { dense: true })}
        {!loading && filteredDirectory.length === 0 ? <div className="ox-inline-empty"><p>No applications match this category.</p><button onClick={() => setCategory("All")}>Show all</button></div> : null}
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
            {!selected.experienced ? (
              <button
                className="ox-button primary wide"
                disabled={busyId === selected.id}
                onClick={() => void startApplication(selected)}
              >
                {busyId === selected.id ? "Opening…" : "Xperience"}
              </button>
            ) : (
              <>
                <button
                  className="ox-button primary wide"
                  disabled={busyId === selected.id}
                  onClick={() => void openApplication(selected, "PUBLIC")}
                >
                  {busyId === selected.id ? "Opening…" : "Open"}
                </button>
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
            )}
          </div>
        </section>
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
            data-switcher-open={switcherOpen ? "1" : "0"}
            className={`ox-in-app ox-immersive${exitingExperience ? " is-exiting" : ""}${airGrabbed ? " is-grabbed" : ""}${navProgress > 0.02 ? " is-nav-dragging" : ""}`}
          >
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
            {frameFailed && opened && !experienceOfflineMessage ? (
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
            {!experienceOfflineMessage && !frameFailed
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
              lineup={lineup}
              activeId={activeExperienceId}
              onSelect={switchToExperience}
              onNext={switchNext}
              onPrevious={switchPrevious}
              onDismiss={dismissSwitcher}
            />
          </div>
        </>
      ) : null}
    </main>

    {!isDesktop && screen !== "experience" ? (
      <BottomNav screen={screen} go={navigate} onEnterXperience={enterXperienceFromNav} />
    ) : null}
    {stopTarget ? <div className="ox-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStopTarget(null); }}>
      <section data-testid="stop-modal" className="ox-modal" role="dialog" aria-modal="true" aria-labelledby="stop-title"><span className="ox-modal-icon">◇</span><h2 id="stop-title">Unxperience {stopTarget.application.name}?</h2><p>This removes it from My Xperience. You can add it again from Directory at any time.</p><div><button className="ox-button secondary" onClick={() => setStopTarget(null)}>Cancel</button><button data-testid="confirm-stop" className="ox-button danger" disabled={busyId === stopTarget.applicationId} onClick={() => void confirmStop()}>Unxperience</button></div></section>
    </div> : null}
  </div>;
}
