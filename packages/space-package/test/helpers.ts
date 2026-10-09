import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";
import { canonicalJson } from "@digiconomy/xperience-contract";
import {
  ASSET_MEDIA_TYPES,
  MANIFEST_PATH,
  MIMETYPE_PATH,
  SIGNATURE_PATH,
  SPACE_PACKAGE_MEDIA_TYPE,
  crc32,
  generatePublisherKeyPair,
  sha256Hex,
  signManifest,
  signedBytes,
  type PackDeclaration,
  type PackFile,
  type PackageSigner,
  type SpacePackageManifest,
  type TrustedPackagePublisher,
} from "../src/index.js";

export const DEMO_DIR = resolve(import.meta.dirname, "../../../examples/space-package/lantern");

const MEDIA = new Map(Object.entries(ASSET_MEDIA_TYPES).flatMap(([type, extensions]) => extensions.map((extension) => [extension, type] as const)));

export function demoDeclaration(): PackDeclaration {
  return JSON.parse(readFileSync(join(DEMO_DIR, "space.source.json"), "utf8")) as PackDeclaration;
}

export function demoFiles(): PackFile[] {
  const out: PackFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else out.push({ path: relative(DEMO_DIR, path).split(sep).join("/"), mediaType: MEDIA.get(name.name.slice(name.name.lastIndexOf(".")).toLowerCase())!, bytes: new Uint8Array(readFileSync(path)) });
    }
  };
  walk(join(DEMO_DIR, "content"));
  return out;
}

export interface TestPublisher {
  signer: PackageSigner;
  trusted: TrustedPackagePublisher;
}

/** Disposable keys, generated per test run — never written to the repository. */
export async function testPublisher(publisherId = "digiconomy.demo", keyId = "demo-key-1", prefixes = ["org.digiconomy.demo."]): Promise<TestPublisher> {
  const keys = await generatePublisherKeyPair();
  return {
    signer: { publisherId, keyId, privateKeyPkcs8Base64: keys.privateKeyPkcs8Base64 },
    trusted: { publisherId, name: "Digiconomy Demo Publisher", keys: [{ keyId, publicKeySpkiBase64: keys.publicKeySpkiBase64 }], packagePrefixes: prefixes },
  };
}

export interface CraftEntry {
  path: string;
  bytes: Uint8Array;
  method?: 0 | 8;
  /** Overrides the uncompressed size written in the headers (lying archives). */
  declaredSize?: number;
  /** Unix mode written in the external attributes (e.g. 0o120777 for a symlink). */
  mode?: number;
  crc?: number;
}

/** Hand-built ZIP for hostile cases the package writer itself refuses to produce. */
export function craftZip(entries: readonly CraftEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(encoder.encode(entry.path));
    const method = entry.method ?? 0;
    const data = method === 8 ? deflateRawSync(entry.bytes) : Buffer.from(entry.bytes);
    const size = entry.declaredSize ?? entry.bytes.length;
    const crc = entry.crc ?? crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE((3 << 8) | 20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8); header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16); header.writeUInt32LE(data.length, 20); header.writeUInt32LE(size, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE((((entry.mode ?? 0o100644) << 16) >>> 0), 38); header.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

/** Assembles a package from an arbitrary (possibly hostile) manifest, signed with the given key. */
export async function assemble(manifest: SpacePackageManifest, signer: PackageSigner, files: readonly { path: string; bytes: Uint8Array }[], extra: readonly CraftEntry[] = []): Promise<Uint8Array> {
  const signature = {
    algorithm: "Ed25519",
    publisherId: signer.publisherId,
    keyId: signer.keyId,
    manifestSha256: await sha256Hex(signedBytes(manifest)),
    value: await signManifest(manifest, signer),
  };
  const encoder = new TextEncoder();
  return craftZip([
    { path: MIMETYPE_PATH, bytes: encoder.encode(SPACE_PACKAGE_MEDIA_TYPE) },
    { path: MANIFEST_PATH, bytes: encoder.encode(canonicalJson(manifest)) },
    { path: SIGNATURE_PATH, bytes: encoder.encode(canonicalJson(signature)) },
    ...files,
    ...extra,
  ]);
}

/** Replaces one entry's bytes in a package (headers and CRC rewritten, so only content checks can catch it). */
export function replaceEntry(files: readonly { path: string; bytes: Uint8Array }[], path: string, bytes: Uint8Array) {
  return files.map((file) => (file.path === path ? { path, bytes } : file));
}

export const RUNTIME = { version: "1.0.0" };
