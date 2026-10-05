import { prepareSpaceTv, resolveBroadcastNow, type BroadcastMedia, type BroadcastSchedule, type TvPlayback } from "./index.js";

/** Conservative V1 retention: current, next, and two additional upcoming programs. */
export const HYDRATION_AHEAD_PROGRAMS = 3;
export type HydrationReason = "LOCAL_PLAYING" | "ONLINE_REQUIRED" | "PREPARING_BROADCAST" | "MISSING_MEDIA" | "INVALID_PROJECTION";
export type HydrationResult = { state: HydrationReason; playback?: TvPlayback; schedule?: BroadcastSchedule; acquiredMediaIds: string[]; backgroundMediaIds: string[] };
export type DownloadedMedia = BroadcastMedia & { bytes: Uint8Array; integrityVerified: boolean };

export interface BroadcastHydrationStore {
  loadSchedule(channelId: string): Promise<BroadcastSchedule | undefined>;
  saveSchedule(schedule: BroadcastSchedule): Promise<void>;
  loadMedia(mediaId: string): Promise<BroadcastMedia | undefined>;
  saveMedia(media: BroadcastMedia): Promise<void>;
}

/** Explicit, user-initiated removal of prepared state. Hydration never deletes. */
export interface BroadcastRetentionStore extends BroadcastHydrationStore {
  listSchedules(): Promise<BroadcastSchedule[]>;
  deleteSchedule(channelId: string): Promise<void>;
  deleteMedia(mediaId: string): Promise<void>;
}

/** Test/local adapter. Browser production adapters persist this same contract in the existing local kernel store. */
export class MemoryBroadcastHydrationStore implements BroadcastRetentionStore {
  schedules = new Map<string, BroadcastSchedule>(); media = new Map<string, BroadcastMedia>();
  async loadSchedule(channelId: string) { return this.schedules.get(channelId); }
  async saveSchedule(schedule: BroadcastSchedule) { this.schedules.set(schedule.channelId, schedule); }
  async loadMedia(mediaId: string) { return this.media.get(mediaId); }
  async saveMedia(media: BroadcastMedia) { this.media.set(media.mediaId, media); }
  async listSchedules() { return [...this.schedules.values()]; }
  async deleteSchedule(channelId: string) { this.schedules.delete(channelId); }
  async deleteMedia(mediaId: string) { this.media.delete(mediaId); }
}

export type PreparedChannelDeletion = { channelId: string; deletedSchedule: boolean; deletedMediaIds: string[]; retainedSharedMediaIds: string[] };

/**
 * Deletes one channel's prepared schedule and the media it references. Media still referenced by
 * another channel's schedule is shared and stays.
 */
export async function deletePreparedChannel(store: BroadcastRetentionStore, channelId: string): Promise<PreparedChannelDeletion> {
  const schedule = await store.loadSchedule(channelId);
  if (!schedule) return { channelId, deletedSchedule: false, deletedMediaIds: [], retainedSharedMediaIds: [] };
  const others = (await store.listSchedules()).filter((item) => item.channelId !== channelId);
  const shared = new Set(others.flatMap((item) => item.programs.map((program) => program.mediaId)));
  const referenced = [...new Set(schedule.programs.map((program) => program.mediaId))];
  await store.deleteSchedule(channelId);
  const deletedMediaIds: string[] = [];
  for (const mediaId of referenced) {
    if (shared.has(mediaId)) continue;
    await store.deleteMedia(mediaId);
    deletedMediaIds.push(mediaId);
  }
  return { channelId, deletedSchedule: true, deletedMediaIds, retainedSharedMediaIds: referenced.filter((id) => shared.has(id)) };
}

export interface BroadcastHydrationSource {
  fetchSchedule(channelId: string, currentVersion?: number): Promise<BroadcastSchedule>;
  fetchMedia(mediaId: string): Promise<DownloadedMedia>;
}

function validSchedule(schedule: BroadcastSchedule, channelId: string) {
  return schedule.channelId === channelId && Boolean(schedule.publisherId) && Number.isFinite(schedule.scheduleVersion) && schedule.scheduleVersion > 0 && schedule.programs.every((program) => Boolean(program.programId && program.mediaId) && Number.isFinite(program.durationMs) && program.durationMs > 0 && Number.isFinite(Date.parse(program.scheduledStart)));
}
function verifiedMedia(mediaId: string, media: DownloadedMedia): BroadcastMedia | undefined {
  if (media.mediaId !== mediaId || !media.publisherId || !media.version || !media.checksum || media.byteLength !== media.bytes.byteLength || media.byteLength <= 0 || !media.integrityVerified) return undefined;
  return { ...media, availability: "AVAILABLE_LOCAL" };
}
/** A media record carries its bytes, so each record is read at most once per resolution. */
function readOnce(store: BroadcastHydrationStore): BroadcastHydrationStore {
  const reads = new Map<string, Promise<BroadcastMedia | undefined>>();
  return {
    loadSchedule: (channelId) => store.loadSchedule(channelId),
    saveSchedule: (schedule) => store.saveSchedule(schedule),
    loadMedia: (mediaId) => { let read = reads.get(mediaId); if (!read) { read = store.loadMedia(mediaId); reads.set(mediaId, read); } return read; },
    saveMedia: async (media) => { await store.saveMedia(media); reads.set(media.mediaId, Promise.resolve(media)); },
  };
}
async function localMedia(store: BroadcastHydrationStore, schedule: BroadcastSchedule) { return Promise.all(schedule.programs.map(async (program) => (await store.loadMedia(program.mediaId)) ?? { mediaId: program.mediaId, publisherId: schedule.publisherId, title: program.mediaId, durationMs: program.durationMs, version: "", contentType: "", byteLength: 0, checksum: "", availability: "MISSING" as const })); }

/**
 * Consumer orchestration: route acquires published bytes once; every successful
 * playback resolution then uses the persisted local kernel state.
 */
export async function hydrateAndPrepareSpaceTv(input: { channelId: string; routeAvailable: boolean; now: () => Date; store: BroadcastHydrationStore; source: BroadcastHydrationSource; aheadPrograms?: number }): Promise<HydrationResult> {
  let schedule = await input.store.loadSchedule(input.channelId);
  if (!schedule && !input.routeAvailable) return { state: "ONLINE_REQUIRED", acquiredMediaIds: [], backgroundMediaIds: [] };
  if (input.routeAvailable) {
    try {
      const incoming = await input.source.fetchSchedule(input.channelId, schedule?.scheduleVersion);
      if (!validSchedule(incoming, input.channelId)) return { state: "INVALID_PROJECTION", acquiredMediaIds: [], backgroundMediaIds: [] };
      if (!schedule || incoming.scheduleVersion > schedule.scheduleVersion) { await input.store.saveSchedule(incoming); schedule = incoming; }
    } catch { /* retained local schedule remains authoritative while route acquisition fails */ }
  }
  if (!schedule) return { state: "ONLINE_REQUIRED", acquiredMediaIds: [], backgroundMediaIds: [] };
  const store = readOnce(input.store);
  const acquire = async (mediaId: string, acquired: string[]) => {
    const existing = await store.loadMedia(mediaId);
    if (existing?.availability === "AVAILABLE_LOCAL") return true;
    if (!input.routeAvailable) return false;
    try { const verified = verifiedMedia(mediaId, await input.source.fetchMedia(mediaId)); if (!verified) return false; await store.saveMedia(verified); acquired.push(mediaId); return true; } catch { return false; }
  };
  // Re-evaluate after schedule acquisition and after each foreground media acquisition.
  let now = input.now(); let current = resolveBroadcastNow(schedule, now);
  if (!current) return { state: "MISSING_MEDIA", schedule, acquiredMediaIds: [], backgroundMediaIds: [] };
  const acquiredMediaIds: string[] = [];
  if (!await acquire(current.currentProgram.mediaId, acquiredMediaIds)) return { state: input.routeAvailable ? "PREPARING_BROADCAST" : "MISSING_MEDIA", schedule, acquiredMediaIds, backgroundMediaIds: [] };
  now = input.now(); current = resolveBroadcastNow(schedule, now);
  if (!current) return { state: "MISSING_MEDIA", schedule, acquiredMediaIds, backgroundMediaIds: [] };
  if (!await acquire(current.currentProgram.mediaId, acquiredMediaIds)) return { state: input.routeAvailable ? "PREPARING_BROADCAST" : "MISSING_MEDIA", schedule, acquiredMediaIds, backgroundMediaIds: [] };
  const ordered = [...schedule.programs].sort((a, b) => a.sequence - b.sequence || Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart));
  const currentIndex = ordered.findIndex((program) => program.programId === current!.currentProgram.programId);
  const backgroundMediaIds: string[] = [];
  for (const program of ordered.slice(currentIndex + 1, currentIndex + 2 + (input.aheadPrograms ?? HYDRATION_AHEAD_PROGRAMS))) if (await acquire(program.mediaId, backgroundMediaIds)) backgroundMediaIds.push(program.mediaId);
  const playback = prepareSpaceTv(schedule, await localMedia(store, schedule), input.now());
  return playback.state === "LOCAL_PLAYING" ? { state: "LOCAL_PLAYING", playback, schedule, acquiredMediaIds, backgroundMediaIds } : { state: "MISSING_MEDIA", playback, schedule, acquiredMediaIds, backgroundMediaIds };
}
