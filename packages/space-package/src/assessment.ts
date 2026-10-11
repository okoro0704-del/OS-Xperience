import { integrityRoot, sha256Hex, signedBytes, verifyManifestSignature } from "./crypto.js";
import { LIMITS, PACKAGE_PERMISSIONS, SPACE_CONTRACT_VERSION, SpacePackageError, type PackageErrorCode, type SpacePackageManifest } from "./format.js";
import { compareVersions, inspectSpacePackage, verifySpacePackage } from "./package.js";
import { readZip } from "./zip.js";
import { keyState, publishersFor, revocationFreshness, type KeyState, type RevocationFreshness, type TrustStore } from "./trust.js";

/**
 * SP3 package assessment for the installer: each concern reported separately, so a person sees
 * exactly what was proven. Eligibility is decided only by the frozen SP1 verifier
 * (verifySpacePackage with SP2 NEW_RELEASE trust) — the per-check view never relaxes it.
 */
export type CheckStatus = "PASS" | "FAIL" | "WARN" | "NOT_EVALUATED";

export interface Check {
  status: CheckStatus;
  summary: string;
  code?: PackageErrorCode;
}

export interface PackageAssessment {
  manifest: SpacePackageManifest | null;
  packageDigest: string | null;
  checks: {
    structure: Check;
    integrity: Check;
    signature: Check;
    publisher: Check & { keyState?: KeyState | "UNKNOWN" };
    revocation: Check & { freshness?: RevocationFreshness; sequence?: number | null; receivedAt?: string | null };
    permissions: Check & { requested?: Array<{ permission: string; scope: "LOCAL" | "REMOTE" }> };
    compatibility: Check;
    eligibility: Check;
  };
  eligible: boolean;
}

const notEvaluated = (summary = "Not evaluated: an earlier check failed."): Check => ({ status: "NOT_EVALUATED", summary });

export async function assessPackage(bytes: Uint8Array, options: {
  trust: TrustStore;
  runtime: { version: string; spaceContractVersions?: readonly number[] };
  installed: ReadonlyArray<{ packageId: string; version: string; packageDigest: string }>;
  now: Date;
  revocationMaxAgeMs?: number;
}): Promise<PackageAssessment> {
  const checks: PackageAssessment["checks"] = {
    structure: notEvaluated(), integrity: notEvaluated(), signature: notEvaluated(), publisher: notEvaluated(),
    revocation: notEvaluated(), permissions: notEvaluated(), compatibility: notEvaluated(), eligibility: notEvaluated(),
  };
  // 1. Structure: container, manifest schema, signature document (no trust involved).
  let manifest: SpacePackageManifest;
  let signatureValue: string;
  try {
    const inspection = await inspectSpacePackage(bytes);
    manifest = inspection.manifest;
    signatureValue = inspection.signature.value;
    checks.structure = { status: "PASS", summary: "A well-formed Space package; its manifest follows the V1 schema." };
  } catch (error) {
    const code = error instanceof SpacePackageError ? error.code : "MALFORMED_ARCHIVE";
    checks.structure = { status: "FAIL", summary: `Not a valid Space package (${code}).`, code };
    checks.eligibility = { status: "FAIL", summary: "Cannot be installed.", code };
    return { manifest: null, packageDigest: null, checks, eligible: false };
  }
  const packageDigest = await sha256Hex(signedBytes(manifest));

  // 2. Integrity: every declared asset present with its declared size and SHA-256, and the root matches.
  try {
    const archive = readZip(bytes, LIMITS);
    const byPath = new Map(archive.entries.map((entry) => [entry.path, entry]));
    for (const asset of manifest.assets) {
      const entry = byPath.get(asset.path);
      if (!entry) throw new SpacePackageError("ASSET_MISSING", asset.path);
      const data = await archive.read(entry);
      if (data.length !== asset.size || (await sha256Hex(data)) !== asset.sha256) throw new SpacePackageError("ASSET_MODIFIED", asset.path);
    }
    for (const entry of archive.entries) if (entry.path.startsWith("content/") && !manifest.assets.some((asset) => asset.path === entry.path)) throw new SpacePackageError("UNDECLARED_ENTRY", entry.path);
    if ((await integrityRoot(manifest.assets)) !== manifest.integrity.root) throw new SpacePackageError("INTEGRITY_ROOT_MISMATCH");
    checks.integrity = { status: "PASS", summary: `All ${manifest.assets.length} assets match their declared hashes and the integrity root.` };
  } catch (error) {
    const code = error instanceof SpacePackageError ? (error.code === "CRC_MISMATCH" ? "ASSET_MODIFIED" : error.code) : "MALFORMED_ARCHIVE";
    checks.integrity = { status: "FAIL", summary: `The contents were altered or are incomplete (${code}${error instanceof SpacePackageError && error.detail ? `: ${error.detail}` : ""}).`, code };
  }

  // 3. Publisher trust: pinned keys only. 4. Signature: checked against that key when there is one.
  const { publisherId, keyId } = manifest.publisher;
  const state = keyState(options.trust, publisherId, keyId);
  const publisher = options.trust.publishers.find((item) => item.publisherId === publisherId);
  const namespaced = Boolean(publisher?.packagePrefixes.some((prefix) => manifest.package.id.startsWith(prefix)));
  if (state === "UNKNOWN") {
    checks.publisher = { status: "FAIL", keyState: state, code: "PUBLISHER_UNKNOWN", summary: `“${publisherId}” (key ${keyId}) is not a publisher this device trusts. Unknown publishers are never trusted automatically.` };
    checks.signature = { status: "NOT_EVALUATED", summary: "Cannot be checked: this device holds no trusted key for this publisher." };
  } else {
    const key = publisher!.keys.find((item) => item.keyId === keyId);
    const valid = state !== "REVOKED" && key ? await verifyManifestSignature(manifest, signatureValue, key.publicKeySpkiBase64) : false;
    checks.signature = state === "REVOKED"
      ? { status: "FAIL", code: "KEY_REVOKED", summary: `Signed with key ${keyId}, which has been revoked. Revoked keys verify nothing.` }
      : valid
        ? { status: "PASS", summary: `The publisher signature is valid against the locally trusted key ${keyId}.` }
        : { status: "FAIL", code: "SIGNATURE_INVALID", summary: "The signature does not match the publisher's trusted key." };
    checks.publisher = state === "REVOKED"
      ? { status: "FAIL", keyState: state, code: "KEY_REVOKED", summary: `${publisher!.name}: key ${keyId} is revoked.` }
      : state === "RETIRED"
        ? { status: "FAIL", keyState: state, code: "KEY_NOT_AUTHORIZED", summary: `${publisher!.name}: key ${keyId} is retired and may not authorize new installations.` }
        : !namespaced
          ? { status: "FAIL", keyState: state, code: "PUBLISHER_NOT_AUTHORIZED", summary: `${publisher!.name} may not publish “${manifest.package.id}”.` }
          : { status: "PASS", keyState: state, summary: `${publisher!.name} — trusted on this device (key ${keyId}, ${state}).` };
  }

  // 5. Revocation: reported honestly; never inferred from a valid signature.
  const freshness = revocationFreshness(options.trust, publisherId, options.now, options.revocationMaxAgeMs ?? 7 * 24 * 3600 * 1000);
  checks.revocation = {
    status: freshness.status === "CURRENT" ? "PASS" : "WARN",
    freshness: freshness.status, sequence: freshness.sequence, receivedAt: freshness.receivedAt,
    summary: freshness.status === "CURRENT" ? `Revocation list ${freshness.sequence} obtained ${freshness.receivedAt}.`
      : freshness.status === "STALE" ? `Revocation information is out of date (list ${freshness.sequence}, obtained ${freshness.receivedAt}). Keys revoked since then are unknown here.`
        : "This device has no revocation information for this publisher. Revocations made elsewhere are not known here.",
  };

  // 6. Permissions requested.
  const requested = manifest.permissions.map((permission) => ({ permission, scope: PACKAGE_PERMISSIONS[permission].scope }));
  checks.permissions = { status: "PASS", requested, summary: requested.length ? `Requests ${requested.map((item) => item.permission).join(", ")}.` : "Requests no permissions." };

  // 7. Compatibility with this runtime.
  const contracts = options.runtime.spaceContractVersions ?? [SPACE_CONTRACT_VERSION];
  const compatible = contracts.includes(manifest.runtime.spaceContractVersion) && compareVersions(options.runtime.version, manifest.runtime.minimumRuntimeVersion) >= 0;
  checks.compatibility = compatible
    ? { status: "PASS", summary: `Runs on this Space Runtime (${options.runtime.version}).` }
    : { status: "FAIL", code: "INCOMPATIBLE_RUNTIME", summary: `Needs Space Runtime ${manifest.runtime.minimumRuntimeVersion} (contract ${manifest.runtime.spaceContractVersion}); this device has ${options.runtime.version}.` };

  // 8. Eligibility: decided by the frozen SP1 verifier with SP2 trust — nothing above can relax it.
  try {
    await verifySpacePackage(bytes, { publishers: publishersFor(options.trust, "NEW_RELEASE"), runtime: options.runtime, installed: options.installed });
    const existing = options.installed.find((item) => item.packageId === manifest.package.id);
    checks.eligibility = !existing
      ? { status: "PASS", summary: "Can be installed as a new, separate installation. It carries no owner or authority." }
      : existing.packageDigest === packageDigest
        ? { status: "WARN", code: "ALREADY_INSTALLED", summary: "This exact package is already installed." }
        : { status: "FAIL", code: "INSTALLED_VERSION_CONFLICT", summary: `${manifest.package.name} ${existing.version} is installed; a different release arrives as a signed update.` };
  } catch (error) {
    const code = error instanceof SpacePackageError ? error.code : "MALFORMED_ARCHIVE";
    checks.eligibility = { status: "FAIL", code, summary: `Cannot be installed (${code}${error instanceof SpacePackageError && error.detail ? `: ${error.detail}` : ""}).` };
  }
  return { manifest, packageDigest, checks, eligible: checks.eligibility.status === "PASS" };
}
