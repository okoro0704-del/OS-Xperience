/**
 * Minimal Capacitor platform bridge — lifecycle / network / back only.
 * Never exposes credentials, filesystem, or secrets to JavaScript.
 */
import { Capacitor } from "@capacitor/core";

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
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
