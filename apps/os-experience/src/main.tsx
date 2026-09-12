import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DIRECTORY_CATEGORIES,
  type DirectoryApplicationView,
  type ExperienceMembershipView,
  type OpenExperiencePayload,
} from "@digiconomy/xperience-contract";
import { createXperienceApiClient, XperienceApiError, type XperienceApiClient } from "@digiconomy/xperience-sdk";
import "./styles.css";

type Tab = "home" | "directory" | "my-experience" | "profile";
type Screen =
  | { name: "tabs"; tab: Tab }
  | { name: "search"; seed?: string }
  | { name: "detail"; appId: string }
  | { name: "experience"; appId: string; payload: OpenExperiencePayload };

const API_BASE = import.meta.env.VITE_XPERIENCE_API_URL ?? "http://localhost:4100";
const USER_ID = import.meta.env.VITE_XPERIENCE_USER_ID ?? "user-1";
const USER_NAME = import.meta.env.VITE_XPERIENCE_USER_NAME ?? "Member";
const RECENT_SEARCH_KEY = "os-experience.recent-searches";

function useApi(): XperienceApiClient {
  return useMemo(
    () =>
      createXperienceApiClient({
        baseUrl: API_BASE,
        actor: `USER:${USER_ID}`,
        email: `${USER_ID}@xperience.local`,
        displayName: USER_NAME,
      }),
    [],
  );
}

function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function tone(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hues = [210, 195, 168, 152, 232, 24];
  const h = hues[hash % hues.length]!;
  return `linear-gradient(145deg, hsl(${h} 72% 58%), hsl(${h + 18} 62% 38%))`;
}

function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function pushRecentSearch(term: string): void {
  const next = [term, ...readRecentSearches().filter((item) => item !== term)].slice(0, 6);
  localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
}

function Skeleton({ rows = 3, testId }: { rows?: number; testId?: string }) {
  return (
    <div className="skeleton-stack" data-testid={testId ?? "loading"} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-card" key={i}>
          <div className="skeleton-icon shimmer" />
          <div className="skeleton-lines">
            <div className="skeleton-line shimmer" />
            <div className="skeleton-line short shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatePanel({
  loading,
  error,
  empty,
  emptyTitle,
  onRetry,
  onExplore,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  onRetry?: () => void;
  onExplore?: () => void;
}) {
  if (loading) return <Skeleton />;
  if (error) {
    return (
      <div className="state-panel error" data-testid="error">
        <h3>Something went wrong</h3>
        <p>{error}</p>
        {onRetry ? (
          <button className="primary" onClick={onRetry} data-testid="retry" type="button">
            Try Again
          </button>
        ) : null}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="state-panel empty" data-testid="empty">
        <h3>{emptyTitle ?? "Nothing here yet"}</h3>
        <p>Discover applications from the Directory and make them part of your Experience.</p>
        {onExplore ? (
          <button className="primary" onClick={onExplore} type="button">
            Explore Directory
          </button>
        ) : null}
      </div>
    );
  }
  return null;
}

function AppIcon({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={`app-icon ${size}`} style={{ background: tone(name) }} aria-hidden>
      {initials(name) || name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function App() {
  const api = useApi();
  const [screen, setScreen] = useState<Screen>({ name: "tabs", tab: "home" });
  const [displayName, setDisplayName] = useState(USER_NAME);
  const [directory, setDirectory] = useState<DirectoryApplicationView[]>([]);
  const [featured, setFeatured] = useState<DirectoryApplicationView[]>([]);
  const [mine, setMine] = useState<ExperienceMembershipView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("All");
  const [mineFilter, setMineFilter] = useState("All");
  const [menuFor, setMenuFor] = useState<ExperienceMembershipView | null>(null);
  const [stopFor, setStopFor] = useState<ExperienceMembershipView | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const me = await api.me();
      setDisplayName(me.displayName || me.email || USER_NAME);
      const [dir, feat, exp] = await Promise.all([
        api.listDirectory({ category: category === "All" ? undefined : category }),
        api.featuredDirectory(),
        api.listMyExperience(mineFilter),
      ]);
      setDirectory(dir.applications);
      setFeatured(feat.applications);
      setMine(exp.experiences);
    } catch (err) {
      setError(
        err instanceof XperienceApiError ? err.message : "We couldn't load your Experience.",
      );
      setDirectory([]);
      setFeatured([]);
      setMine([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api, category, mineFilter]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openApp(appId: string) {
    setBusy(true);
    setError(null);
    try {
      const payload = await api.openExperience(appId);
      setScreen({ name: "experience", appId, payload });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open experience.");
    } finally {
      setBusy(false);
    }
  }

  const tab = screen.name === "tabs" ? screen.tab : null;
  const continueItems = mine.filter((item) => item.status === "ACTIVE");
  const recentItems = [...mine]
    .filter((item) => item.lastOpenedAt)
    .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
  const discoverItems = featured.filter((app) => !app.experienced);
  const presentCategories = [
    ...new Set(featured.map((app) => app.category).concat(directory.map((app) => app.category))),
  ];

  return (
    <div className={`app-shell ${screen.name === "experience" ? "immersive" : ""}`} data-testid="os-experience">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="layout">
        {screen.name !== "experience" && screen.name !== "detail" ? (
          <nav className="side-nav" aria-label="Primary" data-testid="side-nav">
            <div className="brand side-brand">
              <span className="brand-mark" />
              OS Experience
            </div>
            <NavButton active={tab === "home"} label="Home" onClick={() => setScreen({ name: "tabs", tab: "home" })} icon="⌂" />
            <NavButton
              active={tab === "directory"}
              label="Directory"
              onClick={() => setScreen({ name: "tabs", tab: "directory" })}
              icon="▦"
            />
            <button
              className="nav-plus side-plus"
              aria-label="Add experience"
              data-testid="nav-plus-side"
              type="button"
              onClick={() => setScreen({ name: "tabs", tab: "directory" })}
            >
              +
            </button>
            <NavButton
              active={tab === "my-experience"}
              label="My Experience"
              onClick={() => setScreen({ name: "tabs", tab: "my-experience" })}
              icon="▣"
            />
            <div className="side-spacer" />
            <NavButton
              active={tab === "profile"}
              label="Profile"
              onClick={() => setScreen({ name: "tabs", tab: "profile" })}
              icon="☺"
            />
          </nav>
        ) : null}
        <div className="content-column" id="main-content">
          {screen.name === "tabs" && tab === "home" ? (
            <Home
              name={displayName}
              loading={loading}
              error={error}
              continueItems={continueItems}
              recentItems={recentItems}
              discoverItems={discoverItems}
              categories={presentCategories}
              onRetry={refresh}
              onSearch={() => setScreen({ name: "search" })}
              onOpen={(id) => void openApp(id)}
              onDetail={(id) => setScreen({ name: "detail", appId: id })}
              onExplore={() => setScreen({ name: "tabs", tab: "directory" })}
              onCategory={(value) => {
                setCategory(value);
                setScreen({ name: "tabs", tab: "directory" });
              }}
            />
          ) : null}

          {screen.name === "tabs" && tab === "directory" ? (
            <Directory
              loading={loading}
              error={error}
              apps={directory}
              featured={discoverItems}
              category={category}
              busy={busy}
              onCategory={setCategory}
              onRetry={refresh}
              onSearch={() => setScreen({ name: "search" })}
              onDetail={(id) => setScreen({ name: "detail", appId: id })}
              onExperience={(id) => void run(() => api.startExperience(id))}
              onOpen={(id) => void openApp(id)}
            />
          ) : null}

          {screen.name === "tabs" && tab === "my-experience" ? (
            <MyExperience
              loading={loading}
              error={error}
              items={mine}
              filter={mineFilter}
              onFilter={setMineFilter}
              onRetry={refresh}
              onOpen={(id) => void openApp(id)}
              onResume={(id) => void run(() => api.resumeExperience(id))}
              onMenu={setMenuFor}
              onExplore={() => setScreen({ name: "tabs", tab: "directory" })}
            />
          ) : null}

          {screen.name === "tabs" && tab === "profile" ? (
            <Profile name={displayName} userId={USER_ID} onHome={() => setScreen({ name: "tabs", tab: "home" })} />
          ) : null}

          {screen.name === "search" ? (
            <SearchScreen
              api={api}
              seed={screen.seed}
              categories={presentCategories}
              onBack={() => setScreen({ name: "tabs", tab: "home" })}
              onDetail={(id) => setScreen({ name: "detail", appId: id })}
              onExperience={(id) => void run(() => api.startExperience(id))}
              onOpen={(id) => void openApp(id)}
              onCategory={(value) => {
                setCategory(value);
                setScreen({ name: "tabs", tab: "directory" });
              }}
            />
          ) : null}

          {screen.name === "detail" ? (
            <AppDetail
              api={api}
              appId={screen.appId}
              busy={busy}
              onBack={() => setScreen({ name: "tabs", tab: "directory" })}
              onExperience={(id) => void run(() => api.startExperience(id))}
              onOpen={(id) => void openApp(id)}
            />
          ) : null}

          {screen.name === "experience" ? (
            <InAppExperience
              payload={screen.payload}
              onBack={() => setScreen({ name: "tabs", tab: "my-experience" })}
              onMenu={() => {
                const item = mine.find((row) => row.applicationId === screen.appId);
                if (item) setMenuFor(item);
              }}
            />
          ) : null}

          {screen.name !== "experience" && screen.name !== "detail" ? (
            <nav className="bottom-nav" data-testid="bottom-nav">
              <NavButton active={tab === "home"} label="Home" onClick={() => setScreen({ name: "tabs", tab: "home" })} icon="⌂" />
              <NavButton
                active={tab === "directory"}
                label="Directory"
                onClick={() => setScreen({ name: "tabs", tab: "directory" })}
                icon="▦"
              />
              <button
                className="nav-plus"
                aria-label="Add experience"
                data-testid="nav-plus"
                type="button"
                onClick={() => setScreen({ name: "tabs", tab: "directory" })}
              >
                +
              </button>
              <NavButton
                active={tab === "my-experience"}
                label="My Experience"
                onClick={() => setScreen({ name: "tabs", tab: "my-experience" })}
                icon="▣"
              />
              <NavButton
                active={tab === "profile"}
                label="Profile"
                onClick={() => setScreen({ name: "tabs", tab: "profile" })}
                icon="☺"
              />
            </nav>
          ) : null}

          {menuFor ? (
            <ActionSheet
              item={menuFor}
              onClose={() => setMenuFor(null)}
              onOpen={() => {
                setMenuFor(null);
                void openApp(menuFor.applicationId);
              }}
              onPause={() => {
                setMenuFor(null);
                void run(() => api.pauseExperience(menuFor.applicationId));
              }}
              onResume={() => {
                setMenuFor(null);
                void run(() => api.resumeExperience(menuFor.applicationId));
              }}
              onStop={() => {
                setStopFor(menuFor);
                setMenuFor(null);
              }}
              onDetails={() => {
                setMenuFor(null);
                setScreen({ name: "detail", appId: menuFor.applicationId });
              }}
            />
          ) : null}

          {stopFor ? (
            <StopModal
              name={stopFor.application.name}
              busy={busy}
              onCancel={() => setStopFor(null)}
              onConfirm={() =>
                void run(async () => {
                  await api.stopExperience(stopFor.applicationId);
                  setStopFor(null);
                })
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : ""}
      onClick={onClick}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      type="button"
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}

function Home(props: {
  name: string;
  loading: boolean;
  error: string | null;
  continueItems: ExperienceMembershipView[];
  recentItems: ExperienceMembershipView[];
  discoverItems: DirectoryApplicationView[];
  categories: string[];
  onRetry: () => void;
  onSearch: () => void;
  onOpen: (id: string) => void;
  onDetail: (id: string) => void;
  onExplore: () => void;
  onCategory: (value: string) => void;
}) {
  const hasExperience = props.continueItems.length > 0 || props.recentItems.length > 0;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          OS Experience
        </div>
        <div className="actions-inline">
          <button className="icon-btn" aria-label="Search" type="button" onClick={props.onSearch}>
            ⌕
          </button>
          <div className="avatar" aria-hidden>
            {initials(props.name)}
          </div>
        </div>
      </header>
      <section className="page surface-enter" data-testid="home">
        <div className="greeting">
          <p className="eyebrow">Your applications live here</p>
          <h1>{greeting(props.name)}</h1>
          <p className="tagline">Your Digital Life. Your Applications. One Experience.</p>
        </div>
        <button className="search-box hero-search" onClick={props.onSearch} data-testid="home-search" type="button">
          <span aria-hidden>⌕</span>
          <span className="search-placeholder">Search applications, creators, services…</span>
        </button>

        {props.error ? (
          <StatePanel error={props.error} onRetry={props.onRetry} />
        ) : props.loading ? (
          <Skeleton rows={4} testId="home-skeleton" />
        ) : (
          <>
            {!hasExperience ? (
              <StatePanel
                empty
                emptyTitle="Your Experience is waiting for you."
                onExplore={props.onExplore}
              />
            ) : null}

            {props.continueItems.length > 0 ? (
              <section className="section">
                <div className="section-head">
                  <h2>Continue Your Experience</h2>
                </div>
                <div className="rail" data-testid="continue-rail">
                  {props.continueItems.map((item) => (
                    <article className="exp-card rich" key={item.applicationId}>
                      <AppIcon name={item.application.name} />
                      <b>{item.application.name}</b>
                      <div className="meta">
                        {item.application.category}
                        {item.application.developerName ? ` · ${item.application.developerName}` : ""}
                      </div>
                      <button
                        className="primary"
                        onClick={() => props.onOpen(item.applicationId)}
                        data-testid={`open-${item.applicationId}`}
                        type="button"
                      >
                        Open
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {props.recentItems.length > 0 ? (
              <section className="section">
                <div className="section-head">
                  <h2>Recently Experienced</h2>
                </div>
                <div className="rail" data-testid="recent-rail">
                  {props.recentItems.map((item) => (
                    <button
                      className="mini-app"
                      key={`recent-${item.applicationId}`}
                      type="button"
                      onClick={() => props.onOpen(item.applicationId)}
                    >
                      <AppIcon name={item.application.name} size="sm" />
                      <span>{item.application.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {props.categories.length > 0 ? (
              <section className="section">
                <div className="section-head">
                  <h2>Explore the Digiconomy</h2>
                </div>
                <div className="chips" data-testid="home-categories">
                  {props.categories.map((item) => (
                    <button key={item} className="chip" type="button" onClick={() => props.onCategory(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {props.discoverItems.length > 0 ? (
              <section className="section">
                <div className="section-head">
                  <h2>Featured Applications</h2>
                  <span>Published</span>
                </div>
                <div className="featured-grid" data-testid="featured-rail">
                  {props.discoverItems.map((app) => (
                    <article className="dir-card featured" key={app.id}>
                      <div className="card-top">
                        <AppIcon name={app.name} />
                        <div>
                          <b>{app.name}</b>
                          <div className="meta">
                            {app.category}
                            {app.ecosystemSource === "LIFEOS" ? " · LifeOS" : ""}
                          </div>
                        </div>
                      </div>
                      {app.description ? <p className="card-desc">{app.description}</p> : null}
                      <div className="card-actions">
                        <button className="ghost" type="button" onClick={() => props.onDetail(app.id)}>
                          Details
                        </button>
                        <button className="primary" type="button" onClick={() => props.onDetail(app.id)}>
                          View
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <button className="primary block discover-cta" onClick={props.onExplore} data-testid="explore-directory" type="button">
              Explore Directory
            </button>
          </>
        )}
      </section>
    </>
  );
}

function Directory(props: {
  loading: boolean;
  error: string | null;
  apps: DirectoryApplicationView[];
  featured: DirectoryApplicationView[];
  category: string;
  busy: boolean;
  onCategory: (value: string) => void;
  onRetry: () => void;
  onSearch: () => void;
  onDetail: (id: string) => void;
  onExperience: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="brand">App Directory</div>
          <p className="lede">Explore the Digiconomy — every eligible application available to experience.</p>
        </div>
        <button className="icon-btn" onClick={props.onSearch} aria-label="Search" type="button">
          ⌕
        </button>
      </header>
      <section className="page surface-enter" data-testid="directory">
        <div className="chips sticky-chips">
          {DIRECTORY_CATEGORIES.map((item) => (
            <button
              key={item}
              className={`chip ${props.category === item ? "active" : ""}`}
              onClick={() => props.onCategory(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>

        {props.error ? <StatePanel error={props.error} onRetry={props.onRetry} /> : null}
        {props.loading ? <Skeleton rows={6} testId="directory-skeleton" /> : null}

        {!props.loading && !props.error && props.featured.length > 0 && props.category === "All" ? (
          <section className="section">
            <div className="section-head">
              <h2>Featured</h2>
            </div>
            <div className="featured-grid">
              {props.featured.slice(0, 4).map((app) => (
                <DirectoryCard
                  key={`feat-${app.id}`}
                  app={app}
                  busy={props.busy}
                  featured
                  onDetail={props.onDetail}
                  onExperience={props.onExperience}
                  onOpen={props.onOpen}
                />
              ))}
            </div>
          </section>
        ) : null}

        {!props.loading && !props.error ? (
          <section className="section">
            <div className="section-head">
              <h2>All Applications</h2>
              <span>{props.apps.length}</span>
            </div>
            {props.apps.length === 0 ? (
              <StatePanel empty emptyTitle="Directory is empty." onExplore={undefined} />
            ) : (
              <div className="grid">
                {props.apps.map((app) => (
                  <DirectoryCard
                    key={app.id}
                    app={app}
                    busy={props.busy}
                    onDetail={props.onDetail}
                    onExperience={props.onExperience}
                    onOpen={props.onOpen}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </section>
    </>
  );
}

function DirectoryCard(props: {
  app: DirectoryApplicationView;
  busy: boolean;
  featured?: boolean;
  onDetail: (id: string) => void;
  onExperience: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { app } = props;
  return (
    <article className={`dir-card ${props.featured ? "featured" : ""}`} data-testid={`dir-${app.id}`}>
      <div className="card-top">
        <AppIcon name={app.name} />
        <div className="card-copy">
          <b>{app.name}</b>
          <div className="meta">
            {app.developerName ?? (app.ecosystemSource === "LIFEOS" ? "LifeOS" : "Publisher")}
          </div>
          <div className="meta">{app.category}</div>
        </div>
      </div>
      {app.description ? <p className="card-desc">{app.description}</p> : null}
      <div className="card-actions">
        <button className="ghost" type="button" onClick={() => props.onDetail(app.id)}>
          Details
        </button>
        {app.experienced ? (
          <button className="primary" disabled={props.busy} type="button" onClick={() => props.onOpen(app.id)}>
            Open
          </button>
        ) : (
          <button
            className="primary"
            disabled={props.busy}
            type="button"
            onClick={() => props.onExperience(app.id)}
            data-testid={`experience-${app.id}`}
          >
            Experience
          </button>
        )}
      </div>
    </article>
  );
}

function MyExperience(props: {
  loading: boolean;
  error: string | null;
  items: ExperienceMembershipView[];
  filter: string;
  onFilter: (value: string) => void;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  onMenu: (item: ExperienceMembershipView) => void;
  onExplore: () => void;
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="brand">My Experience</div>
          <p className="lede">Your applications. Your way.</p>
        </div>
      </header>
      <section className="page surface-enter" data-testid="my-experience">
        <div className="chips">
          {["All", "Active", "Paused", "Recently Used"].map((item) => (
            <button
              key={item}
              className={`chip ${props.filter === item ? "active" : ""}`}
              onClick={() => props.onFilter(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        {props.error ? <StatePanel error={props.error} onRetry={props.onRetry} /> : null}
        {props.loading ? <Skeleton rows={4} testId="mine-skeleton" /> : null}
        {!props.loading && !props.error && props.items.length === 0 ? (
          <div className="state-panel empty" data-testid="empty-experience">
            <h3>Your Experience is empty.</h3>
            <p>Discover an application from the Directory and make it part of your Experience.</p>
            <button className="primary" onClick={props.onExplore} type="button">
              Explore Directory
            </button>
          </div>
        ) : null}
        {!props.loading && !props.error && props.items.length > 0 ? (
          <div className="mine-grid">
            {props.items.map((item) => (
              <article className="mine-card" key={item.applicationId} data-testid={`mine-${item.applicationId}`}>
                <AppIcon name={item.application.name} size="sm" />
                <div>
                  <b>{item.application.name}</b>
                  <div className="meta">{item.application.category}</div>
                  <div className={`status ${item.status.toLowerCase()}`}>{item.status}</div>
                </div>
                <div className="actions-inline">
                  {item.status === "PAUSED" ? (
                    <button className="primary" type="button" onClick={() => props.onResume(item.applicationId)}>
                      Resume
                    </button>
                  ) : item.status === "ACTIVE" ? (
                    <button className="primary" type="button" onClick={() => props.onOpen(item.applicationId)}>
                      Open
                    </button>
                  ) : null}
                  <button
                    className="icon-btn"
                    aria-label="Actions"
                    type="button"
                    onClick={() => props.onMenu(item)}
                    data-testid={`menu-${item.applicationId}`}
                  >
                    ⋯
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function Profile({ name, userId, onHome }: { name: string; userId: string; onHome: () => void }) {
  return (
    <section className="page surface-enter" data-testid="profile">
      <div className="topbar" style={{ paddingLeft: 0 }}>
        <div className="brand">Profile</div>
      </div>
      <div className="detail-card profile-card">
        <div className="avatar xl" aria-hidden>
          {initials(name)}
        </div>
        <b className="profile-name">{name}</b>
        <div className="meta">Participant {userId}</div>
        <p className="lede">
          Identity is asserted by Trust ID in production. This is your OS Experience participant profile — not the
          Xperience developer console.
        </p>
        <button className="primary block" onClick={onHome} type="button">
          Back to Home
        </button>
      </div>
    </section>
  );
}

function SearchScreen(props: {
  api: XperienceApiClient;
  seed?: string;
  categories: string[];
  onBack: () => void;
  onDetail: (id: string) => void;
  onExperience: (id: string) => void;
  onOpen: (id: string) => void;
  onCategory: (value: string) => void;
}) {
  const [q, setQ] = useState(props.seed ?? "");
  const [focused, setFocused] = useState(true);
  const [filter, setFilter] = useState("All");
  const [results, setResults] = useState<DirectoryApplicationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState(readRecentSearches);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await props.api.listDirectory({ q: q.trim() || undefined });
          if (!cancelled) setResults(data.applications);
          if (!cancelled && q.trim().length >= 2) {
            pushRecentSearch(q.trim());
            setRecent(readRecentSearches());
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Search failed.");
            setResults([]);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, props.api]);

  const filtered = filter === "Apps" || filter === "All" ? results : [];

  return (
    <section className={`page search-screen ${focused ? "expanded" : ""}`} data-testid="search">
      <header className="topbar" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <button className="icon-btn" onClick={props.onBack} aria-label="Back" type="button">
          ←
        </button>
        <div className="brand">Search</div>
        <span />
      </header>
      <div className="search-box live">
        <span aria-hidden>⌕</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search applications, creators, services…"
          data-testid="search-input"
          aria-label="Search applications"
        />
      </div>
      <div className="chips">
        {["All", "Apps", "Creators", "Services"].map((item) => (
          <button
            key={item}
            className={`chip ${filter === item ? "active" : ""}`}
            onClick={() => setFilter(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>

      {!q.trim() && recent.length > 0 ? (
        <div className="section">
          <div className="section-head">
            <h2>Recent searches</h2>
          </div>
          <div className="chips">
            {recent.map((term) => (
              <button key={term} className="chip" type="button" onClick={() => setQ(term)}>
                {term}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!q.trim() && props.categories.length > 0 ? (
        <div className="section">
          <div className="section-head">
            <h2>Suggested categories</h2>
          </div>
          <div className="chips">
            {props.categories.map((item) => (
              <button key={item} className="chip" type="button" onClick={() => props.onCategory(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filter !== "All" && filter !== "Apps" ? (
        <StatePanel empty emptyTitle={`${filter} search is not available yet.`} />
      ) : (
        <>
          {loading ? <Skeleton rows={3} testId="search-skeleton" /> : null}
          {error ? <StatePanel error={error} /> : null}
          {!loading && !error && filtered.length === 0 && q.trim() ? (
            <StatePanel empty emptyTitle="No applications found." />
          ) : null}
          <div className="list">
            {filtered.map((app) => (
              <article className="result-row" key={app.id} data-testid={`search-${app.id}`}>
                <AppIcon name={app.name} size="sm" />
                <div>
                  <b>{app.name}</b>
                  <div className="meta">
                    {app.developerName ?? (app.ecosystemSource === "LIFEOS" ? "LifeOS" : "Publisher")}
                    {" · "}
                    {app.category}
                  </div>
                </div>
                {app.experienced ? (
                  <button className="primary" type="button" onClick={() => props.onOpen(app.id)}>
                    Open
                  </button>
                ) : (
                  <button className="ghost" type="button" onClick={() => props.onExperience(app.id)}>
                    Experience
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function AppDetail(props: {
  api: XperienceApiClient;
  appId: string;
  busy: boolean;
  onBack: () => void;
  onExperience: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [app, setApp] = useState<DirectoryApplicationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        setApp(await props.api.getDirectoryApplication(props.appId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load application.");
        setApp(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [props.api, props.appId]);

  return (
    <div data-testid="app-detail" className="surface-enter">
      <div className="detail-hero" style={app ? { background: tone(app.name) } : undefined}>
        <button className="icon-btn back" onClick={props.onBack} aria-label="Back" type="button">
          ←
        </button>
        <AppIcon name={app?.name ?? "?"} size="lg" />
      </div>
      <section className="page">
        {loading ? <Skeleton rows={2} /> : null}
        {error ? <StatePanel error={error} /> : null}
        {app ? (
          <article className="detail-card profile-card">
            <b className="detail-title">{app.name}</b>
            <div className="meta">
              {app.developerName ?? (app.ecosystemSource === "LIFEOS" ? "LifeOS" : "Publisher")}
              {" · "}
              {app.category}
            </div>
            <div className="pill-row">
              <span className="pill">{app.publicationState}</span>
              {app.ecosystemSource ? <span className="pill soft">{app.ecosystemSource}</span> : null}
            </div>
            {app.description ? (
              <div className="detail-block">
                <h3>About</h3>
                <p>{app.description}</p>
              </div>
            ) : null}
            <div className="detail-block">
              <h3>Capabilities</h3>
              <p>{app.capabilities.join(", ") || "None declared"}</p>
            </div>
            <div className="detail-block">
              <h3>Website</h3>
              <p className="mono">{app.productionUrl}</p>
            </div>
            <div className="detail-block">
              <h3>Developer</h3>
              <p>{app.developerName ?? "Not provided"}</p>
            </div>
            {app.experienced ? (
              <button className="primary block" disabled={props.busy} type="button" onClick={() => props.onOpen(app.id)}>
                Open Experience
              </button>
            ) : (
              <button
                className="primary block"
                disabled={props.busy}
                type="button"
                onClick={() => props.onExperience(app.id)}
                data-testid="detail-experience"
              >
                Experience
              </button>
            )}
          </article>
        ) : null}
      </section>
    </div>
  );
}

function InAppExperience(props: {
  payload: OpenExperiencePayload;
  onBack: () => void;
  onMenu: () => void;
}) {
  const [blocked, setBlocked] = useState(false);
  return (
    <div className="experience-frame" data-testid="in-app-experience">
      <header>
        <button className="icon-btn" onClick={props.onBack} aria-label="Back" type="button">
          ←
        </button>
        <div className="frame-title">
          <b>{props.payload.name}</b>
          <div className="status">● {props.payload.status}</div>
        </div>
        <button className="icon-btn" onClick={props.onMenu} aria-label="Actions" type="button">
          ⋯
        </button>
      </header>
      {blocked ? (
        <div className="frame-fallback">
          <p>The application origin refused embedding. Your Experience session is still active.</p>
          <p className="meta">{props.payload.embedUrl}</p>
          <a className="primary" href={props.payload.embedUrl} target="_blank" rel="noreferrer noopener">
            Open in new tab
          </a>
        </div>
      ) : (
        <iframe
          title={props.payload.name}
          src={props.payload.embedUrl}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          onError={() => setBlocked(true)}
        />
      )}
    </div>
  );
}

function ActionSheet(props: {
  item: ExperienceMembershipView;
  onClose: () => void;
  onOpen: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDetails: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={props.onClose} data-testid="action-sheet">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mine-card sheet-head">
          <AppIcon name={props.item.application.name} size="sm" />
          <div>
            <b>{props.item.application.name}</b>
            <div className={`status ${props.item.status.toLowerCase()}`}>{props.item.status}</div>
          </div>
          <button className="icon-btn" onClick={props.onClose} type="button" aria-label="Close">
            ✕
          </button>
        </div>
        {props.item.status === "ACTIVE" ? (
          <button className="row" onClick={props.onOpen} type="button">
            Open
          </button>
        ) : null}
        {props.item.status === "ACTIVE" ? (
          <button className="row" onClick={props.onPause} type="button">
            Pause Experience
          </button>
        ) : null}
        {props.item.status === "PAUSED" ? (
          <button className="row" onClick={props.onResume} type="button">
            Resume Experience
          </button>
        ) : null}
        <button className="row" onClick={props.onDetails} type="button">
          View Details
        </button>
        <button className="row danger-text" onClick={props.onStop} data-testid="stop-experience" type="button">
          Remove from Experience
        </button>
      </div>
    </div>
  );
}

function StopModal(props: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" data-testid="stop-modal">
      <div className="modal">
        <div className="app-icon md stop-icon" aria-hidden>
          −
        </div>
        <b className="detail-title">Stop Experiencing?</b>
        <p className="lede">
          You&apos;ll no longer experience {props.name} in your Experience. The application stays in the Directory —
          you can Experience it again anytime.
        </p>
        <button className="danger block" disabled={props.busy} onClick={props.onConfirm} data-testid="confirm-stop" type="button">
          Stop Experiencing
        </button>
        <button className="ghost block" style={{ marginTop: 10 }} onClick={props.onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
