/**
 * Register the production PWA service worker and surface safe update prompts.
 * Does not cache private application data or credentials.
 */
export function registerShellServiceWorker(options?: {
  onUpdateAvailable?: (activate: () => void) => void;
}): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Skip SW on Vite dev server to avoid stale HMR / localhost cache traps.
  if (import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              const activate = () => {
                worker.postMessage("SKIP_WAITING");
              };
              options?.onUpdateAvailable?.(activate);
            }
          });
        });
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          window.location.reload();
        });
      })
      .catch(() => {
        /* Offline or blocked — Shell still runs without SW. */
      });
  });
}
