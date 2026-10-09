import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { SpacePackageError } from "./format.js";
import { INSTALLATION_SCHEMA, type InstallationRecord, type InstallationStore, type StagingArea } from "./install.js";
import { checkSafePath } from "./zip.js";

/**
 * Filesystem installation store for a local Space Runtime.
 *
 *   <root>/installations/<packageId>/package.space      the immutable, verified artifact (as received)
 *   <root>/installations/<packageId>/installation.json  local installation state (no owner, no grants)
 *   <root>/installations/<packageId>/assets/content/…   verified assets, re-hashed on every open
 *   <root>/.staging/<uuid>/                             an import in progress
 *
 * Commit is one directory rename, so an installation is either complete or absent. Anything left
 * in .staging by a crash is discarded by recover() before the next import.
 */
export class FileInstallationStore implements InstallationStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private installationsDir() {
    return join(this.root, "installations");
  }
  private stagingDir() {
    return join(this.root, ".staging");
  }
  private installationDir(packageId: string) {
    checkSafePath(packageId);
    if (packageId.includes("/")) throw new SpacePackageError("UNSAFE_PATH", packageId);
    return join(this.installationsDir(), packageId);
  }
  /** Resolves an archive path under a base directory, refusing anything that escapes it. */
  private inside(base: string, path: string) {
    checkSafePath(path);
    const target = resolve(base, ...path.split("/"));
    if (!target.startsWith(resolve(base) + sep)) throw new SpacePackageError("UNSAFE_PATH", path);
    return target;
  }

  async list() {
    let names: string[] = [];
    try {
      names = await readdir(this.installationsDir());
    } catch {
      return [];
    }
    const records: InstallationRecord[] = [];
    for (const name of names.sort()) {
      const record = await this.get(name).catch(() => null);
      if (record) records.push(record);
    }
    return records;
  }

  async get(packageId: string) {
    try {
      const record = JSON.parse(await readFile(join(this.installationDir(packageId), "installation.json"), "utf8")) as InstallationRecord;
      if (record.schema !== INSTALLATION_SCHEMA || record.packageId !== packageId) throw new SpacePackageError("INSTALLATION_CORRUPT", packageId);
      return record;
    } catch (error) {
      if (error instanceof SpacePackageError) throw error;
      return null;
    }
  }

  async readAsset(packageId: string, path: string) {
    return new Uint8Array(await readFile(this.inside(join(this.installationDir(packageId), "assets"), path)));
  }

  async readArtifact(integrityRoot: string) {
    for (const record of await this.list()) {
      if (record.integrityRoot === integrityRoot) return new Uint8Array(await readFile(join(this.installationDir(record.packageId), "package.space")));
    }
    throw new SpacePackageError("NOT_INSTALLED", integrityRoot);
  }

  async stage(packageId: string): Promise<StagingArea> {
    const finalDir = this.installationDir(packageId);
    const dir = join(this.stagingDir(), crypto.randomUUID());
    await mkdir(join(dir, "assets"), { recursive: true });
    const write = async (path: string, bytes: Uint8Array | string) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" });
    };
    return {
      writeArtifact: async (_root, bytes) => write(join(dir, "package.space"), bytes),
      writeAsset: async (path, bytes) => write(this.inside(join(dir, "assets"), path), bytes),
      writeRecord: async (record) => write(join(dir, "installation.json"), `${JSON.stringify(record, null, 2)}\n`),
      commit: async () => {
        await mkdir(this.installationsDir(), { recursive: true });
        try {
          await rename(dir, finalDir);
        } catch {
          throw new SpacePackageError("ALREADY_INSTALLED", packageId);
        }
      },
      abort: async () => rm(dir, { recursive: true, force: true }),
    };
  }

  async recover() {
    let names: string[] = [];
    try {
      names = await readdir(this.stagingDir());
    } catch {
      return { discardedStaging: 0 };
    }
    for (const name of names) await rm(join(this.stagingDir(), name), { recursive: true, force: true });
    return { discardedStaging: names.length };
  }
}
