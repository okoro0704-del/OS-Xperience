import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activateShellSession,
  addResumePoint,
  backgroundShellSession,
  createShellSession,
  currentActiveSession,
  endShellSession,
  joinShellSession,
  leaveShellSession,
  listRecentWork,
  recordSessionIntent,
  resumeShellSession,
  sanitizeSessionForDiagnostics,
  sessionDoesNotOwnApplicationData,
  sessionIsNotApplicationDatabase,
  sessionIsNotAuthentication,
  sessionIsNotAuthorization,
  setSessionActiveContext,
  suspendShellSession,
  switchActiveSession,
  validateIntentRequest,
  validateSessionId,
  createContextReference,
  seedApplicationCatalog,
  intentToHandoffPayload,
} from "../src/index.ts";

test("session lifecycle create activate background suspend resume end", () => {
  let session = createShellSession({ label: "Edit video" });
  assert.equal(session.state, "CREATED");
  assert.equal(validateSessionId(session.sessionId), true);
  const activated = activateShellSession(session);
  assert.equal(activated.ok, true);
  if (activated.ok) session = activated.value;
  assert.equal(session.state, "ACTIVE");
  const bg = backgroundShellSession(session);
  assert.equal(bg.ok, true);
  if (bg.ok) session = bg.value;
  assert.equal(session.state, "BACKGROUND");
  const suspended = suspendShellSession(session);
  assert.equal(suspended.ok, true);
  if (suspended.ok) session = suspended.value;
  assert.equal(session.state, "SUSPENDED");
  const resumed = resumeShellSession([session], session.sessionId);
  assert.equal(resumed.ok, true);
  if (resumed.ok) {
    assert.equal(resumed.value.session.state, "ACTIVE");
    session = resumed.value.session;
  }
  session = endShellSession(session);
  assert.equal(session.state, "ENDED");
  assert.equal(session.context.activeApplicationId, undefined);
  assert.equal(activateShellSession(session).ok, false);
});

test("session switching keeps one active workflow", () => {
  const a = activateShellSession(createShellSession({ label: "Edit video" }));
  const b = activateShellSession(createShellSession({ label: "Review project" }));
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  const switched = switchActiveSession([a.value, b.value], b.value.sessionId);
  assert.equal(switched.ok, true);
  if (!switched.ok) return;
  assert.equal(currentActiveSession(switched.value)?.sessionId, b.value.sessionId);
  assert.equal(switched.value.find((item) => item.sessionId === a.value.sessionId)?.state, "BACKGROUND");
});

test("context remains reference-based and rejects secrets", () => {
  let session = createShellSession({ label: "Notes" });
  const activated = activateShellSession(session);
  assert.equal(activated.ok, true);
  if (activated.ok) session = activated.value;
  const ok = setSessionActiveContext(session, {
    appId: "shell-demo-notes",
    intent: "edit",
    context: { type: "text", title: "Example Article", text: "draft", lifetime: "EPHEMERAL" },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.context.activeContext?.type, "text");
    assert.notEqual(ok.value.context.activeContext?.lifetime, "PERSISTED_REFERENCE");
  }
  assert.equal(
    setSessionActiveContext(session, {
      context: { type: "text", text: "x", accessToken: "secret" },
    }).ok,
    false,
  );
  assert.equal(
    setSessionActiveContext(session, {
      context: { type: "file", bytes: "abc" },
    }).ok,
    false,
  );
});

test("participants join and leave without carrying application state", () => {
  let session = createShellSession({ label: "Cross-app" });
  const joined = joinShellSession(session, "lifeos");
  assert.equal(joined.ok, true);
  if (joined.ok) session = joined.value;
  const next = joinShellSession(session, "mybrandos");
  assert.equal(next.ok, true);
  if (next.ok) session = next.value;
  assert.equal(session.participants.length, 2);
  const left = leaveShellSession(session, "lifeos");
  assert.equal(left.ok, true);
  if (left.ok) {
    assert.equal(left.value.participants.some((item) => item.appId === "lifeos"), false);
  }
});

test("intent continuity records handoff metadata without private payloads", () => {
  let session = createShellSession({ label: "Asset edit" });
  const ctx = createContextReference({
    type: "asset",
    id: "opaque-asset",
    title: "Example Video",
    metadata: { assetType: "VIDEO" },
  });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;
  const recorded = recordSessionIntent(session, {
    sourceAppId: "lifeos",
    targetAppId: "mybrandos",
    intent: "edit",
    context: ctx.context,
  });
  assert.equal(recorded.ok, true);
  if (!recorded.ok) return;
  session = recorded.value;
  assert.equal(session.participants.length, 2);
  assert.equal(session.context.activeApplicationId, "mybrandos");
  assert.equal(session.context.activeIntent, "edit");
  assert.equal(session.context.activeContext?.type, "asset");
  const diag = sanitizeSessionForDiagnostics(session);
  assert.equal(diag.contextType, "asset");
  assert.equal("text" in diag, false);
  const handoff = intentToHandoffPayload({
    targetAppId: "shell-demo-notes",
    route: "/",
    intent: "share",
    context: { type: "text", text: "hi" },
    sourceAppId: "mybrandos",
    sessionId: session.sessionId,
  });
  assert.equal(handoff.context.sessionId, session.sessionId);
  assert.equal(handoff.context.kind, "os-shell.intent");
});

test("intent request accepts optional sessionId and rejects forged-looking ids", () => {
  const ok = validateIntentRequest({
    sourceAppId: "lifeos",
    payload: {
      intent: "view",
      requestId: "r1",
      sessionId: "sess-abc-def",
      context: { type: "asset", id: "a1", title: "Video", metadata: { assetType: "VIDEO" } },
    },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.request.sessionId, "sess-abc-def");
  assert.equal(
    validateIntentRequest({
      sourceAppId: "lifeos",
      payload: {
        intent: "view",
        requestId: "r2",
        sessionId: "forged",
        context: { type: "asset", id: "a1", metadata: { assetType: "VIDEO" } },
      },
    }).ok,
    false,
  );
});

test("resume points are labels and references only", () => {
  let session = createShellSession({ label: "Notes" });
  const withPoint = addResumePoint(session, {
    appId: "shell-demo-notes",
    route: "/",
    label: "Editing selected text",
    context: { type: "text", title: "Chapter 4", text: "snippet" },
  });
  assert.equal(withPoint.ok, true);
  if (!withPoint.ok) return;
  session = withPoint.value;
  assert.equal(session.persistence, "resume-safe");
  assert.equal(session.resumePoints[0]?.label, "Editing selected text");
  const ended = endShellSession(session);
  assert.equal(ended.resumePoints.length, 1);
  const resumed = resumeShellSession([ended], ended.sessionId);
  assert.equal(resumed.ok, true);
});

test("ended session-only clears resume points", () => {
  const session = endShellSession(createShellSession({ label: "Temp" }));
  assert.equal(session.resumePoints.length, 0);
  assert.equal(resumeShellSession([session], session.sessionId).ok, false);
});

test("doctrine: session is not auth, authz, or application database", () => {
  assert.equal(sessionIsNotAuthentication(), true);
  assert.equal(sessionIsNotAuthorization(), true);
  assert.equal(sessionIsNotApplicationDatabase(), true);
  assert.equal(sessionDoesNotOwnApplicationData(), true);
});

test("three-application continuity metadata across LifeOS → mybrandOS → Demo Notes", () => {
  const registry = seedApplicationCatalog();
  assert.ok(registry.some((item) => item.appId === "lifeos"));
  assert.ok(registry.some((item) => item.appId === "mybrandos"));
  assert.ok(registry.some((item) => item.appId === "shell-demo-notes"));

  let session = createShellSession({ label: "Example Video" });
  const asset = createContextReference({
    type: "asset",
    id: "video-1",
    title: "Example Video",
    metadata: { assetType: "VIDEO" },
  });
  assert.equal(asset.ok, true);
  if (!asset.ok) return;

  const toBrand = recordSessionIntent(session, {
    sourceAppId: "lifeos",
    targetAppId: "mybrandos",
    intent: "edit",
    context: asset.context,
  });
  assert.equal(toBrand.ok, true);
  if (!toBrand.ok) return;
  session = toBrand.value;

  const text = createContextReference({ type: "text", title: "Editing notes", text: "chapter" });
  assert.equal(text.ok, true);
  if (!text.ok) return;
  const toDemo = recordSessionIntent(session, {
    sourceAppId: "mybrandos",
    targetAppId: "shell-demo-notes",
    intent: "share",
    context: text.context,
  });
  assert.equal(toDemo.ok, true);
  if (!toDemo.ok) return;
  session = toDemo.value;

  assert.deepEqual(
    session.participants.map((item) => item.appId).sort(),
    ["lifeos", "mybrandos", "shell-demo-notes"],
  );
  assert.equal(session.context.previousApplicationId, "mybrandos");
  assert.equal(session.context.activeApplicationId, "shell-demo-notes");
  const recent = listRecentWork([session]);
  assert.equal(recent[0]?.label.includes("Example Video") || recent[0]?.appId === "shell-demo-notes", true);

  // Return path is navigation — session still knows the workflow without private state.
  const backBrand = joinShellSession(session, "mybrandos");
  assert.equal(backBrand.ok, true);
  if (backBrand.ok) {
    assert.equal(backBrand.value.context.activeApplicationId, "mybrandos");
  }
});

test("diagnostics never expose private payloads", () => {
  const ctx = createContextReference({ type: "text", text: "private draft body", title: "Draft" });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;
  const session = setSessionActiveContext(createShellSession({ label: "Draft" }), {
    context: ctx.context,
    appId: "shell-demo-notes",
  });
  assert.equal(session.ok, true);
  if (!session.ok) return;
  const diag = sanitizeSessionForDiagnostics(session.value);
  const serialized = JSON.stringify(diag);
  assert.equal(serialized.includes("private draft body"), false);
});
