import type { OSShellIntent } from "./intent-handlers.js";
import type { OSShellContextType } from "./intent-context.js";
import { jsonLeaksSecrets } from "./permissions.js";

export type DefaultHandlerKey = `${OSShellIntent}:${OSShellContextType}`;

export interface DefaultIntentHandler {
  intent: OSShellIntent;
  contextType: OSShellContextType;
  appId: string;
}

/** Client-local defaults. Revocable. Not permission grants. */
export function defaultHandlerKey(intent: OSShellIntent, contextType: OSShellContextType): DefaultHandlerKey {
  return `${intent}:${contextType}`;
}

export function parseDefaultHandlers(raw: unknown): DefaultIntentHandler[] {
  if (!Array.isArray(raw) || jsonLeaksSecrets(raw)) return [];
  return raw.filter(
    (item): item is DefaultIntentHandler =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as DefaultIntentHandler).intent === "string" &&
          typeof (item as DefaultIntentHandler).contextType === "string" &&
          typeof (item as DefaultIntentHandler).appId === "string",
      ),
  );
}

export function setDefaultHandler(
  list: readonly DefaultIntentHandler[],
  next: DefaultIntentHandler,
): DefaultIntentHandler[] {
  const rest = list.filter((item) => !(item.intent === next.intent && item.contextType === next.contextType));
  return [...rest, next];
}

export function clearDefaultHandler(
  list: readonly DefaultIntentHandler[],
  intent: OSShellIntent,
  contextType: OSShellContextType,
): DefaultIntentHandler[] {
  return list.filter((item) => !(item.intent === intent && item.contextType === contextType));
}

export function lookupDefaultHandler(
  list: readonly DefaultIntentHandler[],
  intent: OSShellIntent,
  contextType: OSShellContextType,
): string | null {
  return list.find((item) => item.intent === intent && item.contextType === contextType)?.appId ?? null;
}
