import { createRoot } from "react-dom/client";
import { ExperienceApp } from "@digiconomy/xperience-ui";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(<ExperienceApp />);
