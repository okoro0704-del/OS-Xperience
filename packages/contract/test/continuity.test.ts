import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPERATING_CONTEXT_CONTRACT_VERSION,
  SHELL_MESSAGE_VERSION,
  applyReturnHandoff,
  continueFromOperatingContext,
  continuityIsNotWorkflow,
  contextDoesNotGrantPermission,
  createOperatingContext,
  handoffDoesNotDelegateCredentials,
  parseOperatingContexts,
  publicOperatingContextView,
  referenceDoesNotGrantAuthorization,
  rememberRecentContinuity,
  revalidateOperatingContext,
  seedApplicationCatalog,
  setApplicationPreference,
  validateContinuityHandoff,
  validateOperatingContext,
} from "../src/index.ts";

test("operating context contract version is 2.0", () => {
  assert.equal(OPERATING_CONTEXT_CONTRACT_VERSION, "2.0");
  assert.equal(SHELL_MESSAGE_VERSION, "0.7");
});

test("doctrine: context is not permission, handoff is not credential, continuity is not workflow", () => {
  assert.equal(contextDoesNotGrantPermission(), true);
  assert.equal(referenceDoesNotGrantAuthorization(), true);
  assert.equal(handoffDoesNotDelegateCredentials(), true);
  assert.equal(continuityIsNotWorkflow(), true);
});

test("create and retrieve operating context is reference-only", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectiveType: "create",
    objectReference: { type: "asset", id: "video-123", title: "Video", subtype: "VIDEO", originAppId: "mybrandos" },
    sessionId: "session-789",
    label: "Video project",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.context.objectReference?.id, "video-123");
  assert.equal(created.context.currentAppId, "mybrandos");
  const view = publicOperatingContextView(created.context);
  assert.equal(view?.objectType, "asset");
  assert.equal((view as { bytes?: unknown })?.bytes, undefined);
});

test("operating context rejects secrets and private payloads", () => {
  assert.equal(validateOperatingContext({ currentAppId: "mybrandos", token: "x" }).ok, false);
  assert.equal(validateOperatingContext({ currentAppId: "mybrandos", password: "x" }).ok, false);
  assert.equal(validateOperatingContext({ currentAppId: "mybrandos", bytes: "abc" }).ok, false);
  assert.equal(validateOperatingContext({ currentAppId: "mybrandos", stream: {} }).ok, false);
  assert.equal(validateOperatingContext({ currentAppId: "mybrandos", permissions: ["all"] }).ok, false);
});

test("clear and bounded recent continuity", () => {
  const a = createOperatingContext({ currentAppId: "mybrandos", label: "A", id: "ctx-a" });
  const b = createOperatingContext({ currentAppId: "lifeos", label: "B", id: "ctx-b" });
  const c = createOperatingContext({ currentAppId: "shell-demo-notes", label: "C", id: "ctx-c" });
  const d = createOperatingContext({ currentAppId: "mybrandos", label: "D", id: "ctx-d" });
  const e = createOperatingContext({ currentAppId: "mybrandos", label: "E", id: "ctx-e" });
  assert.ok(a.ok && b.ok && c.ok && d.ok && e.ok);
  if (!a.ok || !b.ok || !c.ok || !d.ok || !e.ok) return;
  let recent = rememberRecentContinuity([], a.context);
  recent = rememberRecentContinuity(recent, b.context);
  recent = rememberRecentContinuity(recent, c.context);
  recent = rememberRecentContinuity(recent, d.context);
  recent = rememberRecentContinuity(recent, e.context);
  assert.equal(recent.length, 4);
  assert.equal(recent[0]?.id, "ctx-e");
  assert.equal(parseOperatingContexts(recent).length, 4);
});

test("continue with no current work", () => {
  const result = continueFromOperatingContext({
    current: null,
    registry: seedApplicationCatalog(),
  });
  assert.equal(result.status, "NO_CURRENT_WORK");
  assert.equal(result.isWorkflow, false);
  assert.equal(result.grantsAuthorization, false);
});

test("continue current objective routes to preferred place", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectiveType: "edit",
    objectReference: { type: "asset", id: "video-123", title: "Video", subtype: "VIDEO", originAppId: "mybrandos" },
    sessionId: "session-1",
    label: "Video",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const result = continueFromOperatingContext({
    current: created.context,
    registry: seedApplicationCatalog(),
  });
  assert.equal(result.status, "AVAILABLE");
  assert.ok(result.routes.length >= 1);
  assert.equal(result.routes[0]?.appId, "mybrandos");
});

test("session ended fails honestly", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    sessionId: "ended-session",
    label: "Video",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const result = continueFromOperatingContext({
    current: created.context,
    registry: seedApplicationCatalog(),
    sessions: [
      {
        sessionId: "ended-session",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: "ENDED",
        context: {},
        resumePoints: [],
        participants: [],
        persistence: "session-only",
      },
    ],
  });
  assert.equal(result.status, "SESSION_ENDED");
});

test("unavailable preferred application does not silently switch on continue", () => {
  const created = createOperatingContext({
    currentAppId: "missing-app",
    objectiveType: "edit",
    objectReference: { type: "asset", id: "video-123", title: "Video", subtype: "VIDEO" },
    label: "Video",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const revalidated = revalidateOperatingContext({
    context: created.context,
    registry: seedApplicationCatalog(),
  });
  assert.equal(revalidated.status, "APPLICATION_UNAVAILABLE");
  const continued = continueFromOperatingContext({
    current: created.context,
    registry: seedApplicationCatalog(),
    request: { objectiveType: "continue" },
  });
  assert.equal(continued.status, "APPLICATION_UNAVAILABLE");
});

test("preview it uses current object reference without workflow", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectiveType: "create",
    objectReference: { type: "asset", id: "video-123", title: "Video", subtype: "VIDEO", originAppId: "mybrandos" },
    label: "Video",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const result = continueFromOperatingContext({
    current: created.context,
    registry: seedApplicationCatalog(),
    request: { objectiveType: "preview", target: "this" },
  });
  assert.equal(result.isWorkflow, false);
  assert.ok(result.routes.every((route) => route.objective.type === "preview"));
});

test("return handoff updates context with suggestions only", () => {
  const base = createOperatingContext({
    currentAppId: "mybrandos",
    objectiveType: "create",
    label: "Creating",
  });
  assert.equal(base.ok, true);
  if (!base.ok) return;
  const applied = applyReturnHandoff(
    base.context,
    {
      objectReference: { type: "asset", id: "video-123", title: "New Video", subtype: "VIDEO" },
      suggestedNextObjectives: [
        { type: "preview", label: "Preview" },
        { type: "publish", label: "Publish" },
      ],
    },
    "mybrandos",
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.context.objectReference?.id, "video-123");
  assert.ok((applied.context.suggestedNextObjectives?.length ?? 0) >= 1);
});

test("return handoff rejects credentials", () => {
  const applied = applyReturnHandoff(null, { objectReference: { type: "asset", id: "x" }, token: "secret" }, "mybrandos");
  assert.equal(applied.ok, false);
});

test("continuity handoff rejects secrets and self-handoff", () => {
  const registry = seedApplicationCatalog();
  assert.equal(
    validateContinuityHandoff({
      sourceAppId: "mybrandos",
      registry,
      handoff: { targetAppId: "lifeos", token: "nope" },
    }).ok,
    false,
  );
  assert.equal(
    validateContinuityHandoff({
      sourceAppId: "mybrandos",
      registry,
      handoff: { targetAppId: "mybrandos" },
    }).ok,
    false,
  );
  const ok = validateContinuityHandoff({
    sourceAppId: "mybrandos",
    registry,
    handoff: {
      targetAppId: "shell-demo-notes",
      objectReference: { type: "text", id: "note-1", title: "Note" },
    },
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.transfersCredentials, false);
  assert.equal(ok.transfersOwnership, false);
});

test("explicit preference + continuity still respects compatibility", () => {
  const prefs = setApplicationPreference([], {
    appId: "shell-demo-notes",
    objectiveType: "preview",
    objectType: "video",
    preference: "preferred",
    source: "EXPLICIT",
    updatedAt: new Date().toISOString(),
  });
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectReference: { type: "asset", id: "video-123", title: "Video", subtype: "VIDEO", originAppId: "mybrandos" },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const result = continueFromOperatingContext({
    current: created.context,
    registry: seedApplicationCatalog(),
    preferences: prefs,
    request: { objectiveType: "preview", target: "this" },
  });
  assert.equal(result.grantsAuthorization, false);
  assert.equal(result.grantsCapability, false);
});

test("third-party cannot inject operating context via invalid parse", () => {
  const parsed = parseOperatingContexts([
    { id: "x", currentAppId: "evil", token: "steal" },
    { id: "ok", currentAppId: "mybrandos", label: "Fine" },
  ]);
  assert.equal(parsed.every((item) => !("token" in item)), true);
  assert.ok(parsed.some((item) => item.currentAppId === "mybrandos"));
});
