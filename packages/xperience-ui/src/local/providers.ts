import {
  isConsumerDiscoverable,
  type CatalogExperienceEntry,
  type DirectoryApplicationView,
  type ExperienceMembershipView,
  type ExperienceRegistryEntry,
} from "@digiconomy/xperience-contract";
import { bootstrapPublicEntry } from "./bootstrap.js";
import { readSignedCatalog, signedCatalogGovernsExecution } from "./catalog.js";
import { registryToDirectoryView } from "./registry.js";

/**
 * Where a provider's execution metadata comes from. Discovery (the live Directory) never supplies
 * execution metadata for a trusted provider; it only refreshes presentation.
 */
export type ProviderSource = "SIGNED_CATALOG_RELEASE" | "BUNDLED_PROVIDER" | "LIVE_DIRECTORY_PROVIDER";

interface TrustedProvider {
  id: string;
  catalog?: CatalogExperienceEntry;
  bundled?: ExperienceRegistryEntry;
  origins: Set<string>;
}

interface TrustedIndex {
  byId: Map<string, TrustedProvider>;
  byOrigin: Map<string, string | null>;
  governed: boolean;
}

/** Live record id last bound to each canonical provider — server membership calls still address the record. */
const boundDirectoryRecords = new Map<string, string>();

function originKey(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Trusted providers are the verified signed catalog (every release state — identity is not admission)
 * and the provider bundled into this build. An origin claimed by two trusted providers binds to neither.
 */
function trustedIndex(): TrustedIndex {
  const catalog = readSignedCatalog();
  const byId = new Map<string, TrustedProvider>();
  const add = (id: string, origin: string | undefined, patch: Partial<TrustedProvider>) => {
    const provider = byId.get(id) ?? { id, origins: new Set<string>() };
    Object.assign(provider, patch);
    const key = originKey(origin);
    if (key) provider.origins.add(key);
    byId.set(id, provider);
  };
  for (const entry of catalog?.payload.experiences ?? []) add(entry.experienceId, entry.origin, { catalog: entry });
  const bundled = bootstrapPublicEntry();
  add(bundled.experienceId, bundled.origin, { bundled });

  const byOrigin = new Map<string, string | null>();
  for (const provider of byId.values()) {
    for (const origin of provider.origins) {
      const claimed = byOrigin.get(origin);
      byOrigin.set(origin, claimed === undefined || claimed === provider.id ? provider.id : null);
    }
  }
  return { byId, byOrigin, governed: signedCatalogGovernsExecution(catalog) };
}

function bindingFor(app: Pick<DirectoryApplicationView, "id" | "origin">, index: TrustedIndex): string | null {
  if (index.byId.has(app.id)) return app.id;
  const key = originKey(app.origin);
  return key ? index.byOrigin.get(key) ?? null : null;
}

/** Canonical provider id for a Directory record: the trusted provider it is bound to, else its own id. */
export function canonicalProviderId(app: Pick<DirectoryApplicationView, "id" | "origin">): string {
  return bindingFor(app, trustedIndex()) ?? app.id;
}

/** Id the Xperience API knows this provider by (the bound live record when one exists). */
export function directoryRecordId(providerId: string): string {
  return boundDirectoryRecords.get(providerId) ?? providerId;
}

export function providerSource(providerId: string): ProviderSource {
  const provider = trustedIndex().byId.get(providerId);
  if (provider?.catalog) return "SIGNED_CATALOG_RELEASE";
  if (provider?.bundled) return "BUNDLED_PROVIDER";
  return "LIVE_DIRECTORY_PROVIDER";
}

function discoverable(provider: TrustedProvider, index: TrustedIndex): boolean {
  if (provider.catalog) return isConsumerDiscoverable(provider.catalog.releaseState, provider.catalog.visibility);
  return !index.governed;
}

function catalogView(entry: CatalogExperienceEntry): DirectoryApplicationView {
  return {
    id: entry.experienceId,
    name: entry.name,
    version: entry.version,
    origin: entry.origin,
    productionUrl: entry.entrypoint,
    xperienceUrl: entry.entrypoint,
    canManage: false,
    authMode: entry.authMode,
    offlineCapability: entry.offlineCapability,
    category: "General",
    capabilities: [],
    publicationState: "PUBLISHED",
    experienced: false,
  };
}

/**
 * Precedence: canonical identity → execution metadata (bundled entrypoint/origin/auth/offline, signed
 * catalog modes) → live presentation metadata. The live record can rename or describe the provider but
 * never relocate or re-declare how it executes.
 */
function canonicalView(provider: TrustedProvider, record: DirectoryApplicationView | null): DirectoryApplicationView {
  const execution = provider.bundled ? registryToDirectoryView(provider.bundled) : catalogView(provider.catalog!);
  const executionModes = provider.catalog?.executionModes ?? execution.executionModes;
  const view: DirectoryApplicationView = {
    ...execution,
    ...(record ?? {}),
    id: provider.id,
    origin: execution.origin,
    productionUrl: execution.productionUrl,
    xperienceUrl: execution.xperienceUrl,
    authMode: execution.authMode,
    offlineCapability: execution.offlineCapability,
  };
  if (executionModes) view.executionModes = executionModes;
  else delete view.executionModes;
  return view;
}

/**
 * One deterministic provider list from Directory records (live, registry or both) plus trusted
 * providers. Records bound to the same provider collapse into the first; discoverable trusted
 * providers the records do not mention are appended; unbound records pass through unchanged.
 */
export function resolveDirectoryProviders(
  records: DirectoryApplicationView[],
  options: { includeUnlistedTrusted?: boolean } = {},
): DirectoryApplicationView[] {
  const index = trustedIndex();
  const out: DirectoryApplicationView[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const bound = bindingFor(record, index);
    const id = bound ?? record.id;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!bound) {
      out.push(record);
      continue;
    }
    if (record.id !== bound) boundDirectoryRecords.set(bound, record.id);
    out.push(canonicalView(index.byId.get(bound)!, record));
  }
  if (options.includeUnlistedTrusted !== false) {
    for (const provider of index.byId.values()) {
      if (seen.has(provider.id) || !discoverable(provider, index)) continue;
      seen.add(provider.id);
      out.push(canonicalView(provider, null));
    }
  }
  return out;
}

/** Memberships addressed by canonical provider; duplicates of one provider keep the first. */
export function resolveMemberships(memberships: ExperienceMembershipView[]): ExperienceMembershipView[] {
  const seen = new Set<string>();
  const out: ExperienceMembershipView[] = [];
  for (const membership of memberships) {
    const [application] = resolveDirectoryProviders([membership.application], { includeUnlistedTrusted: false });
    if (!application || seen.has(application.id)) continue;
    seen.add(application.id);
    out.push({ ...membership, applicationId: application.id, application });
  }
  return out;
}
