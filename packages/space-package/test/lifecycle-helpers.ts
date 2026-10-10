import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  ASSET_MEDIA_TYPES,
  MemoryLifecycleBackend,
  SpaceLifecycle,
  generatePublisherKeyPair,
  inspectSpacePackage,
  packSpace,
  serializeUpdateDocument,
  signUpdateDocument,
  trustStoreFromPublishers,
  type Failpoint,
  type LifecycleBackend,
  type PackDeclaration,
  type PackFile,
  type PackageSigner,
  type TrustStore,
  type UpdateDocument,
} from "../src/index.js";

export const RELEASES = resolve(import.meta.dirname, "../../../examples/space-package/lantern-releases");
const MEDIA = new Map(Object.entries(ASSET_MEDIA_TYPES).flatMap(([type, extensions]) => extensions.map((extension) => [extension, type] as const)));

export function releaseSource(version: "v1" | "v2"): { declaration: PackDeclaration; files: PackFile[] } {
  const dir = join(RELEASES, version);
  const files: PackFile[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: relative(dir, full).split(sep).join("/"), mediaType: MEDIA.get(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())!, bytes: new Uint8Array(readFileSync(full)) });
    }
  };
  walk(join(dir, "content"));
  return { declaration: JSON.parse(readFileSync(join(dir, "space.source.json"), "utf8")) as PackDeclaration, files };
}

export interface Key { keyId: string; publicKeySpkiBase64: string; privateKeyPkcs8Base64: string }
export async function newKey(keyId: string): Promise<Key> {
  return { keyId, ...(await generatePublisherKeyPair()) };
}
export const signerFor = (publisherId: string, key: Key): PackageSigner => ({ publisherId, keyId: key.keyId, privateKeyPkcs8Base64: key.privateKeyPkcs8Base64 });

export interface Release { bytes: Uint8Array; version: string; packageDigest: string; sequence: number }

export async function pack(declaration: PackDeclaration, files: readonly PackFile[], signer: PackageSigner, sequence: number): Promise<Release> {
  const { bytes } = await packSpace({ declaration, files, signer });
  const inspection = await inspectSpacePackage(bytes);
  return { bytes, version: declaration.package.version, packageDigest: inspection.signature.manifestSha256, sequence };
}

/** V1→V2: additive migration (the previous release can still read the result). */
export const V2_MIGRATION = {
  fromDataVersion: 1,
  toDataVersion: 2,
  migration: [
    { op: "setPreferenceDefault" as const, key: "chime.volume", value: 0.8 },
    { op: "setSettingDefault" as const, key: "gallery.layout", value: "grid" },
  ],
  backwardCompatible: true,
};

export async function makeUpdate(from: Release, to: Release, signing: { publisherId: string; key: Key }, overrides: Partial<Omit<UpdateDocument, "signature" | "format" | "formatVersion">> = {}): Promise<Uint8Array> {
  const doc = await signUpdateDocument({
    lineage: { packageId: "org.digiconomy.demo.lantern" },
    publisher: { publisherId: signing.publisherId, keyId: signing.key.keyId },
    from: { version: from.version, packageDigest: from.packageDigest, sequence: from.sequence },
    to: { version: to.version, packageDigest: to.packageDigest, sequence: to.sequence },
    compatibility: { spaceContractVersion: 1, minimumRuntimeVersion: "1.0.0" },
    permissions: ["content.read", "media.playback", "network.sync"],
    state: V2_MIGRATION,
    rollback: { eligible: true, minimumSequence: from.sequence },
    security: { requiresRevocationSequence: null, requiresCurrentRevocation: false },
    issuedAt: "2026-10-10T00:00:00.000Z",
    ...overrides,
  }, signing.key.privateKeyPkcs8Base64);
  return serializeUpdateDocument(doc);
}

export interface World {
  publisherId: string;
  key: Key;
  trust: TrustStore;
  backend: LifecycleBackend;
  lifecycle: SpaceLifecycle;
  clock: { now: Date };
  failAt: { point: Failpoint | null; error: () => Error };
  v1: Release;
  v2: Release;
  /** A new engine over the same storage — what a restarted process sees. */
  restart(): SpaceLifecycle;
}

export async function world(options: { backend?: LifecycleBackend; runtimeVersion?: string } = {}): Promise<World> {
  const publisherId = "digiconomy.demo";
  const key = await newKey("demo-key-1");
  const w = {
    publisherId,
    key,
    trust: trustStoreFromPublishers([{ publisherId, name: "Digiconomy Demo Publisher", keys: [{ keyId: key.keyId, publicKeySpkiBase64: key.publicKeySpkiBase64 }], packagePrefixes: ["org.digiconomy.demo."] }]),
    backend: options.backend ?? new MemoryLifecycleBackend(),
    clock: { now: new Date("2026-10-10T09:00:00.000Z") },
    failAt: { point: null as Failpoint | null, error: (): Error => new Error("unset") },
  } as World;
  const engine = () => new SpaceLifecycle(w.backend, {
    trust: () => w.trust,
    runtime: { version: options.runtimeVersion ?? "1.0.0" },
    now: () => w.clock.now,
    failpoint: (point) => { if (w.failAt.point === point) { w.failAt.point = null; throw w.failAt.error(); } },
  });
  w.lifecycle = engine();
  w.restart = engine;
  const v1 = releaseSource("v1");
  const v2 = releaseSource("v2");
  w.v1 = await pack(v1.declaration, v1.files, signerFor(publisherId, key), 1);
  w.v2 = await pack(v2.declaration, v2.files, signerFor(publisherId, key), 2);
  return w;
}

export const LANTERN = "org.digiconomy.demo.lantern";
