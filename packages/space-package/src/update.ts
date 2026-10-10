import { canonicalJson } from "@digiconomy/xperience-contract";
import { base64ToBytes, bytesToBase64, sha256Hex } from "./crypto.js";
import { PACKAGE_PERMISSIONS, SpacePackageError, type PackagePermission } from "./format.js";
import { findAuthorityField } from "./policy.js";
import { MIGRATION_STEP_KINDS, type MigrationStep } from "./state.js";

/**
 * SP2 signed update document, published beside the target package (`<id>-<version>.update.json`).
 * It binds one release transition of one lineage, signed by the publisher:
 * lineage, previous and target versions and package digests, the monotonic release sequence
 * (anti-downgrade — never semantic versions or clocks alone), compatibility, permissions, the state
 * migration, rollback eligibility and the security floor.
 */
export const UPDATE_FORMAT = "digiconomy.space-update";
export const UPDATE_SIGNING_DOMAIN = "digiconomy.space-update/v1\n";

export interface ReleaseRef {
  version: string;
  /** SP1 package digest (SHA-256 of the signed package manifest bytes). */
  packageDigest: string;
  /** Publisher-assigned, strictly increasing release sequence within the lineage. */
  sequence: number;
}

export interface UpdateDocument {
  format: typeof UPDATE_FORMAT;
  formatVersion: 1;
  lineage: { packageId: string };
  publisher: { publisherId: string; keyId: string };
  from: ReleaseRef;
  to: ReleaseRef;
  compatibility: { spaceContractVersion: number; minimumRuntimeVersion: string };
  /** Must equal the target package's declared permissions. */
  permissions: PackagePermission[];
  state: {
    /** Local-state data version the previous release writes, and the one the target writes. */
    fromDataVersion: number;
    toDataVersion: number;
    migration: MigrationStep[];
    /** True when the previous release can still read the migrated state (additive change). */
    backwardCompatible: boolean;
  };
  rollback: {
    /** Whether returning to `from` after this update is allowed at all. */
    eligible: boolean;
    /** Security floor: no rollback to any release below this sequence once this update is active. */
    minimumSequence: number;
  };
  security: {
    /** Security-sensitive: fail closed unless this device holds revocation evidence at least this new. */
    requiresRevocationSequence: number | null;
    /** Security-sensitive: fail closed unless revocation evidence is CURRENT (obtained recently). */
    requiresCurrentRevocation: boolean;
  };
  issuedAt: string;
  signature: string;
}

const ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const DIGEST = /^[0-9a-f]{64}$/;
type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, keys: readonly string[]): value is Obj => isObj(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value);
const isSeq = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2 ** 31;

function validRelease(value: unknown): value is ReleaseRef {
  return exactKeys(value, ["version", "packageDigest", "sequence"]) && typeof value.version === "string" && SEMVER.test(value.version)
    && typeof value.packageDigest === "string" && DIGEST.test(value.packageDigest) && isSeq(value.sequence);
}

export function validateUpdateDocument(value: unknown): asserts value is UpdateDocument {
  const fail = (detail: string): never => { throw new SpacePackageError("UPDATE_INVALID", detail); };
  if (!isObj(value) || value.format !== UPDATE_FORMAT || value.formatVersion !== 1) fail("format");
  const authority = findAuthorityField(value);
  if (authority) throw new SpacePackageError("AUTHORITY_CLONING_REJECTED", authority);
  const doc = value as Obj;
  if (!exactKeys(doc, ["format", "formatVersion", "lineage", "publisher", "from", "to", "compatibility", "permissions", "state", "rollback", "security", "issuedAt", "signature"])) fail("fields");
  if (!exactKeys(doc.lineage, ["packageId"]) || !ID.test(String((doc.lineage as Obj).packageId))) fail("lineage");
  if (!exactKeys(doc.publisher, ["publisherId", "keyId"]) || !ID.test(String((doc.publisher as Obj).publisherId)) || !ID.test(String((doc.publisher as Obj).keyId))) fail("publisher");
  if (!validRelease(doc.from) || !validRelease(doc.to)) fail("from/to release");
  if (!exactKeys(doc.compatibility, ["spaceContractVersion", "minimumRuntimeVersion"]) || !Number.isInteger((doc.compatibility as Obj).spaceContractVersion) || !SEMVER.test(String((doc.compatibility as Obj).minimumRuntimeVersion))) fail("compatibility");
  const permissions = doc.permissions;
  if (!Array.isArray(permissions) || !permissions.every((item) => typeof item === "string" && item in PACKAGE_PERMISSIONS) || new Set(permissions).size !== permissions.length) fail("permissions");
  const state = doc.state as Obj;
  if (!exactKeys(state, ["fromDataVersion", "toDataVersion", "migration", "backwardCompatible"]) || !isSeq(state.fromDataVersion) || !isSeq(state.toDataVersion)
    || (state.toDataVersion as number) < (state.fromDataVersion as number) || typeof state.backwardCompatible !== "boolean" || !Array.isArray(state.migration) || state.migration.length > 64) fail("state");
  for (const step of state.migration as unknown[]) if (!isObj(step) || !(MIGRATION_STEP_KINDS as readonly string[]).includes(String(step.op))) fail("migration step");
  if (!exactKeys(doc.rollback, ["eligible", "minimumSequence"]) || typeof (doc.rollback as Obj).eligible !== "boolean" || !isSeq((doc.rollback as Obj).minimumSequence)) fail("rollback");
  const security = doc.security as Obj;
  if (!exactKeys(security, ["requiresRevocationSequence", "requiresCurrentRevocation"]) || (security.requiresRevocationSequence !== null && !isSeq(security.requiresRevocationSequence)) || typeof security.requiresCurrentRevocation !== "boolean") fail("security");
  if (typeof doc.issuedAt !== "string" || Number.isNaN(Date.parse(doc.issuedAt))) fail("issuedAt");
  if (typeof doc.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(doc.signature)) fail("signature");
  // Sequences and versions must both move forward; rollback floor cannot exceed the target itself.
  const from = doc.from as ReleaseRef;
  const to = doc.to as ReleaseRef;
  if (to.sequence <= from.sequence) throw new SpacePackageError("DOWNGRADE_REJECTED", `sequence ${to.sequence} ≤ ${from.sequence}`);
  if (to.packageDigest === from.packageDigest) fail("target equals source");
  if ((doc.rollback as Obj).minimumSequence as number > to.sequence) fail("security floor above target");
}

function updateBytes(doc: Omit<UpdateDocument, "signature">): Uint8Array {
  const { signature: _signature, ...body } = doc as UpdateDocument;
  return new TextEncoder().encode(UPDATE_SIGNING_DOMAIN + canonicalJson(body));
}

/** Publisher-side. The private key stays in memory and is never written anywhere. */
export async function signUpdateDocument(doc: Omit<UpdateDocument, "signature" | "format" | "formatVersion">, privateKeyPkcs8Base64: string): Promise<UpdateDocument> {
  const body = { ...doc, format: UPDATE_FORMAT as typeof UPDATE_FORMAT, formatVersion: 1 as const };
  const key = await crypto.subtle.importKey("pkcs8", base64ToBytes(privateKeyPkcs8Base64) as BufferSource, "Ed25519" as AlgorithmIdentifier, false, ["sign"]);
  const signature = bytesToBase64(new Uint8Array(await crypto.subtle.sign("Ed25519" as AlgorithmIdentifier, key, updateBytes(body) as BufferSource)));
  const signed = { ...body, signature };
  validateUpdateDocument(signed);
  return signed;
}

export async function verifyUpdateSignature(doc: UpdateDocument, publicKeySpkiBase64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", base64ToBytes(publicKeySpkiBase64) as BufferSource, "Ed25519" as AlgorithmIdentifier, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519" as AlgorithmIdentifier, key, base64ToBytes(doc.signature) as BufferSource, updateBytes(doc) as BufferSource);
  } catch {
    return false;
  }
}

export function parseUpdateDocument(bytes: Uint8Array): UpdateDocument {
  if (bytes.length > 256 * 1024) throw new SpacePackageError("UPDATE_INVALID", "too large");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SpacePackageError("UPDATE_INVALID", "not JSON");
  }
  validateUpdateDocument(value);
  return value;
}

export function serializeUpdateDocument(doc: UpdateDocument): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`);
}

export async function updateDocumentDigest(doc: UpdateDocument): Promise<string> {
  return sha256Hex(updateBytes(doc));
}
