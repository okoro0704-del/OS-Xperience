import { SpacePackageError } from "./format.js";
import type { InstallationRecord, InstallationStore, StagingArea } from "./install.js";

/** In-memory installation store (tests, ephemeral runtimes). Staging is invisible until commit. */
export class MemoryInstallationStore implements InstallationStore {
  readonly installations = new Map<string, { record: InstallationRecord; assets: Map<string, Uint8Array>; artifact: Uint8Array }>();
  /** Staging left behind by an interrupted import (a crash that never reached commit or abort). */
  readonly staging = new Set<object>();

  async list() {
    return [...this.installations.values()].map((item) => item.record);
  }
  async get(packageId: string) {
    return this.installations.get(packageId)?.record ?? null;
  }
  async readAsset(packageId: string, path: string) {
    const bytes = this.installations.get(packageId)?.assets.get(path);
    if (!bytes) throw new SpacePackageError("INSTALLATION_CORRUPT", path);
    return bytes.slice();
  }
  async readArtifact(integrityRoot: string) {
    const hit = [...this.installations.values()].find((item) => item.record.integrityRoot === integrityRoot);
    if (!hit) throw new SpacePackageError("NOT_INSTALLED", integrityRoot);
    return hit.artifact.slice();
  }
  async stage(packageId: string): Promise<StagingArea> {
    const pending = { assets: new Map<string, Uint8Array>(), artifact: null as Uint8Array | null, record: null as InstallationRecord | null };
    this.staging.add(pending);
    return {
      writeArtifact: async (_root, bytes) => { pending.artifact = bytes.slice(); },
      writeAsset: async (path, bytes) => { pending.assets.set(path, bytes.slice()); },
      writeRecord: async (record) => { pending.record = structuredClone(record); },
      commit: async () => {
        if (!pending.record || !pending.artifact) throw new SpacePackageError("IMPORT_INTERRUPTED", "incomplete staging");
        if (this.installations.has(packageId)) throw new SpacePackageError("ALREADY_INSTALLED", packageId);
        this.installations.set(packageId, { record: pending.record, assets: pending.assets, artifact: pending.artifact });
        this.staging.delete(pending);
      },
      abort: async () => { this.staging.delete(pending); },
    };
  }
  async recover() {
    const discardedStaging = this.staging.size;
    this.staging.clear();
    return { discardedStaging };
  }
}
