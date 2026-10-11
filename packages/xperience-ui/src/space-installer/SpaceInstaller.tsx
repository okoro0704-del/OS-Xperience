import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  SpacePackageError,
  appendJournal,
  type BrowserSpaceRuntime,
  type ContentIndexItem,
  type InstallationHealth,
  type OpenedSpace,
  type PackageAssessment,
  type PackagePermission,
  type RollbackResult,
  type SpaceRecord,
  type UpdateTransaction,
  type LocalState,
} from "@digiconomy/space-package";
import { EXPERIENCE_ESCAPE_EVENT } from "../experience-escape.js";

/**
 * SP3 Space installer and lifecycle manager — nine screens over the SP1 verifier and the SP2
 * lifecycle engine. A `.space` file carries an experience, never its owner's authority: installing
 * grants no owner, no grants, no sign-in; trust comes only from keys this device already holds.
 */
export type InstallerView = "import" | "inspect" | "trust" | "install" | "installed" | "update" | "history" | "rollback" | "recovery";

export interface InstallerRequest {
  view: InstallerView;
  file?: { name: string; bytes: Uint8Array };
  packageId?: string;
  nonce: number;
}

const TITLES: Record<InstallerView, string> = {
  import: "Import a Space",
  inspect: "Inspect",
  trust: "Trust decision",
  install: "Install",
  installed: "Installed Space",
  update: "Update",
  history: "History",
  rollback: "Rollback",
  recovery: "Recovery",
};

const MESSAGES: Partial<Record<string, string>> = {
  NOT_A_SPACE_PACKAGE: "This file is not a Space package.",
  UNSUPPORTED_FORMAT: "This file is not a Space package or a Space Launch File.",
  AMBIGUOUS_FORMAT: "This file could be read in more than one way, so it was refused.",
  ARCHIVE_TOO_LARGE: "This file is larger than a Space package may be.",
  DECOMPRESSION_BOMB: "This package expands far beyond its size, so it was refused.",
  PUBLISHER_UNKNOWN: "This publisher is not trusted on this device. Unknown publishers are never trusted automatically.",
  KEY_REVOKED: "The signing key has been revoked. Nothing it signed is accepted.",
  STORAGE_QUOTA_EXCEEDED: "This device has no room left for this Space. Nothing was installed.",
  LIFECYCLE_BUSY: "Another tab is changing installed Spaces. Try again in a moment.",
  UNSUPPORTED_PLATFORM: "This browser cannot verify or install Spaces safely.",
  PERMISSION_ESCALATION: "This update asks for new permissions. Approve them explicitly to continue.",
  FRESH_REVOCATION_REQUIRED: "This update needs up-to-date revocation information that this device does not have.",
};

function describe(error: unknown): { code: string; text: string } {
  if (error instanceof SpacePackageError) return { code: error.code, text: `${MESSAGES[error.code] ?? error.code}${error.detail ? ` (${error.detail})` : ""}` };
  return { code: "ERROR", text: error instanceof Error ? error.message : String(error) };
}

async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/* ───────────── declarative immersive renderer ───────────── */

/**
 * Renders only validated content-index items: images, audio, video and plain text. Media is shown
 * through blob: URLs whose type comes from the verified manifest; text is shown as text. Nothing is
 * framed, injected or executed, and every object URL is revoked when the renderer closes.
 */
function PackageRenderer({ runtime, packageId, online, onClose, onEscape }: { runtime: BrowserSpaceRuntime; packageId: string; online: boolean; onClose: () => void; onEscape: () => void }) {
  const [opened, setOpened] = useState<OpenedSpace | null>(null);
  const [items, setItems] = useState<Array<ContentIndexItem & { url?: string; text?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await runtime.open(packageId, online);
        if (cancelled) return;
        setOpened(result);
        const record = await runtime.lifecycle.record(packageId);
        const assets = new Map(record.active.manifest.assets.map((asset) => [asset.path, asset]));
        const rendered = [];
        for (const item of result.experience.content?.items ?? []) {
          const asset = assets.get(item.asset);
          if (!asset) continue;
          const bytes = await runtime.lifecycle.readAsset(packageId, item.asset);
          if (item.kind === "text") {
            rendered.push({ ...item, text: new TextDecoder().decode(bytes) });
          } else {
            const url = URL.createObjectURL(new Blob([bytes.slice() as BlobPart], { type: asset.mediaType }));
            urls.current.push(url);
            rendered.push({ ...item, url });
          }
        }
        if (!cancelled) setItems(rendered);
      } catch (cause) {
        if (!cancelled) setError(describe(cause).text);
      }
    })();
    return () => {
      cancelled = true;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    };
  }, [runtime, packageId, online]);

  useEffect(() => {
    window.addEventListener(EXPERIENCE_ESCAPE_EVENT, onEscape);
    return () => window.removeEventListener(EXPERIENCE_ESCAPE_EVENT, onEscape);
  }, [onEscape]);

  return (
    <section className="ox-package-renderer" data-testid="package-renderer" data-package-id={packageId} data-state={opened?.experience.state ?? (error ? "FAILED" : "OPENING")}>
      <header>
        <h2>{opened ? opened.definition.experiences.find((item) => item.id === opened.experience.id)?.title : "Opening…"}</h2>
        <button type="button" className="ox-button secondary compact" data-testid="package-renderer-close" onClick={onClose}>Close</button>
      </header>
      {error ? <p className="ox-restore-notice" role="alert" data-testid="package-renderer-error">{error}</p> : null}
      {opened?.experience.state === "BLOCKED" ? <p className="ox-restore-notice" role="status">This experience needs a capability that is not available here.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id} data-testid={`package-item-${item.id}`} data-kind={item.kind}>
            <strong>{item.title}</strong>
            {item.kind === "image" ? <img src={item.url} alt={item.title} data-testid={`package-image-${item.id}`} /> : null}
            {item.kind === "audio" ? <audio src={item.url} controls data-testid={`package-audio-${item.id}`} /> : null}
            {item.kind === "video" ? <video src={item.url} controls playsInline data-testid={`package-video-${item.id}`} /> : null}
            {item.kind === "text" ? <p data-testid={`package-text-${item.id}`}>{item.text}</p> : null}
          </li>
        ))}
      </ul>
      {opened ? <p className="ox-package-renderer-note">This Space runs from this device. It carries no owner or authority: {opened.permissions.granted.join(", ") || "no permissions"} granted.</p> : null}
    </section>
  );
}

/* ───────────── shared bits ───────────── */

function CheckRow({ label, testId, check }: { label: string; testId: string; check: { status: string; summary: string; code?: string } }) {
  return (
    <li className={`ox-check is-${check.status.toLowerCase()}`} data-testid={`check-${testId}`} data-status={check.status} data-code={check.code ?? ""}>
      <span className="ox-check-label">{label}</span>
      <span className="ox-check-status">{check.status.replace("_", " ")}</span>
      <p>{check.summary}</p>
    </li>
  );
}

function DropZone({ onFiles, testId, label, multiple = false }: { onFiles: (files: File[]) => void; testId: string; label: string; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const files = [...event.dataTransfer.files];
    if (files.length) onFiles(files);
  };
  return (
    <div
      className={`ox-dropzone${over ? " is-over" : ""}`}
      data-testid={testId}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <p>{label}</p>
      <input ref={input} type="file" hidden multiple={multiple} data-testid={`${testId}-input`} onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; if (files.length) onFiles(files); }} />
      <button type="button" className="ox-button secondary" onClick={() => input.current?.click()}>Choose file{multiple ? "s" : ""}</button>
    </div>
  );
}

/* ───────────── the installer ───────────── */

export function SpaceInstaller(props: {
  runtime: BrowserSpaceRuntime | null;
  runtimeError: string | null;
  request: InstallerRequest;
  online: boolean;
  onClose: () => void;
  onLaunchFile: (bytes: Uint8Array) => void;
  onEscapeHome: () => void;
  registerBack: (handler: (() => boolean) | null) => void;
  /** A rendered package is an experience: the host's two-finger escape must reach it (Android checks this). */
  onRenderingChange?: (rendering: boolean) => void;
}) {
  const { runtime, request, online } = props;
  const [stack, setStack] = useState<InstallerView[]>([request.view]);
  const view = stack[stack.length - 1]!;
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(request.file ?? null);
  const [assessment, setAssessment] = useState<PackageAssessment | null>(null);
  const [packageId, setPackageId] = useState<string | null>(request.packageId ?? null);
  const [record, setRecord] = useState<SpaceRecord | null>(null);
  const [state, setState] = useState<LocalState | null>(null);
  const [health, setHealth] = useState<InstallationHealth | null>(null);
  const [history, setHistory] = useState<UpdateTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ code: string; text: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [installResult, setInstallResult] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ doc: Uint8Array; pkg: Uint8Array; names: string[] } | null>(null);
  const [updateCheck, setUpdateCheck] = useState<Awaited<ReturnType<BrowserSpaceRuntime["inspectUpdate"]>> | null>(null);
  const [approved, setApproved] = useState<PackagePermission[]>([]);
  const [tx, setTx] = useState<UpdateTransaction | null>(null);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);
  const [recovery, setRecovery] = useState<{ recovered: Array<{ txId: string; from: string; to: string }>; discardedStaging: number } | null>(null);
  const [revision, setRevision] = useState(0);

  const go = useCallback((next: InstallerView, options: { replace?: boolean } = {}) => {
    setNotice(null);
    setStack((items) => (options.replace ? [...items.slice(0, -1), next] : [...items, next]));
  }, []);

  // Android Back / the shell back control walk the installer's own screens first.
  useEffect(() => {
    props.registerBack(() => {
      if (rendering) { setRendering(false); return true; }
      if (stack.length > 1) { setStack((items) => items.slice(0, -1)); setNotice(null); return true; }
      return false;
    });
    return () => props.registerBack(null);
  }, [props.registerBack, rendering, stack.length]);

  useEffect(() => runtime?.onChange(() => setRevision((value) => value + 1)), [runtime]);

  useEffect(() => {
    props.onRenderingChange?.(rendering);
    return () => props.onRenderingChange?.(false);
  }, [rendering, props.onRenderingChange]);

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setNotice(null);
    try {
      return await work();
    } catch (error) {
      setNotice(describe(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  /* load the selected installation whenever it (or another tab) changes */
  useEffect(() => {
    if (!runtime || !packageId || !["installed", "update", "history", "rollback", "recovery"].includes(view)) return;
    let cancelled = false;
    void (async () => {
      try {
        const [nextRecord, nextHealth, nextHistory] = await Promise.all([runtime.lifecycle.record(packageId), runtime.health(packageId), runtime.lifecycle.history(packageId)]);
        const nextState = nextHealth.status === "MISSING_STATE" ? null : await runtime.lifecycle.readState(packageId).catch(() => null);
        if (cancelled) return;
        setRecord(nextRecord); setHealth(nextHealth); setHistory(nextHistory); setState(nextState);
      } catch (error) {
        if (!cancelled) setNotice(describe(error));
      }
    })();
    return () => { cancelled = true; };
  }, [runtime, packageId, view, revision]);

  /* identify a chosen file by its content */
  const accept = useCallback(async (files: File[]) => {
    if (!runtime) return;
    const chosen = files[0]!;
    const bytes = await fileBytes(chosen);
    await run(async () => {
      const kind = runtime.detect(bytes);
      if (kind === "LAUNCH_FILE") { props.onLaunchFile(bytes); return; }
      setFile({ name: chosen.name, bytes });
      setAssessment(null);
      go("inspect");
    });
  }, [runtime, run, go, props.onLaunchFile]);

  /* an incoming request (picker, drop, share) */
  useEffect(() => {
    if (request.file && runtime) {
      try {
        const kind = runtime.detect(request.file.bytes);
        if (kind === "LAUNCH_FILE") { props.onLaunchFile(request.file.bytes); return; }
        setFile(request.file);
        setAssessment(null);
        setStack(["import", "inspect"]);
      } catch (error) {
        setStack(["import"]);
        setNotice(describe(error));
      }
    }
  }, [request.nonce, runtime]);

  useEffect(() => {
    if (view !== "trust" || !runtime || !file || assessment) return;
    void run(async () => setAssessment(await runtime.assess(file.bytes)));
  }, [view, runtime, file, assessment, run]);

  const shell = (title: string, body: ReactNode) => (
    <div className="ox-screen ox-space-installer" data-testid="space-installer" data-view={view}>
      <header className="ox-installer-header">
        <button className="ox-icon-button" type="button" aria-label="Go back" data-testid="installer-back" onClick={() => { if (stack.length > 1) setStack((items) => items.slice(0, -1)); else props.onClose(); }}>‹</button>
        <div><small>SPACE · {view.toUpperCase()}</small><h1 data-testid="installer-title">{title}</h1></div>
      </header>
      {!runtime ? <p className="ox-restore-notice" role="alert" data-testid="installer-unavailable">{props.runtimeError ?? "Preparing…"}</p> : null}
      {runtime && !runtime.support.canVerify ? (
        <div className="ox-restore-notice" role="alert" data-testid="installer-unsupported">
          <p>This browser cannot verify Space packages, so none can be installed here. Missing: {runtime.support.missing.join("; ")}.</p>
          <p>Verification is never weakened to work around this. Use an up-to-date browser.</p>
        </div>
      ) : runtime && !runtime.canMutate ? (
        <p className="ox-restore-notice" role="status" data-testid="installer-readonly">Read only: this browser cannot coordinate changes between tabs ({runtime.support.missing.join("; ")}), so installing and updating are disabled.</p>
      ) : null}
      {busy ? <p className="ox-status" role="status" data-testid="installer-busy">Working…</p> : null}
      {notice ? <p className="ox-restore-notice" role="alert" data-testid="installer-notice" data-code={notice.code}>{notice.text}</p> : null}
      {body}
      {rendering && runtime && packageId ? (
        <PackageRenderer runtime={runtime} packageId={packageId} online={online} onClose={() => setRendering(false)} onEscape={() => { setRendering(false); props.onEscapeHome(); }} />
      ) : null}
    </div>
  );

  const manifest = assessment?.manifest ?? null;

  switch (view) {
    case "import":
      return shell(TITLES.import, <>
        <p className="ox-empty-copy">A Space package is verified on this device before anything is installed. It never brings its publisher's account, ownership or authority.</p>
        <DropZone testId="package-drop" label="Drop a .space file here" onFiles={(files) => void accept(files)} />
        <p className="ox-empty-copy" data-testid="share-intake-note">You can also share a .space file to OS Xperience from another app where your browser supports it.</p>
      </>);

    case "inspect":
      return shell(TITLES.inspect, file ? <InspectView file={file} runtime={runtime} onContinue={() => go("trust")} /> : <p className="ox-empty-copy">No file chosen.</p>);

    case "trust":
      return shell(TITLES.trust, <>
        {!assessment ? <p className="ox-status" role="status">Verifying on this device…</p> : <>
          {manifest ? <p data-testid="trust-package"><strong>{manifest.package.name}</strong> {manifest.package.version} · {manifest.package.id}</p> : null}
          <ul className="ox-checks" data-testid="trust-checks">
            <CheckRow label="Package integrity" testId="integrity" check={assessment.checks.integrity} />
            <CheckRow label="Signature" testId="signature" check={assessment.checks.signature} />
            <CheckRow label="Publisher trust" testId="publisher" check={assessment.checks.publisher} />
            <CheckRow label="Revocation" testId="revocation" check={assessment.checks.revocation} />
            <CheckRow label="Permissions" testId="permissions" check={assessment.checks.permissions} />
            <CheckRow label="Compatibility" testId="compatibility" check={assessment.checks.compatibility} />
            <CheckRow label="Installation" testId="eligibility" check={assessment.checks.eligibility} />
          </ul>
          {assessment.checks.structure.status === "FAIL" ? <CheckRow label="Package" testId="structure" check={assessment.checks.structure} /> : null}
          <div className="ox-card-actions">
            <button type="button" className="ox-button primary" data-testid="trust-install" disabled={!assessment.eligible || busy || !runtime?.canMutate} onClick={() => go("install")}>Install</button>
            <button type="button" className="ox-button ghost" data-testid="trust-cancel" onClick={props.onClose}>Don't install</button>
          </div>
          <TrustStatementIntake runtime={runtime} run={run} onApplied={() => setAssessment(null)} />
        </>}
      </>);

    case "install":
      return shell(TITLES.install, <>
        {installResult ? <p className="ox-space-ready" data-testid="install-result" data-status={installResult}>{installResult === "INSTALLED" ? "Installed. It has its own installation and state, and no owner or authority." : "This exact package was already installed."}</p> : (
          <>
            <p className="ox-empty-copy">Installing {manifest?.package.name} {manifest?.package.version}. It will be verified again as it is installed.</p>
            <button type="button" className="ox-button primary" data-testid="install-confirm" disabled={busy || !file || !runtime} onClick={() => void run(async () => {
              const result = await runtime!.install(file!.bytes);
              setInstallResult(result.status);
              setPackageId(result.record.packageId);
            })}>Install now</button>
          </>
        )}
        {installResult ? <button type="button" className="ox-button primary" data-testid="install-continue" onClick={() => setStack(["installed"])}>Open the installed Space</button> : null}
      </>);

    case "installed":
      return shell(TITLES.installed, record ? <>
        <div className="ox-installed" data-testid="installed-space" data-package-id={record.packageId} data-version={record.active.version} data-installation-id={record.installationId} data-health={health?.status ?? ""}>
          <h2>{record.active.manifest.package.name}</h2>
          <dl>
            <dt>Version</dt><dd data-testid="installed-version">{record.active.version}{record.previous ? ` (previous ${record.previous.version} kept)` : ""}</dd>
            <dt>Installation</dt><dd data-testid="installed-id">{record.installationId}</dd>
            <dt>Publisher</dt><dd>{record.active.publisherId} · key {record.active.keyId}</dd>
            <dt>Authority</dt><dd data-testid="installed-authority">None — installing confers no owner and no grants.</dd>
            <dt>Permissions</dt><dd>{record.active.manifest.permissions.join(", ")}</dd>
            <dt>Status</dt><dd data-testid="installed-status">{health?.status === "HEALTHY" ? "Ready on this device" : health?.reason ?? "Checking…"}</dd>
          </dl>
          <div className="ox-card-actions">
            <button type="button" className="ox-button primary" data-testid="installed-open" disabled={health?.status !== "HEALTHY"} onClick={() => setRendering(true)}>Open</button>
            <button type="button" className="ox-button secondary" data-testid="installed-update" onClick={() => { setUpdate(null); setUpdateCheck(null); setApproved([]); setTx(null); go("update"); }}>Update</button>
            <button type="button" className="ox-button secondary" data-testid="installed-history" onClick={() => go("history")}>History</button>
            <button type="button" className="ox-button secondary" data-testid="installed-rollback" disabled={!record.previous} onClick={() => go("rollback")}>Rollback</button>
            <button type="button" className={`ox-button ${health?.status === "HEALTHY" ? "ghost" : "primary"}`} data-testid="installed-recovery" onClick={() => go("recovery")}>Recovery</button>
          </div>
        </div>
        {state ? <LocalStateView state={state} runtime={runtime} packageId={record.packageId} run={run} /> : null}
      </> : <p className="ox-status">Loading…</p>);

    case "update":
      return shell(TITLES.update, <>
        {tx?.state === "ACTIVE" ? <p className="ox-space-ready" data-testid="update-result" data-state="ACTIVE">Updated to {tx.to.version}. The installation and its local state were kept.</p> : <>
          <p className="ox-empty-copy">An update is a signed update document and the new package. Both are verified on this device before anything changes.</p>
          <DropZone testId="update-drop" multiple label="Drop the update document (.json) and the new package (.space)" onFiles={(files) => void run(async () => {
            let doc: Uint8Array | null = null; let pkg: Uint8Array | null = null;
            for (const item of files) { const bytes = await fileBytes(item); if (runtime!.detect(bytes) === "PACKAGE") pkg = bytes; else doc = bytes; }
            if (!doc || !pkg) throw new SpacePackageError("UNSUPPORTED_FORMAT", "an update needs its signed document and the new package");
            setUpdate({ doc, pkg, names: files.map((item) => item.name) }); setTx(null); setApproved([]);
            setUpdateCheck(await runtime!.inspectUpdate(doc, pkg, []));
          })} />
          {updateCheck ? <UpdateCheckView check={updateCheck} approved={approved} setApproved={setApproved} /> : null}
          {update ? (
            <div className="ox-card-actions">
              <button type="button" className="ox-button primary" data-testid="update-apply" disabled={busy || !runtime?.canMutate} onClick={() => void run(async () => {
                const staged = await runtime!.stageUpdate(update.doc, update.pkg);
                setTx(staged);
                const verified = await runtime!.verifyUpdate(staged.packageId, staged.txId, approved);
                setTx(verified);
                const active = await runtime!.activateUpdate(staged.packageId, staged.txId);
                setTx(active);
              })}>Verify and update</button>
            </div>
          ) : null}
          {tx ? <p className="ox-status" data-testid="update-state" data-state={tx.state}>{tx.state}{tx.reason ? ` — ${tx.reason}` : ""}</p> : null}
        </>}
      </>);

    case "history":
      return shell(TITLES.history, <ol className="ox-history" data-testid="history-list">
        {history.length ? [...history].reverse().map((item) => (
          <li key={item.txId} data-testid="history-item" data-state={item.state} data-kind={item.kind}>
            <strong>{item.kind === "ROLLBACK" ? "Rollback" : "Update"} {item.from.version} → {item.to.version}</strong> · <span>{item.state}</span>
            <small>{item.history.map((step) => step.state).join(" → ")}</small>
            {item.reason ? <small>{item.reason}</small> : null}
          </li>
        )) : <li className="ox-empty-copy">No updates yet.</li>}
      </ol>);

    case "rollback":
      return shell(TITLES.rollback, record ? <>
        {rollbackResult ? (
          rollbackResult.status === "ROLLED_BACK"
            ? <p className="ox-space-ready" data-testid="rollback-result" data-status="ROLLED_BACK">Back on {rollbackResult.record.active.version}. Your local state was kept; consequential operations are held for you to confirm again.</p>
            : <p className="ox-restore-notice" data-testid="rollback-result" data-status="RECOVERY_REQUIRED">Recovery required: {rollbackResult.reason}. Nothing was changed or deleted.</p>
        ) : record.previous ? <>
          <p className="ox-empty-copy">Return from {record.active.version} to the last known-good release {record.previous.version}. Your current local state is kept — nothing you created is discarded, and no operation is repeated.</p>
          <button type="button" className="ox-button primary" data-testid="rollback-confirm" disabled={busy || !runtime?.canMutate} onClick={() => void run(async () => setRollbackResult(await runtime!.rollback(record.packageId, "requested from the installer", false)))}>Roll back to {record.previous.version}</button>
        </> : <p className="ox-empty-copy">There is no previous release to return to.</p>}
      </> : <p className="ox-status">Loading…</p>);

    case "recovery":
      return shell(TITLES.recovery, <>
        <p className="ox-empty-copy" data-testid="recovery-health" data-status={health?.status ?? ""}>{health ? (health.status === "HEALTHY" ? "This installation is complete and consistent." : health.reason) : "Checking…"}</p>
        {health && health.missing.length ? <p className="ox-restore-notice" data-testid="recovery-missing">Missing: {health.missing.join(", ")}. {health.status === "MISSING_STATE"
          ? "This installation's local state is gone from this device's storage and cannot be rebuilt from the package."
          : "Import the same package again to restore it; your local state is kept."}</p> : null}
        {health?.status === "MISSING_RELEASE" ? <DropZone testId="repair-drop" label="Import the same .space package to restore it" onFiles={(files) => void run(async () => {
          await runtime!.install(await fileBytes(files[0]!));
          setRevision((value) => value + 1);
        })} /> : null}
        <button type="button" className="ox-button primary" data-testid="recovery-run" disabled={busy || !runtime?.canMutate} onClick={() => void run(async () => setRecovery(await runtime!.recover()))}>Check and recover</button>
        {recovery ? <p className="ox-status" data-testid="recovery-result" data-recovered={recovery.recovered.length}>{recovery.recovered.length ? recovery.recovered.map((item) => `${item.from} → ${item.to}`).join(", ") : "Nothing needed recovery."}</p> : null}
        <ul>
          {history.filter((item) => ["STAGED", "VERIFIED", "MIGRATION_PREPARED"].includes(item.state)).map((item) => (
            <li key={item.txId}>Unfinished update to {item.to.version} ({item.state}) <button type="button" className="ox-button ghost compact" data-testid="recovery-abort" onClick={() => void run(() => runtime!.abortUpdate(item.packageId, item.txId))}>Discard</button></li>
          ))}
        </ul>
      </>);
  }
}

function InspectView({ file, runtime, onContinue }: { file: { name: string; bytes: Uint8Array }; runtime: BrowserSpaceRuntime | null; onContinue: () => void }) {
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => {
    if (!runtime) return;
    try {
      setSummary(runtime.detect(file.bytes) === "PACKAGE" ? "A portable Space package (identified by its contents)." : "A Space Launch File.");
    } catch (error) {
      setSummary(describe(error).text);
    }
  }, [runtime, file]);
  return <>
    <dl data-testid="inspect-file">
      <dt>File</dt><dd>{file.name}</dd>
      <dt>Size</dt><dd>{file.bytes.length.toLocaleString()} bytes</dd>
      <dt>Detected</dt><dd data-testid="inspect-kind">{summary ?? "…"}</dd>
    </dl>
    <p className="ox-empty-copy">Next, every part of the package is checked on this device: integrity, signature, publisher trust, revocation, permissions and compatibility.</p>
    <button type="button" className="ox-button primary" data-testid="inspect-continue" onClick={onContinue}>Check it</button>
  </>;
}

function UpdateCheckView({ check, approved, setApproved }: { check: Awaited<ReturnType<BrowserSpaceRuntime["inspectUpdate"]>>; approved: PackagePermission[]; setApproved: (value: PackagePermission[]) => void }) {
  const evidence = "evidence" in check ? (check.evidence as { addedPermissions?: PackagePermission[]; revocation?: { status: string }; signingKey?: { keyId: string; state: string }; state?: { from: number; to: number } }) : null;
  const added = evidence?.addedPermissions ?? [];
  return (
    <div className="ox-update-check" data-testid="update-check" data-acceptable={String(check.acceptable)} data-code={"code" in check ? check.code : ""}>
      <p><strong>{check.update.from.version} → {check.update.to.version}</strong> · signed by {check.update.publisher.publisherId} (key {check.update.publisher.keyId})</p>
      {check.acceptable ? <>
        <p>Signature valid against this device's trusted key. Revocation information: {evidence?.revocation?.status}.</p>
        <p>Local state data version {evidence?.state?.from} → {evidence?.state?.to}; your installation and state are kept.</p>
      </> : <p className="ox-restore-notice" data-testid="update-refused">{"code" in check ? `${MESSAGES[check.code] ?? check.code}${check.detail ? ` (${check.detail})` : ""}` : ""}</p>}
      {"code" in check && check.code === "PERMISSION_ESCALATION" ? <PermissionApproval detail={check.detail ?? ""} approved={approved} setApproved={setApproved} /> : null}
      {added.length ? <p data-testid="update-added-permissions">Newly requested: {added.join(", ")}</p> : null}
    </div>
  );
}

function PermissionApproval({ detail, approved, setApproved }: { detail: string; approved: PackagePermission[]; setApproved: (value: PackagePermission[]) => void }) {
  const requested = detail.split(",").map((item) => item.trim()).filter(Boolean) as PackagePermission[];
  return (
    <fieldset data-testid="permission-approval">
      <legend>This update requests new permissions. Approve each one explicitly, or the update will not be applied.</legend>
      {requested.map((permission) => (
        <label key={permission}>
          <input type="checkbox" data-testid={`approve-${permission}`} checked={approved.includes(permission)} onChange={(event) => setApproved(event.target.checked ? [...approved, permission] : approved.filter((item) => item !== permission))} />
          {permission}
        </label>
      ))}
    </fieldset>
  );
}

function TrustStatementIntake({ runtime, run, onApplied }: { runtime: BrowserSpaceRuntime | null; run: <T>(work: () => Promise<T>) => Promise<T | undefined>; onApplied: () => void }) {
  return (
    <details className="ox-trust-intake">
      <summary>Apply a signed key rotation or revocation list</summary>
      <p className="ox-empty-copy">Trust on this device changes only through statements signed by a key it already trusts.</p>
      <DropZone testId="trust-drop" label="Drop a signed rotation or revocation list" onFiles={(files) => void run(async () => {
        const result = await runtime!.applyTrustStatement(new Uint8Array(await files[0]!.arrayBuffer()));
        onApplied();
        return result;
      })} />
    </details>
  );
}

/** Local state the installation keeps; consequential operations held after a rollback are confirmed or cancelled here — never replayed. */
function LocalStateView({ state, runtime, packageId, run }: { state: LocalState; runtime: BrowserSpaceRuntime | null; packageId: string; run: <T>(work: () => Promise<T>) => Promise<T | undefined> }) {
  const decide = (opId: string, status: "PENDING" | "CANCELLED") => void run(() => runtime!.writeState(packageId, (current) => appendJournal({
    ...current,
    pendingOperations: current.pendingOperations.map((op) => (op.opId === opId && op.status === "HELD" ? { ...op, status } : op)),
  }, runtime!.now(), status === "PENDING" ? "OPERATION_RECONFIRMED" : "OPERATION_CANCELLED", { opId })));
  return (
    <section className="ox-local-state" data-testid="local-state" data-data-version={state.dataVersion}>
      <h3>On this device</h3>
      <p data-testid="local-state-summary">{Object.keys(state.preferences).length} preferences · {state.playlists.length} playlists · {state.userContent.length} of your items · {state.pendingOperations.length} pending operations</p>
      <ul>
        {state.pendingOperations.map((op) => (
          <li key={op.opId} data-testid={`operation-${op.opId}`} data-status={op.status}>
            {op.kind} · {op.status}
            {op.status === "HELD" ? <>
              <span> — held after a restore; it will not run unless you confirm it again.</span>
              <button type="button" className="ox-button secondary compact" data-testid={`reconfirm-${op.opId}`} onClick={() => decide(op.opId, "PENDING")}>Confirm again</button>
              <button type="button" className="ox-button ghost compact" data-testid={`cancel-${op.opId}`} onClick={() => decide(op.opId, "CANCELLED")}>Cancel</button>
            </> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
