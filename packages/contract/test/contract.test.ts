import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIFEOS_PRIMITIVE_IDS,
  MANIFEST_SCHEMA,
  createGrant,
  decideLoad,
  defaultAvailability,
  defaultOriginPolicy,
  emptyDigitalLifeContext,
  grantsLeakSecrets,
  hasGrant,
  isForbiddenCapability,
  parseHttpUrl,
  parseIncomingMessage,
  parseManifest,
  resolveAppIdentity,
  revokeGrant,
  sanitizeLaunchUrl,
  urlContainsCredentialParams,
} from "../src/index.ts";

test("exactly six primitives — OS Shell is not one of them", () => {
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
  assert.deepEqual([...LIFEOS_PRIMITIVE_IDS], [
    "trust-id",
    "elfcom",
    "sovereign-drive",
    "platform-jobs",
    "master-distributor",
    "fundzman",
  ]);
  assert.equal((LIFEOS_PRIMITIVE_IDS as readonly string[]).includes("os-shell"), false);
  assert.equal((LIFEOS_PRIMITIVE_IDS as readonly string[]).includes("ai"), false);
});

test("ordinary load defaults to a new browsing context", () => {
  const decision = decideLoad({
    href: "https://example.com/",
    origin: "https://example.com",
    preferEmbed: false,
  });
  assert.equal(decision.mode, "new_context");
  assert.equal(decision.reason, "ordinary_default");
});

test("embed is denied when the manifest forbids it", () => {
  const decision = decideLoad({
    href: "https://example.com/",
    origin: "https://example.com",
    preferEmbed: true,
    manifestEmbed: "deny",
  });
  assert.equal(decision.mode, "new_context");
  assert.equal(decision.reason, "embed_denied");
});

test("user-requested embed is attempted and may later report frame_blocked", () => {
  const decision = decideLoad({
    href: "https://example.com/",
    origin: "https://example.com",
    preferEmbed: true,
  });
  assert.equal(decision.mode, "embed");
  assert.match(decision.detail, /frame_blocked/);
});

test("manifest origin must exactly match the fetch origin", () => {
  const parsed = parseManifest(
    {
      schema: MANIFEST_SCHEMA,
      name: "Spoof",
      version: "1",
      origin: "https://trusted.example",
      class: "compatible",
      embed: "allow",
      launch: "/",
      requested: ["commerce.checkout"],
    },
    "https://evil.example",
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, "origin_mismatch");
});

test("self-asserted native on an unknown origin is native_unverified compatible", () => {
  const parsed = parseManifest(
    {
      schema: MANIFEST_SCHEMA,
      name: "Pretender",
      version: "1.0.0",
      origin: "https://pretender.example",
      class: "native",
      embed: "allow",
      launch: "/",
      requested: ["digitallife.context"],
    },
    "https://pretender.example",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const identity = resolveAppIdentity({
    href: "https://pretender.example/",
    origin: "https://pretender.example",
    manifest: parsed.manifest,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "compatible");
  assert.equal(identity.nativeUnverified, true);
  assert.equal(identity.classReason, "native_unverified");
});

test("mybrandOS origin is native by policy even without a manifest", () => {
  const identity = resolveAppIdentity({
    href: "http://127.0.0.1:5176/",
    origin: "http://127.0.0.1:5176",
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "native");
  assert.equal(identity.classReason, "origin_policy");
  assert.equal(identity.name, "mybrandOS");
});

test("LifeOS origin is native by policy", () => {
  const identity = resolveAppIdentity({
    href: "http://127.0.0.1:5174/",
    origin: "http://127.0.0.1:5174",
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "native");
  assert.equal(identity.name, "LifeOS");
});

test("launch URLs drop trustId and token query params", () => {
  const dirty = "https://app.example/?trustId=TD-1&token=secret&ok=1";
  assert.equal(urlContainsCredentialParams(dirty), true);
  const clean = sanitizeLaunchUrl(dirty);
  assert.equal(urlContainsCredentialParams(clean), false);
  assert.equal(new URL(clean).searchParams.get("ok"), "1");
  assert.equal(new URL(clean).searchParams.get("trustId"), null);
});

test("forbidden capabilities cannot exist as grants", () => {
  assert.equal(isForbiddenCapability("allow_all"), true);
  assert.equal(isForbiddenCapability("super_app"), true);
  assert.equal(isForbiddenCapability("trusted_everything"), true);
  assert.equal(isForbiddenCapability("production.start"), true);
  assert.equal(isForbiddenCapability("live.go"), true);
  assert.equal(isForbiddenCapability("device.bridge.pair"), true);
  assert.equal(isForbiddenCapability("commerce.checkout"), false);
});

test("grants are origin-scoped, revocable, and contain no secrets", () => {
  const grant = createGrant({ origin: "https://app.example", capability: "commerce.checkout" });
  const grants = [grant];
  assert.equal(hasGrant(grants, "https://app.example", "commerce.checkout"), true);
  assert.equal(hasGrant(grants, "https://other.example", "commerce.checkout"), false);
  assert.equal(grantsLeakSecrets(grants), false);
  const revoked = revokeGrant(grants, "https://app.example", "commerce.checkout");
  assert.equal(hasGrant(revoked, "https://app.example", "commerce.checkout"), false);
});

test("least-privilege Digital Life context is empty", () => {
  const context = emptyDigitalLifeContext();
  assert.equal(context.brandSlug, null);
  assert.deepEqual(context.assetIds, []);
  assert.deepEqual(context.projectIds, []);
  assert.equal(JSON.stringify(context).includes("device"), false);
  assert.equal(JSON.stringify(context).includes("balance"), false);
});

test("commerce and identity policy availability are bound; FundzMan and jobs stay domain-owned", () => {
  assert.equal(defaultAvailability()["commerce.checkout"].bound, true);
  assert.equal(defaultAvailability()["commerce.checkout"].code, "ok");
  assert.equal(defaultAvailability()["identity.public"].bound, true);
  assert.equal(defaultAvailability()["jobs.dispatch"].code, "PLATFORM_JOBS_UNAVAILABLE");
});

test("camera policy availability is bound for application-owned browser execution", () => {
  assert.equal(defaultAvailability()["media.camera"].bound, true);
  assert.equal(defaultAvailability()["media.camera"].code, "ok");
});

test("production first-party hosts are not development native origins", () => {
  const identity = resolveAppIdentity({
    href: "https://app.mybrandos.com/",
    origin: "https://app.mybrandos.com",
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "web");
});

test("compatible origins are origin-policy, not unlimited native", () => {
  const identity = resolveAppIdentity({
    href: "https://shell-compatible.example/",
    origin: "https://shell-compatible.example",
    manifest: null,
    policy: defaultOriginPolicy([], ["https://shell-compatible.example"]),
  });
  assert.equal(identity.effectiveClass, "compatible");
  assert.equal(identity.classReason, "origin_policy");
});

test("postMessage from the wrong origin is dropped", () => {
  const parsed = parseIncomingMessage(
    { channel: "os-shell", type: "capability.request", capability: "commerce.checkout", requestId: "1" },
    "https://evil.example",
    "https://app.example",
  );
  assert.equal(parsed, null);
});

test("http parser rejects non-web schemes", () => {
  assert.equal(parseHttpUrl("javascript:alert(1)"), null);
  assert.equal(parseHttpUrl("file:///etc/passwd"), null);
  assert.ok(parseHttpUrl("example.com"));
});
