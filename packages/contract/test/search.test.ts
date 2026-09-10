import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SEARCH_CONTRACT_VERSION,
  SEARCH_LIMITS,
  createContextReference,
  defaultSearchSeedsFor,
  discoveryDoesNotEqualExecution,
  executeShellSearch,
  groupSearchResults,
  mergeAndRankSearchResults,
  searchDoesNotGrantAuthorization,
  searchDoesNotGrantCapability,
  searchResultActions,
  searchResultDoesNotImplyOwnership,
  searchShellOwned,
  seedApplicationCatalog,
  validateSearchProviderDeclaration,
  validateSearchQuery,
  validateSearchResult,
  validateSearchResults,
} from "../src/index.ts";

test("search contract version is 1.6", () => {
  assert.equal(SEARCH_CONTRACT_VERSION, "1.6");
});

test("query validation accepts scoped queries and rejects secrets or oversized input", () => {
  assert.equal(validateSearchQuery({ query: "video", scope: "objects", limit: 10 }).ok, true);
  assert.equal(validateSearchQuery({ query: "" }).ok, true);
  assert.equal(validateSearchQuery({ query: "x".repeat(SEARCH_LIMITS.maxQuery + 1) }).ok, false);
  assert.equal(validateSearchQuery({ query: "ok", accessToken: "secret" }).ok, false);
  assert.equal(validateSearchQuery({ query: "ok", types: ["nope"] }).ok, false);
  assert.equal(validateSearchQuery("bad").ok, false);
});

test("result validation requires references for objects and rejects forbidden payloads", () => {
  const object = validateSearchResult({
    type: "object",
    title: "Example Video",
    appId: "mybrandos",
    context: { type: "asset", id: "v1", title: "Example Video", originAppId: "mybrandos" },
  });
  assert.equal(object.ok, true);
  assert.equal(validateSearchResult({ type: "object", title: "Missing context" }).ok, false);
  assert.equal(validateSearchResult({ type: "application", title: "Notes" }).ok, false);
  assert.equal(
    validateSearchResult({
      type: "application",
      title: "Notes",
      appId: "shell-demo-notes",
      accessToken: "nope",
    }).ok,
    false,
  );
  assert.equal(validateSearchResults([{ type: "action", title: "Edit", action: "edit" }]).ok, true);
  assert.equal(validateSearchResults(Array.from({ length: SEARCH_LIMITS.maxPerProvider + 1 }, () => ({
    type: "application",
    title: "App",
    appId: "lifeos",
  }))).ok, false);
});

test("provider declaration is optional and validated when present", () => {
  assert.equal(validateSearchProviderDeclaration(undefined).ok, true);
  assert.equal(validateSearchProviderDeclaration({ supportedTypes: ["object", "text"] }).ok, true);
  assert.equal(validateSearchProviderDeclaration({ supportedTypes: ["secret_db"] }).ok, false);
});

test("shell-owned search finds applications and actions without owning app data", () => {
  const registry = seedApplicationCatalog();
  const apps = searchShellOwned({
    query: { query: "Shell Demo Notes", scope: "applications" },
    registry,
  });
  assert.ok(apps.some((item) => item.appId === "shell-demo-notes" && item.type === "application"));

  const brand = searchShellOwned({
    query: { query: "mybrandOS", scope: "applications" },
    registry,
  });
  assert.ok(brand.some((item) => item.appId === "mybrandos"));

  const object = createContextReference({
    type: "asset",
    id: "example-video",
    title: "Example Video",
    subtype: "VIDEO",
    originAppId: "mybrandos",
    metadata: { assetType: "VIDEO" },
  });
  assert.equal(object.ok, true);
  if (!object.ok) return;
  const actions = searchShellOwned({
    query: { query: "edit", scope: "actions" },
    registry,
    selectedObject: object.context,
    searchContext: { currentObjectType: "asset" },
  });
  assert.ok(actions.some((item) => item.type === "action" && item.action === "edit"));
});

test("three-application federated search normalizes LifeOS, mybrandOS, and Demo Notes", () => {
  const registry = seedApplicationCatalog();
  const executed = executeShellSearch({
    query: { query: "Example", scope: "all" },
    registry,
  });
  assert.equal(executed.ok, true);
  if (!executed.ok) return;
  assert.equal(executed.grantsAuthorization, false);
  assert.equal(executed.grantsCapability, false);
  const appIds = new Set(executed.results.map((item) => item.appId).filter(Boolean));
  assert.ok(appIds.has("lifeos"));
  assert.ok(appIds.has("mybrandos"));
  assert.ok(appIds.has("shell-demo-notes"));
  const grouped = groupSearchResults(executed.results);
  assert.ok(grouped.objects.length >= 3);
  assert.ok(executed.providers.every((item) => item.state === "SEARCH_AVAILABLE" || item.state === "SEARCH_UNAVAILABLE"));
});

test("provider unavailable and timeout states still allow partial results", () => {
  const registry = seedApplicationCatalog();
  const executed = executeShellSearch({
    query: { query: "Example", types: ["object"] },
    registry,
    liveProviderResults: defaultSearchSeedsFor("lifeos"),
    providerStatuses: [
      { appId: "shell-demo-notes", state: "SEARCH_UNAVAILABLE", detail: "provider_timeout" },
      { appId: "mybrandos", state: "SEARCH_AVAILABLE" },
    ],
  });
  assert.equal(executed.ok, true);
  if (!executed.ok) return;
  assert.ok(executed.results.some((item) => item.appId === "lifeos"));
  assert.ok(executed.providers.some((item) => item.appId === "shell-demo-notes" && item.state === "SEARCH_UNAVAILABLE"));
  assert.ok(!executed.results.some((item) => item.title === "Forged Secret"));
});

test("malformed and forged provider results are rejected", () => {
  assert.equal(
    validateSearchResult({
      type: "object",
      title: "Leak",
      appId: "forged",
      context: { type: "asset", id: "x", token: "abc" },
    }).ok,
    false,
  );
  assert.equal(
    validateSearchResult({
      type: "object",
      title: "Forged",
      appId: "!!!",
      context: { type: "asset", id: "x" },
    }).ok,
    false,
  );
});

test("ranking prefers exact application names then titles", () => {
  const ranked = mergeAndRankSearchResults({
    shellResults: [
      { type: "application", title: "Shell Demo Notes", appId: "shell-demo-notes", score: 120 },
      { type: "object", title: "notes from meeting", appId: "lifeos", score: 40 },
    ],
    providerResults: [{ type: "object", title: "Meeting Notes", appId: "shell-demo-notes", score: 80 }],
    searchContext: { currentApplication: "shell-demo-notes" },
  });
  assert.equal(ranked[0]?.title, "Shell Demo Notes");
});

test("search result routing uses existing action discovery", () => {
  const registry = seedApplicationCatalog();
  const video = defaultSearchSeedsFor("mybrandos")[0]!;
  const actions = searchResultActions(video, registry);
  assert.ok(actions.some((item) => item.action === "edit" || item.action === "view"));
  const appActions = searchResultActions(
    { type: "application", title: "LifeOS", appId: "lifeos" },
    registry,
  );
  assert.deepEqual(appActions.map((item) => item.action), ["open"]);
});

test("doctrine: search does not grant auth, capability, ownership, or execution", () => {
  assert.equal(searchDoesNotGrantAuthorization(), true);
  assert.equal(searchDoesNotGrantCapability(), true);
  assert.equal(searchResultDoesNotImplyOwnership(), true);
  assert.equal(discoveryDoesNotEqualExecution(), true);
});

test("seeds never expose credentials or raw storage", () => {
  for (const appId of ["lifeos", "mybrandos", "shell-demo-notes"] as const) {
    for (const item of defaultSearchSeedsFor(appId)) {
      const validated = validateSearchResult(item);
      assert.equal(validated.ok, true);
      const blob = JSON.stringify(item);
      assert.equal(/accessToken|kms|credential|password|secret/i.test(blob), false);
    }
  }
});
