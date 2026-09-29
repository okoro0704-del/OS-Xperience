import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveExperienceTargets,
  verifyExperienceCatalog,
  withDiscoverableExecutionModes,
  type ExperienceTargetSource,
} from "@digiconomy/xperience-contract";
import { resetReleaseCatalogForTests } from "../../../api/src/release-catalog.js";
import {
  exportGeneratedCatalogKeysForTests,
  resetCatalogSigningKeysForTests,
} from "../../../api/src/catalog-keys.js";
import { lockFrameLineup, resolveHostMode, resolveLockedExperience } from "../src/locked-xperience.ts";
import {
  MYBRANDOS_PUBLIC_ENTRY,
  MYBRANDOS_PUBLIC_ID,
  applyCatalogUpdate,
  availableProviderTargets,
  bootFromLocal,
  buildLineup,
  chooseExecutionTarget,
  clearMemoryKvStore,
  getExperienceSlot,
  memoryKvStore,
  nextProviderWithMode,
  providerTargets,
  readLastExperience,
  rememberOpenedExperience,
  registryToDirectoryView,
  setKvStoreForTests,
  storeCatalogPublicKey,
  storeSignedCatalog,
  syncRegistryFromDirectory,
  writeRegistry,
  type LineupEntry,
} from "../src/local/index.ts";

const admin = { id: "admin-1", role: "ADMIN" } as const;

async function reset() {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
  resetCatalogSigningKeysForTests();
  const catalog = resetReleaseCatalogForTests();
  const keys = await exportGeneratedCatalogKeysForTests();
  storeCatalogPublicKey(keys.publicKeySpkiBase64);
  return { catalog, keys };
}

test.beforeEach(async () => {
  await reset();
});

test.after(() => {
  setKvStoreForTests(null);
});

/* Fixture-only target sources: shapes of catalog declarations, not registry providers. */
const appOnly: ExperienceTargetSource = { experienceId: "fixture.app-only", entrypoint: "https://app.example/" };
const spaceOnly: ExperienceTargetSource = {
  experienceId: "fixture.space-only",
  entrypoint: "https://space.example/",
  executionModes: [{ mode: "SPACE", broadcastChannelId: "fixture.tv" }],
};
const dual: ExperienceTargetSource = {
  experienceId: "fixture.dual",
  entrypoint: "https://dual.example/",
  releaseState: "LIVE",
  visibility: "LISTED",
  executionModes: [{ mode: "APP" }, { mode: "SPACE", broadcastChannelId: "fixture.tv" }],
};

test("unlocked host is the default; locked mode is an explicit configuration", () => {
  assert.deepEqual(resolveHostMode({}), { kind: "GENERAL" });
  assert.deepEqual(resolveHostMode({ env: { lockedId: "false" } }), { kind: "GENERAL" });
  assert.deepEqual(resolveHostMode({ env: { lockedId: "  " } }), { kind: "GENERAL" });
  assert.deepEqual(resolveHostMode({ env: { lockedId: MYBRANDOS_PUBLIC_ID, lockedMode: "SPACE", lockedPurpose: "KIOSK" } }), {
    kind: "LOCKED",
    providerId: MYBRANDOS_PUBLIC_ID,
    executionMode: "SPACE",
    purpose: "KIOSK",
  });
  const runtime = resolveHostMode({
    env: { lockedId: "other.provider" },
    runtime: { providerId: MYBRANDOS_PUBLIC_ID, purpose: "ACCEPTANCE" },
  });
  assert.deepEqual(runtime, { kind: "LOCKED", providerId: MYBRANDOS_PUBLIC_ID, executionMode: null, purpose: "ACCEPTANCE" });
  assert.equal(resolveHostMode({ env: { lockedId: "x", lockedMode: "TV" } }).kind, "LOCKED");
  assert.equal((resolveHostMode({ env: { lockedId: "x", lockedMode: "TV" } }) as { executionMode: unknown }).executionMode, null);
});

test("general first open lands on the Directory; locked first open enters the locked provider", () => {
  const general = bootFromLocal({ online: true, lockedExperienceId: null, restoreOnFirstOpen: false });
  assert.equal(general.restore, null);
  assert.ok(general.directory.some((app) => app.id === MYBRANDOS_PUBLIC_ID));
  clearMemoryKvStore();
  const locked = bootFromLocal({ online: true, lockedExperienceId: MYBRANDOS_PUBLIC_ID, restoreOnFirstOpen: true });
  assert.equal(locked.restore?.app.id, MYBRANDOS_PUBLIC_ID);
});

test("APP only, SPACE only and dual providers resolve from their declarations", () => {
  assert.deepEqual(resolveExperienceTargets(appOnly).map((t) => t.executionMode), ["APP"]);
  assert.deepEqual(resolveExperienceTargets(spaceOnly).map((t) => t.executionMode), ["SPACE"]);
  assert.deepEqual(resolveExperienceTargets(dual).map((t) => t.executionMode), ["APP", "SPACE"]);
  const duplicate = resolveExperienceTargets({ ...dual, executionModes: [{ mode: "APP" }, { mode: "APP" }] });
  assert.equal(duplicate.length, 1);
});

test("one canonical provider identity; APP and SPACE are distinct modes of it", () => {
  const targets = resolveExperienceTargets(dual);
  assert.equal(new Set(targets.map((t) => t.providerId)).size, 1);
  assert.equal(targets[0]!.providerId, "fixture.dual");
  const app = targets.find((t) => t.executionMode === "APP")!;
  const space = targets.find((t) => t.executionMode === "SPACE")!;
  assert.equal(app.broadcastChannelId, undefined);
  assert.equal(space.broadcastChannelId, "fixture.tv");
  assert.equal(app.entrypoint, space.entrypoint);
});

test("unreleased and unlisted modes are excluded; provider release gates every mode", () => {
  const pausedSpace = resolveExperienceTargets({
    ...dual,
    executionModes: [{ mode: "APP" }, { mode: "SPACE", releaseState: "PAUSED" }],
  });
  assert.equal(pausedSpace.find((t) => t.executionMode === "SPACE")!.availability, "NOT_RELEASED");
  const hiddenSpace = resolveExperienceTargets({
    ...dual,
    executionModes: [{ mode: "APP" }, { mode: "SPACE", releaseState: "LIVE", visibility: "HIDDEN" }],
  });
  assert.equal(hiddenSpace.find((t) => t.executionMode === "SPACE")!.availability, "NOT_LISTED");
  const preloaded = resolveExperienceTargets({
    ...dual,
    releaseState: "PRELOADED",
    visibility: "HIDDEN",
    executionModes: [{ mode: "APP", releaseState: "LIVE", visibility: "FEATURED" }],
  });
  assert.deepEqual(preloaded.map((t) => t.availability), ["NOT_RELEASED"]);
  assert.equal(chooseExecutionTarget(preloaded, "APP"), null);
});

test("signed catalog is authoritative for modes; consumer catalog strips undiscoverable modes", async () => {
  const { catalog, keys } = await reset();
  const initial = await catalog.buildDeviceSignedCatalog();
  assert.equal((await applyCatalogUpdate(initial, { publicKeySpki: keys.publicKeySpkiBase64 })).ok, true);
  const bootstrap = { id: MYBRANDOS_PUBLIC_ID, entrypoint: MYBRANDOS_PUBLIC_ENTRY.entrypoint };
  assert.deepEqual(availableProviderTargets(bootstrap).map((t) => t.executionMode), ["APP", "SPACE"]);
  assert.deepEqual(availableProviderTargets({ id: "lifeos" }).map((t) => t.executionMode), []);

  catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "SPACE", { releaseState: "PAUSED" });
  const paused = await catalog.buildDeviceSignedCatalog();
  assert.equal((await applyCatalogUpdate(paused, { publicKeySpki: keys.publicKeySpkiBase64 })).ok, true);
  assert.deepEqual(availableProviderTargets(bootstrap).map((t) => t.executionMode), ["APP"]);
  // A local declaration cannot re-add a mode the signed catalog paused.
  assert.deepEqual(
    availableProviderTargets({ ...bootstrap, executionModes: MYBRANDOS_PUBLIC_ENTRY.executionModes }).map((t) => t.executionMode),
    ["APP"],
  );

  const consumer = await catalog.buildConsumerSignedCatalog();
  const entry = consumer.payload.experiences.find((item) => item.experienceId === MYBRANDOS_PUBLIC_ID)!;
  assert.deepEqual(entry.executionModes?.map((mode) => mode.mode), ["APP"]);
  assert.equal(await verifyExperienceCatalog(consumer, keys.publicKeySpkiBase64), true);

  const tampered = structuredClone(paused);
  tampered.payload.experiences.find((item) => item.experienceId === MYBRANDOS_PUBLIC_ID)!.executionModes![1]!.releaseState = "LIVE";
  assert.equal((await storeSignedCatalog(tampered, keys.publicKeySpkiBase64)).ok, false);
  assert.deepEqual(availableProviderTargets(bootstrap).map((t) => t.executionMode), ["APP"]);
});

test("admin mode release follows the release graph, requires LIVE confirmation and is audited", async () => {
  const { catalog } = await reset();
  assert.throws(() => catalog.changeExecutionModeRelease(admin, "lifeos", "SPACE", { releaseState: "LIVE", confirmLive: true }), /not a declared execution mode/);
  catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "SPACE", { releaseState: "PAUSED" });
  assert.throws(() => catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "SPACE", { releaseState: "LIVE" }), /confirmLive/);
  catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "SPACE", { releaseState: "RETIRED" });
  assert.throws(() => catalog.changeExecutionModeRelease(admin, MYBRANDOS_PUBLIC_ID, "SPACE", { releaseState: "LIVE", confirmLive: true }), /Invalid release transition/);
  const audit = catalog.listAudits()[0]!;
  assert.equal(audit.executionMode, "SPACE");
  assert.equal(audit.from, "PAUSED");
  assert.equal(audit.to, "RETIRED");
  assert.equal(catalog.get(MYBRANDOS_PUBLIC_ID)!.releaseState, "LIVE");
  assert.equal(withDiscoverableExecutionModes(catalog.get(MYBRANDOS_PUBLIC_ID)!).executionModes?.length, 1);
});

test("mode choice honours the request, falls back to APP, and a fixed locked mode is never substituted", () => {
  const targets = resolveExperienceTargets(dual);
  assert.equal(chooseExecutionTarget(targets, "SPACE")?.executionMode, "SPACE");
  assert.equal(chooseExecutionTarget(targets, null)?.executionMode, "APP");
  const onlySpace = resolveExperienceTargets(spaceOnly);
  assert.equal(chooseExecutionTarget(onlySpace, "APP")?.executionMode, "SPACE");
  assert.equal(chooseExecutionTarget(resolveExperienceTargets(appOnly), "SPACE", "SPACE"), null);
  assert.equal(chooseExecutionTarget(targets, "APP", "SPACE")?.executionMode, "SPACE");
});

test("continuity keeps the APP/SPACE identity per provider", () => {
  const app = registryToDirectoryView(MYBRANDOS_PUBLIC_ENTRY);
  rememberOpenedExperience(app, "PUBLIC", undefined, "SPACE");
  assert.equal(readLastExperience()?.executionMode, "SPACE");
  assert.equal(readLastExperience()?.lastExperienceId, MYBRANDOS_PUBLIC_ID);
  assert.equal(getExperienceSlot(MYBRANDOS_PUBLIC_ID)?.executionMode, "SPACE");
  const restored = bootFromLocal({ online: true, lockedExperienceId: null, restoreOnFirstOpen: false });
  assert.equal(restored.restore?.app.id, MYBRANDOS_PUBLIC_ID);
  assert.equal(restored.restore?.executionMode, "SPACE");
  rememberOpenedExperience(app, "PUBLIC", undefined, "APP");
  assert.equal(bootFromLocal({ online: true, restoreOnFirstOpen: false }).restore?.executionMode, "APP");
});

test("switcher revolve moves between providers that offer the mode, never across identities of one provider", () => {
  const lineup = [
    { id: "fixture.app-only", entrypoint: appOnly.entrypoint },
    { id: MYBRANDOS_PUBLIC_ID, entrypoint: MYBRANDOS_PUBLIC_ENTRY.entrypoint },
    { id: "fixture.space-only", entrypoint: spaceOnly.entrypoint, executionModes: spaceOnly.executionModes },
  ];
  assert.equal(nextProviderWithMode(lineup, MYBRANDOS_PUBLIC_ID, "SPACE")?.id, "fixture.space-only");
  assert.equal(nextProviderWithMode(lineup, "fixture.space-only", "SPACE")?.id, MYBRANDOS_PUBLIC_ID);
  assert.equal(nextProviderWithMode([lineup[1]!], MYBRANDOS_PUBLIC_ID, "SPACE"), null);
});

test("locked mode still pins one provider frame and resolves stale targets to it", () => {
  const frames: Pick<LineupEntry, "experienceId">[] = [{ experienceId: "other" }, { experienceId: MYBRANDOS_PUBLIC_ID }];
  const mode = resolveHostMode({ runtime: { providerId: MYBRANDOS_PUBLIC_ID } });
  const lockedId = mode.kind === "LOCKED" ? mode.providerId : null;
  assert.deepEqual(lockFrameLineup(frames, lockedId), [frames[1]]);
  assert.equal(resolveLockedExperience("other", lockedId), MYBRANDOS_PUBLIC_ID);
  assert.deepEqual(lockFrameLineup(frames, null), frames);
  assert.equal(resolveLockedExperience("other", null), "other");
});

test("MrFundzMan Space regression: bootstrap provider keeps SPACE on mrfundzman.tv, including relocated and legacy registries", () => {
  const space = providerTargets({ id: MYBRANDOS_PUBLIC_ID }).find((t) => t.executionMode === "SPACE");
  assert.equal(space?.broadcastChannelId, "mrfundzman.tv");
  const legacy = { ...MYBRANDOS_PUBLIC_ENTRY };
  delete legacy.executionModes;
  writeRegistry([legacy]);
  assert.equal(providerTargets({ id: MYBRANDOS_PUBLIC_ID }).find((t) => t.executionMode === "SPACE")?.broadcastChannelId, "mrfundzman.tv");
  const globalWithWindow = globalThis as { window?: unknown };
  globalWithWindow.window = { __oxBootstrapEntry: { ...legacy, entrypoint: "http://127.0.0.1:9/" } };
  try {
    writeRegistry([]);
    const relocated = providerTargets({ id: MYBRANDOS_PUBLIC_ID, entrypoint: "http://127.0.0.1:9/" });
    assert.deepEqual(relocated.map((t) => [t.executionMode, t.entrypoint]), [["APP", "http://127.0.0.1:9/"], ["SPACE", "http://127.0.0.1:9/"]]);
  } finally {
    delete globalWithWindow.window;
  }
});

test("directory sync keeps declared modes and the lineup carries them to the Switcher", () => {
  syncRegistryFromDirectory([registryToDirectoryView(MYBRANDOS_PUBLIC_ENTRY)]);
  const withoutModes = { ...registryToDirectoryView(MYBRANDOS_PUBLIC_ENTRY) };
  delete withoutModes.executionModes;
  syncRegistryFromDirectory([withoutModes]);
  const entry = buildLineup({ online: true }).find((item) => item.experienceId === MYBRANDOS_PUBLIC_ID);
  assert.deepEqual(entry?.executionModes?.map((mode) => mode.mode), ["APP", "SPACE"]);
});

test("execution mode is never derived from screen width or presentation", async () => {
  const source = await readFile(new URL("../src/ExperienceApp.tsx", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((row) => /setExecutionMode|executionModeRef\.current =/.test(row))) {
    assert.doesNotMatch(line, /isDesktop|matchMedia|innerWidth|viewport|orientation/i);
  }
  const contract = await readFile(new URL("../../xperience-contract/src/release.ts", import.meta.url), "utf8");
  const resolver = contract.slice(contract.indexOf("export function resolveExperienceTargets"), contract.indexOf("export function availableExperienceTargets"));
  assert.doesNotMatch(resolver, /PHONE|TABLET|DESKTOP|\bTV\b|width|platform/i);
});
