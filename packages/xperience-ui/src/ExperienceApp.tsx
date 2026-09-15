import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  DIRECTORY_CATEGORIES,
  parseExperienceUtterance,
  type DirectoryApplicationView,
  type ExperienceMembershipView,
  type OpenExperiencePayload,
} from "@digiconomy/xperience-contract";
import {
  createXperienceApiClient,
  XperienceApiError,
  type XperienceApiClient,
} from "@digiconomy/xperience-sdk";
import { getSpeechRecognition, type SpeechRecognition, type VoiceState } from "./speech.js";
import "./styles.css";

export interface ExperienceAppProps {
  apiBase?: string;
  userId?: string;
  userName?: string;
}

type Screen =
  | "home"
  | "directory"
  | "my-experience"
  | "profile"
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

function Icon({ name }: { name: "home" | "directory" | "voice" | "experience" | "profile" | "search" | "bell" | "back" | "more" }) {
  const paths = {
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    directory: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    voice: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    experience: <><path d="M4 5h16v14H4z" /><path d="m8 9 3 3-3 3M13 15h3" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    back: <path d="m15 18-6-6 6-6" />,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  };
  return <svg className="ox-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Brand() {
  return <span className="ox-brand"><span className="ox-logo" aria-hidden="true"><i /></span><strong>OS Experience</strong></span>;
}

function AppGlyph({ app, compact = false }: { app: DirectoryApplicationView; compact?: boolean }) {
  return <span className={`ox-app-glyph ox-tone-${app.category.toLowerCase()} ${compact ? "is-compact" : ""}`} aria-hidden="true">{initials(app.name)}</span>;
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return <section className="ox-state ox-error" role="alert"><span>!</span><h2>Something went wrong</h2><p>We couldn&apos;t load your experience right now.</p><button className="ox-button secondary" onClick={onRetry}>Try again</button></section>;
}

function Skeletons({ count = 4 }: { count?: number }) {
  return <div className="ox-grid ox-skeleton-grid" aria-label="Loading applications">{Array.from({ length: count }, (_, index) => <div className="ox-skeleton" key={index}><i /><b /><span /></div>)}</div>;
}

function AppCard({
  app,
  onSelect,
  onPrimary,
  busy,
}: {
  app: DirectoryApplicationView;
  onSelect: () => void;
  onPrimary: () => void;
  busy: boolean;
}) {
  return <article className="ox-app-card">
    <button className="ox-card-main" onClick={onSelect} aria-label={`View ${app.name}`}>
      <AppGlyph app={app} />
      <span><small>{app.category}</small><strong>{app.name}</strong><p>{app.description || "No description provided."}</p></span>
    </button>
    <div className="ox-card-footer"><span>{app.developerName || "Published application"}</span><button className="ox-button compact" disabled={busy} onClick={onPrimary}>{busy ? "Working…" : app.experienced ? "Open" : "Experience"}</button></div>
  </article>;
}

function BottomNav({ screen, go }: { screen: Screen; go: (screen: Screen) => void }) {
  return <nav className="ox-bottom-nav" aria-label="Primary navigation">
    <button data-testid="nav-home" className={screen === "home" ? "active" : ""} onClick={() => go("home")}><Icon name="home" /><span>Home</span></button>
    <button data-testid="nav-directory" className={screen === "directory" ? "active" : ""} onClick={() => go("directory")}><Icon name="directory" /><span>Directory</span></button>
    <button data-testid="nav-voice" className="ox-mobile-mic" onClick={() => go("voice")} aria-label="Voice"><span><Icon name="voice" /></span><small>Voice</small></button>
    <button data-testid="nav-my-experience" className={screen === "my-experience" ? "active" : ""} onClick={() => go("my-experience")}><Icon name="experience" /><span>My Experience</span></button>
    <button className={screen === "profile" ? "active" : ""} onClick={() => go("profile")}><Icon name="profile" /><span>Profile</span></button>
  </nav>;
}

export function ExperienceApp(props: ExperienceAppProps) {
  const apiBase = props.apiBase ?? env?.VITE_XPERIENCE_API_URL ?? "http://localhost:4100";
  const userId = props.userId ?? env?.VITE_XPERIENCE_USER_ID ?? "user-1";
  const userName = props.userName ?? env?.VITE_XPERIENCE_USER_NAME ?? "Member";
  const api = useMemo<XperienceApiClient>(() => createXperienceApiClient({
    baseUrl: apiBase,
    actor: `USER:${userId}`,
    email: `${userId}@xperience.local`,
    displayName: userName,
  }), [apiBase, userId, userName]);

  const [screen, setScreen] = useState<Screen>("home");
  const [directory, setDirectory] = useState<DirectoryApplicationView[]>([]);
  const [featured, setFeatured] = useState<DirectoryApplicationView[]>([]);
  const [memberships, setMemberships] = useState<ExperienceMembershipView[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [selected, setSelected] = useState<DirectoryApplicationView | null>(null);
  const [opened, setOpened] = useState<OpenExperiencePayload | null>(null);
  const [category, setCategory] = useState("All");
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [membershipFilter, setMembershipFilter] = useState<MembershipFilter>("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stopTarget, setStopTarget] = useState<ExperienceMembershipView | null>(null);
  const [frameFailed, setFrameFailed] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceText, setVoiceText] = useState("");
  const [voiceMessage, setVoiceMessage] = useState("Say what you want to do.");
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 960px)").matches);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [directoryResult, featuredResult, membershipResult, me] = await Promise.all([
        api.listDirectory(),
        api.featuredDirectory(),
        api.listMyExperience(),
        api.me(),
      ]);
      setDirectory(directoryResult.applications);
      setFeatured(featuredResult.applications);
      setMemberships(membershipResult.experiences);
      setParticipant(me);
    } catch (reason) {
      setError(reason instanceof XperienceApiError ? reason.message : "The service could not be reached.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 960px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => () => recognitionRef.current?.abort(), []);

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

  const startApplication = useCallback(async (app: DirectoryApplicationView) => {
    setBusyId(app.id);
    setError(null);
    try {
      await api.startExperience(app.id);
      await refreshMemberships();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The application could not be added.");
    } finally {
      setBusyId(null);
    }
  }, [api, refreshMemberships]);

  const openApplication = useCallback(async (app: DirectoryApplicationView) => {
    if (!app.experienced) {
      setSelected(app);
      setScreen("detail");
      return;
    }
    setBusyId(app.id);
    setError(null);
    try {
      const payload = await api.openExperience(app.id);
      setOpened(payload);
      setFrameFailed(false);
      setScreen("experience");
      await refreshMemberships();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not open ${app.name}.`);
    } finally {
      setBusyId(null);
    }
  }, [api, refreshMemberships]);

  const routeObjective = useCallback(async (text: string) => {
    const utterance = parseExperienceUtterance(text);
    setVoiceState("resolving");
    if (utterance.kind === "show_experience") {
      setScreen("my-experience");
      setVoiceMessage("Opening My Experience.");
      setVoiceState("ready");
      return;
    }
    if (utterance.kind === "category") {
      setCategory(utterance.category);
      setSearchQuery("");
      setScreen("directory");
      setVoiceMessage(`Showing ${utterance.category} applications.`);
      setVoiceState("ready");
      return;
    }
    if (utterance.kind === "search") {
      setSearchText(utterance.query);
      setSearchQuery(utterance.query);
      setScreen("search");
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
          setScreen("search");
          setVoiceMessage(`No matching application was found for ${utterance.query}.`);
          setVoiceState("ready");
          return;
        }
        if (utterance.kind === "start_experience") {
          await startApplication(app);
          setScreen("my-experience");
          setVoiceMessage(`${app.name} was added to My Experience.`);
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
    setScreen("search");
  }

  function beginListening() {
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setVoiceState("unavailable");
      setVoiceMessage("Voice input is not available in this browser. Use an example or type an objective.");
      return;
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
      setVoiceMessage("Voice input could not start. Please try again.");
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
  const continueItems = memberships.filter((item) => item.status === "ACTIVE");

  const renderGrid = (apps: DirectoryApplicationView[]) => loading
    ? <Skeletons />
    : <div className="ox-grid">{apps.map((app) => <AppCard key={app.id} app={app} busy={busyId === app.id} onSelect={() => { setSelected(app); setScreen("detail"); }} onPrimary={() => void (app.experienced ? openApplication(app) : startApplication(app))} />)}</div>;

  function PageHeader({ eyebrow, title, copy }: { eyebrow?: string; title: string; copy?: string }) {
    return <header className="ox-page-header">{eyebrow ? <small>{eyebrow}</small> : null}<h1>{title}</h1>{copy ? <p>{copy}</p> : null}</header>;
  }

  function BackButton({ destination = "directory" }: { destination?: Screen }) {
    return <button className="ox-icon-button" aria-label="Go back" onClick={() => setScreen(destination)}><Icon name="back" /></button>;
  }

  return <div className="ox-root" data-testid="os-experience">
    {isDesktop ? <aside className="ox-sidebar">
      <Brand />
      <nav className="ox-side-nav" aria-label="Primary navigation">
        <button data-testid="nav-home" className={screen === "home" ? "active" : ""} onClick={() => setScreen("home")}><Icon name="home" />Home</button>
        <button data-testid="nav-directory" className={screen === "directory" || screen === "search" || screen === "detail" ? "active" : ""} onClick={() => setScreen("directory")}><Icon name="directory" />Directory</button>
        <button data-testid="nav-my-experience" className={screen === "my-experience" ? "active" : ""} onClick={() => setScreen("my-experience")}><Icon name="experience" />My Experience</button>
        <button className={screen === "profile" ? "active" : ""} onClick={() => setScreen("profile")}><Icon name="profile" />Profile</button>
      </nav>
      <button data-testid="nav-voice" className="ox-voice-launch" onClick={() => setScreen("voice")}><span><Icon name="voice" /></span><b>Use your voice</b><small>Tell OS Experience your objective</small></button>
      <div className="ox-side-user"><span>{initials(userName)}</span><div><strong>{userName}</strong><small>Participant</small></div></div>
    </aside> : null}

    <main className="ox-main">
      <div className="ox-topbar"><Brand /><div><button className="ox-icon-button" aria-label="Notifications"><Icon name="bell" /></button><button className="ox-avatar" aria-label="Open profile" onClick={() => setScreen("profile")}>{initials(userName)}</button></div></div>
      {error && screen !== "experience" ? <ErrorPanel onRetry={() => void load()} /> : null}

      {!error && screen === "home" ? <div data-testid="home" className="ox-screen ox-home">
        <section className="ox-hero">
          <div><small>YOUR OS EXPERIENCE</small><h1>Hello, {userName}.</h1><p>Your Digital Life. Your Applications. One Experience.</p>
            <form data-testid="home-search" className="ox-objective" onSubmit={submitObjective}>
              <Icon name="search" /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="What would you like to do?" aria-label="Your objective" />
              <button type="button" aria-label="Use voice" onClick={() => setScreen("voice")}><Icon name="voice" /></button>
              <button type="submit">Go</button>
            </form>
          </div>
          <div className="ox-orbit" aria-hidden="true"><i /><span>OS</span></div>
        </section>

        <section className="ox-section">
          <div className="ox-section-heading"><div><small>PICK UP WHERE YOU LEFT OFF</small><h2>Continue Your Experience</h2></div><button onClick={() => setScreen("my-experience")}>See all <span>→</span></button></div>
          {loading ? <Skeletons count={3} /> : continueItems.length ? <div className="ox-continue-row">{continueItems.slice(0, 4).map((item) => <button key={item.applicationId} onClick={() => void openApplication(item.application)}><AppGlyph compact app={item.application} /><span><strong>{item.application.name}</strong><small>{item.application.category}</small></span><em>Open →</em></button>)}</div> : <div className="ox-inline-empty"><p>Your active applications will appear here.</p><button onClick={() => setScreen("directory")}>Explore Directory</button></div>}
        </section>

        <section className="ox-section">
          <div className="ox-section-heading"><div><small>DISCOVER</small><h2>Explore Digiconomy</h2></div><button data-testid="explore-directory" onClick={() => setScreen("directory")}>Explore all <span>→</span></button></div>
          <div className="ox-category-cloud">{DIRECTORY_CATEGORIES.filter((item) => item !== "All").map((item) => <button key={item} onClick={() => { setCategory(item); setScreen("directory"); }}>{item}</button>)}</div>
        </section>

        <section className="ox-section">
          <div className="ox-section-heading"><div><small>FROM THE DIRECTORY</small><h2>Featured applications</h2></div></div>
          {renderGrid(featured)}
          {!loading && featured.length === 0 ? <p className="ox-empty-copy">No featured applications are available right now.</p> : null}
        </section>
      </div> : null}

      {!error && screen === "directory" ? <div data-testid="directory" className="ox-screen">
        <PageHeader eyebrow="DISCOVER YOUR DIGITAL WORLD" title="Directory" copy="Browse published applications and shape an experience that is yours." />
        <form className="ox-search" onSubmit={searchApplications}><Icon name="search" /><input data-testid="search-input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search applications" /><button>Search</button></form>
        <div className="ox-filter-row" aria-label="Directory categories">{DIRECTORY_CATEGORIES.map((item) => <button className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        {renderGrid(filteredDirectory)}
        {!loading && filteredDirectory.length === 0 ? <div className="ox-inline-empty"><p>No applications match this category.</p><button onClick={() => setCategory("All")}>Show all</button></div> : null}
      </div> : null}

      {!error && screen === "search" ? <div data-testid="search" className="ox-screen">
        <PageHeader eyebrow="DIRECTORY SEARCH" title={searchQuery ? `Results for “${searchQuery}”` : "Search applications"} copy={`${searchResults.length} result${searchResults.length === 1 ? "" : "s"} from the directory.`} />
        <form className="ox-search" onSubmit={searchApplications}><Icon name="search" /><input data-testid="search-input" autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search applications" /><button>Search</button></form>
        {renderGrid(searchResults)}
        {!loading && searchResults.length === 0 ? <div className="ox-inline-empty"><p>No matching applications were found.</p><button onClick={() => { setSearchText(""); setSearchQuery(""); setScreen("directory"); }}>Browse Directory</button></div> : null}
      </div> : null}

      {!error && screen === "detail" ? <div className="ox-screen ox-detail">
        <BackButton />
        {selected ? <section className="ox-detail-card">
          <div className="ox-detail-lead"><AppGlyph app={selected} /><div><small>{selected.category}</small><h1>{selected.name}</h1><p>{selected.description || "No public description was provided."}</p></div></div>
          <dl><div><dt>Publisher</dt><dd>{selected.developerName || "Not provided"}</dd></div><div><dt>Version</dt><dd>{selected.version}</dd></div><div><dt>Capabilities</dt><dd>{selected.capabilities.join(", ") || "None declared"}</dd></div><div><dt>Website</dt><dd><a href={selected.productionUrl} target="_blank" rel="noreferrer">{new URL(selected.productionUrl).hostname}</a></dd></div></dl>
          <button className="ox-button primary wide" disabled={busyId === selected.id} onClick={() => void (selected.experienced ? openApplication(selected) : startApplication(selected))}>{busyId === selected.id ? "Working…" : selected.experienced ? "Open" : "Experience"}</button>
        </section> : <div className="ox-inline-empty"><p>Select an application from Directory.</p></div>}
      </div> : null}

      {!error && screen === "my-experience" ? <div data-testid="my-experience" className="ox-screen">
        <PageHeader eyebrow="YOUR DIGITAL SPACE" title="My Experience" copy="The applications you have chosen, together in one place." />
        <div className="ox-filter-row">{(["All", "Active", "Paused", "Recently Used"] as MembershipFilter[]).map((item) => <button className={membershipFilter === item ? "active" : ""} key={item} onClick={() => setMembershipFilter(item)}>{item}</button>)}</div>
        {loading ? <Skeletons /> : filteredMemberships.length ? <div className="ox-memberships">{filteredMemberships.map((item) => <article key={item.applicationId}>
          <AppGlyph compact app={item.application} /><div><strong>{item.application.name}</strong><small><i className={`ox-status ${item.status.toLowerCase()}`} />{item.status === "ACTIVE" ? "Active" : item.status === "PAUSED" ? "Paused" : "Unavailable"}{item.lastOpenedAt ? ` · Used ${new Date(item.lastOpenedAt).toLocaleDateString()}` : ""}</small></div>
          <button className="ox-button compact" disabled={item.status === "UNAVAILABLE" || busyId === item.applicationId} onClick={() => void openApplication(item.application)}>Open</button>
          <button className="ox-icon-button" aria-label={`Stop experiencing ${item.application.name}`} onClick={() => setStopTarget(item)}><Icon name="more" /></button>
        </article>)}</div> : <section className="ox-state"><span>◇</span><h2>Your Experience is ready to grow</h2><p>Add an application from Directory to see it here.</p><button className="ox-button primary" onClick={() => setScreen("directory")}>Explore Directory</button></section>}
      </div> : null}

      {!error && screen === "profile" ? <div className="ox-screen">
        <PageHeader eyebrow="PARTICIPANT" title="Profile" copy="Your participant information for this OS Experience." />
        <section className="ox-profile-card"><span className="ox-profile-avatar">{initials(participant?.displayName || userName)}</span><div><h2>{participant?.displayName || userName}</h2><p>{participant?.email || "No email provided"}</p></div><dl><div><dt>Participant ID</dt><dd>{participant?.id || userId}</dd></div><div><dt>Role</dt><dd>{participant?.role || "USER"}</dd></div></dl></section>
      </div> : null}

      {screen === "voice" ? <div data-testid="voice" className="ox-screen ox-voice">
        <button className="ox-voice-close" onClick={() => setScreen("home")} aria-label="Close voice"><Icon name="back" /> Back</button>
        <section>
          <small>VOICE</small><h1>What can we help you do?</h1>
          <button className={`ox-voice-orb state-${voiceState}`} onClick={voiceState === "listening" ? stopListening : beginListening} aria-label={voiceState === "listening" ? "Stop listening" : "Start listening"}><i /><Icon name="voice" /></button>
          <strong className="ox-voice-state">{voiceState === "listening" ? "Listening" : voiceState === "understanding" ? "Understanding" : voiceState === "resolving" ? "Resolving" : voiceState === "unavailable" ? "Voice unavailable" : voiceState === "error" ? "Try again" : voiceState === "ready" ? "Ready" : "Tap to speak"}</strong>
          {voiceText ? <blockquote>“{voiceText}”</blockquote> : null}<p>{voiceMessage}</p>
          {voiceState === "listening" ? <button className="ox-button secondary" onClick={stopListening}>Stop</button> : null}
          <div className="ox-voice-examples"><small>TRY AN EXAMPLE</small>{["Show my applications", "Find finance apps", "Open an application"].map((example) => <button key={example} onClick={() => { setVoiceText(example); setVoiceState("understanding"); void routeObjective(example); }}>{example}</button>)}</div>
        </section>
      </div> : null}

      {screen === "experience" && opened ? <div data-testid="in-app-experience" className="ox-in-app">
        <header><button className="ox-icon-button" aria-label="Close application" onClick={() => setScreen("my-experience")}><Icon name="back" /></button><strong>{opened.name}</strong><a className="ox-icon-button" href={opened.embedUrl} target="_blank" rel="noreferrer" aria-label={`Open ${opened.name} in a new tab`}><Icon name="more" /></a></header>
        {frameFailed ? <section className="ox-frame-fallback"><h1>This application couldn&apos;t be embedded</h1><p>It may only allow a full browser window.</p><a className="ox-button primary" href={opened.embedUrl} target="_blank" rel="noreferrer">Open in a new tab</a></section> : <><iframe title={opened.name} src={opened.embedUrl} sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts" onError={() => setFrameFailed(true)} /><aside className="ox-frame-note">Having trouble? <a href={opened.embedUrl} target="_blank" rel="noreferrer">Open in a new tab</a></aside></>}
      </div> : null}
    </main>

    {!isDesktop ? <BottomNav screen={screen} go={setScreen} /> : null}
    {stopTarget ? <div className="ox-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStopTarget(null); }}>
      <section data-testid="stop-modal" className="ox-modal" role="dialog" aria-modal="true" aria-labelledby="stop-title"><span className="ox-modal-icon">◇</span><h2 id="stop-title">Stop experiencing {stopTarget.application.name}?</h2><p>This removes it from My Experience. You can add it again from Directory at any time.</p><div><button className="ox-button secondary" onClick={() => setStopTarget(null)}>Cancel</button><button data-testid="confirm-stop" className="ox-button danger" disabled={busyId === stopTarget.applicationId} onClick={() => void confirmStop()}>Stop Experiencing</button></div></section>
    </div> : null}
  </div>;
}
