import {
  compareDottedVersion,
  isSpaceLaunchFile,
  spaceLaunchSignedContent,
  verifySpaceLaunchFile,
  type CatalogExecutionTarget,
  type SpaceLaunchErrorCode,
  type SpaceLaunchFile,
  type SpaceLaunchStage,
  type TrustedSpacePublisher,
} from "@digiconomy/xperience-contract";
import { bootstrapPublicEntry } from "./bootstrap.js";
import { readSignedCatalog } from "./catalog.js";
import { trustedSpacePublishers } from "./space-publishers.js";
import { readJson, writeJson } from "./storage.js";

/**
 * Trusted local registrations of verified Space Launch Files. A registration is not preparation:
 * prepared state lives only in the Offline Kernel store, keyed by the Space's broadcast channel.
 */
export const SPACE_REGISTRY_KEY = "ox.space-registrations.v1";

interface StoredRegistration {
  launchFile: SpaceLaunchFile;
  registeredAt: string;
  byteLength: number;
}

export interface SpaceRegistration {
  providerId: string;
  publisherId: string;
  publisherName: string;
  version: string;
  name: string;
  description?: string;
  icon?: string;
  broadcastChannelId: string;
  preparationEndpoint?: string;
  registeredAt: string;
  /** Size of the launch file itself — never the prepared footprint. */
  byteLength: number;
}

export type SpaceImportCode =
  | SpaceLaunchErrorCode
  | "PROVIDER_UNKNOWN"
  | "ALREADY_INSTALLED"
  | "UPDATE_AVAILABLE"
  | "DOWNGRADE_REJECTED"
  | "IMPORT_FAILED";

export type SpaceImportResult =
  | { ok: true; stage: "REGISTERED"; outcome: "REGISTERED" | "UPDATED"; registration: SpaceRegistration }
  | { ok: false; stage: SpaceLaunchStage; code: SpaceImportCode; registered?: SpaceRegistration; offeredVersion?: string };

export interface SpaceImportOptions {
  /** The running OS Xperience version (semver). */
  xperienceVersion: string;
  /** Explicit consent to replace a registration with a newer, validly signed version. */
  acceptUpdate?: boolean;
  spaceRuntimeVersion?: number;
}

/** Consumer-facing wording; deterministic codes stay available for diagnostics, cryptographic detail never surfaces. */
export const SPACE_IMPORT_MESSAGE: Record<SpaceImportCode | "REGISTERED" | "UPDATED", string> = {
  REGISTERED: "Space added. Prepare it to run offline.",
  UPDATED: "Space updated.",
  LAUNCH_FILE_TOO_LARGE: "This file is too large to be a Space launch file.",
  INVALID_FORMAT: "This file isn't a valid Space launch file.",
  UNSUPPORTED_SCHEMA: "This Space launch file needs a newer OS Xperience.",
  PUBLISHER_UNKNOWN: "This Space comes from a publisher this installation doesn't trust.",
  INTEGRITY_FAILED: "This Space launch file was altered or damaged.",
  SIGNATURE_INVALID: "This Space launch file's signature couldn't be verified.",
  IDENTITY_CONFLICT: "This Space conflicts with a provider already on this installation.",
  INCOMPATIBLE_XPERIENCE: "This Space needs a newer OS Xperience.",
  INCOMPATIBLE_RUNTIME: "This Space needs a newer Space runtime.",
  PROVIDER_UNKNOWN: "This Space belongs to a provider this installation doesn't know yet.",
  ALREADY_INSTALLED: "This Space is already on this installation.",
  UPDATE_AVAILABLE: "A newer version of this Space is available.",
  DOWNGRADE_REJECTED: "This is an older version of a Space already on this installation.",
  IMPORT_FAILED: "The Space couldn't be added. Try again.",
};

function pinned(file: SpaceLaunchFile, publishers: readonly TrustedSpacePublisher[]): TrustedSpacePublisher | null {
  const publisher = publishers.find((item) => item.publisherId === file.payload.publisherId);
  if (!publisher?.keys.some((key) => key.keyId === file.signature.keyId)) return null;
  return publisher.providers.includes(file.payload.providerId) ? publisher : null;
}

/** Verified on import; on read, anything malformed or no longer pinned is ignored rather than trusted. */
function readStored(): StoredRegistration[] {
  const raw = readJson<{ schemaVersion?: unknown; entries?: unknown }>(SPACE_REGISTRY_KEY);
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.entries)) return [];
  const publishers = trustedSpacePublishers();
  const seen = new Set<string>();
  return raw.entries.filter((entry): entry is StoredRegistration => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as Partial<StoredRegistration>;
    if (!isSpaceLaunchFile(row.launchFile) || typeof row.registeredAt !== "string" || typeof row.byteLength !== "number") return false;
    if (!pinned(row.launchFile, publishers) || seen.has(row.launchFile.payload.providerId)) return false;
    seen.add(row.launchFile.payload.providerId);
    return true;
  });
}

function writeStored(entries: StoredRegistration[]): void {
  writeJson(SPACE_REGISTRY_KEY, { schemaVersion: 1, entries });
}

function describe(entry: StoredRegistration): SpaceRegistration {
  const { payload } = entry.launchFile;
  const publisher = trustedSpacePublishers().find((item) => item.publisherId === payload.publisherId);
  return {
    providerId: payload.providerId,
    publisherId: payload.publisherId,
    publisherName: publisher?.name ?? payload.publisherId,
    version: payload.version,
    name: payload.presentation.name,
    ...(payload.presentation.description ? { description: payload.presentation.description } : {}),
    ...(payload.presentation.icon ? { icon: payload.presentation.icon } : {}),
    broadcastChannelId: payload.execution.broadcastChannelId,
    ...(payload.preparation.endpoint ? { preparationEndpoint: payload.preparation.endpoint } : {}),
    registeredAt: entry.registeredAt,
    byteLength: entry.byteLength,
  };
}

export function readSpaceRegistrations(): SpaceRegistration[] {
  return readStored().map(describe);
}

export function findSpaceRegistration(providerId: string): SpaceRegistration | null {
  return readSpaceRegistrations().find((item) => item.providerId === providerId) ?? null;
}

/** The SPACE execution target a registration contributes; never an APP target. */
export function registeredSpaceMode(providerId: string): CatalogExecutionTarget | null {
  const registration = findSpaceRegistration(providerId);
  return registration ? { mode: "SPACE", broadcastChannelId: registration.broadcastChannelId } : null;
}

/** Trusted provider sources other than registrations: the verified signed catalog and the bundled provider. */
function trustedProviders(): Array<{ id: string; channel?: string }> {
  const catalog = readSignedCatalog()?.payload.experiences ?? [];
  const bundled = bootstrapPublicEntry();
  const sources = [...catalog.map((entry) => ({ id: entry.experienceId, modes: entry.executionModes }))];
  if (!sources.some((item) => item.id === bundled.experienceId)) sources.push({ id: bundled.experienceId, modes: bundled.executionModes });
  return sources.map((item) => ({ id: item.id, channel: item.modes?.find((mode) => mode.mode === "SPACE")?.broadcastChannelId }));
}

/**
 * RECEIVED → VALIDATING → VERIFYING → COMPATIBILITY_CHECK → READY_TO_REGISTER → REGISTERED.
 * No network, no identity and no authority is involved; nothing is registered unless every step passes.
 */
export async function importSpaceLaunchFile(
  input: Uint8Array | string,
  options: SpaceImportOptions,
): Promise<SpaceImportResult> {
  const verified = await verifySpaceLaunchFile(input, {
    publishers: trustedSpacePublishers(),
    xperienceVersion: options.xperienceVersion,
    ...(options.spaceRuntimeVersion !== undefined ? { spaceRuntimeVersion: options.spaceRuntimeVersion } : {}),
  });
  if (!verified.ok) return verified;
  const { file } = verified;
  const { providerId } = file.payload;
  const channel = file.payload.execution.broadcastChannelId;

  const providers = trustedProviders();
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return { ok: false, stage: "READY_TO_REGISTER", code: "PROVIDER_UNKNOWN" };
  if (provider.channel && provider.channel !== channel) return { ok: false, stage: "READY_TO_REGISTER", code: "IDENTITY_CONFLICT" };

  const stored = readStored();
  const channelOwners = [...providers.filter((item) => item.channel === channel).map((item) => item.id), ...stored.filter((item) => item.launchFile.payload.execution.broadcastChannelId === channel).map((item) => item.launchFile.payload.providerId)];
  if (channelOwners.some((id) => id !== providerId)) return { ok: false, stage: "READY_TO_REGISTER", code: "IDENTITY_CONFLICT" };

  const existing = stored.find((item) => item.launchFile.payload.providerId === providerId);
  if (existing) {
    const registered = describe(existing);
    if (existing.launchFile.payload.publisherId !== file.payload.publisherId) return { ok: false, stage: "READY_TO_REGISTER", code: "IDENTITY_CONFLICT", registered };
    const order = compareDottedVersion(file.payload.version, existing.launchFile.payload.version);
    if (order === 0) {
      const same = spaceLaunchSignedContent(existing.launchFile) === spaceLaunchSignedContent(file);
      return { ok: false, stage: "READY_TO_REGISTER", code: same ? "ALREADY_INSTALLED" : "IDENTITY_CONFLICT", registered };
    }
    if (order < 0) return { ok: false, stage: "READY_TO_REGISTER", code: "DOWNGRADE_REJECTED", registered, offeredVersion: file.payload.version };
    if (!options.acceptUpdate) return { ok: false, stage: "READY_TO_REGISTER", code: "UPDATE_AVAILABLE", registered, offeredVersion: file.payload.version };
  }

  const entry: StoredRegistration = { launchFile: file, registeredAt: new Date().toISOString(), byteLength: verified.byteLength };
  try {
    writeStored([...stored.filter((item) => item.launchFile.payload.providerId !== providerId), entry]);
  } catch {
    return { ok: false, stage: "READY_TO_REGISTER", code: "IMPORT_FAILED" };
  }
  return { ok: true, stage: "REGISTERED", outcome: existing ? "UPDATED" : "REGISTERED", registration: describe(entry) };
}

/**
 * Removes the registration only. Prepared Offline Kernel data is deliberately left in place;
 * deleting it is a separate, explicit action.
 */
export function removeSpaceRegistration(providerId: string): boolean {
  const stored = readStored();
  const next = stored.filter((item) => item.launchFile.payload.providerId !== providerId);
  if (next.length === stored.length) return false;
  writeStored(next);
  return true;
}
