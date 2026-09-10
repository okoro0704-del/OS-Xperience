import { useEffect, useMemo, useRef, useState } from "react";
import { getOSShellContext, type OSShellContext, type ShellCapabilityResult } from "@osshell/sdk";
import type {
  OSShellCapabilityDescriptor,
  OSShellIntentHandlerDescriptor,
  ShellDeveloperDiagnostics,
  ShellError,
} from "@osshell/contract";

function isError(value: unknown): value is ShellError {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}

/**
 * External developer demo. Uses only the public OS Shell contract.
 * Does not import Trust ID, FundzMan, DataZone, mybrandOS, or LifeOS internals.
 */
export function App() {
  const [incomingIntent, setIncomingIntent] = useState<string>("none");
  const [note, setNote] = useState("A normal web app that can also participate in OS Shell.");
  const noteRef = useRef(note);
  noteRef.current = note;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const shell = useMemo(
    () =>
      getOSShellContext({
        getTitle: () => document.title || "Shell Demo Notes",
        getPath: () => `${location.pathname}${location.search}`,
        canGoBack: () => window.history.length > 1,
        onBack: () => window.history.back(),
        onIntent: (delivery) => {
          if (delivery.context.type === "text" && delivery.context.text) {
            setNote(delivery.context.text);
          } else if (delivery.context.title) {
            setNote(delivery.context.title);
          }
          setIncomingIntent(
            `${delivery.intent} from ${delivery.sourceAppId} · ${delivery.context.type}${
              delivery.sessionId ? ` · session` : ""
            }`,
          );
        },
        onResume: (delivery) => {
          setIncomingIntent(`resume · ${delivery.label}`);
          if (delivery.context?.type === "text" && delivery.context.text) setNote(delivery.context.text);
          else if (delivery.context?.title) setNote(delivery.context.title);
        },
        onSearchProviderQuery: ({ query, limit }) => {
          const q = query.trim().toLowerCase();
          const catalog = [
            { title: "Meeting Notes", text: noteRef.current.slice(0, 200) || "Meeting notes sample" },
            { title: "Example Article", text: "Article draft sample" },
            { title: "Launch Checklist", text: "Checklist for launch day" },
          ];
          return catalog
            .filter((item) => !q || item.title.toLowerCase().includes(q) || item.text.toLowerCase().includes(q))
            .slice(0, limit ?? 12)
            .map((item) => ({
              type: "object",
              title: item.title,
              subtitle: "text · Shell Demo Notes",
              appId: "shell-demo-notes",
              context: {
                type: "text" as const,
                title: item.title,
                text: item.text,
                originAppId: "shell-demo-notes",
                lifetime: "EPHEMERAL" as const,
              },
            }));
        },
      }),
    [],
  );

  const [lifecycle, setLifecycle] = useState("unknown");
  const [capabilities, setCapabilities] = useState<OSShellCapabilityDescriptor[]>([]);
  const [handlers, setHandlers] = useState<OSShellIntentHandlerDescriptor[]>([]);
  const [policy, setPolicy] = useState("not requested");
  const [browserResult, setBrowserResult] = useState("not started");
  const [intentResult, setIntentResult] = useState("not requested");
  const [sessionStatus, setSessionStatus] = useState("none");
  const [diagnostics, setDiagnostics] = useState<ShellDeveloperDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    shell.ready({ name: "Shell Demo Notes" });
    shell.navigation();
    void refreshDiscovery(shell);
    return () => {
      stopCamera();
      shell.detach();
    };
  }, [shell]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        setLifecycle("BACKGROUND");
        stopCamera();
        setBrowserResult((current) => (current === "success" ? "released (background)" : current));
      } else {
        setLifecycle(shell.isAvailable ? "ACTIVE" : "standalone");
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    setLifecycle(shell.isAvailable ? "ACTIVE" : "standalone");
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [shell]);

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function refreshDiscovery(client: OSShellContext = shell) {
    const listed = await client.capabilities.list();
    if (isError(listed)) {
      setCapabilities([]);
      return;
    }
    setCapabilities(listed);
    const found = await client.intents.discover({ intent: "view", contextType: "text" });
    if (!isError(found)) setHandlers(found);
    const diag = await client.getDiagnostics();
    if (!isError(diag)) setDiagnostics(diag);
  }

  async function shareNote() {
    setBusy(true);
    try {
      const context = shell.context.create({
        type: "text",
        title: "Shell Demo Notes",
        text: note.slice(0, 500),
        lifetime: "EPHEMERAL",
      });
      if (!context.ok) {
        setIntentResult(context.code);
        return;
      }
      const current = await shell.session.current();
      const sessionId =
        !isError(current) && "ok" in current && current.ok ? current.session?.sessionId : undefined;
      const result = await shell.intents.request({
        intent: "share",
        context: context.context,
        sessionId,
      });
      if (isError(result)) {
        setIntentResult(result.code);
        return;
      }
      if ("ok" in result && result.ok) {
        setIntentResult(`routed → ${result.targetAppId}`);
      } else if ("ok" in result) {
        setIntentResult(result.code);
      }
    } finally {
      setBusy(false);
      await refreshDiscovery();
    }
  }

  async function joinSession() {
    const created = await shell.session.create({ label: "Demo Notes workflow" });
    if (isError(created)) {
      setSessionStatus(created.code);
      return;
    }
    if ("ok" in created && created.ok) {
      setSessionStatus(created.session?.label ?? created.session?.sessionId ?? "joined");
    } else if ("ok" in created) {
      setSessionStatus(created.code);
    }
  }

  async function requestCamera() {
    setBusy(true);
    stopCamera();
    try {
      const result = await shell.capabilities.request("camera");
      if (isError(result)) {
        setPolicy(result.code);
        setBrowserResult("not_authorized");
        return;
      }
      const outcome = result as ShellCapabilityResult;
      setPolicy(`${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`);
      if (outcome.status !== "granted") {
        setBrowserResult("not_authorized");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setBrowserResult("success");
        shell.reportExecution("camera", true, "success");
      } catch (error) {
        const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "camera_unavailable";
        setBrowserResult(name);
        shell.reportExecution("camera", true, name);
      }
    } finally {
      setBusy(false);
      await refreshDiscovery();
    }
  }

  return (
    <main className="page">
      <div className="eyebrow">External application</div>
      <h1>Shell Demo Notes</h1>
      <p className="muted">
        Built only against the public OS Shell contract. No Digiconomy internals required.
      </p>
      <span className="chip">{shell.isAvailable ? `Shell · ${shell.shellOrigin}` : "Standalone browser"}</span>
      <span className="chip" style={{ marginLeft: 8 }}>
        Lifecycle · {lifecycle}
      </span>

      <section className="panel">
        <h2>Notes</h2>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          style={{ width: "100%", borderRadius: 8, border: "1px solid #d9d2c3", padding: 8 }}
        />
        <p className="muted">This page works outside Shell. Inside Shell it can request capabilities and share text intents.</p>
        <button className="btn" type="button" disabled={busy || !shell.isAvailable} onClick={() => void shareNote()}>
          Share / view intent
        </button>
        <button className="btn" type="button" disabled={!shell.isAvailable} onClick={() => void joinSession()} style={{ marginLeft: 8 }}>
          Join session
        </button>
        <div className="muted" style={{ marginTop: 8 }}>
          Intent result: {intentResult}
        </div>
        <div className="muted">Incoming intent: {incomingIntent}</div>
        <div className="muted">Session: {sessionStatus}</div>
      </section>

      <section className="panel">
        <h2>Intent handlers (discovery)</h2>
        {!shell.isAvailable ? <p className="muted">shell_unavailable — discovery requires OS Shell.</p> : null}
        <div className="grid" style={{ marginTop: 10 }}>
          {handlers.map((item) => (
            <div key={item.appId}>
              <strong>{item.name}</strong>
              <div className="muted">
                {item.source} · {item.trustState}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Capability discovery</h2>
        <button className="btn ghost" type="button" onClick={() => void refreshDiscovery()}>
          Refresh
        </button>
        {!shell.isAvailable ? <p className="muted">shell_unavailable — discovery requires OS Shell.</p> : null}
        <div className="grid" style={{ marginTop: 10 }}>
          {capabilities.map((item) => (
            <div key={item.id}>
              <strong>{item.id}</strong>
              <div className="muted">{item.status}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Camera capability</h2>
        <p className="muted">Shell mediates permission. This app owns getUserMedia and the MediaStream.</p>
        <button className="btn" type="button" disabled={busy || !shell.isAvailable} onClick={() => void requestCamera()}>
          Request Camera
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            stopCamera();
            setBrowserResult("released");
          }}
        >
          Stop camera
        </button>
        <div className="grid" style={{ marginTop: 10 }}>
          <div>
            <div className="eyebrow">Shell permission</div>
            <strong>{policy}</strong>
          </div>
          <div>
            <div className="eyebrow">Browser result</div>
            <strong>{browserResult}</strong>
          </div>
        </div>
        <video ref={videoRef} playsInline muted />
      </section>

      <section className="panel">
        <h2>Developer diagnostics</h2>
        <pre>{JSON.stringify(diagnostics ?? { shell_unavailable: !shell.isAvailable }, null, 2)}</pre>
      </section>
    </main>
  );
}
