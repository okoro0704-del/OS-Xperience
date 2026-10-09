import assert from "node:assert/strict";
import test from "node:test";
import { MemoryBroadcastHydrationStore, MemorySpaceLibraryStore, spaceLibraryItems, syncSpaceLibrary } from "@digiconomy/offline-kernel";
import {
  MYBRANDOS_PUBLIC_ID,
  classifySpaceReadiness,
  createMybrandosLibrarySource,
  libraryEntryFor,
  spaceLibraryRoute,
  spaceLocallyReady,
  type SpaceContentFetch,
} from "../src/local/index.js";

const route = { origin: "https://mrfundzman.getlifeos.app", slug: "mrfundzman" };

/** Shape of the live mybrandOS public catalog (`/api/public/:slug/assets`). */
const catalog = {
  assets: [
    { id: "vid1", title: "Episode 1", description: "Hhhh", assetType: "VIDEO", publishedAt: "2026-09-20T03:22:59.022Z", mediaAvailable: true, coverAvailable: false },
    { id: "des1", title: "Real estate", description: "", assetType: "DESIGN", publishedAt: "2026-09-19T12:49:01.926Z", mediaAvailable: false, coverAvailable: true },
    { id: "song1", title: "Theme", assetType: "MUSIC", publishedAt: "2026-09-18T00:00:00.000Z", mediaAvailable: true },
    { id: "nothing", title: "No public bytes", assetType: "VIDEO", mediaAvailable: false, coverAvailable: false },
    { id: "../escape", title: "Bad id", assetType: "VIDEO", mediaAvailable: true },
  ],
};

function fakeFetch(requests: string[], responses: Record<string, { status?: number; contentType: string; body: Uint8Array | string }>): SpaceContentFetch {
  return async (url) => {
    requests.push(url);
    const hit = responses[url];
    if (!hit) return { ok: false, status: 404, contentType: "application/json", bytes: async () => new TextEncoder().encode("{}") };
    const body = typeof hit.body === "string" ? new TextEncoder().encode(hit.body) : hit.body;
    const status = hit.status ?? 200;
    return { ok: status < 300, status, contentType: hit.contentType, bytes: async () => body };
  };
}

const base = "https://mrfundzman.getlifeos.app/api/public/mrfundzman/assets";
const liveResponses = {
  [base]: { contentType: "application/json; charset=utf-8", body: JSON.stringify(catalog) },
  [`${base}/vid1/media`]: { contentType: "video/mp4", body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) },
  [`${base}/des1/cover`]: { contentType: "image/jpeg", body: new Uint8Array([255, 216, 255]) },
  [`${base}/song1/media`]: { contentType: "audio/mpeg", body: new Uint8Array([73, 68, 51]) },
};

test("the content route is the provider's own brand origin, never a guessed or first-party host", () => {
  assert.deepEqual(spaceLibraryRoute("https://mrfundzman.getlifeos.app/"), route);
  for (const url of [
    "http://mrfundzman.getlifeos.app/",
    "https://mrfundzman.getlifeos.app:8443/",
    "https://xperience.getlifeos.app/",
    "https://getlifeos.app/",
    "https://a.b.getlifeos.app/",
    "https://mrfundzman.getlifeos.app.evil.test/",
    "https://evilgetlifeos.app/",
    "not a url",
    null,
  ]) assert.equal(spaceLibraryRoute(url), null, String(url));
});

test("public assets map to Space items; anything without public bytes, or with an unsafe id, is skipped", () => {
  const entries = catalog.assets.map((asset) => libraryEntryFor(route, asset));
  assert.deepEqual(entries.map((entry) => entry && [entry.itemId, entry.kind, entry.path]), [
    ["vid1", "VIDEO", "/api/public/mrfundzman/assets/vid1/media"],
    ["des1", "IMAGE", "/api/public/mrfundzman/assets/des1/cover"],
    ["song1", "AUDIO", "/api/public/mrfundzman/assets/song1/media"],
    null,
    null,
  ]);
  assert.equal(entries[0]!.version, "2026-09-20T03:22:59.022Z", "republishing changes the version");
});

test("MrFundzMan with published media and no broadcast is READY OFFLINE after preparation", async () => {
  const requests: string[] = [];
  const library = new MemorySpaceLibraryStore();
  const broadcast = new MemoryBroadcastHydrationStore();
  const space = { spaceId: MYBRANDOS_PUBLIC_ID, channelId: "mrfundzman.tv" };
  assert.equal(await spaceLocallyReady({ broadcast, library }, space), false, "nothing held yet");

  const result = await syncSpaceLibrary({ spaceId: MYBRANDOS_PUBLIC_ID, store: library, source: createMybrandosLibrarySource(route, fakeFetch(requests, liveResponses)), now: () => new Date() });
  assert.equal(result.state, "SYNCED");
  assert.equal(result.available, 3);
  assert.ok(requests.every((url) => url.startsWith("https://mrfundzman.getlifeos.app/api/public/mrfundzman/")), "only the provider's public API is read");

  const ready = await spaceLocallyReady({ broadcast, library }, space);
  assert.equal(ready, true, "the channel has no schedule, yet the Space is ready: TV is not a precondition");
  assert.deepEqual(classifySpaceReadiness({ released: true, offlineCapability: "PARTIAL", channelId: "mrfundzman.tv", locallyPlayable: ready, online: false }), { readiness: "READY_OFFLINE", enterable: true });
  assert.deepEqual((await spaceLibraryItems(library, MYBRANDOS_PUBLIC_ID)).map((item) => [item.itemId, item.contentType]), [["vid1", "video/mp4"], ["des1", "image/jpeg"], ["song1", "audio/mpeg"]]);
});

test("the site's HTML shell is never stored as media; an unreachable catalog keeps what is held", async () => {
  const library = new MemorySpaceLibraryStore();
  const html = { ...liveResponses, [`${base}/vid1/media`]: { contentType: "text/html; charset=utf-8", body: "<!doctype html>" } };
  const first = await syncSpaceLibrary({ spaceId: MYBRANDOS_PUBLIC_ID, store: library, source: createMybrandosLibrarySource(route, fakeFetch([], html)), now: () => new Date() });
  assert.deepEqual(first.failedItemIds, ["vid1"]);
  assert.equal(first.available, 2);

  const down = await syncSpaceLibrary({ spaceId: MYBRANDOS_PUBLIC_ID, store: library, source: createMybrandosLibrarySource(route, fakeFetch([], {})), now: () => new Date() });
  assert.equal(down.state, "UNAVAILABLE");
  assert.equal(down.available, 2, "offline, the Space still runs from what it already synced");
});
