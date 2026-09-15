import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { ExperienceApp } from "@digiconomy/xperience-ui";
import { attachNativeShellBridge, openExternalUrl } from "./native-bridge.js";

if ("serviceWorker" in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

function NativeShellApp() {
  const backHandlerRef = useRef<(() => boolean) | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let detach: (() => void) | undefined;
    void attachNativeShellBridge({
      onBackButton: () => backHandlerRef.current?.() ?? false,
      onNetworkChange: setOnline,
      onKeyboard: (visible) => {
        document.documentElement.classList.toggle("ox-keyboard-open", visible);
      },
    }).then((cleanup) => {
      detach = cleanup;
      document.documentElement.classList.add("ox-native-shell");
    });
    return () => detach?.();
  }, []);

  return (
    <ExperienceApp
      online={online}
      openExternalUrl={openExternalUrl}
      onHardwareBackReady={(handler) => {
        backHandlerRef.current = handler;
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<NativeShellApp />);
