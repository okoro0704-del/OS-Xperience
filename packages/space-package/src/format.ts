/**
 * Digiconomy Space Package V1 — a portable, immutable, publisher-signed Space.
 *
 * Container: a strict ZIP subset (see zip.ts). The first entry is `mimetype` (STORED) holding
 * SPACE_PACKAGE_MEDIA_TYPE — the package is recognised by content, never by its file extension.
 * (`.space` is shared with the frozen Space Launch File V1, a JSON descriptor; each format
 * rejects the other.)
 *
 * Signed data: the canonical JSON (canonicalJson, shared by every signed Xperience artifact) of the
 * manifest `META-INF/space.json`, prefixed by SIGNING_DOMAIN. The manifest carries every asset's
 * SHA-256 and size and the integrity root over them, so one Ed25519 signature covers everything.
 */
export const SPACE_PACKAGE_FORMAT = "digiconomy.space-package";
export const SPACE_PACKAGE_FORMAT_VERSION = 1;
export const SPACE_PACKAGE_MEDIA_TYPE = "application/vnd.digiconomy.space-package";
export const SIGNING_DOMAIN = "digiconomy.space-package/v1\n";

export const MIMETYPE_PATH = "mimetype";
export const MANIFEST_PATH = "META-INF/space.json";
export const SIGNATURE_PATH = "META-INF/signature.json";
export const CONTENT_ROOT = "content/";

/** The Space Runtime contract this format targets (packages/space-runtime, Space Contract V1). */
export const SPACE_CONTRACT_VERSION = 1;

export const LIMITS = {
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 4096,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  /** Uncompressed ÷ compressed, per DEFLATE entry: beyond this it is treated as a decompression bomb. */
  maxCompressionRatio: 200,
  maxManifestBytes: 1024 * 1024,
  maxPathLength: 240,
  maxAssets: 2048,
} as const;
export type PackageLimits = { [K in keyof typeof LIMITS]: number };

/** Declarative, sandboxed media only. Nothing executable (scripts, HTML, SVG, WASM, binaries). */
export const ASSET_MEDIA_TYPES: Readonly<Record<string, readonly string[]>> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "audio/mpeg": [".mp3"],
  "audio/ogg": [".ogg", ".oga"],
  "audio/wav": [".wav"],
  "audio/mp4": [".m4a"],
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
  "application/json": [".json"],
  "text/plain": [".txt"],
};

/** The only experience entry format SP1 runs: a declarative content index (no code). */
export const EXPERIENCE_ENTRY_TYPES = ["space.content-index/v1"] as const;
export type ExperienceEntryType = (typeof EXPERIENCE_ENTRY_TYPES)[number];

/**
 * Permissions a package may declare. Local ones are served from the installation; remote ones need
 * a valid route and are UNAVAILABLE offline. Opening grants only what is declared AND available.
 */
export const PACKAGE_PERMISSIONS = {
  "content.read": { scope: "LOCAL" },
  "media.playback": { scope: "LOCAL" },
  "storage.local": { scope: "LOCAL" },
  "network.sync": { scope: "REMOTE" },
  "settlement.request": { scope: "REMOTE" },
} as const;
export type PackagePermission = keyof typeof PACKAGE_PERMISSIONS;

export const DUPLICATION_POLICIES = ["ALLOWED", "PERSONAL_COPIES", "PROHIBITED"] as const;
export type DuplicationPolicy = (typeof DUPLICATION_POLICIES)[number];

export interface PackageAsset {
  /** Relative path inside the archive, always under content/. */
  path: string;
  mediaType: string;
  size: number;
  sha256: string;
}

export interface PackageExperience {
  id: string;
  title: string;
  /** Matches space-runtime ExperienceDefinition.type. */
  type: string;
  entry: { type: ExperienceEntryType; path: string };
  offlinePolicy: "cached" | "unavailable";
  /** Subset of the package permissions this experience requires to open. */
  requires: PackagePermission[];
}

export interface SpacePackageManifest {
  format: typeof SPACE_PACKAGE_FORMAT;
  formatVersion: typeof SPACE_PACKAGE_FORMAT_VERSION;
  package: { id: string; version: string; name: string; description?: string };
  publisher: { publisherId: string; keyId: string };
  runtime: { spaceContractVersion: number; minimumRuntimeVersion: string };
  space: { spaceId: string; defaultExperienceId: string; experiences: PackageExperience[] };
  assets: PackageAsset[];
  offline: { capabilities: string[]; contentIndex?: string };
  permissions: PackagePermission[];
  dependencies: Array<{ packageId: string; minimumVersion: string }>;
  license: { spdx: string; duplication: DuplicationPolicy; redistribution: boolean };
  provenance: { createdAt: string; tool: string; parent?: { packageId: string; version: string; integrityRoot: string } };
  integrity: { algorithm: "SHA-256"; root: string };
}

export interface SpacePackageSignature {
  algorithm: "Ed25519";
  publisherId: string;
  keyId: string;
  /** SHA-256 of the signed bytes (SIGNING_DOMAIN + canonical manifest). */
  manifestSha256: string;
  value: string;
}

/** Pinned publisher keys. A publisher absent from this list is UNKNOWN — never trusted implicitly. */
export interface TrustedPackagePublisher {
  publisherId: string;
  name: string;
  keys: ReadonlyArray<{ keyId: string; publicKeySpkiBase64: string }>;
  /** Package id prefixes this publisher may sign (e.g. "com.example."). */
  packagePrefixes: readonly string[];
}

export type PackageErrorCode =
  | "ARCHIVE_TOO_LARGE"
  | "NOT_A_SPACE_PACKAGE"
  | "MALFORMED_ARCHIVE"
  | "UNSUPPORTED_ARCHIVE_FEATURE"
  | "TOO_MANY_ENTRIES"
  | "DUPLICATE_PATH"
  | "UNSAFE_PATH"
  | "SYMLINK_NOT_ALLOWED"
  | "ENTRY_TOO_LARGE"
  | "DECOMPRESSION_BOMB"
  | "CRC_MISMATCH"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "UNSUPPORTED_FORMAT_VERSION"
  | "SIGNATURE_MISSING"
  | "SIGNATURE_INVALID"
  | "PUBLISHER_UNKNOWN"
  | "PUBLISHER_NOT_AUTHORIZED"
  | "ASSET_MISSING"
  | "ASSET_MODIFIED"
  | "UNDECLARED_ENTRY"
  | "INTEGRITY_ROOT_MISMATCH"
  | "DISALLOWED_MEDIA_TYPE"
  | "PRIVATE_DATA_DETECTED"
  | "AUTHORITY_CLONING_REJECTED"
  | "INCOMPATIBLE_RUNTIME"
  | "MISSING_DEPENDENCY"
  | "ALREADY_INSTALLED"
  | "INSTALLED_VERSION_CONFLICT"
  | "IMPORT_INTERRUPTED"
  | "NOT_INSTALLED"
  | "INSTALLATION_CORRUPT";

export class SpacePackageError extends Error {
  constructor(readonly code: PackageErrorCode, readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SpacePackageError";
  }
}
