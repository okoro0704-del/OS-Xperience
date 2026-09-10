/**
 * Universal Search & Discovery contract (1.6).
 * Shell coordinates discovery. Applications own searchable data.
 * Search Result ≠ Ownership ≠ Authorization ≠ Execution.
 */
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById } from "./application-ecosystem.js";
import {
  OS_SHELL_ACTION_LABELS,
  discoverActions,
  type OSShellActionId,
} from "./actions.js";
import {
  validateContextReference,
  type OSShellContextReference,
  type OSShellContextType,
  OS_SHELL_CONTEXT_TYPES,
} from "./intent-context.js";
import { isOSShellIntent, type OSShellIntent } from "./intent-handlers.js";
import { jsonLeaksSecrets } from "./permissions.js";
import type { OSShellSession } from "./sessions.js";
import { resolveObjectiveFromText, objectiveRouteToSearchResult } from "./objectives.js";

export const OS_SHELL_SEARCH_RESULT_TYPES = ["application", "object", "action", "objective"] as const;
export type OSShellSearchResultType = (typeof OS_SHELL_SEARCH_RESULT_TYPES)[number];

export const OS_SHELL_SEARCH_SCOPES = [
  "all",
  "applications",
  "objects",
  "actions",
  "current_app",
  "current_session",
] as const;
export type OSShellSearchScope = (typeof OS_SHELL_SEARCH_SCOPES)[number];

export const OS_SHELL_SEARCH_PROVIDER_STATES = [
  "SEARCH_AVAILABLE",
  "SEARCH_UNAVAILABLE",
  "SEARCH_NOT_SUPPORTED",
  "SEARCH_INCOMPATIBLE",
] as const;
export type OSShellSearchProviderState = (typeof OS_SHELL_SEARCH_PROVIDER_STATES)[number];

export const SEARCH_LIMITS = {
  maxQuery: 200,
  maxResults: 40,
  maxPerProvider: 12,
  maxTitle: 160,
  maxSubtitle: 240,
  maxProviders: 16,
  providerTimeoutMs: 800,
} as const;

export interface OSShellSearchQuery {
  query: string;
  types?: OSShellSearchResultType[];
  appIds?: string[];
  limit?: number;
  scope?: OSShellSearchScope;
}

export interface OSShellSearchContext {
  currentApplication?: string;
  currentObjectType?: string;
  currentSessionId?: string;
}

export interface OSShellSearchResult {
  type: OSShellSearchResultType;
  title: string;
  subtitle?: string;
  appId?: string;
  context?: OSShellContextReference;
  action?: OSShellIntent;
  /** Optional freshness hint — never private payload. */
  resultTimestamp?: string;
  score?: number;
}

export interface OSShellSearchProviderDeclaration {
  supportedTypes: Array<"application" | "object" | OSShellContextType>;
}

export type SearchReject =
  | "search_query_invalid"
  | "search_result_invalid"
  | "secret_payload"
  | "oversized_query"
  | "malformed_payload"
  | "provider_unavailable"
  | "provider_timeout"
  | "context_invalid";

export function validateSearchQuery(input: unknown):
  | { ok: true; query: OSShellSearchQuery }
  | { ok: false; code: SearchReject; detail: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "malformed_payload", detail: "Search query must be an object." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Search query must not contain secrets." };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.query !== "string") {
    return { ok: false, code: "search_query_invalid", detail: "query must be a string." };
  }
  const query = raw.query.trim();
  if (query.length > SEARCH_LIMITS.maxQuery) {
    return { ok: false, code: "oversized_query", detail: "query exceeds length limit." };
  }
  let types: OSShellSearchResultType[] | undefined;
  if (raw.types != null) {
    if (!Array.isArray(raw.types)) {
      return { ok: false, code: "search_query_invalid", detail: "types must be an array." };
    }
    types = [];
    for (const item of raw.types) {
      if (typeof item !== "string" || !(OS_SHELL_SEARCH_RESULT_TYPES as readonly string[]).includes(item)) {
        return { ok: false, code: "search_query_invalid", detail: `Unknown result type: ${String(item)}.` };
      }
      types.push(item as OSShellSearchResultType);
    }
  }
  let appIds: string[] | undefined;
  if (raw.appIds != null) {
    if (!Array.isArray(raw.appIds) || raw.appIds.length > SEARCH_LIMITS.maxProviders) {
      return { ok: false, code: "search_query_invalid", detail: "appIds is invalid." };
    }
    appIds = [];
    for (const id of raw.appIds) {
      if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(id)) {
        return { ok: false, code: "search_query_invalid", detail: "Invalid appId in query." };
      }
      appIds.push(id);
    }
  }
  let limit: number = SEARCH_LIMITS.maxResults;
  if (raw.limit != null) {
    if (typeof raw.limit !== "number" || !Number.isFinite(raw.limit) || raw.limit < 1) {
      return { ok: false, code: "search_query_invalid", detail: "limit must be a positive number." };
    }
    limit = Math.min(Math.floor(raw.limit), SEARCH_LIMITS.maxResults);
  }
  let scope: OSShellSearchScope = "all";
  if (raw.scope != null) {
    if (typeof raw.scope !== "string" || !(OS_SHELL_SEARCH_SCOPES as readonly string[]).includes(raw.scope)) {
      return { ok: false, code: "search_query_invalid", detail: "Unknown search scope." };
    }
    scope = raw.scope as OSShellSearchScope;
  }
  return { ok: true, query: { query, types, appIds, limit, scope } };
}

export function validateSearchResult(input: unknown):
  | { ok: true; result: OSShellSearchResult }
  | { ok: false; code: SearchReject; detail: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "search_result_invalid", detail: "Result must be an object." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Search result must not contain secrets." };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.type !== "string" || !(OS_SHELL_SEARCH_RESULT_TYPES as readonly string[]).includes(raw.type)) {
    return { ok: false, code: "search_result_invalid", detail: "Unknown result type." };
  }
  if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > SEARCH_LIMITS.maxTitle) {
    return { ok: false, code: "search_result_invalid", detail: "title is required and limited." };
  }
  const result: OSShellSearchResult = {
    type: raw.type as OSShellSearchResultType,
    title: raw.title.trim(),
  };
  if (raw.subtitle != null) {
    if (typeof raw.subtitle !== "string" || raw.subtitle.length > SEARCH_LIMITS.maxSubtitle) {
      return { ok: false, code: "search_result_invalid", detail: "subtitle exceeds limit." };
    }
    result.subtitle = raw.subtitle;
  }
  if (raw.appId != null) {
    if (typeof raw.appId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(raw.appId)) {
      return { ok: false, code: "search_result_invalid", detail: "appId is invalid." };
    }
    result.appId = raw.appId;
  }
  if (raw.action != null) {
    if (typeof raw.action !== "string" || !isOSShellIntent(raw.action)) {
      return { ok: false, code: "search_result_invalid", detail: "action must be a known intent." };
    }
    result.action = raw.action;
  }
  if (raw.context != null) {
    const validated = validateContextReference(raw.context);
    if (!validated.ok) {
      return {
        ok: false,
        code: validated.code === "secret_payload" ? "secret_payload" : "context_invalid",
        detail: validated.detail,
      };
    }
    result.context = validated.context;
  }
  if (raw.resultTimestamp != null) {
    if (typeof raw.resultTimestamp !== "string" || raw.resultTimestamp.length > 40) {
      return { ok: false, code: "search_result_invalid", detail: "resultTimestamp is invalid." };
    }
    result.resultTimestamp = raw.resultTimestamp;
  }
  if (result.type === "object" && !result.context) {
    return { ok: false, code: "search_result_invalid", detail: "object results require a context reference." };
  }
  if (result.type === "action" && !result.action) {
    return { ok: false, code: "search_result_invalid", detail: "action results require an action id." };
  }
  if (result.type === "application" && !result.appId) {
    return { ok: false, code: "search_result_invalid", detail: "application results require appId." };
  }
  if (result.type === "objective" && !result.appId) {
    return { ok: false, code: "search_result_invalid", detail: "objective results require appId." };
  }
  return { ok: true, result };
}

export function validateSearchResults(input: unknown):
  | { ok: true; results: OSShellSearchResult[] }
  | { ok: false; code: SearchReject; detail: string } {
  if (!Array.isArray(input)) {
    return { ok: false, code: "search_result_invalid", detail: "Results must be an array." };
  }
  if (input.length > SEARCH_LIMITS.maxPerProvider) {
    return { ok: false, code: "search_result_invalid", detail: "Too many provider results." };
  }
  const results: OSShellSearchResult[] = [];
  for (const item of input) {
    const validated = validateSearchResult(item);
    if (!validated.ok) return validated;
    results.push(validated.result);
  }
  return { ok: true, results };
}

export function validateSearchProviderDeclaration(input: unknown):
  | { ok: true; search: OSShellSearchProviderDeclaration }
  | { ok: false; detail: string } {
  if (input == null) return { ok: true, search: { supportedTypes: [] } };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, detail: "search declaration must be an object." };
  }
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.supportedTypes) || raw.supportedTypes.length > 16) {
    return { ok: false, detail: "supportedTypes must be a short array." };
  }
  const supportedTypes: OSShellSearchProviderDeclaration["supportedTypes"] = [];
  for (const item of raw.supportedTypes) {
    if (item === "application" || item === "object") {
      supportedTypes.push(item);
      continue;
    }
    if (typeof item === "string" && (OS_SHELL_CONTEXT_TYPES as readonly string[]).includes(item)) {
      supportedTypes.push(item as OSShellContextType);
      continue;
    }
    return { ok: false, detail: `Unsupported search type: ${String(item)}.` };
  }
  return { ok: true, search: { supportedTypes } };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function scoreMatch(query: string, candidate: string, boost = 0): number {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q) return 0;
  if (c === q) return 100 + boost;
  if (c.startsWith(q)) return 80 + boost;
  if (c.includes(q)) return 50 + boost;
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length && parts.every((part) => c.includes(part))) return 35 + boost;
  return 0;
}

export function searchDoesNotGrantAuthorization(): true {
  return true;
}

export function searchDoesNotGrantCapability(): true {
  return true;
}

export function searchResultDoesNotImplyOwnership(): true {
  return true;
}

export function discoveryDoesNotEqualExecution(): true {
  return true;
}

/** Shell-owned search only — applications, sessions, actions, current context. */
export function searchShellOwned(input: {
  query: OSShellSearchQuery;
  registry: readonly OSShellApplicationRecord[];
  sessions?: readonly OSShellSession[];
  selectedObject?: OSShellContextReference | null;
  searchContext?: OSShellSearchContext;
}): OSShellSearchResult[] {
  const q = input.query.query;
  const scope = input.query.scope ?? "all";
  const want = (type: OSShellSearchResultType) =>
    !input.query.types?.length || input.query.types.includes(type);
  const appFilter = input.query.appIds;
  const results: OSShellSearchResult[] = [];

  if (want("application") && (scope === "all" || scope === "applications" || scope === "current_app")) {
    for (const app of input.registry) {
      if (appFilter && !appFilter.includes(app.appId)) continue;
      if (scope === "current_app" && app.appId !== input.searchContext?.currentApplication) continue;
      const score =
        scoreMatch(q, app.name, 20) ||
        scoreMatch(q, app.appId, 10) ||
        scoreMatch(q, app.purpose ?? "", 0);
      if (!q || score > 0) {
        results.push({
          type: "application",
          title: app.name,
          subtitle: `${app.source} · ${app.trustState}${app.purpose ? ` · ${app.purpose}` : ""}`,
          appId: app.appId,
          score: score || (q ? 0 : 10),
        });
      }
    }
  }

  if (want("object") && (scope === "all" || scope === "objects" || scope === "current_session")) {
    const selected = input.selectedObject;
    if (selected) {
      const title = selected.title ?? selected.id ?? selected.type;
      const score = scoreMatch(q, title, 15) || scoreMatch(q, selected.type, 5);
      if (!q || score > 0) {
        results.push({
          type: "object",
          title,
          subtitle: `Current · ${selected.type}${selected.subtype ? ` · ${selected.subtype}` : ""}`,
          appId: selected.originAppId ?? selected.appId,
          context: selected,
          score: score || 12,
        });
      }
    }
    for (const session of input.sessions ?? []) {
      if (session.state === "ENDED") continue;
      if (scope === "current_session" && session.sessionId !== input.searchContext?.currentSessionId) continue;
      const ctx = session.context.activeContext;
      if (!ctx) continue;
      const title = ctx.title ?? session.context.label ?? ctx.type;
      const score = scoreMatch(q, title, 8) || scoreMatch(q, session.context.label ?? "", 5);
      if (!q || score > 0) {
        results.push({
          type: "object",
          title,
          subtitle: `Session · ${ctx.type}`,
          appId: session.context.activeApplicationId ?? ctx.originAppId,
          context: ctx,
          score: score || 8,
        });
      }
    }
  }

  if (want("action") && (scope === "all" || scope === "actions")) {
    const object = input.selectedObject;
    if (object) {
      const discovered = discoverActions({ object, registry: input.registry });
      if (discovered.ok) {
        for (const item of discovered.actions) {
          if (item.availability === "INCOMPATIBLE") continue;
          const label = item.action.label;
          const score =
            scoreMatch(q, label, 12) ||
            scoreMatch(q, item.action.id, 10) ||
            scoreMatch(q, `${label} ${object.title ?? object.type}`, 6);
          const typeBoost =
            input.searchContext?.currentObjectType === object.type && scoreMatch(q, "edit") > 0 ? 8 : 0;
          if (!q || score > 0) {
            results.push({
              type: "action",
              title: `${label}${object.title ? ` — ${object.title}` : ""}`,
              subtitle: `${item.handler.name} · ${item.availability}`,
              appId: item.handler.appId,
              action: item.action.id,
              context: object,
              score: (score || 5) + typeBoost,
            });
          }
        }
      }
    } else if (q) {
      for (const [id, label] of Object.entries(OS_SHELL_ACTION_LABELS) as Array<[OSShellActionId, string]>) {
        const score = scoreMatch(q, label, 5) || scoreMatch(q, id, 5);
        if (score > 0) {
          results.push({
            type: "action",
            title: label,
            subtitle: "Registered action",
            action: id,
            score,
          });
        }
      }
    }
  }

  if (want("objective") && (scope === "all" || scope === "actions") && q) {
    const resolved = resolveObjectiveFromText({
      text: q,
      registry: input.registry,
      selectedObject: input.selectedObject,
      sessions: input.sessions,
    });
    if (resolved.ok) {
      for (const route of resolved.routes.slice(0, 8)) {
        const mapped = objectiveRouteToSearchResult(route);
        results.push({
          type: "objective",
          title: mapped.title,
          subtitle: mapped.subtitle,
          appId: mapped.appId,
          action: mapped.action,
          context: mapped.context,
          score: mapped.score ?? 40,
        });
      }
    }
  }

  return results.filter((item) => (item.score ?? 0) > 0 || !q);
}

/**
 * Safe public sample results for federated demos when a live provider is unavailable.
 * Not a Digital Life index — fixed public samples only.
 */
export function defaultSearchSeedsFor(appId: string): OSShellSearchResult[] {
  if (appId === "shell-demo-notes") {
    return [
      {
        type: "object",
        title: "Meeting Notes",
        subtitle: "text · Shell Demo Notes",
        appId: "shell-demo-notes",
        context: {
          type: "text",
          title: "Meeting Notes",
          text: "Meeting notes sample",
          originAppId: "shell-demo-notes",
          lifetime: "EPHEMERAL",
        },
      },
      {
        type: "object",
        title: "Example Article",
        subtitle: "text · Shell Demo Notes",
        appId: "shell-demo-notes",
        context: {
          type: "text",
          title: "Example Article",
          text: "Article draft sample",
          originAppId: "shell-demo-notes",
          lifetime: "EPHEMERAL",
        },
      },
    ];
  }
  if (appId === "mybrandos") {
    return [
      {
        type: "object",
        title: "Example Video",
        subtitle: "asset · VIDEO · mybrandOS",
        appId: "mybrandos",
        context: {
          type: "asset",
          id: "example-video",
          title: "Example Video",
          subtype: "VIDEO",
          originAppId: "mybrandos",
          metadata: { assetType: "VIDEO" },
          lifetime: "EPHEMERAL",
        },
      },
      {
        type: "object",
        title: "Example Software Project",
        subtitle: "project · mybrandOS",
        appId: "mybrandos",
        context: {
          type: "project",
          id: "example-software",
          title: "Example Software Project",
          originAppId: "mybrandos",
          lifetime: "EPHEMERAL",
        },
      },
      {
        type: "object",
        title: "Launch Promo",
        subtitle: "asset · VIDEO · mybrandOS",
        appId: "mybrandos",
        context: {
          type: "asset",
          id: "launch-promo",
          title: "Launch Promo",
          subtype: "VIDEO",
          originAppId: "mybrandos",
          metadata: { assetType: "VIDEO" },
          lifetime: "EPHEMERAL",
        },
      },
    ];
  }
  if (appId === "lifeos") {
    return [
      {
        type: "object",
        title: "Example Video",
        subtitle: "asset · LifeOS library",
        appId: "lifeos",
        context: {
          type: "asset",
          id: "lifeos-example-video",
          title: "Example Video",
          subtype: "VIDEO",
          originAppId: "lifeos",
          metadata: { assetType: "VIDEO" },
          lifetime: "EPHEMERAL",
        },
      },
      {
        type: "object",
        title: "Example Course",
        subtitle: "asset · LifeOS",
        appId: "lifeos",
        context: {
          type: "asset",
          id: "example-course",
          title: "Example Course",
          subtype: "COURSE",
          originAppId: "lifeos",
          lifetime: "EPHEMERAL",
        },
      },
    ];
  }
  return [];
}

export function providerStateFor(
  app: OSShellApplicationRecord | null | undefined,
  connected: boolean,
): OSShellSearchProviderState {
  if (!app) return "SEARCH_NOT_SUPPORTED";
  if (!app.search?.supportedTypes?.length) return "SEARCH_NOT_SUPPORTED";
  if (!connected && app.presence !== "INSTALLED" && app.presence !== "RUNNING") {
    return "SEARCH_UNAVAILABLE";
  }
  return connected || app.presence === "INSTALLED" || app.presence === "RUNNING"
    ? "SEARCH_AVAILABLE"
    : "SEARCH_UNAVAILABLE";
}

export function searchProviderSeeds(
  query: OSShellSearchQuery,
  registry: readonly OSShellApplicationRecord[],
): Array<{ appId: string; state: OSShellSearchProviderState; results: OSShellSearchResult[] }> {
  const q = query.query;
  const out: Array<{ appId: string; state: OSShellSearchProviderState; results: OSShellSearchResult[] }> = [];
  for (const app of registry) {
    if (query.appIds && !query.appIds.includes(app.appId)) continue;
    if (!app.search?.supportedTypes?.length) continue;
    const state = providerStateFor(app, false);
    if (state === "SEARCH_NOT_SUPPORTED") continue;
    const seeds = defaultSearchSeedsFor(app.appId)
      .map((item) => {
        const validated = validateSearchResult(item);
        return validated.ok ? validated.result : null;
      })
      .filter((item): item is OSShellSearchResult => Boolean(item))
      .filter((item) => {
        if (query.types?.length && !query.types.includes(item.type)) return false;
        if (!q) return true;
        return (
          scoreMatch(q, item.title) > 0 ||
          scoreMatch(q, item.subtitle ?? "") > 0 ||
          scoreMatch(q, item.context?.type ?? "") > 0
        );
      })
      .slice(0, SEARCH_LIMITS.maxPerProvider)
      .map((item) => ({
        ...item,
        score: scoreMatch(q, item.title, 5) || scoreMatch(q, item.subtitle ?? "", 0) || 4,
      }));
    out.push({ appId: app.appId, state, results: state === "SEARCH_AVAILABLE" ? seeds : [] });
  }
  return out;
}

export function mergeAndRankSearchResults(input: {
  shellResults: readonly OSShellSearchResult[];
  providerResults: readonly OSShellSearchResult[];
  searchContext?: OSShellSearchContext;
  limit?: number;
}): OSShellSearchResult[] {
  const merged = [...input.shellResults, ...input.providerResults].map((item) => {
    let score = item.score ?? 0;
    if (input.searchContext?.currentApplication && item.appId === input.searchContext.currentApplication) {
      score += 6;
    }
    if (
      input.searchContext?.currentObjectType &&
      item.context?.type === input.searchContext.currentObjectType
    ) {
      score += 6;
    }
    return { ...item, score };
  });
  merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title));
  const seen = new Set<string>();
  const deduped: OSShellSearchResult[] = [];
  for (const item of merged) {
    const key = `${item.type}:${item.appId ?? ""}:${item.action ?? ""}:${item.context?.id ?? item.context?.title ?? item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped.slice(0, input.limit ?? SEARCH_LIMITS.maxResults);
}

export function executeShellSearch(input: {
  query: unknown;
  registry: readonly OSShellApplicationRecord[];
  sessions?: readonly OSShellSession[];
  selectedObject?: OSShellContextReference | null;
  searchContext?: OSShellSearchContext;
  liveProviderResults?: readonly OSShellSearchResult[];
  providerStatuses?: Array<{ appId: string; state: OSShellSearchProviderState; detail?: string }>;
}):
  | {
      ok: true;
      query: OSShellSearchQuery;
      results: OSShellSearchResult[];
      providers: Array<{ appId: string; state: OSShellSearchProviderState; detail?: string }>;
      grantsAuthorization: false;
      grantsCapability: false;
    }
  | { ok: false; code: SearchReject; detail: string } {
  const validated = validateSearchQuery(input.query);
  if (!validated.ok) return validated;

  const shellResults = searchShellOwned({
    query: validated.query,
    registry: input.registry,
    sessions: input.sessions,
    selectedObject: input.selectedObject,
    searchContext: input.searchContext,
  });

  const seeded = searchProviderSeeds(validated.query, input.registry);
  const providers: Array<{ appId: string; state: OSShellSearchProviderState; detail?: string }> = seeded.map((item) => ({
    appId: item.appId,
    state: item.state,
    detail: item.state === "SEARCH_AVAILABLE" ? undefined : item.state.toLowerCase(),
  }));
  if (input.providerStatuses) {
    for (const status of input.providerStatuses) {
      const existing = providers.find((item) => item.appId === status.appId);
      if (existing) {
        existing.state = status.state;
        existing.detail = status.detail;
      } else {
        providers.push({ appId: status.appId, state: status.state, detail: status.detail });
      }
    }
  }

  const providerResults = [
    ...(input.liveProviderResults ?? []),
    ...seeded.flatMap((item) => (item.state === "SEARCH_AVAILABLE" ? item.results : [])),
  ];

  const results = mergeAndRankSearchResults({
    shellResults,
    providerResults,
    searchContext: input.searchContext,
    limit: validated.query.limit,
  });

  return {
    ok: true,
    query: validated.query,
    results,
    providers,
    grantsAuthorization: false,
    grantsCapability: false,
  };
}

export function groupSearchResults(results: readonly OSShellSearchResult[]): {
  applications: OSShellSearchResult[];
  objects: OSShellSearchResult[];
  actions: OSShellSearchResult[];
  objectives: OSShellSearchResult[];
} {
  return {
    applications: results.filter((item) => item.type === "application"),
    objects: results.filter((item) => item.type === "object"),
    actions: results.filter((item) => item.type === "action"),
    objectives: results.filter((item) => item.type === "objective"),
  };
}

export function searchResultActions(
  result: OSShellSearchResult,
  registry: readonly OSShellApplicationRecord[],
): Array<{ action: OSShellIntent; label: string; appId?: string }> {
  if (result.type === "application" && result.appId) {
    const app = findApplicationById(registry, result.appId);
    return app ? [{ action: "open", label: "Open", appId: app.appId }] : [];
  }
  if (result.type === "action" && result.action) {
    return [{ action: result.action, label: OS_SHELL_ACTION_LABELS[result.action], appId: result.appId }];
  }
  if (result.type === "objective" && result.appId) {
    if (result.action) {
      return [{ action: result.action, label: OS_SHELL_ACTION_LABELS[result.action] ?? "Start", appId: result.appId }];
    }
    return [{ action: "open", label: "Start", appId: result.appId }];
  }
  if (result.type === "object" && result.context) {
    const discovered = discoverActions({ object: result.context, registry });
    if (!discovered.ok) return [];
    const seen = new Set<string>();
    const out: Array<{ action: OSShellIntent; label: string; appId?: string }> = [];
    for (const item of discovered.actions) {
      if (seen.has(item.action.id)) continue;
      if (item.availability !== "AVAILABLE" && item.availability !== "PERMISSION_REQUIRED") continue;
      seen.add(item.action.id);
      out.push({ action: item.action.id, label: item.action.label, appId: item.handler.appId });
    }
    return out;
  }
  return [];
}
