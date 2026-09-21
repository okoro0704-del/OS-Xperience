import test from "node:test";
import assert from "node:assert/strict";
import {
  canLaunchByRelease,
  canPreloadByRelease,
  isConsumerDiscoverable,
  releaseTransitionAllowed,
  signExperienceCatalog,
  verifyExperienceCatalog,
  assertCatalogReleaseIntegrity,
  type ExperienceCatalogPayload,
} from "@digiconomy/xperience-contract";
import {
  ExperienceReleaseCatalog,
  resetReleaseCatalogForTests,
} from "../../../api/src/release-catalog.js";
import {
  applyCatalogUpdate,
  clearMemoryKvStore,
  localReleaseClaimAllowed,
  memoryKvStore,
  setKvStoreForTests,
  getPackageState,
} from "../src/local/index.js";

const SECRET = "xperience-dev-catalog-hmac-not-for-production";

function reset() {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
  resetReleaseCatalogForTests();
  process.env.XPERIENCE_CATALOG_SIGNING_SECRET = SECRET;
}

test.beforeEach(() => reset());

test("release transition graph allows PRELOADED → LIVE", () => {
  assert.equal(releaseTransitionAllowed("PRELOADED", "LIVE"), true);
  assert.equal(releaseTransitionAllowed("DRAFT", "LIVE"), false);
  assert.equal(releaseTransitionAllowed("RETIRED", "LIVE"), false);
});

test("release state is separate from authMode semantics", () => {
  assert.equal(canLaunchByRelease("LIVE"), true);
  assert.equal(canLaunchByRelease("PRELOADED"), false);
  assert.equal(canPreloadByRelease("PRELOADED"), true);
  assert.equal(isConsumerDiscoverable("PRELOADED", "HIDDEN"), false);
  assert.equal(isConsumerDiscoverable("LIVE", "FEATURED"), true);
});

test("signed catalog verifies and rejects tampering", async () => {
  const catalog = new ExperienceReleaseCatalog(true);
  const signed = await catalog.buildDeviceSignedCatalog();
  assert.equal(await verifyExperienceCatalog(signed, SECRET), true);
  const tampered = structuredClone(signed);
  tampered.payload.experiences[0]!.releaseState = "LIVE";
  assert.equal(await verifyExperienceCatalog(tampered, SECRET), false);
});

test("admin go-live requires confirmation and writes audit", () => {
  const catalog = resetReleaseCatalogForTests();
  const actor = { id: "admin-1", role: "ADMIN" as const };
  assert.throws(() =>
    catalog.changeRelease(actor, "lifeos", { releaseState: "LIVE", visibility: "FEATURED" }),
  );
  const live = catalog.goLive(actor, "lifeos", "FEATURED");
  assert.equal(live.releaseState, "LIVE");
  assert.equal(live.visibility, "FEATURED");
  assert.equal(catalog.listAudits()[0]?.action, "experience.release.changed");
  assert.equal(catalog.listAudits()[0]?.from, "PRELOADED");
  assert.equal(catalog.listAudits()[0]?.to, "LIVE");
});

test("client rejects local LOCKED → LIVE without signed catalog", async () => {
  const catalog = resetReleaseCatalogForTests();
  const signed = await catalog.buildDeviceSignedCatalog();
  await applyCatalogUpdate(signed, { secret: SECRET, fetchImpl: async () => new Response("ok") });
  assert.equal(localReleaseClaimAllowed("lifeos", "PRELOADED"), true);
  assert.equal(localReleaseClaimAllowed("lifeos", "LIVE"), false);
  assert.equal(assertCatalogReleaseIntegrity(signed, "lifeos", "PRELOADED"), true);
});

test("preload marks READY_BUT_LOCKED then LIVE promotes READY", async () => {
  const catalog = resetReleaseCatalogForTests();
  const signed = await catalog.buildDeviceSignedCatalog();
  const lifeos = signed.payload.experiences.find((e) => e.experienceId === "lifeos")!;
  assert.equal(lifeos.releaseState, "PRELOADED");
  const applied = await applyCatalogUpdate(signed, {
    secret: SECRET,
    fetchImpl: async () => new Response("package-bytes", { status: 200 }),
  });
  assert.equal(applied.ok, true);
  assert.equal(getPackageState("lifeos"), "READY_BUT_LOCKED");

  const actor = { id: "admin-1", role: "ADMIN" as const };
  catalog.goLive(actor, "lifeos", "FEATURED");
  const next = await catalog.buildDeviceSignedCatalog();
  const appliedLive = await applyCatalogUpdate(next, {
    secret: SECRET,
    fetchImpl: async () => new Response("package-bytes", { status: 200 }),
  });
  assert.equal(appliedLive.ok, true);
  assert.equal(getPackageState("lifeos"), "READY");
  assert.ok(appliedLive.newlyLive.some((e) => e.experienceId === "lifeos"));
});

test("offline keeps last valid signed manifest", async () => {
  const catalog = resetReleaseCatalogForTests();
  const signed = await catalog.buildDeviceSignedCatalog();
  await applyCatalogUpdate(signed, { secret: SECRET, fetchImpl: async () => new Response("ok") });
  assert.equal(localReleaseClaimAllowed("bootstrap.mybrandos.public", "LIVE"), true);
});

test("canonical payload signs stably", async () => {
  const payload: ExperienceCatalogPayload = {
    manifestVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    experiences: [],
  };
  const a = await signExperienceCatalog(payload, SECRET);
  const b = await signExperienceCatalog(payload, SECRET);
  assert.equal(a.signature, b.signature);
});
