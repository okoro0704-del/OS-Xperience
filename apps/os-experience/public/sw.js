const CACHE = "os-experience-shell-v3";
/**
 * Per-target install entries (manifest + monogram icons) written by OS Xperience Web when the person
 * taps INSTALL. Served only from this cache, never from the network: an unknown target is a 404,
 * so a crafted URL can never become an installable entry.
 */
const INSTALL_ENTRY_CACHE = "ox-install-entries-v1";
const INSTALL_ENTRY_PREFIX = "/ox-install/";

function isInstallEntryPath(pathname) {
  return pathname.startsWith(INSTALL_ENTRY_PREFIX);
}
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon.svg"];

/** Paths that must never enter the public shell cache. */
function isPrivateOrApiPath(pathname) {
  if (pathname.startsWith("/v1")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname.includes("/private/")) return true;
  if (pathname.includes("/admin/")) return true;
  if (pathname.includes("/session")) return true;
  if (pathname.includes("/auth")) return true;
  return false;
}

function isCacheableShellAsset(pathname) {
  if (isPrivateOrApiPath(pathname)) return false;
  if (PRECACHE.includes(pathname)) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (pathname.endsWith(".js") || pathname.endsWith(".css") || pathname.endsWith(".svg") || pathname.endsWith(".woff2")) {
    return !pathname.includes("node_modules");
  }
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE && key !== INSTALL_ENTRY_CACHE).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API / protected responses in the public shell cache.
  if (isPrivateOrApiPath(url.pathname)) return;

  if (isInstallEntryPath(url.pathname)) {
    event.respondWith(
      caches.open(INSTALL_ENTRY_CACHE)
        .then((cache) => cache.match(url.origin + url.pathname))
        .then((entry) => entry || new Response("", { status: 404 })),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok && isCacheableShellAsset(url.pathname)) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

// Exported for Node tests via dynamic import simulation — see sw-cache-policy.js mirror.
