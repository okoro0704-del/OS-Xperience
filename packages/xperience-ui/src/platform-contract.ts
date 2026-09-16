/**
 * OS Xperience platform contract — shared product vs platform adapters.
 *
 * ONE PRODUCT → WEB/PWA + ANDROID + iOS.
 * Product behavior lives in ExperienceApp / shared UI.
 * Platform shells supply insets, permissions, haptics, back, lifecycle.
 *
 * Escape event name lives in experience-escape.ts (single source).
 */

/** System insets in CSS pixels (not device pixels). */
export type SystemInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Dispatched by native shells after measuring WindowInsets / safeArea. */
export const SYSTEM_INSETS_EVENT = "ox-system-insets";

export type ExperienceEscapeDetail = {
  source: "web" | "android-host" | "ios-host" | "air-navigation" | "a11y" | "debug";
};

export type OxPlatformId = "web" | "android" | "ios";

/**
 * Capabilities the shared UI may request from a platform adapter.
 * Adapters live in apps/os-experience (Capacitor) — not in this package.
 */
export type PlatformAdapterCapabilities = {
  getInsets?: () => SystemInsets | Promise<SystemInsets>;
  requestCameraPermission?: () => Promise<"granted" | "denied" | "unavailable">;
  requestMicrophonePermission?: () => Promise<"granted" | "denied" | "unavailable">;
  triggerHaptic?: (kind?: "light" | "medium" | "heavy") => void | Promise<void>;
  handleSystemBack?: () => boolean;
  getLifecycleState?: () => "active" | "background";
};

declare global {
  interface Window {
    __oxExperienceActive?: boolean;
    __oxExitExperienceToHome?: () => void;
    __oxPlatformId?: OxPlatformId;
    __oxGestureDebug?: (phase: string, count: number, dx?: number, dy?: number) => void;
  }
}

export function detectOxPlatformId(): OxPlatformId {
  try {
    const cap = (window as Window & { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } })
      .Capacitor;
    if (cap?.isNativePlatform?.()) {
      const p = cap.getPlatform?.();
      if (p === "ios") return "ios";
      if (p === "android") return "android";
    }
  } catch {
    /* ignore */
  }
  return "web";
}

/** Apply insets into the shared CSS layout contract (--ox-safe-*). */
export function applySharedSystemInsets(insets: SystemInsets): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--ox-safe-top", `${Math.max(0, insets.top)}px`);
  root.style.setProperty("--ox-safe-bottom", `${Math.max(0, insets.bottom)}px`);
  root.style.setProperty("--ox-safe-left", `${Math.max(0, insets.left)}px`);
  root.style.setProperty("--ox-safe-right", `${Math.max(0, insets.right)}px`);
}
