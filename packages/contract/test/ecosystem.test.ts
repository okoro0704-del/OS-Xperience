import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySameOriginUpdate,
  availableCatalogEntries,
  compareSemverLike,
  evaluateOriginChange,
  findApplicationById,
  formatApplicationDeepLink,
  parseApplicationDeepLink,
  recordFromValidatedManifest,
  removeInstalledApplication,
  resolveApplicationDeepLink,
  resolveUrlToApplication,
  seedApplicationCatalog,
  shellCompatibility,
  threeApplicationTestIds,
  updateInfoFor,
  upsertInstalledApplication,
  validateApplicationHandoff,
  validateDeveloperManifest,
  withSimulatedUpdate,
} from "../src/index.ts";

const DEMO = "http://127.0.0.1:5185";

test("seed catalog includes LifeOS, mybrandOS, and Shell Demo Notes", () => {
  const seeded = seedApplicationCatalog();
  const ids = seeded.map((item) => item.appId);
  for (const id of threeApplicationTestIds()) assert.ok(ids.includes(id));
  const demo = findApplicationById(seeded, "shell-demo-notes");
  assert.equal(demo?.source, "EXTERNAL");
  assert.equal(demo?.trustState, "REGISTERED");
  assert.equal(demo?.class, "compatible");
  assert.equal(findApplicationById(seeded, "lifeos")?.source, "FIRST_PARTY");
  assert.equal(findApplicationById(seeded, "mybrandos")?.trustState, "FIRST_PARTY");
});

test("register and remove applications without granting capabilities", () => {
  const base = seedApplicationCatalog().filter((item) => item.appId !== "shell-demo-notes");
  const validated = validateDeveloperManifest(
    {
      appId: "shell-demo-notes",
      name: "Shell Demo Notes",
      version: "1.2.0",
      origin: DEMO,
      class: "compatible",
      requestedCapabilities: ["camera"],
    },
    DEMO,
  );
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const record = recordFromValidatedManifest({
    manifest: validated.manifest,
    source: "EXTERNAL",
    effectiveClass: "compatible",
    trustState: "REGISTERED",
  });
  const installed = upsertInstalledApplication(base, record);
  assert.equal(installed.ok, true);
  if (!installed.ok) return;
  assert.equal(findApplicationById(installed.list, "shell-demo-notes")?.presence, "INSTALLED");
  const removed = removeInstalledApplication(installed.list, "shell-demo-notes");
  assert.equal(removed.removed?.appId, "shell-demo-notes");
  assert.equal(findApplicationById(removed.list, "shell-demo-notes"), null);
  assert.ok(availableCatalogEntries(removed.list).some((item) => item.appId === "shell-demo-notes"));
});

test("duplicate origin and origin-change are rejected securely", () => {
  const seeded = seedApplicationCatalog();
  const demo = findApplicationById(seeded, "shell-demo-notes")!;
  const duplicate = upsertInstalledApplication(seeded, { ...demo, appId: "other-demo" });
  assert.equal(duplicate.ok, false);
  const originChange = evaluateOriginChange({
    appId: "shell-demo-notes",
    previousOrigin: DEMO,
    nextOrigin: "https://evil.example",
  });
  assert.equal(originChange.ok, true);
  if (originChange.ok) {
    assert.equal(originChange.preserveGrants, false);
    assert.equal(originChange.preserveTrust, false);
  }
  const blocked = upsertInstalledApplication(seeded, {
    ...demo,
    origin: "https://evil.example",
    updatedAt: new Date().toISOString(),
  });
  assert.equal(blocked.ok, false);
});

test("same-origin update preserves identity", () => {
  const demo = findApplicationById(seedApplicationCatalog(), "shell-demo-notes")!;
  const updated = applySameOriginUpdate(demo, "1.2.1");
  assert.equal(updated.appId, demo.appId);
  assert.equal(updated.origin, demo.origin);
  assert.equal(updated.version, "1.2.1");
  assert.equal(updateInfoFor(withSimulatedUpdate(demo, "1.6.0")).status, "update_available");
  assert.ok(compareSemverLike("1.3.1", "1.3.0") > 0);
});

test("compatibility negotiation fails honestly", () => {
  assert.equal(shellCompatibility().supported, true);
  assert.equal(shellCompatibility().protocol, "0.7");
  const bad = shellCompatibility({ requiredProtocol: "9.9" });
  assert.equal(bad.supported, false);
  assert.match(bad.reason ?? "", /application_incompatible/);
});

test("deep links resolve only to known applications", () => {
  const registry = seedApplicationCatalog();
  const parsed = parseApplicationDeepLink("application://shell-demo-notes/notes");
  assert.equal(parsed.ok, true);
  const resolved = resolveApplicationDeepLink("application://shell-demo-notes/notes", registry);
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.origin, DEMO);
    assert.equal(resolved.path, "/notes");
  }
  assert.equal(resolveApplicationDeepLink("application://missing-app/", registry).ok, false);
  assert.equal(parseApplicationDeepLink("https://example.com").ok, false);
  assert.equal(formatApplicationDeepLink("lifeos", "/home"), "application://lifeos/home");
  assert.equal(resolveUrlToApplication(`${DEMO}/`, registry)?.appId, "shell-demo-notes");
});

test("handoff validates context and never transfers permissions", () => {
  const registry = seedApplicationCatalog();
  const ok = validateApplicationHandoff({
    sourceAppId: "shell-demo-notes",
    handoff: { targetAppId: "lifeos", route: "/library", context: { noteId: "n1" } },
    registry,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.transfersPermissions, false);
    assert.equal(ok.transfersCredentials, false);
  }
  assert.equal(
    validateApplicationHandoff({
      sourceAppId: "shell-demo-notes",
      handoff: { targetAppId: "missing", route: "/" },
      registry,
    }).ok,
    false,
  );
  assert.equal(
    validateApplicationHandoff({
      sourceAppId: "shell-demo-notes",
      handoff: { targetAppId: "lifeos", context: { accessToken: "x" } },
      registry,
    }).ok,
    false,
  );
  assert.equal(
    validateApplicationHandoff({
      sourceAppId: "shell-demo-notes",
      handoff: { targetAppId: "lifeos", permissions: ["camera"] },
      registry,
    }).ok,
    false,
  );
});
