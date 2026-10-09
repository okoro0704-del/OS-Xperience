import { canonicalJson } from "@digiconomy/xperience-contract";
import { SIGNING_DOMAIN, type PackageAsset, type SpacePackageManifest } from "./format.js";

/** Same algorithm and key encodings as every signed Xperience artifact: Ed25519, SPKI / PKCS#8, base64. */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** The exact bytes that are signed: a domain prefix, then the canonical manifest. */
export function signedBytes(manifest: SpacePackageManifest): Uint8Array {
  return new TextEncoder().encode(SIGNING_DOMAIN + canonicalJson(manifest));
}

/** Integrity root: SHA-256 over the canonical, path-sorted asset inventory (path, mediaType, size, sha256). */
export async function integrityRoot(assets: readonly PackageAsset[]): Promise<string> {
  const inventory = [...assets]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((asset) => ({ path: asset.path, mediaType: asset.mediaType, size: asset.size, sha256: asset.sha256 }));
  return sha256Hex(new TextEncoder().encode(canonicalJson(inventory)));
}

export interface PackageSigner {
  publisherId: string;
  keyId: string;
  privateKeyPkcs8Base64: string;
}

export async function signManifest(manifest: SpacePackageManifest, signer: PackageSigner): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", base64ToBytes(signer.privateKeyPkcs8Base64) as BufferSource, "Ed25519" as AlgorithmIdentifier, false, ["sign"]);
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign("Ed25519" as AlgorithmIdentifier, key, signedBytes(manifest) as BufferSource)));
}

export async function verifyManifestSignature(manifest: SpacePackageManifest, signatureBase64: string, publicKeySpkiBase64: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", base64ToBytes(publicKeySpkiBase64) as BufferSource, "Ed25519" as AlgorithmIdentifier, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519" as AlgorithmIdentifier, key, base64ToBytes(signatureBase64) as BufferSource, signedBytes(manifest) as BufferSource);
  } catch {
    return false;
  }
}

/** Disposable Ed25519 key pair (tests and demonstrations only — a real publisher key never enters a package). */
export async function generatePublisherKeyPair(): Promise<{ publicKeySpkiBase64: string; privateKeyPkcs8Base64: string }> {
  const pair = (await crypto.subtle.generateKey("Ed25519" as AlgorithmIdentifier, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    publicKeySpkiBase64: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))),
    privateKeyPkcs8Base64: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))),
  };
}
