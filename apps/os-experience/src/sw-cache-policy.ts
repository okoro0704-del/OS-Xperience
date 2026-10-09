/**
 * Mirror of public/sw.js cache policy for automated tests.
 * Keep in sync with apps/os-experience/public/sw.js
 */

export const SHELL_CACHE_NAME = "os-experience-shell-v3";
export const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon.svg"];

/** Install entries live in their own cache, written by the page and kept across shell-cache upgrades. */
export const INSTALL_ENTRY_CACHE_NAME = "ox-install-entries-v1";
export const INSTALL_ENTRY_PREFIX = "/ox-install/";

export function isInstallEntryPath(pathname: string): boolean {
  return pathname.startsWith(INSTALL_ENTRY_PREFIX);
}

/** Caches the activate step keeps; every other cache is an outdated shell cache. */
export function isRetainedCache(name: string): boolean {
  return name === SHELL_CACHE_NAME || name === INSTALL_ENTRY_CACHE_NAME;
}

export function isPrivateOrApiPath(pathname: string): boolean {
  if (pathname.startsWith("/v1")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname.includes("/private/")) return true;
  if (pathname.includes("/admin/")) return true;
  if (pathname.includes("/session")) return true;
  if (pathname.includes("/auth")) return true;
  return false;
}

export function isCacheableShellAsset(pathname: string): boolean {
  if (isPrivateOrApiPath(pathname)) return false;
  if (PRECACHE.includes(pathname)) return true;
  if (pathname.startsWith("/assets/")) return true;
  if (
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".woff2")
  ) {
    return !pathname.includes("node_modules");
  }
  return false;
}
