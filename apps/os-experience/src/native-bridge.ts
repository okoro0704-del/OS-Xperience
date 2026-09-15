/**
 * Thin Capacitor platform bridge for OS Experience.
 * Owns lifecycle, back, splash, status bar, keyboard, network, and external opens.
 * Never exposes credentials, filesystem, or secrets to experienced PWAs.
 */
import { Capacitor } from "@capacitor/core";

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!url || !/^https:\/\//i.test(url)) return;
  if (!Capacitor.isNativePlatform()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function attachNativeShellBridge(handlers: {
  onBackButton: () => boolean;
  onNetworkChange?: (online: boolean) => void;
  onAppState?: (state: "active" | "background") => void;
  onKeyboard?: (visible: boolean) => void;
}): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => undefined;

  const cleanups: Array<() => void> = [];

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#05070f" });
  } catch {
    /* optional */
  }

  try {
    const { App } = await import("@capacitor/app");
    const back = await App.addListener("backButton", ({ canGoBack }) => {
      const handled = handlers.onBackButton();
      if (handled) return;
      if (canGoBack) {
        window.history.back();
        return;
      }
      void App.minimizeApp().catch(() => void App.exitApp());
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
    /* optional */
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
    const { Keyboard } = await import("@capacitor/keyboard");
    const show = await Keyboard.addListener("keyboardWillShow", () => handlers.onKeyboard?.(true));
    const hide = await Keyboard.addListener("keyboardWillHide", () => handlers.onKeyboard?.(false));
    cleanups.push(() => {
      void show.remove();
      void hide.remove();
    });
  } catch {
    /* optional */
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 280 });
  } catch {
    /* optional */
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
