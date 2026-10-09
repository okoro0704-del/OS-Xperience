/**
 * Space library: a Space's published content held on this installation, so the Space runs without
 * internet whether or not it broadcasts. TV is one optional experience of a Space; the library is
 * the content the Space always carries. Kernel state only — no route is ever needed to read it.
 */
export type LibraryItemKind = "VIDEO" | "AUDIO" | "IMAGE" | "OTHER";

export type LibraryItem = {
  itemId: string;
  title: string;
  description: string;
  kind: LibraryItemKind;
  contentType: string;
  byteLength: number;
  /** Publisher's version marker (e.g. its publish time); a changed version is re-acquired. */
  version: string;
  publishedAt: string | null;
  /** True only when the publisher supplied a checksum and the held bytes matched it. */
  integrityVerified: boolean;
};

export type SpaceLibrary = { spaceId: string; publisherId: string; syncedAt: string; items: readonly LibraryItem[] };

/** One entry of the publisher's catalog: what the item is and where its bytes live. */
export type LibraryCatalogEntry = Omit<LibraryItem, "byteLength" | "integrityVerified" | "contentType"> & {
  contentType?: string;
  checksum?: string | null;
  path: string;
};

export interface SpaceLibrarySource {
  fetchCatalog(spaceId: string): Promise<{ publisherId: string; entries: readonly LibraryCatalogEntry[] }>;
  fetchBytes(entry: LibraryCatalogEntry): Promise<{ bytes: Uint8Array; contentType: string | null }>;
}

export interface SpaceLibraryStore {
  loadLibrary(spaceId: string): Promise<SpaceLibrary | undefined>;
  saveLibrary(library: SpaceLibrary): Promise<void>;
  loadItemBytes(itemId: string): Promise<Uint8Array | undefined>;
  saveItemBytes(itemId: string, bytes: Uint8Array): Promise<void>;
  deleteLibrary?(spaceId: string): Promise<void>;
  deleteItemBytes?(itemId: string): Promise<void>;
}

export class MemorySpaceLibraryStore implements SpaceLibraryStore {
  libraries = new Map<string, SpaceLibrary>();
  bytes = new Map<string, Uint8Array>();
  async loadLibrary(spaceId: string) { return this.libraries.get(spaceId); }
  async saveLibrary(library: SpaceLibrary) { this.libraries.set(library.spaceId, library); }
  async loadItemBytes(itemId: string) { return this.bytes.get(itemId); }
  async saveItemBytes(itemId: string, bytes: Uint8Array) { this.bytes.set(itemId, bytes); }
  async deleteLibrary(spaceId: string) { this.libraries.delete(spaceId); }
  async deleteItemBytes(itemId: string) { this.bytes.delete(itemId); }
}

export type LibrarySyncResult = {
  /** SYNCED: every catalog item is held. PARTIAL: some are. UNAVAILABLE: the catalog could not be read (last held library kept). */
  state: "SYNCED" | "PARTIAL" | "EMPTY" | "UNAVAILABLE";
  available: number;
  acquiredItemIds: string[];
  failedItemIds: string[];
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** Items whose bytes this installation actually holds. */
export async function spaceLibraryItems(store: SpaceLibraryStore, spaceId: string): Promise<LibraryItem[]> {
  try {
    const library = await store.loadLibrary(spaceId);
    if (!library) return [];
    const held: LibraryItem[] = [];
    for (const item of library.items) if ((await store.loadItemBytes(item.itemId))?.byteLength) held.push(item);
    return held;
  } catch {
    return [];
  }
}

/**
 * Acquire the Space's published content. A catalog failure never replaces the last held library;
 * one item failing never discards the others; a checksum mismatch is refused, not stored.
 */
export async function syncSpaceLibrary(input: {
  spaceId: string;
  store: SpaceLibraryStore;
  source: SpaceLibrarySource;
  now: () => Date;
  maxItems?: number;
}): Promise<LibrarySyncResult> {
  const { spaceId, store, source } = input;
  let catalog: Awaited<ReturnType<SpaceLibrarySource["fetchCatalog"]>>;
  try {
    catalog = await source.fetchCatalog(spaceId);
  } catch {
    const held = await spaceLibraryItems(store, spaceId);
    return { state: "UNAVAILABLE", available: held.length, acquiredItemIds: [], failedItemIds: [] };
  }
  const previous = await store.loadLibrary(spaceId).catch(() => undefined);
  const entries = catalog.entries.slice(0, input.maxItems ?? catalog.entries.length);
  const items: LibraryItem[] = [];
  const acquiredItemIds: string[] = [];
  const failedItemIds: string[] = [];
  for (const entry of entries) {
    const known = previous?.items.find((item) => item.itemId === entry.itemId);
    const heldBytes = await store.loadItemBytes(entry.itemId).catch(() => undefined);
    if (known && known.version === entry.version && heldBytes?.byteLength) {
      items.push({ ...known, title: entry.title, description: entry.description, publishedAt: entry.publishedAt });
      continue;
    }
    try {
      const { bytes, contentType } = await source.fetchBytes(entry);
      if (!bytes.byteLength) throw new Error("EMPTY_MEDIA");
      const checksum = entry.checksum ?? null;
      const integrityVerified = checksum ? (await sha256(bytes)) === checksum : false;
      if (checksum && !integrityVerified) throw new Error("INTEGRITY_FAILED");
      await store.saveItemBytes(entry.itemId, bytes);
      items.push({
        itemId: entry.itemId,
        title: entry.title,
        description: entry.description,
        kind: entry.kind,
        contentType: contentType || entry.contentType || "application/octet-stream",
        byteLength: bytes.byteLength,
        version: entry.version,
        publishedAt: entry.publishedAt,
        integrityVerified,
      });
      acquiredItemIds.push(entry.itemId);
    } catch {
      failedItemIds.push(entry.itemId);
      // An older held copy keeps the Space usable until the new version arrives.
      if (known && heldBytes?.byteLength) items.push(known);
    }
  }
  await store.saveLibrary({ spaceId, publisherId: catalog.publisherId, syncedAt: input.now().toISOString(), items });
  // What the publisher no longer publishes leaves this installation too.
  const kept = new Set(items.map((item) => item.itemId));
  for (const item of previous?.items ?? []) if (!kept.has(item.itemId)) await store.deleteItemBytes?.(item.itemId);
  const available = items.length;
  const state = available === 0 ? (entries.length ? "PARTIAL" : "EMPTY") : failedItemIds.length ? "PARTIAL" : "SYNCED";
  return { state, available, acquiredItemIds, failedItemIds };
}

/** Removes a Space's library and every byte it held. */
export async function deleteSpaceLibrary(store: SpaceLibraryStore, spaceId: string): Promise<string[]> {
  const library = await store.loadLibrary(spaceId).catch(() => undefined);
  const removed: string[] = [];
  for (const item of library?.items ?? []) {
    await store.deleteItemBytes?.(item.itemId);
    removed.push(item.itemId);
  }
  await store.deleteLibrary?.(spaceId);
  return removed;
}

/**
 * Adopts content another transport already acquired (the Android background sync, later a nearby
 * device) into the Space's library. Same rules as a sync: a checksum, when given, must match; an
 * item already held at the same version is kept as is. `catalogItemIds`, when known, is the
 * publisher's current list — anything held but no longer published leaves the library.
 */
export async function adoptSpaceLibraryItems(input: {
  spaceId: string;
  publisherId: string;
  store: SpaceLibraryStore;
  now: () => Date;
  items: ReadonlyArray<{ entry: Omit<LibraryCatalogEntry, "path">; bytes: Uint8Array; contentType: string | null }>;
  catalogItemIds?: readonly string[];
}): Promise<{ adoptedItemIds: string[]; refusedItemIds: string[]; available: number }> {
  const previous = await input.store.loadLibrary(input.spaceId).catch(() => undefined);
  const byId = new Map((previous?.items ?? []).map((item) => [item.itemId, item] as const));
  const adoptedItemIds: string[] = [];
  const refusedItemIds: string[] = [];
  for (const { entry, bytes, contentType } of input.items) {
    const known = byId.get(entry.itemId);
    if (known && known.version === entry.version && (await input.store.loadItemBytes(entry.itemId).catch(() => undefined))?.byteLength) continue;
    const checksum = entry.checksum ?? null;
    const integrityVerified = checksum ? (await sha256(bytes)) === checksum : false;
    if (!bytes.byteLength || (checksum && !integrityVerified)) { refusedItemIds.push(entry.itemId); continue; }
    await input.store.saveItemBytes(entry.itemId, bytes);
    byId.set(entry.itemId, {
      itemId: entry.itemId, title: entry.title, description: entry.description, kind: entry.kind,
      contentType: contentType || entry.contentType || "application/octet-stream", byteLength: bytes.byteLength,
      version: entry.version, publishedAt: entry.publishedAt, integrityVerified,
    });
    adoptedItemIds.push(entry.itemId);
  }
  if (input.catalogItemIds) {
    const published = new Set(input.catalogItemIds);
    for (const id of [...byId.keys()]) if (!published.has(id)) { byId.delete(id); await input.store.deleteItemBytes?.(id); }
  }
  const items = [...byId.values()];
  await input.store.saveLibrary({ spaceId: input.spaceId, publisherId: input.publisherId, syncedAt: input.now().toISOString(), items });
  return { adoptedItemIds, refusedItemIds, available: items.length };
}
