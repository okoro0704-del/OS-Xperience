export const MANIFEST_PATH = "/ox-update-manifest.json";

/**
 * Hosted release manifest first: on native the page origin serves the manifest bundled
 * with this APK, which can never announce a newer build. The origin copy is the fallback.
 */
export function manifestUrls(runtimeUrl: string, pageOrigin: string | null): string[] {
  const urls: string[] = [];
  if (runtimeUrl) {
    urls.push(`${runtimeUrl.replace(/\/$/, "")}${MANIFEST_PATH}`);
  }
  if (pageOrigin) {
    try {
      urls.push(new URL(MANIFEST_PATH, pageOrigin).href);
    } catch {
      /* ignore */
    }
  }
  return [...new Set(urls)];
}
