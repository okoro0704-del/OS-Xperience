import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { RECORD_SCHEMA, type LifecycleBackend, type SpaceRecord, type StateSlot, type UpdateTransaction } from "./backend.js";
import { SpacePackageError } from "./format.js";
import type { LocalState } from "./state.js";
import { checkSafePath } from "./zip.js";

/**
 * Filesystem lifecycle backend for a local Space Runtime.
 *
 *   <root>/installations/<packageId>/record.json                   installation record (atomic replace)
 *   <root>/installations/<packageId>/releases/<digest>/package.space  immutable verified artifact
 *   <root>/installations/<packageId>/releases/<digest>/assets/…      verified assets
 *   <root>/installations/<packageId>/state/<slot>.json              current | next-<tx> | snapshot-<tx>
 *   <root>/installations/<packageId>/journal/<txId>.json            durable update transactions
 *   <root>/.staging/<txId>/…                                        downloads and release builds in progress
 *
 * Documents are written to a temporary file and renamed over the target (atomic on the same volume);
 * releases and new installations are built in .staging and moved into place with one directory rename.
 */
export class FileLifecycleBackend implements LifecycleBackend {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private installations() { return join(this.root, "installations"); }
  private staging() { return join(this.root, ".staging"); }
  private dir(packageId: string) {
    checkSafePath(packageId);
    if (packageId.includes("/")) throw new SpacePackageError("UNSAFE_PATH", packageId);
    return join(this.installations(), packageId);
  }
  private digestDir(packageId: string, digest: string) {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new SpacePackageError("UNSAFE_PATH", digest);
    return join(this.dir(packageId), "releases", digest);
  }
  private inside(base: string, path: string) {
    checkSafePath(path);
    const target = resolve(base, ...path.split("/"));
    if (!target.startsWith(resolve(base) + sep)) throw new SpacePackageError("UNSAFE_PATH", path);
    return target;
  }
  private slotFile(packageId: string, slot: StateSlot) {
    if (!/^(current|next-[A-Za-z0-9-]{1,64}|snapshot-[A-Za-z0-9-]{1,64})$/.test(slot)) throw new SpacePackageError("UNSAFE_PATH", slot);
    return join(this.dir(packageId), "state", `${slot}.json`);
  }
  private txFile(packageId: string, txId: string) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(txId)) throw new SpacePackageError("UNSAFE_PATH", txId);
    return join(this.dir(packageId), "journal", `${txId}.json`);
  }

  /** Write-to-temp, then rename over the target: readers see the old or the new document, never a mix. */
  private async atomicWrite(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, text);
    await rename(temp, path);
  }
  private async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      return null;
    }
  }
  private async exists(path: string) {
    try { await stat(path); return true; } catch { return false; }
  }
  private async buildRelease(base: string, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }) {
    await mkdir(join(base, "assets"), { recursive: true });
    await writeFile(join(base, "package.space"), release.artifact, { flag: "wx" });
    for (const [path, bytes] of release.assets) {
      const target = this.inside(join(base, "assets"), path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
  }

  async listPackageIds() {
    try {
      const names = await readdir(this.installations());
      const ids: string[] = [];
      for (const name of names.sort()) if (await this.exists(join(this.installations(), name, "record.json"))) ids.push(name);
      return ids;
    } catch {
      return [];
    }
  }
  async readRecord(packageId: string) {
    const record = await this.readJson<SpaceRecord>(join(this.dir(packageId), "record.json"));
    if (record && (record.schema !== RECORD_SCHEMA || record.packageId !== packageId)) throw new SpacePackageError("INSTALLATION_CORRUPT", packageId);
    return record;
  }
  async writeRecord(record: SpaceRecord) {
    await this.atomicWrite(join(this.dir(record.packageId), "record.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
  async createInstallation(record: SpaceRecord, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }, state: LocalState) {
    const build = join(this.staging(), `install-${crypto.randomUUID()}`);
    try {
      await this.buildRelease(join(build, "releases", record.active.packageDigest), release);
      await mkdir(join(build, "state"), { recursive: true });
      await mkdir(join(build, "journal"), { recursive: true });
      await writeFile(join(build, "state", "current.json"), `${JSON.stringify(state, null, 2)}\n`);
      await writeFile(join(build, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
      await mkdir(this.installations(), { recursive: true });
      try {
        await rename(build, this.dir(record.packageId));
      } catch {
        throw new SpacePackageError("ALREADY_INSTALLED", record.packageId);
      }
    } catch (error) {
      await rm(build, { recursive: true, force: true });
      throw error;
    }
  }
  async putRelease(packageId: string, digest: string, release: { artifact: Uint8Array; assets: Map<string, Uint8Array> }) {
    const target = this.digestDir(packageId, digest);
    if (await this.exists(join(target, "package.space"))) return;
    const build = join(this.staging(), `release-${crypto.randomUUID()}`);
    try {
      await this.buildRelease(build, release);
      await mkdir(dirname(target), { recursive: true });
      await rm(target, { recursive: true, force: true }); // only a never-committed leftover can be here
      await rename(build, target);
    } catch (error) {
      await rm(build, { recursive: true, force: true });
      throw error;
    }
  }
  async hasRelease(packageId: string, digest: string) { return this.exists(join(this.digestDir(packageId, digest), "package.space")); }
  async deleteRelease(packageId: string, digest: string) { await rm(this.digestDir(packageId, digest), { recursive: true, force: true }); }
  async readReleaseAsset(packageId: string, digest: string, path: string) {
    return new Uint8Array(await readFile(this.inside(join(this.digestDir(packageId, digest), "assets"), path)));
  }
  async readReleaseArtifact(packageId: string, digest: string) {
    return new Uint8Array(await readFile(join(this.digestDir(packageId, digest), "package.space")));
  }
  async readState(packageId: string, slot: StateSlot) { return this.readJson<LocalState>(this.slotFile(packageId, slot)); }
  async writeState(packageId: string, slot: StateSlot, state: LocalState) { await this.atomicWrite(this.slotFile(packageId, slot), `${JSON.stringify(state, null, 2)}\n`); }
  async deleteState(packageId: string, slot: StateSlot) { await rm(this.slotFile(packageId, slot), { force: true }); }
  async promoteState(packageId: string, slot: StateSlot) {
    const from = this.slotFile(packageId, slot);
    if (!(await this.exists(from))) return;
    await rename(from, this.slotFile(packageId, "current"));
  }
  async writeTransaction(transaction: UpdateTransaction) {
    await this.atomicWrite(this.txFile(transaction.packageId, transaction.txId), `${JSON.stringify(transaction, null, 2)}\n`);
  }
  async readTransaction(packageId: string, txId: string) { return this.readJson<UpdateTransaction>(this.txFile(packageId, txId)); }
  async listTransactions(packageId: string) {
    try {
      const names = (await readdir(join(this.dir(packageId), "journal"))).filter((name) => name.endsWith(".json"));
      const out: UpdateTransaction[] = [];
      for (const name of names) { const tx = await this.readJson<UpdateTransaction>(join(this.dir(packageId), "journal", name)); if (tx) out.push(tx); }
      return out;
    } catch {
      return [];
    }
  }
  async stageWrite(txId: string, name: string, bytes: Uint8Array) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(txId) || !/^[A-Za-z0-9.-]{1,64}$/.test(name)) throw new SpacePackageError("UNSAFE_PATH", name);
    const path = join(this.staging(), txId, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  async stageRead(txId: string, name: string) {
    try { return new Uint8Array(await readFile(join(this.staging(), txId, name))); } catch { return null; }
  }
  async stageDrop(txId: string) { await rm(join(this.staging(), txId), { recursive: true, force: true }); }
  async stageList() {
    try { return await readdir(this.staging()); } catch { return []; }
  }
}
