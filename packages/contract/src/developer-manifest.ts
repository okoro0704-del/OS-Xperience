import { PUBLIC_CAPABILITIES, type PublicCapability } from "./capability-registry.js";
import { jsonLeaksSecrets } from "./permissions.js";
import { originOf } from "./url.js";
import { MANIFEST_SCHEMA } from "./version.js";
import type { AppManifest, ManifestClass } from "./manifest.js";
import type { ShellCapability } from "./capabilities.js";
import { validateIntentHandlers } from "./intent-handlers.js";
import type { OSShellIntentHandler } from "./intent-handlers.js";
import { validateSearchProviderDeclaration } from "./search.js";
import type { OSShellSearchProviderDeclaration } from "./search.js";
import { validateObjectiveDeclaration } from "./objectives.js";
import type { OSShellObjectiveDeclaration } from "./objectives.js";

/**
 * Public developer manifest. Describes an application. Does not grant authority.
 * Maps onto the existing well-known os-shell.json contract.
 */
export interface OSShellApplicationManifest {
  appId: string;
  name: string;
  version: string;
  origin: string;
  /** Declared intent only. Never authoritative for privilege. */
  class: "web" | "compatible" | "native";
  requestedCapabilities: PublicCapability[];
  embed?: "deny" | "allow";
  launch?: string;
  publisher?: string;
  intentHandlers?: OSShellIntentHandler[];
  search?: OSShellSearchProviderDeclaration;
  /** Declared objectives. Declaration ≠ availability or permission. */
  objectives?: OSShellObjectiveDeclaration;
}

export type DeveloperManifestReject =
  | "manifest_invalid"
  | "origin_mismatch"
  | "origin_unverified"
  | "capability_unknown"
  | "secret_payload";

export type DeveloperManifestResult =
  | { ok: true; manifest: OSShellApplicationManifest }
  | { ok: false; code: DeveloperManifestReject; detail: string };

const APP_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const VERSION_RE = /^\d+\.\d+\.\d+([.-][A-Za-z0-9.-]+)?$/;

export function validateDeveloperManifest(input: unknown, fetchOrigin: string): DeveloperManifestResult {
  if (jsonLeaksSecrets(input)) {
    return { ok: false, code: "secret_payload", detail: "Manifest must not contain credentials or secrets." };
  }
  const expectedOrigin = originOf(fetchOrigin);
  if (!expectedOrigin) {
    return { ok: false, code: "origin_unverified", detail: "Fetch origin is not an http(s) origin." };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, code: "manifest_invalid", detail: "Manifest must be an object." };
  }
  const raw = input as Record<string, unknown>;

  // Accept either the public developer shape or the existing well-known schema shape.
  const fromWellKnown = raw.schema === MANIFEST_SCHEMA;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const version = typeof raw.version === "string" ? raw.version.trim() : "";
  const origin = typeof raw.origin === "string" ? originOf(raw.origin) : null;
  const appIdRaw = typeof raw.appId === "string" ? raw.appId.trim() : typeof raw.id === "string" ? raw.id.trim() : "";
  const appId = appIdRaw || (name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "");

  if (!name || !version || !origin || !appId) {
    return { ok: false, code: "manifest_invalid", detail: "appId, name, version, and origin are required." };
  }
  if (!APP_ID_RE.test(appId)) {
    return { ok: false, code: "manifest_invalid", detail: "appId must be 2–64 characters of letters, digits, . _ -." };
  }
  if (!VERSION_RE.test(version)) {
    return { ok: false, code: "manifest_invalid", detail: "version must be a semver-like string (e.g. 1.0.0)." };
  }
  if (origin !== expectedOrigin) {
    return { ok: false, code: "origin_mismatch", detail: `Manifest origin ${origin} does not match fetch origin ${expectedOrigin}.` };
  }

  const declaredClass = normalizeDeclaredClass(raw.class);
  const requestedRaw = Array.isArray(raw.requestedCapabilities)
    ? raw.requestedCapabilities
    : Array.isArray(raw.requested)
      ? raw.requested
      : null;
  if (!requestedRaw) {
    return { ok: false, code: "manifest_invalid", detail: "requestedCapabilities must be an array." };
  }

  const requestedCapabilities: PublicCapability[] = [];
  const seen = new Set<string>();
  for (const item of requestedRaw) {
    if (typeof item !== "string") {
      return { ok: false, code: "manifest_invalid", detail: "Capability identifiers must be strings." };
    }
    const id = normalizePublicCapability(item);
    if (!id) {
      return { ok: false, code: "capability_unknown", detail: `Unknown or unsupported capability: ${item}.` };
    }
    if (seen.has(id)) {
      return { ok: false, code: "manifest_invalid", detail: `Duplicate capability: ${id}.` };
    }
    seen.add(id);
    requestedCapabilities.push(id);
  }

  const embed = raw.embed === "allow" || raw.embed === "deny" ? raw.embed : fromWellKnown ? "deny" : "allow";
  const launch = typeof raw.launch === "string" && raw.launch.trim() ? raw.launch.trim() : "/";
  const publisher = typeof raw.publisher === "string" ? raw.publisher : undefined;
  const handlersResult = validateIntentHandlers(raw.intentHandlers);
  if (!handlersResult.ok) {
    return { ok: false, code: "manifest_invalid", detail: handlersResult.detail };
  }
  const searchResult = validateSearchProviderDeclaration(raw.search);
  if (!searchResult.ok) {
    return { ok: false, code: "manifest_invalid", detail: searchResult.detail };
  }
  const objectivesResult = validateObjectiveDeclaration(raw.objectives);
  if (!objectivesResult.ok) {
    return { ok: false, code: "manifest_invalid", detail: objectivesResult.detail };
  }

  return {
    ok: true,
    manifest: {
      appId,
      name,
      version,
      origin,
      class: declaredClass,
      requestedCapabilities,
      embed,
      launch,
      publisher,
      intentHandlers: handlersResult.handlers,
      search: searchResult.search.supportedTypes.length ? searchResult.search : undefined,
      objectives: Object.keys(objectivesResult.objectives).length ? objectivesResult.objectives : undefined,
    },
  };
}

function normalizeDeclaredClass(value: unknown): ManifestClass {
  if (value === "A" || value === "web") return "web";
  if (value === "compatible") return "compatible";
  if (value === "native") return "native";
  return "web";
}

function normalizePublicCapability(value: string): PublicCapability | null {
  const trimmed = value.trim();
  if ((PUBLIC_CAPABILITIES as readonly string[]).includes(trimmed)) return trimmed as PublicCapability;
  if (trimmed === "media.camera") return "camera";
  if (trimmed === "identity.public" || trimmed === "identity.authenticate") return "identity";
  if (trimmed === "storage.read" || trimmed === "storage.write") return "assets";
  if (trimmed === "commerce.checkout") return "commerce";
  return null;
}

/** Convert a validated developer manifest into the existing well-known AppManifest fields. */
export function developerManifestToWellKnown(manifest: OSShellApplicationManifest): AppManifest {
  const requested: ShellCapability[] = [];
  for (const id of manifest.requestedCapabilities) {
    if (id === "camera") requested.push("media.camera");
    else if (id === "identity") requested.push("identity.public");
    else if (id === "assets") requested.push("storage.read");
    else if (id === "commerce") requested.push("commerce.checkout");
    // device_bridge and live are public policy ids only — not well-known ShellCapability requests.
  }
  return {
    schema: MANIFEST_SCHEMA,
    name: manifest.name,
    version: manifest.version,
    origin: manifest.origin,
    class: manifest.class,
    embed: manifest.embed ?? "allow",
    launch: manifest.launch ?? "/",
    requested,
    publisher: manifest.publisher,
  };
}
