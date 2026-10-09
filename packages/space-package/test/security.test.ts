import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  LIMITS,
  MemoryInstallationStore,
  SpacePackageError,
  importSpacePackage,
  inspectSpacePackage,
  integrityRoot,
  openSpace,
  packSpace,
  sha256Hex,
  verifySpacePackage,
  type PackageErrorCode,
  type SpacePackageManifest,
} from "../src/index.js";
import { FileInstallationStore } from "../src/node-store.js";
import { verifySpaceLaunchFile } from "@digiconomy/xperience-contract";
import { RUNTIME, assemble, craftZip, demoDeclaration, demoFiles, replaceEntry, testPublisher } from "./helpers.js";

async function rejects(promise: Promise<unknown>, code: PackageErrorCode) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SpacePackageError, `expected SpacePackageError ${code}, got ${String(error)}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

async function demo() {
  const publisher = await testPublisher();
  const files = demoFiles();
  const packed = await packSpace({ declaration: demoDeclaration(), files, signer: publisher.signer });
  return { publisher, files, ...packed, publishers: [publisher.trusted] };
}

test("valid signed package: packs deterministically, inspects without trust, verifies offline", async () => {
  const { bytes, manifest, publishers, publisher, files } = await demo();
  const again = await packSpace({ declaration: demoDeclaration(), files, signer: publisher.signer });
  assert.equal(await sha256Hex(again.bytes), await sha256Hex(bytes), "same inputs, same package bytes");

  const inspection = await inspectSpacePackage(bytes);
  assert.equal(inspection.trust, "NOT_EVALUATED");
  assert.deepEqual(inspection.entries.slice(0, 3).map((entry) => entry.path), ["mimetype", "META-INF/space.json", "META-INF/signature.json"]);

  const verified = await verifySpacePackage(bytes, { publishers, runtime: RUNTIME });
  assert.equal(verified.trust, "TRUSTED_PUBLISHER");
  assert.equal(verified.integrityRoot, manifest.integrity.root);
  assert.deepEqual([...verified.assets.keys()].sort(), ["content/index.json", "content/media/chime.wav", "content/media/lantern.png"]);
});

test("the package is recognised by content, not extension: launch files and plain ZIPs are refused", async () => {
  const launchFile = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/os-experience/public/spaces/mrfundzman.space")));
  await rejects(inspectSpacePackage(launchFile), "NOT_A_SPACE_PACKAGE");
  await rejects(inspectSpacePackage(craftZip([{ path: "content/a.txt", bytes: new TextEncoder().encode("hi") }])), "NOT_A_SPACE_PACKAGE");
  await rejects(inspectSpacePackage(craftZip([{ path: "mimetype", bytes: new TextEncoder().encode("application/zip") }])), "NOT_A_SPACE_PACKAGE");
});

test("tampered manifest: any change to the signed manifest fails the signature", async () => {
  const { manifest, publisher, files, publishers } = await demo();
  const good = await assemble(manifest, publisher.signer, files);
  await verifySpacePackage(good, { publishers, runtime: RUNTIME });
  // Re-pack the archive with an edited manifest but the original signature document.
  const inspection = await inspectSpacePackage(good);
  const tampered: SpacePackageManifest = { ...manifest, package: { ...manifest.package, name: "Lantern (pirated)" } };
  const forged = await assemble(tampered, publisher.signer, files);
  const forgedSignature = (await inspectSpacePackage(forged)).signature;
  assert.notEqual(forgedSignature.value, inspection.signature.value);
  const mismatched = craftAssemble(tampered, inspection.signature, files);
  await rejects(verifySpacePackage(mismatched, { publishers, runtime: RUNTIME }), "SIGNATURE_INVALID");
});

function craftAssemble(manifest: SpacePackageManifest, signature: unknown, files: readonly { path: string; bytes: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const json = (value: unknown) => encoder.encode(JSON.stringify(value));
  return craftZip([
    { path: "mimetype", bytes: encoder.encode("application/vnd.digiconomy.space-package") },
    { path: "META-INF/space.json", bytes: json(manifest) },
    { path: "META-INF/signature.json", bytes: json(signature) },
    ...files,
  ]);
}

test("modified asset: a changed image is refused even when the archive CRC is recomputed", async () => {
  const { manifest, publisher, files, publishers } = await demo();
  const png = files.find((file) => file.path.endsWith(".png"))!;
  const changed = png.bytes.slice();
  changed[changed.length - 20] ^= 0xff;
  await rejects(verifySpacePackage(await assemble(manifest, publisher.signer, replaceEntry(files, png.path, changed)), { publishers, runtime: RUNTIME }), "ASSET_MODIFIED");
  // An extra, undeclared file is refused too.
  await rejects(verifySpacePackage(await assemble(manifest, publisher.signer, files, [{ path: "content/extra.txt", bytes: new TextEncoder().encode("x") }]), { publishers, runtime: RUNTIME }), "UNDECLARED_ENTRY");
  // A declared asset that is missing is refused.
  await rejects(verifySpacePackage(await assemble(manifest, publisher.signer, files.filter((file) => file !== png)), { publishers, runtime: RUNTIME }), "ASSET_MISSING");
});

test("integrity root: a manifest whose root does not match its own inventory is refused", async () => {
  const { manifest, publisher, files, publishers } = await demo();
  const wrongRoot = { ...manifest, integrity: { algorithm: "SHA-256" as const, root: "0".repeat(64) } };
  await rejects(verifySpacePackage(await assemble(wrongRoot, publisher.signer, files), { publishers, runtime: RUNTIME }), "INTEGRITY_ROOT_MISMATCH");
  assert.equal(await integrityRoot(manifest.assets), manifest.integrity.root);
});

test("invalid publisher signature: same key id, different key", async () => {
  const { manifest, files, publishers } = await demo();
  const impostor = await testPublisher(); // same publisherId and keyId, different private key
  await rejects(verifySpacePackage(await assemble(manifest, impostor.signer, files), { publishers, runtime: RUNTIME }), "SIGNATURE_INVALID");
});

test("unknown publisher is never elevated to trusted: verify and import refuse, nothing installs", async () => {
  const { bytes, publisher } = await demo();
  await rejects(verifySpacePackage(bytes, { publishers: [], runtime: RUNTIME }), "PUBLISHER_UNKNOWN");
  const other = await testPublisher("someone.else", "k1");
  await rejects(verifySpacePackage(bytes, { publishers: [other.trusted], runtime: RUNTIME }), "PUBLISHER_UNKNOWN");
  // A known publisher with a different key id is still unknown for this package.
  await rejects(verifySpacePackage(bytes, { publishers: [{ ...publisher.trusted, keys: [{ keyId: "rotated", publicKeySpkiBase64: publisher.trusted.keys[0]!.publicKeySpkiBase64 }] }], runtime: RUNTIME }), "PUBLISHER_UNKNOWN");
  // A trusted publisher may only sign its own package namespace.
  await rejects(verifySpacePackage(bytes, { publishers: [{ ...publisher.trusted, packagePrefixes: ["com.other."] }], runtime: RUNTIME }), "PUBLISHER_NOT_AUTHORIZED");
  const store = new MemoryInstallationStore();
  await rejects(importSpacePackage(bytes, { publishers: [], runtime: RUNTIME, store }), "PUBLISHER_UNKNOWN");
  assert.deepEqual(await store.list(), []);
});

test("unsupported format version and incompatible runtime", async () => {
  const { manifest, publisher, files, publishers } = await demo();
  const v2 = { ...manifest, formatVersion: 2 } as unknown as SpacePackageManifest;
  await rejects(verifySpacePackage(await assemble(v2, publisher.signer, files), { publishers, runtime: RUNTIME }), "UNSUPPORTED_FORMAT_VERSION");
  const future = { ...manifest, runtime: { spaceContractVersion: 1, minimumRuntimeVersion: "2.0.0" } };
  await rejects(verifySpacePackage(await assemble(future, publisher.signer, files), { publishers, runtime: RUNTIME }), "INCOMPATIBLE_RUNTIME");
  const contract2 = { ...manifest, runtime: { spaceContractVersion: 2, minimumRuntimeVersion: "1.0.0" } };
  await rejects(verifySpacePackage(await assemble(contract2, publisher.signer, files), { publishers, runtime: RUNTIME }), "INCOMPATIBLE_RUNTIME");
});

test("missing dependency blocks import until the dependency is installed", async () => {
  const publisher = await testPublisher();
  const base = await packSpace({ declaration: { ...demoDeclaration(), package: { id: "org.digiconomy.demo.base", version: "1.2.0", name: "Base" }, space: { ...demoDeclaration().space, spaceId: "org.digiconomy.demo.base" } }, files: demoFiles(), signer: publisher.signer });
  const dependent = await packSpace({ declaration: { ...demoDeclaration(), dependencies: [{ packageId: "org.digiconomy.demo.base", minimumVersion: "1.1.0" }] }, files: demoFiles(), signer: publisher.signer });
  const store = new MemoryInstallationStore();
  const options = { publishers: [publisher.trusted], runtime: RUNTIME, store };
  await rejects(importSpacePackage(dependent.bytes, options), "MISSING_DEPENDENCY");
  assert.deepEqual(await store.list(), []);
  assert.equal((await importSpacePackage(base.bytes, options)).status, "INSTALLED");
  assert.equal((await importSpacePackage(dependent.bytes, options)).status, "INSTALLED");
});

test("path traversal, absolute paths and symlink entries are refused before anything is read", async () => {
  const text = new TextEncoder().encode("x");
  const mimetype = { path: "mimetype", bytes: new TextEncoder().encode("application/vnd.digiconomy.space-package") };
  for (const path of ["content/../../etc/passwd", "../outside.txt", "content/./a.txt", "/etc/passwd", "C:/Windows/system.ini", "content\\..\\x.txt", "content//a.txt", "content/con.txt", "content/a.txt."]) {
    await rejects(inspectSpacePackage(craftZip([mimetype, { path, bytes: text }])), "UNSAFE_PATH");
  }
  await rejects(inspectSpacePackage(craftZip([mimetype, { path: "content/link.png", bytes: new TextEncoder().encode("/etc/passwd"), mode: 0o120777 }])), "SYMLINK_NOT_ALLOWED");
  await rejects(inspectSpacePackage(craftZip([mimetype, { path: "content/dev", bytes: text, mode: 0o020644 }])), "UNSAFE_PATH");
});

test("oversized archives and decompression bombs are refused within the limits", async () => {
  const { bytes, publishers } = await demo();
  await rejects(verifySpacePackage(bytes, { publishers, runtime: RUNTIME, limits: { ...LIMITS, maxArchiveBytes: 1024 } }), "ARCHIVE_TOO_LARGE");
  const mimetype = { path: "mimetype", bytes: new TextEncoder().encode("application/vnd.digiconomy.space-package") };
  // 64 MB of zeros deflates to ~64 KB: a ratio far above the limit.
  const zeros = new Uint8Array(64 * 1024 * 1024);
  await rejects(inspectSpacePackage(craftZip([mimetype, { path: "content/bomb.txt", bytes: zeros, method: 8 }])), "DECOMPRESSION_BOMB");
  // A lying header: declared small, inflates past it — stopped while inflating.
  const liar = craftZip([mimetype, { path: "META-INF/space.json", bytes: new Uint8Array(4 * 1024 * 1024).fill(32), method: 8, declaredSize: 4000 }]);
  await rejects(inspectSpacePackage(liar), "DECOMPRESSION_BOMB");
  await rejects(inspectSpacePackage(craftZip([mimetype, { path: "content/big.txt", bytes: text1(), declaredSize: LIMITS.maxEntryBytes + 1 }])), "ENTRY_TOO_LARGE");
  await rejects(inspectSpacePackage(craftZip(Array.from({ length: 10 }, (_, i) => ({ path: `content/${i}.txt`, bytes: text1() })), ), { ...LIMITS, maxEntries: 5 }), "TOO_MANY_ENTRIES");
});
const text1 = () => new TextEncoder().encode("1");

test("duplicate archive paths (exact or by case) are refused", async () => {
  const mimetype = { path: "mimetype", bytes: new TextEncoder().encode("application/vnd.digiconomy.space-package") };
  await rejects(inspectSpacePackage(craftZip([mimetype, { path: "content/a.txt", bytes: text1() }, { path: "content/a.txt", bytes: text1() }])), "DUPLICATE_PATH");
  await rejects(inspectSpacePackage(craftZip([mimetype, { path: "content/A.txt", bytes: text1() }, { path: "content/a.txt", bytes: text1() }])), "DUPLICATE_PATH");
});

test("interrupted import (crash before commit) leaves nothing installed and is recovered", async () => {
  const { bytes, publishers, manifest } = await demo();
  const root = await mkdtemp(join(tmpdir(), "space-sp1-crash-"));
  try {
    const crashed = new FileInstallationStore(root);
    const staging = await crashed.stage(manifest.package.id);
    await staging.writeAsset("content/index.json", new TextEncoder().encode("{}"));
    // …the process dies here: no commit, no abort.
    const restarted = new FileInstallationStore(root);
    assert.deepEqual(await restarted.list(), [], "a half-written import is never visible");
    assert.equal((await readdir(join(root, ".staging"))).length, 1);
    assert.equal((await importSpacePackage(bytes, { publishers, runtime: RUNTIME, store: restarted })).status, "INSTALLED");
    assert.deepEqual(await readdir(join(root, ".staging")), [], "recovery discarded the crashed staging");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("import rollback: a failure mid-import removes everything that import wrote", async () => {
  const { bytes, publishers } = await demo();
  const root = await mkdtemp(join(tmpdir(), "space-sp1-rollback-"));
  try {
    const store = new FileInstallationStore(root);
    for (const step of ["STAGED_ARTIFACT", "STAGED_ASSETS", "STAGED_RECORD"] as const) {
      await rejects(importSpacePackage(bytes, { publishers, runtime: RUNTIME, store, onStep: (at) => { if (at === step) throw new Error(`power lost at ${step}`); } }), "IMPORT_INTERRUPTED");
      assert.deepEqual(await store.list(), [], `nothing installed after failing at ${step}`);
      assert.deepEqual(await readdir(join(root, ".staging")), [], `staging rolled back after ${step}`);
    }
    assert.equal((await importSpacePackage(bytes, { publishers, runtime: RUNTIME, store })).status, "INSTALLED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate installation is idempotent; a different package under the same id is a conflict", async () => {
  const { bytes, publishers, publisher } = await demo();
  const store = new MemoryInstallationStore();
  const first = await importSpacePackage(bytes, { publishers, runtime: RUNTIME, store });
  const second = await importSpacePackage(bytes, { publishers, runtime: RUNTIME, store });
  assert.equal(second.status, "ALREADY_INSTALLED");
  assert.equal(second.record.installationId, first.record.installationId);
  const v2 = await packSpace({ declaration: { ...demoDeclaration(), package: { ...demoDeclaration().package, version: "1.1.0" } }, files: demoFiles(), signer: publisher.signer });
  await rejects(importSpacePackage(v2.bytes, { publishers, runtime: RUNTIME, store }), "INSTALLED_VERSION_CONFLICT");
  assert.equal((await store.list()).length, 1);
});

test("unauthorized private data is refused on export and on import", async () => {
  const publisher = await testPublisher();
  const encoder = new TextEncoder();
  const leaks: Array<[string, string, string]> = [
    ["content/session.json", "application/json", JSON.stringify({ sessionToken: "abc" })],
    ["content/profile.json", "application/json", JSON.stringify({ faceEmbedding: [0.1, 0.2] })],
    ["content/pdi.json", "application/json", JSON.stringify({ pdiRecord: { name: "x" } })],
    ["content/pay.json", "application/json", JSON.stringify({ cardNumber: "4111111111111111" })],
    ["content/notes.txt", "text/plain", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"],
    ["content/jwt.txt", "text/plain", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
    ["content/key.txt", "text/plain", "-----BEGIN PRIVATE KEY-----\nMC4CAQAw\n-----END PRIVATE KEY-----"],
    ["content/cookies.txt", "text/plain", "Cookie: sid=1"],
  ];
  for (const [path, mediaType, body] of leaks) {
    await rejects(packSpace({ declaration: demoDeclaration(), files: [...demoFiles(), { path, mediaType, bytes: encoder.encode(body) }], signer: publisher.signer }), "PRIVATE_DATA_DETECTED");
  }
  // A package built without the packer (hand-signed) is still refused at verification.
  const { manifest } = await packSpace({ declaration: demoDeclaration(), files: demoFiles(), signer: publisher.signer });
  const secret = encoder.encode(JSON.stringify({ refreshToken: "r" }));
  const assets = [...manifest.assets, { path: "content/secret.json", mediaType: "application/json", size: secret.length, sha256: await sha256Hex(secret) }];
  const leaking: SpacePackageManifest = { ...manifest, assets, integrity: { algorithm: "SHA-256", root: await integrityRoot(assets) } };
  const bytes = await assemble(leaking, publisher.signer, [...demoFiles(), { path: "content/secret.json", bytes: secret }]);
  await rejects(verifySpacePackage(bytes, { publishers: [publisher.trusted], runtime: RUNTIME }), "PRIVATE_DATA_DETECTED");
});

test("owner or authority cloning is refused; an installation inherits no authority", async () => {
  const publisher = await testPublisher();
  await rejects(packSpace({ declaration: { ...demoDeclaration(), owner: "publisher-trust-id" } as never, files: demoFiles(), signer: publisher.signer }), "AUTHORITY_CLONING_REJECTED");
  await rejects(packSpace({ declaration: { ...demoDeclaration(), space: { ...demoDeclaration().space, grants: ["admin"] } } as never, files: demoFiles(), signer: publisher.signer }), "AUTHORITY_CLONING_REJECTED");
  await rejects(packSpace({ declaration: demoDeclaration(), files: [...demoFiles(), { path: "content/acl.json", mediaType: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ authority: { digiAuthority: "grant-123" } })) }], signer: publisher.signer }), "AUTHORITY_CLONING_REJECTED");

  const { bytes } = await packSpace({ declaration: demoDeclaration(), files: demoFiles(), signer: publisher.signer });
  const store = new MemoryInstallationStore();
  const { record } = await importSpacePackage(bytes, { publishers: [publisher.trusted], runtime: RUNTIME, store });
  assert.deepEqual(record.authority, { owner: null, grants: [] });
  const opened = await openSpace(store, record.packageId, { environment: { online: false } });
  assert.equal(opened.definition.owner, `installation:${record.installationId}`, "the Space contract owner is this local installation");
  assert.ok(!JSON.stringify(opened).includes(publisher.signer.privateKeyPkcs8Base64));
});

test("permissions: granted only when declared AND available; remote ones need a route", async () => {
  const { bytes, publishers } = await demo();
  const store = new MemoryInstallationStore();
  await importSpacePackage(bytes, { publishers, runtime: RUNTIME, store });
  const id = "org.digiconomy.demo.lantern";
  const offline = await openSpace(store, id, { environment: { online: false }, requested: ["network.sync", "settlement.request"] });
  assert.equal(offline.experience.state, "READY");
  assert.deepEqual(offline.permissions.granted.sort(), ["content.read", "media.playback"]);
  assert.deepEqual(offline.permissions.denied, [{ permission: "network.sync", reason: "OFFLINE" }, { permission: "settlement.request", reason: "NOT_DECLARED" }]);
  const noRoute = await openSpace(store, id, { environment: { online: true }, requested: ["network.sync"] });
  assert.deepEqual(noRoute.permissions.denied, [{ permission: "network.sync", reason: "NO_VALID_ROUTE" }]);
  const routed = await openSpace(store, id, { environment: { online: true, routes: ["network.sync", "settlement.request"] }, requested: ["network.sync", "settlement.request"] });
  assert.ok(routed.permissions.granted.includes("network.sync"));
  assert.deepEqual(routed.permissions.denied, [{ permission: "settlement.request", reason: "NOT_DECLARED" }], "the runtime offering a capability never grants an undeclared permission");
  const missingCapability = await openSpace(store, id, { environment: { online: false, localCapabilities: ["content.read"] } });
  assert.equal(missingCapability.experience.state, "BLOCKED", "a required capability the runtime lacks blocks the experience");
});

test("offline verification, import and open make no network request", async () => {
  const { bytes, publishers } = await demo();
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => { calls.push(String(input)); throw new Error("offline"); }) as typeof fetch;
  try {
    const store = new MemoryInstallationStore();
    await verifySpacePackage(bytes, { publishers, runtime: RUNTIME });
    await importSpacePackage(bytes, { publishers, runtime: RUNTIME, store });
    const opened = await openSpace(store, "org.digiconomy.demo.lantern", { environment: { online: false } });
    assert.equal(opened.network, "NOT_USED");
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("an installation modified on disk after import is detected on open", async () => {
  const { bytes, publishers } = await demo();
  const store = new MemoryInstallationStore();
  await importSpacePackage(bytes, { publishers, runtime: RUNTIME, store });
  store.installations.get("org.digiconomy.demo.lantern")!.assets.set("content/media/lantern.png", new Uint8Array([1, 2, 3]));
  await rejects(openSpace(store, "org.digiconomy.demo.lantern", { environment: { online: false } }), "INSTALLATION_CORRUPT");
});

test("packages written by other tools with DEFLATE entries verify; content checks still apply", async () => {
  const { manifest, publisher, files, publishers } = await demo();
  const deflated = await assemble(manifest, publisher.signer, files.map((file) => ({ ...file, method: 8 as const })));
  const verified = await verifySpacePackage(deflated, { publishers, runtime: RUNTIME });
  assert.equal(verified.assets.size, 3);
  const inspection = await inspectSpacePackage(deflated);
  assert.ok(inspection.entries.filter((entry) => entry.path.startsWith("content/")).every((entry) => entry.method === "DEFLATE"));
});

test("the frozen Space Launch File V1 verifier refuses a package (the shared .space extension is never trusted)", async () => {
  const { bytes } = await demo();
  const result = await verifySpaceLaunchFile(bytes, { publishers: [], xperienceVersion: "0.3.6" });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "INVALID_FORMAT");
});
