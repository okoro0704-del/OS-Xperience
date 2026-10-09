import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  ExperienceApp,
  browserWebInstallEnvironment,
  createAndroidInstallationAdapter,
  createIosInstallationAdapter,
  createUnsupportedInstallationAdapter,
  createWebInstallationAdapter,
  resolveLaunchMode,
  webLaunchFromUrl,
  WEB_INSTALL_PARAM,
  type InstallationPlatformAdapter,
  type SpaceContentFetch,
} from "@digiconomy/xperience-ui";
import { attachNativeShellBridge, openExternalUrl } from "./native-bridge.js";
import { BootWatchdog, ShellErrorBoundary, UpdateGate } from "./UpdateGate.js";
import { markBootPhase } from "./boot.js";
import { OX_NATIVE_VERSION, OX_RUNTIME_URL, OX_RUNTIME_VERSION } from "./ox-version-stamp.js";
import { createAppHomeEntryHost, createSpaceHomeEntryHost, presentDirectTarget, readInitialTargetLaunch } from "./space-home-entry.js";
import { createSpaceBackgroundSync } from "./space-content-sync.js";

markBootPhase("NATIVE_START");

const platform = Capacitor.getPlatform();

// Never register a service worker inside Capacitor — it can poison bundled startup.
// On the web it also serves each installed target's manifest and icon (see public/sw.js).
if ("serviceWorker" in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}

const spaceHomeEntryHost = createSpaceHomeEntryHost();
const spaceBackgroundSync = createSpaceBackgroundSync();

/** One installation domain; the runtime only decides which adapter fulfils INSTALL. */
function createInstallationAdapter(): InstallationPlatformAdapter {
  if (platform === "android") {
    return spaceHomeEntryHost
      ? createAndroidInstallationAdapter({ space: spaceHomeEntryHost, app: createAppHomeEntryHost() })
      : createUnsupportedInstallationAdapter("ANDROID", "NO_LAUNCHER_PLUGIN");
  }
  if (platform === "ios") {
    // Native iOS cannot place Home Screen icons; Safari's Add to Home Screen is the supported path.
    // A top-level navigation to the external runtime origin is handed to Safari by the WebView.
    return createIosInstallationAdapter({ runtimeOrigin: OX_RUNTIME_URL, openInSafari: (url) => window.location.assign(url) });
  }
  return createWebInstallationAdapter(browserWebInstallEnvironment(window));
}

const installationAdapter = createInstallationAdapter();

/**
 * Space content sync over native HTTP: the WebView origin is https://localhost, which public
 * provider APIs do not admit for CORS. Same public, uncredentialed GET; binary arrives as base64.
 */
const nativeSpaceContentFetch: SpaceContentFetch = async (url) => {
  const response = await CapacitorHttp.get({ url, responseType: "arraybuffer" });
  const header = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? null;
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    contentType: header,
    bytes: async () => {
      if (typeof response.data !== "string") return new TextEncoder().encode(JSON.stringify(response.data ?? null));
      const binary = atob(response.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    },
  };
};

function webStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || window.matchMedia?.("(display-mode: minimal-ui)").matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Read before the first render: a direct target launch must never paint OS Xperience first. */
async function readInitialLaunch(): Promise<unknown> {
  if (platform === "android") return readInitialTargetLaunch();
  if (platform === "web") return webLaunchFromUrl(window.location.href, webStandalone());
  return null;
}

function initialInstallRequest(): string | null {
  if (platform !== "web") return null;
  try {
    return new URLSearchParams(window.location.search).get(WEB_INSTALL_PARAM);
  } catch {
    return null;
  }
}

/** Leaving a directly launched target returns to the operating system — never to OS Xperience Home. */
async function exitDirectLaunch(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { App } = await import("@capacitor/app");
      await App.minimizeApp().catch(() => App.exitApp());
    } catch {
      /* no host exit available */
    }
    return;
  }
  window.close();
}

function NativeShellApp({ initialLaunch }: { initialLaunch: unknown }) {
  const backHandlerRef = useRef<(() => boolean) | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const direct = resolveLaunchMode(initialLaunch).kind !== "XPERIENCE_NORMAL";

  useEffect(() => {
    markBootPhase("LOCAL_SHELL_READY");
    let detach: (() => void) | undefined;
    void attachNativeShellBridge({
      onBackButton: () => backHandlerRef.current?.() ?? false,
      onNetworkChange: setOnline,
      onKeyboard: (visible) => {
        document.documentElement.classList.toggle("ox-keyboard-open", visible);
      },
    }).then((cleanup) => {
      detach = cleanup;
    });
    return () => detach?.();
  }, []);

  return (
    <ShellErrorBoundary>
      <BootWatchdog>
        <UpdateGate enabled={!direct}>
          <ExperienceApp
            online={online}
            runtimeVersion={OX_RUNTIME_VERSION}
            xperienceVersion={OX_NATIVE_VERSION}
            openExternalUrl={openExternalUrl}
            spaceHomeEntryHost={spaceHomeEntryHost}
            installationAdapter={installationAdapter}
            initialSpaceLaunch={initialLaunch}
            initialInstallRequest={initialInstallRequest()}
            onExitDirectLaunch={() => void exitDirectLaunch()}
            presentDirectTarget={presentDirectTarget}
            spaceContentFetch={Capacitor.isNativePlatform() ? nativeSpaceContentFetch : undefined}
            spaceBackgroundSync={spaceBackgroundSync}
            onHardwareBackReady={(handler) => {
              backHandlerRef.current = handler;
            }}
          />
        </UpdateGate>
      </BootWatchdog>
    </ShellErrorBoundary>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    '<main style="font-family:system-ui;padding:24px;background:#05070f;color:#fff;min-height:100vh"><h1>OS Xperience</h1><p>Root element missing.</p></main>';
} else {
  const root = createRoot(rootEl);
  void readInitialLaunch().then((initialLaunch) => {
    if (initialLaunch != null) document.documentElement.dataset.oxLaunch = "direct";
    root.render(<NativeShellApp initialLaunch={initialLaunch} />);
  });
}

// Hide native splash as soon as the JS shell paints — do not wait on Experience restore.
if (Capacitor.isNativePlatform()) {
  void import("@capacitor/splash-screen")
    .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 180 }))
    .catch(() => undefined);
}
