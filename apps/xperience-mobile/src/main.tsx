import { useEffect, useMemo, useState } from "react";
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

function StateBox({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: string | null;
  onRetry?: () => void;
}) {
  if (loading) return <div className="state-box loading" data-testid="loading">Loading…</div>;
  if (error) {
    return (
      <div className="state-box error" data-testid="error">
        <p>{error}</p>
        {onRetry ? (
          <button className="primary" onClick={onRetry} data-testid="retry">
            Try Again
          </button>
        ) : null}
      </div>
    );
  }
  if (empty) return <div className="state-box empty" data-testid="empty">{empty}</div>;
  return null;
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
      setError(err instanceof XperienceApiError ? err.message : "We couldn't load your Experience.");
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
  const discoverItems = featured.filter((app) => !app.experienced);

  return (
    <div className={`app-shell ${screen.name === "experience" ? "immersive" : ""}`} data-testid="xperience-mobile">
      {screen.name === "tabs" && tab === "home" ? (
        <Home
          name={displayName}
          loading={loading}
          error={error}
          continueItems={continueItems}
          discoverItems={discoverItems}
          onRetry={refresh}
          onSearch={() => setScreen({ name: "search" })}
          onOpen={(id) => void openApp(id)}
          onDetail={(id) => setScreen({ name: "detail", appId: id })}
          onExplore={() => setScreen({ name: "tabs", tab: "directory" })}
        />
      ) : null}

      {screen.name === "tabs" && tab === "directory" ? (
        <Directory
          loading={loading}
          error={error}
          apps={directory}
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
          onBack={() => setScreen({ name: "tabs", tab: "home" })}
          onDetail={(id) => setScreen({ name: "detail", appId: id })}
          onExperience={(id) => void run(() => api.startExperience(id))}
          onOpen={(id) => void openApp(id)}
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
          <button className="nav-plus" aria-label="Add experience" data-testid="nav-plus" onClick={() => setScreen({ name: "tabs", tab: "directory" })}>
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
    <button className={active ? "active" : ""} onClick={onClick} data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}>
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
  discoverItems: DirectoryApplicationView[];
  onRetry: () => void;
  onSearch: () => void;
  onOpen: (id: string) => void;
  onDetail: (id: string) => void;
  onExplore: () => void;
}) {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          OS Xperience
        </div>
        <div className="actions-inline">
          <button className="icon-btn" aria-label="Notifications">
            🔔
          </button>
          <div className="avatar">{initials(props.name)}</div>
        </div>
      </header>
      <section className="page" data-testid="home">
        <div className="greeting">
          <h1>{greeting(props.name)}</h1>
          <p>Your Digital Life. Your Applications. One Experience.</p>
        </div>
        <button className="search-box" onClick={props.onSearch} data-testid="home-search">
          <span>⌕</span>
          <input readOnly placeholder="Search apps, creators, services, or anything..." />
        </button>
        <StateBox loading={props.loading} error={props.error} onRetry={props.onRetry} />
        <div className="section-head">
          <h2>Continue Your Experience</h2>
        </div>
        {!props.loading && !props.error && props.continueItems.length === 0 ? (
          <StateBox empty="Nothing to continue yet. Experience an application from the Directory." />
        ) : (
          <div className="rail" data-testid="continue-rail">
            {props.continueItems.map((item) => (
              <article className="exp-card" key={item.applicationId}>
                <div className="app-icon">{item.application.name.slice(0, 1)}</div>
                <b>{item.application.name}</b>
                <div className="meta">{item.application.category}</div>
                <div className="actions-inline" style={{ marginTop: 12 }}>
                  <button className="primary" onClick={() => props.onOpen(item.applicationId)} data-testid={`open-${item.applicationId}`}>
                    Open
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="section-head">
          <h2>Featured in Directory</h2>
          <span>Not personalized</span>
        </div>
        {!props.loading && !props.error && props.discoverItems.length === 0 ? (
          <StateBox empty="No featured published applications yet." />
        ) : (
          <div className="rail" data-testid="featured-rail">
            {props.discoverItems.map((app) => (
              <article className="exp-card" key={app.id}>
                <div className="app-icon">{app.name.slice(0, 1)}</div>
                <b>{app.name}</b>
                <div className="meta">{app.category}</div>
                <div className="actions-inline" style={{ marginTop: 12 }}>
                  <button className="ghost" onClick={() => props.onDetail(app.id)}>
                    Details
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <button className="primary block" style={{ marginTop: 20 }} onClick={props.onExplore} data-testid="explore-directory">
          Explore Directory
        </button>
      </section>
    </>
  );
}

function Directory(props: {
  loading: boolean;
  error: string | null;
  apps: DirectoryApplicationView[];
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
          <p className="lede">Everything available to experience.</p>
        </div>
        <button className="icon-btn" onClick={props.onSearch} aria-label="Search">
          ⌕
        </button>
      </header>
      <section className="page" data-testid="directory">
        <div className="chips">
          {DIRECTORY_CATEGORIES.map((item) => (
            <button
              key={item}
              className={`chip ${props.category === item ? "active" : ""}`}
              onClick={() => props.onCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <StateBox
          loading={props.loading}
          error={props.error}
          empty={!props.loading && !props.error && props.apps.length === 0 ? "Directory is empty. Published applications will appear here." : null}
          onRetry={props.onRetry}
        />
        <div className="grid">
          {props.apps.map((app) => (
            <article className="dir-card" key={app.id} data-testid={`dir-${app.id}`}>
              <div className="app-icon">{app.name.slice(0, 1)}</div>
              <b>{app.name}</b>
              <div className="meta">{app.category}</div>
              <button className="ghost" style={{ marginTop: 8 }} onClick={() => props.onDetail(app.id)}>
                Details
              </button>
              {app.experienced ? (
                <button className="primary" disabled={props.busy} onClick={() => props.onOpen(app.id)}>
                  Open
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={props.busy}
                  onClick={() => props.onExperience(app.id)}
                  data-testid={`experience-${app.id}`}
                >
                  Experience
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
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
          <p className="lede">Applications you have chosen to experience.</p>
        </div>
      </header>
      <section className="page" data-testid="my-experience">
        <div className="chips">
          {["All", "Active", "Paused", "Recently Used"].map((item) => (
            <button key={item} className={`chip ${props.filter === item ? "active" : ""}`} onClick={() => props.onFilter(item)}>
              {item}
            </button>
          ))}
        </div>
        <StateBox loading={props.loading} error={props.error} onRetry={props.onRetry} />
        {!props.loading && !props.error && props.items.length === 0 ? (
          <div className="state-box empty" data-testid="empty-experience">
            <p>Your Experience is empty.</p>
            <p>Discover applications in the Directory and choose what you want to experience.</p>
            <button className="primary" onClick={props.onExplore}>
              Explore Directory
            </button>
          </div>
        ) : (
          <div className="list">
            {props.items.map((item) => (
              <article className="mine-card" key={item.applicationId} data-testid={`mine-${item.applicationId}`}>
                <div className="app-icon sm">{item.application.name.slice(0, 1)}</div>
                <div>
                  <b>{item.application.name}</b>
                  <div className="meta">{item.application.category}</div>
                  <div className={`status ${item.status.toLowerCase()}`}>{item.status}</div>
                </div>
                <div className="actions-inline">
                  {item.status === "PAUSED" ? (
                    <button className="primary" onClick={() => props.onResume(item.applicationId)}>
                      Resume
                    </button>
                  ) : item.status === "ACTIVE" ? (
                    <button className="primary" onClick={() => props.onOpen(item.applicationId)}>
                      Open
                    </button>
                  ) : null}
                  <button className="icon-btn" aria-label="Actions" onClick={() => props.onMenu(item)} data-testid={`menu-${item.applicationId}`}>
                    ⋯
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Profile({ name, userId, onHome }: { name: string; userId: string; onHome: () => void }) {
  return (
    <section className="page" data-testid="profile">
      <div className="topbar" style={{ paddingLeft: 0 }}>
        <div className="brand">Profile</div>
      </div>
      <div className="detail-card">
        <div className="avatar" style={{ width: 64, height: 64, fontSize: 20 }}>
          {initials(name)}
        </div>
        <b style={{ marginTop: 12 }}>{name}</b>
        <div className="meta">Participant {userId}</div>
        <p className="lede">Identity is asserted by Trust ID in production. This surface shows your Experience participant profile only.</p>
        <button className="primary block" onClick={onHome}>
          Back to Home
        </button>
      </div>
    </section>
  );
}

function SearchScreen(props: {
  api: XperienceApiClient;
  seed?: string;
  onBack: () => void;
  onDetail: (id: string) => void;
  onExperience: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState(props.seed ?? "");
  const [filter, setFilter] = useState("All");
  const [results, setResults] = useState<DirectoryApplicationView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await props.api.listDirectory({ q: q.trim() || undefined });
          if (!cancelled) setResults(data.applications);
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

  const filtered =
    filter === "Apps" || filter === "All"
      ? results
      : [];

  return (
    <section className="page" data-testid="search">
      <header className="topbar" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <button className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <div className="brand">Search</div>
        <span />
      </header>
      <div className="search-box">
        <span>⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search apps, creators, services, or anything..."
          data-testid="search-input"
          autoFocus
        />
      </div>
      <div className="chips">
        {["All", "Apps", "Creators", "Services"].map((item) => (
          <button key={item} className={`chip ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>
            {item}
          </button>
        ))}
      </div>
      <StateBox loading={loading} error={error} empty={!loading && !error && filtered.length === 0 ? "No applications found." : null} />
      {filter !== "All" && filter !== "Apps" ? (
        <StateBox empty={`${filter} search is not available in the current discovery architecture.`} />
      ) : (
        <div className="list">
          {filtered.map((app) => (
            <article className="result-row" key={app.id} data-testid={`search-${app.id}`}>
              <div className="app-icon sm">{app.name.slice(0, 1)}</div>
              <div>
                <b>{app.name}</b>
                <div className="meta">
                  {app.category} · {app.capabilities.slice(0, 2).join(" · ")}
                </div>
              </div>
              {app.experienced ? (
                <button className="primary" onClick={() => props.onOpen(app.id)}>
                  Open
                </button>
              ) : (
                <button className="ghost" onClick={() => props.onExperience(app.id)}>
                  Experience
                </button>
              )}
            </article>
          ))}
        </div>
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
    <div data-testid="app-detail">
      <div className="detail-hero">
        <button className="icon-btn back" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <div className="app-icon" style={{ width: 72, height: 72, fontSize: 28 }}>
          {app?.name.slice(0, 1) ?? "?"}
        </div>
      </div>
      <section className="page">
        <StateBox loading={loading} error={error} />
        {app ? (
          <article className="detail-card">
            <b style={{ fontSize: 22 }}>{app.name}</b>
            <div className="meta">
              {app.category} · {app.publicationState}
            </div>
            <p className="lede">Capabilities: {app.capabilities.join(", ")}</p>
            <p className="lede">Origin: {app.origin}</p>
            <p className="lede">Website: {app.productionUrl}</p>
            {app.experienced ? (
              <button className="primary block" disabled={props.busy} onClick={() => props.onOpen(app.id)}>
                Open Experience
              </button>
            ) : (
              <button
                className="primary block"
                disabled={props.busy}
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
        <button className="icon-btn" onClick={props.onBack} aria-label="Back">
          ←
        </button>
        <div style={{ flex: 1 }}>
          <b>{props.payload.name}</b>
          <div className="status">● {props.payload.status}</div>
        </div>
        <button className="icon-btn" onClick={props.onMenu} aria-label="Actions">
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
        <div className="mine-card" style={{ border: 0, background: "transparent", padding: 0 }}>
          <div className="app-icon sm">{props.item.application.name.slice(0, 1)}</div>
          <div>
            <b>{props.item.application.name}</b>
            <div className={`status ${props.item.status.toLowerCase()}`}>{props.item.status}</div>
          </div>
          <button className="icon-btn" onClick={props.onClose}>
            ✕
          </button>
        </div>
        {props.item.status === "ACTIVE" ? (
          <button className="row" onClick={props.onOpen}>
            Open
          </button>
        ) : null}
        {props.item.status === "ACTIVE" ? (
          <button className="row" onClick={props.onPause}>
            Pause Experience
          </button>
        ) : null}
        {props.item.status === "PAUSED" ? (
          <button className="row" onClick={props.onResume}>
            Resume Experience
          </button>
        ) : null}
        <button className="row danger-text" onClick={props.onStop} data-testid="stop-experience">
          Remove from Experience
        </button>
        <button className="row" onClick={props.onDetails}>
          View Details
        </button>
      </div>
    </div>
  );
}

function StopModal(props: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" data-testid="stop-modal">
      <div className="modal">
        <div className="app-icon" style={{ margin: "0 auto 12px", background: "linear-gradient(145deg,#ff6b7a,#c62839)" }}>
          −
        </div>
        <b style={{ fontSize: 20 }}>Stop Experiencing?</b>
        <p className="lede">
          You&apos;ll no longer experience {props.name} in your Experience. You can always add it back from the Directory.
        </p>
        <button className="danger block" disabled={props.busy} onClick={props.onConfirm} data-testid="confirm-stop">
          Stop Experiencing
        </button>
        <button className="ghost block" style={{ marginTop: 10 }} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
