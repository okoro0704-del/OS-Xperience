import {
  hydrateAndPrepareSpaceTv,
  spaceLibraryItems,
  type BroadcastHydrationSource,
  type BroadcastHydrationStore,
  type SpaceLibraryStore,
} from "@digiconomy/offline-kernel";
import type {
  DirectoryApplicationView,
  ExperienceExecutionMode,
  ExperienceTarget,
} from "@digiconomy/xperience-contract";
import { canOperateOffline } from "./auth-contract.js";
import { providerTargets } from "./targets.js";

/** Which Xperience browser launched the running Experience. Directory / My Xperience launches carry none. */
export type XperienceEntry = "APPS" | "SPACE";

export const XPERIENCE_ENTRY_MODE: Record<XperienceEntry, ExperienceExecutionMode> = {
  APPS: "APP",
  SPACE: "SPACE",
};

export type XperienceAppAvailability = "AVAILABLE" | "CONNECTION_REQUIRED";

export type SpaceReadiness =
  | "READY_OFFLINE"
  | "PREPARED"
  | "NOT_PREPARED"
  | "ONLINE_PREPARATION_REQUIRED"
  | "NOT_RELEASED";

export const SPACE_READINESS_LABEL: Record<SpaceReadiness, string> = {
  READY_OFFLINE: "READY OFFLINE",
  PREPARED: "PREPARED",
  NOT_PREPARED: "NOT PREPARED",
  ONLINE_PREPARATION_REQUIRED: "ONLINE PREPARATION REQUIRED",
  NOT_RELEASED: "NOT RELEASED",
};

export interface XperienceAppEntry {
  app: DirectoryApplicationView;
  target: ExperienceTarget;
  availability: XperienceAppAvailability;
}

export interface XperienceSpaceCandidate {
  app: DirectoryApplicationView;
  /** The released SPACE target, or null when the provider declares SPACE but it is not released here. */
  target: ExperienceTarget | null;
  channelId: string | null;
}

function targetsOf(app: DirectoryApplicationView): ExperienceTarget[] {
  return providerTargets({ id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes });
}

function uniqueProviders(apps: DirectoryApplicationView[]): DirectoryApplicationView[] {
  const seen = new Set<string>();
  return apps.filter((app) => (seen.has(app.id) ? false : (seen.add(app.id), true)));
}

/** Providers with a released APP target. APP is network-first: offline it is honestly connection-required. */
export function xperienceAppEntries(apps: DirectoryApplicationView[], online: boolean): XperienceAppEntry[] {
  return uniqueProviders(apps).flatMap((app) => {
    const target = targetsOf(app).find((item) => item.executionMode === "APP" && item.availability === "AVAILABLE");
    return target ? [{ app, target, availability: online ? "AVAILABLE" as const : "CONNECTION_REQUIRED" as const }] : [];
  });
}

/** Providers that declare SPACE in trusted local state (signed catalog, registry, bootstrap). */
export function xperienceSpaceCandidates(apps: DirectoryApplicationView[]): XperienceSpaceCandidate[] {
  return uniqueProviders(apps).flatMap((app) => {
    const declared = targetsOf(app).filter((item) => item.executionMode === "SPACE");
    if (declared.length === 0) return [];
    const target = declared.find((item) => item.availability === "AVAILABLE") ?? null;
    return [{ app, target, channelId: target?.broadcastChannelId ?? declared[0]?.broadcastChannelId ?? null }];
  });
}

/**
 * Truthful Space availability. READY OFFLINE means the Offline Kernel can run the Space from this
 * installation right now — its synced content, or its channel; nothing is claimed from network
 * reachability. `locallyPlayable` is that local readiness (see spaceLocallyReady).
 */
export function classifySpaceReadiness(input: {
  released: boolean;
  offlineCapability: DirectoryApplicationView["offlineCapability"];
  channelId: string | null;
  locallyPlayable: boolean;
  online: boolean;
}): { readiness: SpaceReadiness; enterable: boolean } {
  if (!input.released) return { readiness: "NOT_RELEASED", enterable: false };
  const runsOffline = canOperateOffline(input.offlineCapability, false).ok;
  if (runsOffline && !input.channelId) return { readiness: "PREPARED", enterable: true };
  if (runsOffline && input.locallyPlayable) return { readiness: "READY_OFFLINE", enterable: true };
  if (input.online) return { readiness: "NOT_PREPARED", enterable: true };
  return { readiness: "ONLINE_PREPARATION_REQUIRED", enterable: false };
}

/** A source for NO_ROUTE consumption: the kernel serves retained local state and never reaches out. */
export const noRouteBroadcastSource: BroadcastHydrationSource = {
  fetchSchedule: () => Promise.reject(new Error("NO_ROUTE")),
  fetchMedia: () => Promise.reject(new Error("NO_ROUTE")),
};

/** Read-only: resolves the on-air program against the local kernel store with no route. */
export async function spaceLocallyPlayable(
  store: BroadcastHydrationStore,
  channelId: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const result = await hydrateAndPrepareSpaceTv({
      channelId,
      routeAvailable: false,
      now: () => now,
      store,
      source: noRouteBroadcastSource,
    });
    return result.state === "LOCAL_PLAYING";
  } catch {
    return false;
  }
}

/**
 * Read-only: a Space is locally ready when this installation holds its published content, or can
 * play its channel. A broadcast is one experience of a Space, never a precondition for it.
 */
export async function spaceLocallyReady(
  stores: { broadcast: BroadcastHydrationStore; library: SpaceLibraryStore },
  space: { spaceId: string; channelId: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  if ((await spaceLibraryItems(stores.library, space.spaceId)).length > 0) return true;
  return space.channelId ? spaceLocallyPlayable(stores.broadcast, space.channelId, now) : false;
}
