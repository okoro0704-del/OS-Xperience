/**
 * App → OS Xperience request to open a link in the device browser (system browser / Custom Tab /
 * Safari View). Used by Apps that must run something the embedded frame cannot, e.g. Trust ID
 * sign-in (camera and passkeys are not available inside an App frame).
 *
 * Message: { type: "ox.openExternal", version: 1, url }
 *
 * Accepted only when ALL hold:
 * - it comes from one of the App frames OS Xperience mounted (not the shell, not a nested frame);
 * - the sender's origin is that frame's origin;
 * - the URL is https and on that same origin (an App can only open its own pages — never send the
 *   device browser anywhere else);
 * - at most one request per 1.5 s.
 * The message grants nothing else: no data flows back, no shell API is exposed.
 */
export const OPEN_EXTERNAL_MESSAGE = "ox.openExternal" as const;
export const OPEN_EXTERNAL_MIN_INTERVAL_MS = 1500;

export type OpenExternalFrame = { embedUrl: string; window: unknown };

export type OpenExternalDecision = { ok: true; url: string } | { ok: false; reason: string };

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function decideOpenExternal(input: {
  data: unknown;
  origin: string;
  source: unknown;
  frames: readonly OpenExternalFrame[];
  now: number;
  lastAcceptedAt: number;
}): OpenExternalDecision {
  const data = input.data as { type?: unknown; version?: unknown; url?: unknown } | null;
  if (!data || typeof data !== "object" || data.type !== OPEN_EXTERNAL_MESSAGE) return { ok: false, reason: "not_open_external" };
  if (data.version !== 1 || typeof data.url !== "string" || data.url.length > 2048) return { ok: false, reason: "malformed" };
  const frame = input.frames.find((f) => f.window && f.window === input.source);
  if (!frame) return { ok: false, reason: "unknown_sender" };
  const frameOrigin = originOf(frame.embedUrl);
  if (!frameOrigin || frameOrigin !== input.origin) return { ok: false, reason: "origin_mismatch" };
  let target: URL;
  try {
    target = new URL(data.url);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (target.protocol !== "https:" || target.username || target.password) return { ok: false, reason: "not_https" };
  if (target.origin !== frameOrigin) return { ok: false, reason: "foreign_url" };
  if (input.now - input.lastAcceptedAt < OPEN_EXTERNAL_MIN_INTERVAL_MS) return { ok: false, reason: "rate_limited" };
  return { ok: true, url: target.toString() };
}
