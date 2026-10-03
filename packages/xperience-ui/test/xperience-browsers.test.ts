import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBroadcastHydrationStore, type BroadcastMedia, type BroadcastSchedule } from "@digiconomy/offline-kernel";
import type { DirectoryApplicationView } from "@digiconomy/xperience-contract";
import { resetReleaseCatalogForTests } from "../../../api/src/release-catalog.js";
import {
  exportGeneratedCatalogKeysForTests,
  resetCatalogSigningKeysForTests,
} from "../../../api/src/catalog-keys.js";
import {
  MYBRANDOS_PUBLIC_ID,
  SPACE_READINESS_LABEL,
  applyCatalogUpdate,
  bootFromLocal,
  chooseExecutionTarget,
  classifySpaceReadiness,
  clearMemoryKvStore,
  memoryKvStore,
  providerTargets,
  requireExecutionTarget,
  setKvStoreForTests,
  spaceLocallyPlayable,
  storeCatalogPublicKey,
  xperienceAppEntries,
  xperienceSpaceCandidates,
} from "../src/local/index.ts";

async function reset() {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
  resetCatalogSigningKeysForTests();
  const catalog = resetReleaseCatalogForTests();
  const keys = await exportGeneratedCatalogKeysForTests();
  storeCatalogPublicKey(keys.publicKeySpkiBase64);
  return {
    async publish() {
      const signed = await catalog.buildDeviceSignedCatalog();
      assert.equal((await applyCatalogUpdate(signed, { publicKeySpki: keys.publicKeySpkiBase64 })).ok, true);
    },
  };
}

test.beforeEach(async () => {
  await reset();
});

test.after(() => {
  setKvStoreForTests(null);
});

function view(id: string, overrides: Partial<DirectoryApplicationView> = {}): DirectoryApplicationView {
  return {
    id,
    name: id,
    version: "1",
    origin: `https://${id}.example`,
    productionUrl: `https://${id}.example/`,
    xperienceUrl: `https://${id}.example/`,
    canManage: false,
    authMode: "PUBLIC",
    offlineCapability: "NONE",
    category: "Finance",
    capabilities: [],
    publicationState: "PUBLISHED",
    experienced: false,
    ...overrides,
  };
}

/** The bootstrap MrFundzMan provider exactly as a fresh, network-free installation holds it. */
function bundledProvider() {
  const provider = bootFromLocal({ online: false, restoreOnFirstOpen: false }).directory.find((app) => app.id === MYBRANDOS_PUBLIC_ID);
  assert.ok(provider, "fresh offline install must carry the bundled provider");
  return provider;
}

test("Apps lists only APP releases; Space lists only SPACE declarations; both are the same provider identity", () => {
  const mrfundzman = bundledProvider();
  const appOnly = view("fixture.app-only", { executionModes: [{ mode: "APP" }] });
  const spaceOnly = view("fixture.space-only", { offlineCapability: "FULL", executionModes: [{ mode: "SPACE" }] });
  const providers = [mrfundzman, appOnly, spaceOnly, mrfundzman];

  const apps = xperienceAppEntries(providers, true);
  assert.deepEqual(apps.map((entry) => entry.app.id), [MYBRANDOS_PUBLIC_ID, appOnly.id]);
  assert.ok(apps.every((entry) => entry.target.executionMode === "APP"));

  const spaces = xperienceSpaceCandidates(providers);
  assert.deepEqual(spaces.map((entry) => entry.app.id), [MYBRANDOS_PUBLIC_ID, spaceOnly.id]);
  assert.ok(spaces.every((entry) => entry.target?.executionMode === "SPACE"));
  assert.equal(spaces[0]!.channelId, "mrfundzman.tv");
  assert.equal(apps[0]!.target.providerId, spaces[0]!.target!.providerId, "App and Space are one provider identity");
});

test("APP is network-first: offline it is honestly connection-required, never re-labelled as Space", () => {
  const [entry] = xperienceAppEntries([bundledProvider()], false);
  assert.equal(entry!.availability, "CONNECTION_REQUIRED");
  assert.equal(entry!.target.executionMode, "APP");
});

test("unknown live Directory records are discoverable only — never executable from Xperience", async () => {
  const { publish } = await reset();
  await publish();
  const unknown = view("ins_unknown0000000001");
  const lookalikeSpace = view("ins_lookalike00000001", { executionModes: [{ mode: "APP" }, { mode: "SPACE", broadcastChannelId: "mrfundzman.tv" }] });
  assert.deepEqual(xperienceAppEntries([unknown, lookalikeSpace], true), []);
  const spaces = xperienceSpaceCandidates([unknown, lookalikeSpace]);
  assert.deepEqual(spaces.map((entry) => entry.app.id), [lookalikeSpace.id]);
  assert.equal(spaces[0]!.target, null, "a self-declared Space without a signed release is NOT RELEASED");
  assert.equal(classifySpaceReadiness({ released: false, offlineCapability: "FULL", channelId: "mrfundzman.tv", locallyPlayable: true, online: true }).readiness, "NOT_RELEASED");
  const signed = xperienceSpaceCandidates([bundledProvider()]);
  assert.equal(signed[0]!.target?.availability, "AVAILABLE", "the signed catalog still releases the canonical Space");
});

test("Space readiness states are truthful and derived from local preparation only", () => {
  const base = { released: true, offlineCapability: "PARTIAL" as const, channelId: "mrfundzman.tv" };
  assert.deepEqual(classifySpaceReadiness({ ...base, locallyPlayable: true, online: false }), { readiness: "READY_OFFLINE", enterable: true });
  assert.deepEqual(classifySpaceReadiness({ ...base, locallyPlayable: true, online: true }), { readiness: "READY_OFFLINE", enterable: true });
  assert.deepEqual(classifySpaceReadiness({ ...base, locallyPlayable: false, online: true }), { readiness: "NOT_PREPARED", enterable: true });
  assert.deepEqual(classifySpaceReadiness({ ...base, locallyPlayable: false, online: false }), { readiness: "ONLINE_PREPARATION_REQUIRED", enterable: false });
  assert.deepEqual(classifySpaceReadiness({ ...base, channelId: null, locallyPlayable: false, online: false }), { readiness: "PREPARED", enterable: true });
  assert.deepEqual(classifySpaceReadiness({ ...base, offlineCapability: "NONE", locallyPlayable: true, online: false }), { readiness: "ONLINE_PREPARATION_REQUIRED", enterable: false });
  assert.deepEqual(classifySpaceReadiness({ ...base, released: false, locallyPlayable: true, online: true }), { readiness: "NOT_RELEASED", enterable: false });
  assert.equal(SPACE_READINESS_LABEL.ONLINE_PREPARATION_REQUIRED, "ONLINE PREPARATION REQUIRED");
  assert.equal(SPACE_READINESS_LABEL.READY_OFFLINE, "READY OFFLINE");
});

test("first install with no internet: the bundled Space is listed and needs online preparation", async () => {
  const [candidate] = xperienceSpaceCandidates([bundledProvider()]);
  const playable = await spaceLocallyPlayable(new MemoryBroadcastHydrationStore(), candidate!.channelId!);
  assert.equal(playable, false);
  const { readiness } = classifySpaceReadiness({
    released: Boolean(candidate!.target),
    offlineCapability: candidate!.app.offlineCapability,
    channelId: candidate!.channelId,
    locallyPlayable: playable,
    online: false,
  });
  assert.equal(readiness, "ONLINE_PREPARATION_REQUIRED");
});

test("local playability is read-only kernel state: schedule plus on-air media, no route, no writes", async () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const store = new MemoryBroadcastHydrationStore();
  const schedule: BroadcastSchedule = {
    channelId: "mrfundzman.tv",
    publisherId: "mrfundzman",
    scheduleId: "mrfundzman-tv",
    scheduleVersion: 3,
    programs: [{ programId: "p0", mediaId: "content:a", scheduledStart: new Date(now.getTime() - 10_000).toISOString(), durationMs: 600_000, sequence: 0 }],
  };
  const media: BroadcastMedia = { mediaId: "content:a", publisherId: "mrfundzman", title: "content:a", durationMs: 600_000, version: "1", contentType: "video/quicktime", byteLength: 4, checksum: "abcd", availability: "AVAILABLE_LOCAL" };

  assert.equal(await spaceLocallyPlayable(store, "mrfundzman.tv", now), false, "nothing prepared");
  await store.saveSchedule(schedule);
  assert.equal(await spaceLocallyPlayable(store, "mrfundzman.tv", now), false, "schedule without on-air media is not offline-ready");
  await store.saveMedia(media);
  assert.equal(await spaceLocallyPlayable(store, "mrfundzman.tv", now), true);
  assert.equal(await spaceLocallyPlayable(store, "mrfundzman.tv", new Date(now.getTime() + 3_600_000)), false, "an expired schedule is not claimed as ready");
  assert.equal(store.schedules.size, 1);
  assert.equal(store.media.size, 1);
  assert.equal(store.schedules.get("mrfundzman.tv")?.scheduleVersion, 3);
});

test("explicit mode selection never substitutes the other mode", () => {
  const appOnly = providerTargets({ id: "fixture.app-only", entrypoint: "https://app.example/", executionModes: [{ mode: "APP" }] });
  const spaceOnly = providerTargets({ id: "fixture.space-only", entrypoint: "https://space.example/", executionModes: [{ mode: "SPACE" }] });
  assert.equal(chooseExecutionTarget(appOnly, "SPACE")?.executionMode, "APP", "unselected resume may pick what exists");
  assert.equal(requireExecutionTarget(appOnly, "SPACE"), null, "Space selection never opens the App");
  assert.equal(requireExecutionTarget(spaceOnly, "APP"), null, "App selection never opens the Space");
  assert.equal(requireExecutionTarget(appOnly, "APP")?.executionMode, "APP");
  assert.equal(requireExecutionTarget(spaceOnly, "SPACE", "APP"), null, "a locked fixed mode still wins");
});
