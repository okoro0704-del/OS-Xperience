import { canonicalJson, importCatalogPrivateKey, importCatalogPublicKey } from "./release.js";
import { compareDottedVersion } from "./update.js";

/**
 * Space Launch File V1 — a small, declarative, publisher-signed descriptor that lets OS Xperience
 * verify, register, prepare and launch a provider's SPACE target. It is not the Space: it carries
 * no code, no media and no prepared state.
 */
export const SPACE_LAUNCH_FORMAT = "digiconomy.space";
export const SPACE_LAUNCH_SCHEMA_VERSION = 1;
export const SPACE_LAUNCH_EXTENSION = ".space";
export const SPACE_LAUNCH_MIME = "application/vnd.digiconomy.space+json";
export const SPACE_LAUNCH_MAX_BYTES = 16 * 1024;
/** Matches the Product-local Space Contract V1 (space-runtime). */
export const SPACE_RUNTIME_CONTRACT_VERSION = 1;
/** Space capabilities this runtime can execute from a launch file. */
export const SPACE_LAUNCH_CAPABILITIES: readonly string[] = ["space.tv"];

export interface SpaceLaunchPayload {
  /** The provider's canonical identity — the same id its APP target uses. */
  providerId: string;
  publisherId: string;
  version: string;
  presentation: { name: string; description?: string; icon?: string };
  execution: { mode: "SPACE"; broadcastChannelId: string };
  capabilities: string[];
  preparation: { kind: "BROADCAST"; endpoint?: string };
  compatibility: { minimumXperienceVersion: string; minimumSpaceRuntimeVersion: number };
}

export interface SpaceLaunchFile {
  format: typeof SPACE_LAUNCH_FORMAT;
  schemaVersion: typeof SPACE_LAUNCH_SCHEMA_VERSION;
  payload: SpaceLaunchPayload;
  integrity: { algorithm: "SHA-256"; digest: string };
  signature: { algorithm: "Ed25519"; keyId: string; value: string };
}

export interface TrustedSpacePublisher {
  publisherId: string;
  name: string;
  keys: ReadonlyArray<{ keyId: string; publicKeySpkiBase64: string }>;
  /** Provider identities this publisher may describe. */
  providers: readonly string[];
}

export type SpaceLaunchStage =
  | "RECEIVED"
  | "VALIDATING"
  | "VERIFYING"
  | "COMPATIBILITY_CHECK"
  | "READY_TO_REGISTER"
  | "REGISTERED";

export type SpaceLaunchErrorCode =
  | "LAUNCH_FILE_TOO_LARGE"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_SCHEMA"
  | "PUBLISHER_UNKNOWN"
  | "INTEGRITY_FAILED"
  | "SIGNATURE_INVALID"
  | "IDENTITY_CONFLICT"
  | "INCOMPATIBLE_XPERIENCE"
  | "INCOMPATIBLE_RUNTIME";

export type SpaceLaunchVerification =
  | { ok: true; stage: "READY_TO_REGISTER"; file: SpaceLaunchFile; publisher: TrustedSpacePublisher; byteLength: number }
  | { ok: false; stage: SpaceLaunchStage; code: SpaceLaunchErrorCode };

export interface SpaceLaunchVerifyOptions {
  publishers: readonly TrustedSpacePublisher[];
  /** The running OS Xperience version (semver). */
  xperienceVersion: string;
  spaceRuntimeVersion?: number;
}

type Obj = Record<string, unknown>;

const ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const CAPABILITY = /^space\.[a-z0-9-]{1,32}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ED25519_SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function isObj(value: unknown): value is Obj {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Declarative allowlist: any field outside the schema (code, scripts, credentials…) is rejected. */
function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Obj {
  if (!isObj(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key)) && required.every((key) => key in value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !value.includes("..");
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validPayload(value: unknown): value is SpaceLaunchPayload {
  if (!exactKeys(value, ["providerId", "publisherId", "version", "presentation", "execution", "capabilities", "preparation", "compatibility"])) return false;
  const { presentation, execution, capabilities, preparation, compatibility } = value;
  if (!isId(value.providerId) || !isId(value.publisherId) || typeof value.version !== "string" || !SEMVER.test(value.version)) return false;
  if (!exactKeys(presentation, ["name"], ["description", "icon"]) || !isText(presentation.name, 64)) return false;
  if ("description" in presentation && !isText(presentation.description, 280)) return false;
  if ("icon" in presentation && !isHttpsUrl(presentation.icon)) return false;
  if (!exactKeys(execution, ["mode", "broadcastChannelId"]) || execution.mode !== "SPACE" || !isId(execution.broadcastChannelId)) return false;
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.length > 8) return false;
  if (!capabilities.every((item) => typeof item === "string" && CAPABILITY.test(item))) return false;
  if (new Set(capabilities).size !== capabilities.length || !capabilities.includes("space.tv")) return false;
  if (!exactKeys(preparation, ["kind"], ["endpoint"]) || preparation.kind !== "BROADCAST") return false;
  if ("endpoint" in preparation && !isHttpsUrl(preparation.endpoint)) return false;
  if (!exactKeys(compatibility, ["minimumXperienceVersion", "minimumSpaceRuntimeVersion"])) return false;
  if (typeof compatibility.minimumXperienceVersion !== "string" || !SEMVER.test(compatibility.minimumXperienceVersion)) return false;
  const runtime = compatibility.minimumSpaceRuntimeVersion;
  return typeof runtime === "number" && Number.isInteger(runtime) && runtime >= 1 && runtime <= 1000;
}

/** Full V1 structural validation. Synchronous, so stored registrations can be re-checked on every read. */
export function isSpaceLaunchFile(value: unknown): value is SpaceLaunchFile {
  if (!exactKeys(value, ["format", "schemaVersion", "payload", "integrity", "signature"])) return false;
  if (value.format !== SPACE_LAUNCH_FORMAT || value.schemaVersion !== SPACE_LAUNCH_SCHEMA_VERSION) return false;
  const { integrity, signature } = value;
  if (!exactKeys(integrity, ["algorithm", "digest"]) || integrity.algorithm !== "SHA-256" || typeof integrity.digest !== "string" || !DIGEST.test(integrity.digest)) return false;
  if (!exactKeys(signature, ["algorithm", "keyId", "value"]) || signature.algorithm !== "Ed25519" || !isId(signature.keyId)) return false;
  if (typeof signature.value !== "string" || !ED25519_SIGNATURE.test(signature.value)) return false;
  return validPayload(value.payload);
}

/** JSON.parse keeps the last of duplicated keys; a launch file must never carry two values for one field. */
function hasDuplicateKeys(text: string): boolean {
  const stack: Array<{ keys: Set<string>; expectKey: boolean } | null> = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top?.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) return true;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (ch === "{") stack.push({ keys: new Set(), expectKey: true });
    else if (ch === "[") stack.push(null);
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top) top.expectKey = true;
    }
  }
  return false;
}

/** The exact bytes that are hashed and signed: canonical JSON of format, schema version and payload. */
export function spaceLaunchSignedContent(file: Pick<SpaceLaunchFile, "format" | "schemaVersion" | "payload">): string {
  return canonicalJson({ format: file.format, schemaVersion: file.schemaVersion, payload: file.payload });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]!);
  return btoa(binary);
}

/**
 * RECEIVED → VALIDATING → VERIFYING → COMPATIBILITY_CHECK → READY_TO_REGISTER.
 * Trust comes only from a pinned publisher key; filename, extension and origin are never consulted.
 */
export async function verifySpaceLaunchFile(
  input: Uint8Array | string,
  options: SpaceLaunchVerifyOptions,
): Promise<SpaceLaunchVerification> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > SPACE_LAUNCH_MAX_BYTES) return { ok: false, stage: "RECEIVED", code: "LAUNCH_FILE_TOO_LARGE" };

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
    if (hasDuplicateKeys(text)) return { ok: false, stage: "VALIDATING", code: "INVALID_FORMAT" };
  } catch {
    return { ok: false, stage: "VALIDATING", code: "INVALID_FORMAT" };
  }
  if (!isObj(parsed) || parsed.format !== SPACE_LAUNCH_FORMAT) return { ok: false, stage: "VALIDATING", code: "INVALID_FORMAT" };
  if (parsed.schemaVersion !== SPACE_LAUNCH_SCHEMA_VERSION) return { ok: false, stage: "VALIDATING", code: "UNSUPPORTED_SCHEMA" };
  if (!isSpaceLaunchFile(parsed)) return { ok: false, stage: "VALIDATING", code: "INVALID_FORMAT" };
  const file = parsed;

  const publisher = options.publishers.find((item) => item.publisherId === file.payload.publisherId);
  const key = publisher?.keys.find((item) => item.keyId === file.signature.keyId);
  if (!publisher || !key) return { ok: false, stage: "VERIFYING", code: "PUBLISHER_UNKNOWN" };
  const content = spaceLaunchSignedContent(file);
  if ((await sha256Hex(content)) !== file.integrity.digest) return { ok: false, stage: "VERIFYING", code: "INTEGRITY_FAILED" };
  let signed = false;
  try {
    signed = await crypto.subtle.verify(
      "Ed25519" as AlgorithmIdentifier,
      await importCatalogPublicKey(key.publicKeySpkiBase64),
      base64ToBytes(file.signature.value) as BufferSource,
      new TextEncoder().encode(content),
    );
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, stage: "VERIFYING", code: "SIGNATURE_INVALID" };
  if (!publisher.providers.includes(file.payload.providerId)) return { ok: false, stage: "VERIFYING", code: "IDENTITY_CONFLICT" };

  const xperienceVersion = SEMVER.test(options.xperienceVersion) ? options.xperienceVersion : "0.0.0";
  if (compareDottedVersion(xperienceVersion, file.payload.compatibility.minimumXperienceVersion) < 0) {
    return { ok: false, stage: "COMPATIBILITY_CHECK", code: "INCOMPATIBLE_XPERIENCE" };
  }
  const runtime = options.spaceRuntimeVersion ?? SPACE_RUNTIME_CONTRACT_VERSION;
  if (file.payload.compatibility.minimumSpaceRuntimeVersion > runtime) return { ok: false, stage: "COMPATIBILITY_CHECK", code: "INCOMPATIBLE_RUNTIME" };
  if (!file.payload.capabilities.every((capability) => SPACE_LAUNCH_CAPABILITIES.includes(capability))) {
    return { ok: false, stage: "COMPATIBILITY_CHECK", code: "INCOMPATIBLE_RUNTIME" };
  }
  return { ok: true, stage: "READY_TO_REGISTER", file, publisher, byteLength: bytes.byteLength };
}

/** Publisher-side signing. The private key belongs to the publisher's signing environment, never to OS Xperience. */
export async function signSpaceLaunchFile(
  payload: SpaceLaunchPayload,
  signer: { keyId: string; privateKey: CryptoKey | string },
): Promise<SpaceLaunchFile> {
  const unsigned = { format: SPACE_LAUNCH_FORMAT, schemaVersion: SPACE_LAUNCH_SCHEMA_VERSION, payload } as const;
  const content = spaceLaunchSignedContent(unsigned);
  const key = typeof signer.privateKey === "string" ? await importCatalogPrivateKey(signer.privateKey) : signer.privateKey;
  const signature = await crypto.subtle.sign("Ed25519" as AlgorithmIdentifier, key, new TextEncoder().encode(content));
  return {
    ...unsigned,
    integrity: { algorithm: "SHA-256", digest: await sha256Hex(content) },
    signature: { algorithm: "Ed25519", keyId: signer.keyId, value: bytesToBase64(signature) },
  };
}

export function serializeSpaceLaunchFile(file: SpaceLaunchFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
