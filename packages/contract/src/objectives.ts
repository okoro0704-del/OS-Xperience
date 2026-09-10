/**
 * Universal Task & Workflow Launcher contract (1.7).
 * Human expresses an objective. Shell discovers the route. Application performs the work.
 * Objective ≠ Intent ≠ Capability ≠ Authorization. No task/workflow backend.
 */
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById } from "./application-ecosystem.js";
import {
  discoverActions,
  OS_SHELL_ACTION_LABELS,
  type OSShellActionAvailability,
} from "./actions.js";
import {
  validateContextReference,
  type OSShellContextReference,
  type OSShellContextType,
} from "./intent-context.js";
import { isOSShellIntent, type OSShellIntent } from "./intent-handlers.js";
import { jsonLeaksSecrets } from "./permissions.js";
import type { OSShellSession } from "./sessions.js";
import { defaultObjectiveDeclarationFor } from "./objective-defaults.js";
import {
  applyPreferenceRanking,
  preferencesToDefaultHandlerAppIds,
  type OSShellApplicationPreference,
} from "./preferences.js";

export const OS_SHELL_OBJECTIVE_TYPES = [
  "create",
  "open",
  "view",
  "edit",
  "share",
  "import",
  "export",
  "publish",
  "preview",
  "continue",
] as const;

export type OSShellObjectiveType = (typeof OS_SHELL_OBJECTIVE_TYPES)[number];

export const OS_SHELL_OBJECTIVE_AVAILABILITY = [
  "AVAILABLE",
  "PERMISSION_REQUIRED",
  "CONTEXT_REQUIRED",
  "UNAVAILABLE",
  "INCOMPATIBLE",
  "NOT_CONNECTED",
] as const;

export type OSShellObjectiveAvailability = (typeof OS_SHELL_OBJECTIVE_AVAILABILITY)[number];

/** Human-facing targets. Not an object database. */
export const OS_SHELL_OBJECTIVE_TARGETS = [
  "video",
  "music",
  "writing",
  "software",
  "note",
  "text",
  "asset",
  "project",
  "document",
  "file",
  "podcast",
  "voice",
  "course",
  "book",
  "digital_life",
  "this",
] as const;

export type OSShellObjectiveTarget = (typeof OS_SHELL_OBJECTIVE_TARGETS)[number] | string;

export interface OSShellObjective {
  type: OSShellObjectiveType;
  target?: string;
  context?: OSShellContextReference;
  label?: string;
}

/** Manifest discovery declaration. Declaration ≠ availability. */
export type OSShellObjectiveDeclaration = Partial<
  Record<OSShellObjectiveType, string[]>
>;

export interface OSShellObjectiveRoute {
  objective: OSShellObjective;
  appId: string;
  appName: string;
  /** Existing intent vocabulary for non-continue routes. */
  intent?: OSShellIntent;
  action?: OSShellIntent;
  routePath?: string;
  availability: OSShellObjectiveAvailability;
  reason?: string;
  requiredContextType?: OSShellContextType;
  sessionId?: string;
  sessionLabel?: string;
  score?: number;
  preferenceSource?: "EXPLICIT" | "RECENT_SUCCESS" | "DEFAULT";
  preferenceReason?: string;
}

export type ObjectiveReject =
  | "objective_invalid"
  | "objective_not_understood"
  | "objective_unavailable"
  | "context_invalid"
  | "secret_payload"
  | "malformed_payload"
  | "resume_unavailable";

const OBJECTIVE_TO_INTENT: Record<Exclude<OSShellObjectiveType, "continue">, OSShellIntent> = {
  create: "create",
  open: "open",
  view: "view",
  edit: "edit",
  share: "share",
  import: "import",
  export: "export",
  publish: "publish",
  preview: "view",
};

const TARGET_CONTEXT: Record<string, { type: OSShellContextType; subtype?: string }> = {
  video: { type: "asset", subtype: "VIDEO" },
  music: { type: "asset", subtype: "MUSIC" },
  writing: { type: "text" },
  note: { type: "text" },
  text: { type: "text" },
  article: { type: "text" },
  software: { type: "project", subtype: "SOFTWARE" },
  project: { type: "project" },
  asset: { type: "asset" },
  document: { type: "document" },
  file: { type: "file" },
  podcast: { type: "media", subtype: "PODCAST" },
  voice: { type: "media", subtype: "VOICE" },
  course: { type: "asset", subtype: "COURSE" },
  book: { type: "document", subtype: "BOOK" },
  digital_life: { type: "digital_life" },
};

export function objectiveDoesNotGrantCapability(): true {
  return true;
}

export function objectiveDoesNotGrantAuthorization(): true {
  return true;
}

export function objectiveIsNotIntent(): true {
  return true;
}

export function shellDoesNotOwnWorkflowExecution(): true {
  return true;
}

export function validateObjectiveDeclaration(input: unknown):
  | { ok: true; objectives: OSShellObjectiveDeclaration }
  | { ok: false; detail: string } {
  if (input == null) return { ok: true, objectives: {} };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, detail: "objectives declaration must be an object." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, detail: "objectives must not contain secrets." };
  }
  const raw = input as Record<string, unknown>;
  const objectives: OSShellObjectiveDeclaration = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(OS_SHELL_OBJECTIVE_TYPES as readonly string[]).includes(key)) {
      return { ok: false, detail: `Unknown objective type: ${key}.` };
    }
    if (!Array.isArray(value) || value.length > 24) {
      return { ok: false, detail: `Objective ${key} targets must be a short array.` };
    }
    const targets: string[] = [];
    for (const item of value) {
      if (typeof item !== "string" || !item.trim() || item.length > 40) {
        return { ok: false, detail: `Invalid target for ${key}.` };
      }
      targets.push(item.trim().toLowerCase());
    }
    objectives[key as OSShellObjectiveType] = targets;
  }
  return { ok: true, objectives };
}

export function validateObjective(input: unknown):
  | { ok: true; objective: OSShellObjective }
  | { ok: false; code: ObjectiveReject; detail: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "malformed_payload", detail: "Objective must be an object." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Objective must not contain secrets." };
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.type !== "string" || !(OS_SHELL_OBJECTIVE_TYPES as readonly string[]).includes(raw.type)) {
    return { ok: false, code: "objective_invalid", detail: "Unknown objective type." };
  }
  const objective: OSShellObjective = { type: raw.type as OSShellObjectiveType };
  if (raw.target != null) {
    if (typeof raw.target !== "string" || !raw.target.trim() || raw.target.length > 40) {
      return { ok: false, code: "objective_invalid", detail: "target is invalid." };
    }
    objective.target = raw.target.trim().toLowerCase();
  }
  if (raw.label != null) {
    if (typeof raw.label !== "string" || raw.label.length > 160) {
      return { ok: false, code: "objective_invalid", detail: "label is invalid." };
    }
    objective.label = raw.label;
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
    objective.context = validated.context;
  }
  return { ok: true, objective };
}

/** Deterministic natural-language-ish parser. No AI. */
export function parseObjectiveText(
  input: string,
  currentObject?: OSShellContextReference | null,
):
  | { ok: true; objective: OSShellObjective }
  | { ok: false; code: "objective_not_understood"; detail: string } {
  const text = input.trim().toLowerCase().replace(/[?.!]+$/g, "");
  if (!text || text.length > 200) {
    return { ok: false, code: "objective_not_understood", detail: "Empty or oversized objective." };
  }

  if (
    /^(continue|resume|keep working|open what i was doing|go back to my work|continue this|pick up where|where i left off|open what i was working on)$/.test(
      text,
    )
  ) {
    return { ok: true, objective: { type: "continue", label: "Continue" } };
  }

  if (/^(what can i do( with this)?|what can i do with it)$/.test(text)) {
    return {
      ok: true,
      objective: {
        type: "view",
        target: "this",
        context: currentObject ?? undefined,
        label: "What can I do with this?",
      },
    };
  }

  if (/^(what am i working on|show current work|current work)$/.test(text)) {
    return {
      ok: true,
      objective: {
        type: "continue",
        label: "Current work",
        context: currentObject ?? undefined,
      },
    };
  }

  const verbs: Array<{ re: RegExp; type: OSShellObjectiveType }> = [
    { re: /^(create|make|new|start)\b/, type: "create" },
    { re: /^(record)\b/, type: "create" },
    { re: /^(edit|modify|change)\b/, type: "edit" },
    { re: /^(view|watch|read|see)\b/, type: "view" },
    { re: /^(open)\b/, type: "open" },
    { re: /^(share|send)\b/, type: "share" },
    { re: /^(import)\b/, type: "import" },
    { re: /^(export)\b/, type: "export" },
    { re: /^(publish|release)\b/, type: "publish" },
    { re: /^(preview|pre-?view)\b/, type: "preview" },
  ];

  let type: OSShellObjectiveType | null = null;
  let rest = text;
  for (const verb of verbs) {
    if (verb.re.test(text)) {
      type = verb.type;
      rest = text.replace(verb.re, "").trim().replace(/^(a|an|the|my|this)\s+/, "");
      break;
    }
  }
  if (!type) {
    return { ok: false, code: "objective_not_understood", detail: "Unrecognized objective." };
  }

  if (!rest || rest === "this" || rest === "it" || rest === "that" || rest === "current" || rest === "my current project" || rest === "what i'm working on" || rest === "what i am working on") {
    if (currentObject) {
      return {
        ok: true,
        objective: {
          type,
          target: "this",
          context: currentObject,
          label: `${capitalize(type)} this`,
        },
      };
    }
    if (type === "continue") {
      return { ok: true, objective: { type: "continue", label: "Continue" } };
    }
    return {
      ok: true,
      objective: { type, target: "this", label: `${capitalize(type)} this` },
    };
  }

  const target = normalizeTargetToken(rest);
  return {
    ok: true,
    objective: {
      type,
      target,
      label: `${capitalize(type)} ${capitalize(target)}`,
    },
  };
}

function normalizeTargetToken(rest: string): string {
  const cleaned = rest.replace(/^(a|an|the|my)\s+/, "").trim();
  const aliases: Record<string, string> = {
    videos: "video",
    songs: "music",
    song: "music",
    audio: "music",
    notes: "note",
    article: "writing",
    articles: "writing",
    docs: "document",
    app: "software",
    apps: "software",
    "digital life": "digital_life",
    digitallife: "digital_life",
    library: "digital_life",
  };
  if (aliases[cleaned]) return aliases[cleaned];
  if (cleaned.includes("digital life")) return "digital_life";
  if (cleaned.includes("video")) return "video";
  if (cleaned.includes("music")) return "music";
  if (cleaned.includes("software") || cleaned.includes("project")) return "software";
  if (cleaned.includes("note")) return "note";
  if (cleaned.includes("writing") || cleaned.includes("article")) return "writing";
  if (cleaned.includes("podcast")) return "podcast";
  if (cleaned.includes("course")) return "course";
  if (cleaned.includes("book")) return "book";
  if (cleaned.includes("asset")) return "asset";
  return cleaned.split(/\s+/)[0] ?? cleaned;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export { defaultObjectiveDeclarationFor } from "./objective-defaults.js";

export function objectiveIntentFor(type: OSShellObjectiveType): OSShellIntent | null {
  if (type === "continue") return null;
  return OBJECTIVE_TO_INTENT[type];
}

export function contextStubForTarget(target?: string): OSShellContextReference | null {
  if (!target || target === "this" || target === "*") return null;
  const mapped = TARGET_CONTEXT[target];
  if (!mapped) return null;
  return {
    type: mapped.type,
    title: capitalize(target),
    subtype: mapped.subtype,
    lifetime: "EPHEMERAL",
  };
}

function declarationFor(app: OSShellApplicationRecord): OSShellObjectiveDeclaration {
  if (app.objectives && Object.keys(app.objectives).length) return app.objectives;
  return defaultObjectiveDeclarationFor(app.appId);
}

function targetMatches(declared: string[] | undefined, target?: string): boolean {
  if (!declared?.length) return false;
  if (declared.includes("*")) return true;
  if (!target || target === "this") return true;
  return declared.some((item) => item === target || item === "*");
}

function mapActionAvailability(value: OSShellActionAvailability): OSShellObjectiveAvailability {
  if (value === "AVAILABLE") return "AVAILABLE";
  if (value === "PERMISSION_REQUIRED") return "PERMISSION_REQUIRED";
  if (value === "NOT_CONNECTED") return "NOT_CONNECTED";
  if (value === "INCOMPATIBLE") return "INCOMPATIBLE";
  return "UNAVAILABLE";
}

export function discoverObjectiveRoutes(input: {
  objective: OSShellObjective;
  registry: readonly OSShellApplicationRecord[];
  selectedObject?: OSShellContextReference | null;
  sessions?: readonly OSShellSession[];
  /** Dynamic provider hints — e.g. { softwareRuntime: false }. */
  runtimeHints?: {
    softwareRuntime?: boolean;
    connectedAppIds?: string[];
    grantedCapabilitiesByOrigin?: Record<string, string[]>;
  };
  defaultHandlerAppIds?: Partial<Record<string, string>>;
  preferences?: readonly OSShellApplicationPreference[];
  /** 1.9 operating place — reference only; always revalidated by caller. */
  operatingContext?: {
    currentAppId?: string;
    sessionId?: string;
    objectReference?: OSShellContextReference;
    label?: string;
  } | null;
}):
  | { ok: true; routes: OSShellObjectiveRoute[]; grantsAuthorization: false; grantsCapability: false }
  | { ok: false; code: ObjectiveReject; detail: string } {
  const validated = validateObjective(input.objective);
  if (!validated.ok) return validated;
  const objective = validated.objective;
  const routes: OSShellObjectiveRoute[] = [];

  if (objective.type === "continue") {
    const op = input.operatingContext;
    if (op?.currentAppId) {
      const app = findApplicationById(input.registry, op.currentAppId);
      if (app) {
        const label = op.label ?? `Continue in ${app.name}`;
        routes.push({
          objective: {
            type: "continue",
            label,
            context: op.objectReference ?? objective.context,
          },
          appId: app.appId,
          appName: app.name,
          availability: "AVAILABLE",
          sessionId: op.sessionId,
          sessionLabel: label,
          score: 100,
          preferenceReason: "Current operating context",
        });
      } else {
        routes.push({
          objective: { type: "continue", label: op.label ?? "Continue", context: op.objectReference },
          appId: op.currentAppId,
          appName: op.currentAppId,
          availability: "UNAVAILABLE",
          reason: "application_unavailable",
          sessionId: op.sessionId,
          score: 5,
        });
      }
    }
    const sessions = (input.sessions ?? []).filter((item) => item.state !== "ENDED");
    for (const session of sessions.slice(0, 8)) {
      const appId = session.context.activeApplicationId ?? session.resumePoints[0]?.appId;
      const app = appId ? findApplicationById(input.registry, appId) : null;
      if (!app) continue;
      if (op?.currentAppId && app.appId === op.currentAppId && op.sessionId === session.sessionId) continue;
      const label = session.context.label ?? session.resumePoints[0]?.label ?? `Continue in ${app.name}`;
      routes.push({
        objective: { type: "continue", label, context: session.context.activeContext },
        appId: app.appId,
        appName: app.name,
        availability: "AVAILABLE",
        sessionId: session.sessionId,
        sessionLabel: label,
        score: session.state === "ACTIVE" ? 95 : 80,
      });
    }
    if (!routes.length) {
      for (const app of input.registry) {
        if (!app.resumeSupport?.supported) continue;
        const declared = declarationFor(app);
        if (!targetMatches(declared.continue, "*")) continue;
        routes.push({
          objective: { type: "continue", label: `Continue in ${app.name}` },
          appId: app.appId,
          appName: app.name,
          availability: "UNAVAILABLE",
          reason: "resume_unavailable",
          score: 10,
        });
      }
    }
    return {
      ok: true,
      routes: rankObjectiveRoutes(routes, objective, input),
      grantsAuthorization: false,
      grantsCapability: false,
    };
  }

  const intent = objectiveIntentFor(objective.type);
  if (!intent) {
    return { ok: false, code: "objective_invalid", detail: "Objective has no intent mapping." };
  }

  const context =
    objective.context ??
    (objective.target === "this" ? input.selectedObject ?? null : null) ??
    contextStubForTarget(objective.target);

  if ((objective.target === "this" || !objective.target) && !context && needsContext(objective.type)) {
    for (const app of input.registry) {
      const declared = declarationFor(app);
      if (!targetMatches(declared[objective.type], objective.target ?? "*")) continue;
      routes.push({
        objective: { ...objective, label: objective.label ?? `${capitalize(objective.type)}…` },
        appId: app.appId,
        appName: app.name,
        intent,
        action: intent,
        availability: "CONTEXT_REQUIRED",
        reason: "context_required",
        requiredContextType: preferredContextType(objective.target),
        routePath: handlerRoute(app, intent),
        score: 20,
      });
    }
    return {
      ok: true,
      routes: rankObjectiveRoutes(routes, objective, input),
      grantsAuthorization: false,
      grantsCapability: false,
    };
  }

  for (const app of input.registry) {
    const declared = declarationFor(app);
    if (!targetMatches(declared[objective.type], objective.target)) continue;

    let availability: OSShellObjectiveAvailability = "AVAILABLE";
    let reason: string | undefined;

    if (
      objective.type === "preview" &&
      objective.target === "software" &&
      input.runtimeHints?.softwareRuntime !== true
    ) {
      availability = "UNAVAILABLE";
      reason = "runtime_unavailable";
    }

    const objectForDiscovery =
      context ??
      ({
        type: preferredContextType(objective.target) ?? "asset",
        title: objective.label ?? capitalize(objective.target ?? objective.type),
        subtype: TARGET_CONTEXT[objective.target ?? ""]?.subtype,
        originAppId: app.appId,
        lifetime: "EPHEMERAL",
      } satisfies OSShellContextReference);

    const discovered = discoverActions({
      object: objectForDiscovery,
      registry: [app],
      grantedCapabilitiesByOrigin: input.runtimeHints?.grantedCapabilitiesByOrigin,
    });

    if (discovered.ok) {
      const match = discovered.actions.find((item) => item.action.id === intent);
      if (match) {
        if (availability === "AVAILABLE") {
          availability = mapActionAvailability(match.availability);
          if (match.availability !== "AVAILABLE") reason = match.availability.toLowerCase();
        }
      } else if (!app.intentHandlers?.some((handler) => handler.intent === intent)) {
        // Declaration without handler stays discoverable but incompatible for execution.
        if (availability === "AVAILABLE") {
          availability = "INCOMPATIBLE";
          reason = "handler_missing";
        }
      }
    }

    if (
      input.runtimeHints?.connectedAppIds &&
      !input.runtimeHints.connectedAppIds.includes(app.appId) &&
      availability === "AVAILABLE"
    ) {
      // Still launchable via install — keep AVAILABLE for installed apps.
    }

    const scoreBase =
      (objective.target && declared[objective.type]?.includes(objective.target) ? 40 : 20) +
      (availability === "AVAILABLE" ? 30 : availability === "PERMISSION_REQUIRED" ? 15 : 0);

    routes.push({
      objective: {
        ...objective,
        context: context ?? undefined,
        label:
          objective.label ??
          `${capitalize(objective.type)}${objective.target ? ` ${capitalize(objective.target)}` : ""}`,
      },
      appId: app.appId,
      appName: app.name,
      intent,
      action: intent,
      routePath: handlerRoute(app, intent),
      availability,
      reason,
      requiredContextType: context ? undefined : preferredContextType(objective.target),
      score: scoreBase,
    });
  }

  return {
    ok: true,
    routes: rankObjectiveRoutes(routes, objective, input),
    grantsAuthorization: false,
    grantsCapability: false,
  };
}

function needsContext(type: OSShellObjectiveType): boolean {
  return type === "edit" || type === "share" || type === "publish" || type === "export" || type === "preview" || type === "view";
}

function preferredContextType(target?: string): OSShellContextType | undefined {
  if (!target || target === "this") return undefined;
  return TARGET_CONTEXT[target]?.type;
}

function handlerRoute(app: OSShellApplicationRecord, intent: OSShellIntent): string {
  const handler = app.intentHandlers?.find((item) => item.intent === intent);
  return handler?.route ?? "/";
}

export function rankObjectiveRoutes(
  routes: OSShellObjectiveRoute[],
  objective: OSShellObjective,
  input: {
    selectedObject?: OSShellContextReference | null;
    sessions?: readonly OSShellSession[];
    defaultHandlerAppIds?: Partial<Record<string, string>>;
    preferences?: readonly OSShellApplicationPreference[];
    operatingContext?: {
      currentAppId?: string;
      sessionId?: string;
      objectReference?: OSShellContextReference;
      label?: string;
    } | null;
  },
): OSShellObjectiveRoute[] {
  const activeApp =
    input.operatingContext?.currentAppId ??
    input.sessions?.find((item) => item.state === "ACTIVE")?.context.activeApplicationId;
  const fromPrefs = input.preferences ? preferencesToDefaultHandlerAppIds(input.preferences) : {};
  const preferred =
    input.defaultHandlerAppIds?.[`${objective.type}:${objective.target ?? ""}`] ??
    fromPrefs[`${objective.type}:${objective.target ?? ""}`] ??
    input.defaultHandlerAppIds?.[objective.type] ??
    fromPrefs[objective.type];

  const base = [...routes]
    .map((route) => {
      let score = route.score ?? 0;
      if (objective.target && route.objective.target === objective.target) score += 25;
      if (route.objective.context?.type && input.selectedObject?.type === route.objective.context.type) score += 15;
      if (input.operatingContext?.objectReference && route.objective.context?.id === input.operatingContext.objectReference.id) {
        score += 18;
      }
      if (activeApp && route.appId === activeApp) score += 12;
      if (preferred && route.appId === preferred) score += 20;
      if (route.availability === "AVAILABLE") score += 8;
      if (route.appId === "mybrandos" || route.appId === "lifeos") score += 2;
      score += Math.max(0, 5 - route.appId.length / 10);
      return { ...route, score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.appId.localeCompare(b.appId));

  if (!input.preferences?.length) return base;
  return applyPreferenceRanking({ routes: base, objective, preferences: input.preferences });
}

export function suggestObjectives(input: {
  registry: readonly OSShellApplicationRecord[];
  selectedObject?: OSShellContextReference | null;
  sessions?: readonly OSShellSession[];
  runtimeHints?: {
    softwareRuntime?: boolean;
    grantedCapabilitiesByOrigin?: Record<string, string[]>;
  };
  preferences?: readonly OSShellApplicationPreference[];
  operatingContext?: {
    currentAppId?: string;
    sessionId?: string;
    objectReference?: OSShellContextReference;
    label?: string;
  } | null;
}): OSShellObjectiveRoute[] {
  const suggestions: OSShellObjectiveRoute[] = [];
  const templates: OSShellObjective[] = [
    { type: "create", target: "video", label: "Create Video" },
    { type: "create", target: "note", label: "Create Note" },
    { type: "preview", target: "software", label: "Preview Software" },
    { type: "continue", label: "Continue" },
    { type: "open", target: "digital_life", label: "Open Digital Life" },
  ];
  if (input.selectedObject) {
    templates.unshift(
      { type: "edit", target: "this", context: input.selectedObject, label: "Edit this" },
      { type: "share", target: "this", context: input.selectedObject, label: "Share this" },
      { type: "publish", target: "this", context: input.selectedObject, label: "Publish this" },
      { type: "preview", target: "this", context: input.selectedObject, label: "Preview this" },
    );
  }
  for (const objective of templates) {
    const discovered = discoverObjectiveRoutes({
      objective,
      registry: input.registry,
      selectedObject: input.selectedObject,
      sessions: input.sessions,
      runtimeHints: input.runtimeHints,
      preferences: input.preferences,
      operatingContext: input.operatingContext,
    });
    if (!discovered.ok) continue;
    const top = discovered.routes[0];
    if (top) suggestions.push(top);
  }
  const seen = new Set<string>();
  return suggestions.filter((item) => {
    const key = `${item.objective.type}:${item.objective.target ?? ""}:${item.appId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

export function resolveObjectiveFromText(input: {
  text: string;
  registry: readonly OSShellApplicationRecord[];
  selectedObject?: OSShellContextReference | null;
  sessions?: readonly OSShellSession[];
  runtimeHints?: {
    softwareRuntime?: boolean;
    grantedCapabilitiesByOrigin?: Record<string, string[]>;
  };
  defaultHandlerAppIds?: Partial<Record<string, string>>;
  preferences?: readonly OSShellApplicationPreference[];
  operatingContext?: {
    currentAppId?: string;
    sessionId?: string;
    objectReference?: OSShellContextReference;
    label?: string;
  } | null;
}):
  | {
      ok: true;
      objective: OSShellObjective;
      routes: OSShellObjectiveRoute[];
      grantsAuthorization: false;
      grantsCapability: false;
    }
  | { ok: false; code: ObjectiveReject; detail: string } {
  const parsed = parseObjectiveText(input.text, input.selectedObject);
  if (!parsed.ok) return parsed;
  const discovered = discoverObjectiveRoutes({
    objective: parsed.objective,
    registry: input.registry,
    selectedObject: input.selectedObject,
    sessions: input.sessions,
    runtimeHints: input.runtimeHints,
    defaultHandlerAppIds: input.defaultHandlerAppIds,
    preferences: input.preferences,
    operatingContext: input.operatingContext,
  });
  if (!discovered.ok) return discovered;
  return {
    ok: true,
    objective: parsed.objective,
    routes: discovered.routes,
    grantsAuthorization: false,
    grantsCapability: false,
  };
}

export function objectiveRouteToSearchResult(route: OSShellObjectiveRoute): {
  type: "objective";
  title: string;
  subtitle?: string;
  appId: string;
  action?: OSShellIntent;
  context?: OSShellContextReference;
  score?: number;
} {
  return {
    type: "objective",
    title: route.objective.label ?? `${capitalize(route.objective.type)} ${route.objective.target ?? ""}`.trim(),
    subtitle: `${route.appName} · ${route.availability}${route.reason ? ` · ${route.reason}` : ""}`,
    appId: route.appId,
    action: route.intent,
    context: route.objective.context,
    score: route.score,
  };
}

export function startObjectiveDoesNotExecuteWork(): true {
  return true;
}

export function objectiveLabel(objective: OSShellObjective): string {
  if (objective.label) return objective.label;
  if (objective.type === "continue") return "Continue";
  const action = OS_SHELL_ACTION_LABELS[objectiveIntentFor(objective.type) ?? "open"];
  return `${action}${objective.target ? ` ${capitalize(objective.target)}` : ""}`;
}

export function isObjectiveType(value: string): value is OSShellObjectiveType {
  return (OS_SHELL_OBJECTIVE_TYPES as readonly string[]).includes(value);
}
