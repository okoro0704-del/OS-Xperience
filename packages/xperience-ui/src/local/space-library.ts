import type { LibraryCatalogEntry, LibraryItemKind, SpaceLibrarySource } from "@digiconomy/offline-kernel";

/**
 * A Space carries its publisher's published content so it runs without internet — broadcast or not.
 * This is the mybrandOS public catalog adapter: read-only, public, uncredentialed.
 */

/** Host-supplied transport. Android uses native HTTP (its WebView origin is https://localhost). */
export type SpaceContentFetch = (url: string) => Promise<{ ok: boolean; status: number; contentType: string | null; bytes(): Promise<Uint8Array> }>;

export const browserSpaceContentFetch: SpaceContentFetch = async (url) => {
  const response = await fetch(url, { credentials: "omit" });
  return { ok: response.ok, status: response.status, contentType: response.headers.get("content-type"), bytes: async () => new Uint8Array(await response.arrayBuffer()) };
};

const BRAND_ROOT_DOMAIN = "getlifeos.app";
/** First-party hosts on the brand root that are not creator brands. */
const NON_BRAND_LABELS = new Set(["www", "api", "app", "xperience", "portal", "studio"]);
/** Bounded so preparing a Space never fills the device. */
export const SPACE_LIBRARY_MAX_ITEMS = 24;

export type SpaceLibraryRoute = { origin: string; slug: string };

/** The provider's own brand origin (`https://<slug>.getlifeos.app`) — never a guessed or injected host. */
export function spaceLibraryRoute(providerUrl: string | null | undefined): SpaceLibraryRoute | null {
  if (!providerUrl) return null;
  let url: URL;
  try {
    url = new URL(providerUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(`.${BRAND_ROOT_DOMAIN}`)) return null;
  const slug = host.slice(0, -(BRAND_ROOT_DOMAIN.length + 1));
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) || NON_BRAND_LABELS.has(slug)) return null;
  return { origin: `https://${host}`, slug };
}

type PublicAsset = {
  id?: unknown; title?: unknown; description?: unknown; assetType?: unknown; publishedAt?: unknown;
  mediaAvailable?: unknown; coverAvailable?: unknown;
};

const AUDIO_TYPES = new Set(["AUDIO", "MUSIC", "PODCAST", "RADIO"]);
const IMAGE_TYPES = new Set(["DESIGN", "IMAGE", "PHOTO", "ARTWORK"]);
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Maps one public asset to what the Space can hold; anything without public bytes is skipped. */
export function libraryEntryFor(route: SpaceLibraryRoute, asset: PublicAsset): LibraryCatalogEntry | null {
  const id = text(asset.id);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const type = text(asset.assetType).toUpperCase();
  const base = `/api/public/${encodeURIComponent(route.slug)}/assets/${encodeURIComponent(id)}`;
  let kind: LibraryItemKind;
  let path: string;
  if (asset.mediaAvailable === true) {
    kind = type === "VIDEO" ? "VIDEO" : AUDIO_TYPES.has(type) ? "AUDIO" : IMAGE_TYPES.has(type) ? "IMAGE" : "OTHER";
    path = `${base}/media`;
  } else if (asset.coverAvailable === true) {
    kind = "IMAGE";
    path = `${base}/cover`;
  } else {
    return null;
  }
  const publishedAt = text(asset.publishedAt) || null;
  return { itemId: id, title: text(asset.title) || id, description: text(asset.description), kind, version: publishedAt ?? "", publishedAt, path };
}

export function createMybrandosLibrarySource(route: SpaceLibraryRoute, fetchImpl: SpaceContentFetch = browserSpaceContentFetch): SpaceLibrarySource {
  return {
    async fetchCatalog() {
      const response = await fetchImpl(`${route.origin}/api/public/${encodeURIComponent(route.slug)}/assets`);
      if (!response.ok) throw new Error("LIBRARY_CATALOG_UNAVAILABLE");
      const json = JSON.parse(new TextDecoder().decode(await response.bytes())) as { assets?: unknown };
      if (!Array.isArray(json.assets)) throw new Error("LIBRARY_CATALOG_INVALID");
      const entries = json.assets.flatMap((asset) => {
        const entry = asset && typeof asset === "object" ? libraryEntryFor(route, asset as PublicAsset) : null;
        return entry ? [entry] : [];
      });
      return { publisherId: route.slug, entries: entries.slice(0, SPACE_LIBRARY_MAX_ITEMS) };
    },
    async fetchBytes(entry) {
      const response = await fetchImpl(`${route.origin}${entry.path}`);
      if (!response.ok) throw new Error("LIBRARY_MEDIA_UNAVAILABLE");
      const contentType = response.contentType?.split(";")[0]?.trim() || null;
      // The deployed site answers unknown paths with its HTML shell; that is never media.
      if (contentType === "text/html") throw new Error("LIBRARY_MEDIA_NOT_MEDIA");
      return { bytes: await response.bytes(), contentType };
    },
  };
}

/** One Space the platform keeps in sync by itself — its brand route only, never a credential. */
export type SpaceSyncPlanEntry = { spaceId: string; origin: string; slug: string; /** Shown in the platform's "Syncing" notification. */ name?: string };

/** Content the platform acquired while OS Xperience was closed, waiting to enter the Offline Kernel. */
export type BackgroundSyncedSpace = {
  spaceId: string;
  publisherId: string;
  /** The publisher's full current list at that sync: what is absent was unpublished. */
  catalogItemIds: readonly string[];
  items: ReadonlyArray<{ entry: Omit<LibraryCatalogEntry, "path">; contentType: string | null; bytes(): Promise<Uint8Array> }>;
};

/**
 * The platform's background delivery (Android: WorkManager while the app is closed). OS Xperience
 * hands it the Spaces to keep in sync; it hands back what arrived; delivered files are released.
 */
export interface SpaceBackgroundSync {
  setPlan(spaces: readonly SpaceSyncPlanEntry[]): Promise<void>;
  readDelivered(): Promise<BackgroundSyncedSpace[]>;
  release(spaceId: string, itemIds: readonly string[]): Promise<void>;
}
