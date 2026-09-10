import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OBJECTIVES_CONTRACT_VERSION,
  contextStubForTarget,
  createShellSession,
  defaultObjectiveDeclarationFor,
  discoverObjectiveRoutes,
  objectiveDoesNotGrantAuthorization,
  objectiveDoesNotGrantCapability,
  objectiveIsNotIntent,
  parseObjectiveText,
  resolveObjectiveFromText,
  seedApplicationCatalog,
  shellDoesNotOwnWorkflowExecution,
  suggestObjectives,
  validateObjective,
  validateObjectiveDeclaration,
} from "../src/index.ts";

test("objectives contract version is 1.7", () => {
  assert.equal(OBJECTIVES_CONTRACT_VERSION, "1.7");
});

test("parseObjectiveText is deterministic and rejects unknown input", () => {
  const create = parseObjectiveText("Create video");
  assert.equal(create.ok, true);
  if (create.ok) {
    assert.equal(create.objective.type, "create");
    assert.equal(create.objective.target, "video");
  }
  const edit = parseObjectiveText("Edit music");
  assert.equal(edit.ok, true);
  if (edit.ok) {
    assert.equal(edit.objective.type, "edit");
    assert.equal(edit.objective.target, "music");
  }
  const cont = parseObjectiveText("Continue");
  assert.equal(cont.ok, true);
  if (cont.ok) assert.equal(cont.objective.type, "continue");
  assert.equal(parseObjectiveText("teleport to mars").ok, false);
});

test("objective validation rejects secrets and malformed payloads", () => {
  assert.equal(validateObjective({ type: "create", target: "video" }).ok, true);
  assert.equal(validateObjective({ type: "create", accessToken: "x" }).ok, false);
  assert.equal(validateObjective({ type: "nope" }).ok, false);
  assert.equal(validateObjectiveDeclaration({ create: ["video"] }).ok, true);
  assert.equal(validateObjectiveDeclaration({ invent: ["x"] }).ok, false);
});

test("three applications declare objectives through the public catalog", () => {
  const registry = seedApplicationCatalog();
  assert.ok(defaultObjectiveDeclarationFor("mybrandos").create?.includes("video"));
  assert.ok(defaultObjectiveDeclarationFor("lifeos").open?.includes("digital_life"));
  assert.ok(defaultObjectiveDeclarationFor("shell-demo-notes").create?.includes("note"));
  assert.ok(registry.every((app) => app.appId !== "shell-demo-notes" || app.objectives));
});

test("Create Video routes to mybrandOS without granting capability", () => {
  const registry = seedApplicationCatalog();
  const resolved = resolveObjectiveFromText({ text: "Create video", registry });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.grantsAuthorization, false);
  assert.equal(resolved.grantsCapability, false);
  assert.ok(resolved.routes.some((item) => item.appId === "mybrandos" && item.intent === "create"));
});

test("Edit text can route to Demo Notes and mybrandOS where declared", () => {
  const registry = seedApplicationCatalog();
  const text = {
    type: "text" as const,
    title: "Note",
    text: "hello",
    originAppId: "shell-demo-notes",
    lifetime: "EPHEMERAL" as const,
  };
  const discovered = discoverObjectiveRoutes({
    objective: { type: "edit", target: "this", context: text },
    registry,
    selectedObject: text,
  });
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;
  assert.ok(discovered.routes.some((item) => item.appId === "shell-demo-notes"));
});

test("Preview Software reports runtime_unavailable when unbound", () => {
  const registry = seedApplicationCatalog();
  const resolved = resolveObjectiveFromText({
    text: "Preview software",
    registry,
    runtimeHints: { softwareRuntime: false },
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  const route = resolved.routes.find((item) => item.appId === "mybrandos");
  assert.ok(route);
  assert.equal(route?.availability, "UNAVAILABLE");
  assert.equal(route?.reason, "runtime_unavailable");
});

test("Continue uses existing sessions and resume_unavailable without them", () => {
  const registry = seedApplicationCatalog();
  const empty = resolveObjectiveFromText({ text: "Continue", registry, sessions: [] });
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.ok(empty.routes.every((item) => item.availability === "UNAVAILABLE"));

  const session = createShellSession({ label: "Recording Studio" });
  session.state = "ACTIVE";
  session.context.activeApplicationId = "mybrandos";
  session.context.activeContext = contextStubForTarget("video") ?? undefined;
  const withSession = resolveObjectiveFromText({
    text: "Continue",
    registry,
    sessions: [session],
  });
  assert.equal(withSession.ok, true);
  if (!withSession.ok) return;
  assert.ok(withSession.routes.some((item) => item.appId === "mybrandos" && item.availability === "AVAILABLE"));
});

test("missing context yields CONTEXT_REQUIRED instead of hallucinating", () => {
  const registry = seedApplicationCatalog();
  const discovered = discoverObjectiveRoutes({
    objective: { type: "edit", target: "this" },
    registry,
    selectedObject: null,
  });
  assert.equal(discovered.ok, true);
  if (!discovered.ok) return;
  assert.ok(discovered.routes.some((item) => item.availability === "CONTEXT_REQUIRED"));
});

test("suggestions are deterministic from current state", () => {
  const registry = seedApplicationCatalog();
  const suggestions = suggestObjectives({ registry, selectedObject: null, sessions: [] });
  assert.ok(suggestions.some((item) => item.objective.type === "create"));
  assert.ok(suggestions.some((item) => item.objective.type === "continue"));
});

test("doctrine: objective is not intent, auth, capability, or workflow ownership", () => {
  assert.equal(objectiveDoesNotGrantAuthorization(), true);
  assert.equal(objectiveDoesNotGrantCapability(), true);
  assert.equal(objectiveIsNotIntent(), true);
  assert.equal(shellDoesNotOwnWorkflowExecution(), true);
});
