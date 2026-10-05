/**
 * Capacitor adapter for Space home entries. Android pins and lists launcher entries and hands
 * back raw launch requests; @digiconomy/xperience-ui validates and resolves them.
 * Browsers and PWAs get no host: Space home entries are reported as unsupported there.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { SpaceHomeEntryHost, SpaceShortcutRequest } from "@digiconomy/xperience-ui";

interface SpaceHomeEntryPlugin {
  supported(): Promise<{ supported: boolean }>;
  pinned(): Promise<{ shortcutIds: string[] }>;
  requestPin(request: SpaceShortcutRequest): Promise<{ requested: boolean; alreadyPinned: boolean }>;
  update(request: SpaceShortcutRequest): Promise<void>;
  disable(options: { shortcutId: string }): Promise<void>;
  takeLaunch(): Promise<{ launch?: unknown }>;
  addListener(event: "spaceLaunch" | "homeEntriesChanged", listener: () => void): Promise<PluginListenerHandle>;
}

const LAUNCH_READ_TIMEOUT_MS = 1500;

export function createSpaceHomeEntryHost(): SpaceHomeEntryHost | null {
  if (Capacitor.getPlatform() !== "android" || !Capacitor.isPluginAvailable("SpaceHomeEntry")) return null;
  const plugin = registerPlugin<SpaceHomeEntryPlugin>("SpaceHomeEntry");
  return {
    supported: async () => (await plugin.supported()).supported === true,
    pinnedShortcutIds: async () => (await plugin.pinned()).shortcutIds ?? [],
    requestPin: async (request) => {
      const result = await plugin.requestPin(request);
      return { requested: result.requested === true, alreadyPinned: result.alreadyPinned === true };
    },
    update: (request) => plugin.update(request),
    disable: (shortcutId) => plugin.disable({ shortcutId }),
    takeLaunch: async () => (await plugin.takeLaunch()).launch ?? null,
    onLaunch: (listener) => {
      const handle = plugin.addListener("spaceLaunch", listener);
      return () => void handle.then((registered) => registered.remove());
    },
    onPinnedChange: (listener) => {
      const handle = plugin.addListener("homeEntriesChanged", listener);
      return () => void handle.then((registered) => registered.remove());
    },
  };
}

/** Cold start: read the launch request before the first paint so Home never shows ahead of the Space. */
export async function readInitialSpaceLaunch(host: SpaceHomeEntryHost | null): Promise<unknown> {
  if (!host) return null;
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), LAUNCH_READ_TIMEOUT_MS));
  try {
    return await Promise.race([host.takeLaunch(), timeout]);
  } catch {
    return null;
  }
}
