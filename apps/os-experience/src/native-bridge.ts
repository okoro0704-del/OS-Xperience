/**
 * Thin Capacitor platform bridge for OS Experience.
 * Owns lifecycle, back, splash, status bar, keyboard, network, insets, and external opens.
 * Never exposes credentials, filesystem, or secrets to experienced PWAs.
 */
import { Capacitor } from "@capacitor/core";

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

export type SystemInsets = { top: number; bottom: number; left: number; right: number };

export function applySystemInsets(insets: SystemInsets): void {
  const root = document.documentElement;
  root.style.setProperty("--ox-safe-top", `${Math.max(0, insets.top)}px`);
  root.style.setProperty("--ox-safe-bottom", `${Math.max(0, insets.bottom)}px`);
  root.style.setProperty("--ox-safe-left", `${Math.max(0, insets.left)}px`);
  root.style.setProperty("--ox-safe-right", `${Math.max(0, insets.right)}px`);
  root.dataset.oxInsets = root.dataset.oxInsets || "bridge";
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
  onInsets?: (insets: SystemInsets) => void;
}): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => undefined;

  const cleanups: Array<() => void> = [];

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
    try {
      const info = await StatusBar.getInfo();
      if (typeof info.height === "number" && info.height > 0) {
        const currentBottom =
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ox-safe-bottom")) || 0;
        applySystemInsets({
          top: info.height,
          bottom: currentBottom,
          left: 0,
          right: 0,
        });
        handlers.onInsets?.({ top: info.height, bottom: currentBottom, left: 0, right: 0 });
      }
    } catch {
      /* optional */
    }
  } catch {
    /* optional */
  }

  const onInsetsEvent = (event: Event) => {
    const detail = (event as CustomEvent<SystemInsets>).detail;
    if (!detail) return;
    applySystemInsets(detail);
    handlers.onInsets?.(detail);
  };
  window.addEventListener("ox-system-insets", onInsetsEvent);
  cleanups.push(() => window.removeEventListener("ox-system-insets", onInsetsEvent));

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
