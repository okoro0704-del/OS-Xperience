import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import type { OxUpdateDecision } from "@digiconomy/xperience-contract";
import {
  applyWebOta,
  checkOxUpdates,
  dismissNativeUpdate,
  openNativeApkUpdate,
  wasNativeUpdateDismissed,
} from "./update-check.js";
import { clearInvalidRestoreState, markBootPhase, type BootPhase } from "./boot.js";

/**
 * Background update checks AFTER the shell is visible.
 * Never replaces bundled native runtime with a remote navigation.
 */
/**
 * `enabled=false` for a direct target launch: an installed App or Space never shows OS Xperience
 * update prompts or reloads for an OS Xperience update. Updates apply when OS Xperience itself opens.
 */
export function UpdateGate({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [nativePrompt, setNativePrompt] = useState<OxUpdateDecision | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let checking = false;
    let initial = true;
    const runCheck = async () => {
      if (checking) return;
      checking = true;
      try {
        if (initial) markBootPhase("UPDATE_CHECK");
        const decision = await checkOxUpdates();
        if (cancelled) return;
        if (decision.kind === "web_ota") {
          await applyWebOta(decision);
          return;
        }
        if (
          decision.kind === "native_apk" &&
          decision.manifest &&
          !wasNativeUpdateDismissed(decision.manifest.releaseId)
        ) {
          setNativePrompt(decision);
        }
        if (initial) markBootPhase("READY");
      } finally {
        initial = false;
        checking = false;
      }
    };
    const timer = window.setTimeout(() => void runCheck(), 1500);
    // Offline launch: learn about newer builds once connectivity returns.
    const onOnline = () => void runCheck();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled]);

  return (
    <>
      {children}
      {nativePrompt?.manifest ? (
        <div className="ox-update-banner" role="dialog" aria-modal="true" data-testid="native-update-prompt">
          <div className="ox-update-card">
            <p className="ox-update-eyebrow">Native update required</p>
            <h2>Install the latest OS Xperience APK</h2>
            <p>{nativePrompt.reason} This change cannot be delivered as a web update.</p>
            <p className="ox-update-meta">
              Installed {nativePrompt.installedNativeVersion} ({nativePrompt.installedNativeBuildNumber}) →{" "}
              {nativePrompt.manifest.nativeVersion} ({nativePrompt.manifest.nativeBuildNumber})
            </p>
            <div className="ox-update-actions">
              <button
                type="button"
                className="ox-button secondary"
                disabled={busy}
                onClick={() => {
                  dismissNativeUpdate(nativePrompt.manifest!.releaseId);
                  setNativePrompt(null);
                }}
              >
                Later
              </button>
              <button
                type="button"
                className="ox-button primary"
                disabled={busy || !nativePrompt.manifest.apkUrl}
                data-testid="native-update-install"
                onClick={() => {
                  setBusy(true);
                  void openNativeApkUpdate(nativePrompt).finally(() => setBusy(false));
                }}
              >
                Get update
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type BoundaryState = { error: Error | null };

export class ShellErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    markBootPhase("RECOVERY");
    console.error("[ox-boot] runtime crash", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="ox-recovery" data-testid="ox-recovery" role="alert">
        <p className="ox-update-eyebrow">Recovery</p>
        <h1>OS Xperience could not restore the previous Experience.</h1>
        <p>Your installation data was kept. You can recover to the local shell.</p>
        <button
          type="button"
          className="ox-button primary"
          data-testid="ox-recover"
          onClick={() => {
            clearInvalidRestoreState();
            this.setState({ error: null });
            window.location.assign("./index.html");
          }}
        >
          Recover
        </button>
      </div>
    );
  }
}

export function BootWatchdog({ children }: { children: ReactNode }) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    markBootPhase("LOCAL_SHELL_LOADING");
    const timer = window.setTimeout(() => {
      const mounted = Boolean(document.querySelector("[data-testid='os-experience'], .ox-root"));
      if (!mounted) {
        markBootPhase("RECOVERY");
        setTimedOut(true);
      } else {
        markBootPhase("READY");
      }
    }, 10000);
    return () => window.clearTimeout(timer);
  }, []);

  if (timedOut) {
    return (
      <div className="ox-recovery" data-testid="ox-boot-watchdog" role="alert">
        <p className="ox-update-eyebrow">Startup timeout</p>
        <h1>OS Xperience took too long to start.</h1>
        <p>The local shell will recover without wiping your data.</p>
        <button
          type="button"
          className="ox-button primary"
          onClick={() => {
            clearInvalidRestoreState();
            window.location.assign("./index.html");
          }}
        >
          Recover
        </button>
      </div>
    );
  }
  return children;
}

export type { BootPhase };
