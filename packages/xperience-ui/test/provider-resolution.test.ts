import assert from "node:assert/strict";
import test from "node:test";
import type { DirectoryApplicationView, ExperienceMembershipView } from "@digiconomy/xperience-contract";
import { resetReleaseCatalogForTests } from "../../../api/src/release-catalog.js";
import {
  exportGeneratedCatalogKeysForTests,
  resetCatalogSigningKeysForTests,
} from "../../../api/src/catalog-keys.js";
import {
  MYBRANDOS_PUBLIC_ENTRY,
  MYBRANDOS_PUBLIC_ID,
  applyCatalogUpdate,
  availableProviderTargets,
  bootFromLocal,
  buildLineup,
  canonicalProviderId,
  clearMemoryKvStore,
  directoryRecordId,
  memoryKvStore,
  providerSource,
  providerTargets,
  rememberOpenedExperience,
  resolveDirectoryProviders,
  resolveMemberships,
  setKvStoreForTests,
  signedCatalogGovernsExecution,
  storeCatalogPublicKey,
  syncRegistryFromDirectory,
} from "../src/local/index.ts";

const admin = { id: "admin-1", role: "ADMIN" } as const;
const LIVE_MRFUNDZMAN = "ins_9c57cac9f6fa4167";

async function reset() {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
  resetCatalogSigningKeysForTests();
  const catalog = resetReleaseCatalogForTests();
  const keys = await exportGeneratedCatalogKeysForTests();
  storeCatalogPublicKey(keys.publicKeySpkiBase64);
  const publish = async () => {
    const signed = await catalog.buildDeviceSignedCatalog();
    assert.equal((await applyCatalogUpdate(signed, { publicKeySpki: keys.publicKeySpkiBase64 })).ok, true);
  };
  return { catalog, publish };
}

test.beforeEach(async () => {
  await reset();
});

test.after(() => {
  setKvStoreForTests(null);
});

/** Shape of a record returned by the live /v1/directory API. */
function liveRecord(id: string, origin: string, name: string, path = "/"): DirectoryApplicationView {
  const url = new URL(path, origin).href;
  return {
    id,
    name,
    version: "live",
    origin,
    productionUrl: url,
    xperienceUrl: url,
    canManage: false,
    authMode: "PUBLIC",
    offlineCapability: "NONE",
    category: "Finance",
    description: `${name} from the live Directory`,
    capabilities: [],
    publicationState: "PUBLISHED",
    experienced: true,
  };
}

const liveMrFundzMan = () => liveRecord(LIVE_MRFUNDZMAN, "https://mrfundzman.getlifeos.app", "MrFundzMan", "/live-entry");
const unknownProvider = () => liveRecord("ins_unknown0000000001", "https://unknown-provider.example", "Unknown Provider");

function modes(app: Pick<DirectoryApplicationView, "id" | "xperienceUrl" | "productionUrl" | "executionModes">) {
  return availableProviderTargets({
    id: app.id,
    entrypoint: app.xperienceUrl || app.productionUrl,
    executionModes: app.executionModes,
  }).map((target) => target.executionMode);
}

test("bundled only: no catalog and no Directory keeps the bundled provider executable with both modes", () => {
  assert.equal(signedCatalogGovernsExecution(), false);
  const providers = resolveDirectoryProviders([]);
  assert.deepEqual(providers.map((app) => app.id), [MYBRANDOS_PUBLIC_ID]);
  assert.equal(providerSource(MYBRANDOS_PUBLIC_ID), "BUNDLED_PROVIDER");
  assert.deepEqual(modes(providers[0]!), ["APP", "SPACE"]);
});

test("live only: the signed catalog still supplies the trusted provider when the live list omits it", async () => {
  const { publish } = await reset();
  await publish();
  const providers = resolveDirectoryProviders([unknownProvider()]);
  assert.deepEqual(providers.map((app) => app.id), ["ins_unknown0000000001", MYBRANDOS_PUBLIC_ID]);
  assert.equal(providerSource(MYBRANDOS_PUBLIC_ID), "SIGNED_CATALOG_RELEASE");
  assert.deepEqual(modes(providers[1]!), ["APP", "SPACE"]);
});

test("same provider bundled + live: origin binding yields one canonical MrFundzMan with App and Space", async () => {
  const { publish } = await reset();
  await publish();
  const providers = resolveDirectoryProviders([liveMrFundzMan()]);
  assert.equal(providers.length, 1);
  const provider = providers[0]!;
  assert.equal(provider.id, MYBRANDOS_PUBLIC_ID);
  // Presentation from the live Directory; execution from the trusted declaration.
  assert.equal(provider.name, "MrFundzMan");
  assert.equal(provider.category, "Finance");
  assert.equal(provider.productionUrl, MYBRANDOS_PUBLIC_ENTRY.entrypoint);
  assert.equal(provider.offlineCapability, "PARTIAL");
  assert.deepEqual(modes(provider), ["APP", "SPACE"]);
  const space = providerTargets({ id: provider.id }).find((target) => target.executionMode === "SPACE");
  assert.equal(space?.broadcastChannelId, "mrfundzman.tv");
  assert.equal(canonicalProviderId(liveMrFundzMan()), MYBRANDOS_PUBLIC_ID);
  assert.equal(directoryRecordId(MYBRANDOS_PUBLIC_ID), LIVE_MRFUNDZMAN);
});

test("bundled binding also applies before any catalog arrives", () => {
  const providers = resolveDirectoryProviders([liveMrFundzMan()]);
  assert.deepEqual(providers.map((app) => app.id), [MYBRANDOS_PUBLIC_ID]);
  assert.deepEqual(modes(providers[0]!), ["APP", "SPACE"]);
});

test("App only, Space only and App + Space follow the signed catalog's mode releases", async () => {
  const { catalog, publish } = await reset();
  await publish();
  const [dual] = resolveDirectoryProviders([liveMrFundzMan()]);
  assert.deepEqual(modes(dual!), ["APP", "SPACE"]);

  catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "SPACE", { releaseState: "PAUSED" });
  await publish();
  assert.deepEqual(modes(resolveDirectoryProviders([liveMrFundzMan()])[0]!), ["APP"]);

  catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "SPACE", { releaseState: "LIVE", confirmLive: true });
  catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "APP", { releaseState: "PAUSED" });
  await publish();
  assert.deepEqual(modes(resolveDirectoryProviders([liveMrFundzMan()])[0]!), ["SPACE"]);
});

test("duplicate live records of one provider collapse; the first record keeps the server identity", async () => {
  const { publish } = await reset();
  await publish();
  const second = liveRecord("ins_second000000000001", "https://MRFUNDZMAN.getlifeos.app", "MrFundzMan (copy)");
  const providers = resolveDirectoryProviders([liveMrFundzMan(), second]);
  assert.deepEqual(providers.map((app) => app.id), [MYBRANDOS_PUBLIC_ID]);
  assert.equal(providers[0]!.name, "MrFundzMan");
  assert.equal(directoryRecordId(MYBRANDOS_PUBLIC_ID), LIVE_MRFUNDZMAN);
});

test("unknown live provider is discoverable but never executable under a governing catalog", async () => {
  const { publish } = await reset();
  await publish();
  assert.equal(signedCatalogGovernsExecution(), true);
  const [unknown] = resolveDirectoryProviders([unknownProvider()], { includeUnlistedTrusted: false });
  assert.equal(unknown!.id, "ins_unknown0000000001");
  assert.equal(unknown!.productionUrl, "https://unknown-provider.example/");
  assert.equal(providerSource(unknown!.id), "LIVE_DIRECTORY_PROVIDER");
  assert.deepEqual(modes(unknown!), []);
  assert.deepEqual(
    providerTargets({ id: unknown!.id, entrypoint: unknown!.productionUrl }).map((target) => target.availability),
    ["NOT_RELEASED"],
  );
  syncRegistryFromDirectory([unknown!]);
  assert.equal(buildLineup({ online: true }).some((entry) => entry.experienceId === unknown!.id), false);
});

test("display names never merge providers: same name on another origin stays a separate unreleased record", async () => {
  const { publish } = await reset();
  await publish();
  const lookalike = liveRecord("ins_5dc163addb3a4f20", "https://mrfundzman-copy.example", "MrFundzMan");
  const providers = resolveDirectoryProviders([liveMrFundzMan(), lookalike], { includeUnlistedTrusted: false });
  assert.deepEqual(providers.map((app) => app.id), [MYBRANDOS_PUBLIC_ID, "ins_5dc163addb3a4f20"]);
  assert.deepEqual(modes(providers[1]!), []);
});

test("an origin claimed by two trusted providers binds to neither", async () => {
  const { publish } = await reset();
  await publish();
  const globalWithWindow = globalThis as { window?: unknown };
  globalWithWindow.window = { __oxBootstrapEntry: { ...MYBRANDOS_PUBLIC_ENTRY, origin: "https://app.getlifeos.app/" } };
  try {
    const shared = liveRecord("ins_shared0000000001", "https://app.getlifeos.app", "Shared Origin");
    assert.equal(canonicalProviderId(shared), "ins_shared0000000001");
  } finally {
    delete globalWithWindow.window;
  }
});

test("catalog unavailable: an unverified catalog is not stored and bundled authority stays in place", async () => {
  const { catalog } = await reset();
  const signed = await catalog.buildDeviceSignedCatalog();
  const tampered = structuredClone(signed);
  tampered.payload.experiences[0]!.name = "Tampered";
  assert.equal((await applyCatalogUpdate(tampered, { publicKeySpki: "invalid" })).ok, false);
  assert.equal(signedCatalogGovernsExecution(), false);
  const providers = resolveDirectoryProviders([liveMrFundzMan()]);
  assert.deepEqual(providers.map((app) => app.id), [MYBRANDOS_PUBLIC_ID]);
  assert.equal(providerSource(MYBRANDOS_PUBLIC_ID), "BUNDLED_PROVIDER");
  assert.deepEqual(modes(providers[0]!), ["APP", "SPACE"]);
});

test("Directory unavailable: local boot lists the canonical provider with App and Space", async () => {
  const { publish } = await reset();
  await publish();
  const boot = bootFromLocal({ online: false, restoreOnFirstOpen: false });
  const provider = boot.directory.find((app) => app.id === MYBRANDOS_PUBLIC_ID);
  assert.ok(provider);
  assert.deepEqual(modes(provider!), ["APP", "SPACE"]);
  assert.equal(boot.usedNetwork, false);
});

test("offline restart: a remembered live record restores the canonical provider in SPACE without duplicates", async () => {
  const { publish } = await reset();
  await publish();
  syncRegistryFromDirectory([liveMrFundzMan()]);
  rememberOpenedExperience(liveMrFundzMan(), "PUBLIC", undefined, "SPACE");

  const boot = bootFromLocal({ online: false, restoreOnFirstOpen: false });
  assert.equal(boot.directory.filter((app) => app.id === MYBRANDOS_PUBLIC_ID).length, 1);
  assert.equal(boot.directory.some((app) => app.id === LIVE_MRFUNDZMAN), false);
  assert.equal(boot.restore?.app.id, MYBRANDOS_PUBLIC_ID);
  assert.equal(boot.restore?.executionMode, "SPACE");
  assert.equal(boot.restore?.offlineBlocked, false);
  assert.equal(boot.restore?.app.productionUrl, MYBRANDOS_PUBLIC_ENTRY.entrypoint);
});

test("memberships address the canonical provider and drop duplicate records", async () => {
  const { publish } = await reset();
  await publish();
  const membership = (application: DirectoryApplicationView): ExperienceMembershipView => ({
    applicationId: application.id,
    status: "ACTIVE",
    addedAt: "2026-09-01T00:00:00.000Z",
    application,
  });
  const resolved = resolveMemberships([
    membership(liveMrFundzMan()),
    membership(liveRecord("ins_second000000000001", "https://mrfundzman.getlifeos.app", "Copy")),
    membership(unknownProvider()),
  ]);
  assert.deepEqual(resolved.map((item) => item.applicationId), [MYBRANDOS_PUBLIC_ID, "ins_unknown0000000001"]);
});
