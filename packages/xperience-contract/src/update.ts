/**
 * OS Xperience — native shell + web runtime update contract.
 * Web OTA and native APK updates are separate paths.
 */

export interface OxUpdateManifest {
  /** Semver of the Capacitor/Android shell. */
  nativeVersion: string;
  /** Android versionCode. */
  nativeBuildNumber: number;
  /** Web/runtime build identifier (not necessarily semver). */
  runtimeVersion: string;
  /** Oldest runtime the current product still supports. */
  minimumRuntimeVersion: string;
  /** Oldest native shell allowed to run this runtime. */
  minimumNativeVersion: string;
  /** Oldest native build number allowed. */
  minimumNativeBuildNumber: number;
  releaseId: string;
  publishedAt: string;
  /** HTTPS URL to the latest installable APK (native updates only). */
  apkUrl?: string;
  /** Canonical web origin that live OTA shells should load. */
  runtimeUrl?: string;
  notes?: string;
}

export type OxUpdateKind = "none" | "web_ota" | "native_apk" | "blocked";

export interface OxUpdateDecision {
  kind: OxUpdateKind;
  reason: string;
  manifest: OxUpdateManifest | null;
  installedNativeVersion?: string;
  installedNativeBuildNumber?: number;
  installedRuntimeVersion?: string;
}

export interface OxInstalledVersions {
  nativeVersion: string;
  nativeBuildNumber: number;
  runtimeVersion: string;
}

/** Compare dotted numeric versions: a > b → 1, a < b → -1, equal → 0. */
export function compareDottedVersion(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const left = pa[i] ?? 0;
    const right = pb[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

export function isOxUpdateManifest(value: unknown): value is OxUpdateManifest {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.nativeVersion === "string" &&
    typeof row.nativeBuildNumber === "number" &&
    typeof row.runtimeVersion === "string" &&
    typeof row.minimumRuntimeVersion === "string" &&
    typeof row.minimumNativeVersion === "string" &&
    typeof row.minimumNativeBuildNumber === "number" &&
    typeof row.releaseId === "string" &&
    typeof row.publishedAt === "string"
  );
}

/**
 * Decide update path from installed shell/runtime vs remote manifest.
 * Native requirements always win over web OTA.
 */
export function decideOxUpdate(
  installed: OxInstalledVersions,
  manifest: OxUpdateManifest,
): OxUpdateDecision {
  const nativeTooOld =
    compareDottedVersion(installed.nativeVersion, manifest.minimumNativeVersion) < 0 ||
    installed.nativeBuildNumber < manifest.minimumNativeBuildNumber;

  const nativeBehind =
    compareDottedVersion(installed.nativeVersion, manifest.nativeVersion) < 0 ||
    installed.nativeBuildNumber < manifest.nativeBuildNumber;

  if (nativeTooOld) {
    return {
      kind: "native_apk",
      reason: "Installed native shell is below the minimum required for this runtime.",
      manifest,
      installedNativeVersion: installed.nativeVersion,
      installedNativeBuildNumber: installed.nativeBuildNumber,
      installedRuntimeVersion: installed.runtimeVersion,
    };
  }

  if (nativeBehind) {
    return {
      kind: "native_apk",
      reason: "A newer native APK is available.",
      manifest,
      installedNativeVersion: installed.nativeVersion,
      installedNativeBuildNumber: installed.nativeBuildNumber,
      installedRuntimeVersion: installed.runtimeVersion,
    };
  }

  if (compareDottedVersion(installed.runtimeVersion, manifest.minimumRuntimeVersion) < 0) {
    return {
      kind: "web_ota",
      reason: "Installed runtime is below the minimum; reload web assets.",
      manifest,
      installedNativeVersion: installed.nativeVersion,
      installedNativeBuildNumber: installed.nativeBuildNumber,
      installedRuntimeVersion: installed.runtimeVersion,
    };
  }

  if (compareDottedVersion(installed.runtimeVersion, manifest.runtimeVersion) < 0) {
    return {
      kind: "web_ota",
      reason: "A newer web runtime is available over the air.",
      manifest,
      installedNativeVersion: installed.nativeVersion,
      installedNativeBuildNumber: installed.nativeBuildNumber,
      installedRuntimeVersion: installed.runtimeVersion,
    };
  }

  return {
    kind: "none",
    reason: "Up to date.",
    manifest,
    installedNativeVersion: installed.nativeVersion,
    installedNativeBuildNumber: installed.nativeBuildNumber,
    installedRuntimeVersion: installed.runtimeVersion,
  };
}
