import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { adoptSpaceLibraryItems, deleteSpaceLibrary, MemorySpaceLibraryStore, spaceLibraryItems, syncSpaceLibrary, type LibraryCatalogEntry, type SpaceLibrarySource } from "../src/index.ts";

const SPACE = "bootstrap.mybrandos.public";
const now = () => new Date("2026-10-07T10:00:00.000Z");
const entry = (itemId: string, extra: Partial<LibraryCatalogEntry> = {}): LibraryCatalogEntry => ({ itemId, title: itemId, description: "", kind: "VIDEO", version: "v1", publishedAt: "2026-09-20T00:00:00.000Z", path: `/media/${itemId}`, ...extra });
const bytesOf = (itemId: string) => new TextEncoder().encode(`bytes-of-${itemId}`);

function source(entries: LibraryCatalogEntry[], options: { calls?: string[]; failing?: Set<string>; catalogDown?: boolean } = {}): SpaceLibrarySource {
  return {
    fetchCatalog: async () => { if (options.catalogDown) throw new Error("ROUTE_DOWN"); return { publisherId: "mrfundzman", entries }; },
    fetchBytes: async (item) => {
      options.calls?.push(item.itemId);
      if (options.failing?.has(item.itemId)) throw new Error("MEDIA_DOWN");
      return { bytes: bytesOf(item.itemId), contentType: item.kind === "IMAGE" ? "image/jpeg" : "video/mp4" };
    },
  };
}

test("a Space with published media is ready offline without any broadcast schedule", async () => {
  const store = new MemorySpaceLibraryStore();
  const result = await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("VIDEO_1"), entry("IMAGE_1", { kind: "IMAGE" })]), now });
  assert.equal(result.state, "SYNCED");
  assert.equal(result.available, 2);
  const held = await spaceLibraryItems(store, SPACE);
  assert.deepEqual(held.map((item) => [item.itemId, item.kind, item.contentType]), [["VIDEO_1", "VIDEO", "video/mp4"], ["IMAGE_1", "IMAGE", "image/jpeg"]]);
  assert.equal(held[0]!.integrityVerified, false, "no publisher checksum: never claimed as verified");
});

test("re-sync only acquires new or changed items; unchanged items are not downloaded again", async () => {
  const store = new MemorySpaceLibraryStore();
  await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("A"), entry("B")]), now });
  const calls: string[] = [];
  const result = await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("A"), entry("B", { version: "v2" }), entry("C")], { calls }), now });
  assert.deepEqual(calls, ["B", "C"]);
  assert.equal(result.available, 3);
});

test("no route keeps the last held library; one failed item never discards the others", async () => {
  const store = new MemorySpaceLibraryStore();
  await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("A"), entry("B")]), now });
  const down = await syncSpaceLibrary({ spaceId: SPACE, store, source: source([], { catalogDown: true }), now });
  assert.equal(down.state, "UNAVAILABLE");
  assert.equal(down.available, 2, "offline: previously synced media still counts");

  const partial = await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("A", { version: "v2" }), entry("B"), entry("C")], { failing: new Set(["A", "C"]) }), now });
  assert.equal(partial.state, "PARTIAL");
  assert.deepEqual(partial.failedItemIds, ["A", "C"]);
  assert.deepEqual((await spaceLibraryItems(store, SPACE)).map((item) => [item.itemId, item.version]), [["A", "v1"], ["B", "v1"]], "the older held A stays usable");
});

test("a checksum mismatch is refused; a matching checksum is recorded as verified", async () => {
  const store = new MemorySpaceLibraryStore();
  const good = createHash("sha256").update(bytesOf("GOOD")).digest("hex");
  const result = await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("GOOD", { checksum: good }), entry("BAD", { checksum: "0".repeat(64) })]), now });
  assert.deepEqual(result.failedItemIds, ["BAD"]);
  assert.equal(await store.loadItemBytes("BAD"), undefined, "tampered bytes are never stored");
  assert.equal((await spaceLibraryItems(store, SPACE))[0]!.integrityVerified, true);
});

test("an empty catalog is EMPTY, never READY; deleting a library removes every byte", async () => {
  const empty = await syncSpaceLibrary({ spaceId: SPACE, store: new MemorySpaceLibraryStore(), source: source([]), now });
  assert.equal(empty.state, "EMPTY");
  assert.equal(empty.available, 0);

  const store = new MemorySpaceLibraryStore();
  await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("A"), entry("B")]), now });
  assert.deepEqual(await deleteSpaceLibrary(store, SPACE), ["A", "B"]);
  assert.equal(store.bytes.size, 0);
  assert.deepEqual(await spaceLibraryItems(store, SPACE), []);
});

test("background-acquired content is adopted under the same rules; unpublished posts leave the device", async () => {
  const store = new MemorySpaceLibraryStore();
  await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("A"), entry("B")]), now });
  const good = createHash("sha256").update(bytesOf("C")).digest("hex");
  const adopted = await adoptSpaceLibraryItems({
    spaceId: SPACE, publisherId: "mrfundzman", store, now,
    items: [
      { entry: entry("A"), bytes: bytesOf("A"), contentType: "video/mp4" },
      { entry: entry("C", { checksum: good }), bytes: bytesOf("C"), contentType: "video/mp4" },
      { entry: entry("D", { checksum: "0".repeat(64) }), bytes: bytesOf("D"), contentType: "video/mp4" },
    ],
    catalogItemIds: ["A", "C", "D"],
  });
  assert.deepEqual(adopted.adoptedItemIds, ["C"], "A was already held at this version");
  assert.deepEqual(adopted.refusedItemIds, ["D"], "a checksum mismatch is refused");
  assert.deepEqual((await spaceLibraryItems(store, SPACE)).map((item) => item.itemId), ["A", "C"], "B was unpublished");
  assert.equal(await store.loadItemBytes("B"), undefined, "unpublished bytes are deleted");

  await syncSpaceLibrary({ spaceId: SPACE, store, source: source([entry("C")]), now });
  assert.equal(await store.loadItemBytes("A"), undefined, "a sync removes unpublished bytes too");
});
