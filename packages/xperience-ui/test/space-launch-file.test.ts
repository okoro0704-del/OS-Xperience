import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryBroadcastHydrationStore, hydrateAndPrepareSpaceTv, type BroadcastHydrationSource } from "@digiconomy/offline-kernel";
import {
  SPACE_LAUNCH_MAX_BYTES,
  generateCatalogSigningKeyPair,
  serializeSpaceLaunchFile,
  signExperienceCatalog,
  signSpaceLaunchFile,
  type CatalogExperienceEntry,
  type DirectoryApplicationView,
  type SpaceLaunchPayload,
  type TrustedSpacePublisher,
} from "@digiconomy/xperience-contract";
import {
  BUNDLED_SPACE_PUBLISHERS,
  MYBRANDOS_PUBLIC_ENTRY,
  MYBRANDOS_PUBLIC_ID,
  SPACE_REGISTRY_KEY,
  classifySpaceReadiness,
  clearMemoryKvStore,
  importSpaceLaunchFile,
  memoryKvStore,
  providerTargets,
  readSpaceRegistrations,
  registryToDirectoryView,
  removeSpaceRegistration,
  requireExecutionTarget,
  setKvStoreForTests,
  setTrustedSpacePublishersForTests,
  spaceLocallyPlayable,
  storeSignedCatalog,
  xperienceAppEntries,
  xperienceSpaceCandidates,
  type KvStore,
} from "../src/local/index.ts";

const fixturePath = new URL("../../../apps/os-experience/public/spaces/mrfundzman.space", import.meta.url);
const fixture = readFileSync(fixturePath);
const channelId = "mrfundzman.tv";
const xperienceVersion = "0.3.6";

type Signer = { keyId: string; privateKey: CryptoKey; publicKeySpkiBase64: string };

async function signer(keyId: string): Promise<Signer> {
  const pair = await generateCatalogSigningKeyPair();
  return { keyId, privateKey: pair.privateKey, publicKeySpkiBase64: pair.publicKeySpkiBase64 };
}

function publisher(publisherId: string, keys: Signer[], providers = [MYBRANDOS_PUBLIC_ID]): TrustedSpacePublisher {
  return { publisherId, name: publisherId, keys: keys.map((key) => ({ keyId: key.keyId, publicKeySpkiBase64: key.publicKeySpkiBase64 })), providers };
}

function payload(patch: Partial<SpaceLaunchPayload> = {}): SpaceLaunchPayload {
  return {
    providerId: MYBRANDOS_PUBLIC_ID,
    publisherId: "test-publisher",
    version: "1.0.0",
    presentation: { name: "MrFundzMan" },
    execution: { mode: "SPACE", broadcastChannelId: channelId },
    capabilities: ["space.tv"],
    preparation: { kind: "BROADCAST" },
    compatibility: { minimumXperienceVersion: "0.3.6", minimumSpaceRuntimeVersion: 1 },
    ...patch,
  };
}

async function launchFile(key: Signer, patch: Partial<SpaceLaunchPayload> = {}): Promise<string> {
  return serializeSpaceLaunchFile(await signSpaceLaunchFile(payload(patch), key));
}

/** Signs whatever object it is given — used to prove the schema, not the signature, rejects it. */
async function signedRaw(key: Signer, raw: Record<string, unknown>): Promise<string> {
  const signed = await signSpaceLaunchFile(raw as unknown as SpaceLaunchPayload, key);
  return JSON.stringify(signed);
}

let key: Signer;
let fetchCalls = 0;
const realFetch = globalThis.fetch;

function appOnlyBootstrap() {
  (globalThis as { window?: unknown }).window = { __oxBootstrapEntry: { ...MYBRANDOS_PUBLIC_ENTRY, executionModes: [{ mode: "APP" }] } };
}

function bundledView(): DirectoryApplicationView {
  const entry = (globalThis as { window?: { __oxBootstrapEntry?: typeof MYBRANDOS_PUBLIC_ENTRY } }).window?.__oxBootstrapEntry ?? MYBRANDOS_PUBLIC_ENTRY;
  return registryToDirectoryView(entry);
}

function preparedSource(): BroadcastHydrationSource {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  return {
    async fetchSchedule() {
      return { channelId, publisherId: "mrfundzman", scheduleId: "s", scheduleVersion: 1, programs: [{ programId: "p0", mediaId: "m0", scheduledStart: new Date(Date.now() - 10_000).toISOString(), durationMs: 600_000, sequence: 0 }] };
    },
    async fetchMedia(mediaId) {
      return { mediaId, publisherId: "mrfundzman", title: mediaId, durationMs: 600_000, version: "1", contentType: "video/mp4", byteLength: bytes.byteLength, checksum: "sha", availability: "REMOTE_ONLY", bytes, integrityVerified: true };
    },
  };
}

test.beforeEach(async () => {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
  delete (globalThis as { window?: unknown }).window;
  key = await signer("test-key-1");
  setTrustedSpacePublishersForTests([publisher("test-publisher", [key])]);
  fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network used"); }) as typeof fetch;
});

test.after(() => {
  setKvStoreForTests(null);
  setTrustedSpacePublishersForTests(null);
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
});

test("1. the real signed mrfundzman.space imports against the pinned mybrandOS key", async () => {
  setTrustedSpacePublishersForTests(null);
  assert.equal(BUNDLED_SPACE_PUBLISHERS[0]!.publisherId, "mybrandos");
  assert.ok(fixture.byteLength < 2048, `launch file is ${fixture.byteLength} bytes`);
  const result = await importSpaceLaunchFile(new Uint8Array(fixture), { xperienceVersion });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.outcome, "REGISTERED");
  assert.deepEqual(
    { provider: result.registration.providerId, publisher: result.registration.publisherName, version: result.registration.version, channel: result.registration.broadcastChannelId, bytes: result.registration.byteLength },
    { provider: MYBRANDOS_PUBLIC_ID, publisher: "mybrandOS", version: "1.0.0", channel: channelId, bytes: fixture.byteLength },
  );
});

test("2. a tampered payload is rejected and never registered", async () => {
  setTrustedSpacePublishersForTests(null);
  const tampered = fixture.toString("utf8").replace('"MrFundzMan"', '"FakeTV"');
  assert.equal((await importSpaceLaunchFile(tampered, { xperienceVersion })).ok, false);
  assert.equal((await importSpaceLaunchFile(tampered, { xperienceVersion }) as { code: string }).code, "INTEGRITY_FAILED");
  const file = JSON.parse(tampered);
  const { spaceLaunchSignedContent } = await import("@digiconomy/xperience-contract");
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(spaceLaunchSignedContent(file)))).toString("hex");
  file.integrity.digest = digest;
  const result = await importSpaceLaunchFile(JSON.stringify(file), { xperienceVersion });
  assert.equal(result.ok ? "REGISTERED" : result.code, "SIGNATURE_INVALID", "a recomputed digest does not forge the signature");
  assert.deepEqual(readSpaceRegistrations(), []);
});

test("3. an invalid signature is rejected", async () => {
  const forged = JSON.parse(await launchFile(key));
  const other = JSON.parse(await launchFile(key, { version: "9.9.9" }));
  forged.signature.value = other.signature.value;
  assert.equal((await importSpaceLaunchFile(JSON.stringify(forged), { xperienceVersion }) as { code: string }).code, "SIGNATURE_INVALID");
  const impostor = await signer("test-key-1");
  const result = await importSpaceLaunchFile(await launchFile(impostor), { xperienceVersion });
  assert.equal(result.ok ? "REGISTERED" : result.code, "SIGNATURE_INVALID", "a valid signature from an unpinned key under a pinned key id");
  assert.deepEqual(readSpaceRegistrations(), []);
});

test("4. an unknown publisher or key is rejected", async () => {
  const stranger = await launchFile(key, { publisherId: "stranger" });
  assert.equal((await importSpaceLaunchFile(stranger, { xperienceVersion }) as { code: string }).code, "PUBLISHER_UNKNOWN");
  const unknownKey = await launchFile(await signer("test-key-2"));
  assert.equal((await importSpaceLaunchFile(unknownKey, { xperienceVersion }) as { code: string }).code, "PUBLISHER_UNKNOWN");
  assert.deepEqual(readSpaceRegistrations(), []);
});

test("5. malformed launch files are rejected as INVALID_FORMAT", async () => {
  const valid = await launchFile(key);
  const cases: Array<[string, string]> = [
    ["not json", "{ this is not json"],
    ["array", "[]"],
    ["wrong format", valid.replace('"digiconomy.space"', '"digiconomy.app"')],
    ["duplicate identity field", valid.replace(`"providerId": "${MYBRANDOS_PUBLIC_ID}",`, `"providerId": "${MYBRANDOS_PUBLIC_ID}", "providerId": "other.provider",`)],
    ["malformed hash", valid.replace(/"digest": "[0-9a-f]+"/, '"digest": "zz"')],
    ["malformed signature", valid.replace(/"value": "[^"]+"/, '"value": "not-base64!"')],
    ["invalid utf-8", String.fromCharCode(0xff)],
  ];
  for (const [name, text] of cases) {
    const input = name === "invalid utf-8" ? new Uint8Array([0x7b, 0xff, 0x7d]) : text;
    const result = await importSpaceLaunchFile(input, { xperienceVersion });
    assert.equal(result.ok ? "REGISTERED" : result.code, "INVALID_FORMAT", name);
  }
  const signedButInvalid: Array<[string, Partial<SpaceLaunchPayload> | Record<string, unknown>]> = [
    ["path traversal id", { providerId: "../bootstrap.mybrandos.public" }],
    ["http endpoint", { preparation: { kind: "BROADCAST", endpoint: "http://insecure.example/" } }],
    ["javascript icon", { presentation: { name: "X", icon: "javascript:alert(1)" } }],
    ["credentialed endpoint", { preparation: { kind: "BROADCAST", endpoint: "https://user:pass@example.com/" } }],
    ["non-semver version", { version: "latest" }],
    ["missing capability", { capabilities: [] }],
  ];
  for (const [name, patch] of signedButInvalid) {
    const result = await importSpaceLaunchFile(await signedRaw(key, { ...payload(), ...patch }), { xperienceVersion });
    assert.equal(result.ok ? "REGISTERED" : result.code, "INVALID_FORMAT", name);
  }
  assert.deepEqual(readSpaceRegistrations(), []);
});

test("6. an unsupported schema version is rejected", async () => {
  const file = JSON.parse(await launchFile(key));
  file.schemaVersion = 2;
  assert.equal((await importSpaceLaunchFile(JSON.stringify(file), { xperienceVersion }) as { code: string }).code, "UNSUPPORTED_SCHEMA");
});

test("7 / 25. an unsupported Space runtime version or capability is rejected", async () => {
  const runtime = await launchFile(key, { compatibility: { minimumXperienceVersion: "0.3.6", minimumSpaceRuntimeVersion: 2 } });
  assert.equal((await importSpaceLaunchFile(runtime, { xperienceVersion }) as { code: string }).code, "INCOMPATIBLE_RUNTIME");
  const capability = await launchFile(key, { capabilities: ["space.tv", "space.call"] });
  assert.equal((await importSpaceLaunchFile(capability, { xperienceVersion }) as { code: string }).code, "INCOMPATIBLE_RUNTIME");
  assert.deepEqual(readSpaceRegistrations(), []);
});

test("8. an oversized launch file is rejected before parsing", async () => {
  const padded = (await launchFile(key)).replace("{", `{${" ".repeat(SPACE_LAUNCH_MAX_BYTES)}`);
  const result = await importSpaceLaunchFile(padded, { xperienceVersion });
  assert.deepEqual(result.ok ? null : [result.code, result.stage], ["LAUNCH_FILE_TOO_LARGE", "RECEIVED"]);
});

test("9. importing the same Space and version again is deterministic and changes nothing", async () => {
  const file = await launchFile(key);
  assert.equal((await importSpaceLaunchFile(file, { xperienceVersion })).ok, true);
  const before = memoryKvStore.getItem(SPACE_REGISTRY_KEY);
  for (let i = 0; i < 2; i += 1) {
    const again = await importSpaceLaunchFile(file, { xperienceVersion });
    assert.equal(again.ok ? "REGISTERED" : again.code, "ALREADY_INSTALLED");
  }
  assert.equal(memoryKvStore.getItem(SPACE_REGISTRY_KEY), before);
});

test("10. upgrades need explicit consent and downgrades are rejected", async () => {
  assert.equal((await importSpaceLaunchFile(await launchFile(key, { version: "1.0.0" }), { xperienceVersion })).ok, true);
  const newer = await launchFile(key, { version: "1.1.0" });
  const offered = await importSpaceLaunchFile(newer, { xperienceVersion });
  assert.deepEqual(offered.ok ? null : [offered.code, offered.offeredVersion], ["UPDATE_AVAILABLE", "1.1.0"]);
  assert.equal(readSpaceRegistrations()[0]!.version, "1.0.0", "never silently overwritten");
  const updated = await importSpaceLaunchFile(newer, { xperienceVersion, acceptUpdate: true });
  assert.equal(updated.ok ? updated.outcome : updated.code, "UPDATED");
  const older = await importSpaceLaunchFile(await launchFile(key, { version: "1.0.0" }), { xperienceVersion, acceptUpdate: true });
  assert.equal(older.ok ? "REGISTERED" : older.code, "DOWNGRADE_REJECTED");
  assert.equal(readSpaceRegistrations()[0]!.version, "1.1.0");
});

test("11. identity collisions are rejected", async () => {
  const rival = await signer("rival-key");
  setTrustedSpacePublishersForTests([publisher("test-publisher", [key]), publisher("rival", [rival]), publisher("outsider", [rival], ["other.provider"])]);
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const otherPublisher = await importSpaceLaunchFile(await launchFile(rival, { publisherId: "rival", version: "2.0.0" }), { xperienceVersion, acceptUpdate: true });
  assert.equal(otherPublisher.ok ? "REGISTERED" : otherPublisher.code, "IDENTITY_CONFLICT", "a second publisher cannot claim the provider");
  const unauthorized = await importSpaceLaunchFile(await launchFile(rival, { publisherId: "outsider" }), { xperienceVersion });
  assert.equal(unauthorized.ok ? "REGISTERED" : unauthorized.code, "IDENTITY_CONFLICT", "a publisher may only describe its own providers");
  const sameVersionDifferent = await importSpaceLaunchFile(await launchFile(key, { presentation: { name: "Changed" } }), { xperienceVersion });
  assert.equal(sameVersionDifferent.ok ? "REGISTERED" : sameVersionDifferent.code, "IDENTITY_CONFLICT", "one version, one content");
  clearMemoryKvStore();
  const wrongChannel = await importSpaceLaunchFile(await launchFile(key, { execution: { mode: "SPACE", broadcastChannelId: "other.tv" } }), { xperienceVersion });
  assert.equal(wrongChannel.ok ? "REGISTERED" : wrongChannel.code, "IDENTITY_CONFLICT", "the bundled provider already owns mrfundzman.tv");
  const unknownProvider = await importSpaceLaunchFile(await launchFile(rival, { publisherId: "outsider", providerId: "other.provider", execution: { mode: "SPACE", broadcastChannelId: "other.tv" } }), { xperienceVersion });
  assert.equal(unknownProvider.ok ? "REGISTERED" : unknownProvider.code, "PROVIDER_UNKNOWN", "a launch file never invents a provider identity");
  assert.deepEqual(readSpaceRegistrations(), []);
});

test("12. arbitrary executable or APP payloads are not accepted", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["script in payload", { ...payload(), script: "fetch('https://evil.example')" }],
    ["code in execution", { ...payload(), execution: { mode: "SPACE", broadcastChannelId: channelId, entry: "main.js" } }],
    ["APP target", { ...payload(), execution: { mode: "APP", broadcastChannelId: channelId } }],
    ["credentials", { ...payload(), preparation: { kind: "BROADCAST", token: "secret" } }],
  ];
  for (const [name, raw] of cases) {
    const result = await importSpaceLaunchFile(await signedRaw(key, raw), { xperienceVersion });
    assert.equal(result.ok ? "REGISTERED" : result.code, "INVALID_FORMAT", name);
  }
  const outer = JSON.parse(await launchFile(key));
  outer.bundle = "PGh0bWw+";
  assert.equal((await importSpaceLaunchFile(JSON.stringify(outer), { xperienceVersion }) as { code: string }).code, "INVALID_FORMAT");
});

test("13 / 14 / 15. registration ≠ prepared ≠ READY OFFLINE; preparation reaches READY OFFLINE", async () => {
  appOnlyBootstrap();
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const [candidate] = xperienceSpaceCandidates([bundledView()]);
  assert.ok(candidate?.target, "registered Space appears in Xperience Space");
  const store = new MemoryBroadcastHydrationStore();
  const classify = async (online: boolean) => classifySpaceReadiness({ released: true, offlineCapability: candidate.app.offlineCapability, channelId: candidate.channelId, locallyPlayable: await spaceLocallyPlayable(store, channelId), online });
  assert.equal((await classify(true)).readiness, "NOT_PREPARED", "registered but unprepared is NOT PREPARED");
  assert.equal((await classify(false)).readiness, "ONLINE_PREPARATION_REQUIRED");
  const prepared = await hydrateAndPrepareSpaceTv({ channelId, routeAvailable: true, now: () => new Date(), store, source: preparedSource() });
  assert.equal(prepared.state, "LOCAL_PLAYING");
  assert.equal((await classify(false)).readiness, "READY_OFFLINE");
});

test("16 / 17. an imported Space launches strict SPACE and never becomes or falls back to APP", async () => {
  appOnlyBootstrap();
  const view = bundledView();
  const appsBefore = xperienceAppEntries([view], true).length;
  assert.equal(requireExecutionTarget(providerTargets({ id: view.id, entrypoint: view.xperienceUrl, executionModes: view.executionModes }), "SPACE"), null);
  assert.deepEqual(xperienceSpaceCandidates([view]), []);

  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const targets = providerTargets({ id: view.id, entrypoint: view.xperienceUrl, executionModes: view.executionModes });
  const space = requireExecutionTarget(targets, "SPACE");
  assert.deepEqual([space?.executionMode, space?.providerId, space?.broadcastChannelId], ["SPACE", MYBRANDOS_PUBLIC_ID, channelId]);
  assert.equal(xperienceAppEntries([view], true).length, appsBefore, "import creates no APP target");
  assert.deepEqual(targets.map((target) => target.executionMode).sort(), ["APP", "SPACE"], "same provider identity for APP and SPACE");

  assert.equal(removeSpaceRegistration(MYBRANDOS_PUBLIC_ID), true);
  const after = providerTargets({ id: view.id, entrypoint: view.xperienceUrl, executionModes: view.executionModes });
  assert.equal(requireExecutionTarget(after, "SPACE"), null, "no silent APP substitute for a removed Space");
});

test("18 / 19 / 20. import, registration and offline readiness use no network, no TrustID and no PDI", async () => {
  appOnlyBootstrap();
  const writes: string[] = [];
  const recording: KvStore = { getItem: (k) => memoryKvStore.getItem(k), setItem: (k, v) => { writes.push(k); memoryKvStore.setItem(k, v); }, removeItem: (k) => memoryKvStore.removeItem(k) };
  setKvStoreForTests(recording);
  const result = await importSpaceLaunchFile(await launchFile(key), { xperienceVersion });
  assert.equal(result.ok, true);
  const store = new MemoryBroadcastHydrationStore();
  await hydrateAndPrepareSpaceTv({ channelId, routeAvailable: true, now: () => new Date(), store, source: preparedSource() });
  assert.equal(await spaceLocallyPlayable(store, channelId), true);
  assert.equal(fetchCalls, 0, "no request — no App probe, no producer, no identity service");
  assert.deepEqual([...new Set(writes)], [SPACE_REGISTRY_KEY]);
  assert.ok(!writes.some((name) => /trust|pdi|identity|session|owner|admin/i.test(name)));
});

test("21 / 22. restart preserves the registration and prepared readiness", async () => {
  appOnlyBootstrap();
  const disk = new Map<string, string>();
  const boot = (): KvStore => ({ getItem: (k) => disk.get(k) ?? null, setItem: (k, v) => void disk.set(k, v), removeItem: (k) => void disk.delete(k) });
  setKvStoreForTests(boot());
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const kernel = new MemoryBroadcastHydrationStore();
  await hydrateAndPrepareSpaceTv({ channelId, routeAvailable: true, now: () => new Date(), store: kernel, source: preparedSource() });

  setKvStoreForTests(boot());
  const restartedKernel = new MemoryBroadcastHydrationStore();
  restartedKernel.schedules = new Map(kernel.schedules);
  restartedKernel.media = new Map(kernel.media);
  const view = bundledView();
  assert.equal(readSpaceRegistrations()[0]?.providerId, MYBRANDOS_PUBLIC_ID);
  assert.ok(requireExecutionTarget(providerTargets({ id: view.id, entrypoint: view.xperienceUrl, executionModes: view.executionModes }), "SPACE"));
  assert.equal(await spaceLocallyPlayable(restartedKernel, channelId), true, "READY OFFLINE survives restart with no route");
});

test("23. a corrupted local registration fails safely", async () => {
  appOnlyBootstrap();
  const view = bundledView();
  const spaceTarget = () => requireExecutionTarget(providerTargets({ id: view.id, entrypoint: view.xperienceUrl, executionModes: view.executionModes }), "SPACE");
  for (const corrupt of ["{not json", JSON.stringify({ schemaVersion: 1, entries: [{ launchFile: { format: "digiconomy.space" }, registeredAt: "x", byteLength: 1 }] }), JSON.stringify({ schemaVersion: 9, entries: [] })]) {
    memoryKvStore.setItem(SPACE_REGISTRY_KEY, corrupt);
    assert.deepEqual(readSpaceRegistrations(), []);
    assert.equal(spaceTarget(), null);
  }
  const stored = JSON.parse(await launchFile(key));
  stored.payload.publisherId = "evil";
  memoryKvStore.setItem(SPACE_REGISTRY_KEY, JSON.stringify({ schemaVersion: 1, entries: [{ launchFile: stored, registeredAt: "x", byteLength: 1 }] }));
  assert.deepEqual(readSpaceRegistrations(), [], "a registration no longer bound to a pinned publisher is ignored");
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true, "a fresh verified import recovers");
  assert.ok(spaceTarget());
});

test("24. an incompatible minimum OS Xperience version is rejected", async () => {
  const file = await launchFile(key, { compatibility: { minimumXperienceVersion: "0.4.0", minimumSpaceRuntimeVersion: 1 } });
  const result = await importSpaceLaunchFile(file, { xperienceVersion });
  assert.deepEqual(result.ok ? null : [result.code, result.stage], ["INCOMPATIBLE_XPERIENCE", "COMPATIBILITY_CHECK"]);
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion: "0.3.5" }) as { code: string }).code, "INCOMPATIBLE_XPERIENCE");
});

test("a launch file never releases a mode the signed catalog does not", async () => {
  appOnlyBootstrap();
  const catalogKeys = await generateCatalogSigningKeyPair();
  const now = new Date().toISOString();
  const entry: CatalogExperienceEntry = {
    experienceId: MYBRANDOS_PUBLIC_ID, name: "mybrandOS", version: "1.0.0", entrypoint: MYBRANDOS_PUBLIC_ENTRY.entrypoint, origin: MYBRANDOS_PUBLIC_ENTRY.origin,
    authMode: "PUBLIC", offlineCapability: "PARTIAL", releaseState: "LIVE", visibility: "LISTED", preloadPolicy: "NONE", packageVersion: "1", contentHash: "sha256:x", updatedAt: now,
    executionModes: [{ mode: "APP" }],
  };
  const catalog = await signExperienceCatalog({ manifestVersion: 1, generatedAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), experiences: [entry] }, catalogKeys.privateKey);
  assert.equal((await storeSignedCatalog(catalog, catalogKeys.publicKeySpkiBase64)).ok, true);
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const view = bundledView();
  assert.equal(requireExecutionTarget(providerTargets({ id: view.id, entrypoint: view.xperienceUrl, executionModes: view.executionModes }), "SPACE"), null);
});

test("an arbitrary application/octet-stream pick never becomes a Space", async () => {
  setTrustedSpacePublishersForTests(null);
  const picks: Array<[string, Uint8Array | string]> = [
    ["invalid UTF-8", new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0xc3, 0x28])],
    ["PNG header", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])],
    ["MP4 header", new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])],
    ["plain text", "mrfundzman.space"],
    ["empty", new Uint8Array()],
    ["JSON array", "[1,2,3]"],
    ["unrelated JSON", JSON.stringify({ providerId: MYBRANDOS_PUBLIC_ID, execution: { mode: "SPACE", broadcastChannelId: channelId } })],
  ];
  for (const [label, bytes] of picks) {
    const result = await importSpaceLaunchFile(bytes, { xperienceVersion });
    assert.equal(result.ok ? "REGISTERED" : result.code, "INVALID_FORMAT", label);
  }
  assert.deepEqual(readSpaceRegistrations(), []);
  assert.equal(fetchCalls, 0);
});

test("removing a registration removes only that discovery source; SPACE stays SPACE", async () => {
  setTrustedSpacePublishersForTests(null);
  appOnlyBootstrap();
  const catalogKeys = await generateCatalogSigningKeyPair();
  const now = new Date().toISOString();
  const entry: CatalogExperienceEntry = {
    experienceId: MYBRANDOS_PUBLIC_ID, name: "mybrandOS", version: "1.0.0", entrypoint: MYBRANDOS_PUBLIC_ENTRY.entrypoint, origin: MYBRANDOS_PUBLIC_ENTRY.origin,
    authMode: "PUBLIC", offlineCapability: "PARTIAL", releaseState: "LIVE", visibility: "LISTED", preloadPolicy: "NONE", packageVersion: "1", contentHash: "sha256:x", updatedAt: now,
    executionModes: [{ mode: "APP" }, { mode: "SPACE", broadcastChannelId: channelId }],
  };
  const catalog = await signExperienceCatalog({ manifestVersion: 1, generatedAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), experiences: [entry] }, catalogKeys.privateKey);
  assert.equal((await storeSignedCatalog(catalog, catalogKeys.publicKeySpkiBase64)).ok, true);
  const view = bundledView();
  const spaceTarget = () => requireExecutionTarget(providerTargets({ id: view.id, entrypoint: view.xperienceUrl, executionModes: view.executionModes }), "SPACE");

  assert.equal(spaceTarget()?.executionMode, "SPACE", "the signed catalog releases SPACE on its own");
  assert.equal((await importSpaceLaunchFile(new Uint8Array(fixture), { xperienceVersion })).ok, true);
  assert.equal(removeSpaceRegistration(MYBRANDOS_PUBLIC_ID), true);
  assert.deepEqual(readSpaceRegistrations(), []);
  const space = spaceTarget();
  assert.deepEqual([space?.executionMode, space?.broadcastChannelId], ["SPACE", channelId], "the catalog source still resolves the Space");
});
