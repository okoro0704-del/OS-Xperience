import {
  jsonLeaksSecrets,
  seedApplicationCatalog,
  upsertInstalledApplication,
  removeInstalledApplication,
  type OSShellApplicationRecord,
} from "@osshell/contract";

const KEY = "os-shell.applications.v1";

/** Client-side application registry. Not a backend, store, or marketplace. */
export class ClientApplicationStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  load(seedIfEmpty = true): OSShellApplicationRecord[] {
    const raw = this.storage.getItem(KEY);
    if (!raw) {
      const seeded = seedIfEmpty ? seedApplicationCatalog() : [];
      if (seeded.length) this.save(seeded);
      return seeded;
    }
    try {
      const parsed = JSON.parse(raw) as OSShellApplicationRecord[];
      if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed)) {
        const seeded = seedIfEmpty ? seedApplicationCatalog() : [];
        if (seeded.length) this.save(seeded);
        return seeded;
      }
      return parsed.filter(
        (item) =>
          item &&
          typeof item.appId === "string" &&
          typeof item.origin === "string" &&
          typeof item.name === "string" &&
          typeof item.version === "string",
      );
    } catch {
      const seeded = seedIfEmpty ? seedApplicationCatalog() : [];
      if (seeded.length) this.save(seeded);
      return seeded;
    }
  }

  save(records: readonly OSShellApplicationRecord[]): void {
    if (jsonLeaksSecrets(records)) throw new Error("Application registry must not contain credentials.");
    this.storage.setItem(KEY, JSON.stringify(records));
  }

  install(records: readonly OSShellApplicationRecord[], next: OSShellApplicationRecord) {
    const result = upsertInstalledApplication(records, next);
    if (result.ok) this.save(result.list);
    return result;
  }

  remove(records: readonly OSShellApplicationRecord[], appId: string) {
    const result = removeInstalledApplication(records, appId);
    this.save(result.list);
    return result;
  }
}
