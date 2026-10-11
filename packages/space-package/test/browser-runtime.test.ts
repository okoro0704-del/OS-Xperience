import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { LIMITS, SpacePackageError, applyRevocationList, assessPackage, detectPlatformSupport, detectSpaceFormat, signStatement, trustStoreFromPublishers, type RevocationList } from "../src/index.js";
import { assemble } from "./helpers.js";
import { LANTERN, newKey, pack, releaseSource, signerFor } from "./lifecycle-helpers.js";
import { inspectSpacePackage } from "../src/index.js";

/** SP3: the pure parts of the browser runtime — content-based format detection and the assessment. */
const encoder = new TextEncoder();
const LAUNCH_FILE = new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../../apps/os-experience/public/spaces/mrfundzman.space")));
const ZIP_END = (() => { const end = new Uint8Array(22); end.set([0x50, 0x4b, 0x05, 0x06]); return end; })();
const code = (fn: () => unknown) => { try { fn(); return "OK"; } catch (error) { assert.ok(error instanceof SpacePackageError); return error.code; } };

async function lantern() {
  const key = await newKey("demo-key-1");
  const source = releaseSource("v1");
  const v1 = await pack(source.declaration, source.files, signerFor("digiconomy.demo", key), 1);
  const trust = trustStoreFromPublishers([{ publisherId: "digiconomy.demo", name: "Demo", keys: [{ keyId: key.keyId, publicKeySpkiBase64: key.publicKeySpkiBase64 }], packagePrefixes: ["org.digiconomy.demo."] }]);
  return { key, source, v1, trust };
}

test("detectSpaceFormat follows content, never names; polyglots and unknown bytes are refused", async () => {
  const { v1 } = await lantern();
  assert.equal(detectSpaceFormat(v1.bytes), "PACKAGE");
  assert.equal(detectSpaceFormat(LAUNCH_FILE), "LAUNCH_FILE");
  assert.equal(detectSpaceFormat(new Uint8Array([0xef, 0xbb, 0xbf, 0x0a, 0x20, ...LAUNCH_FILE])), "LAUNCH_FILE", "BOM and leading whitespace");
  assert.equal(code(() => detectSpaceFormat(new Uint8Array([...LAUNCH_FILE, ...ZIP_END]))), "AMBIGUOUS_FORMAT", "JSON + ZIP directory");
  assert.equal(code(() => detectSpaceFormat(new Uint8Array([...encoder.encode("junk"), ...v1.bytes]))), "AMBIGUOUS_FORMAT", "ZIP with prepended data");
  assert.equal(code(() => detectSpaceFormat(encoder.encode(`{"pad":"${"x".repeat(17_000)}"}`))), "UNSUPPORTED_FORMAT", "JSON over the launch-file limit");
  assert.equal(code(() => detectSpaceFormat(new Uint8Array(0))), "UNSUPPORTED_FORMAT");
  assert.equal(code(() => detectSpaceFormat(encoder.encode("hello"))), "UNSUPPORTED_FORMAT");
  assert.equal(code(() => detectSpaceFormat(new Uint8Array(LIMITS.maxArchiveBytes + 1))), "ARCHIVE_TOO_LARGE");
});

test("assessPackage reports each check separately and decides eligibility only by full verification", async () => {
  const { key, source, v1, trust } = await lantern();
  const now = new Date("2026-10-10T09:00:00.000Z");
  const runtime = { version: "1.0.0" };

  const good = await assessPackage(v1.bytes, { trust, runtime, installed: [], now });
  assert.equal(good.eligible, true);
  assert.deepEqual(Object.fromEntries(Object.entries(good.checks).map(([name, value]) => [name, value.status])), {
    structure: "PASS", integrity: "PASS", signature: "PASS", publisher: "PASS", revocation: "WARN", permissions: "PASS", compatibility: "PASS", eligibility: "PASS",
  });

  // Revocation evidence just received: CURRENT.
  const list = await signStatement<RevocationList>({ format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: "digiconomy.demo", sequence: 1, issuedAt: now.toISOString(), revokedKeyIds: [], authorizedBy: { keyId: key.keyId } }, key);
  const withEvidence = await applyRevocationList(trust, list, now);
  assert.equal((await assessPackage(v1.bytes, { trust: withEvidence, runtime, installed: [], now })).checks.revocation.status, "PASS");

  // Unknown publisher: never trusted, signature not evaluated.
  const empty = trustStoreFromPublishers([]);
  const unknown = await assessPackage(v1.bytes, { trust: empty, runtime, installed: [], now });
  assert.equal(unknown.eligible, false);
  assert.equal(unknown.checks.publisher.code, "PUBLISHER_UNKNOWN");
  assert.equal(unknown.checks.signature.status, "NOT_EVALUATED");

  // Tampered asset: integrity fails, not eligible.
  const inspection = await inspectSpacePackage(v1.bytes);
  const tampered = await assemble(inspection.manifest, signerFor("digiconomy.demo", key), source.files.map((file, index) => (index === 0 ? { path: file.path, bytes: new Uint8Array([...file.bytes, 1]) } : file)));
  const broken = await assessPackage(tampered, { trust, runtime, installed: [], now });
  assert.equal(broken.checks.integrity.status, "FAIL");
  assert.equal(broken.eligible, false);

  // Revoked signing key.
  const k2 = await newKey("demo-key-2");
  const both = trustStoreFromPublishers([{ publisherId: "digiconomy.demo", name: "Demo", keys: [{ keyId: key.keyId, publicKeySpkiBase64: key.publicKeySpkiBase64 }, { keyId: k2.keyId, publicKeySpkiBase64: k2.publicKeySpkiBase64 }], packagePrefixes: ["org.digiconomy.demo."] }]);
  const revoke = await signStatement<RevocationList>({ format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: "digiconomy.demo", sequence: 1, issuedAt: now.toISOString(), revokedKeyIds: [key.keyId], authorizedBy: { keyId: k2.keyId } }, k2);
  const revoked = await assessPackage(v1.bytes, { trust: await applyRevocationList(both, revoke, now), runtime, installed: [], now });
  assert.equal(revoked.checks.signature.code, "KEY_REVOKED");
  assert.equal(revoked.eligible, false);

  // Incompatible runtime.
  const old = await assessPackage(v1.bytes, { trust, runtime: { version: "0.9.0" }, installed: [], now });
  assert.equal(old.checks.compatibility.status, "FAIL");
  assert.equal(old.eligible, false);

  // Already installed: same digest is a warning; a different release must arrive as a signed update.
  const same = await assessPackage(v1.bytes, { trust, runtime, installed: [{ packageId: LANTERN, version: "1.0.0", packageDigest: v1.packageDigest }], now });
  assert.equal(same.checks.eligibility.code, "ALREADY_INSTALLED");
  const other = await assessPackage(v1.bytes, { trust, runtime, installed: [{ packageId: LANTERN, version: "0.5.0", packageDigest: "0".repeat(64) }], now });
  assert.equal(other.checks.eligibility.code, "INSTALLED_VERSION_CONFLICT");
  assert.equal(other.eligible, false);
});

test("detectPlatformSupport proves Ed25519 with RFC 8032 and requires Web Locks to install", async () => {
  const support = await detectPlatformSupport();
  assert.equal(support.ed25519, true);
  assert.equal(support.sha256, true);
  // Node has no IndexedDB: verification is possible, installation is not.
  assert.equal(support.canVerify, true);
  assert.equal(support.indexedDb, false);
  assert.equal(support.canInstall, false);
  assert.ok(support.missing.length > 0);
});
