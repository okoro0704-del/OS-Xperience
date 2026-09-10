import { MANIFEST_SCHEMA } from "./version.js";
import { isForbiddenCapability, isShellCapability, type ShellCapability } from "./capabilities.js";
import { originOf } from "./url.js";

export const MANIFEST_CLASSES = ["web", "compatible", "native"] as const;
export type ManifestClass = (typeof MANIFEST_CLASSES)[number];

export const EMBED_POLICIES = ["deny", "allow"] as const;
export type EmbedPolicy = (typeof EMBED_POLICIES)[number];

export type EffectiveClass = ManifestClass;
export type ClassReason = "ordinary" | "manifest" | "origin_policy" | "native_unverified";

export interface AppManifest {
  schema: typeof MANIFEST_SCHEMA;
  name: string;
  version: string;
  origin: string;
  class: ManifestClass;
  embed: EmbedPolicy;
  launch: string;
  requested: ShellCapability[];
  icons?: string[];
  publisher?: string;
}

export type ManifestParseResult =
  | { ok: true; manifest: AppManifest }
  | { ok: false; code: "invalid_manifest" | "origin_mismatch"; detail: string };

export function parseManifest(input: unknown, fetchOrigin: string): ManifestParseResult {
  const expectedOrigin = originOf(fetchOrigin);
  if (!expectedOrigin) {
    return { ok: false, code: "invalid_manifest", detail: "Fetch origin is not an http(s) origin." };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, code: "invalid_manifest", detail: "Manifest must be an object." };
  }
  const raw = input as Record<string, unknown>;
  if (raw.schema !== MANIFEST_SCHEMA) {
    return { ok: false, code: "invalid_manifest", detail: `schema must be ${MANIFEST_SCHEMA}.` };
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const version = typeof raw.version === "string" ? raw.version.trim() : "";
  const declaredOrigin = typeof raw.origin === "string" ? originOf(raw.origin) : null;
  if (!name || !version || !declaredOrigin) {
    return { ok: false, code: "invalid_manifest", detail: "name, version, and origin are required." };
  }
  if (declaredOrigin !== expectedOrigin) {
    return { ok: false, code: "origin_mismatch", detail: `Manifest origin ${declaredOrigin} does not match fetch origin ${expectedOrigin}.` };
  }
  const declaredClass = MANIFEST_CLASSES.includes(raw.class as ManifestClass) ? (raw.class as ManifestClass) : "web";
  const embed = EMBED_POLICIES.includes(raw.embed as EmbedPolicy) ? (raw.embed as EmbedPolicy) : "deny";
  const launch = typeof raw.launch === "string" && raw.launch.trim() ? raw.launch.trim() : "/";
  const requested = Array.isArray(raw.requested)
    ? raw.requested.filter((item): item is ShellCapability => typeof item === "string" && isShellCapability(item) && !isForbiddenCapability(item))
    : [];
  const icons = Array.isArray(raw.icons) ? raw.icons.filter((item): item is string => typeof item === "string") : undefined;
  const publisher = typeof raw.publisher === "string" ? raw.publisher : undefined;
  return {
    ok: true,
    manifest: {
      schema: MANIFEST_SCHEMA,
      name,
      version,
      origin: declaredOrigin,
      class: declaredClass,
      embed,
      launch,
      requested,
      icons,
      publisher,
    },
  };
}
