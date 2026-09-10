import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAvailability, defaultOriginPolicy, MANIFEST_SCHEMA } from "@osshell/contract";
import { ClientGrantStore, mediateCapability, nativeLaunch, planLoad, resolveNavigation } from "../src/index.ts";

test("Class A cannot receive capabilities", () => {
  const outcome = mediateCapability({
    appClass: "web",
    capability: "commerce.checkout",
    origin: "https://example.com",
    grants: [],
  });
  assert.equal("status" in outcome && outcome.status === "class_a_blocked", true);
});

test("compatible app without a grant needs an explicit permission", () => {
  const outcome = mediateCapability({
    appClass: "compatible",
    capability: "commerce.checkout",
    origin: "https://app.example",
    grants: [],
  });
  assert.equal(outcome.status, "needs_permission");
});

test("grant plus FundzMan-owned execution is authorized, not paid", () => {
  const outcome = mediateCapability({
    appClass: "compatible",
    capability: "commerce.checkout",
    origin: "https://app.example",
    grants: [],
    grantedThisRequest: true,
    availability: defaultAvailability(),
  });
  assert.equal(outcome.status, "granted");
  if (outcome.status !== "needs_permission") {
    assert.notEqual(outcome.reason, "paid");
    assert.match(outcome.detail, /FundzMan/);
  }
});

test("compatible apps cannot obtain digitallife.context", () => {
  const outcome = mediateCapability({
    appClass: "compatible",
    capability: "digitallife.context",
    origin: "https://app.example",
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "denied");
});

test("native digitallife.context grant is least-privilege presence, not ownership", () => {
  const outcome = mediateCapability({
    appClass: "native",
    capability: "digitallife.context",
    origin: "http://127.0.0.1:5176",
    grants: [],
    grantedThisRequest: true,
    appName: "mybrandOS",
  });
  assert.equal(outcome.status, "granted");
  if (outcome.status === "granted") {
    assert.equal(outcome.context?.digitalLifeRef, "present");
    assert.equal(outcome.context?.userRef, null);
    assert.deepEqual(outcome.context?.assetIds, []);
    assert.deepEqual(outcome.context?.projectIds, []);
    assert.equal(outcome.context?.brandSlug, null);
    assert.equal(JSON.stringify(outcome.context).includes("token"), false);
    assert.equal(outcome.context?.activeApplication?.origin, "http://127.0.0.1:5176");
  }
});

test("allow_all is denied", () => {
  const outcome = mediateCapability({
    appClass: "native",
    capability: "allow_all",
    origin: "http://127.0.0.1:5176",
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "denied");
});

test("production and device bridge capabilities stay outside the Shell", () => {
  for (const capability of ["production.start", "live.go", "device.bridge.pair"]) {
    const outcome = mediateCapability({
      appClass: "native",
      capability,
      origin: "http://127.0.0.1:5176",
      grants: [],
      grantedThisRequest: true,
    });
    assert.equal(outcome.status, "denied");
  }
});

test("native mybrandOS launch stays on the first-party origin and does not add tokens", () => {
  const launch = nativeLaunch("mybrandos");
  assert.equal("href" in launch, true);
  if ("href" in launch) {
    assert.equal(launch.origin, "http://127.0.0.1:5176");
    assert.equal(launch.href.includes("trustId="), false);
    assert.equal(launch.href.includes("token="), false);
    assert.equal(launch.mode, "embed");
  }
});

test("LifeOS native launch is a first-party origin", () => {
  const launch = nativeLaunch("lifeos");
  assert.equal("href" in launch, true);
  if ("href" in launch) {
    assert.equal(launch.origin, "http://127.0.0.1:5174");
    assert.equal(launch.reason, "native_launch");
  }
});

test("client grant store refuses secret-bearing records", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const store = new ClientGrantStore(storage);
  assert.throws(() =>
    store.save([{ origin: "https://app.example", capability: "identity.public", scope: "", issuedAt: new Date().toISOString(), tokenHash: "abc" } as never]),
  );
});

test("resolveNavigation uses an injectable fetcher and rejects origin mismatch", async () => {
  const result = await resolveNavigation("https://app.example/path", defaultOriginPolicy(), async (url) => {
    assert.equal(String(url), "https://app.example/.well-known/os-shell.json");
    return new Response(
      JSON.stringify({
        schema: MANIFEST_SCHEMA,
        name: "App",
        version: "1",
        origin: "https://other.example",
        class: "compatible",
        embed: "allow",
        launch: "/",
        requested: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.manifest, null);
  assert.match(result.manifestError ?? "", /does not match/);
  assert.equal(result.identity.effectiveClass, "web");
});

test("planLoad does not invent an embed URL with credentials", () => {
  const decision = planLoad({
    href: "https://example.com/",
    origin: "https://example.com",
    preferEmbed: true,
  });
  assert.equal(decision.href.includes("token="), false);
});
