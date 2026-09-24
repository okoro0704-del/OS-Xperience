import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { ExperienceApp } from "@digiconomy/xperience-ui";
import { attachNativeShellBridge, openExternalUrl } from "./native-bridge.js";
import { BootWatchdog, ShellErrorBoundary, UpdateGate } from "./UpdateGate.js";
import { markBootPhase } from "./boot.js";

markBootPhase("NATIVE_START");

// Never register a service worker inside Capacitor — it can poison bundled startup.
if ("serviceWorker" in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}

function NativeShellApp() {
  const backHandlerRef = useRef<(() => boolean) | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

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
        <UpdateGate>
          <ExperienceApp
            online={online}
            openExternalUrl={openExternalUrl}
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
  createRoot(rootEl).render(<NativeShellApp />);
}

// Hide native splash as soon as the JS shell paints — do not wait on Experience restore.
if (Capacitor.isNativePlatform()) {
  void import("@capacitor/splash-screen")
    .then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 180 }))
    .catch(() => undefined);
}
