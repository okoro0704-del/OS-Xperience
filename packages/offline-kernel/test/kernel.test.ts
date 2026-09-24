import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryLastValidStore,
  acceptProjection,
  descriptor,
  loadLastValid,
  resolveCurrentNext,
  synchronizeProjection,
  type LocalAssetState,
  type ScheduleProjection,
} from "../src/index.ts";

const program = (id: string, start: string, end: string, asset: LocalAssetState = "AVAILABLE_LOCAL") => ({
  id,
  stationId: "station",
  kind: "CONTENT" as const,
  startsAt: start,
  endsAt: end,
  assets: [asset],
});

const projection = (capability: "space.tv" | "space.radio", asset: LocalAssetState = "AVAILABLE_LOCAL", version = 1): ScheduleProjection => ({
  stations: [{
    id: capability,
    capability,
    programs: [
      program("first", "2026-01-01T10:00:00Z", "2026-01-01T10:30:00Z", asset),
      program("second", "2026-01-01T10:30:00Z", "2026-01-01T11:00:00Z", asset),
    ],
  }],
});

test("offline and online startup preserve valid local state", async () => {
  const store = new MemoryLastValidStore<ScheduleProjection>();
  const saved = { version: 2, updatedAt: "2026-01-01T10:00:00Z", value: projection("space.tv") };
  await store.save("tv", saved);
  assert.deepEqual(await loadLastValid(store, "tv"), saved);
  assert.equal(await loadLastValid(store, "missing"), undefined);
  const online = await synchronizeProjection(store, "tv", { fetch: async (currentVersion) => {
    assert.equal(currentVersion, 2);
    return { version: 3, updatedAt: "2026-01-01T11:00:00Z", value: projection("space.tv") };
  } });
  assert.equal(online?.version, 3);
});

test("sync failure and corrupt storage retain no fabricated projection", async () => {
  const store = new MemoryLastValidStore<ScheduleProjection>();
  await store.save("tv", { version: 2, updatedAt: "x", value: projection("space.tv") });
  const retained = await synchronizeProjection(store, "tv", { fetch: async () => { throw new Error("network down"); } });
  assert.equal(retained?.version, 2);
  const corrupt = { async load() { throw new Error("corrupt"); }, async save() {} };
  assert.equal(await loadLastValid(corrupt, "broken"), undefined);
});

test("version arbitration accepts newer valid data and rejects older or invalid data", async () => {
  const store = new MemoryLastValidStore<ScheduleProjection>();
  await acceptProjection(store, "tv", { version: 2, updatedAt: "x", value: projection("space.tv") });
  assert.equal((await acceptProjection(store, "tv", { version: 1, updatedAt: "x", value: { stations: [] } }))?.version, 2);
  assert.equal((await acceptProjection(store, "tv", { version: 3, updatedAt: "x", value: projection("space.tv") }))?.version, 3);
  assert.equal((await acceptProjection(store, "tv", undefined as never))?.version, 3);
});

test("TV and Radio capability truth is shared and honest", () => {
  for (const capability of ["space.tv", "space.radio"] as const) {
    assert.equal(descriptor(capability, { version: 1, updatedAt: "x", value: projection(capability) }).state, "AVAILABLE");
    assert.equal(descriptor(capability, { version: 1, updatedAt: "x", value: projection(capability, "REMOTE_ONLY") }).state, "DEGRADED");
    assert.equal(descriptor(capability, { version: 1, updatedAt: "x", value: projection(capability, "MISSING") }).state, "DEGRADED");
    assert.equal(descriptor(capability, { version: 1, updatedAt: "x", value: { stations: [] } }).state, "UNAVAILABLE");
  }
  assert.equal(descriptor("space.call").state, "NOT_IMPLEMENTED");
  assert.equal(descriptor("unknown.capability").state, "UNAVAILABLE");
});

test("CURRENT/NEXT uses exact schedule boundaries", () => {
  const programs = projection("space.tv").stations[0]!.programs;
  assert.equal(resolveCurrentNext(programs, new Date("2026-01-01T10:00:00Z")).current?.id, "first");
  assert.equal(resolveCurrentNext(programs, new Date("2026-01-01T10:30:00Z")).current?.id, "second");
  assert.equal(resolveCurrentNext(programs, new Date("2026-01-01T09:59:00Z")).next?.id, "first");
});
