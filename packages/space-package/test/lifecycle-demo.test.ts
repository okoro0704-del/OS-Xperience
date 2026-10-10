import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { SpacePackageError } from "../src/index.js";
import { run } from "../src/cli.js";
import { RELEASES, newKey } from "./lifecycle-helpers.js";

/**
 * SP2 demonstration through the real CLI and filesystem (disposable keys and state):
 *  1 install V1 · 2 local preferences and pending offline state · 3 stage V2 · 4 verify publisher and
 *  integrity · 5 activate V2 · 6 installation identity unchanged · 7 permitted state survives ·
 *  8 interrupted V3 (a real process crash mid-activation) · 9 V2 still usable · 10 safe rollback ·
 *  11 revoke a key, and an update it signed is rejected.
 */
const CLI = resolve(import.meta.dirname, "../src/cli.ts");
const LANTERN = "org.digiconomy.demo.lantern";

test("demonstration: Lantern V1 → V2 with state continuity, interrupted V3, rollback, key revocation", async () => {
  const work = await mkdtemp(join(tmpdir(), "space-sp2-demo-"));
  const evidence: Record<string, unknown> = {};
  const space = (...argv: string[]) => run(argv);
  try {
    const k1 = await newKey("demo-key-1");
    const signer1 = join(work, "publisher", "signer-k1.json");
    await mkdir(join(work, "publisher"), { recursive: true });
    await writeFile(signer1, JSON.stringify({ publisherId: "digiconomy.demo", keyId: k1.keyId, privateKeyPkcs8Base64: k1.privateKeyPkcs8Base64 }));
    await writeFile(join(work, "publishers.json"), JSON.stringify([{ publisherId: "digiconomy.demo", name: "Digiconomy Demo Publisher", keys: [{ keyId: k1.keyId, publicKeySpkiBase64: k1.publicKeySpkiBase64 }], packagePrefixes: ["org.digiconomy.demo."] }]));
    const trust = join(work, "device", "trust.json");
    const state = join(work, "device", "state");
    await mkdir(join(work, "device"), { recursive: true });
    await space("keys", "init", "--publishers", join(work, "publishers.json"), "--out", trust);
    const T = ["--state", state, "--trust", trust];

    // Publisher side: two signed releases and the signed V1 → V2 update.
    const v1 = join(work, "publisher", "lantern-1.0.0.space");
    const v2 = join(work, "publisher", "lantern-2.0.0.space");
    await space("pack", join(RELEASES, "v1"), "--key", signer1, "--out", v1);
    await space("pack", join(RELEASES, "v2"), "--key", signer1, "--out", v2);
    const migration = join(work, "publisher", "migration-1-2.json");
    await writeFile(migration, JSON.stringify({ fromDataVersion: 1, toDataVersion: 2, migration: [{ op: "setPreferenceDefault", key: "chime.volume", value: 0.8 }, { op: "setSettingDefault", key: "gallery.layout", value: "grid" }], backwardCompatible: true }));
    const u12 = join(work, "publisher", "lantern-2.0.0.update.json");
    await space("update", "create", "--from", v1, "--to", v2, "--key", signer1, "--from-sequence", "1", "--to-sequence", "2", "--migration", migration, "--out", u12);

    // 1. Install V1.
    const installed = (await space("install", v1, ...T)) as { installationId: string; authority: unknown };
    evidence.install = installed;
    assert.deepEqual(installed.authority, { owner: null, grants: [] });

    // 2. Local preferences and pending offline state.
    const patch = join(work, "device", "patch.json");
    await writeFile(patch, JSON.stringify({
      preferences: { autoplay: true },
      settings: { theme: "dusk" },
      playlists: [{ id: "my-evening", title: "My evening", items: ["chime", "lantern"] }],
      userContent: [{ id: "note-1", title: "Lantern sketch", ref: "local://user/notes/1", createdAt: "2026-10-10T09:00:00.000Z" }],
      addOperations: [
        { opId: "sync-likes-1", kind: "sync.likes", consequential: false, createdAt: "2026-10-10T09:00:00.000Z", payload: { count: 3 } },
        { opId: "tip-creator-1", kind: "settlement.tip", consequential: true, createdAt: "2026-10-10T09:01:00.000Z", payload: { amount: 500, currency: "NGN" } },
      ],
    }));
    const before = (await space("state", "merge", LANTERN, patch, ...T)) as { playlists: unknown; userContent: unknown; pendingOperations: unknown[]; stateId: string };

    // 3–5. Stage V2, verify publisher and integrity, activate.
    const staged = (await space("update", "stage", u12, v2, ...T)) as { txId: string; state: string };
    assert.equal(staged.state, "STAGED");
    const verified = (await space("update", "verify", LANTERN, staged.txId, ...T)) as { state: string; evidence: Record<string, unknown> };
    assert.equal(verified.state, "VERIFIED");
    evidence.verify = verified.evidence;
    const active = (await space("update", "activate", LANTERN, staged.txId, ...T)) as { state: string };
    assert.equal(active.state, "ACTIVE");

    // 6. Same installation identity. 7. Permitted state survived (and migrated).
    const status = (await space("status", LANTERN, ...T)) as { installationId: string; stateId: string; active: { version: string }; previous: { version: string } };
    assert.equal(status.installationId, installed.installationId);
    assert.equal(status.stateId, before.stateId);
    assert.equal(status.active.version, "2.0.0");
    assert.equal(status.previous.version, "1.0.0");
    const after = (await space("state", "show", LANTERN, ...T)) as { dataVersion: number; preferences: Record<string, unknown>; playlists: unknown; userContent: unknown; pendingOperations: unknown[] };
    assert.equal(after.dataVersion, 2);
    assert.deepEqual(after.playlists, before.playlists);
    assert.deepEqual(after.userContent, before.userContent);
    assert.deepEqual(after.pendingOperations, before.pendingOperations);
    assert.equal(after.preferences["chime.volume"], 0.8);
    const launchV2 = (await space("launch", LANTERN, ...T)) as { experience: { state: string; items: string[] } };
    assert.equal(launchV2.experience.items.length, 3);
    evidence.v2 = { status: { installationId: status.installationId, active: status.active.version, previous: status.previous.version }, state: { dataVersion: after.dataVersion, preferences: after.preferences, pendingOperations: after.pendingOperations.length }, launch: launchV2.experience };

    // 8. An interrupted V3 update: the process dies after the V3 release is written, before the commit point.
    const v3src = join(work, "publisher", "v3-src");
    await cp(join(RELEASES, "v2"), v3src, { recursive: true });
    const v3decl = JSON.parse(await readFile(join(v3src, "space.source.json"), "utf8"));
    v3decl.package.version = "3.0.0";
    await writeFile(join(v3src, "space.source.json"), JSON.stringify(v3decl));
    const v3 = join(work, "publisher", "lantern-3.0.0.space");
    await space("pack", v3src, "--key", signer1, "--out", v3);
    const m23 = join(work, "publisher", "migration-2-3.json");
    await writeFile(m23, JSON.stringify({ fromDataVersion: 2, toDataVersion: 3, migration: [{ op: "renamePreference", from: "chime.volume", to: "audio.volume" }], backwardCompatible: false }));
    const u23 = join(work, "publisher", "lantern-3.0.0.update.json");
    await space("update", "create", "--from", v2, "--to", v3, "--key", signer1, "--from-sequence", "2", "--to-sequence", "3", "--migration", m23, "--out", u23);
    const crash = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      import { SpaceLifecycle, parseTrustStore } from "${pathToFileURL(resolve(import.meta.dirname, "../src/index.ts")).href}";
      import { FileLifecycleBackend } from "${pathToFileURL(resolve(import.meta.dirname, "../src/node-backend.ts")).href}";
      import { readFileSync } from "node:fs";
      const trust = parseTrustStore(JSON.parse(readFileSync(${JSON.stringify(trust)}, "utf8")));
      const engine = new SpaceLifecycle(new FileLifecycleBackend(${JSON.stringify(state)}), { trust: () => trust, runtime: { version: "1.0.0" },
        failpoint: (point) => { if (point === "release-written") { console.log("power lost after the V3 release was written"); process.exit(137); } } });
      const tx = await engine.stageUpdate(readFileSync(${JSON.stringify(u23)}), readFileSync(${JSON.stringify(v3)}));
      await engine.applyStagedUpdate("${LANTERN}", tx.txId);
    `], { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" });
    assert.equal(crash.status, 137, crash.stderr);
    evidence.crash = crash.stdout.trim();

    // 9. V2 is still the active, usable release (the next command runs deterministic recovery first).
    const relaunch = (await space("launch", LANTERN, ...T)) as { experience: { state: string; items: string[] } };
    assert.equal(relaunch.experience.state, "READY");
    const history = (await space("update", "history", LANTERN, ...T)) as Array<{ to: string; state: string; path: string }>;
    assert.equal(history.find((item) => item.to === "3.0.0")!.state, "INTERRUPTED");
    assert.equal(((await space("status", LANTERN, ...T)) as { active: { version: string } }).active.version, "2.0.0");
    assert.deepEqual((await readdir(join(state, "installations", LANTERN, "releases"))).length, 2, "the partial V3 release was removed; V1 and V2 remain");
    evidence.afterCrash = { active: "2.0.0", history };

    // 10. Safe rollback to V1: compatible state is kept as-is; the consequential operation is held, not replayed.
    const rollback = (await space("update", "rollback", LANTERN, "--reason", "demonstration", ...T)) as { status: string };
    assert.equal(rollback.status, "ROLLED_BACK");
    const rolled = (await space("state", "show", LANTERN, ...T)) as { userContent: unknown; pendingOperations: Array<{ opId: string; status: string }> };
    assert.deepEqual(rolled.userContent, before.userContent);
    assert.equal(rolled.pendingOperations.length, 2);
    assert.equal(rolled.pendingOperations.find((op) => op.opId === "tip-creator-1")!.status, "HELD");
    const launchV1 = (await space("launch", LANTERN, ...T)) as { experience: { items: string[] } };
    assert.equal(launchV1.experience.items.length, 2);
    evidence.rollback = { status: rollback.status, operations: rolled.pendingOperations, launch: launchV1.experience };

    // 11. Rotate to a new key, revoke the old one, and an update signed by the revoked key is rejected.
    const k2 = await newKey("demo-key-2");
    const signer2 = join(work, "publisher", "signer-k2.json");
    await writeFile(signer2, JSON.stringify({ publisherId: "digiconomy.demo", keyId: k2.keyId, privateKeyPkcs8Base64: k2.privateKeyPkcs8Base64 }));
    const rotation = join(work, "publisher", "rotation.json");
    await space("keys", "sign-rotation", "--key", signer1, "--retire", k1.keyId, "--new-key-id", k2.keyId, "--new-public", k2.publicKeySpkiBase64, "--sequence", "1", "--out", rotation);
    await space("keys", "rotate", "--trust", trust, "--statement", rotation);
    const revocations = join(work, "publisher", "revocations.json");
    await space("keys", "sign-revocation", "--key", signer2, "--revoke", k1.keyId, "--sequence", "1", "--out", revocations);
    const keys = (await space("keys", "revoke", "--trust", trust, "--list", revocations)) as { publishers: Array<{ keys: Array<{ keyId: string; state: string }>; revocation: { status: string } }> };
    assert.deepEqual(keys.publishers[0]!.keys.map((key) => [key.keyId, key.state]), [["demo-key-1", "REVOKED"], ["demo-key-2", "ACTIVE"]]);
    const replay = (await space("update", "inspect", u12, v2, ...T)) as { acceptable: boolean; code: string };
    assert.equal(replay.acceptable, false);
    assert.equal(replay.code, "KEY_REVOKED");
    await assert.rejects(space("update", "stage", u12, v2, ...T).then((tx) => space("update", "verify", LANTERN, (tx as { txId: string }).txId, ...T)), (error: unknown) => error instanceof SpacePackageError && error.code === "KEY_REVOKED");
    evidence.revocation = { keys: keys.publishers[0]!.keys, freshness: keys.publishers[0]!.revocation, rejected: replay.code };

    // No private key ever reached device state or the trust store.
    const deviceFiles = await readAll(join(work, "device"));
    assert.ok(!deviceFiles.includes(k1.privateKeyPkcs8Base64) && !deviceFiles.includes(k2.privateKeyPkcs8Base64), "no private key in device state");
    console.log("SP2_DEMO", JSON.stringify(evidence));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

async function readAll(dir: string): Promise<string> {
  let text = "";
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) text += await readFile(join(entry.parentPath, entry.name), "latin1");
  }
  return text;
}
