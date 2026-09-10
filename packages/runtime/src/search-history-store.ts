import { jsonLeaksSecrets } from "@osshell/contract";

const KEY = "os-shell.search-history.v1";

/** Shell-owned recent search queries. Not shared with applications. */
export class ClientSearchHistoryStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  load(): string[] {
    const raw = this.storage.getItem(KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 12);
    } catch {
      return [];
    }
  }

  remember(query: string): string[] {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 200) return this.load();
    const next = [trimmed, ...this.load().filter((item) => item !== trimmed)].slice(0, 12);
    this.storage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  clear(): void {
    this.storage.removeItem(KEY);
  }
}
