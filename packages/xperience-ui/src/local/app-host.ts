import { isFirstPartyAppUrl } from "./frame-permissions.js";

/**
 * OS Xperience ↔ first-party App frame (mybrandOS on *.getlifeos.app).
 *
 * - The frame is told which deliverable it runs as: `?ox-mode=space` (installed Space) or
 *   `?ox-mode=app`. Other Apps' URLs are left untouched.
 * - The App announces `{ type: "ox.appReady", version: 1 }` once it has booted — from the network
 *   or from its own offline cache. An offline Space stays the App when that arrives; only an App
 *   that never boots falls back to the prepared library.
 */
export const APP_READY_MESSAGE = "ox.appReady" as const;
/** How long an offline Space waits for its App to boot from cache before showing the library. */
export const OFFLINE_APP_READY_TIMEOUT_MS = 6000;

export function frameSrc(embedUrl: string, executionMode: "APP" | "SPACE"): string {
  if (!isFirstPartyAppUrl(embedUrl)) return embedUrl;
  const url = new URL(embedUrl);
  url.searchParams.set("ox-mode", executionMode === "SPACE" ? "space" : "app");
  return url.toString();
}

export type AppReadyFrame = { id: string; embedUrl: string; window: unknown };

/** The mounted frame that announced it is ready, or null for any other message / sender. */
export function appReadyFrame(input: { data: unknown; origin: string; source: unknown; frames: readonly AppReadyFrame[] }): string | null {
  const data = input.data as { type?: unknown; version?: unknown } | null;
  if (!data || typeof data !== "object" || data.type !== APP_READY_MESSAGE || data.version !== 1) return null;
  const frame = input.frames.find((f) => f.window && f.window === input.source);
  if (!frame) return null;
  try {
    return new URL(frame.embedUrl).origin === input.origin ? frame.id : null;
  } catch {
    return null;
  }
}
