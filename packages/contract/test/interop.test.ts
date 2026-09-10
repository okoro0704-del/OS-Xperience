import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createContextReference,
  defaultIntentHandlersFor,
  discoverIntentHandlers,
  handoffDoesNotTransferPermission,
  intentDoesNotGrantCapability,
  intentToHandoffPayload,
  lookupDefaultHandler,
  resolveIntentTarget,
  seedApplicationCatalog,
  setDefaultHandler,
  validateApplicationHandoff,
  validateContextReference,
  validateDeveloperManifest,
  validateIntentRequest,
  contextDoesNotGrantAuthorization,
} from "../src/index.ts";

const DEMO = "http://127.0.0.1:5185";

test("valid text, url, asset, and application contexts are accepted", () => {
  assert.equal(createContextReference({ type: "text", text: "hello" }).ok, true);
  assert.equal(createContextReference({ type: "url", url: "https://example.com/x" }).ok, true);
  assert.equal(createContextReference({ type: "asset", id: "opaque-1", title: "Video", metadata: { assetType: "VIDEO" } }).ok, true);
  assert.equal(createContextReference({ type: "application", appId: "lifeos" }).ok, true);
});

test("malformed, oversized, and credential-bearing contexts are rejected", () => {
  assert.equal(validateContextReference({ type: "nope" }).ok, false);
  assert.equal(validateContextReference({ type: "text", text: "x".repeat(5000) }).ok, false);
  assert.equal(validateContextReference({ type: "text", text: "hi", accessToken: "x" }).ok, false);
  assert.equal(validateContextReference({ type: "file", bytes: "abc" }).ok, false);
  assert.equal(validateContextReference({ type: "asset", grants: ["camera"] }).ok, false);
  const ok = createContextReference({ type: "text", text: "hi" });
  if (ok.ok) {
    assert.equal(ok.grantsAuthorization, false);
    assert.equal(contextDoesNotGrantAuthorization(ok.context), true);
  }
});

test("intent validation separates intent from capability and permission", () => {
  const validated = validateIntentRequest({
    sourceAppId: "shell-demo-notes",
    payload: {
      intent: "share",
      requestId: "i1",
      context: { type: "text", text: "note" },
    },
  });
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.grantsCapability, false);
    assert.equal(validated.grantsPermission, false);
    assert.equal(intentDoesNotGrantCapability(), true);
    assert.equal(handoffDoesNotTransferPermission(), true);
  }
  assert.equal(
    validateIntentRequest({
      sourceAppId: "shell-demo-notes",
      payload: { intent: "share", requestId: "i2", context: { type: "text", text: "x" }, permissions: ["camera"] },
    }).ok,
    false,
  );
  assert.equal(
    validateIntentRequest({
      sourceAppId: "shell-demo-notes",
      payload: { intent: "edit", requestId: "i3", context: { type: "url", url: "https://example.com" } },
    }).ok,
    false,
  );
});

test("handler discovery works across the three seeded applications", () => {
  const registry = seedApplicationCatalog();
  const textHandlers = discoverIntentHandlers({
    intent: "view",
    contextType: "text",
    registry,
    excludeAppId: "mybrandos",
  });
  assert.ok(textHandlers.some((item) => item.appId === "shell-demo-notes"));
  const assetHandlers = discoverIntentHandlers({ intent: "view", contextType: "asset", registry });
  assert.ok(assetHandlers.some((item) => item.appId === "lifeos"));
  assert.ok(assetHandlers.some((item) => item.appId === "mybrandos"));
});

test("routing supports explicit target, defaults, and chooser", () => {
  const registry = seedApplicationCatalog();
  const request = {
    intent: "view" as const,
    sourceAppId: "mybrandos",
    context: { type: "text" as const, text: "hello" },
    requestId: "r1",
  };
  const explicit = resolveIntentTarget({
    request: { ...request, targetAppId: "shell-demo-notes" },
    registry,
  });
  assert.equal(explicit.ok, true);
  if (explicit.ok) assert.equal(explicit.selected?.appId, "shell-demo-notes");

  const defaults = setDefaultHandler([], { intent: "view", contextType: "text", appId: "shell-demo-notes" });
  assert.equal(lookupDefaultHandler(defaults, "view", "text"), "shell-demo-notes");
  const withDefault = resolveIntentTarget({
    request,
    registry,
    defaultHandlerAppId: "shell-demo-notes",
  });
  assert.equal(withDefault.ok, true);
  if (withDefault.ok) {
    assert.equal(withDefault.mode, "default");
    assert.equal(withDefault.selected?.appId, "shell-demo-notes");
  }

  const chooser = resolveIntentTarget({
    request: {
      intent: "view",
      sourceAppId: "shell-demo-notes",
      context: { type: "asset", id: "a1", title: "Clip" },
      requestId: "r2",
    },
    registry,
  });
  assert.equal(chooser.ok, true);
  if (chooser.ok) {
    assert.equal(chooser.mode, "chooser");
    assert.ok(chooser.handlers.length >= 2);
  }
});

test("intent handoff payload stays credential-free and uses safe handoff validation", () => {
  const registry = seedApplicationCatalog();
  const payload = intentToHandoffPayload({
    targetAppId: "lifeos",
    route: "/",
    intent: "share",
    sourceAppId: "shell-demo-notes",
    context: { type: "text", text: "hi" },
  });
  const validated = validateApplicationHandoff({
    sourceAppId: "shell-demo-notes",
    handoff: payload,
    registry,
  });
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.equal(validated.transfersPermissions, false);
    assert.equal(validated.transfersCredentials, false);
  }
  assert.equal(JSON.stringify(payload).includes("accessToken"), false);
});

test("manifest intent handlers are optional and validated", () => {
  const without = validateDeveloperManifest(
    {
      appId: "demo",
      name: "Demo",
      version: "1.3.0",
      origin: DEMO,
      class: "compatible",
      requestedCapabilities: ["camera"],
    },
    DEMO,
  );
  assert.equal(without.ok, true);
  const withHandlers = validateDeveloperManifest(
    {
      appId: "demo",
      name: "Demo",
      version: "1.3.0",
      origin: DEMO,
      class: "compatible",
      requestedCapabilities: [],
      intentHandlers: defaultIntentHandlersFor("shell-demo-notes"),
    },
    DEMO,
  );
  assert.equal(withHandlers.ok, true);
  const bad = validateDeveloperManifest(
    {
      appId: "demo",
      name: "Demo",
      version: "1.3.0",
      origin: DEMO,
      class: "compatible",
      requestedCapabilities: [],
      intentHandlers: [{ intent: "edit", contextTypes: ["url"] }],
    },
    DEMO,
  );
  assert.equal(bad.ok, false);
});

test("forged source identity in payload is ignored by validation API contract", () => {
  const validated = validateIntentRequest({
    sourceAppId: "shell-demo-notes",
    payload: {
      intent: "view",
      requestId: "x",
      sourceAppId: "mybrandos",
      context: { type: "text", text: "x" },
    },
  });
  assert.equal(validated.ok, true);
  if (validated.ok) assert.equal(validated.request.sourceAppId, "shell-demo-notes");
});
