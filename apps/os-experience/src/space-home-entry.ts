/**
 * Capacitor adapter for home entries (Space Installation V1 Spaces and installed Apps). Android pins
 * and lists launcher entries and hands back raw launch requests; @digiconomy/xperience-ui validates
 * and resolves them. Browsers and PWAs get no host: they install through the web adapter instead.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { AppHomeEntryHost, AppShortcutRequest, SpaceHomeEntryHost, SpaceShortcutRequest } from "@digiconomy/xperience-ui";

interface SpaceHomeEntryPlugin {
  supported(): Promise<{ supported: boolean }>;
  pinned(): Promise<{ shortcutIds: string[] }>;
  requestPin(request: SpaceShortcutRequest | AppShortcutRequest): Promise<{ requested: boolean; alreadyPinned: boolean }>;
  update(request: SpaceShortcutRequest | AppShortcutRequest): Promise<void>;
  disable(options: { shortcutId: string }): Promise<void>;
  takeLaunch(): Promise<{ launch?: unknown; targetTask?: boolean }>;
  presentTarget(options: { label: string; monogram: string; color: string }): Promise<void>;
  addListener(event: "spaceLaunch" | "homeEntriesChanged", listener: () => void): Promise<PluginListenerHandle>;
}

let registered: SpaceHomeEntryPlugin | null | undefined;

function homeEntryPlugin(): SpaceHomeEntryPlugin | null {
  if (registered !== undefined) return registered;
  registered = Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("SpaceHomeEntry")
    ? registerPlugin<SpaceHomeEntryPlugin>("SpaceHomeEntry")
    : null;
  return registered;
}

export function createSpaceHomeEntryHost(): SpaceHomeEntryHost | null {
  const plugin = homeEntryPlugin();
  if (!plugin) return null;
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

/** APP entries through the same launcher plugin: same trampoline, App identity instead of Space identity. */
export function createAppHomeEntryHost(): AppHomeEntryHost | null {
  const plugin = homeEntryPlugin();
  if (!plugin) return null;
  return {
    requestPin: async (request) => {
      const result = await plugin.requestPin(request);
      return { requested: result.requested === true, alreadyPinned: result.alreadyPinned === true };
    },
    update: (request) => plugin.update(request),
    disable: (shortcutId) => plugin.disable({ shortcutId }),
  };
}

/** Names a direct target's task in Recents. A no-op outside a target task. */
export function presentDirectTarget(presentation: { label: string; monogram: string; color: string }): void {
  void homeEntryPlugin()?.presentTarget(presentation).catch(() => undefined);
}

/** A target task that yields no readable launch is still a target task: it must never fall back to Home. */
const UNREADABLE_TARGET_LAUNCH = Object.freeze({ action: null, hasData: false, extraKeys: [] });

/**
 * Cold start, before the first paint: the launch request, if this runtime was opened by an
 * installed entry. Read from the native task itself, so OS Xperience's own task never sees one.
 */
export async function readInitialTargetLaunch(): Promise<unknown> {
  const plugin = homeEntryPlugin();
  if (!plugin) return null;
  // In-process bridge call; bounded only so a stalled bridge can never leave a blank window forever.
  const timeout = new Promise<{ launch?: unknown; targetTask?: boolean }>((resolve) => window.setTimeout(() => resolve({}), 5000));
  try {
    const result = await Promise.race([plugin.takeLaunch(), timeout]);
    if (result.launch != null) return result.launch;
    return result.targetTask === true ? UNREADABLE_TARGET_LAUNCH : null;
  } catch {
    return null;
  }
}
