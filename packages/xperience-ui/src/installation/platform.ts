import {
  canInstallSpaceHomeEntry,
  spaceShortcutRequest,
  type SpaceHomeEntryHost,
} from "../local/space-home-entry.js";
import type { InstallationPlatform } from "./registry.js";
import { targetKey, type InstallTargetType, type InstallableTarget } from "./target.js";

/**
 * The platform boundary. OS Xperience owns the installation domain (what a target is, whether it
 * may be installed, what an entry resolves to); an adapter only creates a launch entry with the
 * mechanism its platform actually exposes, and says honestly when it cannot.
 */
export type InstallMechanism =
  | "ANDROID_PINNED_SHORTCUT"
  | "WEB_INSTALL_PROMPT"
  | "WEB_ADD_TO_HOME_SCREEN"
  | "WEB_ADD_TO_DOCK"
  | "IOS_SAFARI_HANDOFF"
  | "NONE";

export interface InstallCapability {
  platform: InstallationPlatform;
  mechanism: InstallMechanism;
  supported: boolean;
  /** The OS or browser asks the human to confirm (launcher dialog, install prompt, Share sheet). */
  requiresUserConfirmation: boolean;
  /** Internal reason when unsupported. Never shown verbatim. */
  reason?: string;
}

/** Everything a platform needs to draw and route an entry: identity and local presentation only. */
export interface LaunchEntryRequest {
  type: InstallTargetType;
  id: string;
  key: string;
  label: string;
  monogram: string;
  color: string;
  version?: string;
}

export type ConfirmationGuidance = "LAUNCHER" | "BROWSER_PROMPT" | "BROWSER_MENU" | "SHARE_ADD_TO_HOME_SCREEN" | "ADD_TO_DOCK" | "SAFARI";

export type LaunchEntryResult =
  | { status: "CREATED" }
  | { status: "ALREADY_PRESENT" }
  | { status: "PENDING_CONFIRMATION"; guidance: ConfirmationGuidance }
  | { status: "DISMISSED" }
  | { status: "UNSUPPORTED"; reason: string }
  | { status: "FAILED"; reason: string };

export interface InstallationPlatformAdapter {
  readonly platform: InstallationPlatform;
  capability(): Promise<InstallCapability>;
  createEntry(request: LaunchEntryRequest): Promise<LaunchEntryResult>;
  /** Keys the platform reports as present, or null when the platform cannot tell. */
  presentEntries(): Promise<string[] | null>;
  /** Makes an entry unable to launch, where the platform allows it. */
  disableEntry?(key: string): Promise<void>;
}

export function launchEntryRequest(target: InstallableTarget): LaunchEntryRequest {
  return {
    type: target.type,
    id: target.id,
    key: targetKey(target.type, target.id),
    label: target.name,
    monogram: target.icon.monogram,
    color: target.icon.color,
    ...(target.version ? { version: target.version } : {}),
  };
}

/* ------------------------------------------------------------------ Android */

/** What Android receives for an APP entry: the APP identity and local presentation. Nothing else. */
export interface AppShortcutRequest {
  shortcutId: string;
  appId: string;
  label: string;
  monogram: string;
  color: string;
}

/** APP side of the same native launcher plugin that serves Space Installation V1. */
export interface AppHomeEntryHost {
  requestPin(request: AppShortcutRequest): Promise<{ requested: boolean; alreadyPinned?: boolean }>;
  update(request: AppShortcutRequest): Promise<void>;
  disable(shortcutId: string): Promise<void>;
}

export function appShortcutRequest(request: Pick<LaunchEntryRequest, "id" | "label" | "monogram" | "color">): AppShortcutRequest {
  return { shortcutId: targetKey("APP", request.id), appId: request.id, label: request.label, monogram: request.monogram, color: request.color };
}

/**
 * Android: pinned launcher shortcuts into the single OS Xperience APK. SPACE uses the frozen Space
 * Installation V1 host and request unchanged (alreadyPinned included); APP uses the same plugin.
 */
export function createAndroidInstallationAdapter(hosts: { space: SpaceHomeEntryHost; app: AppHomeEntryHost | null }): InstallationPlatformAdapter {
  const toResult = (result: { requested: boolean; alreadyPinned?: boolean }): LaunchEntryResult => {
    if (!result.requested) return { status: "FAILED", reason: "PIN_NOT_REQUESTED" };
    return result.alreadyPinned ? { status: "ALREADY_PRESENT" } : { status: "PENDING_CONFIRMATION", guidance: "LAUNCHER" };
  };
  return {
    platform: "ANDROID",
    async capability() {
      const supported = await canInstallSpaceHomeEntry(hosts.space);
      return supported
        ? { platform: "ANDROID", mechanism: "ANDROID_PINNED_SHORTCUT", supported: true, requiresUserConfirmation: true }
        : { platform: "ANDROID", mechanism: "NONE", supported: false, requiresUserConfirmation: false, reason: "LAUNCHER_REFUSES_PINNING" };
    },
    async createEntry(request) {
      try {
        if (request.type === "SPACE") {
          return toResult(await hosts.space.requestPin(spaceShortcutRequest({ spaceId: request.id, name: request.label })));
        }
        if (!hosts.app) return { status: "UNSUPPORTED", reason: "APP_ENTRIES_UNAVAILABLE" };
        return toResult(await hosts.app.requestPin(appShortcutRequest(request)));
      } catch {
        return { status: "FAILED", reason: "PIN_REQUEST_FAILED" };
      }
    },
    async presentEntries() {
      try {
        return await hosts.space.pinnedShortcutIds();
      } catch {
        return null;
      }
    },
    async disableEntry(key) {
      if (key.startsWith("app:")) await hosts.app?.disable(key);
      else await hosts.space.disable(key);
    },
  };
}

/* ------------------------------------------------------------------ iOS */

/**
 * Native iOS exposes no API for an app to place its own Home Screen icons. The Apple-supported
 * path is Safari's Add to Home Screen, so INSTALL hands the target to OS Xperience Web in Safari
 * (`?ox-install=<key>`), where the web adapter guides that step. The resulting icon opens the OS
 * Xperience web runtime with the same target identity — not this native app.
 */
export const WEB_INSTALL_PARAM = "ox-install";

export function webInstallUrl(runtimeOrigin: string, type: InstallTargetType, id: string): string | null {
  try {
    const url = new URL("/", runtimeOrigin);
    if (url.protocol !== "https:") return null;
    url.searchParams.set(WEB_INSTALL_PARAM, targetKey(type, id));
    return url.toString();
  } catch {
    return null;
  }
}

export function createIosInstallationAdapter(options: { runtimeOrigin: string | null; openInSafari: ((url: string) => void | Promise<void>) | null }): InstallationPlatformAdapter {
  const available = Boolean(options.runtimeOrigin && options.openInSafari && webInstallUrl(options.runtimeOrigin, "APP", "probe"));
  return {
    platform: "IOS",
    async capability() {
      return available
        ? { platform: "IOS", mechanism: "IOS_SAFARI_HANDOFF", supported: true, requiresUserConfirmation: true }
        : { platform: "IOS", mechanism: "NONE", supported: false, requiresUserConfirmation: false, reason: "NO_WEB_RUNTIME_ORIGIN" };
    },
    async createEntry(request) {
      const url = options.runtimeOrigin ? webInstallUrl(options.runtimeOrigin, request.type, request.id) : null;
      if (!url || !options.openInSafari) return { status: "UNSUPPORTED", reason: "NO_WEB_RUNTIME_ORIGIN" };
      try {
        await options.openInSafari(url);
        return { status: "PENDING_CONFIRMATION", guidance: "SAFARI" };
      } catch {
        return { status: "FAILED", reason: "SAFARI_HANDOFF_FAILED" };
      }
    },
    // Safari's Home Screen entries are invisible to the native app.
    async presentEntries() {
      return null;
    },
  };
}

/** Explicit, honest absence of a mechanism (e.g. Windows native, unknown hosts). */
export function createUnsupportedInstallationAdapter(platform: InstallationPlatform, reason: string): InstallationPlatformAdapter {
  return {
    platform,
    async capability() {
      return { platform, mechanism: "NONE", supported: false, requiresUserConfirmation: false, reason };
    },
    async createEntry() {
      return { status: "UNSUPPORTED", reason };
    },
    async presentEntries() {
      return null;
    },
  };
}
