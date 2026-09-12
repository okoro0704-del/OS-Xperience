/**
 * Minimal Capacitor platform bridge — lifecycle / network / back / first-party app open.
 * Never exposes credentials, filesystem, or secrets to JavaScript.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

interface ShellAppLauncherPlugin {
  canOpen(options: { packageName: string }): Promise<{ value: boolean }>;
  open(options: { packageName: string }): Promise<void>;
}

const ShellAppLauncher = registerPlugin<ShellAppLauncherPlugin>("ShellAppLauncher");

/** Known first-party Android package IDs (override via Vite env). */
export function androidPackageForApp(appId: "lifeos" | "mybrandos"): string {
  if (appId === "lifeos") {
    return (import.meta.env.VITE_LIFEOS_ANDROID_PACKAGE as string | undefined)?.trim() || "com.lifeos.mobile";
  }
  return (
    (import.meta.env.VITE_MYBRANDOS_ANDROID_PACKAGE as string | undefined)?.trim() ||
    "com.mybrandos.mobile"
  );
}

export async function openFirstPartyAndroidApp(
  appId: "lifeos" | "mybrandos",
): Promise<{ ok: true } | { ok: false; reason: "not_native" | "not_installed" | "failed" }> {
  if (!Capacitor.isNativePlatform()) return { ok: false, reason: "not_native" };
  const packageName = androidPackageForApp(appId);
  try {
    const can = await ShellAppLauncher.canOpen({ packageName });
    if (!can.value) return { ok: false, reason: "not_installed" };
    await ShellAppLauncher.open({ packageName });
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function attachNativeShellBridge(handlers: {
  onBackButton: () => boolean;
  onNetworkChange?: (online: boolean) => void;
  onAppState?: (state: "active" | "background") => void;
}): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => undefined;

  const cleanups: Array<() => void> = [];

  try {
    const { App } = await import("@capacitor/app");
    const back = await App.addListener("backButton", () => {
      const handled = handlers.onBackButton();
      if (!handled) {
        void App.exitApp();
      }
    });
    cleanups.push(() => {
      void back.remove();
    });

    const state = await App.addListener("appStateChange", ({ isActive }) => {
      handlers.onAppState?.(isActive ? "active" : "background");
    });
    cleanups.push(() => {
      void state.remove();
    });
  } catch {
    /* Plugin unavailable in web preview */
  }

  try {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    handlers.onNetworkChange?.(status.connected);
    const net = await Network.addListener("networkStatusChange", (next) => {
      handlers.onNetworkChange?.(next.connected);
    });
    cleanups.push(() => {
      void net.remove();
    });
  } catch {
    /* optional */
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* optional */
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
