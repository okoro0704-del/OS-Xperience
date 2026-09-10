/**
 * Intent handler declaration helpers — no registry dependency.
 */
import type { OSShellContextType } from "./intent-context.js";
import { OS_SHELL_CONTEXT_TYPES } from "./intent-context.js";

export const OS_SHELL_INTENTS = [
  "open",
  "view",
  "edit",
  "create",
  "share",
  "import",
  "export",
  "publish",
] as const;

export type OSShellIntent = (typeof OS_SHELL_INTENTS)[number];

export interface OSShellIntentHandler {
  intent: OSShellIntent;
  contextTypes: OSShellContextType[];
  route?: string;
}

export const INTENT_CONTEXT_COMPAT: Record<OSShellIntent, readonly OSShellContextType[]> = {
  open: ["asset", "document", "media", "project", "application", "url", "text", "file", "digital_life"],
  view: ["asset", "document", "media", "project", "url", "text", "file", "digital_life"],
  edit: ["asset", "document", "media", "project", "text", "file"],
  create: ["text", "document", "project", "asset", "media", "file"],
  share: ["asset", "document", "media", "text", "url", "file", "application"],
  import: ["url", "file", "text", "asset"],
  export: ["asset", "document", "media", "text", "file", "project"],
  publish: ["asset", "document", "media", "project", "text"],
};

export function isOSShellIntent(value: string): value is OSShellIntent {
  return (OS_SHELL_INTENTS as readonly string[]).includes(value);
}

export function validateIntentHandlers(
  input: unknown,
): { ok: true; handlers: OSShellIntentHandler[] } | { ok: false; detail: string } {
  if (input == null) return { ok: true, handlers: [] };
  if (!Array.isArray(input)) return { ok: false, detail: "intentHandlers must be an array." };
  if (input.length > 32) return { ok: false, detail: "Too many intent handlers." };
  const handlers: OSShellIntentHandler[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return { ok: false, detail: "Invalid intent handler." };
    const raw = item as Record<string, unknown>;
    if (typeof raw.intent !== "string" || !isOSShellIntent(raw.intent)) {
      return { ok: false, detail: `Unsupported intent: ${String(raw.intent)}.` };
    }
    if (!Array.isArray(raw.contextTypes) || raw.contextTypes.length === 0 || raw.contextTypes.length > 12) {
      return { ok: false, detail: "contextTypes must be a non-empty array." };
    }
    const contextTypes: OSShellContextType[] = [];
    for (const type of raw.contextTypes) {
      if (typeof type !== "string" || !(OS_SHELL_CONTEXT_TYPES as readonly string[]).includes(type)) {
        return { ok: false, detail: `Unknown context type: ${String(type)}.` };
      }
      if (!(INTENT_CONTEXT_COMPAT[raw.intent] as readonly string[]).includes(type)) {
        return { ok: false, detail: `Intent ${raw.intent} cannot handle context type ${type}.` };
      }
      contextTypes.push(type as OSShellContextType);
    }
    const route = typeof raw.route === "string" && raw.route.trim() ? normalizeRoute(raw.route) : "/";
    handlers.push({ intent: raw.intent, contextTypes, route });
  }
  return { ok: true, handlers };
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return "/";
  return trimmed.startsWith("/") ? trimmed.slice(0, 256) : `/${trimmed.slice(0, 255)}`;
}
