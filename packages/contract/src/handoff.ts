import { jsonLeaksSecrets } from "./permissions.js";
import type { OSShellApplicationRecord } from "./application-ecosystem.js";
import { findApplicationById } from "./application-ecosystem.js";

/**
 * Application-to-application handoff.
 * Navigation/context exchange only — never credential or permission delegation.
 */
export interface OSShellApplicationHandoff {
  targetAppId: string;
  route?: string;
  context?: Record<string, unknown>;
}

export type HandoffReject =
  | "unknown_application"
  | "secret_payload"
  | "malformed_payload"
  | "self_handoff"
  | "permission_inheritance_forbidden";

export type HandoffValidation =
  | {
      ok: true;
      sourceAppId: string;
      target: OSShellApplicationRecord;
      route: string;
      context: Record<string, unknown>;
      transfersPermissions: false;
      transfersCredentials: false;
    }
  | { ok: false; code: HandoffReject; detail: string };

const MAX_CONTEXT_KEYS = 16;
const MAX_CONTEXT_DEPTH = 2;
const MAX_STRING = 512;

export function validateApplicationHandoff(input: {
  sourceAppId: string;
  handoff: unknown;
  registry: readonly OSShellApplicationRecord[];
}): HandoffValidation {
  if (!input.handoff || typeof input.handoff !== "object") {
    return { ok: false, code: "malformed_payload", detail: "Handoff must be an object." };
  }
  if (jsonLeaksSecrets(input.handoff)) {
    return { ok: false, code: "secret_payload", detail: "Handoff context must not contain credentials or secrets." };
  }
  const raw = input.handoff as Record<string, unknown>;
  const targetAppId = typeof raw.targetAppId === "string" ? raw.targetAppId.trim() : "";
  if (!targetAppId) {
    return { ok: false, code: "malformed_payload", detail: "targetAppId is required." };
  }
  if (targetAppId === input.sourceAppId) {
    return { ok: false, code: "self_handoff", detail: "Handoff target must be a different application." };
  }
  const target = findApplicationById(input.registry, targetAppId);
  if (!target) {
    return { ok: false, code: "unknown_application", detail: `Target application ${targetAppId} is not installed.` };
  }
  if (raw.permissions != null || raw.grants != null || raw.authority != null) {
    return {
      ok: false,
      code: "permission_inheritance_forbidden",
      detail: "Handoff cannot transfer permissions or authority.",
    };
  }
  const route = typeof raw.route === "string" && raw.route.trim() ? normalizeRoute(raw.route) : "/";
  const contextRaw = raw.context;
  if (contextRaw != null && (typeof contextRaw !== "object" || Array.isArray(contextRaw))) {
    return { ok: false, code: "malformed_payload", detail: "context must be a plain object when present." };
  }
  const sanitized = sanitizeContext((contextRaw as Record<string, unknown> | null) ?? {});
  if (!sanitized.ok) return sanitized;

  return {
    ok: true,
    sourceAppId: input.sourceAppId,
    target,
    route,
    context: sanitized.context,
    transfersPermissions: false,
    transfersCredentials: false,
  };
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("application://")) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed.slice(0, 256) : `/${trimmed.slice(0, 255)}`;
}

function sanitizeContext(
  value: Record<string, unknown>,
  depth = 0,
): { ok: true; context: Record<string, unknown> } | { ok: false; code: HandoffReject; detail: string } {
  if (depth > MAX_CONTEXT_DEPTH) {
    return { ok: false, code: "malformed_payload", detail: "Handoff context is too deeply nested." };
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_CONTEXT_KEYS) {
    return { ok: false, code: "malformed_payload", detail: "Handoff context has too many keys." };
  }
  if (jsonLeaksSecrets(value)) {
    return { ok: false, code: "secret_payload", detail: "Handoff context must not contain credentials or secrets." };
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const entry = value[key];
    if (entry == null || typeof entry === "boolean" || typeof entry === "number") {
      out[key] = entry;
      continue;
    }
    if (typeof entry === "string") {
      out[key] = entry.slice(0, MAX_STRING);
      continue;
    }
    if (typeof entry === "object" && !Array.isArray(entry)) {
      const nested = sanitizeContext(entry as Record<string, unknown>, depth + 1);
      if (!nested.ok) return nested;
      out[key] = nested.context;
      continue;
    }
    return { ok: false, code: "malformed_payload", detail: `Unsupported context value for key ${key}.` };
  }
  return { ok: true, context: out };
}
