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
