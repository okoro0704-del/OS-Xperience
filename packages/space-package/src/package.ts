import { canonicalJson } from "@digiconomy/xperience-contract";
import { integrityRoot, sha256Hex, signedBytes, signManifest, verifyManifestSignature, type PackageSigner } from "./crypto.js";
import {
  CONTENT_ROOT,
  LIMITS,
  MANIFEST_PATH,
  MIMETYPE_PATH,
  SIGNATURE_PATH,
  SPACE_CONTRACT_VERSION,
  SPACE_PACKAGE_FORMAT,
  SPACE_PACKAGE_FORMAT_VERSION,
  SPACE_PACKAGE_MEDIA_TYPE,
  SpacePackageError,
  type PackageAsset,
  type PackageLimits,
  type SpacePackageManifest,
  type SpacePackageSignature,
  type TrustedPackagePublisher,
} from "./format.js";
import { findPrivateData, mediaTypeAllowed, validateManifest, validateSignature } from "./policy.js";
import { readZip, writeZip, type ZipArchive, type ZipEntry } from "./zip.js";

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  return 0;
}

export interface PackFile {
  /** Archive path, under content/. */
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}

/** Everything the publisher declares; assets, integrity and format fields are computed. */
export type PackDeclaration = Omit<SpacePackageManifest, "format" | "formatVersion" | "assets" | "integrity" | "publisher">;

/**
 * space pack — builds a signed, immutable package. Refuses private data, authority fields,
 * undeclared media types and unsafe paths: nothing is exported that could not be verified.
 */
export async function packSpace(input: { declaration: PackDeclaration; files: readonly PackFile[]; signer: PackageSigner }): Promise<{ bytes: Uint8Array; manifest: SpacePackageManifest }> {
  const files = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const assets: PackageAsset[] = [];
  for (const file of files) {
    if (!file.path.startsWith(CONTENT_ROOT)) throw new SpacePackageError("UNSAFE_PATH", `${file.path} is not under ${CONTENT_ROOT}`);
    if (!mediaTypeAllowed(file.path, file.mediaType)) throw new SpacePackageError("DISALLOWED_MEDIA_TYPE", file.path);
    const leak = findPrivateData(file.path, file.bytes, file.mediaType);
    if (leak) throw new SpacePackageError(leak.startsWith("authority field") ? "AUTHORITY_CLONING_REJECTED" : "PRIVATE_DATA_DETECTED", leak);
    assets.push({ path: file.path, mediaType: file.mediaType, size: file.bytes.length, sha256: await sha256Hex(file.bytes) });
  }
  const manifest: SpacePackageManifest = {
    ...input.declaration,
    format: SPACE_PACKAGE_FORMAT,
    formatVersion: SPACE_PACKAGE_FORMAT_VERSION,
    publisher: { publisherId: input.signer.publisherId, keyId: input.signer.keyId },
    assets,
    integrity: { algorithm: "SHA-256", root: await integrityRoot(assets) },
  };
  validateManifest(manifest);
  const signature: SpacePackageSignature = {
    algorithm: "Ed25519",
    publisherId: input.signer.publisherId,
    keyId: input.signer.keyId,
    manifestSha256: await sha256Hex(signedBytes(manifest)),
    value: await signManifest(manifest, input.signer),
  };
  const encoder = new TextEncoder();
  const bytes = writeZip([
    { path: MIMETYPE_PATH, bytes: encoder.encode(SPACE_PACKAGE_MEDIA_TYPE) },
    { path: MANIFEST_PATH, bytes: encoder.encode(canonicalJson(manifest)) },
    { path: SIGNATURE_PATH, bytes: encoder.encode(canonicalJson(signature)) },
    ...files.map((file) => ({ path: file.path, bytes: file.bytes })),
  ]);
  return { bytes, manifest };
}

interface Opened {
  archive: ZipArchive;
  byPath: Map<string, ZipEntry>;
  manifest: SpacePackageManifest;
  signature: SpacePackageSignature;
}

async function openPackage(bytes: Uint8Array, limits: PackageLimits): Promise<Opened> {
  const archive = readZip(bytes, limits);
  const first = archive.entries[0];
  // Recognised by content: the first entry is an uncompressed media type, never the file extension.
  if (!first || first.path !== MIMETYPE_PATH || first.method !== 0) throw new SpacePackageError("NOT_A_SPACE_PACKAGE", "mimetype entry");
  if (new TextDecoder().decode(await archive.read(first)) !== SPACE_PACKAGE_MEDIA_TYPE) throw new SpacePackageError("NOT_A_SPACE_PACKAGE", "media type");
  const byPath = new Map(archive.entries.map((entry) => [entry.path, entry]));
  for (const entry of archive.entries) {
    if (entry.path !== MIMETYPE_PATH && entry.path !== MANIFEST_PATH && entry.path !== SIGNATURE_PATH && !entry.path.startsWith(CONTENT_ROOT)) {
      throw new SpacePackageError("UNDECLARED_ENTRY", entry.path);
    }
  }
  const manifestEntry = byPath.get(MANIFEST_PATH);
  if (!manifestEntry) throw new SpacePackageError("MANIFEST_MISSING");
  if (manifestEntry.size > LIMITS.maxManifestBytes) throw new SpacePackageError("MANIFEST_INVALID", "too large");
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await archive.read(manifestEntry)));
  } catch (error) {
    if (error instanceof SpacePackageError) throw error;
    throw new SpacePackageError("MANIFEST_INVALID", "not JSON");
  }
  validateManifest(manifest);
  const signatureEntry = byPath.get(SIGNATURE_PATH);
  if (!signatureEntry) throw new SpacePackageError("SIGNATURE_MISSING");
  let signature: unknown;
  try {
    signature = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await archive.read(signatureEntry)));
  } catch (error) {
    if (error instanceof SpacePackageError) throw error;
    throw new SpacePackageError("SIGNATURE_INVALID", "not JSON");
  }
  validateSignature(signature);
  return { archive, byPath, manifest, signature };
}

export interface PackageInspection {
  manifest: SpacePackageManifest;
  signature: SpacePackageSignature;
  entries: Array<{ path: string; size: number; compressedSize: number; method: "STORED" | "DEFLATE" }>;
  /** Inspection reads structure only: the publisher is not evaluated and nothing is trusted. */
  trust: "NOT_EVALUATED";
}

/** space inspect — structure and declarations, without trust decisions or a live server. */
export async function inspectSpacePackage(bytes: Uint8Array, limits: PackageLimits = LIMITS): Promise<PackageInspection> {
  const { archive, manifest, signature } = await openPackage(bytes, limits);
  return {
    manifest,
    signature,
    entries: archive.entries.map((entry) => ({ path: entry.path, size: entry.size, compressedSize: entry.compressedSize, method: entry.method === 0 ? "STORED" : "DEFLATE" })),
    trust: "NOT_EVALUATED",
  };
}

export interface VerifyOptions {
  publishers: readonly TrustedPackagePublisher[];
  /** The local Space Runtime: its version and the Space contract versions it executes. */
  runtime: { version: string; spaceContractVersions?: readonly number[] };
  /** Installed packages, for dependency checks. Omit to skip (inspection-only contexts). */
  installed?: ReadonlyArray<{ packageId: string; version: string }>;
  limits?: PackageLimits;
}

export interface VerifiedPackage {
  manifest: SpacePackageManifest;
  publisher: TrustedPackagePublisher;
  integrityRoot: string;
  /** Identity of this exact package: SHA-256 of its signed bytes (domain + canonical manifest). */
  packageDigest: string;
  /** Verified asset bytes, by path — import writes exactly these, never re-reading the archive. */
  assets: Map<string, Uint8Array>;
  trust: "TRUSTED_PUBLISHER";
}

/**
 * space verify — fully offline: structure, publisher trust (pinned keys only), signature,
 * every asset hash, the integrity root, private data, runtime compatibility and dependencies.
 */
export async function verifySpacePackage(bytes: Uint8Array, options: VerifyOptions): Promise<VerifiedPackage> {
  const { archive, byPath, manifest, signature } = await openPackage(bytes, options.limits ?? LIMITS);
  if (signature.publisherId !== manifest.publisher.publisherId || signature.keyId !== manifest.publisher.keyId) {
    throw new SpacePackageError("SIGNATURE_INVALID", "signature does not name the manifest publisher");
  }
  const publisher = options.publishers.find((item) => item.publisherId === manifest.publisher.publisherId);
  const key = publisher?.keys.find((item) => item.keyId === manifest.publisher.keyId);
  // An unknown publisher or key is reported as such — never verified against an embedded key, never trusted.
  if (!publisher || !key) throw new SpacePackageError("PUBLISHER_UNKNOWN", `${manifest.publisher.publisherId}/${manifest.publisher.keyId}`);
  if (!publisher.packagePrefixes.some((prefix) => manifest.package.id.startsWith(prefix))) throw new SpacePackageError("PUBLISHER_NOT_AUTHORIZED", manifest.package.id);
  if ((await sha256Hex(signedBytes(manifest))) !== signature.manifestSha256) throw new SpacePackageError("SIGNATURE_INVALID", "manifest digest");
  if (!(await verifyManifestSignature(manifest, signature.value, key.publicKeySpkiBase64))) throw new SpacePackageError("SIGNATURE_INVALID");

  const declared = new Map(manifest.assets.map((asset) => [asset.path, asset]));
  for (const entry of archive.entries) {
    if (entry.path.startsWith(CONTENT_ROOT) && !declared.has(entry.path)) throw new SpacePackageError("UNDECLARED_ENTRY", entry.path);
  }
  const assets = new Map<string, Uint8Array>();
  for (const asset of manifest.assets) {
    const entry = byPath.get(asset.path);
    if (!entry) throw new SpacePackageError("ASSET_MISSING", asset.path);
    if (entry.size !== asset.size) throw new SpacePackageError("ASSET_MODIFIED", asset.path);
    let data: Uint8Array;
    try {
      data = await archive.read(entry);
    } catch (error) {
      if (error instanceof SpacePackageError && error.code === "CRC_MISMATCH") throw new SpacePackageError("ASSET_MODIFIED", asset.path);
      throw error;
    }
    if ((await sha256Hex(data)) !== asset.sha256) throw new SpacePackageError("ASSET_MODIFIED", asset.path);
    const leak = findPrivateData(asset.path, data, asset.mediaType);
    if (leak) throw new SpacePackageError(leak.startsWith("authority field") ? "AUTHORITY_CLONING_REJECTED" : "PRIVATE_DATA_DETECTED", leak);
    assets.set(asset.path, data);
  }
  const root = await integrityRoot(manifest.assets);
  if (root !== manifest.integrity.root) throw new SpacePackageError("INTEGRITY_ROOT_MISMATCH");

  const contracts = options.runtime.spaceContractVersions ?? [SPACE_CONTRACT_VERSION];
  if (!contracts.includes(manifest.runtime.spaceContractVersion)) throw new SpacePackageError("INCOMPATIBLE_RUNTIME", `Space contract ${manifest.runtime.spaceContractVersion}`);
  if (compareVersions(options.runtime.version, manifest.runtime.minimumRuntimeVersion) < 0) throw new SpacePackageError("INCOMPATIBLE_RUNTIME", `needs runtime ${manifest.runtime.minimumRuntimeVersion}`);
  if (options.installed) {
    for (const dependency of manifest.dependencies) {
      const present = options.installed.find((item) => item.packageId === dependency.packageId && compareVersions(item.version, dependency.minimumVersion) >= 0);
      if (!present) throw new SpacePackageError("MISSING_DEPENDENCY", `${dependency.packageId} ≥ ${dependency.minimumVersion}`);
    }
  }
  return { manifest, publisher, integrityRoot: root, packageDigest: signature.manifestSha256, assets, trust: "TRUSTED_PUBLISHER" };
}
