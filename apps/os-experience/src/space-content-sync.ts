/**
 * Android host for background Space content delivery (SpaceContentSyncPlugin + WorkManager). While
 * OS Xperience is closed the worker downloads each Space's published posts whenever the device has
 * a connection; on the next start or resume OS Xperience adopts them into the Offline Kernel.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundSyncedSpace, SpaceBackgroundSync, SpaceSyncPlanEntry } from "@digiconomy/xperience-ui";

type DeliveredItem = {
  itemId: string; title: string; description: string; kind: "VIDEO" | "AUDIO" | "IMAGE" | "OTHER";
  contentType: string | null; version: string; publishedAt: string | null; byteLength: number; path: string;
};

interface SpaceContentSyncPlugin {
  setPlan(options: { spaces: SpaceSyncPlanEntry[] }): Promise<{ accepted: number }>;
  readDelivered(): Promise<{ spaces: Array<{ spaceId: string; publisherId: string; catalogItemIds: string[]; items: DeliveredItem[] }> }>;
  release(options: { spaceId: string; itemIds: string[] }): Promise<void>;
}

const KINDS = new Set(["VIDEO", "AUDIO", "IMAGE", "OTHER"]);

export function createSpaceBackgroundSync(): SpaceBackgroundSync | null {
  if (Capacitor.getPlatform() !== "android" || !Capacitor.isPluginAvailable("SpaceContentSync")) return null;
  const plugin = registerPlugin<SpaceContentSyncPlugin>("SpaceContentSync");
  return {
    async setPlan(spaces) {
      await plugin.setPlan({ spaces: [...spaces] });
    },
    async readDelivered(): Promise<BackgroundSyncedSpace[]> {
      const { spaces } = await plugin.readDelivered();
      return spaces.map((space) => ({
        spaceId: space.spaceId,
        publisherId: space.publisherId,
        catalogItemIds: space.catalogItemIds ?? [],
        items: (space.items ?? []).filter((item) => KINDS.has(item.kind)).map((item) => ({
          entry: { itemId: item.itemId, title: item.title, description: item.description, kind: item.kind, version: item.version, publishedAt: item.publishedAt },
          contentType: item.contentType,
          // The file is in this app's private storage; the WebView reads it through Capacitor's file route.
          bytes: async () => {
            const response = await fetch(Capacitor.convertFileSrc(item.path));
            if (!response.ok) throw new Error("DELIVERED_FILE_UNREADABLE");
            return new Uint8Array(await response.arrayBuffer());
          },
        })),
      }));
    },
    async release(spaceId, itemIds) {
      await plugin.release({ spaceId, itemIds: [...itemIds] });
    },
  };
}
