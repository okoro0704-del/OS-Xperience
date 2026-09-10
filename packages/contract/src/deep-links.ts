import { originOf } from "./url.js";
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById, findApplicationByOrigin } from "./application-ecosystem.js";

/**
 * Safe internal deep-link model.
 * application://{appId}{/path...}  → known application + application-owned route
 */
export const APPLICATION_DEEP_LINK_SCHEME = "application";

export type DeepLinkParse =
  | { ok: true; appId: string; path: string }
  | { ok: false; code: "malformed_route" | "unknown_scheme"; detail: string };

export type DeepLinkResolve =
  | { ok: true; appId: string; origin: string; path: string; href: string }
  | { ok: false; code: "malformed_route" | "unknown_application" | "unknown_scheme"; detail: string };

export function parseApplicationDeepLink(value: string): DeepLinkParse {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, code: "malformed_route", detail: "Empty deep link." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "malformed_route", detail: "Deep link is not a valid URI." };
  }
  if (url.protocol !== `${APPLICATION_DEEP_LINK_SCHEME}:`) {
    return { ok: false, code: "unknown_scheme", detail: `Expected ${APPLICATION_DEEP_LINK_SCHEME}:// scheme.` };
  }
  const appId = url.hostname || url.pathname.replace(/^\/*/, "").split("/")[0] || "";
  if (!appId || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(appId)) {
    return { ok: false, code: "malformed_route", detail: "Deep link requires a valid appId." };
  }
  let path = "/";
  if (url.hostname) {
    path = url.pathname || "/";
  } else {
    const rest = url.pathname.replace(/^\/*/, "").split("/").slice(1).join("/");
    path = rest ? `/${rest}` : "/";
  }
  if (url.search) path += url.search;
  return { ok: true, appId, path };
}

export function resolveApplicationDeepLink(
  value: string,
  registry: readonly OSShellApplicationRecord[],
): DeepLinkResolve {
  const parsed = parseApplicationDeepLink(value);
  if (!parsed.ok) return parsed;
  const app = findApplicationById(registry, parsed.appId);
  if (!app) {
    return { ok: false, code: "unknown_application", detail: `No installed application ${parsed.appId}.` };
  }
  const base = originOf(app.origin);
  if (!base) {
    return { ok: false, code: "malformed_route", detail: "Application origin is invalid." };
  }
  const href = new URL(parsed.path || "/", `${base}/`).toString();
  return { ok: true, appId: app.appId, origin: app.origin, path: parsed.path, href };
}

/**
 * Explicit URL pattern claim. Does not hijack foreign origins.
 * Pattern host must match the application's own origin host.
 */
export function resolveUrlToApplication(
  href: string,
  registry: readonly OSShellApplicationRecord[],
): OSShellApplicationRecord | null {
  const origin = originOf(href);
  if (!origin) return null;
  const byOrigin = findApplicationByOrigin(registry, origin);
  if (byOrigin) return byOrigin;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  for (const app of registry) {
    const appOrigin = originOf(app.origin);
    if (!appOrigin) continue;
    for (const pattern of app.urlPatterns ?? []) {
      if (patternMatches(url, pattern, appOrigin)) return app;
    }
  }
  return null;
}

function patternMatches(url: URL, pattern: string, appOrigin: string): boolean {
  let patternUrl: URL;
  try {
    patternUrl = new URL(pattern.includes("*") ? pattern.replace(/\*/g, "x") : pattern);
  } catch {
    return false;
  }
  const owner = originOf(appOrigin);
  if (!owner || patternUrl.origin !== owner || url.origin !== owner) return false;
  const pathPattern = pattern.replace(owner, "");
  if (!pathPattern.includes("*")) return url.href === pattern || url.pathname === pathPattern;
  const escaped = pathPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url.pathname + url.search);
}

export function formatApplicationDeepLink(appId: string, path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${APPLICATION_DEEP_LINK_SCHEME}://${appId}${normalized === "/" ? "" : normalized}`;
}
