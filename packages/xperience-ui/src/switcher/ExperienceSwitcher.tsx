import type { ExperienceAvailability, ExperienceExecutionMode } from "@digiconomy/xperience-contract";
import type { LineupEntry } from "../local/lineup.js";

export interface ExperienceSwitcherProps {
  open: boolean;
  lineup: LineupEntry[];
  activeId: string | null;
  /** Provider switching — changes which provider is active. */
  onSelect: (experienceId: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onDismiss: () => void;
  /** Mode switching — changes APP ↔ SPACE on the active provider only. */
  activeMode?: ExperienceExecutionMode;
  activeModes?: ExperienceExecutionMode[];
  modeSwitchAllowed?: boolean;
  onSelectMode?: (mode: ExperienceExecutionMode) => void;
  modesFor?: (experienceId: string) => ExperienceExecutionMode[];
}

const MODE_LABEL: Record<ExperienceExecutionMode, string> = { APP: "App", SPACE: "Space" };

function availabilityLabel(value: ExperienceAvailability): string {
  switch (value) {
    case "AVAILABLE":
      return "Ready";
    case "OFFLINE_AVAILABLE":
      return "Offline ready";
    case "CONNECTION_REQUIRED":
      return "Needs connection";
    case "LOCKED":
      return "Locked";
    case "DISABLED":
      return "Unavailable";
    default:
      return "";
  }
}

export function ExperienceSwitcher(props: ExperienceSwitcherProps) {
  if (!props.open) return null;
  const activeModes = props.activeModes ?? [];
  const showModes = Boolean(props.onSelectMode && props.modeSwitchAllowed !== false && activeModes.length > 1);
  return (
    <div
      className="ox-switcher"
      data-testid="experience-switcher"
      role="dialog"
      aria-modal="true"
      aria-label="Experience Switcher"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onDismiss();
      }}
    >
      <div className="ox-switcher-panel">
        <header className="ox-switcher-head">
          <small>SWITCHER</small>
          <strong>Your Experiences</strong>
          <button type="button" className="ox-switcher-dismiss" data-testid="switcher-dismiss" onClick={props.onDismiss}>
            Close
          </button>
        </header>
        {showModes ? (
          <div className="ox-switcher-remote" role="radiogroup" aria-label="Execution mode" data-testid="switcher-modes">
            {activeModes.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={mode === props.activeMode}
                data-testid={`switcher-mode-${mode.toLowerCase()}`}
                className={`ox-button compact ${mode === props.activeMode ? "primary" : "secondary"}`}
                onClick={() => props.onSelectMode?.(mode)}
              >
                {MODE_LABEL[mode]}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ox-switcher-remote" role="toolbar" aria-label="Channel controls">
          <button type="button" data-testid="switcher-prev" className="ox-button secondary compact" onClick={props.onPrevious}>
            Prev
          </button>
          <button type="button" data-testid="switcher-next" className="ox-button secondary compact" onClick={props.onNext}>
            Next
          </button>
        </div>
        <ul className="ox-switcher-list">
          {props.lineup.map((item) => {
            const active = item.experienceId === props.activeId;
            const blocked =
              item.availability === "CONNECTION_REQUIRED" ||
              item.availability === "DISABLED" ||
              item.availability === "LOCKED";
            const modes = props.modesFor?.(item.experienceId) ?? [];
            return (
              <li key={item.experienceId}>
                <button
                  type="button"
                  data-testid={`switcher-item-${item.experienceId}`}
                  className={`ox-switcher-item${active ? " is-active" : ""}${blocked ? " is-blocked" : ""}`}
                  onClick={() => props.onSelect(item.experienceId)}
                >
                  <span className="ox-switcher-name">{item.name}</span>
                  <small>
                    {availabilityLabel(item.availability)}
                    {modes.length ? ` · ${modes.map((mode) => MODE_LABEL[mode]).join(" / ")}` : ""}
                  </small>
                  {active ? <em>Now{props.activeMode ? ` · ${MODE_LABEL[props.activeMode]}` : ""}</em> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
