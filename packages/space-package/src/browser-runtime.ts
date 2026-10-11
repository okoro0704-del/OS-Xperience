import { assessPackage, type PackageAssessment } from "./assessment.js";
import { IndexedDbLifecycleBackend } from "./browser-backend.js";
import { detectPlatformSupport, detectSpaceFormat, type PlatformSupport, type SpaceFileKind } from "./detect.js";
import { SpacePackageError, type PackagePermission } from "./format.js";
import { SpaceLifecycle } from "./lifecycle.js";
import { verifySpacePackage } from "./package.js";
import type { LocalState } from "./state.js";
import {
  TRUST_POLICY_VERSION,
  TRUST_STORE_SCHEMA,
  applyKeyRotation,
  applyRevocationList,
  publishersFor,
  type KeyRotationStatement,
  type RevocationList,
  type TrustStore,
} from "./trust.js";

/**
 * SP3 browser runtime: the SP2 lifecycle engine (unchanged, and the only one) on IndexedDB, with
 * cross-tab coordination. Every mutation runs under one exclusive Web Lock shared by all tabs of the
 * origin; where Web Locks are unavailable, mutation is disabled (read-only), never assumed safe.
 * Other tabs are told to re-read over a BroadcastChannel.
 *
 * Trust comes only from what the device already holds: the persisted trust store (empty — nothing
 * trusted — when the device has none) or build-supplied anchors. It changes only through signed SP2
 * rotation and revocation statements. There is no "trust this publisher" button.
 */
export const SPACE_RUNTIME_VERSION = "1.0.0";
export const LIFECYCLE_LOCK = "digiconomy-space-lifecycle";
const CHANNEL = "digiconomy-space-lifecycle";
const LOCK_WAIT_MS = 15_000;

export function emptyTrustStore(): TrustStore {
  return { schema: TRUST_STORE_SCHEMA, policyVersion: TRUST_POLICY_VERSION, publishers: [], authorities: [], transitions: [] };
}

export interface InstallationHealth {
  packageId: string;
  status: "HEALTHY" | "RECOVERY_REQUIRED" | "MISSING_RELEASE" | "MISSING_STATE";
  missing: string[];
  reason: string | null;
}

export class BrowserSpaceRuntime {
  readonly lifecycle: SpaceLifecycle;
  private trust: TrustStore;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<() => void>();

  private constructor(readonly backend: IndexedDbLifecycleBackend, readonly support: PlatformSupport, trust: TrustStore, private readonly options: { now: () => Date; runtimeVersion: string }) {
    this.trust = trust;
    this.lifecycle = new SpaceLifecycle(backend, { trust: () => this.trust, runtime: { version: options.runtimeVersion }, now: options.now });
    if (support.broadcastChannel) {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = () => { void this.reloadTrust().finally(() => this.listeners.forEach((listener) => listener())); };
    }
  }

  static async create(options: { factory?: IDBFactory; bundledTrust?: TrustStore | null; now?: () => Date; runtimeVersion?: string } = {}): Promise<BrowserSpaceRuntime> {
    const support = await detectPlatformSupport();
    if (!support.indexedDb) throw new SpacePackageError("UNSUPPORTED_PLATFORM", support.missing.join("; "));
    const backend = new IndexedDbLifecycleBackend(options.factory ?? indexedDB);
    const trust = (await backend.readTrust()) ?? options.bundledTrust ?? emptyTrustStore();
    return new BrowserSpaceRuntime(backend, support, trust, { now: options.now ?? (() => new Date()), runtimeVersion: options.runtimeVersion ?? SPACE_RUNTIME_VERSION });
  }

  get trustStore(): TrustStore { return this.trust; }
  get canMutate(): boolean { return this.support.canInstall; }
  now(): Date { return this.options.now(); }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async reloadTrust() {
    this.trust = (await this.backend.readTrust()) ?? this.trust;
  }

  /** Runs one lifecycle mutation under the cross-tab lock; refuses when safe coordination is impossible. */
  async mutate<T>(work: () => Promise<T>): Promise<T> {
    if (!this.support.canInstall) throw new SpacePackageError("UNSUPPORTED_PLATFORM", `This browser cannot change installed Spaces safely: ${this.support.missing.join("; ")}.`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOCK_WAIT_MS);
    try {
      return await navigator.locks.request(LIFECYCLE_LOCK, { mode: "exclusive", signal: controller.signal }, async () => {
        clearTimeout(timer);
        await this.reloadTrust();
        try {
          return await work();
        } finally {
          this.channel?.postMessage({ type: "changed" });
          this.listeners.forEach((listener) => listener());
        }
      });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") throw new SpacePackageError("LIFECYCLE_BUSY", "Another tab is changing installed Spaces. Try again in a moment.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ───────────── identification and verification ───────────── */

  detect(bytes: Uint8Array): SpaceFileKind {
    return detectSpaceFormat(bytes);
  }

  async assess(bytes: Uint8Array): Promise<PackageAssessment> {
    if (!this.support.canVerify) throw new SpacePackageError("UNSUPPORTED_PLATFORM", this.support.missing.join("; "));
    await this.reloadTrust();
    const installed = [];
    for (const id of await this.backend.listPackageIds()) {
      const record = await this.backend.readRecord(id);
      if (record) installed.push({ packageId: record.packageId, version: record.active.version, packageDigest: record.active.packageDigest });
    }
    return assessPackage(bytes, { trust: this.trust, runtime: { version: this.options.runtimeVersion }, installed, now: this.now() });
  }

  /* ───────────── lifecycle (each under the lock) ───────────── */

  install(bytes: Uint8Array) {
    return this.mutate(async () => {
      if (this.support.persistentStorage) await navigator.storage.persist().catch(() => false);
      const result = await this.lifecycle.install(bytes);
      if (result.status === "ALREADY_INSTALLED") {
        // Re-importing the identical package restores release parts this device lost. The bytes are
        // verified again and must carry the installed digest; local state is never touched here.
        const record = await this.lifecycle.record(result.record.packageId);
        if ((await this.backend.missingReleaseParts(record.packageId, record.active.packageDigest)).length) {
          const verified = await verifySpacePackage(bytes, { publishers: publishersFor(this.trust, "INSTALLED_RELEASE"), runtime: { version: this.options.runtimeVersion } });
          if (verified.packageDigest !== record.active.packageDigest) throw new SpacePackageError("INSTALLED_VERSION_CONFLICT", "not the installed release");
          await this.backend.putRelease(record.packageId, record.active.packageDigest, { artifact: bytes, assets: verified.assets });
          return { ...result, repaired: true as const };
        }
      }
      return result;
    });
  }
  open(packageId: string, online: boolean) { return this.mutate(() => this.lifecycle.open(packageId, { environment: { online } })); }
  recover() { return this.mutate(() => this.lifecycle.recoverAll()); }
  stageUpdate(updateBytes: Uint8Array, packageBytes: Uint8Array) { return this.mutate(() => this.lifecycle.stageUpdate(updateBytes, packageBytes)); }
  inspectUpdate(updateBytes: Uint8Array, packageBytes: Uint8Array, approved: readonly PackagePermission[]) {
    return this.lifecycle.inspectUpdate(updateBytes, packageBytes, { approvedPermissions: approved });
  }
  verifyUpdate(packageId: string, txId: string, approved: readonly PackagePermission[]) { return this.mutate(() => this.lifecycle.verifyUpdate(packageId, txId, { approvedPermissions: approved })); }
  activateUpdate(packageId: string, txId: string) {
    return this.mutate(async () => {
      const tx = await this.lifecycle.transaction(packageId, txId);
      if (tx.state === "VERIFIED") await this.lifecycle.prepareMigration(packageId, txId);
      return this.lifecycle.activate(packageId, txId);
    });
  }
  abortUpdate(packageId: string, txId: string) { return this.mutate(() => this.lifecycle.abortUpdate(packageId, txId)); }
  rollback(packageId: string, reason: string, launchFailed: boolean) { return this.mutate(() => this.lifecycle.rollback(packageId, reason, { launchFailed })); }
  writeState(packageId: string, change: (state: LocalState) => LocalState) { return this.mutate(() => this.lifecycle.writeState(packageId, change)); }

  /** Applies a signed SP2 key rotation or revocation list. Anything else is refused. */
  applyTrustStatement(bytes: Uint8Array) {
    return this.mutate(async () => {
      let statement: { format?: string };
      try {
        statement = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        throw new SpacePackageError("UNSUPPORTED_FORMAT", "not a signed trust statement");
      }
      let next: TrustStore;
      if (statement?.format === "digiconomy.space-key-revocations") next = await applyRevocationList(this.trust, statement as RevocationList, this.now());
      else if (statement?.format === "digiconomy.space-key-rotation") next = await applyKeyRotation(this.trust, statement as KeyRotationStatement);
      else throw new SpacePackageError("UNSUPPORTED_FORMAT", "only signed key rotations and revocation lists change trust");
      await this.backend.writeTrust(next);
      this.trust = next;
      return { kind: statement.format === "digiconomy.space-key-revocations" ? "REVOCATION" as const : "ROTATION" as const, trust: next };
    });
  }

  /* ───────────── reads ───────────── */

  async installations() {
    const out = [];
    for (const id of await this.backend.listPackageIds()) { const record = await this.backend.readRecord(id); if (record) out.push(record); }
    return out;
  }

  /** Never reports an installation as healthy when its release artifact, assets or state are missing. */
  async health(packageId: string): Promise<InstallationHealth> {
    const record = await this.lifecycle.record(packageId);
    if (record.status === "RECOVERY_REQUIRED") return { packageId, status: "RECOVERY_REQUIRED", missing: [], reason: record.statusReason };
    const missing = await this.backend.missingReleaseParts(packageId, record.active.packageDigest);
    if (missing.length) return { packageId, status: "MISSING_RELEASE", missing, reason: "Parts of the installed release are missing from this device's storage." };
    if (!(await this.backend.readState(packageId, "current"))) return { packageId, status: "MISSING_STATE", missing: ["state"], reason: "This installation's local state is missing." };
    return { packageId, status: "HEALTHY", missing: [], reason: null };
  }

  async storageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if (!this.support.storageEstimate) return null;
    const estimate = await navigator.storage.estimate().catch(() => null);
    return estimate ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 } : null;
  }

  close() {
    this.channel?.close();
    this.backend.close();
  }
}
