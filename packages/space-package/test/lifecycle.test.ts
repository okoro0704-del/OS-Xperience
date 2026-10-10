import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SimulatedCrash,
  SpacePackageError,
  addPendingOperation,
  applyKeyRotation,
  applyPublisherTransition,
  applyRevocationList,
  completeKeyRotation,
  forkSpace,
  inspectSpacePackage,
  keyState,
  signStatement,
  trustStoreFromPublishers,
  type KeyRotationStatement,
  type PackageErrorCode,
  type PublisherTransitionStatement,
  type RevocationList,
  type SpacePackageManifest,
} from "../src/index.js";
import { FileLifecycleBackend } from "../src/node-backend.js";
import { assemble } from "./helpers.js";
import { LANTERN, V2_MIGRATION, makeUpdate, newKey, pack, releaseSource, signerFor, world, type World } from "./lifecycle-helpers.js";


async function rejects(promise: Promise<unknown>, code: PackageErrorCode) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SpacePackageError, `expected ${code}, got ${String(error)}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

/** V1 installed, with local state a user would have built up. */
async function installedWithState(w: World) {
  await w.lifecycle.install(w.v1.bytes);
  const at = w.clock.now;
  await w.lifecycle.writeState(LANTERN, (s) => addPendingOperation(addPendingOperation({
    ...s,
    preferences: { ...s.preferences, "autoplay": true, "chime.repeat": 2 },
    settings: { ...s.settings, "theme": "dusk" },
    playlists: [{ id: "my-evening", title: "My evening", items: ["chime", "lantern"] }],
    userContent: [{ id: "note-1", title: "Lantern sketch", ref: "local://user/notes/1", createdAt: at.toISOString() }],
  }, { opId: "sync-likes-1", kind: "sync.likes", consequential: false, createdAt: at.toISOString(), payload: { count: 3 } }, at),
  { opId: "tip-creator-1", kind: "settlement.tip", consequential: true, createdAt: at.toISOString(), payload: { amount: 500, currency: "NGN" } }, at));
  return w.lifecycle.readState(LANTERN);
}

async function updateToV2(w: World, updateBytes?: Uint8Array) {
  const tx = await w.lifecycle.stageUpdate(updateBytes ?? (await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key })), w.v2.bytes);
  return w.lifecycle.applyStagedUpdate(LANTERN, tx.txId);
}

test("valid V1 → V2: same installation, permitted state preserved and migrated, previous kept", async () => {
  const w = await world();
  const before = await installedWithState(w);
  const recordBefore = await w.lifecycle.record(LANTERN);
  const updateBytes = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key });
  const inspection = await w.lifecycle.inspectUpdate(updateBytes, w.v2.bytes);
  assert.equal(inspection.acceptable, true);

  let tx = await w.lifecycle.stageUpdate(updateBytes, w.v2.bytes);
  assert.equal(tx.state, "STAGED");
  tx = await w.lifecycle.verifyUpdate(LANTERN, tx.txId);
  assert.equal(tx.state, "VERIFIED");
  assert.equal((tx.evidence as { signature: string }).signature, "VALID_AGAINST_LOCAL_TRUST");
  tx = await w.lifecycle.prepareMigration(LANTERN, tx.txId);
  assert.equal((await w.lifecycle.record(LANTERN)).active.version, "1.0.0", "nothing replaced before activation");
  tx = await w.lifecycle.activate(LANTERN, tx.txId);
  assert.equal(tx.state, "ACTIVE");
  assert.deepEqual(tx.history.map((item) => item.state), ["AVAILABLE", "DOWNLOADING", "STAGED", "VERIFIED", "MIGRATION_PREPARED", "ACTIVATING", "ACTIVE"]);

  const record = await w.lifecycle.record(LANTERN);
  assert.equal(record.installationId, recordBefore.installationId, "installation identity unchanged");
  assert.equal(record.stateId, recordBefore.stateId, "state identity unchanged");
  assert.deepEqual(record.authority, { owner: null, grants: [] });
  assert.equal(record.active.version, "2.0.0");
  assert.equal(record.active.sequence, 2);
  assert.equal(record.previous?.version, "1.0.0", "the previous verified release is kept");
  assert.equal(record.stateLock, null);

  const after = await w.lifecycle.readState(LANTERN);
  assert.equal(after.dataVersion, 2);
  assert.deepEqual(after.playlists, before.playlists);
  assert.deepEqual(after.userContent, before.userContent);
  assert.deepEqual(after.pendingOperations, before.pendingOperations, "pending operations are records, carried unchanged");
  assert.deepEqual(after.journal.slice(0, before.journal.length), before.journal, "journal is append-only");
  assert.equal(after.preferences["autoplay"], true);
  assert.equal(after.preferences["chime.volume"], 0.8, "migration added a default");
  assert.equal(after.settings["gallery.layout"], "grid");

  const opened = await w.lifecycle.open(LANTERN, { environment: { online: false } });
  assert.deepEqual(opened.experience.content?.items.map((item) => item.id), ["lantern", "chime", "bells"]);
  assert.equal((await w.lifecycle.record(LANTERN)).active.proven, true);
});

test("invalid update signature, tampered asset, wrong lineage and wrong publisher are REJECTED; V1 stays active", async () => {
  const w = await world();
  await w.lifecycle.install(w.v1.bytes);
  const impostor = await newKey("demo-key-1");
  const badSignature = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: impostor });
  await rejects(updateToV2(w, badSignature), "UPDATE_SIGNATURE_INVALID");

  // Tampered asset: same signed manifest (same digest), one image byte changed inside the archive.
  const v2 = releaseSource("v2");
  const inspection = await inspectSpacePackage(w.v2.bytes);
  const png = v2.files.find((file) => file.path.endsWith(".png"))!;
  const changed = png.bytes.slice(); changed[changed.length - 20] ^= 0xff;
  const tampered = await assemble(inspection.manifest, signerFor(w.publisherId, w.key), v2.files.map((file) => (file === png ? { path: file.path, bytes: changed } : file)));
  const tx = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }), tampered);
  await rejects(w.lifecycle.verifyUpdate(LANTERN, tx.txId), "ASSET_MODIFIED");
  assert.equal((await w.lifecycle.transaction(LANTERN, tx.txId)).state, "REJECTED");

  // Wrong lineage: a package of another lineage presented as Lantern V2.
  const other = await pack({ ...v2.declaration, package: { ...v2.declaration.package, id: "org.digiconomy.demo.other" }, space: { ...v2.declaration.space, spaceId: "org.digiconomy.demo.other" } }, v2.files, signerFor(w.publisherId, w.key), 2);
  await rejects((async () => { const t = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, other, { publisherId: w.publisherId, key: w.key }), other.bytes); return w.lifecycle.verifyUpdate(LANTERN, t.txId); })(), "WRONG_LINEAGE");

  // Wrong publisher: another trusted publisher cannot update this lineage without a verified transition.
  const rival = await newKey("rival-1");
  w.trust = trustStoreFromPublishers([...w.trust.publishers.map((p) => ({ publisherId: p.publisherId, name: p.name, keys: p.keys, packagePrefixes: p.packagePrefixes })), { publisherId: "rival.pub", name: "Rival", keys: [rival], packagePrefixes: ["org.digiconomy.demo."] }]);
  const rivalV2 = await pack(v2.declaration, v2.files, signerFor("rival.pub", rival), 2);
  await rejects((async () => { const t = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, rivalV2, { publisherId: "rival.pub", key: rival }), rivalV2.bytes); return w.lifecycle.verifyUpdate(LANTERN, t.txId); })(), "PUBLISHER_CHANGED");

  // …unless the current publisher explicitly hands the lineage over.
  const handover = await signStatement<PublisherTransitionStatement>({ format: "digiconomy.space-publisher-transition", formatVersion: 1, packageId: LANTERN, fromPublisherId: w.publisherId, toPublisherId: "rival.pub", sequence: 1, authorizedBy: { keyId: w.key.keyId } }, w.key);
  w.trust = await applyPublisherTransition(w.trust, handover);
  const t = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, rivalV2, { publisherId: "rival.pub", key: rival }), rivalV2.bytes);
  assert.equal((await w.lifecycle.applyStagedUpdate(LANTERN, t.txId)).state, "ACTIVE");
  assert.equal((await w.lifecycle.record(LANTERN)).active.publisherId, "rival.pub");
});

test("key lifecycle: unauthorized replacement refused; rotation ACTIVE → ROTATING → RETIRED; revoked keys authorize nothing", async () => {
  const w = await world();
  await w.lifecycle.install(w.v1.bytes);
  const attacker = await newKey("attacker-1");
  const forged = await signStatement<KeyRotationStatement>({ format: "digiconomy.space-key-rotation", formatVersion: 1, publisherId: w.publisherId, sequence: 1, retiringKeyId: w.key.keyId, newKey: { keyId: attacker.keyId, publicKeySpkiBase64: attacker.publicKeySpkiBase64 }, authorizedBy: { keyId: attacker.keyId } }, attacker);
  await rejects(applyKeyRotation(w.trust, forged), "ROTATION_UNAUTHORIZED");
  // An update signed by the unknown key is refused: unknown keys never become trusted on their own.
  const attackerV2 = await pack(releaseSource("v2").declaration, releaseSource("v2").files, signerFor(w.publisherId, attacker), 2);
  await rejects((async () => { const t = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, attackerV2, { publisherId: w.publisherId, key: attacker }), attackerV2.bytes); return w.lifecycle.verifyUpdate(LANTERN, t.txId); })(), "KEY_NOT_AUTHORIZED");

  // Legitimate rotation, authorized by the trusted ACTIVE key.
  const k2 = await newKey("demo-key-2");
  const rotation = await signStatement<KeyRotationStatement>({ format: "digiconomy.space-key-rotation", formatVersion: 1, publisherId: w.publisherId, sequence: 1, retiringKeyId: w.key.keyId, newKey: { keyId: k2.keyId, publicKeySpkiBase64: k2.publicKeySpkiBase64 }, authorizedBy: { keyId: w.key.keyId } }, w.key);
  w.trust = await applyKeyRotation(w.trust, rotation);
  assert.equal(keyState(w.trust, w.publisherId, w.key.keyId), "ROTATING");
  assert.equal(keyState(w.trust, w.publisherId, k2.keyId), "ACTIVE");
  await rejects(applyKeyRotation(w.trust, rotation), "ROTATION_UNAUTHORIZED"); // replay
  // A ROTATING key cannot chain another rotation.
  const k3 = await newKey("demo-key-3");
  await rejects(applyKeyRotation(w.trust, await signStatement<KeyRotationStatement>({ format: "digiconomy.space-key-rotation", formatVersion: 1, publisherId: w.publisherId, sequence: 2, retiringKeyId: w.key.keyId, newKey: { keyId: k3.keyId, publicKeySpkiBase64: k3.publicKeySpkiBase64 }, authorizedBy: { keyId: w.key.keyId } }, w.key)), "ROTATION_UNAUTHORIZED");

  w.trust = completeKeyRotation(w.trust, w.publisherId);
  assert.equal(keyState(w.trust, w.publisherId, w.key.keyId), "RETIRED");
  // A RETIRED key no longer authorizes updates…
  await rejects(updateToV2(w), "KEY_NOT_AUTHORIZED");
  // …but the installed V1 it signed still opens (retired keys verify what they already signed).
  assert.equal((await w.lifecycle.open(LANTERN, { environment: { online: false } })).experience.state, "READY");

  // The new key publishes V2.
  const v2k2 = await pack(releaseSource("v2").declaration, releaseSource("v2").files, signerFor(w.publisherId, k2), 2);
  const tx = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, v2k2, { publisherId: w.publisherId, key: k2 }), v2k2.bytes);
  assert.equal((await w.lifecycle.applyStagedUpdate(LANTERN, tx.txId)).state, "ACTIVE");

  // Revoke the old key: terminal, cannot be re-added, and rollback to a release it signed is refused.
  const revocation = await signStatement<RevocationList>({ format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: w.publisherId, sequence: 1, issuedAt: "2026-10-10T10:00:00.000Z", revokedKeyIds: [w.key.keyId], authorizedBy: { keyId: k2.keyId } }, k2);
  w.trust = await applyRevocationList(w.trust, revocation, w.clock.now);
  assert.equal(keyState(w.trust, w.publisherId, w.key.keyId), "REVOKED");
  await rejects(applyRevocationList(w.trust, revocation, w.clock.now), "REVOCATION_REPLAY");
  await rejects(w.lifecycle.rollback(LANTERN, "testing"), "KEY_REVOKED");
  assert.equal(keyState(w.trust, w.publisherId, w.key.keyId), "REVOKED", "rollback never restores revoked trust");
  const backAgain = await signStatement<KeyRotationStatement>({ format: "digiconomy.space-key-rotation", formatVersion: 1, publisherId: w.publisherId, sequence: 2, retiringKeyId: k2.keyId, newKey: { keyId: w.key.keyId, publicKeySpkiBase64: w.key.publicKeySpkiBase64 }, authorizedBy: { keyId: k2.keyId } }, k2);
  await rejects(applyKeyRotation(w.trust, backAgain), "KEY_REVOKED");
});

test("revocation freshness is reported honestly offline; security-sensitive updates fail closed", async () => {
  const w = await world();
  await w.lifecycle.install(w.v1.bytes);
  // No revocation evidence at all: a normal update proceeds, and says freshness is UNKNOWN.
  const normal = await w.lifecycle.inspectUpdate(await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }), w.v2.bytes);
  assert.equal(normal.acceptable, true);
  assert.equal((normal as { evidence: { revocation: { status: string } } }).evidence.revocation.status, "UNKNOWN");

  const needsCurrent = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }, { security: { requiresRevocationSequence: null, requiresCurrentRevocation: true } });
  await rejects(updateToV2(w, needsCurrent), "FRESH_REVOCATION_REQUIRED");
  // Evidence obtained 30 days ago is STALE, not CURRENT.
  const list = await signStatement<RevocationList>({ format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: w.publisherId, sequence: 1, issuedAt: "2026-09-10T00:00:00.000Z", revokedKeyIds: [], authorizedBy: { keyId: w.key.keyId } }, w.key);
  w.trust = await applyRevocationList(w.trust, list, new Date("2026-09-10T00:00:00.000Z"));
  await rejects(updateToV2(w, needsCurrent), "FRESH_REVOCATION_REQUIRED");
  const needsSequence = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }, { security: { requiresRevocationSequence: 5, requiresCurrentRevocation: false } });
  await rejects(updateToV2(w, needsSequence), "FRESH_REVOCATION_REQUIRED");
  // Fresh evidence: accepted.
  const fresh = await signStatement<RevocationList>({ format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: w.publisherId, sequence: 5, issuedAt: "2026-10-10T08:00:00.000Z", revokedKeyIds: [], authorizedBy: { keyId: w.key.keyId } }, w.key);
  w.trust = await applyRevocationList(w.trust, fresh, w.clock.now);
  assert.equal((await updateToV2(w, needsCurrent)).state, "ACTIVE");
});

test("downgrade, replay, version reuse and security floor are refused on the signed sequence", async () => {
  const w = await world();
  await w.lifecycle.install(w.v1.bytes);
  const v1to2 = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key });
  await updateToV2(w, v1to2);
  // Replaying the V1→V2 update once V2 is active.
  await rejects((async () => { const t = await w.lifecycle.stageUpdate(v1to2, w.v2.bytes); return w.lifecycle.verifyUpdate(LANTERN, t.txId); })(), "FROM_RELEASE_MISMATCH");
  // A signed document going backwards is refused outright.
  await rejects(makeUpdate(w.v2, { ...w.v1, sequence: 1 }, { publisherId: w.publisherId, key: w.key }), "DOWNGRADE_REJECTED");
  // V3 raises the security floor to 3: rolling back to V2 (sequence 2) is then refused.
  const v2s = releaseSource("v2");
  const v3 = await pack({ ...v2s.declaration, package: { ...v2s.declaration.package, version: "3.0.0" } }, v2s.files, signerFor(w.publisherId, w.key), 3);
  const t3 = await w.lifecycle.stageUpdate(await makeUpdate(w.v2, v3, { publisherId: w.publisherId, key: w.key }, { state: { fromDataVersion: 2, toDataVersion: 2, migration: [], backwardCompatible: true }, rollback: { eligible: true, minimumSequence: 3 } }), v3.bytes);
  await w.lifecycle.applyStagedUpdate(LANTERN, t3.txId);
  await rejects(w.lifecycle.rollback(LANTERN, "testing"), "BELOW_SECURITY_FLOOR");
  // A version, once seen, is immutable: "4.0.0" may not reappear with different bytes later.
  const v4a = await pack({ ...v2s.declaration, package: { ...v2s.declaration.package, version: "4.0.0" } }, v2s.files, signerFor(w.publisherId, w.key), 4);
  const t4 = await w.lifecycle.stageUpdate(await makeUpdate(v3, v4a, { publisherId: w.publisherId, key: w.key }, { state: { fromDataVersion: 2, toDataVersion: 2, migration: [], backwardCompatible: true }, rollback: { eligible: true, minimumSequence: 3 } }), v4a.bytes);
  await w.lifecycle.applyStagedUpdate(LANTERN, t4.txId);
  await w.lifecycle.rollback(LANTERN, "testing");
  const v4b = await pack({ ...v2s.declaration, package: { ...v2s.declaration.package, version: "4.0.0", description: "different bytes" } }, v2s.files, signerFor(w.publisherId, w.key), 5);
  await rejects((async () => { const t = await w.lifecycle.stageUpdate(await makeUpdate(v3, v4b, { publisherId: w.publisherId, key: w.key }, { state: { fromDataVersion: 2, toDataVersion: 2, migration: [], backwardCompatible: true } }), v4b.bytes); return w.lifecycle.verifyUpdate(LANTERN, t.txId); })(), "VERSION_REUSED");
});

test("permission escalation needs explicit approval; unsupported runtime is refused", async () => {
  const w = await world();
  await w.lifecycle.install(w.v1.bytes);
  const v2s = releaseSource("v2");
  const wider = await pack({ ...v2s.declaration, permissions: [...v2s.declaration.permissions, "storage.local"] }, v2s.files, signerFor(w.publisherId, w.key), 2);
  const doc = await makeUpdate(w.v1, wider, { publisherId: w.publisherId, key: w.key }, { permissions: ["content.read", "media.playback", "network.sync", "storage.local"] });
  let tx = await w.lifecycle.stageUpdate(doc, wider.bytes);
  await rejects(w.lifecycle.verifyUpdate(LANTERN, tx.txId), "PERMISSION_ESCALATION");
  tx = await w.lifecycle.stageUpdate(doc, wider.bytes);
  assert.equal((await w.lifecycle.applyStagedUpdate(LANTERN, tx.txId, { approvedPermissions: ["storage.local"] })).state, "ACTIVE");

  const old = await world({ runtimeVersion: "1.0.0" });
  await old.lifecycle.install(old.v1.bytes);
  const future = await pack({ ...v2s.declaration, runtime: { spaceContractVersion: 1, minimumRuntimeVersion: "9.0.0" } }, v2s.files, signerFor(old.publisherId, old.key), 2);
  const fdoc = await makeUpdate(old.v1, future, { publisherId: old.publisherId, key: old.key }, { compatibility: { spaceContractVersion: 1, minimumRuntimeVersion: "9.0.0" } });
  const ft = await old.lifecycle.stageUpdate(fdoc, future.bytes);
  await rejects(old.lifecycle.verifyUpdate(LANTERN, ft.txId), "INCOMPATIBLE_RUNTIME");
});

async function fileWorld() {
  const root = await mkdtemp(join(tmpdir(), "space-sp2-"));
  const w = await world({ backend: new FileLifecycleBackend(root) });
  return { w, root };
}

test("interrupted download and interrupted staging never touch the active installation", async () => {
  const { w, root } = await fileWorld();
  try {
    const before = await installedWithState(w);
    const doc = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key });
    // Network drops after the first chunk.
    const dropping = () => (async function* () { yield w.v2.bytes.subarray(0, 1000); throw new Error("connection reset"); })();
    await rejects(w.lifecycle.stageUpdate(doc, dropping), "DOWNLOAD_INTERRUPTED");
    assert.equal((await w.lifecycle.history(LANTERN)).at(-1)!.state, "INTERRUPTED");
    assert.deepEqual(await readdir(join(root, ".staging")), []);
    // The process dies after writing the staged bytes, before STAGED was recorded.
    w.failAt = { point: "staged", error: () => new SimulatedCrash("staged") };
    await assert.rejects(w.lifecycle.stageUpdate(doc, w.v2.bytes), SimulatedCrash);
    const restarted = w.restart();
    const report = await restarted.recoverAll();
    assert.deepEqual(report.recovered.map((item) => [item.from, item.to]), [["DOWNLOADING", "INTERRUPTED"]]);
    assert.equal((await restarted.record(LANTERN)).active.version, "1.0.0");
    assert.deepEqual(await restarted.readState(LANTERN), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [point, outcome] of [["activating", "INTERRUPTED"], ["release-written", "INTERRUPTED"], ["record-committed", "ACTIVE"], ["state-promoted", "ACTIVE"]] as const) {
  test(`crash at ${point}: recovery is deterministic (${outcome}) and idempotent`, async () => {
    const { w, root } = await fileWorld();
    try {
      const before = await installedWithState(w);
      const tx = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }), w.v2.bytes);
      await w.lifecycle.verifyUpdate(LANTERN, tx.txId);
      await w.lifecycle.prepareMigration(LANTERN, tx.txId);
      w.failAt = { point, error: () => new SimulatedCrash(point) };
      await assert.rejects(w.lifecycle.activate(LANTERN, tx.txId), SimulatedCrash);

      const first = w.restart();
      const report = await first.recoverAll();
      assert.deepEqual(report.recovered.map((item) => item.to), [outcome]);
      const record = await first.record(LANTERN);
      const state = await first.readState(LANTERN);
      assert.equal(record.stateLock, null, "the state lock never survives recovery");
      if (outcome === "ACTIVE") {
        assert.equal(record.active.version, "2.0.0");
        assert.equal(state.dataVersion, 2);
        assert.deepEqual(state.pendingOperations, before.pendingOperations);
      } else {
        assert.equal(record.active.version, "1.0.0", "a partially installed release never becomes active");
        assert.deepEqual(state, before, "state untouched");
        assert.deepEqual(await readdir(join(root, "installations", LANTERN, "releases")), [w.v1.packageDigest]);
      }
      // Idempotent: recovering again changes nothing.
      const second = w.restart();
      assert.deepEqual((await second.recoverAll()).recovered, []);
      assert.deepEqual(await second.record(LANTERN), record);
      assert.deepEqual(await second.readState(LANTERN), state);
      assert.deepEqual(await readdir(join(root, ".staging")), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("migration failure rejects the update and leaves state and lock untouched", async () => {
  const w = await world();
  const before = await installedWithState(w);
  const bad = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }, { state: { ...V2_MIGRATION, migration: [{ op: "setPreferenceDefault", key: "bad key!", value: 1 }] } });
  const tx = await w.lifecycle.stageUpdate(bad, w.v2.bytes);
  await w.lifecycle.verifyUpdate(LANTERN, tx.txId);
  await rejects(w.lifecycle.prepareMigration(LANTERN, tx.txId), "MIGRATION_FAILED");
  assert.equal((await w.lifecycle.transaction(LANTERN, tx.txId)).state, "REJECTED");
  assert.deepEqual(await w.lifecycle.readState(LANTERN), before);
  assert.equal((await w.lifecycle.record(LANTERN)).stateLock, null);
  // While an update holds the lock, state writes are refused, and abort releases it.
  const ok = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }), w.v2.bytes);
  await w.lifecycle.verifyUpdate(LANTERN, ok.txId);
  await w.lifecycle.prepareMigration(LANTERN, ok.txId);
  await rejects(w.lifecycle.writeState(LANTERN, (s) => s), "STATE_LOCKED");
  await w.lifecycle.abortUpdate(LANTERN, ok.txId);
  await w.lifecycle.writeState(LANTERN, (s) => s);
});

test("rollback after a failed launch: last known-good release, current state, no duplicated or replayed operations", async () => {
  const w = await world();
  await installedWithState(w);
  await updateToV2(w);
  // Work done on V2 must survive the rollback.
  await w.lifecycle.writeState(LANTERN, (s) => ({ ...s, userContent: [...s.userContent, { id: "note-2", title: "Dawn sketch", ref: "local://user/notes/2", createdAt: w.clock.now.toISOString() }] }));
  const beforeRollback = await w.lifecycle.readState(LANTERN);
  // V2 fails to launch (an asset is corrupted on disk).
  const backend = w.backend as unknown as { releases: Map<string, { assets: Map<string, Uint8Array> }> };
  [...backend.releases.entries()].find(([key]) => key.endsWith(w.v2.packageDigest))![1].assets.set("content/media/lantern.png", new Uint8Array([1]));
  await rejects(w.lifecycle.open(LANTERN, { environment: { online: false } }), "INSTALLATION_CORRUPT");
  const result = await w.lifecycle.rollback(LANTERN, "V2 failed to launch", { launchFailed: true });
  assert.equal(result.status, "ROLLED_BACK");
  const record = await w.lifecycle.record(LANTERN);
  assert.equal(record.active.version, "1.0.0");
  assert.equal(record.installationId, (await w.lifecycle.record(LANTERN)).installationId);
  const state = await w.lifecycle.readState(LANTERN);
  assert.deepEqual(state.userContent, beforeRollback.userContent, "user content created on V2 is kept");
  assert.equal(state.pendingOperations.length, beforeRollback.pendingOperations.length, "no duplicated operations");
  assert.equal(new Set(state.pendingOperations.map((op) => op.opId)).size, state.pendingOperations.length);
  assert.equal(state.pendingOperations.find((op) => op.opId === "tip-creator-1")!.status, "HELD", "a consequential operation is held, never replayed");
  assert.equal(state.pendingOperations.find((op) => op.opId === "sync-likes-1")!.status, "PENDING");
  assert.equal((await w.lifecycle.open(LANTERN, { environment: { online: false } })).experience.state, "READY");
  // Re-recording the same operation after a restore is a no-op.
  const again = addPendingOperation(state, { opId: "tip-creator-1", kind: "settlement.tip", consequential: true, createdAt: "x", payload: {} }, w.clock.now);
  assert.equal(again.pendingOperations.length, state.pendingOperations.length);
});

test("rollback with incompatible state returns RECOVERY_REQUIRED and changes nothing", async () => {
  const w = await world();
  await installedWithState(w);
  const breaking = await makeUpdate(w.v1, w.v2, { publisherId: w.publisherId, key: w.key }, { state: { ...V2_MIGRATION, backwardCompatible: false } });
  await updateToV2(w, breaking);
  const record = await w.lifecycle.record(LANTERN);
  const state = await w.lifecycle.readState(LANTERN);
  const result = await w.lifecycle.rollback(LANTERN, "testing");
  assert.equal(result.status, "RECOVERY_REQUIRED");
  assert.deepEqual(await w.lifecycle.record(LANTERN), record, "record unchanged");
  assert.deepEqual(await w.lifecycle.readState(LANTERN), state, "state unchanged — nothing corrupted or deleted");
  // With a failed launch, the installation is marked and refuses to open until resolved.
  await w.lifecycle.rollback(LANTERN, "launch failed", { launchFailed: true });
  await rejects(w.lifecycle.open(LANTERN, { environment: { online: false } }), "RECOVERY_REQUIRED");
  assert.deepEqual(await w.lifecycle.readState(LANTERN), state);
  // An update that forbids rollback.
  const w2 = await world();
  await w2.lifecycle.install(w2.v1.bytes);
  await updateToV2(w2, await makeUpdate(w2.v1, w2.v2, { publisherId: w2.publisherId, key: w2.key }, { rollback: { eligible: false, minimumSequence: 1 } }));
  await rejects(w2.lifecycle.rollback(LANTERN, "testing"), "ROLLBACK_NOT_ELIGIBLE");
});

test("owner cloning is refused: separate installations, foreign or sensitive state rejected", async () => {
  const a = await world();
  const b = await world();
  b.trust = a.trust;
  await a.lifecycle.install(a.v1.bytes);
  await b.lifecycle.install(a.v1.bytes);
  const ra = await a.lifecycle.record(LANTERN);
  const rb = await b.lifecycle.record(LANTERN);
  assert.notEqual(ra.installationId, rb.installationId);
  assert.notEqual(ra.stateId, rb.stateId);
  assert.deepEqual(rb.authority, { owner: null, grants: [] });
  const stateA = await a.lifecycle.readState(LANTERN);
  await rejects(b.lifecycle.writeState(LANTERN, () => stateA), "STATE_CONFLICT");
  await rejects(a.lifecycle.writeState(LANTERN, (s) => ({ ...s, owner: "trustid:someone" } as never)), "SENSITIVE_STATE_REJECTED");
  await rejects(a.lifecycle.writeState(LANTERN, (s) => ({ ...s, settings: { ...s.settings, grants: "admin" } })), "SENSITIVE_STATE_REJECTED");
  await rejects(a.lifecycle.writeState(LANTERN, (s) => ({ ...s, preferences: { ...s.preferences, sessionToken: "abc" } })), "SENSITIVE_STATE_REJECTED");
  await rejects(a.lifecycle.writeState(LANTERN, (s) => ({ ...s, pendingOperations: [{ opId: "pay", kind: "pay", consequential: true, status: "PENDING", createdAt: "x", payload: { cardNumber: "4111111111111111" } }] })), "SENSITIVE_STATE_REJECTED");
  await rejects(makeUpdate(a.v1, a.v2, { publisherId: a.publisherId, key: a.key }, { owner: "x" } as never), "AUTHORITY_CLONING_REJECTED");
});

test("forks: refused without licence permission; a permitted fork is a new lineage, never an update", async () => {
  const w = await world();
  const v1 = releaseSource("v1");
  const forker = await newKey("forker-1");
  const publishers = [{ publisherId: w.publisherId, name: "Demo", keys: [w.key], packagePrefixes: ["org.digiconomy.demo."] }];
  const closed = await pack({ ...v1.declaration, license: { spdx: "LicenseRef-Proprietary", duplication: "PROHIBITED", redistribution: false } }, v1.files, signerFor(w.publisherId, w.key), 1);
  const forkDeclaration = { ...v1.declaration, package: { ...v1.declaration.package, id: "org.fork.lantern", name: "Lantern Fork" }, space: { ...v1.declaration.space, spaceId: "org.fork.lantern" } };
  await rejects(forkSpace({ parent: closed.bytes, parentPublishers: publishers, runtime: { version: "1.0.0" }, declaration: forkDeclaration, signer: signerFor("forker.pub", forker) }), "FORK_NOT_PERMITTED");

  const fork = await forkSpace({ parent: w.v1.bytes, parentPublishers: publishers, runtime: { version: "1.0.0" }, declaration: forkDeclaration, signer: signerFor("forker.pub", forker) });
  const manifest = (await inspectSpacePackage(fork.bytes)).manifest as SpacePackageManifest;
  assert.deepEqual(manifest.provenance.parent, fork.parent);
  assert.equal(manifest.publisher.publisherId, "forker.pub");
  w.trust = trustStoreFromPublishers([...publishers, { publisherId: "forker.pub", name: "Forker", keys: [forker], packagePrefixes: ["org.fork."] }]);
  await w.lifecycle.install(w.v1.bytes);
  await w.lifecycle.install(fork.bytes);
  const parentRecord = await w.lifecycle.record(LANTERN);
  const forkRecord = await w.lifecycle.record("org.fork.lantern");
  assert.notEqual(forkRecord.installationId, parentRecord.installationId);
  assert.deepEqual(forkRecord.authority, { owner: null, grants: [] });
  // A fork can never be applied as an update to its parent.
  const forkRelease = { bytes: fork.bytes, version: "1.0.0", packageDigest: (await inspectSpacePackage(fork.bytes)).signature.manifestSha256, sequence: 2 };
  await rejects((async () => { const t = await w.lifecycle.stageUpdate(await makeUpdate(w.v1, { ...forkRelease, version: "1.0.1" }, { publisherId: "forker.pub", key: forker }), fork.bytes); return w.lifecycle.verifyUpdate(LANTERN, t.txId); })(), "PUBLISHER_CHANGED");
});

test("offline update from a fully available, trusted package makes no network request", async () => {
  const w = await world();
  await installedWithState(w);
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => { calls.push(String(input)); throw new Error("offline"); }) as typeof fetch;
  try {
    const tx = await updateToV2(w);
    assert.equal(tx.state, "ACTIVE");
    assert.equal((tx.evidence as { revocation: { status: string } }).revocation.status, "UNKNOWN", "offline: freshness is not claimed");
    await w.lifecycle.open(LANTERN, { environment: { online: false } });
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original;
  }
});
