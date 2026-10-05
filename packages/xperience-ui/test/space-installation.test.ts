import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryBroadcastHydrationStore, deletePreparedChannel, hydrateAndPrepareSpaceTv, type BroadcastHydrationSource } from "@digiconomy/offline-kernel";
import {
  generateCatalogSigningKeyPair,
  serializeSpaceLaunchFile,
  signExperienceCatalog,
  signSpaceLaunchFile,
  type CatalogExperienceEntry,
  type SpaceLaunchPayload,
  type TrustedSpacePublisher,
} from "@digiconomy/xperience-contract";
import {
  MYBRANDOS_PUBLIC_ENTRY,
  MYBRANDOS_PUBLIC_ID,
  SPACE_HOME_ENTRIES_KEY,
  SPACE_LAUNCH_ACTION,
  SPACE_LAUNCH_EXTRA,
  SPACE_REGISTRY_KEY,
  bundledSpaceArtifact,
  canInstallSpaceHomeEntry,
  classifySpaceReadiness,
  clearMemoryKvStore,
  findSpaceHomeEntry,
  importSpaceLaunchFile,
  memoryKvStore,
  readSpaceHomeEntries,
  readSpaceRegistrations,
  recordSpaceHomeEntry,
  registryToDirectoryView,
  removeSpaceHomeEntry,
  removeSpaceRegistration,
  resolveSpaceLaunch,
  setKvStoreForTests,
  setTrustedSpacePublishersForTests,
  spaceHomeEntryEligibility,
  spaceHomeEntryState,
  spaceInstallationStage,
  spaceLocallyPlayable,
  spaceShortcutId,
  spaceShortcutRequest,
  staleSpaceShortcuts,
  storeSignedCatalog,
  type KvStore,
  type SpaceHomeEntryHost,
} from "../src/local/index.ts";

const root = new URL("../../../", import.meta.url);
const fixture = readFileSync(new URL("apps/os-experience/public/spaces/mrfundzman.space", root));
const channelId = "mrfundzman.tv";
const xperienceVersion = "0.3.6";
const SECOND_ID = "test.second.space";
const SECOND_CHANNEL = "second.tv";

type Signer = { keyId: string; privateKey: CryptoKey; publicKeySpkiBase64: string };

async function signer(keyId: string): Promise<Signer> {
  const pair = await generateCatalogSigningKeyPair();
  return { keyId, privateKey: pair.privateKey, publicKeySpkiBase64: pair.publicKeySpkiBase64 };
}

function publisher(publisherId: string, keys: Signer[]): TrustedSpacePublisher {
  return { publisherId, name: publisherId, keys: keys.map((k) => ({ keyId: k.keyId, publicKeySpkiBase64: k.publicKeySpkiBase64 })), providers: [MYBRANDOS_PUBLIC_ID] };
}

async function launchFile(key: Signer, patch: Partial<SpaceLaunchPayload> = {}): Promise<string> {
  const payload: SpaceLaunchPayload = {
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
  return serializeSpaceLaunchFile(await signSpaceLaunchFile(payload, key));
}

const mybrandos = () => ({ id: MYBRANDOS_PUBLIC_ID, entrypoint: MYBRANDOS_PUBLIC_ENTRY.entrypoint, executionModes: MYBRANDOS_PUBLIC_ENTRY.executionModes });

function appOnlyBootstrap() {
  (globalThis as { window?: unknown }).window = { __oxBootstrapEntry: { ...MYBRANDOS_PUBLIC_ENTRY, executionModes: [{ mode: "APP" }] } };
}

function launch(spaceId: unknown, patch: Record<string, unknown> = {}) {
  return { action: SPACE_LAUNCH_ACTION, hasData: false, extraKeys: [SPACE_LAUNCH_EXTRA], spaceId, ...patch };
}

function catalogEntry(experienceId: string, name: string, modes: CatalogExperienceEntry["executionModes"]): CatalogExperienceEntry {
  return {
    experienceId, name, version: "1.0.0", entrypoint: `https://${experienceId}.example/`, origin: `https://${experienceId}.example/`,
    authMode: "PUBLIC", offlineCapability: "PARTIAL", releaseState: "LIVE", visibility: "LISTED", preloadPolicy: "NONE", packageVersion: "1", contentHash: "sha256:x",
    updatedAt: new Date().toISOString(), executionModes: modes,
  };
}

async function twoSpaceCatalog(secondName = "Second Space") {
  const keys = await generateCatalogSigningKeyPair();
  const now = new Date().toISOString();
  const experiences = [
    catalogEntry(MYBRANDOS_PUBLIC_ID, "MrFundzMan", [{ mode: "APP" }, { mode: "SPACE", broadcastChannelId: channelId }]),
    catalogEntry(SECOND_ID, secondName, [{ mode: "SPACE", broadcastChannelId: SECOND_CHANNEL }]),
  ];
  const catalog = await signExperienceCatalog({ manifestVersion: 1, generatedAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), experiences }, keys.privateKey);
  assert.equal((await storeSignedCatalog(catalog, keys.publicKeySpkiBase64)).ok, true);
  return [registryToDirectoryView({ ...MYBRANDOS_PUBLIC_ENTRY }), registryToDirectoryView({ ...MYBRANDOS_PUBLIC_ENTRY, experienceId: SECOND_ID, name: secondName, entrypoint: `https://${SECOND_ID}.example/`, origin: `https://${SECOND_ID}.example/`, executionModes: [{ mode: "SPACE", broadcastChannelId: SECOND_CHANNEL }] })];
}

function source(channel: string, startOffsetMs = -10_000, durationMs = 600_000): BroadcastHydrationSource {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  return {
    async fetchSchedule() {
      return { channelId: channel, publisherId: "p", scheduleId: "s", scheduleVersion: 1, programs: [{ programId: "p0", mediaId: `${channel}-m0`, scheduledStart: new Date(Date.now() + startOffsetMs).toISOString(), durationMs, sequence: 0 }] };
    },
    async fetchMedia(mediaId) {
      return { mediaId, publisherId: "p", title: mediaId, durationMs, version: "1", contentType: "video/mp4", byteLength: bytes.byteLength, checksum: "sha", availability: "REMOTE_ONLY", bytes, integrityVerified: true };
    },
  };
}

let key: Signer;
let fetchCalls = 0;
const realFetch = globalThis.fetch;

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

test("the bundled MrFundzMan artifact installs through the V1 verifier and becomes eligible with its signed name", async () => {
  setTrustedSpacePublishersForTests(null);
  assert.equal(bundledSpaceArtifact(MYBRANDOS_PUBLIC_ID), "spaces/mrfundzman.space");
  assert.equal(bundledSpaceArtifact("__proto__"), null);
  assert.equal(bundledSpaceArtifact("other.provider"), null);
  const bytes = readFileSync(new URL(`apps/os-experience/public/${bundledSpaceArtifact(MYBRANDOS_PUBLIC_ID)}`, root));
  assert.deepEqual(bytes, fixture);
  assert.equal((await importSpaceLaunchFile(new Uint8Array(bytes), { xperienceVersion })).ok, true);
  const eligibility = spaceHomeEntryEligibility(mybrandos());
  assert.ok(eligibility.eligible);
  assert.deepEqual(eligibility.presentation, { spaceId: MYBRANDOS_PUBLIC_ID, name: "MrFundzMan", source: "LAUNCH_FILE", publisherName: "mybrandOS", version: "1.0.0", channelId });
  assert.equal(eligibility.target.executionMode, "SPACE");
  assert.equal(fetchCalls, 0);
});

test("unverified, tampered, unknown-publisher and unreleased Spaces get no home entry", async () => {
  assert.deepEqual(spaceHomeEntryEligibility(mybrandos()), { eligible: false, reason: "NOT_VERIFIED" }, "declared bundle data alone is not trusted presentation");
  const tampered = (await launchFile(key)).replace('"MrFundzMan"', '"FakeTV"');
  assert.equal((await importSpaceLaunchFile(tampered, { xperienceVersion })).ok, false);
  const stranger = await launchFile(await signer("test-key-2"));
  assert.equal((await importSpaceLaunchFile(stranger, { xperienceVersion })).ok, false);
  assert.deepEqual(spaceHomeEntryEligibility(mybrandos()), { eligible: false, reason: "NOT_VERIFIED" });
  appOnlyBootstrap();
  assert.deepEqual(spaceHomeEntryEligibility({ id: MYBRANDOS_PUBLIC_ID, entrypoint: MYBRANDOS_PUBLIC_ENTRY.entrypoint, executionModes: [{ mode: "APP" }] }), { eligible: false, reason: "NOT_RELEASED" });
  for (const id of ["../etc", "javascript:alert(1)", "https://evil.example", "", "A.UPPER"]) {
    assert.deepEqual(spaceHomeEntryEligibility({ id, entrypoint: "https://x.example/", executionModes: [{ mode: "SPACE", broadcastChannelId: channelId }] }), { eligible: false, reason: "INVALID_SPACE" }, id);
  }
});

test("the shortcut carries only identity and trusted presentation", () => {
  const request = spaceShortcutRequest({ spaceId: MYBRANDOS_PUBLIC_ID, name: "  MrFundzMan  " });
  assert.deepEqual(Object.keys(request).sort(), ["color", "label", "monogram", "shortcutId", "spaceId"]);
  assert.equal(request.shortcutId, `space:${MYBRANDOS_PUBLIC_ID}`);
  assert.equal(request.label, "MrFundzMan");
  assert.equal(request.monogram, "M");
  assert.match(request.color, /^#[0-9a-f]{6}$/);
  assert.equal(spaceShortcutRequest({ spaceId: MYBRANDOS_PUBLIC_ID, name: "Renamed Space" }).color, request.color, "colour follows identity, not name");
  assert.equal(spaceShortcutRequest({ spaceId: SECOND_ID, name: "Second Space" }).monogram, "SS");
  assert.equal(spaceShortcutRequest({ spaceId: SECOND_ID, name: "x".repeat(200) }).label.length, 64);
  const serialized = JSON.stringify(request);
  assert.doesNotMatch(serialized, /https?:|token|secret|trust|pdi|session|signature|key/i);
});

test("a version update keeps the shortcut identity and refreshes the label", async () => {
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const first = spaceHomeEntryEligibility(mybrandos());
  assert.ok(first.eligible);
  const created = recordSpaceHomeEntry(first.presentation, new Date("2026-10-01T00:00:00Z"));
  const updated = await importSpaceLaunchFile(await launchFile(key, { version: "1.1.0", presentation: { name: "MrFundzMan Live" } }), { xperienceVersion, acceptUpdate: true });
  assert.equal(updated.ok ? updated.outcome : updated.code, "UPDATED");
  const second = spaceHomeEntryEligibility(mybrandos());
  assert.ok(second.eligible);
  const refreshed = recordSpaceHomeEntry(second.presentation, new Date("2026-10-02T00:00:00Z"));
  assert.equal(refreshed.shortcutId, created.shortcutId);
  assert.equal(refreshed.createdAt, created.createdAt);
  assert.equal(refreshed.label, "MrFundzMan Live");
  assert.equal(readSpaceHomeEntries().length, 1, "one entry per Space identity");
});

test("malicious or malformed launch intents are INVALID TARGET", () => {
  recordSpaceHomeEntry({ spaceId: MYBRANDOS_PUBLIC_ID, name: "MrFundzMan", source: "LAUNCH_FILE" });
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["array", [launch(MYBRANDOS_PUBLIC_ID)]],
    ["string", "space:bootstrap.mybrandos.public"],
    ["wrong action", launch(MYBRANDOS_PUBLIC_ID, { action: "android.intent.action.VIEW" })],
    ["missing action", launch(MYBRANDOS_PUBLIC_ID, { action: undefined })],
    ["data uri", launch(MYBRANDOS_PUBLIC_ID, { hasData: true })],
    ["hasData missing", launch(MYBRANDOS_PUBLIC_ID, { hasData: undefined })],
    ["missing extra", launch(MYBRANDOS_PUBLIC_ID, { extraKeys: [] })],
    ["duplicate extra", launch(MYBRANDOS_PUBLIC_ID, { extraKeys: [SPACE_LAUNCH_EXTRA, SPACE_LAUNCH_EXTRA] })],
    ["mode override", launch(MYBRANDOS_PUBLIC_ID, { extraKeys: [SPACE_LAUNCH_EXTRA, "ox.mode"] })],
    ["url override", launch(MYBRANDOS_PUBLIC_ID, { extraKeys: [SPACE_LAUNCH_EXTRA, "ox.url"] })],
    ["unreadable extras", launch(MYBRANDOS_PUBLIC_ID, { extraKeys: [SPACE_LAUNCH_EXTRA, "ox.unreadable"] })],
    ["too many extras", launch(MYBRANDOS_PUBLIC_ID, { extraKeys: [SPACE_LAUNCH_EXTRA, ...Array.from({ length: 32 }, (_, i) => `k${i}`)] })],
    ["non-string extra key", launch(MYBRANDOS_PUBLIC_ID, { extraKeys: [SPACE_LAUNCH_EXTRA, 7] })],
    ["traversal", launch("../bootstrap.mybrandos.public")],
    ["double dot", launch("bootstrap..public")],
    ["javascript", launch("javascript:alert(1)")],
    ["url", launch("https://evil.example/")],
    ["control character", launch("bootstrap.mybrandos\u0000public")],
    ["oversized", launch("a".repeat(300))],
    ["upper case", launch("Bootstrap.Mybrandos.Public")],
    ["shortcut id instead of space id", launch(`space:${MYBRANDOS_PUBLIC_ID}`)],
    ["number", launch(42)],
  ];
  for (const [name, raw] of cases) assert.deepEqual(resolveSpaceLaunch(raw), { kind: "INVALID_TARGET" }, name);
  const benign = resolveSpaceLaunch(launch(MYBRANDOS_PUBLIC_ID, { extraKeys: ["android.intent.extra.shortcut.ID", SPACE_LAUNCH_EXTRA] }));
  assert.equal(benign.kind, "RESOLVED", "platform-added extras outside the ox. namespace are tolerated");
});

test("launch requires a home-entry record, resolves strictly to SPACE and never falls back to APP", async () => {
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  assert.deepEqual(resolveSpaceLaunch(launch(MYBRANDOS_PUBLIC_ID)), { kind: "NOT_INSTALLED", spaceId: MYBRANDOS_PUBLIC_ID });
  assert.deepEqual(resolveSpaceLaunch(launch("unknown.space")), { kind: "NOT_INSTALLED", spaceId: "unknown.space" });
  const eligibility = spaceHomeEntryEligibility(mybrandos());
  assert.ok(eligibility.eligible);
  recordSpaceHomeEntry(eligibility.presentation);
  const resolved = resolveSpaceLaunch(launch(MYBRANDOS_PUBLIC_ID));
  assert.ok(resolved.kind === "RESOLVED");
  assert.deepEqual([resolved.target.executionMode, resolved.target.providerId, resolved.target.broadcastChannelId], ["SPACE", MYBRANDOS_PUBLIC_ID, channelId]);
  assert.equal(resolveSpaceLaunch(launch(MYBRANDOS_PUBLIC_ID), { fixedMode: "APP" }).kind, "UNAVAILABLE", "a host locked to APP cannot run a Space");
  assert.equal(resolveSpaceLaunch(launch(MYBRANDOS_PUBLIC_ID), { fixedMode: "SPACE" }).kind, "RESOLVED");

  appOnlyBootstrap();
  assert.equal(removeSpaceRegistration(MYBRANDOS_PUBLIC_ID), true);
  const orphan = resolveSpaceLaunch(launch(MYBRANDOS_PUBLIC_ID));
  assert.equal(orphan.kind, "UNAVAILABLE", "no registration and no released SPACE: refuse, never open the App");
  assert.equal(fetchCalls, 0);
});

test("two Spaces route independently and never share a 'last Space'", async () => {
  const apps = await twoSpaceCatalog();
  for (const app of apps) {
    const eligibility = spaceHomeEntryEligibility({ id: app.id, entrypoint: app.xperienceUrl, executionModes: app.executionModes });
    assert.ok(eligibility.eligible, app.id);
    assert.equal(eligibility.presentation.source, "SIGNED_CATALOG");
    recordSpaceHomeEntry(eligibility.presentation);
  }
  const route = (id: string) => {
    const result = resolveSpaceLaunch(launch(id), { apps });
    return result.kind === "RESOLVED" ? [result.target.providerId, result.target.broadcastChannelId] : result.kind;
  };
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(route(SECOND_ID), [SECOND_ID, SECOND_CHANNEL]);
    assert.deepEqual(route(MYBRANDOS_PUBLIC_ID), [MYBRANDOS_PUBLIC_ID, channelId]);
  }
  assert.notEqual(spaceShortcutId(MYBRANDOS_PUBLIC_ID), spaceShortcutId(SECOND_ID));
  assert.equal(removeSpaceHomeEntry(MYBRANDOS_PUBLIC_ID), true);
  assert.equal(route(MYBRANDOS_PUBLIC_ID), "NOT_INSTALLED");
  assert.deepEqual(route(SECOND_ID), [SECOND_ID, SECOND_CHANNEL], "removing one entry leaves the other");
  assert.deepEqual(staleSpaceShortcuts([spaceShortcutId(MYBRANDOS_PUBLIC_ID), spaceShortcutId(SECOND_ID), "other:pinned"]), [spaceShortcutId(MYBRANDOS_PUBLIC_ID)]);
});

test("two Spaces with the same name keep separate identities", async () => {
  const apps = await twoSpaceCatalog("MrFundzMan");
  const [a, b] = apps.map((app) => spaceHomeEntryEligibility({ id: app.id, entrypoint: app.xperienceUrl, executionModes: app.executionModes }));
  assert.ok(a?.eligible && b?.eligible);
  assert.equal(a.presentation.name, b.presentation.name);
  recordSpaceHomeEntry(a.presentation);
  recordSpaceHomeEntry(b.presentation);
  assert.deepEqual(readSpaceHomeEntries().map((entry) => entry.shortcutId).sort(), [spaceShortcutId(MYBRANDOS_PUBLIC_ID), spaceShortcutId(SECOND_ID)].sort());
  const second = resolveSpaceLaunch(launch(SECOND_ID), { apps });
  assert.ok(second.kind === "RESOLVED");
  assert.equal(second.target.broadcastChannelId, SECOND_CHANNEL, "a name never routes to another Space");
});

test("installed is not READY OFFLINE; an expired schedule is not playable even with media stored", async () => {
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const store = new MemoryBroadcastHydrationStore();
  const readiness = async (online: boolean, now = new Date()) =>
    classifySpaceReadiness({ released: true, offlineCapability: "PARTIAL", channelId, locallyPlayable: await spaceLocallyPlayable(store, channelId, now), online }).readiness;
  assert.equal(await readiness(false), "ONLINE_PREPARATION_REQUIRED");
  assert.equal(spaceInstallationStage({ registered: true, readiness: await readiness(false), preparing: false, homeEntry: "INSTALLED" }), "HOME_ENTRY_INSTALLED");
  await hydrateAndPrepareSpaceTv({ channelId, routeAvailable: true, now: () => new Date(), store, source: source(channelId, -10_000, 60_000) });
  assert.equal(await readiness(false), "READY_OFFLINE");
  assert.ok(store.media.size > 0);
  assert.equal(await readiness(false, new Date(Date.now() + 3_600_000)), "ONLINE_PREPARATION_REQUIRED", "past the schedule window, stored media is not playable");
  assert.equal(fetchCalls, 0);
});

test("remove from Home Screen, remove registration and delete offline data are independent", async () => {
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const eligibility = spaceHomeEntryEligibility(mybrandos());
  assert.ok(eligibility.eligible);
  const store = new MemoryBroadcastHydrationStore();
  await hydrateAndPrepareSpaceTv({ channelId, routeAvailable: true, now: () => new Date(), store, source: source(channelId) });
  const snapshot = () => ({ entry: Boolean(findSpaceHomeEntry(MYBRANDOS_PUBLIC_ID)), registered: readSpaceRegistrations().length === 1, schedule: store.schedules.has(channelId), media: store.media.size > 0 });

  recordSpaceHomeEntry(eligibility.presentation);
  assert.deepEqual(snapshot(), { entry: true, registered: true, schedule: true, media: true });
  assert.equal(removeSpaceHomeEntry(MYBRANDOS_PUBLIC_ID), true);
  assert.deepEqual(snapshot(), { entry: false, registered: true, schedule: true, media: true }, "home entry only");

  recordSpaceHomeEntry(eligibility.presentation);
  await deletePreparedChannel(store, channelId);
  assert.deepEqual(snapshot(), { entry: true, registered: true, schedule: false, media: false }, "offline data only");

  assert.equal(removeSpaceRegistration(MYBRANDOS_PUBLIC_ID), true);
  assert.deepEqual(snapshot(), { entry: true, registered: false, schedule: false, media: false }, "registration only");
});

test("installation writes only its own records: no TrustID, PDI, session or authority state, and no network", async () => {
  const writes: string[] = [];
  const recording: KvStore = { getItem: (k) => memoryKvStore.getItem(k), setItem: (k, v) => { writes.push(k); memoryKvStore.setItem(k, v); }, removeItem: (k) => memoryKvStore.removeItem(k) };
  setKvStoreForTests(recording);
  assert.equal((await importSpaceLaunchFile(await launchFile(key), { xperienceVersion })).ok, true);
  const eligibility = spaceHomeEntryEligibility(mybrandos());
  assert.ok(eligibility.eligible);
  const entry = recordSpaceHomeEntry(eligibility.presentation);
  assert.deepEqual([...new Set(writes)].sort(), [SPACE_HOME_ENTRIES_KEY, SPACE_REGISTRY_KEY].sort());
  assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "label", "presentationSource", "shortcutId", "spaceId", "updatedAt"]);
  assert.doesNotMatch(memoryKvStore.getItem(SPACE_HOME_ENTRIES_KEY) ?? "", /trust|pdi|session|owner|admin|token|secret|signature/i);
  assert.equal(fetchCalls, 0);
});

test("corrupted or forged home-entry records are ignored", () => {
  const good = { spaceId: MYBRANDOS_PUBLIC_ID, shortcutId: spaceShortcutId(MYBRANDOS_PUBLIC_ID), label: "MrFundzMan", presentationSource: "LAUNCH_FILE", createdAt: "x", updatedAt: "x" };
  const forged = [
    { ...good, shortcutId: "space:other.space" },
    { ...good, spaceId: "../x", shortcutId: "space:../x" },
    { ...good, label: "bad\u0007label" },
    { ...good, label: "x".repeat(65) },
    { ...good, presentationSource: "REMOTE_URL" },
  ];
  memoryKvStore.setItem(SPACE_HOME_ENTRIES_KEY, JSON.stringify({ schemaVersion: 1, entries: [...forged, good, { ...good, label: "Duplicate" }] }));
  assert.deepEqual(readSpaceHomeEntries().map((entry) => entry.label), ["MrFundzMan"]);
  for (const corrupt of ["{not json", JSON.stringify({ schemaVersion: 2, entries: [good] }), JSON.stringify({ schemaVersion: 1, entries: "x" })]) {
    memoryKvStore.setItem(SPACE_HOME_ENTRIES_KEY, corrupt);
    assert.deepEqual(readSpaceHomeEntries(), []);
    assert.equal(resolveSpaceLaunch(launch(MYBRANDOS_PUBLIC_ID)).kind, "NOT_INSTALLED");
  }
});

test("installation states derive from their canonical owners", () => {
  const state = spaceHomeEntryState;
  assert.equal(state({ supported: false, eligible: true, recorded: true, pinned: true }), "UNSUPPORTED");
  assert.equal(state({ supported: true, eligible: false, recorded: false, pinned: false }), "NOT_ELIGIBLE");
  assert.equal(state({ supported: true, eligible: true, recorded: false, pinned: false }), "AVAILABLE");
  assert.equal(state({ supported: true, eligible: true, recorded: true, pinned: false }), "REQUESTED", "a record alone is only a request");
  assert.equal(state({ supported: true, eligible: true, recorded: false, pinned: true }), "AVAILABLE", "a pinned shortcut without a record is stale");
  assert.equal(state({ supported: true, eligible: true, recorded: true, pinned: true }), "INSTALLED");

  const stage = spaceInstallationStage;
  assert.equal(stage({ registered: false, readiness: "NOT_PREPARED", preparing: false, homeEntry: "AVAILABLE" }), "NOT_INSTALLED");
  assert.equal(stage({ registered: true, readiness: "NOT_PREPARED", preparing: false, homeEntry: "AVAILABLE" }), "REGISTERED");
  assert.equal(stage({ registered: true, readiness: "NOT_PREPARED", preparing: true, homeEntry: "AVAILABLE" }), "PREPARING");
  assert.equal(stage({ registered: true, readiness: "READY_OFFLINE", preparing: false, homeEntry: "UNSUPPORTED" }), "READY_OFFLINE");
  assert.equal(stage({ registered: true, readiness: "READY_OFFLINE", preparing: false, homeEntry: "AVAILABLE" }), "HOME_ENTRY_AVAILABLE");
  assert.equal(stage({ registered: true, readiness: "READY_OFFLINE", preparing: false, homeEntry: "INSTALLED" }), "HOME_ENTRY_INSTALLED");
});

test("home-screen capability: Android host SUPPORTED, browser (no host) UNSUPPORTED, failures fail closed", async () => {
  const host = (supported: () => Promise<boolean>): SpaceHomeEntryHost => ({
    supported, pinnedShortcutIds: async () => [], requestPin: async () => ({ requested: true }), update: async () => {}, disable: async () => {}, takeLaunch: async () => null, onLaunch: () => () => {}, onPinnedChange: () => () => {},
  });
  assert.equal(await canInstallSpaceHomeEntry(null), false);
  assert.equal(await canInstallSpaceHomeEntry(undefined), false);
  assert.equal(await canInstallSpaceHomeEntry(host(async () => true)), true);
  assert.equal(await canInstallSpaceHomeEntry(host(async () => false)), false);
  assert.equal(await canInstallSpaceHomeEntry(host(async () => { throw new Error("plugin missing"); })), false);
});

test("the native layer is launcher plumbing only and matches the web launch contract", () => {
  const nativeDir = new URL("apps/os-experience/android/app/src/main/", root);
  const manifest = readFileSync(new URL("AndroidManifest.xml", nativeDir), "utf8");
  const plugin = readFileSync(new URL("java/com/digiconomy/osexperience/SpaceHomeEntryPlugin.java", nativeDir), "utf8");
  const trampoline = readFileSync(new URL("java/com/digiconomy/osexperience/SpaceEntryActivity.java", nativeDir), "utf8");
  assert.match(manifest, /android:name="\.SpaceEntryActivity"\s+android:exported="false"/);
  assert.ok(plugin.includes(`"${SPACE_LAUNCH_ACTION}"`));
  assert.ok(plugin.includes(`"${SPACE_LAUNCH_EXTRA}"`));
  assert.equal((plugin.match(/putExtra\(/g) ?? []).length, 1, "the shortcut intent carries one extra");
  assert.doesNotMatch(plugin + trampoline, /setData\(|Uri\.parse|loadUrl|evaluateJavascript|Signature|MessageDigest|publicKey|INSTALL_PACKAGES/);
});
