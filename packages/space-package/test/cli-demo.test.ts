import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SpacePackageError } from "../src/index.js";
import { run } from "../src/cli.js";
import { DEMO_DIR, testPublisher } from "./helpers.js";

/**
 * SP1 demonstration, through the real CLI and filesystem:
 * export → verify → copy elsewhere → import into a fresh runtime state → open offline →
 * no inherited authority → tamper → rejected.
 */
test("demonstration: pack, verify, copy, import fresh, open offline, no authority, tamper rejected", async () => {
  const work = await mkdtemp(join(tmpdir(), "space-sp1-demo-"));
  const transcript: Record<string, unknown> = {};
  try {
    const publisher = await testPublisher();
    await writeFile(join(work, "signer.json"), JSON.stringify(publisher.signer));
    await writeFile(join(work, "trust.json"), JSON.stringify([publisher.trusted]));

    // 1. Export.
    const packageFile = join(work, "publisher", "lantern.space");
    await mkdir(join(work, "publisher"));
    transcript.pack = await run(["pack", DEMO_DIR, "--key", join(work, "signer.json"), "--out", packageFile]);

    // 2. Verify (offline).
    transcript.verify = await run(["verify", packageFile, "--publishers", join(work, "trust.json")]);
    assert.equal((transcript.verify as { trust: string }).trust, "TRUSTED_PUBLISHER");

    // 3. Copy to another directory (another device, a USB stick, a share).
    const copied = join(work, "recipient", "inbox", "lantern.space");
    await mkdir(join(work, "recipient", "inbox"), { recursive: true });
    await cp(packageFile, copied);
    transcript.inspect = await run(["inspect", copied]);

    // 4. Import into a fresh local runtime state.
    const state = join(work, "recipient", "runtime-state");
    transcript.import = await run(["import", copied, "--state", state, "--publishers", join(work, "trust.json")]);
    assert.equal((transcript.import as { status: string }).status, "INSTALLED");
    transcript.list = await run(["list", "--state", state]);
    assert.equal((transcript.list as unknown[]).length, 1);

    // 5. Open the offline experience.
    const opened = (await run(["open", "org.digiconomy.demo.lantern", "--state", state])) as {
      experience: { state: string; content: { items: Array<{ id: string }> } };
      permissions: { granted: string[]; denied: Array<{ permission: string; reason: string }> };
      installation: { authority: unknown; installationId: string };
      definition: { owner: string };
      network: string;
    };
    transcript.open = opened;
    assert.equal(opened.experience.state, "READY");
    assert.deepEqual(opened.experience.content.items.map((item) => item.id), ["lantern", "chime"]);
    assert.equal(opened.network, "NOT_USED");

    // 6. No inherited owner authority.
    assert.deepEqual(opened.installation.authority, { owner: null, grants: [] });
    assert.equal(opened.definition.owner, `installation:${opened.installation.installationId}`);
    const record = JSON.parse(await readFile(join(state, "installations", "org.digiconomy.demo.lantern", "installation.json"), "utf8"));
    assert.ok(!JSON.stringify(record).includes(publisher.signer.privateKeyPkcs8Base64), "no signing key in installation state");

    // 7. Tamper with the package: one byte of the image inside the copied archive.
    const bytes = new Uint8Array(await readFile(copied));
    const png = Buffer.from(bytes).indexOf(Buffer.from([0x49, 0x44, 0x41, 0x54])); // "IDAT"
    bytes[png + 10] ^= 0x01;
    const tampered = join(work, "recipient", "inbox", "lantern-tampered.space");
    await writeFile(tampered, bytes);
    await assert.rejects(run(["verify", tampered, "--publishers", join(work, "trust.json")]), (error: unknown) => error instanceof SpacePackageError && ["ASSET_MODIFIED", "CRC_MISMATCH"].includes(error.code));
    await assert.rejects(run(["import", tampered, "--state", join(work, "fresh-2"), "--publishers", join(work, "trust.json")]), SpacePackageError);
    transcript.tamper = "rejected";
    console.log("SP1_DEMO", JSON.stringify({ pack: transcript.pack, verify: transcript.verify, import: transcript.import, open: { state: opened.experience.state, items: opened.experience.content.items.length, granted: opened.permissions.granted, denied: opened.permissions.denied, authority: opened.installation.authority, owner: opened.definition.owner, network: opened.network }, tamper: transcript.tamper }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("pack never follows a symlink out of the source folder", async (t) => {
  const work = await mkdtemp(join(tmpdir(), "space-sp1-symlink-"));
  try {
    await cp(DEMO_DIR, join(work, "src"), { recursive: true });
    await writeFile(join(work, "outside-secret.txt"), "secret");
    try {
      await symlink(join(work, "outside-secret.txt"), join(work, "src", "content", "escape.txt"));
    } catch {
      t.skip("this OS account cannot create symlinks");
      return;
    }
    const publisher = await testPublisher();
    await writeFile(join(work, "signer.json"), JSON.stringify(publisher.signer));
    await assert.rejects(run(["pack", join(work, "src"), "--key", join(work, "signer.json"), "--out", join(work, "x.space")]), (error: unknown) => error instanceof SpacePackageError && error.code === "SYMLINK_NOT_ALLOWED");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
