import { jsonLeaksSecrets } from "@osshell/contract";

const KEY = "os-shell.objective-history.v1";
const FAVORITES_KEY = "os-shell.objective-favorites.v1";

/** Shell-owned recent objectives. Not shared with applications. */
export class ClientObjectiveHistoryStore {
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

  remember(label: string): string[] {
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 160) return this.load();
    const next = [trimmed, ...this.load().filter((item) => item !== trimmed)].slice(0, 12);
    this.storage.setItem(KEY, JSON.stringify(next));
    return next;
  }

  clear(): void {
    this.storage.removeItem(KEY);
  }

  favorites(): string[] {
    const raw = this.storage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8);
    } catch {
      return [];
    }
  }

  toggleFavorite(label: string): string[] {
    const trimmed = label.trim();
    if (!trimmed) return this.favorites();
    const current = this.favorites();
    const next = current.includes(trimmed)
      ? current.filter((item) => item !== trimmed)
      : [trimmed, ...current].slice(0, 8);
    this.storage.setItem(FAVORITES_KEY, JSON.stringify(next));
    return next;
  }
}
