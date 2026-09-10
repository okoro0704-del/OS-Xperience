import { useState } from "react";
import {
  appKindFromClass,
  grantCapabilityFor,
  nativeAppForOrigin,
  updateInfoFor,
  type AppIdentity,
  type AppLifecycle,
  type ApplicationRuntimeState,
  type CapabilityStatusRow,
  type EmbedState,
  type FavoriteApp,
  type LoadDecision,
  type OSShellApplicationRecord,
  type OSShellIntentHandlerDescriptor,
  type PermissionCenterRow,
  type PermissionGrant,
  type RecentApp,
  type ShellAppRecord,
} from "@osshell/contract";

export type Surface =
  | "home"
  | "apps"
  | "app"
  | "app-detail"
  | "add-app"
  | "digitallife"
  | "devices"
  | "user"
  | "session"
  | "actions"
  | "search"
  | "launcher"
  | "recent-work";

export type ShellSession = {
  href: string;
  origin: string;
  identity: AppIdentity;
  decision: LoadDecision;
  embed: EmbedState;
  requested: string[];
  newContextOpened?: boolean;
  newContextBlocked?: boolean;
  manifestError: string | null;
  runtimeState: ApplicationRuntimeState | null;
  title: string | null;
  path: string | null;
  canGoBack: boolean;
  handshake: boolean;
};

export function HomeSurface(props: {
  recents: RecentApp[];
  favorites: FavoriteApp[];
  natives: ShellAppRecord[];
  input: string;
  busy: boolean;
  error: string | null;
  onInput: (value: string) => void;
  onLoad: () => void;
  onOpenRecent: (item: RecentApp) => void;
  onLaunchNative: (id: "mybrandos" | "lifeos") => void;
  onDigitalLife: () => void;
  grantNotes?: string[];
  recentWork?: Array<{
    label: string;
    appName?: string;
    contextType?: string;
    status?: string;
    statusLabel?: string;
    onOpen: () => void;
    onContinue?: () => void;
  }>;
  continueSuggestions?: Array<{ label: string; onClick: () => void }>;
  recommendedActions?: Array<{ label: string; detail?: string; why?: string; onClick: () => void }>;
  ambiguityChoices?: Array<{ label: string; detail?: string; onClick: () => void }>;
  recoveryPrompt?: { label: string; onResume: () => void; onDismiss: () => void } | null;
  onOpenLauncher?: () => void;
  objectiveShortcuts?: Array<{ label: string; onClick: () => void }>;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Welcome</div>
      <h1>What is relevant right now?</h1>
      <p>The Shell orients you with operating context. Applications own the work.</p>

      {props.onOpenLauncher ? (
        <div className="actions" style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={props.onOpenLauncher}>
            Open launcher
          </button>
        </div>
      ) : null}

      {props.objectiveShortcuts?.length ? (
        <>
          <h2>Start</h2>
          <div className="list">
            {props.objectiveShortcuts.map((item) => (
              <button key={item.label} type="button" onClick={item.onClick}>
                <div>{item.label}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {props.recoveryPrompt ? (
        <div className="note">
          <div>Resume previous session?</div>
          <div className="muted">{props.recoveryPrompt.label}</div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="btn primary" type="button" onClick={props.recoveryPrompt.onResume}>
              Resume
            </button>
            <button className="btn" type="button" onClick={props.recoveryPrompt.onDismiss}>
              Start fresh
            </button>
          </div>
        </div>
      ) : null}

      {props.recentWork?.length ? (
        <>
          <h2>Continue Working</h2>
          <div className="list">
            {props.recentWork.map((item) => (
              <div key={item.label + (item.appName ?? "") + (item.status ?? "")} className="note" style={{ marginBottom: 8 }}>
                <div>{item.label}</div>
                <div className="muted">
                  {item.appName ?? "Application"}
                  {item.contextType ? ` · ${item.contextType}` : ""}
                  {item.status && item.status !== "AVAILABLE" ? ` · ${item.status}` : ""}
                </div>
                <div className="actions" style={{ marginTop: 8 }}>
                      {item.status === "AVAILABLE" || !item.status ? (
                    <button className="btn primary" type="button" onClick={item.onContinue ?? item.onOpen}>
                      {item.statusLabel ?? "Continue"}
                    </button>
                  ) : (
                    <button className="btn" type="button" onClick={item.onOpen}>
                      View details
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {props.continueSuggestions?.length ? (
        <>
          <h2>Next</h2>
          <div className="list">
            {props.continueSuggestions.map((item) => (
              <button key={item.label} type="button" onClick={item.onClick}>
                <div>{item.label}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {props.ambiguityChoices?.length ? (
        <>
          <h2>Which one?</h2>
          <p className="muted">Multiple matching objects. Choose explicitly — the Shell will not guess.</p>
          <div className="list">
            {props.ambiguityChoices.map((item) => (
              <button key={item.label + (item.detail ?? "")} type="button" onClick={item.onClick}>
                <div>{item.label}</div>
                {item.detail ? <div className="muted">{item.detail}</div> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {props.recommendedActions?.length ? (
        <>
          <h2>Recommended</h2>
          <p className="muted">Deterministic actions for your current work — not behavioral profiling.</p>
          <div className="list">
            {props.recommendedActions.map((item) => (
              <button key={item.label + (item.detail ?? "")} type="button" onClick={item.onClick}>
                <div>{item.label}</div>
                <div className="muted">
                  {item.detail ?? ""}
                  {item.why ? ` · ${item.why}` : ""}
                </div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {props.grantNotes?.length ? (
        <div className="note">
          {props.grantNotes.map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      ) : null}

      <h2>Open</h2>
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          props.onLoad();
        }}
      >
        <input
          type="url"
          value={props.input}
          onChange={(event) => props.onInput(event.target.value)}
          placeholder="https://example.com"
          aria-label="Open URL"
          style={{ flex: 1, minWidth: 160 }}
        />
        <button className="btn primary" type="submit" disabled={props.busy}>
          Open
        </button>
      </form>
      {props.error ? <div className="note blocked">{props.error}</div> : null}

      {props.favorites.length ? (
        <>
          <h2>Favorites</h2>
          <div className="list">
            {props.favorites.map((item) => (
              <button key={item.origin} type="button" onClick={() => props.onOpenRecent({ ...item, href: item.origin, openedAt: "" })}>
                <div>{item.name}</div>
                <div className="muted">{item.kind === "url" ? "URL" : "Application"} · {item.class}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <h2>Recent</h2>
      <div className="list">
        {props.recents.length === 0 ? <p className="empty">Nothing opened yet.</p> : null}
        {props.recents.map((item) => (
          <button key={item.origin} type="button" onClick={() => props.onOpenRecent(item)}>
            <div>{item.name}</div>
            <div className="muted">{item.kind === "url" ? item.href : item.origin} · {item.class}</div>
          </button>
        ))}
      </div>

      <h2>Digital Life</h2>
      <div className="list">
        {props.natives.map((app) => (
          <button
            key={app.id}
            type="button"
            onClick={() => {
              if (app.id === "mybrandos" || app.id === "lifeos") props.onLaunchNative(app.id);
              else props.onOpenRecent({ origin: app.origin, href: app.origin, name: app.name, class: app.class, kind: app.kind, openedAt: "" });
            }}
          >
            <div>{app.name}</div>
            <div className="muted">{app.purpose}</div>
          </button>
        ))}
        <button type="button" onClick={props.onDigitalLife}>
          <div>My Digital Life</div>
          <div className="muted">Creator and consumer apps stay in mybrandOS and LifeOS.</div>
        </button>
      </div>
    </div>
  );
}

export function AppSwitcher(props: {
  sessions: ShellSession[];
  lifecycle: (origin: string) => AppLifecycle;
  activeOrigin: string | null;
  onActivate: (origin: string) => void;
  onClose: (origin: string) => void;
  grantNote?: (origin: string) => string | null;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Open sessions</div>
      <h1>Switcher</h1>
      <p>Open applications keep their own origin, grants, and Digital Life boundary.</p>
      <div className="list">
        {props.sessions.length === 0 ? <p className="empty">No open applications.</p> : null}
        {props.sessions.map((item) => (
          <div className="tile" key={item.origin}>
            <div className="row">
              <button type="button" onClick={() => props.onActivate(item.origin)} style={{ flex: 1, border: 0, padding: 0 }}>
                <div>{item.identity.name}</div>
                <div className="muted">
                  {props.lifecycle(item.origin)} · {item.identity.effectiveClass} · {appKindFromClass(item.identity.effectiveClass) === "url" ? "URL" : "Application"}
                  {item.runtimeState ? ` · ${item.runtimeState}` : ""}
                </div>
                <div className="muted">{item.origin}</div>
                {props.grantNote?.(item.origin) ? <div className="muted">{props.grantNote(item.origin)}</div> : null}
              </button>
              <button className="btn danger" type="button" onClick={() => props.onClose(item.origin)}>
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApplicationsLauncher(props: {
  installed: OSShellApplicationRecord[];
  available: OSShellApplicationRecord[];
  sessions: ShellSession[];
  recents: RecentApp[];
  favorites: FavoriteApp[];
  updates: OSShellApplicationRecord[];
  onOpenApp: (appId: string) => void;
  onDetail: (appId: string) => void;
  onAdd: () => void;
  onOpenRecent: (item: RecentApp) => void;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Applications</div>
      <h1>Applications</h1>
      <p>Installed applications share one model. Source and trust are not privilege.</p>
      <div className="actions" style={{ marginBottom: 16 }}>
        <button className="btn primary" type="button" onClick={props.onAdd}>
          Add application
        </button>
      </div>

      <h2>Installed</h2>
      <div className="list">
        {props.installed.length === 0 ? <p className="empty">No installed applications.</p> : null}
        {props.installed.map((app) => (
          <div className="tile" key={app.appId}>
            <div className="row">
              <button type="button" onClick={() => props.onDetail(app.appId)} style={{ flex: 1, border: 0, padding: 0, textAlign: "left" }}>
                <div>{app.name}</div>
                <div className="muted">
                  {app.source} · {app.trustState} · v{app.version} · {app.class}
                </div>
                <div className="muted">{app.origin}</div>
              </button>
              <button className="btn primary" type="button" onClick={() => props.onOpenApp(app.appId)}>
                Open
              </button>
            </div>
          </div>
        ))}
      </div>

      {props.available.length ? (
        <>
          <h2>Available</h2>
          <div className="list">
            {props.available.map((app) => (
              <button key={app.appId} type="button" onClick={() => props.onDetail(app.appId)}>
                <div>{app.name}</div>
                <div className="muted">DISCOVERED · {app.source} · {app.origin}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {props.favorites.length ? (
        <>
          <h2>Favorites</h2>
          <div className="list">
            {props.favorites.map((item) => (
              <button key={item.origin} type="button" onClick={() => props.onOpenRecent({ ...item, href: item.origin, openedAt: "" })}>
                <div>{item.name}</div>
                <div className="muted">{item.class}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      <h2>Recent</h2>
      <div className="list">
        {props.recents.length === 0 ? <p className="empty">Nothing opened yet.</p> : null}
        {props.recents.map((item) => (
          <button key={item.origin} type="button" onClick={() => props.onOpenRecent(item)}>
            <div>{item.name}</div>
            <div className="muted">{item.origin}</div>
          </button>
        ))}
      </div>

      <h2>Updates</h2>
      <div className="list">
        {props.updates.length === 0 ? <p className="empty">No update metadata.</p> : null}
        {props.updates.map((app) => {
          const info = updateInfoFor(app);
          return (
            <button key={app.appId} type="button" onClick={() => props.onDetail(app.appId)}>
              <div>{app.name}</div>
              <div className="muted">
                {info.status} · {info.currentVersion}
                {info.availableVersion ? ` → ${info.availableVersion}` : ""}
              </div>
            </button>
          );
        })}
      </div>

      {props.sessions.length ? (
        <>
          <h2>Running</h2>
          <div className="list">
            {props.sessions.map((item) => {
              const match = props.installed.find((app) => app.origin === item.origin);
              return (
                <button
                  key={item.origin}
                  type="button"
                  onClick={() => (match ? props.onOpenApp(match.appId) : props.onOpenRecent({ origin: item.origin, href: item.href, name: item.identity.name, class: item.identity.effectiveClass, kind: "application", openedAt: "" }))}
                >
                  <div>{item.identity.name}</div>
                  <div className="muted">RUNNING · {item.origin}</div>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ApplicationDetailSurface(props: {
  app: OSShellApplicationRecord;
  permissionRows: { id: string; label: string; state: string }[];
  compatibilitySupported: boolean;
  compatibilityDetail: string;
  onOpen: () => void;
  onPermissions: () => void;
  onRemove: (() => void) | null;
  onCheckUpdate: () => void;
  updateLabel: string;
}) {
  const update = updateInfoFor(props.app);
  return (
    <div className="panel">
      <div className="eyebrow">Application</div>
      <h1>{props.app.name}</h1>
      <p>{props.app.purpose ?? "Registered Shell application."}</p>
      <div className="note">
        <div>Version {props.app.version}</div>
        <div className="muted">Origin: {props.app.origin}</div>
        <div className="muted">Source: {props.app.source}</div>
        <div className="muted">Trust: {props.app.trustState} (not privilege)</div>
        <div className="muted">Class: {props.app.class}</div>
        <div className="muted">Presence: {props.app.presence}</div>
        <div className="muted">
          Compatibility: {props.compatibilitySupported ? "supported" : "application_incompatible"} · {props.compatibilityDetail}
        </div>
        <div className="muted">
          Update: {update.status}
          {update.availableVersion ? ` · available ${update.availableVersion}` : ""}
        </div>
      </div>

      <h2>Requested capabilities</h2>
      <div className="list">
        {props.app.requestedCapabilities.length === 0 ? <p className="empty">None declared.</p> : null}
        {props.permissionRows.map((row) => (
          <div className="status-row" key={row.id}>
            <div>{row.label}</div>
            <div className="muted">{row.state}</div>
          </div>
        ))}
      </div>
      <p className="muted">Installation does not grant capabilities. Runtime requests remain authoritative.</p>

      <div className="actions">
        <button className="btn primary" type="button" onClick={props.onOpen}>
          Open
        </button>
        <button className="btn" type="button" onClick={props.onPermissions}>
          Permissions
        </button>
        <button className="btn" type="button" onClick={props.onCheckUpdate}>
          {props.updateLabel}
        </button>
        {props.onRemove ? (
          <button className="btn danger" type="button" onClick={props.onRemove}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AddApplicationSurface(props: {
  input: string;
  busy: boolean;
  error: string | null;
  preview: {
    name: string;
    origin: string;
    version: string;
    trustState: string;
    source: string;
    requestedCapabilities: string[];
  } | null;
  onInput: (value: string) => void;
  onProbe: () => void;
  onInstall: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Add application</div>
      <h1>Register from origin</h1>
      <p>Load a public manifest, inspect identity and requested capabilities, then install. No capabilities are granted.</p>
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          props.onProbe();
        }}
      >
        <input
          type="url"
          value={props.input}
          onChange={(event) => props.onInput(event.target.value)}
          placeholder="https://app.example.com"
          aria-label="Application origin"
          style={{ flex: 1, minWidth: 160 }}
        />
        <button className="btn primary" type="submit" disabled={props.busy}>
          Load manifest
        </button>
      </form>
      {props.error ? <div className="note blocked">{props.error}</div> : null}
      {props.preview ? (
        <div className="note">
          <div>{props.preview.name}</div>
          <div className="muted">{props.preview.origin}</div>
          <div className="muted">
            v{props.preview.version} · {props.preview.trustState} · {props.preview.source}
          </div>
          <div className="muted">Requested: {props.preview.requestedCapabilities.join(", ") || "none"}</div>
          <div className="muted">Permissions will be requested later at runtime.</div>
        </div>
      ) : null}
      <div className="actions">
        <button className="btn primary" type="button" disabled={!props.preview || props.busy} onClick={props.onInstall}>
          Install
        </button>
        <button className="btn" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PermissionCenter(props: {
  origins: string[];
  sessions: ShellSession[];
  current: ShellSession | null;
  shellVersion: string;
  rowsFor: (origin: string, appClass: ShellSession["identity"]["effectiveClass"]) => PermissionCenterRow[];
  onRevoke: (origin: string, capability: PermissionGrant["capability"]) => void;
  preferences?: Array<{
    label: string;
    appName: string;
    source: string;
    onClear: () => void;
    onChange?: () => void;
  }>;
  onClearAllPreferences?: () => void;
  operatingContextPrivacy?: {
    currentLabel?: string;
    currentApp?: string;
    availability?: string;
    recentCount: number;
    preferenceCount: number;
    actionCount: number;
    onClearCurrent?: () => void;
    onClearRecent?: () => void;
    onClearAll?: () => void;
  };
}) {
  return (
    <div className="panel">
      <div className="eyebrow">User</div>
      <h1>Permission center</h1>
      <p>Grants are per origin and capability. There is no global camera, device, or Digital Life permission. Trust ID remains authoritative.</p>
      <div className="note">
        <div>Current application: {props.current ? props.current.identity.name : "None"}</div>
        <div className="muted">
          Identity: {props.current ? `${props.current.identity.effectiveClass} · ${props.current.origin}` : "Shell only"}
        </div>
        <div className="muted">Shell {props.shellVersion}. Protocol 0.7. No biometric store. No Shell-owned credentials.</div>
        {props.current ? (
          <div className="muted">
            Diagnostics: {props.current.identity.name} · {props.current.identity.effectiveClass} · requested{" "}
            {props.current.requested.join(", ") || "none"}
          </div>
        ) : null}
      </div>

      <h2>Privacy · Operating Context</h2>
      <p className="muted">
        The Shell remembers place references only — not project contents, credentials, or application databases.
      </p>
      {props.operatingContextPrivacy ? (
        <div className="note">
          <div>Current work: {props.operatingContextPrivacy.currentLabel ?? "None"}</div>
          <div className="muted">
            Application: {props.operatingContextPrivacy.currentApp ?? "—"}
            {props.operatingContextPrivacy.availability
              ? ` · ${props.operatingContextPrivacy.availability}`
              : ""}
          </div>
          <div className="muted">
            Recent entries: {props.operatingContextPrivacy.recentCount} · Preferences:{" "}
            {props.operatingContextPrivacy.preferenceCount} · Contextual actions:{" "}
            {props.operatingContextPrivacy.actionCount}
          </div>
          <div className="actions" style={{ marginTop: 8 }}>
            {props.operatingContextPrivacy.onClearCurrent ? (
              <button className="btn" type="button" onClick={props.operatingContextPrivacy.onClearCurrent}>
                Clear current
              </button>
            ) : null}
            {props.operatingContextPrivacy.onClearRecent ? (
              <button className="btn" type="button" onClick={props.operatingContextPrivacy.onClearRecent}>
                Clear recent
              </button>
            ) : null}
            {props.operatingContextPrivacy.onClearAll ? (
              <button className="btn danger" type="button" onClick={props.operatingContextPrivacy.onClearAll}>
                Clear all context
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="empty">No operating context stored.</p>
      )}

      <h2>Application preferences</h2>
      <p className="muted">Local routing preferences only. Preference is not authorization and never stores credentials.</p>
      <div className="list">
        {(props.preferences?.length ?? 0) === 0 ? <p className="empty">No application preferences yet.</p> : null}
        {(props.preferences ?? []).map((item) => (
          <div className="grant" key={item.label + item.appName}>
            <div>
              <div>{item.label}</div>
              <div className="muted">
                Preferred: {item.appName} · {item.source}
              </div>
            </div>
            <div className="actions">
              {item.onChange ? (
                <button className="btn" type="button" onClick={item.onChange}>
                  Change
                </button>
              ) : null}
              <button className="btn danger" type="button" onClick={item.onClear}>
                Clear
              </button>
            </div>
          </div>
        ))}
      </div>
      {props.onClearAllPreferences && (props.preferences?.length ?? 0) > 0 ? (
        <button className="btn" type="button" onClick={props.onClearAllPreferences}>
          Clear all preferences
        </button>
      ) : null}

      {props.origins.length === 0 ? <p className="empty">No open applications. Grants appear here after an application asks.</p> : null}
      {props.origins.map((origin) => {
        const session = props.sessions.find((item) => item.origin === origin) ?? props.current;
        const name = session?.identity.name ?? origin;
        const appClass = session?.identity.effectiveClass ?? (nativeAppForOrigin(origin) ? "native" : "web");
        const rows = props.rowsFor(origin, appClass);
        return (
          <section key={origin}>
            <h2>{name}</h2>
            <div className="muted" style={{ marginBottom: 8 }}>{origin}</div>
            <div className="list">
              {rows.map((row) => (
                <div className="grant" key={`${origin}:${row.capability}`}>
                  <div>
                    <div>{row.label}</div>
                    <div className="muted">
                      {row.display}
                      {row.grantedAt ? ` · ${row.grantedAt.slice(0, 10)}` : ""}
                      {row.reason ? ` · ${row.reason}` : ""}
                    </div>
                  </div>
                  {row.revocable && grantCapabilityFor(row.capability) ? (
                    <button
                      className="btn danger"
                      type="button"
                      onClick={() => props.onRevoke(origin, grantCapabilityFor(row.capability)!)}
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function CapabilityPanel(props: { rows: CapabilityStatusRow[] }) {
  return (
    <div className="list">
      {props.rows.map((row) => (
        <div className="status-row" key={row.id}>
          <div>
            <div>{row.label}</div>
            <div className="muted">{row.detail}</div>
          </div>
          <div className="muted">{row.code ?? row.state}</div>
        </div>
      ))}
    </div>
  );
}

export function DigitalLifePane(props: {
  onLaunch: (id: "mybrandos" | "lifeos") => void;
  activeName: string | null;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Digital Life</div>
      <h1>Digital Life available</h1>
      <p>
        Knowing which Digital Life you are operating is not the same as owning it. The Shell does not hold Assets,
        files, balances, or device secrets.
      </p>
      <div className="note">
        Active application: {props.activeName ?? "None"}. Native applications remain mybrandOS and LifeOS.
      </div>
      <div className="list">
        <button type="button" onClick={() => props.onLaunch("mybrandos")}>
          <div>mybrandOS</div>
          <div className="muted">Creator Digital Life. Production and Device Bridge stay there.</div>
        </button>
        <button type="button" onClick={() => props.onLaunch("lifeos")}>
          <div>LifeOS</div>
          <div className="muted">Consumer Digital Life. Discovery and library stay there.</div>
        </button>
      </div>
    </div>
  );
}

export function SearchSurface(props: {
  query: string;
  scope: string;
  scopes: Array<{ id: string; label: string }>;
  recent: string[];
  providers: Array<{ appId: string; name: string; state: string }>;
  groups: {
    applications: Array<{ title: string; subtitle?: string; appId?: string; onOpen: () => void }>;
    objects: Array<{
      title: string;
      subtitle?: string;
      actions: Array<{ label: string; onClick: () => void }>;
      onSelect: () => void;
    }>;
    actions: Array<{ title: string; subtitle?: string; onClick: () => void }>;
    objectives?: Array<{ title: string; subtitle?: string; onClick: () => void }>;
  };
  selected?: { title: string; detail: string; actions: Array<{ label: string; onClick: () => void }> } | null;
  onQuery: (value: string) => void;
  onScope: (value: string) => void;
  onSearch: () => void;
  onRecent: (value: string) => void;
  onClearHistory: () => void;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Search</div>
      <h1>Find applications, objects, and actions</h1>
      <p>The Shell coordinates discovery. Applications remain authoritative over their own data.</p>

      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSearch();
        }}
      >
        <input
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="Search video, notes, editors…"
          aria-label="Search"
          style={{ flex: 1, minWidth: 160 }}
        />
        <button className="btn primary" type="submit">
          Search
        </button>
      </form>

      <div className="actions" style={{ marginTop: 8, flexWrap: "wrap" }}>
        {props.scopes.map((scope) => (
          <button
            key={scope.id}
            className={props.scope === scope.id ? "btn primary" : "btn"}
            type="button"
            onClick={() => props.onScope(scope.id)}
          >
            {scope.label}
          </button>
        ))}
      </div>

      {props.recent.length ? (
        <>
          <h2>Recent</h2>
          <div className="list">
            {props.recent.map((item) => (
              <button key={item} type="button" onClick={() => props.onRecent(item)}>
                <div>{item}</div>
              </button>
            ))}
          </div>
          <button className="btn" type="button" onClick={props.onClearHistory}>
            Clear search history
          </button>
        </>
      ) : null}

      {props.providers.length ? (
        <>
          <h2>Providers</h2>
          <div className="muted">
            {props.providers.map((item) => `${item.name}: ${item.state}`).join(" · ")}
          </div>
        </>
      ) : null}

      {props.selected ? (
        <div className="note" style={{ marginTop: 12 }}>
          <div>
            <b>{props.selected.title}</b>
          </div>
          <div className="muted">{props.selected.detail}</div>
          <div className="actions" style={{ marginTop: 8 }}>
            {props.selected.actions.map((action) => (
              <button key={action.label} className="btn primary" type="button" onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <h2>Objectives</h2>
      <div className="list">
        {(props.groups.objectives?.length ?? 0) === 0 ? <p className="empty">No objective results.</p> : null}
        {(props.groups.objectives ?? []).map((item) => (
          <button key={item.title + (item.subtitle ?? "")} type="button" onClick={item.onClick}>
            <div>{item.title}</div>
            <div className="muted">{item.subtitle}</div>
          </button>
        ))}
      </div>

      <h2>Applications</h2>
      <div className="list">
        {props.groups.applications.length === 0 ? <p className="empty">No application results.</p> : null}
        {props.groups.applications.map((item) => (
          <button key={item.title + (item.appId ?? "")} type="button" onClick={item.onOpen}>
            <div>{item.title}</div>
            <div className="muted">{item.subtitle}</div>
          </button>
        ))}
      </div>

      <h2>Objects</h2>
      <div className="list">
        {props.groups.objects.length === 0 ? <p className="empty">No object results.</p> : null}
        {props.groups.objects.map((item) => (
          <div key={item.title + (item.subtitle ?? "")} className="status-row">
            <button type="button" onClick={item.onSelect} style={{ textAlign: "left", flex: 1 }}>
              <div>{item.title}</div>
              <div className="muted">{item.subtitle}</div>
            </button>
            <div className="actions">
              {item.actions.slice(0, 3).map((action) => (
                <button key={action.label} className="btn" type="button" onClick={action.onClick}>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2>Actions</h2>
      <div className="list">
        {props.groups.actions.length === 0 ? <p className="empty">No action results.</p> : null}
        {props.groups.actions.map((item) => (
          <button key={item.title + (item.subtitle ?? "")} type="button" onClick={item.onClick}>
            <div>{item.title}</div>
            <div className="muted">{item.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LauncherSurface(props: {
  query: string;
  recent: string[];
  favorites: string[];
  suggestions: Array<{
    title: string;
    subtitle: string;
    availability: string;
    onStart: () => void;
  }>;
  recommended: Array<{
    title: string;
    subtitle: string;
    availability: string;
    reason?: string;
    onStart: () => void;
    onAlways?: () => void;
  }>;
  others: Array<{
    title: string;
    subtitle: string;
    availability: string;
    reason?: string;
    onStart: () => void;
    onAlways?: () => void;
  }>;
  selected?: {
    title: string;
    detail: string;
    availability: string;
    actions: Array<{ label: string; onClick: () => void }>;
  } | null;
  contextNeeded?: boolean;
  onQuery: (value: string) => void;
  onResolve: () => void;
  onRecent: (value: string) => void;
  onClearHistory: () => void;
  onPickContext?: () => void;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Launcher</div>
      <h1>What do you want to do?</h1>
      <p>Express an objective. The Shell discovers applications, actions, and sessions — it does not perform the work.</p>

      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          props.onResolve();
        }}
      >
        <input
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          placeholder="Create video, edit music, continue…"
          aria-label="Objective"
          style={{ flex: 1, minWidth: 160 }}
        />
        <button className="btn primary" type="submit">
          Find route
        </button>
      </form>

      {props.contextNeeded ? (
        <div className="note" style={{ marginTop: 10 }}>
          <div>Context required</div>
          <div className="muted">Select an object, then retry the objective.</div>
          {props.onPickContext ? (
            <button className="btn" type="button" style={{ marginTop: 8 }} onClick={props.onPickContext}>
              Search objects
            </button>
          ) : null}
        </div>
      ) : null}

      {props.favorites.length ? (
        <>
          <h2>Pinned</h2>
          <div className="list">
            {props.favorites.map((item) => (
              <button key={item} type="button" onClick={() => props.onRecent(item)}>
                <div>{item}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {props.recent.length ? (
        <>
          <h2>Recent</h2>
          <div className="list">
            {props.recent.map((item) => (
              <button key={item} type="button" onClick={() => props.onRecent(item)}>
                <div>{item}</div>
              </button>
            ))}
          </div>
          <button className="btn" type="button" onClick={props.onClearHistory}>
            Clear objective history
          </button>
        </>
      ) : null}

      {props.selected ? (
        <div className="note" style={{ marginTop: 12 }}>
          <div>
            <b>{props.selected.title}</b>
          </div>
          <div className="muted">{props.selected.detail}</div>
          <div className="muted">Availability · {props.selected.availability}</div>
          <div className="actions" style={{ marginTop: 8 }}>
            {props.selected.actions.map((action) => (
              <button key={action.label} className="btn primary" type="button" onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <h2>Recommended</h2>
      <div className="list">
        {props.recommended.length === 0 ? <p className="empty">No recommended route yet.</p> : null}
        {props.recommended.map((item) => (
          <div key={item.title + item.subtitle} className="status-row">
            <button type="button" onClick={item.onStart} style={{ textAlign: "left", flex: 1 }}>
              <div>{item.title}</div>
              <div className="muted">
                {item.subtitle}
                {item.reason ? ` · ${item.reason}` : ""}
              </div>
            </button>
            <div className="actions">
              <button className="btn primary" type="button" onClick={item.onStart}>
                Use this app
              </button>
              {item.onAlways ? (
                <button className="btn" type="button" onClick={item.onAlways}>
                  Always use
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <h2>Other options</h2>
      <div className="list">
        {props.others.length === 0 ? <p className="empty">No other compatible apps.</p> : null}
        {props.others.map((item) => (
          <div key={item.title + item.subtitle} className="status-row">
            <button type="button" onClick={item.onStart} style={{ textAlign: "left", flex: 1 }}>
              <div>{item.title}</div>
              <div className="muted">
                {item.subtitle}
                {item.reason ? ` · ${item.reason}` : ""}
              </div>
            </button>
            <div className="actions">
              <button className="btn" type="button" onClick={item.onStart}>
                Use this app
              </button>
              {item.onAlways ? (
                <button className="btn" type="button" onClick={item.onAlways}>
                  Always use
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <h2>Suggested</h2>
      <div className="list">
        {props.suggestions.map((item) => (
          <button key={item.title + item.subtitle} type="button" onClick={item.onStart}>
            <div>{item.title}</div>
            <div className="muted">
              {item.subtitle} · {item.availability}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ActionMenuSurface(props: {
  object: {
    title?: string;
    type: string;
    subtype?: string;
    originAppName?: string;
  } | null;
  groups: Array<{
    actionId: string;
    label: string;
    availability: string;
    handlers: Array<{ appId: string; name: string; availability: string; route: string }>;
  }>;
  recentActions: string[];
  confirmAction?: { actionId: string; label: string; appId: string; route: string } | null;
  onSelectSample: (kind: "asset" | "text") => void;
  onClear: () => void;
  onAction: (actionId: string, appId: string, route: string) => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onOpenWith: (actionId: string) => void;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Actions</div>
      <h1>What do you want to do?</h1>
      <p>The Shell lists registered actions for the selected object. It does not own the object or execute the action.</p>

      {!props.object ? (
        <>
          <div className="note">No object selected. Choose a sample reference to explore the action menu.</div>
          <div className="actions">
            <button className="btn primary" type="button" onClick={() => props.onSelectSample("asset")}>
              Select Example Video
            </button>
            <button className="btn" type="button" onClick={() => props.onSelectSample("text")}>
              Select Example Article
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="note">
            <div>
              <b>{props.object.title ?? "Untitled"}</b>
            </div>
            <div className="muted">
              {props.object.type}
              {props.object.subtype ? ` · ${props.object.subtype}` : ""}
              {props.object.originAppName ? ` · from ${props.object.originAppName}` : ""}
            </div>
            <div className="muted">Selection does not grant access.</div>
          </div>
          <div className="actions" style={{ marginBottom: 12 }}>
            <button className="btn" type="button" onClick={props.onClear}>
              Clear selection
            </button>
          </div>

          <h2>Available actions</h2>
          {props.groups.length === 0 ? (
            <p className="empty">No compatible application available</p>
          ) : (
            <div className="list">
              {props.groups.map((group) => {
                const available = group.handlers.filter((item) => item.availability === "AVAILABLE");
                const primary = available[0] ?? group.handlers[0];
                return (
                  <div key={group.actionId} className="status-row">
                    <div>
                      <div>{group.label}</div>
                      <div className="muted">
                        {group.availability}
                        {primary ? ` · ${primary.name}` : ""}
                      </div>
                    </div>
                    <div className="actions">
                      {primary && group.availability === "AVAILABLE" ? (
                        <button
                          className="btn primary"
                          type="button"
                          onClick={() => props.onAction(group.actionId, primary.appId, primary.route)}
                        >
                          {group.label}
                        </button>
                      ) : null}
                      {group.handlers.length > 1 ? (
                        <button className="btn" type="button" onClick={() => props.onOpenWith(group.actionId)}>
                          Open with…
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {props.recentActions.length ? (
            <>
              <h2>Recently used</h2>
              <div className="muted">{props.recentActions.join(" · ")}</div>
            </>
          ) : null}
        </>
      )}

      {props.confirmAction ? (
        <div className="note" style={{ marginTop: 16 }}>
          <div>
            Application is asking to perform <b>{props.confirmAction.label}</b>.
          </div>
          <div className="muted">The Shell routes confirmation. The application owns execution.</div>
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="btn primary" type="button" onClick={props.onConfirm}>
              Continue
            </button>
            <button className="btn" type="button" onClick={props.onCancelConfirm}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SessionSurface(props: {
  current: {
    label: string;
    state: string;
    activeAppName?: string;
    contextType?: string;
    contextTitle?: string;
    workflow: string[];
  } | null;
  sessions: Array<{ sessionId: string; label: string; state: string; active?: boolean }>;
  pinnedLabel?: string | null;
  onCreate: () => void;
  onSwitch: (sessionId: string) => void;
  onEnd: () => void;
  onResumeApp?: () => void;
  onPin?: () => void;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Current Session</div>
      {props.current ? (
        <>
          <h1>{props.current.label}</h1>
          <p>Operating context for this workflow. The Shell remembers your place — not application databases.</p>
          <div className="note">
            <div>
              Active: <b>{props.current.activeAppName ?? "None"}</b>
            </div>
            {props.current.contextType ? (
              <div>
                Context: {props.current.contextTitle ?? "Item"} · {props.current.contextType}
              </div>
            ) : (
              <div>Context: none</div>
            )}
            {props.pinnedLabel ? <div>Pinned context: {props.pinnedLabel}</div> : null}
            <div>State: {props.current.state}</div>
            {props.current.workflow.length ? (
              <div>
                Workflow: {props.current.workflow.join(" → ")}
              </div>
            ) : null}
          </div>
          <div className="actions">
            {props.onResumeApp ? (
              <button className="btn primary" type="button" onClick={props.onResumeApp}>
                Resume
              </button>
            ) : null}
            {props.onPin ? (
              <button className="btn" type="button" onClick={props.onPin}>
                Pin context
              </button>
            ) : null}
            <button className="btn" type="button" onClick={props.onEnd}>
              End Session
            </button>
          </div>
        </>
      ) : (
        <>
          <h1>No active session</h1>
          <p>Create a lightweight workflow context when you move between applications.</p>
          <button className="btn primary" type="button" onClick={props.onCreate}>
            Create Session
          </button>
        </>
      )}

      <h2>Switch Session</h2>
      <div className="list">
        {props.sessions.length === 0 ? <p className="empty">No sessions yet.</p> : null}
        {props.sessions.map((item) => (
          <button key={item.sessionId} type="button" onClick={() => props.onSwitch(item.sessionId)}>
            <div>
              {item.label}
              {item.active ? " · active" : ""}
            </div>
            <div className="muted">{item.state}</div>
          </button>
        ))}
      </div>
      {props.current ? (
        <div className="actions" style={{ marginTop: 12 }}>
          <button className="btn" type="button" onClick={props.onCreate}>
            New Session
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ResumeChooserSurface(props: {
  appName: string;
  resumeLabel: string;
  onResume: () => void;
  onFresh: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="panel">
      <div className="eyebrow">Resume</div>
      <h1>{props.appName}</h1>
      <p>Open, resume a prior place in this session, or start fresh. The Shell does not invent application state.</p>
      <div className="note">Resume: {props.resumeLabel}</div>
      <div className="actions">
        <button className="btn primary" type="button" onClick={props.onResume}>
          Resume
        </button>
        <button className="btn" type="button" onClick={props.onFresh}>
          Start Fresh
        </button>
        <button className="btn" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function IntentChooserSurface(props: {
  intent: string;
  contextType: string;
  sourceName: string;
  handlers: OSShellIntentHandlerDescriptor[];
  onSelect: (appId: string, remember: boolean) => void;
  onCancel: () => void;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <div className="panel">
      <div className="eyebrow">Intent</div>
      <h1>Open with</h1>
      <p>
        {props.sourceName} wants to <strong>{props.intent}</strong> a <strong>{props.contextType}</strong> reference.
        Choose a handler. This does not grant permissions or transfer credentials.
      </p>
      <div className="list">
        {props.handlers.map((handler) => (
          <button key={handler.appId} type="button" onClick={() => props.onSelect(handler.appId, remember)}>
            <div>{handler.name}</div>
            <div className="muted">
              {handler.source} · {handler.trustState} · {handler.origin}
            </div>
          </button>
        ))}
      </div>
      <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        Remember as default for {props.intent}:{props.contextType} (revocable, not a permission)
      </label>
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DevicesPane(props: { onLaunch: () => void }) {
  return (
    <div className="panel">
      <div className="eyebrow">Devices</div>
      <h1>device_bridge_unavailable</h1>
      <p>
        Pairing a phone is a Production Session concern. The path is OS Shell → mybrandOS → Production Session → Device
        Bridge → Phone. Production stays in mybrandOS.
      </p>
      <div className="note">The Shell does not create a Device Bridge, device token, capture backend, or Production Session.</div>
      <button className="btn primary" type="button" onClick={props.onLaunch}>
        Open mybrandOS
      </button>
    </div>
  );
}

export function AppFallback(props: {
  session: ShellSession;
  error: string | null;
  capabilityRows: CapabilityStatusRow[];
  onOpenContext: () => void;
}) {
  const { session } = props;
  return (
    <div className="panel">
      <h1>{session.identity.name}</h1>
      <p>{session.decision.detail}</p>
      {session.runtimeState ? <div className="note">{session.runtimeState}</div> : null}
      {session.identity.nativeUnverified ? (
        <div className="note warn">native_unverified. A manifest cannot make an unknown origin Digiconomy-native.</div>
      ) : null}
      {session.embed === "frame_blocked" ? (
        <div className="note blocked">
          frame_blocked. The site refused to be framed. The Shell will not bypass X-Frame-Options or CSP.
        </div>
      ) : null}
      {session.newContextBlocked ? (
        <div className="note blocked">new_context_blocked. The browser blocked the new browsing context.</div>
      ) : null}
      {session.newContextOpened ? (
        <div className="note">Opened in a new browsing context. No capabilities were granted for that reason.</div>
      ) : null}
      {session.manifestError ? <div className="note warn">{session.manifestError}</div> : null}
      {props.error ? <div className="note blocked">{props.error}</div> : null}
      <div className="actions">
        <button className="btn primary" type="button" onClick={props.onOpenContext}>
          Open as page
        </button>
      </div>
      <h2>Capabilities</h2>
      <CapabilityPanel rows={props.capabilityRows} />
    </div>
  );
}

export function FrameHost(props: {
  sessions: ShellSession[];
  activeOrigin: string | null;
  visible: boolean;
  onFrameRef: (origin: string, node: HTMLIFrameElement | null) => void;
  onFrameLoad: (origin: string) => void;
  onFrameError: (origin: string) => void;
}) {
  const embeds = props.sessions.filter((item) => item.decision.mode === "embed" && item.embed !== "frame_blocked");
  return (
    <div className={props.visible ? "frame-host" : "frame-host hidden"} aria-hidden={!props.visible}>
      {embeds.map((session) => (
        <div
          className={session.origin === props.activeOrigin && props.visible ? "frame-slot active" : "frame-slot"}
          key={session.origin}
        >
          <iframe
            ref={(node) => props.onFrameRef(session.origin, node)}
            title={session.title || session.identity.name}
            src={session.href}
            onLoad={() => props.onFrameLoad(session.origin)}
            onError={() => props.onFrameError(session.origin)}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ))}
    </div>
  );
}
