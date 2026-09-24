/**
 * Launch-time update check for OS Xperience (web OTA vs native APK).
 * Must NEVER block or replace the bundled shell before UI mounts.
 */
import {
  decideOxUpdate,
  isOxUpdateManifest,
  type OxInstalledVersions,
  type OxUpdateDecision,
  type OxUpdateManifest,
} from "@digiconomy/xperience-contract";
import { Capacitor } from "@capacitor/core";
import {
  OX_NATIVE_BUILD_NUMBER,
  OX_NATIVE_VERSION,
  OX_RUNTIME_URL,
  OX_RUNTIME_VERSION,
} from "./ox-version-stamp.js";
import { openExternalUrl } from "./native-bridge.js";

const MANIFEST_PATH = "/ox-update-manifest.json";
const DISMISS_NATIVE_KEY = "ox.update.native-dismissed.releaseId";

export async function readInstalledVersions(): Promise<OxInstalledVersions> {
  let nativeVersion = OX_NATIVE_VERSION;
  let nativeBuildNumber = OX_NATIVE_BUILD_NUMBER;
  if (Capacitor.isNativePlatform()) {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      if (info.version) nativeVersion = info.version;
      if (info.build) {
        const parsed = Number.parseInt(info.build, 10);
        if (Number.isFinite(parsed)) nativeBuildNumber = parsed;
      }
    } catch {
      /* stamp fallback */
    }
  }
  return {
    nativeVersion,
    nativeBuildNumber,
    runtimeVersion: OX_RUNTIME_VERSION,
  };
}

export function manifestUrls(): string[] {
  const urls: string[] = [];
  try {
    urls.push(new URL(MANIFEST_PATH, window.location.origin).href);
  } catch {
    /* ignore */
  }
  if (OX_RUNTIME_URL) {
    urls.push(`${OX_RUNTIME_URL.replace(/\/$/, "")}${MANIFEST_PATH}`);
  }
  return [...new Set(urls)];
}

export async function fetchOxUpdateManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<OxUpdateManifest | null> {
  for (const url of manifestUrls()) {
    try {
      const response = await fetchImpl(url, { cache: "no-store" });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) continue;
      const json: unknown = await response.json();
      if (isOxUpdateManifest(json)) return json;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function checkOxUpdates(
  fetchImpl: typeof fetch = fetch,
): Promise<OxUpdateDecision> {
  const installed = await readInstalledVersions();
  const manifest = await fetchOxUpdateManifest(fetchImpl);
  if (!manifest) {
    return {
      kind: "none",
      reason: "Update manifest unavailable — continuing with installed runtime.",
      manifest: null,
      installedNativeVersion: installed.nativeVersion,
      installedNativeBuildNumber: installed.nativeBuildNumber,
      installedRuntimeVersion: installed.runtimeVersion,
    };
  }
  return decideOxUpdate(installed, manifest);
}

/**
 * Web OTA must not yank Capactor off bundled assets.
 * On native: ignore soft web_ota (bundled shell stays; next APK ships newer runtime).
 * On browser PWA: soft reload is allowed.
 */
export async function applyWebOta(decision: OxUpdateDecision): Promise<void> {
  if (decision.kind !== "web_ota" || !decision.manifest) return;
  if (Capacitor.isNativePlatform()) {
    console.info("[ox-update] web_ota deferred on native bundled shell", decision.manifest.releaseId);
    return;
  }
  const releaseId = decision.manifest.releaseId;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("ox_ota") === releaseId) return;
  } catch {
    /* ignore */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("ox_ota", releaseId);
  window.location.replace(url.toString());
}

export function wasNativeUpdateDismissed(releaseId: string): boolean {
  try {
    return localStorage.getItem(DISMISS_NATIVE_KEY) === releaseId;
  } catch {
    return false;
  }
}

export function dismissNativeUpdate(releaseId: string): void {
  try {
    localStorage.setItem(DISMISS_NATIVE_KEY, releaseId);
  } catch {
    /* ignore */
  }
}

export async function openNativeApkUpdate(decision: OxUpdateDecision): Promise<void> {
  const apkUrl = decision.manifest?.apkUrl;
  if (!apkUrl || !/^https:\/\//i.test(apkUrl)) {
    console.warn("[ox-update] Native update required but apkUrl is missing.");
    return;
  }
  await openExternalUrl(apkUrl);
}
