import type { BroadcastHydrationSource, BroadcastRetentionStore, DownloadedMedia } from "./hydration.js";
import type { BroadcastMedia, BroadcastSchedule } from "./index.js";
import type { SpaceLibrary, SpaceLibraryStore } from "./library.js";

const DB = "digiconomy-offline-kernel"; const STORE = "broadcast";
type Row = { key: string; value: BroadcastSchedule | BroadcastMedia | SpaceLibrary | Uint8Array };
function openDb(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open(DB, 1); request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function get(key: string) { const db = await openDb(); return new Promise<Row | undefined>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function put(row: Row) { const db = await openDb(); return new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(row); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
async function remove(key: string) { const db = await openDb(); return new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
async function schedules() { const db = await openDb(); return new Promise<BroadcastSchedule[]>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).getAll(IDBKeyRange.bound("schedule:", "schedule:\uffff")); request.onsuccess = () => resolve((request.result as Row[]).map((row) => row.value as BroadcastSchedule)); request.onerror = () => reject(request.error); }); }
export class IndexedDbBroadcastHydrationStore implements BroadcastRetentionStore {
  async loadSchedule(channelId: string) { return (await get(`schedule:${channelId}`))?.value as BroadcastSchedule | undefined; }
  async saveSchedule(schedule: BroadcastSchedule) { await put({ key: `schedule:${schedule.channelId}`, value: schedule }); }
  async loadMedia(mediaId: string) { return (await get(`media:${mediaId}`))?.value as BroadcastMedia | undefined; }
  async saveMedia(media: BroadcastMedia) { await put({ key: `media:${media.mediaId}`, value: media }); }
  async listSchedules() { return schedules(); }
  async deleteSchedule(channelId: string) { await remove(`schedule:${channelId}`); }
  async deleteMedia(mediaId: string) { await remove(`media:${mediaId}`); }
}
type Projection = { channelId: string; publisherId: string; scheduleId: string; scheduleVersion: number; programs: Array<{ programId: string; mediaId: string; scheduledStart: string; durationMs: number; sequence: number; media: { path: string; version: string; contentType: string; byteLength: number; checksum: string | null } }> };
async function sha256(bytes: Uint8Array) { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); const hash = await crypto.subtle.digest("SHA-256", copy.buffer); return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, "0")).join(""); }
export function createHttpBroadcastSource(baseUrl: string): BroadcastHydrationSource {
  const base = baseUrl.replace(/\/$/, ""); if (!base) throw new Error("MYBRANDOS_PUBLIC_API_BASE_REQUIRED"); const media = new Map<string, Projection["programs"][number]>(); let publisherId = "";
  return { async fetchSchedule(channelId) { const response = await fetch(`${base}/api/public/broadcast/${encodeURIComponent(channelId)}`); if (!response.ok) throw new Error("BROADCAST_UNAVAILABLE"); const projection = await response.json() as Projection; publisherId = projection.publisherId; for (const program of projection.programs) media.set(program.mediaId, program); return { channelId: projection.channelId, publisherId: projection.publisherId, scheduleId: projection.scheduleId, scheduleVersion: projection.scheduleVersion, programs: projection.programs.map(({ media: _media, ...program }) => program) }; }, async fetchMedia(mediaId) { const program = media.get(mediaId); if (!program) throw new Error("BROADCAST_MEDIA_UNKNOWN"); const response = await fetch(`${base}${program.media.path}`); if (!response.ok) throw new Error("BROADCAST_MEDIA_UNAVAILABLE"); const bytes = new Uint8Array(await response.arrayBuffer()); const checksum = program.media.checksum ?? ""; return { mediaId, publisherId, title: program.mediaId, durationMs: program.durationMs, version: program.media.version, contentType: program.media.contentType, byteLength: bytes.byteLength, checksum, availability: "REMOTE_ONLY", bytes, integrityVerified: Boolean(checksum) && await sha256(bytes) === checksum } satisfies DownloadedMedia; } };
}
export function localMediaBlob(media: BroadcastMedia & { bytes?: Uint8Array }) { return media.bytes ? new Blob([media.bytes.buffer.slice(media.bytes.byteOffset, media.bytes.byteOffset + media.bytes.byteLength) as ArrayBuffer], { type: media.contentType }) : undefined; }
/** Space library rows live in the same kernel store: `library:<spaceId>` and `library-bytes:<itemId>`. */
export class IndexedDbSpaceLibraryStore implements SpaceLibraryStore {
  async loadLibrary(spaceId: string) { return (await get(`library:${spaceId}`))?.value as SpaceLibrary | undefined; }
  async saveLibrary(library: SpaceLibrary) { await put({ key: `library:${library.spaceId}`, value: library }); }
  async loadItemBytes(itemId: string) { return (await get(`library-bytes:${itemId}`))?.value as Uint8Array | undefined; }
  async saveItemBytes(itemId: string, bytes: Uint8Array) { await put({ key: `library-bytes:${itemId}`, value: bytes }); }
  async deleteLibrary(spaceId: string) { await remove(`library:${spaceId}`); }
  async deleteItemBytes(itemId: string) { await remove(`library-bytes:${itemId}`); }
}
export function libraryItemBlob(bytes: Uint8Array, contentType: string) { return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: contentType }); }
