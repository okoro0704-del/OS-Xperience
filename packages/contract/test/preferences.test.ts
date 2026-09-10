import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PREFERENCES_CONTRACT_VERSION,
  applyPreferenceRanking,
  clearApplicationPreference,
  clearAllApplicationPreferences,
  groupRoutesByPreference,
  lookupApplicationPreference,
  parseApplicationPreferences,
  preferenceDoesNotGrantAuthorization,
  preferenceDoesNotGrantCapability,
  preferenceDoesNotImplyOwnership,
  preferenceIsNotCredential,
  preferencesToDefaultHandlerAppIds,
  rememberRecentSuccess,
  resolveObjectiveFromText,
  seedApplicationCatalog,
  setApplicationPreference,
  validateApplicationPreference,
} from "../src/index.ts";

test("preferences contract version is 1.8", () => {
  assert.equal(PREFERENCES_CONTRACT_VERSION, "1.8");
});

test("preference validation rejects secrets and accepts explicit preference", () => {
  const ok = validateApplicationPreference({
    appId: "mybrandos",
    objectiveType: "edit",
    objectType: "video",
    source: "EXPLICIT",
    preference: "preferred",
  });
  assert.equal(ok.ok, true);
  assert.equal(validateApplicationPreference({ appId: "x", objectiveType: "edit", token: "nope" }).ok, false);
  assert.equal(validateApplicationPreference({ appId: "!!!", objectiveType: "edit" }).ok, false);
});

test("explicit preference outranks recent success", () => {
  let list = setApplicationPreference([], {
    appId: "shell-demo-notes",
    objectiveType: "edit",
    objectType: "text",
    preference: "preferred",
    source: "RECENT_SUCCESS",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  list = setApplicationPreference(list, {
    appId: "mybrandos",
    objectiveType: "edit",
    objectType: "text",
    preference: "preferred",
    source: "EXPLICIT",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  const hit = lookupApplicationPreference(list, { objectiveType: "edit", objectType: "text" });
  assert.equal(hit?.appId, "mybrandos");
  assert.equal(hit?.source, "EXPLICIT");
  const map = preferencesToDefaultHandlerAppIds(list);
  assert.equal(map["edit:text"], "mybrandos");
});

test("clear preference returns routing to defaults", () => {
  const list = setApplicationPreference([], {
    appId: "mybrandos",
    objectiveType: "create",
    objectType: "video",
    preference: "preferred",
    source: "EXPLICIT",
    updatedAt: new Date().toISOString(),
  });
  const cleared = clearApplicationPreference(list, { objectiveType: "create", objectType: "video" });
  assert.equal(cleared.length, 0);
  assert.equal(clearAllApplicationPreferences().length, 0);
});

test("rememberRecentSuccess does not overwrite explicit preference", () => {
  const explicit = setApplicationPreference([], {
    appId: "mybrandos",
    objectiveType: "create",
    objectType: "note",
    preference: "preferred",
    source: "EXPLICIT",
    updatedAt: new Date().toISOString(),
  });
  const next = rememberRecentSuccess(explicit, {
    appId: "shell-demo-notes",
    objectiveType: "create",
    objectType: "note",
  });
  assert.equal(lookupApplicationPreference(next, { objectiveType: "create", objectType: "note" })?.appId, "mybrandos");
});

test("preferred unavailable app does not silently win", () => {
  const preferences = setApplicationPreference([], {
    appId: "mybrandos",
    objectiveType: "preview",
    objectType: "software",
    preference: "preferred",
    source: "EXPLICIT",
    updatedAt: new Date().toISOString(),
  });
  const ranked = applyPreferenceRanking({
    objective: { type: "preview", target: "software" },
    preferences,
    routes: [
      {
        objective: { type: "preview", target: "software" },
        appId: "mybrandos",
        appName: "mybrandOS",
        availability: "UNAVAILABLE",
        reason: "runtime_unavailable",
        score: 40,
      },
      {
        objective: { type: "preview", target: "software" },
        appId: "shell-demo-notes",
        appName: "Demo Notes",
        availability: "AVAILABLE",
        score: 30,
      },
    ],
  });
  assert.equal(ranked[0]?.appId, "shell-demo-notes");
  assert.ok(ranked.find((item) => item.appId === "mybrandos")?.preferenceReason?.includes("Preferred"));
});

test("Create Video prefers mybrandOS when explicit preference set", () => {
  const registry = seedApplicationCatalog();
  const preferences = setApplicationPreference([], {
    appId: "mybrandos",
    objectiveType: "create",
    objectType: "video",
    preference: "preferred",
    source: "EXPLICIT",
    updatedAt: new Date().toISOString(),
  });
  const resolved = resolveObjectiveFromText({
    text: "Create video",
    registry,
    preferences,
  });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.routes[0]?.appId, "mybrandos");
  assert.equal(resolved.routes[0]?.preferenceSource, "EXPLICIT");
});

test("groupRoutesByPreference separates recommended and others", () => {
  const grouped = groupRoutesByPreference([
    {
      objective: { type: "edit", target: "text" },
      appId: "shell-demo-notes",
      appName: "Demo Notes",
      availability: "AVAILABLE",
      preferenceSource: "EXPLICIT",
      preferenceReason: "Your preferred app for this objective.",
      score: 90,
    },
    {
      objective: { type: "edit", target: "text" },
      appId: "mybrandos",
      appName: "mybrandOS",
      availability: "AVAILABLE",
      score: 40,
    },
  ]);
  assert.equal(grouped.recommended[0]?.appId, "shell-demo-notes");
  assert.equal(grouped.others[0]?.appId, "mybrandos");
});

test("parse rejects secret-bearing preference lists", () => {
  assert.deepEqual(parseApplicationPreferences([{ appId: "x", objectiveType: "edit", accessToken: "t" }]), []);
});

test("doctrine: preference is not auth, capability, credential, or ownership", () => {
  assert.equal(preferenceDoesNotGrantAuthorization(), true);
  assert.equal(preferenceDoesNotGrantCapability(), true);
  assert.equal(preferenceIsNotCredential(), true);
  assert.equal(preferenceDoesNotImplyOwnership(), true);
});
