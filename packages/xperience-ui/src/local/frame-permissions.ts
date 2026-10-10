/**
 * Browser capabilities delegated to an App / Space frame (the iframe `allow` attribute).
 *
 * Camera and microphone are delegated only to first-party Digiconomy apps on
 * https://*.getlifeos.app (e.g. a creator's mybrandOS, to record and create from the installed
 * App or Space). Every other App gets no device access. Delegation is not a grant: the platform
 * still asks the person (Android runtime permission / browser prompt) before any capture.
 */
export const FIRST_PARTY_APP_SUFFIX = ".getlifeos.app";

const BASE = ["fullscreen", "autoplay", "picture-in-picture"];
const CAPTURE = ["camera", "microphone", "screen-wake-lock", "clipboard-write"];

export function isFirstPartyAppUrl(embedUrl: string): boolean {
  try {
    const url = new URL(embedUrl);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.endsWith(FIRST_PARTY_APP_SUFFIX);
  } catch {
    return false;
  }
}

export function frameAllowPolicy(embedUrl: string): string {
  return [...BASE, ...(isFirstPartyAppUrl(embedUrl) ? CAPTURE : [])].join("; ");
}
