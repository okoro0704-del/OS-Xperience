import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPERATING_CONTEXT_CONTRACT_VERSION,
  SHELL_MESSAGE_VERSION,
  personalContextDoesNotGrantAuthorization,
  personalContextDoesNotGrantPermission,
  personalContextIsNotCapability,
  personalContextIsNotCredential,
  personalContextIsNotOwnership,
  personalContextIsNotUniversalProfile,
  personalContextIsNotWorkflow,
  createOperatingContext,
  resolveContextualObjective,
  resolveOperatingContext,
  seedApplicationCatalog,
  sessionResumeLabel,
  setApplicationPreference,
  snapshotOperatingContext,
  validateContextProposal,
} from "../src/index.ts";

test("personal operating context contract version is 2.0", () => {
  assert.equal(OPERATING_CONTEXT_CONTRACT_VERSION, "2.0");
  assert.equal(SHELL_MESSAGE_VERSION, "0.7");
});

test("doctrine: context is not permission, credential, ownership, capability, workflow, or profile", () => {
  assert.equal(personalContextDoesNotGrantPermission(), true);
  assert.equal(personalContextDoesNotGrantAuthorization(), true);
  assert.equal(personalContextIsNotCredential(), true);
  assert.equal(personalContextIsNotOwnership(), true);
  assert.equal(personalContextIsNotCapability(), true);
  assert.equal(personalContextIsNotWorkflow(), true);
  assert.equal(personalContextIsNotUniversalProfile(), true);
});

test("resolveOperatingContext builds current, recent, preference, availability planes", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectiveType: "edit",
    objectReference: { type: "asset", id: "video-123", title: "Video Project", subtype: "VIDEO", originAppId: "mybrandos" },
    sessionId: "sess-1",
    label: "Video Project",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const prefs = setApplicationPreference([], {
    appId: "mybrandos",
    objectiveType: "edit",
    objectType: "video",
    preference: "preferred",
    source: "EXPLICIT",
    updatedAt: new Date().toISOString(),
  });
  const personal = resolveOperatingContext({
    continuity: created.context,
    recent: [created.context],
    registry: seedApplicationCatalog(),
    preferences: prefs,
    capabilityStatus: [{ id: "camera", label: "Camera", status: "granted" }],
  });
  assert.equal(personal.isUniversalProfile, false);
  assert.equal(personal.grantsAuthorization, false);
  assert.equal(personal.containsPrivateApplicationState, false);
  assert.ok(personal.current);
  assert.equal(personal.current?.label, "Video Project");
  assert.equal(personal.current?.applicationId, "mybrandos");
  assert.ok(personal.recent.length >= 1);
  assert.ok(personal.preferences.some((item) => item.appId === "mybrandos"));
  assert.ok(personal.availability.some((item) => item.appId === "mybrandos"));
  assert.ok(personal.contextualActions.length >= 1);
  assert.ok(personal.current?.why);
});

test("contextual actions reuse action discovery availability", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectReference: { type: "asset", id: "video-123", title: "Video", subtype: "VIDEO", originAppId: "mybrandos" },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const personal = resolveOperatingContext({
    continuity: created.context,
    registry: seedApplicationCatalog(),
  });
  const labels = personal.contextualActions.map((item) => item.label);
  assert.ok(labels.includes("Edit") || labels.includes("View") || labels.includes("Share"));
  assert.ok(personal.contextualActions.every((item) => item.availability));
});

test("offline availability becomes UNKNOWN not AVAILABLE", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectReference: { type: "asset", id: "video-123", title: "Video", originAppId: "mybrandos" },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const personal = resolveOperatingContext({
    continuity: created.context,
    registry: seedApplicationCatalog(),
    offline: true,
  });
  assert.equal(personal.current?.availability, "UNKNOWN");
});

test("snapshot scopes do not dump global recent to third-party apps", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectReference: { type: "asset", id: "video-123", title: "Video", originAppId: "mybrandos" },
    label: "Video",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const personal = resolveOperatingContext({
    continuity: created.context,
    recent: [created.context],
    registry: seedApplicationCatalog(),
  });
  const snap = snapshotOperatingContext(personal, "APPLICATION", "shell-demo-notes");
  assert.equal(snap.grantsAuthorization, false);
  assert.equal(snap.entries.some((item) => item.kind === "RECENT"), false);
});

test("natural language: continue, preview it, what can I do with this", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    objectReference: { type: "asset", id: "video-123", title: "Video", subtype: "VIDEO", originAppId: "mybrandos" },
    label: "Video Project",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const personal = resolveOperatingContext({
    continuity: created.context,
    registry: seedApplicationCatalog(),
  });
  const cont = resolveContextualObjective({ text: "continue", personal });
  assert.equal(cont.ok, true);
  if (!cont.ok) return;
  assert.equal("objective" in cont && cont.objective.type, "continue");

  const preview = resolveContextualObjective({ text: "preview it", personal });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal("ambiguous" in preview && preview.ambiguous, false);
  assert.equal(preview.objective.type, "preview");

  const inspect = resolveContextualObjective({ text: "what can I do with this?", personal });
  assert.equal(inspect.ok, true);
  if (!inspect.ok) return;
  assert.equal("kind" in inspect && inspect.kind, "inspect");
});

test("ambiguity when multiple recent objects and no current", () => {
  const a = createOperatingContext({
    id: "a",
    currentAppId: "mybrandos",
    objectReference: { type: "asset", id: "v1", title: "Product Video", originAppId: "mybrandos" },
    label: "Product Video",
  });
  const b = createOperatingContext({
    id: "b",
    currentAppId: "mybrandos",
    objectReference: { type: "asset", id: "v2", title: "Podcast Video", originAppId: "mybrandos" },
    label: "Podcast Video",
  });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  const personal = resolveOperatingContext({
    continuity: null,
    recent: [a.context, b.context],
    registry: seedApplicationCatalog(),
  });
  const result = resolveContextualObjective({
    text: "preview it",
    personal,
    recent: [a.context, b.context],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("ambiguous" in result && result.ambiguous, true);
  if ("ambiguous" in result && result.ambiguous) {
    assert.ok(result.candidates.length >= 2);
  }
});

test("session resume labels are honest", () => {
  assert.equal(sessionResumeLabel("ACTIVE"), "Continue");
  assert.equal(sessionResumeLabel("BACKGROUND"), "Resume");
  assert.equal(sessionResumeLabel("SUSPENDED"), "Resume");
  assert.equal(sessionResumeLabel("ENDED"), "Start Fresh");
});

test("context proposals reject force flags and secrets", () => {
  assert.equal(validateContextProposal({ forceCurrent: true }).ok, false);
  assert.equal(validateContextProposal({ token: "x" }).ok, false);
  assert.equal(validateContextProposal({ objectReference: { type: "asset", id: "1" } }).ok, true);
});

test("ended session surfaces SESSION_ENDED availability", () => {
  const created = createOperatingContext({
    currentAppId: "mybrandos",
    sessionId: "ended",
    objectReference: { type: "asset", id: "video-123", title: "Video", originAppId: "mybrandos" },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const personal = resolveOperatingContext({
    continuity: created.context,
    registry: seedApplicationCatalog(),
    sessions: [
      {
        sessionId: "ended",
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
  assert.equal(personal.current?.availability, "SESSION_ENDED");
});
