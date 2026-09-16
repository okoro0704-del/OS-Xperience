import { useMemo, useState } from "react";
import {
  NAV_LABS_BUILD_ID,
  type ExperimentId,
  type LabsConfig,
  type TestSession,
} from "./types.js";
import {
  clearLabEvents,
  getActiveExperiment,
  getLabEvents,
  getLabsConfig,
  getTestSession,
  isLabsDiagnosticsOn,
  isNavLabsEnabled,
  resetTestSession,
  setActiveExperiment,
  setLabsDiagnosticsOn,
  setNavLabsEnabled,
  updateLabsConfig,
  updateTestSession,
} from "./labs-store.js";
import { appendLabEvent } from "./labs-log.js";

const EXPERIMENTS: Array<{ id: ExperimentId; label: string; blurb: string }> = [
  { id: "edge-pull", label: "01  Edge Pull", blurb: "Drag inward from a screen edge. Experience follows your finger." },
  { id: "two-finger-sweep", label: "02  Two-Finger Sweep", blurb: "Two fingers moving together horizontally. One finger stays with the app." },
  { id: "hold-flick", label: "03  Hold + Flick", blurb: "Brief hold to detach, then flick horizontally to leave." },
  { id: "corner-pull", label: "04  Corner Pull", blurb: "Pull from the bottom-right corner to reveal Xperience." },
  { id: "air-swipe", label: "05  Air Swipe", blurb: "Optional camera: sweep a hand horizontally across the field." },
  { id: "palm-fist-throw", label: "06  Palm → Fist → Throw", blurb: "Legacy experimental sequence. Unproven on device." },
];

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="ox-labs-score">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NavigationLabsPanel({ onBack }: { onBack: () => void }) {
  const [enabled, setEnabled] = useState(() => isNavLabsEnabled());
  const [active, setActive] = useState<ExperimentId | null>(() => getActiveExperiment());
  const [diagnostics, setDiagnostics] = useState(() => isLabsDiagnosticsOn());
  const [config, setConfig] = useState<LabsConfig>(() => getLabsConfig());
  const [session, setSession] = useState<TestSession | null>(() =>
    getActiveExperiment() ? getTestSession(getActiveExperiment()!) : null,
  );
  const [tick, setTick] = useState(0);
  const events = useMemo(() => getLabEvents().slice(-12).reverse(), [tick]);

  const refreshSession = (id: ExperimentId | null) => {
    setSession(id ? getTestSession(id) : null);
  };

  const persistEnabled = (next: boolean) => {
    setNavLabsEnabled(next);
    setEnabled(next);
    appendLabEvent({ type: "labs-toggle", experiment: active, detail: next ? "on" : "off" });
  };

  const selectExperiment = (id: ExperimentId) => {
    setActiveExperiment(id);
    setActive(id);
    refreshSession(id);
    appendLabEvent({ type: "experiment-selected", experiment: id });
  };

  const patchSession = (patch: Partial<TestSession>) => {
    if (!active) return;
    const next = updateTestSession(active, patch);
    setSession(next);
  };

  const patchTwoFinger = (key: keyof LabsConfig["twoFinger"], value: number) => {
    const next = updateLabsConfig({ twoFinger: { ...config.twoFinger, [key]: value } });
    setConfig(next);
  };

  return (
    <div className="ox-screen ox-labs" data-testid="nav-labs">
      <button className="ox-voice-close" type="button" onClick={onBack} aria-label="Back to Profile">
        ← Profile
      </button>
      <PageLabsHeader />
      <p className="ox-labs-build">{NAV_LABS_BUILD_ID}</p>

      <section className="ox-help-card">
        <label className="ox-toggle-row">
          <span>Enable Navigation Labs in ExperienceMode</span>
          <input type="checkbox" checked={enabled} onChange={(e) => persistEnabled(e.target.checked)} />
        </label>
        <label className="ox-toggle-row">
          <span>Diagnostics HUD</span>
          <input
            type="checkbox"
            checked={diagnostics}
            onChange={(e) => {
              setLabsDiagnosticsOn(e.target.checked);
              setDiagnostics(e.target.checked);
            }}
          />
        </label>
        <p className="ox-labs-note">
          Labs is for physical testing only. Every experiment calls the same exit primitive. Open a real app from My Experience after selecting an experiment.
        </p>
      </section>

      <section className="ox-labs-list">
        <small>NAVIGATION EXPERIMENTS</small>
        {EXPERIMENTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ox-labs-item${active === item.id ? " is-active" : ""}`}
            onClick={() => selectExperiment(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.blurb}</span>
          </button>
        ))}
      </section>

      {active === "two-finger-sweep" ? (
        <section className="ox-help-card">
          <small>TWO-FINGER THRESHOLDS</small>
          <label className="ox-labs-slider">
            <span>Min distance ({config.twoFinger.minDistance}px)</span>
            <input
              type="range"
              min={40}
              max={160}
              value={config.twoFinger.minDistance}
              onChange={(e) => patchTwoFinger("minDistance", Number(e.target.value))}
            />
          </label>
          <label className="ox-labs-slider">
            <span>Max vertical drift ({config.twoFinger.maxVerticalDrift})</span>
            <input
              type="range"
              min={20}
              max={90}
              value={Math.round(config.twoFinger.maxVerticalDrift * 100)}
              onChange={(e) => patchTwoFinger("maxVerticalDrift", Number(e.target.value) / 100)}
            />
          </label>
          <label className="ox-labs-slider">
            <span>Max pinch change ({config.twoFinger.maxPinchChange})</span>
            <input
              type="range"
              min={5}
              max={40}
              value={Math.round(config.twoFinger.maxPinchChange * 100)}
              onChange={(e) => patchTwoFinger("maxPinchChange", Number(e.target.value) / 100)}
            />
          </label>
        </section>
      ) : null}

      {active && session ? (
        <section className="ox-help-card" data-testid="nav-labs-session">
          <small>HUMAN TEST SESSION — {active}</small>
          <p className="ox-labs-note">Enter results yourself after 20 deliberate attempts. Software does not invent scores.</p>
          <div className="ox-labs-counters">
            <label>
              Attempts
              <input
                type="number"
                min={0}
                value={session.attempts}
                onChange={(e) => patchSession({ attempts: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              Recognized
              <input
                type="number"
                min={0}
                value={session.recognized}
                onChange={(e) => patchSession({ recognized: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              Failed
              <input
                type="number"
                min={0}
                value={session.failed}
                onChange={(e) => patchSession({ failed: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              Accidental exits
              <input
                type="number"
                min={0}
                value={session.accidentalExits}
                onChange={(e) => patchSession({ accidentalExits: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          <ScoreRow label="Effort" value={session.effort} onChange={(n) => patchSession({ effort: n })} />
          <ScoreRow label="Naturalness" value={session.naturalness} onChange={(n) => patchSession({ naturalness: n })} />
          <ScoreRow label="Memorability" value={session.memorability} onChange={(n) => patchSession({ memorability: n })} />
          <ScoreRow label="Delight" value={session.delight} onChange={(n) => patchSession({ delight: n })} />
          <label className="ox-labs-comments">
            Comments
            <textarea
              rows={3}
              value={session.comments ?? ""}
              onChange={(e) => patchSession({ comments: e.target.value })}
              placeholder="Human notes only"
            />
          </label>
          <button
            type="button"
            className="ox-button secondary"
            onClick={() => {
              resetTestSession(active);
              refreshSession(active);
            }}
          >
            Reset test
          </button>
        </section>
      ) : null}

      <section className="ox-help-card">
        <small>EVENT LOG</small>
        <button type="button" className="ox-button compact" onClick={() => setTick((n) => n + 1)}>
          Refresh
        </button>
        <button type="button" className="ox-button compact" onClick={() => { clearLabEvents(); setTick((n) => n + 1); }}>
          Clear
        </button>
        <ul className="ox-labs-events">
          {events.length ? events.map((ev, i) => (
            <li key={`${ev.at}-${i}`}>
              {new Date(ev.at).toLocaleTimeString()} · {ev.type}
              {ev.experiment ? ` · ${ev.experiment}` : ""}
              {ev.detail ? ` · ${ev.detail}` : ""}
            </li>
          )) : <li>No events yet</li>}
        </ul>
      </section>
    </div>
  );
}

function PageLabsHeader() {
  return (
    <header className="ox-page-header">
      <small>XPERIENCE LABS</small>
      <h1>Navigation Experiments</h1>
      <p>Test how you move between applications and Xperience. Winners are chosen after physical testing — not in code.</p>
    </header>
  );
}
