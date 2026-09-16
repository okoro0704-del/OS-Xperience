/**
 * Thin Capacitor platform adapter for OS Experience.
 * Owns lifecycle, back, splash, status bar, keyboard, network, insets, and external opens.
 * Never exposes credentials, filesystem, or secrets to experienced PWAs.
 *
 * Shared layout contract: real system insets → --ox-safe-* (Web / Android / iOS).
 * Product behavior stays in @digiconomy/xperience-ui.
 */
import { Capacitor } from "@capacitor/core";
import {
  SYSTEM_INSETS_EVENT,
  applySharedSystemInsets,
  detectOxPlatformId,
  type SystemInsets,
} from "@digiconomy/xperience-ui";

export type { SystemInsets };

export function isNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

export function applySystemInsets(insets: SystemInsets): void {
  applySharedSystemInsets(insets);
  document.documentElement.dataset.oxInsets =
    document.documentElement.dataset.oxInsets || "bridge";
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

  window.__oxPlatformId = detectOxPlatformId();
  document.documentElement.classList.add("ox-native-shell");
  document.documentElement.dataset.oxPlatform = window.__oxPlatformId;

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
      /* optional — Android/iOS hosts may push WindowInsets / safeArea via JS */
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
  window.addEventListener(SYSTEM_INSETS_EVENT, onInsetsEvent);
  cleanups.push(() => window.removeEventListener(SYSTEM_INSETS_EVENT, onInsetsEvent));

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
    /* optional — iOS has no hardware Back; gesture escape + shared stack remain */
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
