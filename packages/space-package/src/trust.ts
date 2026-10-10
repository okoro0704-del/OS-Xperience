import { canonicalJson } from "@digiconomy/xperience-contract";
import { base64ToBytes, bytesToBase64 } from "./crypto.js";
import { SpacePackageError, type TrustedPackagePublisher } from "./format.js";
import { findAuthorityField } from "./policy.js";

/**
 * SP2 publisher trust: a persisted, versioned trust store with a key lifecycle.
 *
 *   ACTIVE ──rotate──▶ ROTATING ──complete──▶ RETIRED        REVOKED (terminal, from any state)
 *
 * ACTIVE    signs new releases, updates, rotations, revocations.
 * ROTATING  still accepted for new releases during the rotation window; cannot authorize rotations.
 * RETIRED   verifies releases it already signed (installed or previous); authorizes nothing new.
 * REVOKED   authorizes and verifies nothing; can never be restored (not by rotation, rollback or re-import).
 *
 * Adding trust (a new key, a publisher transition) always needs a signature from an already trusted
 * ACTIVE key of that publisher, or from a separately established authority. Removing trust (retiring)
 * is always safe and needs none. An unknown key never becomes trusted on its own.
 */
export const TRUST_STORE_SCHEMA = "digiconomy.space-trust/v1";
export const TRUST_POLICY_VERSION = 1;

export type KeyState = "ACTIVE" | "ROTATING" | "RETIRED" | "REVOKED";

export interface TrustedKey {
  keyId: string;
  publicKeySpkiBase64: string;
  state: KeyState;
  /** Publisher trust sequence at which the key reached its current state. */
  stateSequence: number;
}

export interface RevocationEvidence {
  /** Monotonic, publisher-signed revocation list sequence — clock-independent freshness. */
  sequence: number;
  /** As stated by the signer (informational: device clocks are not trusted for security). */
  issuedAt: string;
  /** Local time this device obtained the list. */
  receivedAt: string;
}

export interface TrustedPublisherRecord {
  publisherId: string;
  name: string;
  packagePrefixes: string[];
  /** Highest applied rotation/transition sequence for this publisher. */
  trustSequence: number;
  keys: TrustedKey[];
  /** Key ids revoked by a list, including ones this device never trusted (they can never be added). */
  revokedKeyIds: string[];
  revocation: RevocationEvidence | null;
}

export interface TrustAuthority {
  authorityId: string;
  keys: Array<{ keyId: string; publicKeySpkiBase64: string }>;
}

export interface PublisherTransition {
  packageId: string;
  fromPublisherId: string;
  toPublisherId: string;
  sequence: number;
}

export interface TrustStore {
  schema: typeof TRUST_STORE_SCHEMA;
  policyVersion: number;
  publishers: TrustedPublisherRecord[];
  authorities: TrustAuthority[];
  transitions: PublisherTransition[];
}

export function trustStoreFromPublishers(publishers: readonly TrustedPackagePublisher[], authorities: readonly TrustAuthority[] = []): TrustStore {
  return {
    schema: TRUST_STORE_SCHEMA,
    policyVersion: TRUST_POLICY_VERSION,
    publishers: publishers.map((publisher) => ({
      publisherId: publisher.publisherId,
      name: publisher.name,
      packagePrefixes: [...publisher.packagePrefixes],
      trustSequence: 0,
      keys: publisher.keys.map((key) => ({ keyId: key.keyId, publicKeySpkiBase64: key.publicKeySpkiBase64, state: "ACTIVE" as const, stateSequence: 0 })),
      revokedKeyIds: [],
      revocation: null,
    })),
    authorities: authorities.map((authority) => ({ authorityId: authority.authorityId, keys: authority.keys.map((key) => ({ ...key })) })),
    transitions: [],
  };
}

export function parseTrustStore(value: unknown): TrustStore {
  const store = value as TrustStore;
  if (!store || store.schema !== TRUST_STORE_SCHEMA || !Array.isArray(store.publishers) || !Array.isArray(store.authorities) || !Array.isArray(store.transitions)) {
    throw new SpacePackageError("UPDATE_INVALID", "trust store");
  }
  return structuredClone(store);
}

/** What may verify signatures for a purpose. Revoked keys never appear; retired ones only for installed releases. */
export type TrustPurpose = "NEW_RELEASE" | "INSTALLED_RELEASE";

export function publishersFor(trust: TrustStore, purpose: TrustPurpose): TrustedPackagePublisher[] {
  const allowed: KeyState[] = purpose === "NEW_RELEASE" ? ["ACTIVE", "ROTATING"] : ["ACTIVE", "ROTATING", "RETIRED"];
  return trust.publishers.map((publisher) => ({
    publisherId: publisher.publisherId,
    name: publisher.name,
    packagePrefixes: publisher.packagePrefixes,
    keys: publisher.keys.filter((key) => allowed.includes(key.state) && !publisher.revokedKeyIds.includes(key.keyId)).map(({ keyId, publicKeySpkiBase64 }) => ({ keyId, publicKeySpkiBase64 })),
  }));
}

export function keyState(trust: TrustStore, publisherId: string, keyId: string): KeyState | "UNKNOWN" {
  const publisher = trust.publishers.find((item) => item.publisherId === publisherId);
  if (!publisher) return "UNKNOWN";
  if (publisher.revokedKeyIds.includes(keyId)) return "REVOKED";
  return publisher.keys.find((key) => key.keyId === keyId)?.state ?? "UNKNOWN";
}

export type RevocationFreshness = "CURRENT" | "STALE" | "UNKNOWN";

/**
 * Honest offline status. CURRENT only when this device actually obtained a revocation list within
 * maxAgeMs; otherwise STALE (old evidence) or UNKNOWN (none). Never inferred from a valid signature.
 */
export function revocationFreshness(trust: TrustStore, publisherId: string, now: Date, maxAgeMs: number): { status: RevocationFreshness; sequence: number | null; receivedAt: string | null } {
  const evidence = trust.publishers.find((item) => item.publisherId === publisherId)?.revocation ?? null;
  if (!evidence) return { status: "UNKNOWN", sequence: null, receivedAt: null };
  const age = now.getTime() - Date.parse(evidence.receivedAt);
  return { status: age >= 0 && age <= maxAgeMs ? "CURRENT" : "STALE", sequence: evidence.sequence, receivedAt: evidence.receivedAt };
}

/* ───────────── signed statements ───────────── */

type Authorizer = { keyId: string } | { authorityId: string; keyId: string };

export interface KeyRotationStatement {
  format: "digiconomy.space-key-rotation";
  formatVersion: 1;
  publisherId: string;
  sequence: number;
  retiringKeyId: string;
  newKey: { keyId: string; publicKeySpkiBase64: string };
  authorizedBy: Authorizer;
  signature: string;
}

export interface RevocationList {
  format: "digiconomy.space-key-revocations";
  formatVersion: 1;
  publisherId: string;
  sequence: number;
  issuedAt: string;
  revokedKeyIds: string[];
  authorizedBy: Authorizer;
  signature: string;
}

export interface PublisherTransitionStatement {
  format: "digiconomy.space-publisher-transition";
  formatVersion: 1;
  packageId: string;
  fromPublisherId: string;
  toPublisherId: string;
  sequence: number;
  authorizedBy: Authorizer;
  signature: string;
}

const DOMAINS = {
  "digiconomy.space-key-rotation": "digiconomy.space-key-rotation/v1\n",
  "digiconomy.space-key-revocations": "digiconomy.space-key-revocations/v1\n",
  "digiconomy.space-publisher-transition": "digiconomy.space-publisher-transition/v1\n",
} as const;

type Statement = KeyRotationStatement | RevocationList | PublisherTransitionStatement;

function statementBytes(statement: Omit<Statement, "signature">): Uint8Array {
  const { signature: _signature, ...body } = statement as Statement;
  return new TextEncoder().encode(DOMAINS[statement.format] + canonicalJson(body));
}

export interface StatementSigner {
  /** The authorizing key, as named in `authorizedBy`. */
  privateKeyPkcs8Base64: string;
}

/** Publisher-side: sign a statement. The private key is used in memory only and never serialized. */
export async function signStatement<T extends Statement>(statement: Omit<T, "signature">, signer: StatementSigner): Promise<T> {
  const key = await crypto.subtle.importKey("pkcs8", base64ToBytes(signer.privateKeyPkcs8Base64) as BufferSource, "Ed25519" as AlgorithmIdentifier, false, ["sign"]);
  const value = bytesToBase64(new Uint8Array(await crypto.subtle.sign("Ed25519" as AlgorithmIdentifier, key, statementBytes(statement) as BufferSource)));
  return { ...statement, signature: value } as T;
}

async function verifyStatement(statement: Statement, publicKeySpkiBase64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", base64ToBytes(publicKeySpkiBase64) as BufferSource, "Ed25519" as AlgorithmIdentifier, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519" as AlgorithmIdentifier, key, base64ToBytes(statement.signature) as BufferSource, statementBytes(statement) as BufferSource);
  } catch {
    return false;
  }
}

const ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

/** Resolves who signed a statement and checks they may authorize it. Unknown, retired or revoked authorizers are refused. */
async function authorize(trust: TrustStore, publisher: TrustedPublisherRecord, statement: Statement, allowed: readonly KeyState[], code: "ROTATION_UNAUTHORIZED" | "KEY_NOT_AUTHORIZED"): Promise<void> {
  const by = statement.authorizedBy;
  if (findAuthorityField({ ...statement, authorizedBy: undefined })) throw new SpacePackageError("AUTHORITY_CLONING_REJECTED", statement.format);
  let publicKey: string | undefined;
  if ("authorityId" in by) {
    publicKey = trust.authorities.find((item) => item.authorityId === by.authorityId)?.keys.find((key) => key.keyId === by.keyId)?.publicKeySpkiBase64;
  } else {
    const key = publisher.keys.find((item) => item.keyId === by.keyId);
    if (key && !publisher.revokedKeyIds.includes(key.keyId) && allowed.includes(key.state)) publicKey = key.publicKeySpkiBase64;
  }
  if (!publicKey) throw new SpacePackageError(code, `${statement.format} authorized by an untrusted, retired or revoked key`);
  if (!(await verifyStatement(statement, publicKey))) throw new SpacePackageError(code, `${statement.format} signature`);
}

function publisherOf(trust: TrustStore, publisherId: string): TrustedPublisherRecord {
  const publisher = trust.publishers.find((item) => item.publisherId === publisherId);
  if (!publisher) throw new SpacePackageError("PUBLISHER_UNKNOWN", publisherId);
  return publisher;
}

/** keys rotate: adds a new key (ACTIVE) and moves the retiring one to ROTATING. Returns a new trust store. */
export async function applyKeyRotation(current: TrustStore, statement: KeyRotationStatement): Promise<TrustStore> {
  if (statement?.format !== "digiconomy.space-key-rotation" || statement.formatVersion !== 1 || !ID.test(statement.newKey?.keyId ?? "") || typeof statement.newKey.publicKeySpkiBase64 !== "string") {
    throw new SpacePackageError("ROTATION_UNAUTHORIZED", "malformed rotation statement");
  }
  const trust = structuredClone(current);
  const publisher = publisherOf(trust, statement.publisherId);
  // Only ACTIVE keys (or an authority) may introduce a successor; ROTATING keys cannot chain further rotations.
  await authorize(trust, publisher, statement, ["ACTIVE"], "ROTATION_UNAUTHORIZED");
  if (!Number.isInteger(statement.sequence) || statement.sequence <= publisher.trustSequence) throw new SpacePackageError("ROTATION_UNAUTHORIZED", "stale or replayed rotation sequence");
  if (publisher.revokedKeyIds.includes(statement.newKey.keyId)) throw new SpacePackageError("KEY_REVOKED", statement.newKey.keyId);
  if (publisher.keys.some((key) => key.keyId === statement.newKey.keyId)) throw new SpacePackageError("ROTATION_UNAUTHORIZED", "key id already known");
  const retiring = publisher.keys.find((key) => key.keyId === statement.retiringKeyId);
  if (!retiring || retiring.state !== "ACTIVE") throw new SpacePackageError("ROTATION_UNAUTHORIZED", "retiring key is not ACTIVE");
  retiring.state = "ROTATING";
  retiring.stateSequence = statement.sequence;
  publisher.keys.push({ keyId: statement.newKey.keyId, publicKeySpkiBase64: statement.newKey.publicKeySpkiBase64, state: "ACTIVE", stateSequence: statement.sequence });
  publisher.trustSequence = statement.sequence;
  return trust;
}

/** keys rotate --complete: ROTATING → RETIRED. Removing trust needs no signature. */
export function completeKeyRotation(current: TrustStore, publisherId: string): TrustStore {
  const trust = structuredClone(current);
  const publisher = publisherOf(trust, publisherId);
  for (const key of publisher.keys) if (key.state === "ROTATING") { key.state = "RETIRED"; key.stateSequence = publisher.trustSequence; }
  return trust;
}

/** keys revoke: applies a signed, strictly newer revocation list. Revocation is terminal. */
export async function applyRevocationList(current: TrustStore, list: RevocationList, receivedAt: Date): Promise<TrustStore> {
  if (list?.format !== "digiconomy.space-key-revocations" || list.formatVersion !== 1 || !Array.isArray(list.revokedKeyIds) || !Number.isInteger(list.sequence)) {
    throw new SpacePackageError("KEY_NOT_AUTHORIZED", "malformed revocation list");
  }
  const trust = structuredClone(current);
  const publisher = publisherOf(trust, list.publisherId);
  await authorize(trust, publisher, list, ["ACTIVE", "ROTATING"], "KEY_NOT_AUTHORIZED");
  if (publisher.revocation && list.sequence <= publisher.revocation.sequence) throw new SpacePackageError("REVOCATION_REPLAY", `sequence ${list.sequence} ≤ ${publisher.revocation.sequence}`);
  for (const keyId of list.revokedKeyIds) {
    if (!publisher.revokedKeyIds.includes(keyId)) publisher.revokedKeyIds.push(keyId);
    const key = publisher.keys.find((item) => item.keyId === keyId);
    if (key) { key.state = "REVOKED"; key.stateSequence = list.sequence; }
  }
  publisher.revocation = { sequence: list.sequence, issuedAt: list.issuedAt, receivedAt: receivedAt.toISOString() };
  return trust;
}

/** An explicit, signed handover of a package lineage to another trusted publisher. */
export async function applyPublisherTransition(current: TrustStore, statement: PublisherTransitionStatement): Promise<TrustStore> {
  if (statement?.format !== "digiconomy.space-publisher-transition" || statement.formatVersion !== 1) throw new SpacePackageError("KEY_NOT_AUTHORIZED", "malformed transition");
  const trust = structuredClone(current);
  const from = publisherOf(trust, statement.fromPublisherId);
  publisherOf(trust, statement.toPublisherId); // the new publisher must itself be trusted already
  await authorize(trust, from, statement, ["ACTIVE"], "KEY_NOT_AUTHORIZED");
  if (!Number.isInteger(statement.sequence) || statement.sequence <= from.trustSequence) throw new SpacePackageError("KEY_NOT_AUTHORIZED", "stale transition sequence");
  from.trustSequence = statement.sequence;
  trust.transitions.push({ packageId: statement.packageId, fromPublisherId: statement.fromPublisherId, toPublisherId: statement.toPublisherId, sequence: statement.sequence });
  return trust;
}

export function transitionAllowed(trust: TrustStore, packageId: string, fromPublisherId: string, toPublisherId: string): boolean {
  return fromPublisherId === toPublisherId || trust.transitions.some((item) => item.packageId === packageId && item.fromPublisherId === fromPublisherId && item.toPublisherId === toPublisherId);
}

/** keys inspect: never includes private material (the trust store holds public keys only). */
export function describeTrust(trust: TrustStore, now: Date, maxAgeMs: number) {
  return {
    schema: trust.schema,
    policyVersion: trust.policyVersion,
    publishers: trust.publishers.map((publisher) => ({
      publisherId: publisher.publisherId,
      trustSequence: publisher.trustSequence,
      keys: publisher.keys.map(({ keyId, state, stateSequence }) => ({ keyId, state, stateSequence })),
      revokedKeyIds: publisher.revokedKeyIds,
      revocation: revocationFreshness(trust, publisher.publisherId, now, maxAgeMs),
    })),
    authorities: trust.authorities.map((authority) => ({ authorityId: authority.authorityId, keyIds: authority.keys.map((key) => key.keyId) })),
    transitions: trust.transitions,
  };
}
