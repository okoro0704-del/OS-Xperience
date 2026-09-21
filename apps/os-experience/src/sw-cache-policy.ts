/**
 * Mirror of public/sw.js cache policy for automated tests.
 * Keep in sync with apps/os-experience/public/sw.js
 */

export const SHELL_CACHE_NAME = "os-experience-shell-v3";
export const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon.svg"];

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
