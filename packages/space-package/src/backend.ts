import { SpacePackageError, type SpacePackageManifest } from "./format.js";
import type { LocalState } from "./state.js";

/**
 * Durable storage for installed Spaces with several releases, local state and an update journal.
 * Every write that matters replaces one whole document atomically; a release appears whole or not at all.
 */
export const RECORD_SCHEMA = "digiconomy.space-installation/v2";

export interface ReleaseEntry {
  version: string;
  packageDigest: string;
  /** Publisher release sequence; null until a signed update document attests it. */
  sequence: number | null;
  integrityRoot: string;
  publisherId: string;
  keyId: string;
  /** Local-state data version this release reads and writes. */
  dataVersion: number;
  /** Set once the release has opened successfully; until then the previous release is kept. */
  proven: boolean;
  manifest: SpacePackageManifest;
}

export interface SpaceRecord {
  schema: typeof RECORD_SCHEMA;
  /** One local installation: kept across every update, never inherited by another installation. */
  installationId: string;
  stateId: string;
  /** Package lineage. */
  packageId: string;
  active: ReleaseEntry;
  /** Last known-good release, kept for rollback until the active one is proven and superseded. */
  previous: ReleaseEntry | null;
  /** Rollback below this release sequence is refused (set by signed updates, never lowered). */
  securityFloor: number;
  /** Every version this installation has seen with its digest: a version is immutable once published. */
  ledger: Array<{ version: string; packageDigest: string }>;
  status: "ACTIVE" | "RECOVERY_REQUIRED";
  statusReason: string | null;
  /** Transaction holding the state lock (no state writes while an activation is in flight). */
  stateLock: string | null;
  installedAt: string;
  updatedAt: string;
  /** Installing or updating confers no ownership and no authority. */
  authority: { owner: null; grants: [] };
}

export type StateSlot = "current" | `next-${string}` | `snapshot-${string}`;

export type UpdateState =
  | "AVAILABLE" | "DOWNLOADING" | "STAGED" | "VERIFIED" | "MIGRATION_PREPARED" | "ACTIVATING" | "ACTIVE"
  | "REJECTED" | "INTERRUPTED" | "ROLLED_BACK" | "RECOVERY_REQUIRED";

export interface UpdateTransaction {
  txId: string;
  kind: "UPDATE" | "ROLLBACK";
  packageId: string;
  installationId: string;
  from: { version: string; packageDigest: string; sequence: number | null };
  to: { version: string; packageDigest: string; sequence: number | null };
  state: UpdateState;
  history: Array<{ state: UpdateState; at: string; detail?: string }>;
  reason: string | null;
  /** Verification evidence recorded at VERIFIED (what was checked, honestly including revocation freshness). */
  evidence: Record<string, unknown> | null;
}

export interface LifecycleBackend {
  listPackageIds(): Promise<string[]>;
  readRecord(packageId: string): Promise<SpaceRecord | null>;
  writeRecord(record: SpaceRecord): Promise<void>;
  createInstallation(record: SpaceRecord, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }, state: LocalState): Promise<void>;
  putRelease(packageId: string, digest: string, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }): Promise<void>;
  hasRelease(packageId: string, digest: string): Promise<boolean>;
  deleteRelease(packageId: string, digest: string): Promise<void>;
  readReleaseAsset(packageId: string, digest: string, path: string): Promise<Uint8Array>;
  readReleaseArtifact(packageId: string, digest: string): Promise<Uint8Array>;
  readState(packageId: string, slot: StateSlot): Promise<LocalState | null>;
  writeState(packageId: string, slot: StateSlot, state: LocalState): Promise<void>;
  deleteState(packageId: string, slot: StateSlot): Promise<void>;
  /** Atomically replaces `current` with `slot`. */
  promoteState(packageId: string, slot: StateSlot): Promise<void>;
  writeTransaction(transaction: UpdateTransaction): Promise<void>;
  readTransaction(packageId: string, txId: string): Promise<UpdateTransaction | null>;
  listTransactions(packageId: string): Promise<UpdateTransaction[]>;
  /** Download staging: bytes received for a transaction, invisible to everything else. */
  stageWrite(txId: string, name: string, bytes: Uint8Array): Promise<void>;
  stageRead(txId: string, name: string): Promise<Uint8Array | null>;
  stageDrop(txId: string): Promise<void>;
  stageList(): Promise<string[]>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryLifecycleBackend implements LifecycleBackend {
  readonly records = new Map<string, SpaceRecord>();
  readonly releases = new Map<string, { artifact: Uint8Array; assets: Map<string, Uint8Array> }>();
  readonly states = new Map<string, LocalState>();
  readonly transactions = new Map<string, UpdateTransaction>();
  readonly staging = new Map<string, Map<string, Uint8Array>>();
  private key = (...parts: string[]) => parts.join("\u0000");

  async listPackageIds() { return [...this.records.keys()].sort(); }
  async readRecord(packageId: string) { const record = this.records.get(packageId); return record ? clone(record) : null; }
  async writeRecord(record: SpaceRecord) { this.records.set(record.packageId, clone(record)); }
  async createInstallation(record: SpaceRecord, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }, state: LocalState) {
    if (this.records.has(record.packageId)) throw new SpacePackageError("ALREADY_INSTALLED", record.packageId);
    this.releases.set(this.key(record.packageId, record.active.packageDigest), { artifact: release.artifact.slice(), assets: new Map(release.assets) });
    this.states.set(this.key(record.packageId, "current"), clone(state));
    this.records.set(record.packageId, clone(record));
  }
  async putRelease(packageId: string, digest: string, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }) {
    const key = this.key(packageId, digest);
    if (!this.releases.has(key)) this.releases.set(key, { artifact: release.artifact.slice(), assets: new Map(release.assets) });
  }
  async hasRelease(packageId: string, digest: string) { return this.releases.has(this.key(packageId, digest)); }
  async deleteRelease(packageId: string, digest: string) { this.releases.delete(this.key(packageId, digest)); }
  async readReleaseAsset(packageId: string, digest: string, path: string) {
    const bytes = this.releases.get(this.key(packageId, digest))?.assets.get(path);
    if (!bytes) throw new SpacePackageError("INSTALLATION_CORRUPT", path);
    return bytes.slice();
  }
  async readReleaseArtifact(packageId: string, digest: string) {
    const release = this.releases.get(this.key(packageId, digest));
    if (!release) throw new SpacePackageError("INSTALLATION_CORRUPT", digest);
    return release.artifact.slice();
  }
  async readState(packageId: string, slot: StateSlot) { const state = this.states.get(this.key(packageId, slot)); return state ? clone(state) : null; }
  async writeState(packageId: string, slot: StateSlot, state: LocalState) { this.states.set(this.key(packageId, slot), clone(state)); }
  async deleteState(packageId: string, slot: StateSlot) { this.states.delete(this.key(packageId, slot)); }
  async promoteState(packageId: string, slot: StateSlot) {
    const state = this.states.get(this.key(packageId, slot));
    if (!state) return;
    this.states.set(this.key(packageId, "current"), state);
    this.states.delete(this.key(packageId, slot));
  }
  async writeTransaction(transaction: UpdateTransaction) { this.transactions.set(this.key(transaction.packageId, transaction.txId), clone(transaction)); }
  async readTransaction(packageId: string, txId: string) { const tx = this.transactions.get(this.key(packageId, txId)); return tx ? clone(tx) : null; }
  async listTransactions(packageId: string) {
    return [...this.transactions.entries()].filter(([key]) => key.startsWith(`${packageId}\u0000`)).map(([, tx]) => clone(tx));
  }
  async stageWrite(txId: string, name: string, bytes: Uint8Array) {
    const area = this.staging.get(txId) ?? new Map<string, Uint8Array>();
    area.set(name, bytes.slice());
    this.staging.set(txId, area);
  }
  async stageRead(txId: string, name: string) { return this.staging.get(txId)?.get(name)?.slice() ?? null; }
  async stageDrop(txId: string) { this.staging.delete(txId); }
  async stageList() { return [...this.staging.keys()]; }
}
