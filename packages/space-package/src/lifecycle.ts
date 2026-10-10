import { RECORD_SCHEMA, type LifecycleBackend, type ReleaseEntry, type SpaceRecord, type UpdateState, type UpdateTransaction } from "./backend.js";
import { LIMITS, SpacePackageError, type PackagePermission } from "./format.js";
import {
  INSTALLATION_SCHEMA,
  importSpacePackage,
  openSpace,
  type ImportResult,
  type InstallationRecord,
  type InstallationStore,
  type OpenedSpace,
  type RuntimeEnvironment,
  type StagingArea,
} from "./install.js";
import { verifySpacePackage, type VerifiedPackage } from "./package.js";
import { emptyState, holdConsequentialOperations, appendJournal, migrateState, validateState, type LocalState } from "./state.js";
import { keyState, publishersFor, revocationFreshness, transitionAllowed, type TrustStore } from "./trust.js";
import { parseUpdateDocument, verifyUpdateSignature, type UpdateDocument } from "./update.js";

/**
 * SP2 update engine.
 *
 *   AVAILABLE → DOWNLOADING → STAGED → VERIFIED → MIGRATION_PREPARED → ACTIVATING → ACTIVE
 *   failures: REJECTED (failed a check) · INTERRUPTED (stopped before commit; old release active)
 *             ROLLED_BACK (returned to the last known-good release) · RECOVERY_REQUIRED (nothing safe to do automatically)
 *
 * Every transition is written to a durable transaction record before it takes effect. Activation has
 * exactly one commit point — the atomic write of the installation record naming the new release:
 * before it, recovery returns to the old release; after it, recovery completes the update. Recovery
 * is deterministic and idempotent, and a partially installed release can never become active.
 */

/** Thrown by a test failpoint to simulate the process dying: no cleanup runs, exactly as in a crash. */
export class SimulatedCrash extends Error {
  constructor(readonly point: string) {
    super(`simulated crash at ${point}`);
    this.name = "SimulatedCrash";
  }
}

export type Failpoint =
  | "download" | "staged" | "verified" | "migration-prepared"
  | "activating" | "release-written" | "record-committed" | "state-promoted"
  | "rollback-state-written" | "rollback-record-committed";

export interface LifecycleOptions {
  /** Current trust store (read on every operation: rotations and revocations apply immediately). */
  trust: () => TrustStore;
  runtime: { version: string; spaceContractVersions?: readonly number[] };
  now?: () => Date;
  newId?: () => string;
  /** Revocation evidence older than this is STALE. */
  revocationMaxAgeMs?: number;
  failpoint?: (point: Failpoint) => void | Promise<void>;
}

const TERMINAL: UpdateState[] = ["ACTIVE", "REJECTED", "INTERRUPTED", "ROLLED_BACK", "RECOVERY_REQUIRED"];
const NEXT: Partial<Record<UpdateState, UpdateState[]>> = {
  AVAILABLE: ["DOWNLOADING", "REJECTED"],
  DOWNLOADING: ["STAGED", "INTERRUPTED", "REJECTED"],
  STAGED: ["VERIFIED", "REJECTED", "INTERRUPTED"],
  VERIFIED: ["MIGRATION_PREPARED", "REJECTED", "INTERRUPTED"],
  MIGRATION_PREPARED: ["ACTIVATING", "REJECTED", "INTERRUPTED"],
  ACTIVATING: ["ACTIVE", "INTERRUPTED", "REJECTED", "ROLLED_BACK", "RECOVERY_REQUIRED"],
};

export type RollbackResult =
  | { status: "ROLLED_BACK"; record: SpaceRecord; txId: string }
  | { status: "RECOVERY_REQUIRED"; reason: string; txId: string };

export class SpaceLifecycle implements InstallationStore {
  constructor(readonly backend: LifecycleBackend, readonly options: LifecycleOptions) {}

  private now() { return this.options.now?.() ?? new Date(); }
  private id() { return this.options.newId?.() ?? crypto.randomUUID(); }
  private async fail(point: Failpoint) { await this.options.failpoint?.(point); }

  /* ───────────── SP1 InstallationStore, so importSpacePackage / openSpace work unchanged ───────────── */

  private sp1(record: SpaceRecord): InstallationRecord {
    const active = record.active;
    return {
      schema: INSTALLATION_SCHEMA,
      installationId: record.installationId,
      packageId: record.packageId,
      version: active.version,
      name: active.manifest.package.name,
      integrityRoot: active.integrityRoot,
      packageDigest: active.packageDigest,
      publisher: { publisherId: active.publisherId, keyId: active.keyId, trust: "TRUSTED_PUBLISHER" },
      installedAt: record.installedAt,
      authority: { owner: null, grants: [] },
      manifest: active.manifest,
    };
  }
  async list() {
    const out: InstallationRecord[] = [];
    for (const id of await this.backend.listPackageIds()) { const record = await this.backend.readRecord(id); if (record) out.push(this.sp1(record)); }
    return out;
  }
  async get(packageId: string) {
    const record = await this.backend.readRecord(packageId);
    return record ? this.sp1(record) : null;
  }
  async readAsset(packageId: string, path: string) {
    const record = await this.requireRecord(packageId);
    return this.backend.readReleaseAsset(packageId, record.active.packageDigest, path);
  }
  async readArtifact(integrityRoot: string) {
    for (const id of await this.backend.listPackageIds()) {
      const record = await this.backend.readRecord(id);
      for (const release of [record?.active, record?.previous]) if (release && release.integrityRoot === integrityRoot) return this.backend.readReleaseArtifact(id, release.packageDigest);
    }
    throw new SpacePackageError("NOT_INSTALLED", integrityRoot);
  }
  async stage(packageId: string): Promise<StagingArea> {
    const pending: { artifact: Uint8Array | null; assets: Map<string, Uint8Array>; record: InstallationRecord | null } = { artifact: null, assets: new Map(), record: null };
    return {
      writeArtifact: async (_root, bytes) => { pending.artifact = bytes.slice(); },
      writeAsset: async (path, bytes) => { pending.assets.set(path, bytes.slice()); },
      writeRecord: async (record) => { pending.record = structuredClone(record); },
      commit: async () => {
        const sp1 = pending.record;
        if (!sp1 || !pending.artifact || sp1.packageId !== packageId) throw new SpacePackageError("IMPORT_INTERRUPTED", "incomplete staging");
        const stateId = this.id();
        const at = this.now().toISOString();
        const record: SpaceRecord = {
          schema: RECORD_SCHEMA,
          installationId: sp1.installationId,
          stateId,
          packageId,
          active: { version: sp1.version, packageDigest: sp1.packageDigest, sequence: null, integrityRoot: sp1.integrityRoot, publisherId: sp1.publisher.publisherId, keyId: sp1.publisher.keyId, dataVersion: 1, proven: false, manifest: sp1.manifest },
          previous: null,
          securityFloor: 0,
          ledger: [{ version: sp1.version, packageDigest: sp1.packageDigest }],
          status: "ACTIVE",
          statusReason: null,
          stateLock: null,
          installedAt: at,
          updatedAt: at,
          authority: { owner: null, grants: [] },
        };
        await this.backend.createInstallation(record, { artifact: pending.artifact, assets: pending.assets }, emptyState({ stateId, installationId: sp1.installationId, packageId }));
      },
      abort: async () => { pending.artifact = null; pending.assets.clear(); },
    };
  }
  async recover() {
    const report = await this.recoverAll();
    return { discardedStaging: report.discardedStaging };
  }

  /* ───────────── install / open ───────────── */

  /** INSTALL: a new installation with its own identity and empty state. Never inherits authority. */
  async install(bytes: Uint8Array): Promise<ImportResult> {
    return importSpacePackage(bytes, { store: this, publishers: publishersFor(this.options.trust(), "NEW_RELEASE"), runtime: this.options.runtime, now: () => this.now(), newInstallationId: () => this.id() });
  }

  /** Opens the active release; the first successful open proves it (and only then may the previous one be retired). */
  async open(packageId: string, options: { environment: RuntimeEnvironment; experienceId?: string; requested?: readonly string[] }): Promise<OpenedSpace> {
    await this.recoverAll();
    const record = await this.requireRecord(packageId);
    if (record.status === "RECOVERY_REQUIRED") throw new SpacePackageError("RECOVERY_REQUIRED", record.statusReason ?? packageId);
    if (keyState(this.options.trust(), record.active.publisherId, record.active.keyId) === "REVOKED") throw new SpacePackageError("KEY_REVOKED", `active release signed by revoked key ${record.active.keyId}`);
    const opened = await openSpace(this, packageId, options);
    if (!record.active.proven && opened.experience.state !== "BLOCKED") {
      await this.backend.writeRecord({ ...record, active: { ...record.active, proven: true }, updatedAt: this.now().toISOString() });
    }
    return opened;
  }

  async record(packageId: string) { return this.requireRecord(packageId); }
  private async requireRecord(packageId: string) {
    const record = await this.backend.readRecord(packageId);
    if (!record) throw new SpacePackageError("NOT_INSTALLED", packageId);
    return record;
  }

  /* ───────────── local state ───────────── */

  async readState(packageId: string): Promise<LocalState> {
    await this.requireRecord(packageId);
    const state = await this.backend.readState(packageId, "current");
    if (!state) throw new SpacePackageError("INSTALLATION_CORRUPT", "state");
    return state;
  }

  /**
   * The only way to change local state: identity is fixed, sensitive or authority data is refused,
   * and nothing is written while an update or rollback holds the state lock.
   */
  async writeState(packageId: string, change: (state: LocalState) => LocalState, expectedRevision?: number): Promise<LocalState> {
    const record = await this.requireRecord(packageId);
    if (record.stateLock) throw new SpacePackageError("STATE_LOCKED", `held by ${record.stateLock}`);
    const current = await this.readState(packageId);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new SpacePackageError("STATE_CONFLICT", `revision ${current.revision}`);
    const next = change(structuredClone(current));
    if (next.stateId !== current.stateId || next.installationId !== record.installationId || next.packageId !== packageId || next.dataVersion !== current.dataVersion) {
      throw new SpacePackageError("STATE_CONFLICT", "state identity and data version are not writable");
    }
    const written = { ...next, revision: current.revision + 1 };
    validateState(written);
    await this.backend.writeState(packageId, "current", written);
    return written;
  }

  /* ───────────── update lifecycle ───────────── */

  private async transition(tx: UpdateTransaction, state: UpdateState, detail?: string): Promise<UpdateTransaction> {
    const allowed = NEXT[tx.state] ?? [];
    if (!allowed.includes(state)) throw new SpacePackageError("INVALID_TRANSITION", `${tx.state} → ${state}`);
    const next: UpdateTransaction = { ...tx, state, history: [...tx.history, { state, at: this.now().toISOString(), ...(detail ? { detail } : {}) }], reason: TERMINAL.includes(state) && state !== "ACTIVE" ? detail ?? tx.reason : tx.reason };
    await this.backend.writeTransaction(next);
    return next;
  }

  async transaction(packageId: string, txId: string): Promise<UpdateTransaction> {
    const tx = await this.backend.readTransaction(packageId, txId);
    if (!tx) throw new SpacePackageError("TRANSACTION_NOT_FOUND", txId);
    return tx;
  }

  async history(packageId: string): Promise<UpdateTransaction[]> {
    return (await this.backend.listTransactions(packageId)).sort((a, b) => a.history[0]!.at.localeCompare(b.history[0]!.at) || a.txId.localeCompare(b.txId));
  }

  /** update inspect: read-only — what this update would do and whether it would be accepted now. */
  async inspectUpdate(updateBytes: Uint8Array, packageBytes?: Uint8Array, options: { approvedPermissions?: readonly PackagePermission[] } = {}) {
    const doc = parseUpdateDocument(updateBytes);
    const record = await this.requireRecord(doc.lineage.packageId);
    try {
      const checked = await this.check(record, doc, packageBytes ?? null, options.approvedPermissions ?? []);
      return { acceptable: true as const, update: summarize(doc), evidence: checked.evidence };
    } catch (error) {
      if (!(error instanceof SpacePackageError)) throw error;
      return { acceptable: false as const, update: summarize(doc), code: error.code, detail: error.detail ?? null };
    }
  }

  /** update stage: AVAILABLE → DOWNLOADING → STAGED. Bytes are held apart from every installation. */
  async stageUpdate(updateBytes: Uint8Array, source: Uint8Array | (() => AsyncIterable<Uint8Array>)): Promise<UpdateTransaction> {
    await this.recoverAll();
    const doc = parseUpdateDocument(updateBytes);
    const record = await this.requireRecord(doc.lineage.packageId);
    if (record.status === "RECOVERY_REQUIRED") throw new SpacePackageError("RECOVERY_REQUIRED", record.statusReason ?? "");
    const at = this.now().toISOString();
    let tx: UpdateTransaction = {
      txId: this.id(), kind: "UPDATE", packageId: record.packageId, installationId: record.installationId,
      from: { ...doc.from }, to: { ...doc.to }, state: "AVAILABLE", history: [{ state: "AVAILABLE", at }], reason: null, evidence: null,
    };
    await this.backend.writeTransaction(tx);
    tx = await this.transition(tx, "DOWNLOADING");
    await this.backend.stageWrite(tx.txId, "update.json", updateBytes);
    let bytes: Uint8Array;
    try {
      if (source instanceof Uint8Array) {
        bytes = source;
      } else {
        const chunks: Uint8Array[] = [];
        let length = 0;
        for await (const chunk of source()) {
          length += chunk.length;
          if (length > LIMITS.maxArchiveBytes) throw new SpacePackageError("ARCHIVE_TOO_LARGE");
          chunks.push(chunk);
          await this.fail("download");
        }
        bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      }
      await this.backend.stageWrite(tx.txId, "package.space", bytes);
      await this.fail("staged");
    } catch (error) {
      if (error instanceof SimulatedCrash) throw error;
      await this.backend.stageDrop(tx.txId);
      await this.transition(tx, "INTERRUPTED", error instanceof SpacePackageError ? error.code : "DOWNLOAD_INTERRUPTED");
      throw new SpacePackageError("DOWNLOAD_INTERRUPTED", error instanceof Error ? error.message : String(error));
    }
    return this.transition(tx, "STAGED");
  }

  /** Every check an update must pass. Throws the first failure; returns verified package and evidence. */
  private async check(record: SpaceRecord, doc: UpdateDocument, packageBytes: Uint8Array | null, approvedPermissions: readonly PackagePermission[]): Promise<{ verified: VerifiedPackage | null; evidence: Record<string, unknown> }> {
    const trust = this.options.trust();
    if (record.status === "RECOVERY_REQUIRED") throw new SpacePackageError("RECOVERY_REQUIRED", record.statusReason ?? "");
    if (doc.lineage.packageId !== record.packageId) throw new SpacePackageError("WRONG_LINEAGE", doc.lineage.packageId);
    // Publisher authority may change only through an explicit, verified transition.
    if (!transitionAllowed(trust, record.packageId, record.active.publisherId, doc.publisher.publisherId)) throw new SpacePackageError("PUBLISHER_CHANGED", `${record.active.publisherId} → ${doc.publisher.publisherId}`);
    const signingKey = keyState(trust, doc.publisher.publisherId, doc.publisher.keyId);
    if (signingKey === "REVOKED") throw new SpacePackageError("KEY_REVOKED", doc.publisher.keyId);
    if (signingKey !== "ACTIVE" && signingKey !== "ROTATING") throw new SpacePackageError("KEY_NOT_AUTHORIZED", `${doc.publisher.keyId} is ${signingKey}`);
    const publicKey = trust.publishers.find((item) => item.publisherId === doc.publisher.publisherId)!.keys.find((key) => key.keyId === doc.publisher.keyId)!.publicKeySpkiBase64;
    if (!(await verifyUpdateSignature(doc, publicKey))) throw new SpacePackageError("UPDATE_SIGNATURE_INVALID");

    const revocation = revocationFreshness(trust, doc.publisher.publisherId, this.now(), this.options.revocationMaxAgeMs ?? 7 * 24 * 3600 * 1000);
    if (doc.security.requiresRevocationSequence !== null && (revocation.sequence ?? -1) < doc.security.requiresRevocationSequence) {
      throw new SpacePackageError("FRESH_REVOCATION_REQUIRED", `needs revocation list ≥ ${doc.security.requiresRevocationSequence}, have ${revocation.sequence ?? "none"}`);
    }
    if (doc.security.requiresCurrentRevocation && revocation.status !== "CURRENT") throw new SpacePackageError("FRESH_REVOCATION_REQUIRED", `revocation evidence is ${revocation.status}`);

    // The update must start exactly from the installed release.
    if (doc.from.packageDigest !== record.active.packageDigest || doc.from.version !== record.active.version) throw new SpacePackageError("FROM_RELEASE_MISMATCH", `${doc.from.version} ≠ installed ${record.active.version}`);
    if (record.active.sequence !== null && doc.from.sequence !== record.active.sequence) throw new SpacePackageError("FROM_RELEASE_MISMATCH", "sequence");
    // Anti-downgrade on the signed sequence, never on version strings or clocks.
    const currentSequence = record.active.sequence ?? doc.from.sequence;
    if (doc.to.sequence <= currentSequence || doc.to.sequence < record.securityFloor) throw new SpacePackageError("DOWNGRADE_REJECTED", `sequence ${doc.to.sequence}`);
    const known = record.ledger.find((item) => item.version === doc.to.version);
    if (known && known.packageDigest !== doc.to.packageDigest) throw new SpacePackageError("VERSION_REUSED", `${doc.to.version} was already published with different bytes`);
    if (doc.state.fromDataVersion !== record.active.dataVersion) throw new SpacePackageError("UPDATE_INVALID", `state data version ${record.active.dataVersion} ≠ ${doc.state.fromDataVersion}`);

    let verified: VerifiedPackage | null = null;
    let added: PackagePermission[] = [];
    if (packageBytes) {
      verified = await verifySpacePackage(packageBytes, { publishers: publishersFor(trust, "NEW_RELEASE"), runtime: this.options.runtime });
      const manifest = verified.manifest;
      if (verified.packageDigest !== doc.to.packageDigest) throw new SpacePackageError("PACKAGE_DIGEST_MISMATCH", "the staged package is not the release this update names");
      if (manifest.package.id !== record.packageId) throw new SpacePackageError("WRONG_LINEAGE", manifest.package.id);
      if (manifest.package.version !== doc.to.version) throw new SpacePackageError("UPDATE_INVALID", "target version");
      if (manifest.publisher.publisherId !== doc.publisher.publisherId) throw new SpacePackageError("PUBLISHER_CHANGED", "package and update publishers differ");
      if (manifest.runtime.spaceContractVersion !== doc.compatibility.spaceContractVersion || manifest.runtime.minimumRuntimeVersion !== doc.compatibility.minimumRuntimeVersion) throw new SpacePackageError("UPDATE_INVALID", "compatibility does not match the package");
      if ([...manifest.permissions].sort().join() !== [...doc.permissions].sort().join()) throw new SpacePackageError("UPDATE_INVALID", "permissions do not match the package");
      added = manifest.permissions.filter((permission) => !record.active.manifest.permissions.includes(permission));
      const unapproved = added.filter((permission) => !approvedPermissions.includes(permission));
      if (unapproved.length) throw new SpacePackageError("PERMISSION_ESCALATION", unapproved.join(", "));
    }
    return {
      verified,
      evidence: {
        signature: "VALID_AGAINST_LOCAL_TRUST",
        signingKey: { keyId: doc.publisher.keyId, state: signingKey },
        revocation,
        packageDigest: doc.to.packageDigest,
        integrityRoot: verified?.integrityRoot ?? null,
        addedPermissions: added,
        rollbackEligible: doc.rollback.eligible,
        securityFloor: doc.rollback.minimumSequence,
        state: { from: doc.state.fromDataVersion, to: doc.state.toDataVersion, backwardCompatible: doc.state.backwardCompatible, steps: doc.state.migration.length },
      },
    };
  }

  private async staged(tx: UpdateTransaction) {
    const updateBytes = await this.backend.stageRead(tx.txId, "update.json");
    const packageBytes = await this.backend.stageRead(tx.txId, "package.space");
    if (!updateBytes || !packageBytes) throw new SpacePackageError("IMPORT_INTERRUPTED", "staged files missing");
    return { doc: parseUpdateDocument(updateBytes), packageBytes };
  }

  private async reject(tx: UpdateTransaction, error: unknown): Promise<never> {
    if (error instanceof SimulatedCrash) throw error;
    const code = error instanceof SpacePackageError ? error.code : "UPDATE_INVALID";
    await this.cleanupTransaction(tx);
    await this.transition(tx, "REJECTED", code);
    throw error instanceof SpacePackageError ? error : new SpacePackageError("UPDATE_INVALID", String(error));
  }

  /** update verify: STAGED → VERIFIED, or REJECTED with the staged bytes discarded. */
  async verifyUpdate(packageId: string, txId: string, options: { approvedPermissions?: readonly PackagePermission[] } = {}): Promise<UpdateTransaction> {
    let tx = await this.transaction(packageId, txId);
    if (tx.state !== "STAGED") throw new SpacePackageError("INVALID_TRANSITION", `${tx.state} → VERIFIED`);
    try {
      const { doc, packageBytes } = await this.staged(tx);
      const record = await this.requireRecord(packageId);
      const { evidence } = await this.check(record, doc, packageBytes, options.approvedPermissions ?? []);
      tx = { ...tx, evidence };
      await this.backend.writeTransaction(tx);
      await this.fail("verified");
      return await this.transition(tx, "VERIFIED");
    } catch (error) {
      return this.reject(tx, error);
    }
  }

  /** VERIFIED → MIGRATION_PREPARED: migrated state is computed beside the current one; nothing is replaced yet. */
  async prepareMigration(packageId: string, txId: string): Promise<UpdateTransaction> {
    let tx = await this.transaction(packageId, txId);
    if (tx.state !== "VERIFIED") throw new SpacePackageError("INVALID_TRANSITION", `${tx.state} → MIGRATION_PREPARED`);
    const record = await this.requireRecord(packageId);
    if (record.stateLock && record.stateLock !== txId) throw new SpacePackageError("STATE_LOCKED", record.stateLock);
    try {
      const { doc } = await this.staged(tx);
      // From here until ACTIVE or a failure, local state is locked: the migration sees exactly what activation commits.
      await this.backend.writeRecord({ ...record, stateLock: txId, updatedAt: this.now().toISOString() });
      const current = await this.readState(packageId);
      const next = migrateState(current, { fromDataVersion: doc.state.fromDataVersion, toDataVersion: doc.state.toDataVersion, steps: doc.state.migration });
      await this.backend.writeState(packageId, `snapshot-${txId}`, current);
      await this.backend.writeState(packageId, `next-${txId}`, appendJournal(next, this.now(), "STATE_MIGRATED", { detail: `${doc.state.fromDataVersion}→${doc.state.toDataVersion} for ${doc.to.version}` }));
      await this.fail("migration-prepared");
      return await this.transition(tx, "MIGRATION_PREPARED");
    } catch (error) {
      return this.reject(tx, error instanceof SpacePackageError && error.code !== "STATE_LOCKED" && error.code !== "MIGRATION_FAILED" ? new SpacePackageError("MIGRATION_FAILED", error.message) : error);
    }
  }

  /** MIGRATION_PREPARED → ACTIVATING → ACTIVE, with one commit point (the record write). */
  async activate(packageId: string, txId: string): Promise<UpdateTransaction> {
    let tx = await this.transaction(packageId, txId);
    if (tx.state !== "MIGRATION_PREPARED") throw new SpacePackageError("INVALID_TRANSITION", `${tx.state} → ACTIVATING`);
    tx = await this.transition(tx, "ACTIVATING");
    try {
      await this.fail("activating");
      const { doc, packageBytes } = await this.staged(tx);
      // Re-verify the staged bytes immediately before use: staging is never trusted across steps.
      const record = await this.requireRecord(packageId);
      const { verified } = await this.check(record, doc, packageBytes, (tx.evidence?.addedPermissions as PackagePermission[]) ?? []);
      await this.backend.putRelease(packageId, doc.to.packageDigest, { artifact: packageBytes, assets: verified!.assets });
      await this.fail("release-written");
      const at = this.now().toISOString();
      const replaced = record.previous;
      const committed: SpaceRecord = {
        ...record,
        active: {
          version: doc.to.version, packageDigest: doc.to.packageDigest, sequence: doc.to.sequence, integrityRoot: verified!.integrityRoot,
          publisherId: doc.publisher.publisherId, keyId: verified!.manifest.publisher.keyId, dataVersion: doc.state.toDataVersion, proven: false, manifest: verified!.manifest,
        },
        previous: { ...record.active, sequence: record.active.sequence ?? doc.from.sequence },
        securityFloor: Math.max(record.securityFloor, doc.rollback.minimumSequence),
        ledger: record.ledger.some((item) => item.version === doc.to.version) ? record.ledger : [...record.ledger, { version: doc.to.version, packageDigest: doc.to.packageDigest }],
        stateLock: txId,
        updatedAt: at,
      };
      await this.backend.writeRecord(committed); // ◀ commit point
      await this.fail("record-committed");
      await this.finishActivation(committed, tx, replaced);
      return await this.transaction(packageId, txId);
    } catch (error) {
      if (error instanceof SimulatedCrash) throw error;
      const current = await this.transaction(packageId, txId);
      const record = await this.backend.readRecord(packageId);
      if (current.state === "ACTIVATING" && record?.active.packageDigest !== current.to.packageDigest) {
        // Not committed: the old release stays active. A failed check is a rejection; anything else an interruption.
        await this.cleanupTransaction(current);
        await this.transition(current, error instanceof SpacePackageError ? "REJECTED" : "INTERRUPTED", error instanceof SpacePackageError ? error.code : String(error));
      } else {
        await this.recoverTransaction(current);
      }
      throw error instanceof SpacePackageError ? error : new SpacePackageError("IMPORT_INTERRUPTED", String(error));
    }
  }

  /** update abort: discards a staged, verified or prepared update; the active release and state are untouched. */
  async abortUpdate(packageId: string, txId: string): Promise<UpdateTransaction> {
    const tx = await this.transaction(packageId, txId);
    if (!["STAGED", "VERIFIED", "MIGRATION_PREPARED"].includes(tx.state)) throw new SpacePackageError("INVALID_TRANSITION", `${tx.state} cannot be aborted`);
    await this.cleanupTransaction(tx);
    return this.transition(tx, "INTERRUPTED", "aborted");
  }

  /** After the commit point: promote the migrated state, release the lock, retire superseded files. Idempotent. */
  private async finishActivation(record: SpaceRecord, tx: UpdateTransaction, superseded: ReleaseEntry | null) {
    await this.backend.promoteState(record.packageId, `next-${tx.txId}`);
    await this.fail("state-promoted");
    const unlocked = record.stateLock === tx.txId ? { ...record, stateLock: null } : record;
    await this.backend.writeRecord(unlocked);
    await this.backend.deleteState(record.packageId, `snapshot-${tx.txId}`);
    await this.backend.stageDrop(tx.txId);
    // Only the release two steps back is removed: the previous one stays until the new one is proven and superseded.
    if (superseded && superseded.packageDigest !== unlocked.previous?.packageDigest && superseded.packageDigest !== unlocked.active.packageDigest) {
      await this.backend.deleteRelease(record.packageId, superseded.packageDigest);
    }
    const current = await this.backend.readTransaction(record.packageId, tx.txId);
    if (current && current.state === "ACTIVATING") await this.transition(current, "ACTIVE");
  }

  /** Runs verify → prepare → activate for a staged update. */
  async applyStagedUpdate(packageId: string, txId: string, options: { approvedPermissions?: readonly PackagePermission[] } = {}) {
    await this.verifyUpdate(packageId, txId, options);
    await this.prepareMigration(packageId, txId);
    return this.activate(packageId, txId);
  }

  /* ───────────── rollback ───────────── */

  /**
   * update rollback: back to the last known-good release, with the current local state (never an
   * old copy — user content survives and pending operations are never duplicated). Refused below the
   * security floor, to a release signed by a revoked key, or when not rollback-eligible. When the old
   * release cannot safely read the migrated state, nothing changes and RECOVERY_REQUIRED is returned.
   */
  async rollback(packageId: string, reason: string, options: { launchFailed?: boolean } = {}): Promise<RollbackResult> {
    await this.recoverAll();
    const record = await this.requireRecord(packageId);
    if (record.stateLock) throw new SpacePackageError("STATE_LOCKED", record.stateLock);
    const previous = record.previous;
    if (!previous) throw new SpacePackageError("ROLLBACK_NOT_ELIGIBLE", "no previous release");
    const update = (await this.history(packageId)).filter((tx) => tx.kind === "UPDATE" && tx.state === "ACTIVE" && tx.to.packageDigest === record.active.packageDigest).at(-1);
    const evidence = update?.evidence as { rollbackEligible?: boolean; state?: { backwardCompatible: boolean } } | null | undefined;
    if (!evidence?.rollbackEligible) throw new SpacePackageError("ROLLBACK_NOT_ELIGIBLE", "the active update forbids rollback");
    if ((previous.sequence ?? 0) < record.securityFloor) throw new SpacePackageError("BELOW_SECURITY_FLOOR", `${previous.sequence} < ${record.securityFloor}`);
    if (keyState(this.options.trust(), previous.publisherId, previous.keyId) === "REVOKED") throw new SpacePackageError("KEY_REVOKED", `previous release signed by revoked key ${previous.keyId}`);

    const at = this.now().toISOString();
    let tx: UpdateTransaction = {
      txId: this.id(), kind: "ROLLBACK", packageId, installationId: record.installationId,
      from: { version: record.active.version, packageDigest: record.active.packageDigest, sequence: record.active.sequence },
      to: { version: previous.version, packageDigest: previous.packageDigest, sequence: previous.sequence },
      state: "ACTIVATING", history: [{ state: "ACTIVATING", at, detail: reason }], reason: null, evidence: { launchFailed: Boolean(options.launchFailed) },
    };
    await this.backend.writeTransaction(tx);

    const recovery = async (why: string): Promise<RollbackResult> => {
      if (options.launchFailed) await this.backend.writeRecord({ ...record, status: "RECOVERY_REQUIRED", statusReason: why, updatedAt: this.now().toISOString() });
      await this.transition(tx, "RECOVERY_REQUIRED", why);
      return { status: "RECOVERY_REQUIRED", reason: why, txId: tx.txId };
    };
    // The previous release must still verify (installed-release trust: retired keys verify, revoked never).
    try {
      await verifySpacePackage(await this.backend.readReleaseArtifact(packageId, previous.packageDigest), { publishers: publishersFor(this.options.trust(), "INSTALLED_RELEASE"), runtime: this.options.runtime });
    } catch (error) {
      return recovery(`previous release unusable: ${error instanceof SpacePackageError ? error.code : String(error)}`);
    }
    const state = await this.readState(packageId);
    if (state.dataVersion > previous.dataVersion && !evidence.state?.backwardCompatible) {
      return recovery(`release ${previous.version} cannot read state data version ${state.dataVersion}`);
    }
    // Same state, carried forward: consequential operations still pending are held for explicit re-confirmation.
    const held = appendJournal(holdConsequentialOperations(state, this.now(), `rollback to ${previous.version}`), this.now(), "ROLLED_BACK", { detail: `${record.active.version} → ${previous.version}: ${reason}` });
    await this.backend.writeState(packageId, `next-${tx.txId}`, { ...held, revision: state.revision + 1 });
    await this.fail("rollback-state-written");
    const rolled: SpaceRecord = { ...record, active: { ...previous, proven: true }, previous: null, status: "ACTIVE", statusReason: null, stateLock: tx.txId, updatedAt: this.now().toISOString() };
    await this.backend.writeRecord(rolled); // ◀ commit point
    await this.fail("rollback-record-committed");
    await this.finishRollback(rolled, tx, record.active.packageDigest);
    return { status: "ROLLED_BACK", record: await this.requireRecord(packageId), txId: tx.txId };
  }

  private async finishRollback(record: SpaceRecord, tx: UpdateTransaction, failedDigest: string) {
    await this.backend.promoteState(record.packageId, `next-${tx.txId}`);
    const unlocked = record.stateLock === tx.txId ? { ...record, stateLock: null } : record;
    await this.backend.writeRecord(unlocked);
    if (failedDigest !== unlocked.active.packageDigest) await this.backend.deleteRelease(record.packageId, failedDigest);
    const current = await this.backend.readTransaction(record.packageId, tx.txId);
    if (current && current.state === "ACTIVATING") await this.transition(current, "ROLLED_BACK", "completed");
  }

  /* ───────────── recovery ───────────── */

  private async cleanupTransaction(tx: UpdateTransaction) {
    await this.backend.stageDrop(tx.txId);
    await this.backend.deleteState(tx.packageId, `next-${tx.txId}`);
    await this.backend.deleteState(tx.packageId, `snapshot-${tx.txId}`);
    const record = await this.backend.readRecord(tx.packageId);
    if (record && record.stateLock === tx.txId) await this.backend.writeRecord({ ...record, stateLock: null });
    if (record && tx.kind === "UPDATE" && record.active.packageDigest !== tx.to.packageDigest && record.previous?.packageDigest !== tx.to.packageDigest) {
      await this.backend.deleteRelease(tx.packageId, tx.to.packageDigest);
    }
  }

  /**
   * Resolves one unfinished transaction. Same inputs, same outcome, however many times it runs.
   *   DOWNLOADING / AVAILABLE          → INTERRUPTED (partial bytes discarded)
   *   STAGED / VERIFIED / PREPARED     → kept (durable resting states, resumable) when consistent, else INTERRUPTED
   *   ACTIVATING, committed            → completed (ACTIVE / ROLLED_BACK)
   *   ACTIVATING, not committed        → INTERRUPTED, the previously active release untouched
   */
  private async recoverTransaction(tx: UpdateTransaction): Promise<UpdateTransaction> {
    if (TERMINAL.includes(tx.state)) return tx;
    const record = await this.backend.readRecord(tx.packageId);
    const staged = Boolean(await this.backend.stageRead(tx.txId, "update.json")) && Boolean(await this.backend.stageRead(tx.txId, "package.space"));
    if (record && tx.state === "ACTIVATING") {
      const committed = record.active.packageDigest === tx.to.packageDigest && (tx.kind === "UPDATE" || record.stateLock === tx.txId);
      if (committed) {
        if (tx.kind === "UPDATE") await this.finishActivation(record, tx, null);
        else await this.finishRollback(record, tx, tx.from.packageDigest);
        return (await this.backend.readTransaction(tx.packageId, tx.txId))!;
      }
    }
    if (record && staged && (tx.state === "STAGED" || tx.state === "VERIFIED")) {
      // A crash while preparing the migration may have taken the lock and written partial state: undo just that.
      if (record.stateLock === tx.txId) await this.backend.writeRecord({ ...record, stateLock: null });
      await this.backend.deleteState(tx.packageId, `next-${tx.txId}`);
      await this.backend.deleteState(tx.packageId, `snapshot-${tx.txId}`);
      return tx;
    }
    if (record && staged && tx.state === "MIGRATION_PREPARED" && record.stateLock === tx.txId && (await this.backend.readState(tx.packageId, `next-${tx.txId}`))) return tx;
    await this.cleanupTransaction(tx);
    const latest = (await this.backend.readTransaction(tx.packageId, tx.txId))!;
    return TERMINAL.includes(latest.state) ? latest : this.transition(latest, "INTERRUPTED", `recovered from ${latest.state}`);
  }

  /** Recovery for every installation: finishes or undoes unfinished transactions; discards orphaned staging. */
  async recoverAll(): Promise<{ recovered: Array<{ txId: string; from: UpdateState; to: UpdateState }>; discardedStaging: number }> {
    const recovered: Array<{ txId: string; from: UpdateState; to: UpdateState }> = [];
    const live = new Set<string>();
    for (const packageId of await this.backend.listPackageIds()) {
      for (const tx of await this.backend.listTransactions(packageId)) {
        if (TERMINAL.includes(tx.state)) continue;
        const result = await this.recoverTransaction(tx);
        recovered.push({ txId: tx.txId, from: tx.state, to: result.state });
        if (!TERMINAL.includes(result.state)) live.add(tx.txId);
      }
    }
    let discardedStaging = 0;
    for (const name of await this.backend.stageList()) {
      if (!live.has(name)) { await this.backend.stageDrop(name); discardedStaging += 1; }
    }
    return { recovered, discardedStaging };
  }
}

function summarize(doc: UpdateDocument) {
  return {
    packageId: doc.lineage.packageId,
    publisher: doc.publisher,
    from: doc.from,
    to: doc.to,
    permissions: doc.permissions,
    state: { from: doc.state.fromDataVersion, to: doc.state.toDataVersion, backwardCompatible: doc.state.backwardCompatible, steps: doc.state.migration.length },
    rollback: doc.rollback,
    security: doc.security,
  };
}
