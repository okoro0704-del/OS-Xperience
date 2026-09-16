import type { ExperimentId, LabsConfig, NavLabsHud } from "./types.js";
import { NAV_LABS_BUILD_ID } from "./types.js";
import { appendLabEvent } from "./labs-log.js";
import { applyExperienceTransform, clearExperienceTransform } from "./transition.js";
import { attachEdgePull } from "./recognizers/edge-pull.js";
import { attachTwoFingerSweep } from "./recognizers/two-finger-sweep.js";
import { attachHoldFlick } from "./recognizers/hold-flick.js";
import { attachCornerPull } from "./recognizers/corner-pull.js";
import { startAirSwipe } from "./recognizers/air-swipe.js";

export interface NavLabsControllerOptions {
  host: HTMLElement;
  experiment: ExperimentId | null;
  enabled: boolean;
  onExitHome: () => void;
  onHud: (hud: NavLabsHud) => void;
  onGrabbed?: (v: boolean) => void;
  config: LabsConfig;
}

function hud(
  experiment: ExperimentId | null,
  state: string,
  extra?: Partial<NavLabsHud>,
): NavLabsHud {
  return {
    experiment,
    state,
    buildId: NAV_LABS_BUILD_ID,
    ...extra,
  };
}

/**
 * Attach the active Navigation Labs recognizer to the host.
 * Recognizers only invoke onExitHome / onCommit — never exitExperienceToHome by name.
 */
export function attachNavLabsController(options: NavLabsControllerOptions): () => void {
  const { host, experiment, enabled, onExitHome, onHud, onGrabbed, config } = options;
  const cleanups: Array<() => void> = [];

  if (!enabled || !experiment) {
    onHud(hud(experiment, "disabled"));
    return () => undefined;
  }

  const commitHome = (detail?: string) => {
    appendLabEvent({ type: "commit", experiment, detail });
    onHud(hud(experiment, "commit", { progress: 1, detail }));
    onExitHome();
  };

  const cancel = (detail?: string) => {
    clearExperienceTransform(host);
    appendLabEvent({ type: "cancel", experiment, detail });
    onHud(hud(experiment, "cancel", { progress: 0, detail }));
  };

  onHud(hud(experiment, "active"));
  appendLabEvent({ type: "attach", experiment });

  if (experiment === "edge-pull") {
    cleanups.push(
      attachEdgePull(host, {
        config: config.edgePull,
        side: "both",
        onProgress: (progress, side, delta) => {
          applyExperienceTransform(host, {
            x: delta.x * 0.35,
            progress,
            scale: 1 - progress * 0.04,
          });
          onHud(hud(experiment, "progress", { progress, detail: side }));
        },
        onCancel: () => cancel("edge"),
        onCommit: (side) => {
          clearExperienceTransform(host);
          commitHome(side);
        },
      }),
    );
  } else if (experiment === "two-finger-sweep") {
    const surface = document.createElement("div");
    surface.className = "ox-nav-labs-capture";
    surface.dataset.experiment = "two-finger-sweep";
    surface.setAttribute("aria-hidden", "true");
    host.appendChild(surface);
    cleanups.push(() => surface.remove());
    cleanups.push(
      attachTwoFingerSweep(surface, {
        config: config.twoFinger,
        onHud: (h) => {
          onHud(
            hud(experiment, h.class, {
              progress: Math.min(1, Math.abs(h.avgDx) / config.twoFinger.minDistance),
              detail: `${h.class}`,
            }),
          );
        },
        onCommit: (direction) => commitHome(direction),
      }),
    );
  } else if (experiment === "hold-flick") {
    const surface = document.createElement("div");
    surface.className = "ox-nav-labs-capture";
    surface.dataset.experiment = "hold-flick";
    surface.setAttribute("aria-hidden", "true");
    host.appendChild(surface);
    cleanups.push(() => surface.remove());
    cleanups.push(
      attachHoldFlick(surface, {
        config: config.holdFlick,
        onHold: () => {
          onGrabbed?.(true);
          onHud(hud(experiment, "held"));
        },
        onProgress: (progress, direction) => {
          applyExperienceTransform(host, {
            x: direction === "left" ? -progress * 40 : direction === "right" ? progress * 40 : 0,
            progress,
          });
          onHud(hud(experiment, "flick", { progress, detail: direction ?? undefined }));
        },
        onCommit: (direction) => {
          onGrabbed?.(false);
          clearExperienceTransform(host);
          commitHome(direction);
        },
        onCancel: () => {
          onGrabbed?.(false);
          cancel("hold-flick");
        },
      }),
    );
  } else if (experiment === "corner-pull") {
    cleanups.push(
      attachCornerPull(host, {
        corner: "br",
        config: config.cornerPull,
        onProgress: (progress) => {
          applyExperienceTransform(host, {
            x: -progress * 24,
            y: -progress * 24,
            progress,
            scale: 1 - progress * 0.05,
          });
          onHud(hud(experiment, "progress", { progress }));
        },
        onCancel: () => cancel("corner"),
        onCommit: () => {
          clearExperienceTransform(host);
          commitHome("corner");
        },
      }),
    );
  } else if (experiment === "air-swipe") {
    const ctrl = startAirSwipe({
      config: config.airSwipe,
      onExitHome: () => commitHome("air-swipe"),
      onHud: (h) => {
        onHud(hud(experiment, h.state, { detail: h.detail, progress: h.dx != null ? Math.min(1, Math.abs(h.dx) / config.airSwipe.minDx) : undefined }));
      },
    });
    cleanups.push(() => ctrl.stop());
  } else if (experiment === "palm-fist-throw") {
    let stopped = false;
    let stopAir: (() => void) | null = null;
    void import("../air-navigation.js").then(({ startAirNavigation }) => {
      if (stopped) return;
      return startAirNavigation({
        onExitHome: () => commitHome("palm-fist-throw"),
        onGrabbed,
        onDebug: (snap) => {
          onHud(hud(experiment, snap.state, { detail: snap.detail }));
        },
      }).then((ctrl) => {
        if (stopped) {
          ctrl.stop();
          return;
        }
        stopAir = () => ctrl.stop();
      });
    });
    cleanups.push(() => {
      stopped = true;
      stopAir?.();
    });
  }

  return () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    clearExperienceTransform(host);
    appendLabEvent({ type: "detach", experiment });
    onHud(hud(experiment, "detached"));
  };
}
