/**
 * Typed application context references (1.3).
 * reference ≠ authorization. Shell routes; applications and infrastructure own data.
 */
import { jsonLeaksSecrets } from "./permissions.js";
import { originOf } from "./url.js";

export const OS_SHELL_CONTEXT_TYPES = [
  "asset",
  "document",
  "media",
  "project",
  "application",
  "digital_life",
  "url",
  "text",
  "file",
] as const;

export type OSShellContextType = (typeof OS_SHELL_CONTEXT_TYPES)[number];

export const OS_SHELL_CONTEXT_LIFETIMES = ["EPHEMERAL", "SESSION", "PERSISTED_REFERENCE"] as const;
export type OSShellContextLifetime = (typeof OS_SHELL_CONTEXT_LIFETIMES)[number];

export interface OSShellContextReference {
  type: OSShellContextType;
  id?: string;
  title?: string;
  /** Display subtype only (e.g. VIDEO). Never an application schema. */
  subtype?: string;
  mimeType?: string;
  url?: string;
  text?: string;
  appId?: string;
  /** Originating application id for display — not ownership or authorization. */
  originAppId?: string;
  size?: number;
  lifetime?: OSShellContextLifetime;
  /** Shallow typed metadata only. Never credentials or bytes. */
  metadata?: Record<string, string | number | boolean>;
}

/** Public alias: object reference reuses the context vocabulary. Object ≠ ownership. */
export type OSShellObjectReference = OSShellContextReference;

export type ContextReject =
  | "context_invalid"
  | "context_unavailable"
  | "secret_payload"
  | "oversized_context";

export type ContextValidation =
  | { ok: true; context: OSShellContextReference; grantsAuthorization: false; containsBytes: false }
  | { ok: false; code: ContextReject; detail: string };

export const CONTEXT_LIMITS = {
  maxTitle: 200,
  maxText: 4000,
  maxId: 128,
  maxMime: 100,
  maxUrl: 2048,
  maxMetadataKeys: 8,
  maxMetadataString: 200,
} as const;

export function createContextReference(input: OSShellContextReference): ContextValidation {
  return validateContextReference(input);
}

export function validateContextReference(input: unknown): ContextValidation {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "context_invalid", detail: "Context must be an object." };
  }
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Context must not contain credentials or secrets." };
  }
  const raw = input as Record<string, unknown>;
  if (raw.bytes != null || raw.content != null || raw.body != null || raw.data != null) {
    return { ok: false, code: "context_invalid", detail: "Context must not carry raw bytes or private payloads." };
  }
  if (raw.permissions != null || raw.grants != null || raw.authority != null || raw.token != null) {
    return { ok: false, code: "secret_payload", detail: "Context is not authorization." };
  }
  const type = raw.type;
  if (typeof type !== "string" || !(OS_SHELL_CONTEXT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, code: "context_invalid", detail: "Unknown or missing context type." };
  }

  const context: OSShellContextReference = {
    type: type as OSShellContextType,
    lifetime: normalizeLifetime(raw.lifetime),
  };

  if (raw.id != null) {
    if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > CONTEXT_LIMITS.maxId) {
      return { ok: false, code: "context_invalid", detail: "id must be a short opaque string." };
    }
    context.id = raw.id;
  }
  if (raw.title != null) {
    if (typeof raw.title !== "string" || raw.title.length > CONTEXT_LIMITS.maxTitle) {
      return { ok: false, code: "oversized_context", detail: "title exceeds limit." };
    }
    context.title = raw.title;
  }
  if (raw.mimeType != null) {
    if (typeof raw.mimeType !== "string" || raw.mimeType.length > CONTEXT_LIMITS.maxMime) {
      return { ok: false, code: "context_invalid", detail: "mimeType is invalid." };
    }
    context.mimeType = raw.mimeType;
  }
  if (raw.url != null) {
    if (typeof raw.url !== "string" || raw.url.length > CONTEXT_LIMITS.maxUrl) {
      return { ok: false, code: "oversized_context", detail: "url exceeds limit." };
    }
    const origin = originOf(raw.url) ?? (raw.url.startsWith("/") ? "path" : null);
    if (!origin && !raw.url.startsWith("application://")) {
      return { ok: false, code: "context_invalid", detail: "url must be http(s), application://, or a path." };
    }
    context.url = raw.url;
  }
  if (raw.text != null) {
    if (typeof raw.text !== "string") {
      return { ok: false, code: "context_invalid", detail: "text must be a string." };
    }
    if (raw.text.length > CONTEXT_LIMITS.maxText) {
      return { ok: false, code: "oversized_context", detail: "text exceeds limit." };
    }
    context.text = raw.text;
  }
  if (raw.appId != null) {
    if (typeof raw.appId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(raw.appId)) {
      return { ok: false, code: "context_invalid", detail: "appId is invalid." };
    }
    context.appId = raw.appId;
  }
  if (raw.originAppId != null) {
    if (typeof raw.originAppId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(raw.originAppId)) {
      return { ok: false, code: "context_invalid", detail: "originAppId is invalid." };
    }
    context.originAppId = raw.originAppId;
  }
  if (raw.subtype != null) {
    if (typeof raw.subtype !== "string" || raw.subtype.length === 0 || raw.subtype.length > 64) {
      return { ok: false, code: "context_invalid", detail: "subtype must be a short display string." };
    }
    context.subtype = raw.subtype;
  }
  if (raw.size != null) {
    if (typeof raw.size !== "number" || !Number.isFinite(raw.size) || raw.size < 0 || raw.size > 1_000_000_000) {
      return { ok: false, code: "context_invalid", detail: "size must be a finite non-negative number." };
    }
    context.size = raw.size;
  }
  if (raw.metadata != null) {
    if (typeof raw.metadata !== "object" || Array.isArray(raw.metadata)) {
      return { ok: false, code: "context_invalid", detail: "metadata must be a shallow object." };
    }
    if (jsonLeaksSecrets(raw.metadata)) {
      return { ok: false, code: "secret_payload", detail: "metadata must not contain secrets." };
    }
    const entries = Object.entries(raw.metadata as Record<string, unknown>);
    if (entries.length > CONTEXT_LIMITS.maxMetadataKeys) {
      return { ok: false, code: "oversized_context", detail: "metadata has too many keys." };
    }
    const metadata: Record<string, string | number | boolean> = {};
    for (const [key, value] of entries) {
      if (typeof value === "string") {
        if (value.length > CONTEXT_LIMITS.maxMetadataString) {
          return { ok: false, code: "oversized_context", detail: `metadata.${key} is too long.` };
        }
        metadata[key] = value;
      } else if (typeof value === "number" || typeof value === "boolean") {
        metadata[key] = value;
      } else {
        return { ok: false, code: "context_invalid", detail: `metadata.${key} must be string|number|boolean.` };
      }
    }
    context.metadata = metadata;
  }

  const typeCheck = validateTypeShape(context);
  if (!typeCheck.ok) return typeCheck;

  return { ok: true, context, grantsAuthorization: false, containsBytes: false };
}

function normalizeLifetime(value: unknown): OSShellContextLifetime {
  if (value === "SESSION" || value === "PERSISTED_REFERENCE") return value;
  return "EPHEMERAL";
}

function validateTypeShape(context: OSShellContextReference): ContextValidation {
  if (context.type === "text" && context.text == null && context.title == null) {
    return { ok: false, code: "context_invalid", detail: "text context requires text or title." };
  }
  if (context.type === "url" && !context.url) {
    return { ok: false, code: "context_invalid", detail: "url context requires url." };
  }
  if (context.type === "application" && !context.appId) {
    return { ok: false, code: "context_invalid", detail: "application context requires appId." };
  }
  if (context.type === "asset" && !context.id && !context.title) {
    return { ok: false, code: "context_invalid", detail: "asset context requires an opaque id or title." };
  }
  if (context.type === "file" && !context.title && !context.id) {
    return { ok: false, code: "context_invalid", detail: "file context requires name/title or opaque id." };
  }
  if (context.type === "digital_life") {
    // Presence only — no graph payload allowed.
    if (context.text || context.url) {
      return { ok: false, code: "context_invalid", detail: "digital_life context is presence-only." };
    }
  }
  return { ok: true, context, grantsAuthorization: false, containsBytes: false };
}

/** Explicit doctrine: a reference never authorizes access to the referenced object. */
export function contextDoesNotGrantAuthorization(_context: OSShellContextReference): true {
  return true;
}
