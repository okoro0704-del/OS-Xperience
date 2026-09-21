import type { ExperienceAvailability } from "@digiconomy/xperience-contract";
import type { LineupEntry } from "../local/lineup.js";

export interface ExperienceSwitcherProps {
  open: boolean;
  lineup: LineupEntry[];
  activeId: string | null;
  onSelect: (experienceId: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onDismiss: () => void;
}

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
            return (
              <li key={item.experienceId}>
                <button
                  type="button"
                  data-testid={`switcher-item-${item.experienceId}`}
                  className={`ox-switcher-item${active ? " is-active" : ""}${blocked ? " is-blocked" : ""}`}
                  onClick={() => props.onSelect(item.experienceId)}
                >
                  <span className="ox-switcher-name">{item.name}</span>
                  <small>{availabilityLabel(item.availability)}</small>
                  {active ? <em>Now</em> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
