import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerShellServiceWorker } from "./pwa";
import "./styles.css";

registerShellServiceWorker({
  onUpdateAvailable: (activate) => {
    const existing = document.getElementById("os-shell-update-banner");
    if (existing) return;
    const banner = document.createElement("div");
    banner.id = "os-shell-update-banner";
    banner.setAttribute("role", "status");
    banner.className = "os-shell-update-banner";
    banner.innerHTML =
      '<span>New version available</span><button type="button" class="os-shell-update-reload">Reload</button>';
    banner.querySelector("button")?.addEventListener("click", () => activate());
    document.body.appendChild(banner);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
