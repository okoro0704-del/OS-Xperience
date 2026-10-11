import { RECORD_SCHEMA, type LifecycleBackend, type SpaceRecord, type StateSlot, type UpdateTransaction } from "./backend.js";
import { SpacePackageError } from "./format.js";
import type { LocalState } from "./state.js";
import { parseTrustStore, type TrustStore } from "./trust.js";

/**
 * SP3 browser storage for the SP2 lifecycle engine: one IndexedDB database, separate object stores.
 *
 *   records       installation records (the commit point)            key: packageId
 *   releases      release metadata (artifact Blob)                    key: packageId␀digest
 *   assets        verified asset Blobs                                key: packageId␀digest␀path
 *   states        local state slots (current / next-tx / snapshot-tx) key: packageId␀slot
 *   transactions  durable update transactions                         key: packageId␀txId
 *   staging       downloaded bytes, invisible until verified          key: txId␀name
 *   trust         the persisted trust store                           key: "trust-store"
 *
 * Every method is one IndexedDB transaction over exactly the stores it touches, so each commit-critical
 * operation (record write, release write, installation creation, state promotion) is all-or-nothing,
 * the same guarantee the filesystem backend gets from temp-file + rename. Commit-critical writes ask
 * for strict durability. Quota exhaustion is reported as STORAGE_QUOTA_EXCEEDED, never swallowed.
 */
export const SPACE_PACKAGES_DB = "digiconomy-space-packages";
export const SPACE_PACKAGES_DB_VERSION = 1;
export const SPACE_PACKAGE_STORES = ["records", "releases", "assets", "states", "transactions", "staging", "trust"] as const;
const STORES = SPACE_PACKAGE_STORES;
type StoreName = (typeof STORES)[number];
const SEP = "\u0000";

type ReleaseRow = { key: string; packageId: string; digest: string; artifact: Blob; paths: string[] };
type AssetRow = { key: string; bytes: Blob };
type StateRow = { key: string; state: LocalState };
type TxRow = { key: string; tx: UpdateTransaction };
type StagingRow = { key: string; txId: string; bytes: Blob };

const blobOf = (bytes: Uint8Array) => new Blob([bytes.slice() as BlobPart]);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const prefixRange = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`);

function storageError(error: unknown): SpacePackageError {
  const name = (error as { name?: string } | null)?.name;
  if (name === "QuotaExceededError") return new SpacePackageError("STORAGE_QUOTA_EXCEEDED", "this device has no room left for the Space");
  return new SpacePackageError("STORAGE_UNAVAILABLE", name ?? String(error));
}

export class IndexedDbLifecycleBackend implements LifecycleBackend {
  private db: Promise<IDBDatabase> | null = null;
  constructor(readonly factory: IDBFactory = indexedDB, readonly name = SPACE_PACKAGES_DB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const request = this.factory.open(this.name, SPACE_PACKAGES_DB_VERSION);
        request.onupgradeneeded = () => {
          for (const store of STORES) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: "key" });
        };
        request.onsuccess = () => {
          const db = request.result;
          // Another tab upgrading the schema: close so it can proceed; the next call reopens.
          db.onversionchange = () => { db.close(); this.db = null; };
          resolve(db);
        };
        request.onerror = () => { this.db = null; reject(storageError(request.error)); };
        request.onblocked = () => { this.db = null; reject(new SpacePackageError("STORAGE_UNAVAILABLE", "database upgrade blocked by another tab")); };
      });
    }
    return this.db;
  }

  /** Runs `work` in one transaction and resolves only after it has committed. */
  private async tx<T>(stores: readonly StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => T | Promise<T>, strict = false): Promise<T> {
    const db = await this.open();
    let transaction: IDBTransaction;
    try {
      transaction = (db.transaction as (names: string[], mode: IDBTransactionMode, options?: { durability: string }) => IDBTransaction)([...stores], mode, strict ? { durability: "strict" } : undefined);
    } catch (error) {
      throw storageError(error);
    }
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(storageError(transaction.error));
      transaction.onerror = () => reject(storageError(transaction.error));
    });
    let result: T;
    try {
      result = await work(transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* already finished */ }
      await done.catch(() => undefined);
      throw error instanceof SpacePackageError ? error : storageError(error);
    }
    await done;
    return result;
  }

  private request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /* ───────────── records ───────────── */

  async listPackageIds() {
    return this.tx(["records"], "readonly", async (tx) => ((await this.request(tx.objectStore("records").getAllKeys())) as string[]).sort());
  }
  async readRecord(packageId: string) {
    const row = await this.tx(["records"], "readonly", (tx) => this.request(tx.objectStore("records").get(packageId)) as Promise<{ key: string; record: SpaceRecord } | undefined>);
    if (!row) return null;
    if (row.record.schema !== RECORD_SCHEMA || row.record.packageId !== packageId) throw new SpacePackageError("INSTALLATION_CORRUPT", packageId);
    return structuredClone(row.record);
  }
  async writeRecord(record: SpaceRecord) {
    await this.tx(["records"], "readwrite", (tx) => this.request(tx.objectStore("records").put({ key: record.packageId, record: structuredClone(record) })), true);
  }
  async createInstallation(record: SpaceRecord, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }, state: LocalState) {
    await this.tx(["records", "releases", "assets", "states"], "readwrite", async (tx) => {
      if (await this.request(tx.objectStore("records").get(record.packageId))) throw new SpacePackageError("ALREADY_INSTALLED", record.packageId);
      this.writeReleaseRows(tx, record.packageId, record.active.packageDigest, release);
      tx.objectStore("states").put({ key: `${record.packageId}${SEP}current`, state: structuredClone(state) } satisfies StateRow);
      tx.objectStore("records").put({ key: record.packageId, record: structuredClone(record) });
    }, true);
  }

  /* ───────────── releases ───────────── */

  private writeReleaseRows(tx: IDBTransaction, packageId: string, digest: string, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }) {
    const base = `${packageId}${SEP}${digest}`;
    tx.objectStore("releases").put({ key: base, packageId, digest, artifact: blobOf(release.artifact), paths: [...release.assets.keys()] } satisfies ReleaseRow);
    for (const [path, bytes] of release.assets) tx.objectStore("assets").put({ key: `${base}${SEP}${path}`, bytes: blobOf(bytes) } satisfies AssetRow);
  }
  async putRelease(packageId: string, digest: string, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }) {
    await this.tx(["releases", "assets"], "readwrite", async (tx) => {
      // Idempotent: a complete release is left alone; an incomplete one (lost rows) is rewritten from
      // the verified bytes the caller holds for exactly this digest.
      const row = (await this.request(tx.objectStore("releases").get(`${packageId}${SEP}${digest}`))) as ReleaseRow | undefined;
      if (row) {
        const keys = new Set((await this.request(tx.objectStore("assets").getAllKeys(prefixRange(`${packageId}${SEP}${digest}${SEP}`)))) as string[]);
        if (row.paths.every((path) => keys.has(`${packageId}${SEP}${digest}${SEP}${path}`))) return;
      }
      this.writeReleaseRows(tx, packageId, digest, release);
    }, true);
  }
  async hasRelease(packageId: string, digest: string) {
    return this.tx(["releases", "assets"], "readonly", async (tx) => {
      const row = (await this.request(tx.objectStore("releases").get(`${packageId}${SEP}${digest}`))) as ReleaseRow | undefined;
      if (!row) return false;
      // A release counts only when every asset it lists is present.
      const keys = new Set((await this.request(tx.objectStore("assets").getAllKeys(prefixRange(`${packageId}${SEP}${digest}${SEP}`)))) as string[]);
      return row.paths.every((path) => keys.has(`${packageId}${SEP}${digest}${SEP}${path}`));
    });
  }
  async deleteRelease(packageId: string, digest: string) {
    await this.tx(["releases", "assets"], "readwrite", (tx) => {
      tx.objectStore("releases").delete(`${packageId}${SEP}${digest}`);
      tx.objectStore("assets").delete(prefixRange(`${packageId}${SEP}${digest}${SEP}`));
    });
  }
  async readReleaseAsset(packageId: string, digest: string, path: string) {
    const row = await this.tx(["assets"], "readonly", (tx) => this.request(tx.objectStore("assets").get(`${packageId}${SEP}${digest}${SEP}${path}`)) as Promise<AssetRow | undefined>);
    if (!row) throw new SpacePackageError("INSTALLATION_CORRUPT", `missing ${path}`);
    return bytesOf(row.bytes);
  }
  async readReleaseArtifact(packageId: string, digest: string) {
    const row = await this.tx(["releases"], "readonly", (tx) => this.request(tx.objectStore("releases").get(`${packageId}${SEP}${digest}`)) as Promise<ReleaseRow | undefined>);
    if (!row) throw new SpacePackageError("INSTALLATION_CORRUPT", `missing release ${digest}`);
    return bytesOf(row.artifact);
  }

  /* ───────────── state ───────────── */

  async readState(packageId: string, slot: StateSlot) {
    const row = await this.tx(["states"], "readonly", (tx) => this.request(tx.objectStore("states").get(`${packageId}${SEP}${slot}`)) as Promise<StateRow | undefined>);
    return row ? structuredClone(row.state) : null;
  }
  async writeState(packageId: string, slot: StateSlot, state: LocalState) {
    await this.tx(["states"], "readwrite", (tx) => this.request(tx.objectStore("states").put({ key: `${packageId}${SEP}${slot}`, state: structuredClone(state) })), slot === "current");
  }
  async deleteState(packageId: string, slot: StateSlot) {
    await this.tx(["states"], "readwrite", (tx) => this.request(tx.objectStore("states").delete(`${packageId}${SEP}${slot}`)));
  }
  async promoteState(packageId: string, slot: StateSlot) {
    // get + put + delete in one transaction: readers see the old or the new state, never neither.
    await this.tx(["states"], "readwrite", async (tx) => {
      const store = tx.objectStore("states");
      const row = (await this.request(store.get(`${packageId}${SEP}${slot}`))) as StateRow | undefined;
      if (!row) return;
      store.put({ key: `${packageId}${SEP}current`, state: row.state });
      store.delete(`${packageId}${SEP}${slot}`);
    }, true);
  }

  /* ───────────── transactions ───────────── */

  async writeTransaction(transaction: UpdateTransaction) {
    await this.tx(["transactions"], "readwrite", (tx) => this.request(tx.objectStore("transactions").put({ key: `${transaction.packageId}${SEP}${transaction.txId}`, tx: structuredClone(transaction) })), true);
  }
  async readTransaction(packageId: string, txId: string) {
    const row = await this.tx(["transactions"], "readonly", (tx) => this.request(tx.objectStore("transactions").get(`${packageId}${SEP}${txId}`)) as Promise<TxRow | undefined>);
    return row ? structuredClone(row.tx) : null;
  }
  async listTransactions(packageId: string) {
    const rows = await this.tx(["transactions"], "readonly", (tx) => this.request(tx.objectStore("transactions").getAll(prefixRange(`${packageId}${SEP}`))) as Promise<TxRow[]>);
    return rows.map((row) => structuredClone(row.tx));
  }

  /* ───────────── staging ───────────── */

  async stageWrite(txId: string, name: string, bytes: Uint8Array) {
    await this.tx(["staging"], "readwrite", (tx) => this.request(tx.objectStore("staging").put({ key: `${txId}${SEP}${name}`, txId, bytes: blobOf(bytes) } satisfies StagingRow)));
  }
  async stageRead(txId: string, name: string) {
    const row = await this.tx(["staging"], "readonly", (tx) => this.request(tx.objectStore("staging").get(`${txId}${SEP}${name}`)) as Promise<StagingRow | undefined>);
    return row ? bytesOf(row.bytes) : null;
  }
  async stageDrop(txId: string) {
    await this.tx(["staging"], "readwrite", (tx) => this.request(tx.objectStore("staging").delete(prefixRange(`${txId}${SEP}`))));
  }
  async stageList() {
    const keys = await this.tx(["staging"], "readonly", (tx) => this.request(tx.objectStore("staging").getAllKeys()) as Promise<string[]>);
    return [...new Set(keys.map((key) => key.split(SEP)[0]!))];
  }

  /* ───────────── trust ───────────── */

  /** The persisted trust store, or null when this device has none (nothing is trusted). */
  async readTrust(): Promise<TrustStore | null> {
    const row = await this.tx(["trust"], "readonly", (tx) => this.request(tx.objectStore("trust").get("trust-store")) as Promise<{ key: string; trust: unknown } | undefined>);
    return row ? parseTrustStore(row.trust) : null;
  }
  async writeTrust(trust: TrustStore): Promise<void> {
    await this.tx(["trust"], "readwrite", (tx) => this.request(tx.objectStore("trust").put({ key: "trust-store", trust: structuredClone(parseTrustStore(trust)) })), true);
  }

  /** Releases whose metadata exists but whose artifact or assets are missing (eviction, corruption). */
  async missingReleaseParts(packageId: string, digest: string): Promise<string[]> {
    return this.tx(["releases", "assets"], "readonly", async (tx) => {
      const row = (await this.request(tx.objectStore("releases").get(`${packageId}${SEP}${digest}`))) as ReleaseRow | undefined;
      if (!row) return ["package.space"];
      const keys = new Set((await this.request(tx.objectStore("assets").getAllKeys(prefixRange(`${packageId}${SEP}${digest}${SEP}`)))) as string[]);
      return row.paths.filter((path) => !keys.has(`${packageId}${SEP}${digest}${SEP}${path}`));
    });
  }

  close() {
    void this.db?.then((db) => db.close()).catch(() => undefined);
    this.db = null;
  }
}
