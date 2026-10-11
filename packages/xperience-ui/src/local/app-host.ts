import { isFirstPartyAppUrl } from "./frame-permissions.js";

/**
 * OS Xperience ↔ first-party App frame (mybrandOS on *.getlifeos.app).
 *
 * - The frame is told which deliverable it runs as: `?ox-mode=space&entry=space` (installed
 *   Space) or `?ox-mode=app`. Other Apps' URLs are left untouched.
 * - The App announces `{ type: "ox.appReady", version: 1 }` once it has booted — from the network
 *   or from its own offline cache. An offline Space stays the App when that arrives; only an App
 *   that never boots falls back to the prepared library.
 */
export const APP_READY_MESSAGE = "ox.appReady" as const;
/** Sent by a Space App loaded invisibly to refresh its offline copy, once it has finished. */
export const SPACE_SYNCED_MESSAGE = "ox.spaceSynced" as const;
/** An invisible prepare frame is removed after this long even if it never reports back. */
export const SPACE_PREPARE_TIMEOUT_MS = 10 * 60_000;

/** The URL that loads a first-party Space App invisibly to refresh its offline copy. */
export function spacePrepareSrc(embedUrl: string): string | null {
  if (!isFirstPartyAppUrl(embedUrl)) return null;
  const url = new URL(frameSrc(embedUrl, "SPACE"));
  url.searchParams.set("ox-prepare", "1");
  return url.toString();
}
/** How long an offline Space waits for its App to boot from cache before showing the library. */
export const OFFLINE_APP_READY_TIMEOUT_MS = 6000;

export function frameSrc(embedUrl: string, executionMode: "APP" | "SPACE"): string {
  if (!isFirstPartyAppUrl(embedUrl)) return embedUrl;
  const url = new URL(embedUrl);
  url.searchParams.set("ox-mode", executionMode === "SPACE" ? "space" : "app");
  // mybrandOS's own Space presentation (100% media, hidden UI) starts only from ?entry=space.
  if (executionMode === "SPACE") url.searchParams.set("entry", "space");
  else url.searchParams.delete("entry");
  return url.toString();
}

export type AppReadyFrame = { id: string; embedUrl: string; window: unknown };

/** The mounted frame that announced it is ready, or null for any other message / sender. */
export function appReadyFrame(
  input: { data: unknown; origin: string; source: unknown; frames: readonly AppReadyFrame[] },
  type: string = APP_READY_MESSAGE,
): string | null {
  const data = input.data as { type?: unknown; version?: unknown } | null;
  if (!data || typeof data !== "object" || data.type !== type || data.version !== 1) return null;
  const frame = input.frames.find((f) => f.window && f.window === input.source);
  if (!frame) return null;
  try {
    return new URL(frame.embedUrl).origin === input.origin ? frame.id : null;
  } catch {
    return null;
  }
}
