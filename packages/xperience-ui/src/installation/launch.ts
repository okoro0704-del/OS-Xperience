import type { DirectoryApplicationView, ExperienceExecutionMode, ExperienceTarget } from "@digiconomy/xperience-contract";
import { SPACE_LAUNCH_ACTION, parseSpaceLaunch, spaceProviderView } from "../local/space-home-entry.js";
import { providerTargets, requireExecutionTarget } from "../local/targets.js";
import { findInstalledTarget, type InstalledTarget } from "./registry.js";
import { isTargetId, parseTargetKey, targetKey } from "./target.js";

/** Explicit-component intent action of every Android APP launch entry. */
export const APP_LAUNCH_ACTION = "com.digiconomy.osexperience.action.OPEN_APP";
/** The only intent extra an APP launch entry carries: the App (provider) identity. */
export const APP_LAUNCH_EXTRA = "ox.app.id";
/** Web launch entries start at `/?ox-launch=<type>:<id>` — the manifest's start_url. */
export const WEB_LAUNCH_PARAM = "ox-launch";

const RESERVED_EXTRA_NAMESPACE = "ox.";
const MAX_EXTRA_KEYS = 32;

/** A launch request read from a web entry's URL. Still untrusted. */
export interface WebTargetLaunch {
  source: "WEB";
  key: unknown;
  /** True only when the page runs as an installed web app (display-mode standalone / iOS Home Screen). */
  standalone: boolean;
}

export type TargetLaunchRoute =
  | { kind: "APP"; appId: string; source: "ANDROID" | "WEB"; standalone: boolean }
  | { kind: "SPACE"; spaceId: string; source: "ANDROID" | "WEB"; standalone: boolean }
  | { kind: "INVALID" };

function isWebLaunch(raw: unknown): raw is WebTargetLaunch {
  return Boolean(raw && typeof raw === "object" && (raw as { source?: unknown }).source === "WEB");
}

/** Android APP intents follow the same strict grammar as Space intents. */
export function parseAppLaunch(raw: unknown): { ok: true; appId: string } | { ok: false; code: "INVALID_TARGET" } {
  const invalid = { ok: false as const, code: "INVALID_TARGET" as const };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid;
  const request = raw as { action?: unknown; hasData?: unknown; extraKeys?: unknown; appId?: unknown };
  if (request.action !== APP_LAUNCH_ACTION || request.hasData !== false) return invalid;
  if (!Array.isArray(request.extraKeys) || request.extraKeys.length > MAX_EXTRA_KEYS) return invalid;
  const keys = request.extraKeys;
  if (!keys.every((key): key is string => typeof key === "string")) return invalid;
  if (keys.filter((key) => key === APP_LAUNCH_EXTRA).length !== 1) return invalid;
  if (keys.some((key) => key !== APP_LAUNCH_EXTRA && key.startsWith(RESERVED_EXTRA_NAMESPACE))) return invalid;
  if (!isTargetId(request.appId)) return invalid;
  return { ok: true, appId: request.appId };
}

/**
 * One router for every launch entry on every platform. It identifies WHAT to open — type and
 * identity — and nothing else. SPACE requests from Android still pass the frozen Space Installation
 * V1 parser unchanged; nothing here weakens Space validation.
 */
export function routeTargetLaunch(raw: unknown): TargetLaunchRoute {
  if (isWebLaunch(raw)) {
    const parsed = parseTargetKey(raw.key);
    const standalone = raw.standalone === true;
    if (!parsed) return { kind: "INVALID" };
    return parsed.type === "APP"
      ? { kind: "APP", appId: parsed.id, source: "WEB", standalone }
      : { kind: "SPACE", spaceId: parsed.id, source: "WEB", standalone };
  }
  const action = raw && typeof raw === "object" ? (raw as { action?: unknown }).action : undefined;
  if (action === APP_LAUNCH_ACTION) {
    const parsed = parseAppLaunch(raw);
    return parsed.ok ? { kind: "APP", appId: parsed.appId, source: "ANDROID", standalone: true } : { kind: "INVALID" };
  }
  if (action === SPACE_LAUNCH_ACTION) {
    const parsed = parseSpaceLaunch(raw);
    return parsed.ok ? { kind: "SPACE", spaceId: parsed.spaceId, source: "ANDROID", standalone: true } : { kind: "INVALID" };
  }
  return { kind: "INVALID" };
}

/** Reads a web launch from a URL. Any other query parameter is ignored; no mode, URL or route is accepted. */
export function webLaunchFromUrl(url: string, standalone: boolean): WebTargetLaunch | null {
  try {
    const key = new URL(url).searchParams.get(WEB_LAUNCH_PARAM);
    return key == null ? null : { source: "WEB", key, standalone };
  } catch {
    return null;
  }
}

/** The start_url of a web launch entry. */
export function webLaunchPath(type: "APP" | "SPACE", id: string): string {
  return `/?${WEB_LAUNCH_PARAM}=${encodeURIComponent(targetKey(type, id))}`;
}

export type AppLaunchResolution =
  | { kind: "INVALID_TARGET" }
  | { kind: "NOT_INSTALLED"; appId: string }
  | { kind: "UNAVAILABLE"; appId: string; record: InstalledTarget }
  | { kind: "RESOLVED"; appId: string; record: InstalledTarget; app: DirectoryApplicationView; target: ExperienceTarget };

/**
 * Installed App identity → released APP target, from local state only. Never substitutes SPACE,
 * never opens a URL that did not come from the provider's released target, never authenticates.
 */
export function resolveInstalledApp(
  appId: string,
  options: { apps?: readonly DirectoryApplicationView[]; fixedMode?: ExperienceExecutionMode | null } = {},
): AppLaunchResolution {
  if (!isTargetId(appId)) return { kind: "INVALID_TARGET" };
  const record = findInstalledTarget("APP", appId);
  if (!record) return { kind: "NOT_INSTALLED", appId };
  if (options.fixedMode && options.fixedMode !== "APP") return { kind: "UNAVAILABLE", appId, record };
  const app = spaceProviderView(appId, options.apps);
  if (!app) return { kind: "UNAVAILABLE", appId, record };
  const target = requireExecutionTarget(
    providerTargets({ id: app.id, entrypoint: app.xperienceUrl || app.productionUrl, executionModes: app.executionModes }),
    "APP",
  );
  if (!target || target.executionMode !== "APP") return { kind: "UNAVAILABLE", appId, record };
  return { kind: "RESOLVED", appId, record, app, target };
}
