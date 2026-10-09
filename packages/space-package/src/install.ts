import { createDescriptorProvider, CapabilityRegistry, resolveExperienceCapabilities, type CapabilityResolution } from "@digiconomy/space-capability-bridge";
import { createSpaceRuntime, type SpaceDefinition, type SpaceRuntime } from "@digiconomy/space-runtime";
import { sha256Hex } from "./crypto.js";
import {
  PACKAGE_PERMISSIONS,
  SpacePackageError,
  type PackageAsset,
  type PackagePermission,
  type SpacePackageManifest,
  type TrustedPackagePublisher,
} from "./format.js";
import { verifySpacePackage, type VerifyOptions } from "./package.js";

export const INSTALLATION_SCHEMA = "digiconomy.space-installation/v1";

/**
 * Local installation state — separate from the immutable package artifact, which is kept
 * unchanged and content-addressed by its integrity root.
 */
export interface InstallationRecord {
  schema: typeof INSTALLATION_SCHEMA;
  /** Local identity of this installation; never the publisher's, never transferable. */
  installationId: string;
  packageId: string;
  version: string;
  name: string;
  /** SHA-256 over the asset inventory (content identity). */
  integrityRoot: string;
  /** SHA-256 of the signed manifest (package identity: version, declarations and content). */
  packageDigest: string;
  publisher: { publisherId: string; keyId: string; trust: "TRUSTED_PUBLISHER" };
  installedAt: string;
  /**
   * Installing confers no ownership and no authority. Owner, grants and server-side authorization
   * are never copied from the publisher or the package; they can only be established locally,
   * later, by the systems that own them (TrustID, Digi Authority).
   */
  authority: { owner: null; grants: [] };
  manifest: SpacePackageManifest;
}

export interface StagingArea {
  writeArtifact(integrityRoot: string, bytes: Uint8Array): Promise<void>;
  writeAsset(path: string, bytes: Uint8Array): Promise<void>;
  writeRecord(record: InstallationRecord): Promise<void>;
  /** Atomically makes the installation visible. */
  commit(): Promise<void>;
  /** Removes everything this staging area wrote. */
  abort(): Promise<void>;
}

export interface InstallationStore {
  list(): Promise<InstallationRecord[]>;
  get(packageId: string): Promise<InstallationRecord | null>;
  readAsset(packageId: string, path: string): Promise<Uint8Array>;
  readArtifact(integrityRoot: string): Promise<Uint8Array>;
  stage(packageId: string): Promise<StagingArea>;
  /** Clears anything a crashed import left behind; committed installations are untouched. */
  recover(): Promise<{ discardedStaging: number }>;
}

export type ImportStep = "VERIFIED" | "STAGED_ARTIFACT" | "STAGED_ASSETS" | "STAGED_RECORD" | "COMMITTED";

export interface ImportOptions extends Omit<VerifyOptions, "installed"> {
  store: InstallationStore;
  now?: () => Date;
  newInstallationId?: () => string;
  /** Test hook: observe (or interrupt) each import step. */
  onStep?: (step: ImportStep) => void | Promise<void>;
}

export type ImportResult =
  | { status: "INSTALLED"; record: InstallationRecord }
  | { status: "ALREADY_INSTALLED"; record: InstallationRecord };

/** space import — verify, then install transactionally: either the whole installation exists or none of it. */
export async function importSpacePackage(bytes: Uint8Array, options: ImportOptions): Promise<ImportResult> {
  const { store } = options;
  await store.recover();
  const installed = (await store.list()).map((record) => ({ packageId: record.packageId, version: record.version }));
  const verified = await verifySpacePackage(bytes, { ...options, installed });
  await options.onStep?.("VERIFIED");
  const { manifest } = verified;
  const existing = await store.get(manifest.package.id);
  if (existing) {
    if (existing.packageDigest === verified.packageDigest) return { status: "ALREADY_INSTALLED", record: existing };
    // Updating an installed Space (and migrating its local state) is SP2.
    throw new SpacePackageError("INSTALLED_VERSION_CONFLICT", `${manifest.package.id} ${existing.version} is installed`);
  }
  const record: InstallationRecord = {
    schema: INSTALLATION_SCHEMA,
    installationId: options.newInstallationId?.() ?? crypto.randomUUID(),
    packageId: manifest.package.id,
    version: manifest.package.version,
    name: manifest.package.name,
    integrityRoot: verified.integrityRoot,
    packageDigest: verified.packageDigest,
    publisher: { publisherId: manifest.publisher.publisherId, keyId: manifest.publisher.keyId, trust: "TRUSTED_PUBLISHER" },
    installedAt: (options.now?.() ?? new Date()).toISOString(),
    authority: { owner: null, grants: [] },
    manifest,
  };
  const staging = await store.stage(manifest.package.id);
  try {
    await staging.writeArtifact(verified.integrityRoot, bytes);
    await options.onStep?.("STAGED_ARTIFACT");
    for (const [path, data] of verified.assets) await staging.writeAsset(path, data);
    await options.onStep?.("STAGED_ASSETS");
    await staging.writeRecord(record);
    await options.onStep?.("STAGED_RECORD");
    await staging.commit();
  } catch (error) {
    await staging.abort().catch(() => undefined);
    if (error instanceof SpacePackageError) throw error;
    throw new SpacePackageError("IMPORT_INTERRUPTED", error instanceof Error ? error.message : String(error));
  }
  await options.onStep?.("COMMITTED");
  return { status: "INSTALLED", record };
}

/** space list */
export async function listSpaces(store: InstallationStore): Promise<Array<Pick<InstallationRecord, "packageId" | "version" | "name" | "installationId" | "integrityRoot" | "packageDigest" | "publisher" | "installedAt">>> {
  return (await store.list()).map(({ packageId, version, name, installationId, integrityRoot, packageDigest, publisher, installedAt }) => ({ packageId, version, name, installationId, integrityRoot, packageDigest, publisher, installedAt }));
}

/** What the running device can provide. Remote permissions need a route; offline there is none. */
export interface RuntimeEnvironment {
  online: boolean;
  /** Remote services this installation has a valid, authorized route to (e.g. "network.sync"). */
  routes?: readonly PackagePermission[];
  /** Local capabilities this runtime actually implements. Defaults to all LOCAL permissions. */
  localCapabilities?: readonly PackagePermission[];
}

/** Capability provider for package permissions, reflecting what the runtime can actually do right now. */
export function packagePermissionProvider(environment: RuntimeEnvironment) {
  const local = new Set<string>(environment.localCapabilities ?? Object.entries(PACKAGE_PERMISSIONS).filter(([, value]) => value.scope === "LOCAL").map(([key]) => key));
  const routes = new Set<string>(environment.routes ?? []);
  return createDescriptorProvider("space-package-runtime", "1.0.0", (id) => id in PACKAGE_PERMISSIONS, (id) => {
    const scope = PACKAGE_PERMISSIONS[id as PackagePermission].scope;
    if (scope === "LOCAL") return local.has(id) ? { state: "AVAILABLE" } : { state: "NOT_IMPLEMENTED", reason: "RUNTIME_CAPABILITY_MISSING" };
    if (!environment.online) return { state: "UNAVAILABLE", reason: "OFFLINE" };
    return routes.has(id) ? { state: "AVAILABLE" } : { state: "UNAVAILABLE", reason: "NO_VALID_ROUTE" };
  });
}

export const CONTENT_INDEX_FORMAT = "space.content-index/v1";
export type ContentKind = "image" | "audio" | "video" | "text";
export interface ContentIndexItem { id: string; title: string; asset: string; kind: ContentKind }
export interface ContentIndex { format: typeof CONTENT_INDEX_FORMAT; title: string; items: ContentIndexItem[] }

const KIND_TYPES: Record<ContentKind, RegExp> = { image: /^image\//, audio: /^audio\//, video: /^video\//, text: /^text\/plain$/ };

function parseContentIndex(bytes: Uint8Array, assets: readonly PackageAsset[]): ContentIndex {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SpacePackageError("INSTALLATION_CORRUPT", "content index is not JSON");
  }
  const index = value as ContentIndex;
  const keys = (object: object, allowed: string[]) => Object.keys(object).every((key) => allowed.includes(key));
  if (!index || typeof index !== "object" || !keys(index, ["format", "title", "items"]) || index.format !== CONTENT_INDEX_FORMAT || typeof index.title !== "string" || !Array.isArray(index.items)) {
    throw new SpacePackageError("INSTALLATION_CORRUPT", "content index shape");
  }
  for (const item of index.items) {
    const asset = assets.find((candidate) => candidate.path === item?.asset);
    if (!item || typeof item !== "object" || !keys(item, ["id", "title", "asset", "kind"]) || typeof item.id !== "string" || typeof item.title !== "string"
      || !asset || !(item.kind in KIND_TYPES) || !KIND_TYPES[item.kind].test(asset.mediaType)) {
      throw new SpacePackageError("INSTALLATION_CORRUPT", "content index item");
    }
  }
  return index;
}

export interface OpenedSpace {
  installation: Pick<InstallationRecord, "installationId" | "packageId" | "version" | "authority">;
  /** The canonical Space Runtime definition and its initial runtime state. */
  definition: SpaceDefinition;
  runtime: SpaceRuntime;
  experience: { id: string; state: "READY" | "DEGRADED" | "BLOCKED"; content: ContentIndex | null };
  permissions: { granted: PackagePermission[]; denied: Array<{ permission: string; reason: string }> };
  capabilities: Record<string, CapabilityResolution>;
  /** Opening reads only this installation. */
  network: "NOT_USED";
}

/**
 * space open — loads an installed Space into the canonical Space Runtime. A permission is granted
 * only when the package declares it AND the runtime can provide it now; nothing undeclared is ever
 * granted, whatever the runtime offers. Installed bytes are re-checked against the signed hashes.
 */
export async function openSpace(store: InstallationStore, packageId: string, options: { environment: RuntimeEnvironment; experienceId?: string; registry?: CapabilityRegistry; requested?: readonly string[] }): Promise<OpenedSpace> {
  const record = await store.get(packageId);
  if (!record) throw new SpacePackageError("NOT_INSTALLED", packageId);
  const { manifest } = record;
  const experienceId = options.experienceId ?? manifest.space.defaultExperienceId;
  const experience = manifest.space.experiences.find((item) => item.id === experienceId);
  if (!experience) throw new SpacePackageError("NOT_INSTALLED", `experience ${experienceId}`);

  const readVerified = async (path: string) => {
    const asset = manifest.assets.find((item) => item.path === path);
    if (!asset) throw new SpacePackageError("INSTALLATION_CORRUPT", path);
    let bytes: Uint8Array;
    try {
      bytes = await store.readAsset(packageId, path);
    } catch {
      throw new SpacePackageError("INSTALLATION_CORRUPT", `missing ${path}`);
    }
    if (bytes.length !== asset.size || (await sha256Hex(bytes)) !== asset.sha256) throw new SpacePackageError("INSTALLATION_CORRUPT", `modified ${path}`);
    return bytes;
  };

  const definition: SpaceDefinition = {
    id: manifest.space.spaceId,
    // The Space contract's owner is this local installation, never the publisher.
    owner: `installation:${record.installationId}`,
    defaultExperienceId: manifest.space.defaultExperienceId,
    experiences: manifest.space.experiences.map((item) => ({ id: item.id, title: item.title, type: item.type, lifecyclePolicy: "retained" as const, offlinePolicy: item.offlinePolicy })),
  };
  const runtime = createSpaceRuntime(definition);

  const registry = options.registry ?? new CapabilityRegistry();
  if (!options.registry) registry.register(packagePermissionProvider(options.environment));
  const declared = new Set<string>(manifest.permissions);
  const resolution = await resolveExperienceCapabilities(experience.requires.map((id) => ({ id, requirement: "REQUIRED" as const })), registry, { spaceId: definition.id, experienceId });
  const granted: PackagePermission[] = [];
  const denied: Array<{ permission: string; reason: string }> = [];
  const asked = new Set<string>([...experience.requires, ...(options.requested ?? [])]);
  for (const permission of asked) {
    if (!declared.has(permission)) { denied.push({ permission, reason: "NOT_DECLARED" }); continue; }
    const state = resolution.capabilities[permission] ?? (await registry.resolve(permission));
    if (state.state === "AVAILABLE" || state.state === "DEGRADED") granted.push(permission as PackagePermission);
    else denied.push({ permission, reason: state.reason ?? state.state });
  }

  let state: "READY" | "DEGRADED" | "BLOCKED" = resolution.experienceState;
  if (!options.environment.online && experience.offlinePolicy === "unavailable") state = "BLOCKED";
  const content = state === "BLOCKED" ? null : parseContentIndex(await readVerified(experience.entry.path), manifest.assets);
  if (content) for (const item of content.items) await readVerified(item.asset);

  return {
    installation: { installationId: record.installationId, packageId: record.packageId, version: record.version, authority: record.authority },
    definition,
    runtime,
    experience: { id: experienceId, state, content },
    permissions: { granted, denied },
    capabilities: resolution.capabilities,
    network: "NOT_USED",
  };
}

export type { TrustedPackagePublisher };
