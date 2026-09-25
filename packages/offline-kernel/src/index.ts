export type CapabilityId = "space.tv" | "space.radio" | "space.call" | (string & {});
export type CapabilityState = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "NOT_IMPLEMENTED";
export type ConnectivityState = "ONLINE" | "OFFLINE";
export type LocalAssetState = "AVAILABLE_LOCAL" | "REMOTE_ONLY" | "MISSING" | "INVALID";
export type ProgramKind = "CONTENT" | "LIVE" | "REPLAY" | "ADVERTISEMENT" | "PLAYLIST" | "PRESENTER_SEGMENT";
export type Program = { id:string; stationId:string; kind:ProgramKind; startsAt:string; endsAt:string; assets:LocalAssetState[]; metadata?:Record<string,unknown> };
export type Station = { id:string; capability:CapabilityId; programs:Program[]; metadata?:Record<string,unknown> };
export type ScheduleProjection = { stations:Station[] };
export type VersionedProjection<T> = { version:number; updatedAt:string; value:T };
export type CapabilityDescriptor = { id:CapabilityId; version:string; state:CapabilityState; provider:string; reason?:string; localReady:boolean; networkRequired:boolean; lastSyncAt?:string; dataVersion?:number };
export interface LastValidStore<T> { load(key:string):Promise<VersionedProjection<T>|undefined>; save(key:string,value:VersionedProjection<T>):Promise<void>; remove?(key:string):Promise<void> }
export class MemoryLastValidStore<T> implements LastValidStore<T> { private values=new Map<string,VersionedProjection<T>>(); async load(k:string){return this.values.get(k)} async save(k:string,v:VersionedProjection<T>){this.values.set(k,v)} async remove(k:string){this.values.delete(k)} }
export interface ProjectionSource<T> { fetch(currentVersion?:number):Promise<VersionedProjection<T>> }
export function resolveCurrentNext(programs:readonly Program[], now=new Date()):{current?:Program;next?:Program}{const sorted=[...programs].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)); const time=now.getTime(); const current=sorted.find(p=>Date.parse(p.startsAt)<=time&&time<Date.parse(p.endsAt)); return {current,next:current?sorted.find(p=>Date.parse(p.startsAt)>=Date.parse(current.endsAt)):sorted.find(p=>Date.parse(p.startsAt)>time)}}
function stateFor(stations:Station[]):CapabilityState { if(!stations.length)return "UNAVAILABLE"; const current=stations.flatMap(s=>s.programs).some(p=>p.assets.every(a=>a==="AVAILABLE_LOCAL")); return current?"AVAILABLE":"DEGRADED" }
export function descriptor(id:CapabilityId, projection?:VersionedProjection<ScheduleProjection>):CapabilityDescriptor { if(id==="space.call")return {id,version:"1.0.0",state:"NOT_IMPLEMENTED",provider:"offline-kernel",localReady:false,networkRequired:false}; const stations=projection?.value.stations.filter(s=>s.capability===id)??[]; return {id,version:"1.0.0",state:stateFor(stations),provider:"offline-kernel",localReady:stations.length>0,networkRequired:false,dataVersion:projection?.version}; }
export async function loadLastValid(store:LastValidStore<ScheduleProjection>,key:string){try{return await store.load(key)}catch{return undefined}}
export async function acceptProjection(store:LastValidStore<ScheduleProjection>,key:string,incoming:VersionedProjection<ScheduleProjection>){if(!incoming||!Number.isFinite(incoming.version)||!Array.isArray(incoming.value?.stations))return await loadLastValid(store,key); const current=await loadLastValid(store,key); if(current&&incoming.version<=current.version)return current; await store.save(key,incoming); return incoming;}
/**
 * Synchronize a versioned schedule without replacing the last known-good
 * projection on a transport or source failure.
 */
export async function synchronizeProjection(
  store: LastValidStore<ScheduleProjection>,
  key: string,
  source: ProjectionSource<ScheduleProjection>,
): Promise<VersionedProjection<ScheduleProjection> | undefined> {
  const current = await loadLastValid(store, key);
  try {
    return await acceptProjection(store, key, await source.fetch(current?.version));
  } catch {
    return current;
  }
}

/** Canonical TV broadcast projection shared by APP and SPACE transports. */
export type BroadcastMedia = { mediaId:string; publisherId:string; title:string; durationMs:number; version:string; contentType:string; byteLength:number; checksum:string; availability:LocalAssetState };
export type BroadcastProgram = { programId:string; mediaId:string; scheduledStart:string; durationMs:number; sequence:number };
export type BroadcastSchedule = { channelId:string; publisherId:string; scheduleId:string; scheduleVersion:number; programs:readonly BroadcastProgram[] };
export type BroadcastNow = { currentProgram:BroadcastProgram; programStart:string; programEnd:string; offsetIntoProgramMs:number; nextProgram?:BroadcastProgram };
export type TvPlayback = { state:"LOCAL_PLAYING"; media:BroadcastMedia; offsetMs:number; nextProgram?:BroadcastProgram } | { state:"MISSING_ASSET"|"CORRUPT_ASSET"|"STALE_SCHEDULE"|"ONLINE_REQUIRED"; reason:string };

export function resolveBroadcastNow(schedule: BroadcastSchedule, now: Date): BroadcastNow | undefined {
  const at = now.getTime();
  const ordered = [...schedule.programs].sort((a,b) => a.sequence-b.sequence || Date.parse(a.scheduledStart)-Date.parse(b.scheduledStart));
  const index = ordered.findIndex((program) => {
    const start = Date.parse(program.scheduledStart); return start <= at && at < start + program.durationMs;
  });
  if (index < 0) return undefined;
  const currentProgram = ordered[index]!;
  const start = Date.parse(currentProgram.scheduledStart);
  return { currentProgram, programStart: new Date(start).toISOString(), programEnd: new Date(start + currentProgram.durationMs).toISOString(), offsetIntoProgramMs: at - start, nextProgram: ordered[index + 1] };
}

export function prepareSpaceTv(schedule: BroadcastSchedule, media: readonly BroadcastMedia[], now: Date, expectedScheduleVersion = schedule.scheduleVersion): TvPlayback {
  if (schedule.scheduleVersion !== expectedScheduleVersion) return { state:"STALE_SCHEDULE", reason:"LOCAL_SCHEDULE_VERSION_MISMATCH" };
  const current = resolveBroadcastNow(schedule, now);
  if (!current) return { state:"MISSING_ASSET", reason:"NO_SCHEDULED_PROGRAM" };
  const asset = media.find((item) => item.mediaId === current.currentProgram.mediaId);
  if (!asset || asset.availability === "MISSING") return { state:"MISSING_ASSET", reason:"LOCAL_MEDIA_NOT_PRESENT" };
  if (asset.availability === "INVALID") return { state:"CORRUPT_ASSET", reason:"LOCAL_MEDIA_INTEGRITY_FAILED" };
  if (asset.availability !== "AVAILABLE_LOCAL") return { state:"MISSING_ASSET", reason:"LOCAL_MEDIA_PARTIAL" };
  return { state:"LOCAL_PLAYING", media:asset, offsetMs:current.offsetIntoProgramMs, nextProgram:current.nextProgram };
}

/** Online TV uses the same resolver and deliberately does not fall back to local assets. */
export function prepareAppTv(schedule: BroadcastSchedule, now: Date, online: boolean): BroadcastNow | TvPlayback {
  if (!online) return { state:"ONLINE_REQUIRED", reason:"APP_TV_REQUIRES_ROUTE" };
  const current = resolveBroadcastNow(schedule, now);
  return current ?? { state:"MISSING_ASSET", reason:"NO_SCHEDULED_PROGRAM" };
}

export * from "./hydration.js";
export * from "./browser.js";
