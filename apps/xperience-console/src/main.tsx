import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  CAPABILITIES,
  EVIDENCE_TYPES,
  type ApplicationManifestClaim,
  type ApplicationView,
  type AuditEventView,
  type Capability,
  type EvidenceType,
} from "@digiconomy/xperience-contract";
import { createXperienceApiClient, XperienceApiError, type XperienceApiClient } from "@digiconomy/xperience-sdk";
import "./styles.css";

type ConsoleMode = "developer" | "admin";
type DevView =
  | "dashboard"
  | "applications"
  | "register"
  | "detail"
  | "manifest"
  | "capabilities"
  | "verification"
  | "integration"
  | "testing"
  | "submit"
  | "review";
type AdminView =
  | "overview"
  | "queue"
  | "detail"
  | "evidence"
  | "capabilities"
  | "actions"
  | "releases"
  | "presentation"
  | "audit";

const API_BASE = import.meta.env.VITE_XPERIENCE_API_URL ?? "http://localhost:4100";

const emptyManifest = (): ApplicationManifestClaim => ({
  schemaVersion: "1",
  applicationId: "",
  name: "",
  version: "1.0.0",
  origin: "https://",
  productionUrl: "https://",
  xperienceUrl: "https://",
  capabilities: ["IDENTITY"],
});

function Badge({ children }: { children: string }) {
  return <span className={`badge ${children.toLowerCase().replaceAll("_", "-")}`}>{children.replaceAll("_", " ")}</span>;
}

function StatusBanner({ error, loading, empty }: { error?: string | null; loading?: boolean; empty?: string | null }) {
  if (loading) return <p className="state loading" data-testid="loading">Loading server state…</p>;
  if (error) return <p className="state error" data-testid="error">{error}</p>;
  if (empty) return <p className="state empty" data-testid="empty">{empty}</p>;
  return null;
}

function useApi(mode: ConsoleMode): XperienceApiClient {
  return useMemo(
    () =>
      createXperienceApiClient({
        baseUrl: API_BASE,
        actor: mode === "admin" ? "ADMIN:admin-1" : "DEVELOPER:dev-1",
        email: mode === "admin" ? "admin@xperience.local" : "dev1@xperience.local",
      }),
    [mode],
  );
}

function App() {
  const [mode, setMode] = useState<ConsoleMode>("developer");
  const [devView, setDevView] = useState<DevView>("dashboard");
  const [adminView, setAdminView] = useState<AdminView>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [apps, setApps] = useState<ApplicationView[]>([]);
  const [queue, setQueue] = useState<ApplicationView[]>([]);
  const [selected, setSelected] = useState<ApplicationView | null>(null);
  const [audit, setAudit] = useState<AuditEventView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const api = useApi(mode);

  async function refresh(id = selectedId) {
    setLoading(true);
    setError(null);
    try {
      if (mode === "developer") {
        const listed = await api.listApplications();
        setApps(listed.applications);
        if (id) {
          const app = await api.getApplication(id);
          setSelected(app);
        } else {
          setSelected(null);
        }
      } else {
        const listed = await api.adminQueue();
        setQueue(listed.applications);
        const events = await api.adminAudit(id ?? undefined);
        setAudit(events.events);
        if (id) setSelected(await api.adminGet(id));
        else setSelected(null);
      }
    } catch (err) {
      setError(err instanceof XperienceApiError ? err.message : "API unavailable. Start the Xperience API.");
      setApps([]);
      setQueue([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(selectedId);
  }, [mode, selectedId, api]);

  function openApp(id: string, next: DevView | AdminView) {
    setSelectedId(id);
    if (mode === "developer") setDevView(next as DevView);
    else setAdminView(next as AdminView);
  }

  async function run(action: () => Promise<unknown>, okMessage?: string) {
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(okMessage ?? "Saved.");
      await refresh(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  const developerNav: { id: DevView; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "applications", label: "Applications" },
    { id: "register", label: "Register application" },
    { id: "detail", label: "Application details" },
    { id: "manifest", label: "Manifest" },
    { id: "capabilities", label: "Capabilities" },
    { id: "verification", label: "Verification" },
    { id: "integration", label: "Xperience integration" },
    { id: "testing", label: "Testing" },
    { id: "submit", label: "Submit" },
    { id: "review", label: "Review status" },
  ];

  const adminNav: { id: AdminView; label: string }[] = [
    { id: "overview", label: "Admin dashboard" },
    { id: "queue", label: "Review queue" },
    { id: "detail", label: "Application review" },
    { id: "evidence", label: "Verification evidence" },
    { id: "capabilities", label: "Capability review" },
    { id: "actions", label: "Review actions" },
    { id: "releases", label: "Experience releases" },
    { id: "presentation", label: "Presentation Control" },
    { id: "audit", label: "Audit history" },
  ];

  return (
    <main>
      <aside>
        <div className="brand">
          <i>✦</i> OS <b>Xperience</b>
          <small>Digiconomy</small>
        </div>
        <p className="scope">{mode === "admin" ? "ADMIN CONSOLE" : "DEVELOPER CONSOLE"}</p>
        {(mode === "admin" ? adminNav : developerNav).map((item) => (
          <button
            key={item.id}
            className={(mode === "admin" ? adminView : devView) === item.id ? "active" : ""}
            onClick={() => (mode === "admin" ? setAdminView(item.id as AdminView) : setDevView(item.id as DevView))}
            data-testid={`nav-${item.id}`}
          >
            {item.label}
          </button>
        ))}
        <div className="switch">
          <span>{mode === "admin" ? "Administrator" : "Developer"}</span>
          <button
            onClick={() => {
              setMode(mode === "admin" ? "developer" : "admin");
              setSelectedId(null);
              setMessage(null);
            }}
            data-testid="switch-console"
          >
            Switch console
          </button>
        </div>
      </aside>
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">{mode === "admin" ? "Review operations" : "Participation workspace"}</p>
            <h1>{mode === "admin" ? "Review applications with confidence." : "Bring your application into Xperience."}</h1>
            <p className="lede">
              {mode === "admin"
                ? "Evidence, capability claims, and every decision in one accountable review trail."
                : "Your application stays yours. Xperience verifies participation—not ownership or runtime access."}
            </p>
          </div>
          <button
            className="primary"
            data-testid="header-cta"
            onClick={() => (mode === "admin" ? setAdminView("queue") : setDevView("register"))}
          >
            {mode === "admin" ? "Open review queue" : "Register application"}
          </button>
        </header>
        <StatusBanner loading={loading} error={error} />
        {message ? <p className="state ok" data-testid="message">{message}</p> : null}
        {mode === "developer" ? (
          <DeveloperPanels
            view={devView}
            apps={apps}
            selected={selected}
            loading={loading}
            onOpen={(id) => openApp(id, "detail")}
            onRegister={(manifest) =>
              run(async () => {
                const app = await api.registerApplication(manifest);
                setSelectedId(app.id);
                setDevView("detail");
              }, "Application registered.")
            }
            onSaveManifest={(manifest) =>
              selected && run(() => api.updateManifest(selected.id, manifest), "Manifest revised.")
            }
            onEvidence={(type, locator) =>
              selected && run(() => api.addEvidence(selected.id, type, locator), "Evidence claimed.")
            }
            onSubmit={() => selected && run(() => api.submit(selected.id), "Submitted for review.")}
            onReturnDraft={() =>
              selected && run(() => api.transition(selected.id, "DRAFT"), "Returned to draft.")
            }
          />
        ) : (
          <AdminPanels
            view={adminView}
            queue={queue}
            selected={selected}
            audit={audit}
            api={api}
            onOpen={(id) => openApp(id, "detail")}
            onAction={(action, reason) =>
              selected && run(() => api.adminAction(selected.id, action, reason), `Action ${action} applied.`)
            }
            onCapability={(capability, status) =>
              selected && run(() => api.reviewCapability(selected.id, capability, status), "Capability reviewed.")
            }
          />
        )}
      </section>
    </main>
  );
}

function DeveloperPanels(props: {
  view: DevView;
  apps: ApplicationView[];
  selected: ApplicationView | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onRegister: (manifest: ApplicationManifestClaim) => void;
  onSaveManifest: (manifest: ApplicationManifestClaim) => void;
  onEvidence: (type: EvidenceType, locator: string) => void;
  onSubmit: () => void;
  onReturnDraft: () => void;
}) {
  const { view, apps, selected } = props;
  if (view === "register") return <RegisterForm onSubmit={props.onRegister} />;
  if (view === "applications" || view === "dashboard") {
    return (
      <>
        <div className="metrics">
          <Metric n={String(apps.length)} t="Applications" />
          <Metric n={String(apps.filter((a) => a.state === "CHANGES_REQUIRED").length)} t="Action required" />
          <Metric n={String(apps.filter((a) => a.state === "PUBLISHED").length)} t="Published" />
        </div>
        <article className="panel wide">
          <div className="panel-head">
            <h2>Applications</h2>
          </div>
          {!props.loading && apps.length === 0 ? (
            <StatusBanner empty="No applications yet. Register one to begin." />
          ) : (
            apps.map((app) => (
              <div className="app" key={app.id} data-testid={`app-row-${app.id}`}>
                <div className="mark">{app.manifest.name[0]}</div>
                <div>
                  <b>{app.manifest.name}</b>
                  <small>{app.manifest.origin}</small>
                </div>
                <Badge>{app.state}</Badge>
                <span>{app.capabilities.map((c) => c.capability).join(" · ")}</span>
                <button onClick={() => props.onOpen(app.id)}>Open →</button>
              </div>
            ))
          )}
        </article>
      </>
    );
  }
  if (!selected) return <StatusBanner empty="Select or register an application first." />;

  if (view === "detail") {
    return (
      <article className="panel" data-testid="app-detail">
        <h2>{selected.manifest.name}</h2>
        <p className="next">
          ID <code>{selected.id}</code> · revision {selected.revision} · <Badge>{selected.state}</Badge>
        </p>
        <p className="next">Origin {selected.manifest.origin}</p>
        <p className="next">Integration {selected.integrationStatus}</p>
      </article>
    );
  }
  if (view === "manifest") return <ManifestEditor app={selected} onSave={props.onSaveManifest} />;
  if (view === "capabilities") {
    return (
      <article className="panel">
        <h2>Declared capabilities</h2>
        <p className="next">Declaration status is not runtime authorization.</p>
        <ul className="list">
          {selected.capabilities.map((item) => (
            <li key={item.capability} data-testid={`cap-${item.capability}`}>
              <b>{item.capability}</b> <Badge>{item.status}</Badge>
            </li>
          ))}
        </ul>
        <ManifestEditor app={selected} onSave={props.onSaveManifest} capabilitiesOnly />
      </article>
    );
  }
  if (view === "verification") return <EvidenceForm app={selected} onSubmit={props.onEvidence} />;
  if (view === "integration") {
    return (
      <article className="panel">
        <h2>Xperience integration</h2>
        <p className="next">Channel URL: {selected.manifest.xperienceUrl}</p>
        <Badge>{selected.integrationStatus}</Badge>
      </article>
    );
  }
  if (view === "testing") {
    return (
      <article className="panel">
        <h2>Channel testing</h2>
        <p className="next">
          Handshake remains origin-bound. Live provider connectivity is not simulated here.
        </p>
        <p className="next">Declared Xperience URL: {selected.manifest.xperienceUrl}</p>
      </article>
    );
  }
  if (view === "submit") {
    return (
      <article className="panel">
        <h2>Submit for review</h2>
        <p className="next">Current state: {selected.state}</p>
        <button className="primary" data-testid="submit-app" onClick={props.onSubmit} disabled={selected.state !== "DRAFT" && selected.state !== "CHANGES_REQUIRED"}>
          Submit application
        </button>
        {selected.state === "CHANGES_REQUIRED" ? (
          <button className="secondary" onClick={props.onReturnDraft}>
            Return to draft first
          </button>
        ) : null}
      </article>
    );
  }
  return (
    <article className="panel" data-testid="review-status">
      <h2>Review status</h2>
      <Badge>{selected.state}</Badge>
      <p className="next">APPROVED and PUBLISHED are separate decisions.</p>
    </article>
  );
}

function AdminPanels(props: {
  view: AdminView;
  queue: ApplicationView[];
  selected: ApplicationView | null;
  audit: AuditEventView[];
  api: ReturnType<typeof createXperienceApiClient>;
  onOpen: (id: string) => void;
  onAction: (action: string, reason?: string) => void;
  onCapability: (capability: Capability, status: "APPROVED" | "REJECTED" | "REQUIRES_CHANGES") => void;
}) {
  const { view, queue, selected, audit } = props;
  if (view === "releases") {
    return <ReleaseControlPanel api={props.api} />;
  }
  if (view === "presentation") {
    return <PresentationControlPanel api={props.api} />;
  }
  if (view === "overview" || view === "queue") {
    return (
      <>
        <div className="metrics">
          <Metric n={String(queue.length)} t="Awaiting review" />
          <Metric n={String(queue.filter((a) => a.evidence.some((e) => e.status === "PENDING" || e.status === "UNAVAILABLE")).length)} t="Evidence pending" />
          <Metric n="—" t="Published (queue view)" />
        </div>
        <article className="panel wide">
          <div className="panel-head">
            <h2>Review queue</h2>
          </div>
          {queue.length === 0 ? (
            <StatusBanner empty="Review queue is empty." />
          ) : (
            queue.map((app) => (
              <div className="app" key={app.id} data-testid={`queue-${app.id}`}>
                <div className="mark">{app.manifest.name[0]}</div>
                <div>
                  <b>{app.manifest.name}</b>
                  <small>{app.developerId}</small>
                </div>
                <Badge>{app.state}</Badge>
                <span>{app.capabilities.map((c) => c.capability).join(" · ")}</span>
                <button onClick={() => props.onOpen(app.id)}>Review →</button>
              </div>
            ))
          )}
        </article>
      </>
    );
  }
  if (!selected && view !== "audit") return <StatusBanner empty="Select an application from the review queue." />;

  if (view === "detail" && selected) {
    return (
      <article className="panel" data-testid="admin-detail">
        <h2>{selected.manifest.name}</h2>
        <Badge>{selected.state}</Badge>
        <p className="next">Developer {selected.developerId}</p>
        <p className="next">Origin {selected.manifest.origin}</p>
        <pre className="code">{JSON.stringify(selected.manifest, null, 2)}</pre>
      </article>
    );
  }
  if (view === "evidence" && selected) {
    return (
      <article className="panel" data-testid="admin-evidence">
        <h2>Verification evidence</h2>
        {selected.evidence.length === 0 ? (
          <StatusBanner empty="No evidence claims yet." />
        ) : (
          selected.evidence.map((item) => (
            <p key={item.id} className="next">
              <b>{item.type}</b> · <Badge>{item.status}</Badge> · {item.locator}
              {item.detail ? ` — ${item.detail}` : ""}
            </p>
          ))
        )}
      </article>
    );
  }
  if (view === "capabilities" && selected) {
    return (
      <article className="panel" data-testid="admin-capabilities">
        <h2>Capability review</h2>
        <p className="next">Approving a capability does not grant runtime authorization.</p>
        {selected.capabilities.map((item) => (
          <div className="app" key={item.capability}>
            <div className="mark">{item.capability[0]}</div>
            <div>
              <b>{item.capability}</b>
              <small>{item.status}</small>
            </div>
            <button onClick={() => props.onCapability(item.capability, "APPROVED")}>Approve</button>
            <button onClick={() => props.onCapability(item.capability, "REQUIRES_CHANGES")}>Request changes</button>
            <button onClick={() => props.onCapability(item.capability, "REJECTED")}>Reject</button>
          </div>
        ))}
      </article>
    );
  }
  if (view === "actions" && selected) {
    return (
      <article className="panel" data-testid="admin-actions">
        <h2>Review actions</h2>
        <p className="next">Current: {selected.state}. Publish is never automatic after approval.</p>
        <div className="actions">
          {[
            ["start-review", "Start review"],
            ["request-changes", "Request changes"],
            ["approve", "Approve"],
            ["reject", "Reject"],
            ["publish", "Publish"],
            ["suspend", "Suspend"],
            ["revoke", "Revoke publication"],
          ].map(([action, label]) => (
            <button
              key={action}
              className="secondary"
              data-testid={`action-${action}`}
              onClick={() => props.onAction(action, `${label} from admin console`)}
            >
              {label}
            </button>
          ))}
        </div>
      </article>
    );
  }
  return (
    <article className="panel audit" data-testid="admin-audit">
      <h2>Audit history</h2>
      {audit.length === 0 ? (
        <StatusBanner empty="No audit events." />
      ) : (
        audit.map((event) => (
          <p key={event.id ?? `${event.action}-${event.at}`}>
            <b>{event.action}</b> · {event.applicationId ?? "—"} · {event.actorType}:{event.actorId}
            {event.previousState ? ` · ${event.previousState} → ${event.newState}` : ""} · {event.at}
          </p>
        ))
      )}
    </article>
  );
}

function RegisterForm({ onSubmit }: { onSubmit: (manifest: ApplicationManifestClaim) => void }) {
  const [manifest, setManifest] = useState(emptyManifest());
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(manifest);
  }
  return (
    <form className="panel form" onSubmit={submit} data-testid="register-form">
      <h2>Register application</h2>
      {(
        [
          ["applicationId", "Application ID"],
          ["name", "Name"],
          ["version", "Version"],
          ["origin", "Origin"],
          ["productionUrl", "Production URL"],
          ["xperienceUrl", "Xperience URL"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            data-testid={`field-${key}`}
            value={manifest[key]}
            onChange={(e) => setManifest({ ...manifest, [key]: e.target.value })}
            required
          />
        </label>
      ))}
      <label>
        Capabilities
        <select
          multiple
          value={manifest.capabilities}
          onChange={(e) =>
            setManifest({
              ...manifest,
              capabilities: [...e.target.selectedOptions].map((o) => o.value as Capability),
            })
          }
        >
          {CAPABILITIES.map((cap) => (
            <option key={cap} value={cap}>
              {cap}
            </option>
          ))}
        </select>
      </label>
      <button className="primary" type="submit" data-testid="register-submit">
        Register
      </button>
    </form>
  );
}

function ManifestEditor({
  app,
  onSave,
  capabilitiesOnly,
}: {
  app: ApplicationView;
  onSave: (manifest: ApplicationManifestClaim) => void;
  capabilitiesOnly?: boolean;
}) {
  const [manifest, setManifest] = useState(app.manifest);
  useEffect(() => setManifest(app.manifest), [app]);
  return (
    <form
      className="panel form"
      data-testid="manifest-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(manifest);
      }}
    >
      <h2>{capabilitiesOnly ? "Update capabilities" : "Edit manifest"}</h2>
      {!capabilitiesOnly
        ? (["name", "version", "origin", "productionUrl", "xperienceUrl"] as const).map((key) => (
            <label key={key}>
              {key}
              <input value={manifest[key]} onChange={(e) => setManifest({ ...manifest, [key]: e.target.value })} />
            </label>
          ))
        : null}
      <label>
        Capabilities
        <select
          multiple
          value={manifest.capabilities}
          data-testid="capabilities-select"
          onChange={(e) =>
            setManifest({
              ...manifest,
              capabilities: [...e.target.selectedOptions].map((o) => o.value as Capability),
            })
          }
        >
          {CAPABILITIES.map((cap) => (
            <option key={cap} value={cap}>
              {cap}
            </option>
          ))}
        </select>
      </label>
      <button className="primary" type="submit" data-testid="save-manifest">
        Save
      </button>
    </form>
  );
}

function EvidenceForm({
  app,
  onSubmit,
}: {
  app: ApplicationView;
  onSubmit: (type: EvidenceType, locator: string) => void;
}) {
  const [type, setType] = useState<EvidenceType>("DOMAIN");
  const [locator, setLocator] = useState(app.manifest.origin);
  return (
    <article className="panel">
      <h2>Verification</h2>
      <p className="next">Providers may return UNAVAILABLE or PENDING until connected. VERIFIED is never fabricated.</p>
      <ul className="list">
        {app.evidence.map((item) => (
          <li key={item.id}>
            {item.type} · <Badge>{item.status}</Badge> · {item.locator}
          </li>
        ))}
      </ul>
      <form
        className="form"
        data-testid="evidence-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(type, locator);
        }}
      >
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as EvidenceType)}>
            {EVIDENCE_TYPES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Locator
          <input data-testid="evidence-locator" value={locator} onChange={(e) => setLocator(e.target.value)} />
        </label>
        <button className="primary" type="submit" data-testid="claim-evidence">
          Claim evidence
        </button>
      </form>
    </article>
  );
}

function ReleaseControlPanel({ api }: { api: XperienceApiClient }) {
  const [rows, setRows] = useState<
    Awaited<ReturnType<XperienceApiClient["listReleases"]>>["experiences"]
  >([]);
  const [audits, setAudits] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  async function refresh() {
    try {
      const data = await api.listReleases();
      setRows(data.experiences);
      setAudits(data.audits);
      setVersion(data.manifestVersion);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load releases.");
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  async function act(
    id: string,
    action: "preload" | "lock" | "go-live" | "pause" | "retire",
  ) {
    if (action === "go-live") {
      const ok = window.confirm(`Go LIVE with ${id}? Audience devices will receive this Experience.`);
      if (!ok) return;
    }
    setBusy(`${id}:${action}`);
    try {
      await api.releaseAction(id, action, {
        visibility: action === "go-live" ? "FEATURED" : undefined,
        confirmLive: action === "go-live",
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Release action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="panel wide" data-testid="admin-releases">
      <div className="panel-head">
        <h2>Experience releases</h2>
        <small>manifest v{version}</small>
      </div>
      <p className="next">
        Preload packages invisibly, then Go Live to reveal — no new PWA install. Release state is separate from
        authMode.
      </p>
      {error ? <p className="state bad">{error}</p> : null}
      <table data-testid="release-table">
        <thead>
          <tr>
            <th>Experience</th>
            <th>State</th>
            <th>Visibility</th>
            <th>Auth</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.experienceId} data-testid={`release-row-${row.experienceId}`}>
              <td>
                <b>{row.name}</b>
                <div>
                  <small>{row.experienceId}</small>
                </div>
              </td>
              <td>{row.releaseState}</td>
              <td>{row.visibility}</td>
              <td>{row.authMode}</td>
              <td className="actions">
                {(["preload", "lock", "go-live", "pause", "retire"] as const).map((action) => (
                  <button
                    key={action}
                    className="secondary"
                    disabled={busy === `${row.experienceId}:${action}`}
                    data-testid={`release-${action}-${row.experienceId}`}
                    onClick={() => void act(row.experienceId, action)}
                  >
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Release audit</h3>
      <ul>
        {audits.slice(0, 12).map((item, index) => (
          <li key={index}>
            <code>{JSON.stringify(item)}</code>
          </li>
        ))}
      </ul>
    </article>
  );
}

type PresentationViewModel = Awaited<ReturnType<XperienceApiClient["getPresentation"]>>;

function PresentationControlPanel({ api }: { api: XperienceApiClient }) {
  const [presentation, setPresentation] = useState<PresentationViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReveal, setConfirmReveal] = useState(false);

  async function refresh() {
    try {
      const listed = await api.listPresentations();
      const first = listed.presentations[0];
      if (!first) {
        setPresentation(null);
        setError(null);
        return;
      }
      const detail = await api.getPresentation(first.id);
      setPresentation(detail);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load presentation.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [api]);

  async function run(
    action: Parameters<XperienceApiClient["presentationAction"]>[1],
    body?: { chapterId?: string; confirm?: boolean },
  ) {
    if (!presentation) return;
    setBusy(action);
    try {
      const result = await api.presentationAction(presentation.id, action, body);
      setPresentation(result.presentation);
      setConfirmReveal(false);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Presentation action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!presentation) {
    return (
      <article className="panel wide" data-testid="admin-presentation">
        <h2>Presentation Control</h2>
        {error ? <p className="state bad">{error}</p> : <p className="next">No presentation configured.</p>}
      </article>
    );
  }

  const current = presentation.currentChapter;
  const next = presentation.nextChapter;
  const live = presentation.status === "LIVE" || presentation.status === "PAUSED";

  return (
    <article className="panel wide" data-testid="admin-presentation">
      <div className="panel-head">
        <h2>OS XPERIENCE — LIVE PRESENTATION</h2>
        <small>{presentation.status}</small>
      </div>
      <p className="next">{presentation.title}</p>
      {error ? <p className="state bad">{error}</p> : null}

      <div className="metrics" style={{ marginBottom: "1rem" }}>
        <article className="metric">
          <b>Current</b>
          <span>
            {current ? `Chapter ${current.order} — ${current.title}` : "—"}
          </span>
        </article>
        <article className="metric">
          <b>Next</b>
          <span>{next ? `Chapter ${next.order} — ${next.title}` : "—"}</span>
        </article>
      </div>

      <div className="actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {presentation.status === "DRAFT" || presentation.status === "READY" ? (
          <button
            className="primary"
            disabled={Boolean(busy)}
            data-testid="presentation-start"
            onClick={() => void run("start")}
          >
            Start Presentation
          </button>
        ) : null}
        <button
          className="secondary"
          disabled={!live || !presentation.previousChapter || Boolean(busy)}
          data-testid="presentation-previous"
          onClick={() => void run("previous")}
        >
          Previous
        </button>
        <button
          className="primary"
          disabled={!live || Boolean(busy)}
          data-testid="presentation-reveal"
          onClick={() => {
            if (presentation.skipRevealConfirm) {
              void run("reveal-current", { confirm: true });
              return;
            }
            setConfirmReveal(true);
          }}
        >
          Reveal Current
        </button>
        <button
          className="secondary"
          disabled={!live || !next || Boolean(busy)}
          data-testid="presentation-next"
          onClick={() => void run("next")}
        >
          Next Chapter
        </button>
        {presentation.status === "LIVE" ? (
          <button
            className="secondary"
            disabled={Boolean(busy)}
            data-testid="presentation-pause"
            onClick={() => void run("pause")}
          >
            Pause Presentation
          </button>
        ) : null}
        {presentation.status === "PAUSED" ? (
          <button
            className="primary"
            disabled={Boolean(busy)}
            data-testid="presentation-resume"
            onClick={() => void run("resume")}
          >
            Resume
          </button>
        ) : null}
        {live ? (
          <button
            className="secondary"
            disabled={Boolean(busy)}
            data-testid="presentation-end"
            onClick={() => void run("end")}
          >
            End
          </button>
        ) : null}
      </div>

      {confirmReveal && current ? (
        <div className="panel" data-testid="presentation-reveal-confirm" style={{ marginBottom: "1rem" }}>
          <p>
            Reveal <b>{current.title}</b> to the audience?
          </p>
          <p className="next">This will make the Experience LIVE and FEATURED.</p>
          <div className="actions" style={{ display: "flex", gap: "0.5rem" }}>
            <button className="secondary" data-testid="presentation-reveal-cancel" onClick={() => setConfirmReveal(false)}>
              Cancel
            </button>
            <button
              className="primary"
              data-testid="presentation-reveal-confirm-btn"
              disabled={Boolean(busy)}
              onClick={() => void run("reveal-current", { confirm: true })}
            >
              Reveal
            </button>
          </div>
        </div>
      ) : null}

      <h3>Chapters</h3>
      <table data-testid="presentation-chapters">
        <thead>
          <tr>
            <th>#</th>
            <th>Experience</th>
            <th>Action</th>
            <th>Pointer</th>
          </tr>
        </thead>
        <tbody>
          {presentation.chapters.map((chapter) => {
            const isCurrent = chapter.id === presentation.currentChapterId;
            return (
              <tr key={chapter.id} data-testid={`presentation-chapter-${chapter.order}`}>
                <td>{chapter.order}</td>
                <td>
                  <b>{chapter.title}</b>
                  <div>
                    <small>{chapter.experienceId}</small>
                  </div>
                </td>
                <td>{chapter.action}</td>
                <td>{isCurrent ? (presentation.status === "LIVE" ? "LIVE" : presentation.status) : "READY"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

function Metric({ n, t }: { n: string; t: string }) {
  return (
    <article className="metric">
      <b>{n}</b>
      <span>{t}</span>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
