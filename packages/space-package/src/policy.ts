import {
  ASSET_MEDIA_TYPES,
  CONTENT_ROOT,
  DUPLICATION_POLICIES,
  EXPERIENCE_ENTRY_TYPES,
  LIMITS,
  PACKAGE_PERMISSIONS,
  SPACE_PACKAGE_FORMAT,
  SPACE_PACKAGE_FORMAT_VERSION,
  SpacePackageError,
  type SpacePackageManifest,
  type SpacePackageSignature,
} from "./format.js";
import { checkSafePath } from "./zip.js";

type Obj = Record<string, unknown>;
const ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const CAPABILITY = /^space\.[a-z0-9-]{1,32}$/;
const SPDX = /^[A-Za-z0-9.+-]{1,64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A package describes a Space; it never carries who owns it or what anyone may do. Any field that
 * would transfer authority is refused by name, before the general schema check, so the failure
 * is explicit rather than a generic schema error.
 */
const AUTHORITY_KEYS = /^(owner|owners|ownerid|ownership|authority|authorities|grant|grants|delegation|delegations|admin|admins|controller|controllers|role|roles|acl|acls|bearer|accesstoken|authtoken|digiauthority)$/i;

function isObj(value: unknown): value is Obj {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Obj {
  if (!isObj(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key)) && required.every((key) => key in value);
}

const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value) && !value.includes("..");
const isSemver = (value: unknown): value is string => typeof value === "string" && SEMVER.test(value);
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);

export function findAuthorityField(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findAuthorityField(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (AUTHORITY_KEYS.test(key.replace(/[_-]/g, ""))) return `${path}.${key}`;
    const hit = findAuthorityField(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

export function mediaTypeAllowed(path: string, mediaType: string): boolean {
  const extensions = ASSET_MEDIA_TYPES[mediaType];
  return Boolean(extensions && extensions.some((extension) => path.toLowerCase().endsWith(extension)));
}

/** Full V1 manifest validation. Throws a SpacePackageError naming the first violation. */
export function validateManifest(value: unknown): asserts value is SpacePackageManifest {
  if (!isObj(value)) throw new SpacePackageError("MANIFEST_INVALID", "not an object");
  if (value.format !== SPACE_PACKAGE_FORMAT) throw new SpacePackageError("MANIFEST_INVALID", "format");
  if (value.formatVersion !== SPACE_PACKAGE_FORMAT_VERSION) throw new SpacePackageError("UNSUPPORTED_FORMAT_VERSION", String(value.formatVersion));
  const authority = findAuthorityField(value);
  if (authority) throw new SpacePackageError("AUTHORITY_CLONING_REJECTED", authority);
  const fail = (detail: string): never => { throw new SpacePackageError("MANIFEST_INVALID", detail); };
  if (!exactKeys(value, ["format", "formatVersion", "package", "publisher", "runtime", "space", "assets", "offline", "permissions", "dependencies", "license", "provenance", "integrity"])) fail("top-level fields");
  const { package: pkg, publisher, runtime, space, assets, offline, permissions, dependencies, license, provenance, integrity } = value as Obj;

  if (!exactKeys(pkg, ["id", "version", "name"], ["description"]) || !isId(pkg.id) || !isSemver(pkg.version) || !isText(pkg.name, 80)) fail("package");
  if ("description" in (pkg as Obj) && !isText((pkg as Obj).description, 500)) fail("package.description");
  if (!exactKeys(publisher, ["publisherId", "keyId"]) || !isId(publisher.publisherId) || !isId(publisher.keyId)) fail("publisher");
  if (!exactKeys(runtime, ["spaceContractVersion", "minimumRuntimeVersion"]) || !Number.isInteger(runtime.spaceContractVersion) || (runtime.spaceContractVersion as number) < 1 || !isSemver(runtime.minimumRuntimeVersion)) fail("runtime");

  if (!Array.isArray(assets) || assets.length === 0 || assets.length > LIMITS.maxAssets) fail("assets");
  const assetPaths = new Set<string>();
  for (const asset of assets as unknown[]) {
    if (!exactKeys(asset, ["path", "mediaType", "size", "sha256"])) fail("asset fields");
    const item = asset as Obj;
    if (typeof item.path !== "string" || !item.path.startsWith(CONTENT_ROOT)) fail("asset path must be under content/");
    checkSafePath(item.path as string);
    if (typeof item.mediaType !== "string" || !mediaTypeAllowed(item.path as string, item.mediaType)) throw new SpacePackageError("DISALLOWED_MEDIA_TYPE", String(item.path));
    if (!Number.isInteger(item.size) || (item.size as number) < 0 || (item.size as number) > LIMITS.maxEntryBytes) fail("asset size");
    if (typeof item.sha256 !== "string" || !DIGEST.test(item.sha256)) fail("asset sha256");
    const key = (item.path as string).toLowerCase();
    if (assetPaths.has(key)) throw new SpacePackageError("DUPLICATE_PATH", String(item.path));
    assetPaths.add(key);
  }

  const declared = new Set(Object.keys(PACKAGE_PERMISSIONS));
  if (!Array.isArray(permissions) || !permissions.every((item) => typeof item === "string" && declared.has(item)) || new Set(permissions).size !== permissions.length) fail("permissions");
  const packagePermissions = new Set(permissions as string[]);

  if (!exactKeys(space, ["spaceId", "defaultExperienceId", "experiences"]) || !isId(space.spaceId) || !isId(space.defaultExperienceId)) fail("space");
  const experiences = (space as Obj).experiences;
  if (!Array.isArray(experiences) || experiences.length === 0 || experiences.length > 32) fail("space.experiences");
  const experienceIds = new Set<string>();
  for (const experience of experiences as unknown[]) {
    if (!exactKeys(experience, ["id", "title", "type", "entry", "offlinePolicy", "requires"])) fail("experience fields");
    const item = experience as Obj;
    // "SPACE" is reserved by the Space Runtime (validExperience) and can never be an experience id.
    if (!isId(item.id) || item.id === "SPACE" || experienceIds.has(item.id as string)) fail("experience id");
    experienceIds.add(item.id as string);
    if (!isText(item.title, 80) || !isId(item.type)) fail("experience title/type");
    if (item.offlinePolicy !== "cached" && item.offlinePolicy !== "unavailable") fail("experience offlinePolicy");
    if (!exactKeys(item.entry, ["type", "path"]) || !(EXPERIENCE_ENTRY_TYPES as readonly string[]).includes((item.entry as Obj).type as string)) fail("experience entry type");
    const entryPath = (item.entry as Obj).path;
    if (typeof entryPath !== "string" || !assetPaths.has(entryPath.toLowerCase()) || !entryPath.endsWith(".json")) fail("experience entry must be a declared JSON asset");
    if (!Array.isArray(item.requires) || !item.requires.every((permission) => typeof permission === "string" && packagePermissions.has(permission))) fail("experience requires undeclared permission");
  }
  if (!experienceIds.has((space as Obj).defaultExperienceId as string)) fail("space.defaultExperienceId");

  if (!exactKeys(offline, ["capabilities"], ["contentIndex"])) fail("offline");
  const capabilities = (offline as Obj).capabilities;
  if (!Array.isArray(capabilities) || capabilities.length > 16 || !capabilities.every((item) => typeof item === "string" && CAPABILITY.test(item))) fail("offline.capabilities");
  if ("contentIndex" in (offline as Obj)) {
    const index = (offline as Obj).contentIndex;
    if (typeof index !== "string" || !assetPaths.has(index.toLowerCase())) fail("offline.contentIndex must be a declared asset");
  }

  if (!Array.isArray(dependencies) || dependencies.length > 64) fail("dependencies");
  for (const dependency of dependencies as unknown[]) {
    if (!exactKeys(dependency, ["packageId", "minimumVersion"]) || !isId((dependency as Obj).packageId) || !isSemver((dependency as Obj).minimumVersion)) fail("dependency");
  }
  if (!exactKeys(license, ["spdx", "duplication", "redistribution"]) || typeof license.spdx !== "string" || !SPDX.test(license.spdx)
    || !(DUPLICATION_POLICIES as readonly string[]).includes(license.duplication as string) || typeof license.redistribution !== "boolean") fail("license");
  if (!exactKeys(provenance, ["createdAt", "tool"], ["parent"]) || typeof provenance.createdAt !== "string" || Number.isNaN(Date.parse(provenance.createdAt)) || !isText(provenance.tool, 80)) fail("provenance");
  if ("parent" in (provenance as Obj)) {
    const parent = (provenance as Obj).parent;
    if (!exactKeys(parent, ["packageId", "version", "integrityRoot"]) || !isId(parent.packageId) || !isSemver(parent.version) || typeof parent.integrityRoot !== "string" || !DIGEST.test(parent.integrityRoot)) fail("provenance.parent");
  }
  if (!exactKeys(integrity, ["algorithm", "root"]) || integrity.algorithm !== "SHA-256" || typeof integrity.root !== "string" || !DIGEST.test(integrity.root)) fail("integrity");
}

export function validateSignature(value: unknown): asserts value is SpacePackageSignature {
  if (!exactKeys(value, ["algorithm", "publisherId", "keyId", "manifestSha256", "value"]) || value.algorithm !== "Ed25519"
    || !isId(value.publisherId) || !isId(value.keyId) || typeof value.manifestSha256 !== "string" || !DIGEST.test(value.manifestSha256)
    || typeof value.value !== "string" || !SIGNATURE.test(value.value)) {
    throw new SpacePackageError("SIGNATURE_INVALID", "signature document");
  }
}

/**
 * Private data a Space package must never carry: credentials, keys, session state, biometric
 * material, PDI records, authority grants, payment data. Checked on pack (refuse to export) and
 * on verify (refuse to install) for every text-like asset; binary media is checked by name only.
 */
const PRIVATE_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ["JWT / bearer token", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["bearer credential", /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/],
  ["cookie", /\b(?:Set-Cookie|Cookie):\s*\S+=/i],
  ["private JSON field", /"(?:private[_-]?key|privateKeyPkcs8Base64|access[_-]?token|refresh[_-]?token|session[_-]?(?:token|id|cookie)|id[_-]?token|api[_-]?secret|client[_-]?secret|password|passcode|pin[_-]?code|biometric[a-z_-]*|face[_-]?(?:embedding|template)|fingerprint[_-]?template|trust[_-]?id[_-]?(?:template|credential)|pdi[_-]?record|pdi[_-]?(?:data|payload)|authority[_-]?(?:grant|token)|digi[_-]?authority[a-z_-]*|card[_-]?number|cvv|cvc|iban|account[_-]?number|device[_-]?secret|seed[_-]?phrase|mnemonic)"\s*:/i],
  ["card number", /\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13})\b/],
];
const PRIVATE_NAMES = /(^|\/)(?:\.env(?:\..*)?|id_[a-z0-9]+|[^/]*\.(?:pem|key|p12|pfx|jks|keystore|kdbx)|cookies?(?:\.[a-z]+)?|[^/]*(?:biometric|trustid|pdi)[^/]*)$/i;

export function findPrivateData(path: string, bytes: Uint8Array, mediaType: string): string | null {
  if (PRIVATE_NAMES.test(path)) return `private file name: ${path}`;
  if (mediaType !== "application/json" && mediaType !== "text/plain") return null;
  const text = new TextDecoder().decode(bytes);
  // Authority first: an owner or grant inside content is an attempt to clone authority, not just a leak.
  if (mediaType === "application/json") {
    try {
      const authority = findAuthorityField(JSON.parse(text));
      if (authority) return `authority field ${authority} in ${path}`;
    } catch {
      return `invalid JSON in ${path}`;
    }
  }
  for (const [label, pattern] of PRIVATE_PATTERNS) if (pattern.test(text)) return `${label} in ${path}`;
  return null;
}
