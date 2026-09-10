import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionDoesNotGrantCapability,
  actionFromIntent,
  actionRequiresConfirmation,
  assertHandlerRegistered,
  createActionResult,
  createContextReference,
  discoverActions,
  groupActionsById,
  handlerDoesNotImplyPrivilege,
  objectReferenceDoesNotGrantAuthorization,
  publicObjectView,
  seedApplicationCatalog,
  validateActionRequest,
  validateObjectReference,
} from "../src/index.ts";

test("object reference reuses context vocabulary and rejects secrets", () => {
  const ok = validateObjectReference({
    type: "asset",
    id: "v1",
    title: "Example Video",
    subtype: "VIDEO",
    originAppId: "lifeos",
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(objectReferenceDoesNotGrantAuthorization(ok.context), true);
    assert.equal(ok.grantsAuthorization, false);
    assert.equal(publicObjectView(ok.context)?.subtype, "VIDEO");
  }
  assert.equal(validateObjectReference({ type: "unknown" }).ok, false);
  assert.equal(validateObjectReference({ type: "asset", id: "x", accessToken: "t" }).ok, false);
  assert.equal(validateObjectReference({ type: "text", text: "x".repeat(5000) }).ok, false);
});

test("action discovery finds LifeOS, mybrandOS, and Demo Notes handlers", () => {
  const registry = seedApplicationCatalog();
  const asset = createContextReference({
    type: "asset",
    id: "a1",
    title: "Example Video",
    metadata: { assetType: "VIDEO" },
  });
  assert.equal(asset.ok, true);
  if (!asset.ok) return;
  const discovered = discoverActions({ object: asset.context, registry });
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;
  assert.equal(discovered.grantsAuthorization, false);
  const edit = discovered.actions.filter((item) => item.action.id === "edit");
  assert.ok(edit.some((item) => item.handler.appId === "mybrandos"));
  const view = discovered.actions.filter((item) => item.action.id === "view");
  assert.ok(view.some((item) => item.handler.appId === "lifeos"));
  assert.ok(view.some((item) => item.handler.appId === "mybrandos"));
  const share = discovered.actions.filter((item) => item.action.id === "share");
  assert.ok(share.some((item) => item.handler.appId === "lifeos"));

  const text = createContextReference({ type: "text", text: "hello", title: "Note" });
  assert.equal(text.ok, true);
  if (!text.ok) return;
  const textActions = discoverActions({ object: text.context, registry });
  assert.equal(textActions.ok, true);
  if (!textActions.ok) return;
  assert.ok(textActions.actions.some((item) => item.action.id === "edit" && item.handler.appId === "shell-demo-notes"));
});

test("action availability is honest for publish without commerce grant", () => {
  const registry = seedApplicationCatalog();
  const asset = createContextReference({ type: "asset", id: "a1", title: "Video" });
  assert.equal(asset.ok, true);
  if (!asset.ok) return;
  const discovered = discoverActions({
    object: asset.context,
    registry,
    grantedCapabilitiesByOrigin: {},
    capabilityAvailability: { commerce: { available: true } },
  });
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;
  const publish = discovered.actions.find((item) => item.action.id === "publish");
  assert.ok(publish);
  assert.equal(publish?.availability, "PERMISSION_REQUIRED");
});

test("action request maps to intent and never grants capability", () => {
  const validated = validateActionRequest({
    sourceAppId: "lifeos",
    payload: {
      action: "edit",
      requestId: "a1",
      object: { type: "asset", id: "x", title: "Video" },
    },
  });
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.intent, "edit");
    assert.equal(validated.grantsCapability, false);
    assert.equal(validated.grantsPermission, false);
    assert.equal(actionDoesNotGrantCapability(), true);
    assert.equal(handlerDoesNotImplyPrivilege(), true);
  }
  assert.equal(
    validateActionRequest({
      sourceAppId: "lifeos",
      payload: { action: "edit", requestId: "a2", object: { type: "text", text: "x" }, permissions: ["camera"] },
    }).ok,
    false,
  );
  assert.equal(actionFromIntent("edit").label, "Edit");
  assert.equal(actionRequiresConfirmation("publish"), true);
  assert.equal(actionRequiresConfirmation("view"), false);
});

test("forged handler claim is detectable via registration check", () => {
  const registry = seedApplicationCatalog();
  assert.equal(
    assertHandlerRegistered({ registry, appId: "shell-demo-notes", action: "edit", objectType: "text" }),
    true,
  );
  assert.equal(
    assertHandlerRegistered({ registry, appId: "shell-demo-notes", action: "edit", objectType: "asset" }),
    false,
  );
  assert.equal(
    assertHandlerRegistered({ registry, appId: "evil-app", action: "edit", objectType: "text" }),
    false,
  );
});

test("action result accepts return context references only", () => {
  const ok = createActionResult({
    status: "completed",
    action: "edit",
    returnContext: { type: "asset", id: "v2", title: "Version 2" },
  });
  assert.equal(ok.ok, true);
  assert.equal(
    createActionResult({
      status: "completed",
      returnContext: { type: "asset", id: "v2", token: "x" },
    }).ok,
    false,
  );
});

test("grouped actions support open-with style multi-handler lists", () => {
  const registry = seedApplicationCatalog();
  const asset = createContextReference({ type: "asset", id: "a1", title: "Video" });
  assert.equal(asset.ok, true);
  if (!asset.ok) return;
  const discovered = discoverActions({ object: asset.context, registry });
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;
  const groups = groupActionsById(discovered.actions);
  const view = groups.find((item) => item.action.id === "view");
  assert.ok(view && view.handlers.length >= 2);
});

test("three-application action workflow metadata", () => {
  const registry = seedApplicationCatalog();
  const object = createContextReference({
    type: "asset",
    id: "course-1",
    title: "Example Course",
    originAppId: "lifeos",
    subtype: "COURSE",
  });
  assert.equal(object.ok, true);
  if (!object.ok) return;

  const step1 = discoverActions({ object: object.context, registry, excludeAppId: "lifeos" });
  assert.equal(step1.ok, true);
  if (!step1.ok) return;
  const edit = step1.actions.find((item) => item.action.id === "edit" && item.handler.appId === "mybrandos");
  assert.ok(edit);

  const share = validateActionRequest({
    sourceAppId: "mybrandos",
    payload: {
      action: "share",
      requestId: "s1",
      targetAppId: "lifeos",
      object: object.context,
      sessionId: "sess-abc-defg",
    },
  });
  assert.equal(share.ok, true);
  if (share.ok) {
    assert.equal(share.targetAppId, "lifeos");
    assert.equal(share.sessionId, "sess-abc-defg");
  }
});
