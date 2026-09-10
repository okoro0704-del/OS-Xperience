import {
  jsonLeaksSecrets,
  pushRecent,
  toggleFavorite,
  type FavoriteApp,
  type RecentApp,
} from "@osshell/contract";

export class ClientRecentStore {
  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly key = "os-shell.recents",
  ) {}

  load(): RecentApp[] {
    return readList<RecentApp>(this.storage, this.key);
  }

  save(list: readonly RecentApp[]): void {
    if (jsonLeaksSecrets(list)) throw new Error("Recents must not contain credentials.");
    this.storage.setItem(this.key, JSON.stringify(list));
  }

  remember(entry: RecentApp): RecentApp[] {
    const next = pushRecent(this.load(), entry);
    this.save(next);
    return next;
  }
}

export class ClientFavoriteStore {
  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly key = "os-shell.favorites",
  ) {}

  load(): FavoriteApp[] {
    return readList<FavoriteApp>(this.storage, this.key);
  }

  save(list: readonly FavoriteApp[]): void {
    if (jsonLeaksSecrets(list)) throw new Error("Favorites must not contain credentials.");
    this.storage.setItem(this.key, JSON.stringify(list));
  }

  toggle(item: FavoriteApp): FavoriteApp[] {
    const next = toggleFavorite(this.load(), item);
    this.save(next);
    return next;
  }
}

function readList<T>(storage: Pick<Storage, "getItem">, key: string): T[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as T[];
    if (!Array.isArray(parsed) || jsonLeaksSecrets(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}
