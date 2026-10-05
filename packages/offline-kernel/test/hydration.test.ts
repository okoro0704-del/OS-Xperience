import assert from "node:assert/strict";
import test from "node:test";
import { deletePreparedChannel, hydrateAndPrepareSpaceTv, MemoryBroadcastHydrationStore, type BroadcastHydrationSource, type BroadcastMedia, type BroadcastSchedule } from "../src/index.ts";

const base = Date.parse("2026-09-25T10:00:00.000Z");
const schedule = (version = 1): BroadcastSchedule => ({ channelId: "mrfundzman.tv", publisherId: "mrfundzman", scheduleId: "mrfundzman.tv.daily", scheduleVersion: version, programs: Array.from({ length: 5 }, (_, sequence) => ({ programId: `program-${sequence + 1}`, mediaId: `VIDEO_${sequence + 1}`, scheduledStart: new Date(base + sequence * 60_000).toISOString(), durationMs: 60_000, sequence })) });
const source = (projection = schedule(), calls: string[] = []): BroadcastHydrationSource => ({ fetchSchedule: async () => projection, fetchMedia: async (mediaId) => { calls.push(mediaId); return { mediaId, publisherId: "mrfundzman", title: mediaId, durationMs: 60_000, version: "1", contentType: "video/mp4", byteLength: 3, checksum: `sha-${mediaId}`, availability: "REMOTE_ONLY", bytes: new Uint8Array([1, 2, 3]), integrityVerified: true }; } });

test("fresh consumer automatically hydrates current, next, and bounded media before local playback", async () => {
  const store = new MemoryBroadcastHydrationStore(); const calls: string[] = [];
  const result = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: true, now: () => new Date(base + 2 * 60_000 + 20_000), store, source: source(schedule(), calls) });
  assert.equal(result.state, "LOCAL_PLAYING"); assert.equal(result.playback?.state, "LOCAL_PLAYING"); if (result.playback?.state === "LOCAL_PLAYING") assert.equal(result.playback.offsetMs, 20_000);
  assert.deepEqual(calls.slice(0, 2), ["VIDEO_3", "VIDEO_4"]); assert.equal((await store.loadSchedule("mrfundzman.tv"))?.scheduleVersion, 1); assert.equal((await store.loadMedia("VIDEO_3"))?.availability, "AVAILABLE_LOCAL");
});

test("fresh no-route is honest while persisted schedule and current media restart locally without fetch", async () => {
  const store = new MemoryBroadcastHydrationStore(); const empty = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: false, now: () => new Date(base), store, source: source() }); assert.equal(empty.state, "ONLINE_REQUIRED");
  await store.saveSchedule(schedule()); const media: BroadcastMedia = { mediaId: "VIDEO_2", publisherId: "mrfundzman", title: "VIDEO_2", durationMs: 60_000, version: "1", contentType: "video/mp4", byteLength: 3, checksum: "sha", availability: "AVAILABLE_LOCAL" }; await store.saveMedia(media);
  const calls: string[] = []; const restart = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: false, now: () => new Date(base + 60_000 + 15_000), store, source: source(schedule(), calls) }); assert.equal(restart.state, "LOCAL_PLAYING"); assert.equal(calls.length, 0);
});

test("clock is re-evaluated when a program expires during acquisition", async () => {
  const store = new MemoryBroadcastHydrationStore(); let reads = 0; const calls: string[] = [];
  const result = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: true, now: () => new Date(base + (reads++ === 0 ? 55_000 : 65_000)), store, source: source(schedule(), calls), aheadPrograms: 0 });
  assert.equal(result.state, "LOCAL_PLAYING"); if (result.playback?.state === "LOCAL_PLAYING") assert.equal(result.playback.media.mediaId, "VIDEO_2"); assert.deepEqual(calls.slice(0, 2), ["VIDEO_1", "VIDEO_2"]);
});

test("invalid or partial media never becomes locally available", async () => {
  const store = new MemoryBroadcastHydrationStore(); const bad: BroadcastHydrationSource = { fetchSchedule: async () => schedule(), fetchMedia: async (mediaId) => ({ mediaId, publisherId: "mrfundzman", title: mediaId, durationMs: 60_000, version: "1", contentType: "video/mp4", byteLength: 9, checksum: "sha", availability: "REMOTE_ONLY", bytes: new Uint8Array([1]), integrityVerified: true }) };
  const result = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: true, now: () => new Date(base), store, source: bad }); assert.equal(result.state, "PREPARING_BROADCAST"); assert.equal(await store.loadMedia("VIDEO_1"), undefined);
});

test("newer creator projection reconciles without replacing active local playback until resolution boundary", async () => {
  const store = new MemoryBroadcastHydrationStore(); await store.saveSchedule(schedule(1)); await store.saveMedia({ mediaId: "VIDEO_1", publisherId: "mrfundzman", title: "VIDEO_1", durationMs: 60_000, version: "1", contentType: "video/mp4", byteLength: 3, checksum: "sha", availability: "AVAILABLE_LOCAL" });
  const updated = schedule(2); const result = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: true, now: () => new Date(base + 10_000), store, source: source(updated) }); assert.equal(result.schedule?.scheduleVersion, 2); assert.equal(result.playback?.state, "LOCAL_PLAYING");
});

test("deleting a prepared channel removes its schedule and media but keeps media another channel still uses", async () => {
  const store = new MemoryBroadcastHydrationStore();
  const local = (mediaId: string): BroadcastMedia => ({ mediaId, publisherId: "mrfundzman", title: mediaId, durationMs: 60_000, version: "1", contentType: "video/mp4", byteLength: 3, checksum: "sha", availability: "AVAILABLE_LOCAL" });
  const other: BroadcastSchedule = { ...schedule(), channelId: "other.tv", scheduleId: "other", programs: [{ programId: "o1", mediaId: "VIDEO_2", scheduledStart: new Date(base).toISOString(), durationMs: 60_000, sequence: 0 }] };
  await store.saveSchedule(schedule()); await store.saveSchedule(other);
  for (const id of ["VIDEO_1", "VIDEO_2", "VIDEO_3"]) await store.saveMedia(local(id));
  const result = await deletePreparedChannel(store, "mrfundzman.tv");
  assert.deepEqual(result, { channelId: "mrfundzman.tv", deletedSchedule: true, deletedMediaIds: ["VIDEO_1", "VIDEO_3", "VIDEO_4", "VIDEO_5"], retainedSharedMediaIds: ["VIDEO_2"] });
  assert.equal(await store.loadSchedule("mrfundzman.tv"), undefined);
  assert.equal((await store.loadSchedule("other.tv"))?.channelId, "other.tv");
  assert.deepEqual([...store.media.keys()], ["VIDEO_2"]);
  const restart = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: false, now: () => new Date(base), store, source: source() });
  assert.equal(restart.state, "ONLINE_REQUIRED", "deleted offline data is not READY OFFLINE");
  assert.deepEqual(await deletePreparedChannel(store, "mrfundzman.tv"), { channelId: "mrfundzman.tv", deletedSchedule: false, deletedMediaIds: [], retainedSharedMediaIds: [] });
});

test("a resolution reads each media record once, however many programs share it", async () => {
  const store = new MemoryBroadcastHydrationStore(); const shared: BroadcastSchedule = { ...schedule(), programs: schedule().programs.map((program) => ({ ...program, mediaId: "VIDEO_1" })) };
  await store.saveSchedule(shared); await store.saveMedia({ mediaId: "VIDEO_1", publisherId: "mrfundzman", title: "VIDEO_1", durationMs: 60_000, version: "1", contentType: "video/mp4", byteLength: 3, checksum: "sha", availability: "AVAILABLE_LOCAL" });
  const reads: string[] = []; const load = store.loadMedia.bind(store); store.loadMedia = async (mediaId) => { reads.push(mediaId); return load(mediaId); };
  const result = await hydrateAndPrepareSpaceTv({ channelId: "mrfundzman.tv", routeAvailable: false, now: () => new Date(base + 30_000), store, source: source() });
  assert.equal(result.state, "LOCAL_PLAYING"); assert.deepEqual(reads, ["VIDEO_1"]);
});
