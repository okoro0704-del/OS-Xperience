import test from "node:test";
import assert from "node:assert/strict";
import {
  presentationStatusTransitionAllowed,
  verifyExperienceCatalog,
} from "@digiconomy/xperience-contract";
import {
  exportGeneratedCatalogKeysForTests,
  resetCatalogSigningKeysForTests,
} from "../../../api/src/catalog-keys.js";
import { resetReleaseCatalogForTests } from "../../../api/src/release-catalog.js";
import {
  PresentationControlService,
  resetPresentationControlForTests,
} from "../../../api/src/presentation-control.js";
import {
  applyCatalogUpdate,
  clearMemoryKvStore,
  localReleaseClaimAllowed,
  memoryKvStore,
  setKvStoreForTests,
  storeCatalogPublicKey,
} from "../src/local/index.js";

const actor = { id: "admin-1", role: "ADMIN" as const };

async function freshPresentation() {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
  resetCatalogSigningKeysForTests();
  const keys = await exportGeneratedCatalogKeysForTests();
  storeCatalogPublicKey(keys.publicKeySpkiBase64);
  const catalog = resetReleaseCatalogForTests();
  const ctrl = resetPresentationControlForTests(catalog);
  return { keys, catalog, ctrl };
}

test("presentation status graph READY → LIVE → PAUSED → LIVE → ENDED", () => {
  assert.equal(presentationStatusTransitionAllowed("READY", "LIVE"), true);
  assert.equal(presentationStatusTransitionAllowed("LIVE", "PAUSED"), true);
  assert.equal(presentationStatusTransitionAllowed("PAUSED", "LIVE"), true);
  assert.equal(presentationStatusTransitionAllowed("ENDED", "LIVE"), false);
  assert.equal(presentationStatusTransitionAllowed("DRAFT", "LIVE"), false);
});

test("start records presentation.started and currentChapterId", async () => {
  const { ctrl } = await freshPresentation();
  const listed = ctrl.list();
  assert.ok(listed[0]);
  const started = ctrl.start(actor, listed[0]!.id);
  assert.equal(started.status, "LIVE");
  assert.ok(started.startedAt);
  assert.ok(started.currentChapterId);
  assert.equal(ctrl.listAudits()[0]?.action, "presentation.started");
});

test("next chapter moves pointer only — does not reveal", async () => {
  const { ctrl, catalog } = await freshPresentation();
  const presentation = ctrl.list()[0]!;
  ctrl.start(actor, presentation.id);
  const before = catalog.get("lifeos")!;
  assert.equal(before.releaseState, "PRELOADED");
  const next = ctrl.nextChapter(actor, presentation.id);
  assert.equal(next.currentChapter?.experienceId, "lifeos");
  assert.equal(catalog.get("lifeos")!.releaseState, "PRELOADED");
  assert.equal(ctrl.listAudits()[0]?.action, "presentation.chapter.selected");
});

test("reveal current requires confirmation then goes LIVE via X3 engine", async () => {
  const { ctrl, catalog } = await freshPresentation();
  const presentation = ctrl.list()[0]!;
  ctrl.start(actor, presentation.id);
  ctrl.nextChapter(actor, presentation.id);
  assert.throws(() => ctrl.revealCurrent(actor, presentation.id));
  const revealed = ctrl.revealCurrent(actor, presentation.id, { confirm: true });
  assert.equal(revealed.releaseState, "LIVE");
  assert.equal(catalog.get("lifeos")!.releaseState, "LIVE");
  assert.equal(catalog.get("lifeos")!.visibility, "FEATURED");
  assert.equal(ctrl.listAudits()[0]?.action, "presentation.chapter.revealed");
});

test("rehearsal skipRevealConfirm allows one-tap without confirm flag", async () => {
  const catalog = resetReleaseCatalogForTests();
  const ctrl = new PresentationControlService(catalog);
  const created = ctrl.create(actor, {
    title: "Rehearsal",
    skipRevealConfirm: true,
    chapters: [
      { title: "LifeOS", experienceId: "lifeos", action: "REVEAL", visibility: "FEATURED" },
    ],
  });
  ctrl.start(actor, created.id);
  const revealed = ctrl.revealCurrent(actor, created.id);
  assert.equal(revealed.releaseState, "LIVE");
});

test("audience state exposes current chapter without private keys", async () => {
  const { ctrl } = await freshPresentation();
  const presentation = ctrl.list()[0]!;
  assert.equal(ctrl.audienceState(), null);
  ctrl.start(actor, presentation.id);
  const audience = ctrl.audienceState();
  assert.ok(audience);
  assert.equal(audience!.presentationId, presentation.id);
  assert.ok(audience!.currentExperienceId);
  assert.equal("privateKey" in audience!, false);
});

test("currentChapterId survives get after next", async () => {
  const { ctrl } = await freshPresentation();
  const presentation = ctrl.list()[0]!;
  ctrl.start(actor, presentation.id);
  const moved = ctrl.nextChapter(actor, presentation.id);
  const reloaded = ctrl.get(presentation.id);
  assert.equal(reloaded.currentChapterId, moved.currentChapterId);
  assert.equal(reloaded.currentChapter?.title, "LifeOS");
});

test("reveal publishes signed catalog clients can verify with public key only", async () => {
  const { ctrl, catalog, keys } = await freshPresentation();
  const presentation = ctrl.list()[0]!;
  ctrl.start(actor, presentation.id);
  ctrl.nextChapter(actor, presentation.id);
  ctrl.revealCurrent(actor, presentation.id, { confirm: true });
  const signed = await catalog.buildDeviceSignedCatalog();
  assert.equal(await verifyExperienceCatalog(signed, keys.publicKeySpkiBase64), true);
  const applied = await applyCatalogUpdate(signed, {
    publicKeySpki: keys.publicKeySpkiBase64,
    fetchImpl: async () => new Response("ok"),
  });
  assert.equal(applied.ok, true);
  assert.equal(localReleaseClaimAllowed("lifeos", "LIVE"), true);
});
