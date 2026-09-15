import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DIRECTORY_CATEGORIES,
  type DirectoryApplicationView,
  type ExperienceMembershipView,
} from "@digiconomy/xperience-contract";
import { createXperienceApiClient, XperienceApiError, type XperienceApiClient } from "@digiconomy/xperience-sdk";
import "./styles.css";
import "./mobile.css";

const API_BASE = import.meta.env.VITE_XPERIENCE_API_URL ?? "http://localhost:4100";
const USER_ID = import.meta.env.VITE_XPERIENCE_USER_ID ?? "user-1";
const USER_NAME = import.meta.env.VITE_XPERIENCE_USER_NAME ?? "Member";
type App = DirectoryApplicationView;

function Logo() { return <span className="logo-mark"><span /></span>; }
function Icon({ children }: { children: string }) { return <span className="nav-icon">{children}</span>; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "A"; }
function tone(app: App) { return app.category === "Finance" ? "gold" : app.category === "Lifestyle" ? "green" : app.category === "Identity" ? "blue" : "pink"; }
function AppIcon({ app, small = false }: { app: App; small?: boolean }) { return <span className={`app-art-icon ${tone(app)} ${small ? "small" : ""}`}>{initials(app.name)}</span>; }

function State({ loading, error, empty, onRetry, onExplore }: { loading: boolean; error: string | null; empty: boolean; onRetry: () => void; onExplore: () => void }) {
  if (loading) return <div className="state-panel"><strong>Loading eligible applications…</strong></div>;
  if (error) return <div className="state-panel error"><strong>Portal unavailable</strong><p>{error}</p><button className="experience-btn" onClick={onRetry}>Retry</button></div>;
  if (empty) return <div className="state-panel"><strong>No eligible applications yet</strong><p>Published applications from the Portal will appear here when available.</p><button className="experience-btn" onClick={onExplore}>Explore Directory</button></div>;
  return null;
}

function CompactCard({ app, onOpen, onSelect }: { app: App; onOpen: (app: App) => void; onSelect: (app: App) => void }) {
  return <article className="compact-card" onClick={() => onSelect(app)}><AppIcon app={app} small /><div className="compact-copy"><strong>{app.name}</strong><span>{app.category}</span></div><i className="online-dot" /><button className="open-btn" onClick={(event) => { event.stopPropagation(); onOpen(app); }}>Open</button><button className="more" aria-label={`More options for ${app.name}`} onClick={(event) => event.stopPropagation()}>⋮</button></article>;
}

function DirectoryCard({ app, onExperience, onOpen, onSelect }: { app: App; onExperience: (app: App) => void; onOpen: (app: App) => void; onSelect: (app: App) => void }) {
  return <article className="directory-card forest" onClick={() => onSelect(app)}><div className="card-shade" /><span className="spark">+</span><AppIcon app={app} /><div className="directory-copy"><h3>{app.name}</h3><span>{app.category}</span><p>{app.description || "Published application in the Digiconomy."}</p></div><button className="experience-btn" onClick={(event) => { event.stopPropagation(); app.experienced ? onOpen(app) : onExperience(app); }}>{app.experienced ? "Open" : "Experience"}</button></article>;
}

function BottomNav({ active = "Home", onNavigate }: { active?: string; onNavigate: (tab: string) => void }) {
  return <nav className="bottom-nav">{[["⌂", "Home"], ["▱", "Directory"], ["◉", "My Experience"], ["♙", "Profile"]].map(([icon, label]) => <button className={active === label ? "active" : ""} onClick={() => onNavigate(label)} key={label}><Icon>{icon}</Icon><small>{label}</small></button>)}<button className="voice-fab" aria-label="Voice assistant" onClick={() => onNavigate("Voice")}>●</button></nav>;
}

function MobileSearch({ apps, onOpen, onNavigate }: { apps: App[]; onOpen: (app: App) => void; onNavigate: (tab: string) => void }) {
  return <section className="mobile-panel search-panel"><header><button onClick={() => onNavigate("Home")}>‹</button><strong>Search</strong></header><div className="mobile-search"><span>⌕</span><b>{apps[0]?.name || "Search applications"}</b><span>×</span><button aria-label="Voice search">♩</button></div><div className="mobile-pills"><b>All</b><span>Apps</span><span>Creators</span><span>Services</span></div><h4>Eligible applications</h4>{apps.slice(0, 4).map((app) => <div className="result-row" key={app.id}><AppIcon app={app} small /><div><strong>{app.name}</strong><small>{app.category}<br />{app.description || "Published application"}</small></div><button className="experience-btn" onClick={() => onOpen(app)}>Open</button></div>)}{apps.length === 0 ? <p className="muted-copy">No search results from the Portal.</p> : null}<BottomNav active="Directory" onNavigate={onNavigate} /></section>;
}

function MobileExperience({ mine, onOpen, onNavigate }: { mine: ExperienceMembershipView[]; onOpen: (app: App) => void; onNavigate: (tab: string) => void }) {
  return <section className="mobile-panel experience-panel"><header><button onClick={() => onNavigate("Home")}>‹</button><strong>My Experience</strong><button aria-label="More">•••</button></header><div className="mobile-pills"><b>All</b><span>Active</span><span>Paused</span><span>Recently Used</span></div>{mine.map((item) => <div className="experience-row" key={item.applicationId}><AppIcon app={item.application} small /><div><strong>{item.application.name}</strong><small className={item.status === "ACTIVE" ? "active-text" : "paused"}>{item.status}</small></div><button className="open-btn" onClick={() => onOpen(item.application)}>Open</button><span>⋮</span></div>)}{mine.length === 0 ? <p className="muted-copy">Your Experience is empty. Add an eligible application from Directory.</p> : null}<BottomNav active="My Experience" onNavigate={onNavigate} /></section>;
}

function MobileHome({ directory, mine, onExperience, onOpen, onSelect, onNavigate, onSearch }: { directory: App[]; mine: ExperienceMembershipView[]; onExperience: (app: App) => void; onOpen: (app: App) => void; onSelect: (app: App) => void; onNavigate: (tab: string) => void; onSearch: (value: string) => void }) {
  const continueItems = mine.map((item) => item.application).slice(0, 3);
  return <section className="mobile-panel mobile-home"><header className="mobile-home-header"><div className="brand"><Logo /><strong>OS Experience</strong></div><div className="mobile-home-actions"><button aria-label="Notifications" disabled>♧</button><span>M</span></div></header><div className="mobile-welcome"><small>Your Digital Life. Your Applications. One Experience.</small><h1>Good afternoon,<br />Member <span>👋</span></h1><div className="mobile-home-orbit" /></div><form className="mobile-home-search" onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem("mobile-search") as HTMLInputElement; onSearch(input.value.trim()); onNavigate("Directory"); }}><span>⌕</span><input name="mobile-search" placeholder="Search applications, creators, services..." /><button type="submit">♩</button></form>{continueItems.length ? <section className="mobile-home-section"><div className="mobile-home-title"><h2>Continue Your Experience</h2><button onClick={() => onNavigate("My Experience")}>See all →</button></div><div className="mobile-home-continue">{continueItems.map((app) => <button className="mobile-home-app" onClick={() => onOpen(app)} key={app.id}><AppIcon app={app} small /><span><strong>{app.name}</strong><small>{app.category}</small></span><em>Open</em></button>)}</div></section> : null}<section className="mobile-home-section"><div className="mobile-home-title"><h2>Explore the Digiconomy</h2><button onClick={() => onNavigate("Directory")}>See all →</button></div><div className="mobile-home-directory">{directory.slice(0, 4).map((app) => <button className="mobile-home-directory-card" onClick={() => onSelect(app)} key={app.id}><AppIcon app={app} /><strong>{app.name}</strong><small>{app.category}</small><span>{app.description || "Published application"}</span><em>{app.experienced ? "Open" : "Experience"}</em></button>)}</div>{directory.length === 0 ? <p className="muted-copy">No eligible applications are available from the Portal.</p> : null}</section><BottomNav active="Home" onNavigate={onNavigate} /></section>;
}

function App() {
  const api = useMemo<XperienceApiClient>(() => createXperienceApiClient({ baseUrl: API_BASE, actor: `USER:${USER_ID}`, email: `${USER_ID}@xperience.local`, displayName: USER_NAME }), []);
  const [directory, setDirectory] = useState<App[]>([]);
  const [mine, setMine] = useState<ExperienceMembershipView[]>([]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [selected, setSelected] = useState<App | null>(null);
  const [mobileView, setMobileView] = useState<"home" | "search" | "details" | "voice" | "experience">("home");

  async function load() {
    setLoading(true); setError(null);
    try {
      const [directoryResult, experienceResult] = await Promise.all([
        api.listDirectory({ q: search || undefined, category: category === "All" ? undefined : category }),
        api.listMyExperience(),
      ]);
      setDirectory(directoryResult.applications); setMine(experienceResult.experiences);
    } catch (err) {
      setDirectory([]); setMine([]); setError(err instanceof XperienceApiError ? err.message : "The Portal could not be reached.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [api, category, search]);
  useEffect(() => { void navigator.serviceWorker?.register("/sw.js"); const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as Event & { prompt: () => Promise<void> }); }; window.addEventListener("beforeinstallprompt", onPrompt); return () => window.removeEventListener("beforeinstallprompt", onPrompt); }, []);
  async function experience(app: App) { setBusy(app.id); setError(null); try { await api.startExperience(app.id); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Could not add this application to your Experience."); } finally { setBusy(null); } }
  async function open(app: App) {
    if (!app.experienced) { await experience(app); return; }
    if (app.experienceStatus === "UNAVAILABLE") { setError(`${app.name} is no longer available from the Portal.`); return; }
    setBusy(app.id); setError(null);
    try {
      const destination = await api.openExperience(app.id);
      window.open(destination.embedUrl, "_blank", "noopener,noreferrer");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not open ${app.name}.`);
    } finally { setBusy(null); }
  }
  function navigateMobile(tab: string) {
    setMobileView(tab === "Directory" ? "search" : tab === "My Experience" ? "experience" : tab === "Voice" ? "voice" : "home");
  }
  function selectApp(app: App) { setSelected(app); setMobileView("details"); }
  const continueItems = mine.map((item) => item.application).slice(0, 4);
  const categoryOptions = ["All", ...DIRECTORY_CATEGORIES.filter((value) => value !== "All")];
  return <main className="page">{installPrompt ? <aside className="install-banner"><Logo /><span><strong>Install OS Experience</strong><small>Keep your experience one tap away.</small></span><button onClick={() => { void installPrompt.prompt(); setInstallPrompt(null); }}>Install</button><button className="dismiss" onClick={() => setInstallPrompt(null)}>×</button></aside> : null}<div className="desktop-shell"><aside className="sidebar"><div className="brand"><Logo /><strong>OS Experience</strong></div><nav className="side-nav">{[["⌂", "Home"], ["▱", "Directory"], ["▣", "My Experience"], ["♙", "Profile"]].map(([icon, label], i) => <button className={i === 0 ? "selected" : ""} key={label}><Icon>{icon}</Icon>{label}</button>)}</nav><div className="side-promo"><strong>Your Digital Life<br />Your Way</strong><div className="energy-globe" /></div></aside><section className="home"><header className="hero"><div><h1>Good afternoon, {USER_NAME} <span>👋</span></h1><p>Your Digital Life. Your Applications. One Experience.</p></div><div className="hero-art"><div className="planet planet-one" /><div className="planet planet-two" /><strong>A more open<br />digital world.</strong><small>Discover. Experience.<br />Create. Belong.</small></div><div className="hero-actions"><button aria-label="Notifications">♧<i /></button><span>{initials(USER_NAME).slice(0, 1)}</span></div></header><form className="search-bar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applications, creators, services..." /><button type="submit">♩</button></form><section className="section compact-section"><div className="section-heading"><h2>Continue Your Experience</h2><a>See All →</a></div>{continueItems.length ? <div className="compact-grid">{continueItems.map((app) => <CompactCard app={app} onOpen={open} onSelect={setSelected} key={app.id} />)}</div> : <State loading={loading} error={error} empty={!loading && !error} onRetry={() => void load()} onExplore={() => setSearch("")} />}</section><section className="section directory-section"><div className="section-heading"><h2>Explore the Digiconomy</h2><a>See All →</a></div><div className="category-row">{categoryOptions.map((item) => <button className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{item}</button>)}<button>More⌄</button></div><State loading={loading} error={error} empty={!loading && !error && directory.length === 0} onRetry={() => void load()} onExplore={() => setSearch("")} /><div className="directory-grid">{directory.map((app) => <DirectoryCard app={app} onExperience={experience} onOpen={open} onSelect={setSelected} key={app.id} />)}</div>{busy ? <small className="busy-copy">Updating your Experience…</small> : null}</section></section></div><div className={`mobile-strip mobile-${mobileView}`}>{mobileView === "home" ? <MobileHome directory={directory} mine={mine} onExperience={experience} onOpen={open} onSelect={selectApp} onNavigate={navigateMobile} onSearch={setSearch} /> : null}{mobileView === "search" ? <MobileSearch apps={directory} onOpen={open} onNavigate={navigateMobile} /> : null}{mobileView === "details" ? <section className="mobile-panel detail-panel"><header><button aria-label="Back" onClick={() => setMobileView("search")}>‹</button><strong>{selected?.name || "Application details"}</strong><button aria-label="More">•••</button></header><div className="detail-sheet">{selected ? <><h3>{selected.name}</h3><small>{selected.category} · v{selected.version}</small><p>{selected.description || "No public description was provided by the Portal."}</p><div className="detail-lines"><span>Origin <b>{selected.origin}</b></span><span>Public application <b>{selected.productionUrl}</b></span><span>Publication <b>{selected.publicationState}</b></span><span>Developer <b>{selected.developerName || "Not provided"}</b></span></div><button className="add-btn" onClick={() => void open(selected)}>{selected.experienced ? "Open application" : "Add to Experience"}</button></> : <p>Select an application from Directory to inspect its canonical metadata.</p>}</div><BottomNav active="Directory" onNavigate={navigateMobile} /></section> : null}{mobileView === "voice" ? <section className="mobile-panel voice-panel"><header><strong>Voice Assistant</strong><button aria-label="Close" onClick={() => setMobileView("home")}>×</button></header><div className="voice-orb"><span>))))</span></div><h3>Listening...</h3><p>Voice objectives use Portal discovery when connected.</p></section> : null}{mobileView === "experience" ? <MobileExperience mine={mine} onOpen={open} onNavigate={navigateMobile} /> : null}</div><footer><div><Logo /><strong>OS Experience</strong></div><span>One OS. Every Experience. The Digiconomy.</span><span>Discover. Add. Experience. Your Digital Life, Your Way.</span></footer></main>;
}

createRoot(document.getElementById("root")!).render(<App />);
