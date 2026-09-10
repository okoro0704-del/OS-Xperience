import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityAuditEntry,
  capabilityDescriptor,
  createGrant,
  defaultAvailability,
  defaultOriginPolicy,
  envelope,
  hasGrant,
  jsonLeaksSecrets,
  parseTrustedMessage,
  permissionCenterRows,
  postToApp,
  resolveAppIdentity,
  revokeGrant,
  toCapabilityResult,
  upsertDecision,
} from "@osshell/contract";
import {
  ClientAuditStore,
  ClientDecisionStore,
  cancelPendingForOrigin,
  coalesceCapabilityRequest,
  interpretAppEvent,
  mediateCapability,
  takePendingRequest,
} from "../src/index.ts";

const MYBRAND = "http://127.0.0.1:5176";
const LIFEOS = "http://127.0.0.1:5174";
const GITHUB = "https://github.com";
const EXAMPLE = "https://example.com";
const source = { id: "frame" };

function boundCamera() {
  return {
    ...defaultAvailability(),
    "media.camera": { bound: true, code: "ok" as const, detail: "Browser camera is ready for this origin." },
  };
}

test("registry describes identifiers, not primitives", () => {
  const camera = capabilityDescriptor("camera");
  assert.ok(camera);
  assert.equal(camera.requestable, true);
  assert.equal(camera.availabilitySource, "browser-media");
  assert.equal(camera.mapsTo, "media.camera");
  assert.equal(capabilityDescriptor("device_bridge")?.requestable, false);
});

test("valid native camera request is granted for application-owned execution", () => {
  const outcome = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "granted");
  if (outcome.status !== "needs_permission") {
    assert.equal(toCapabilityResult(outcome).capability, "camera");
    assert.equal(outcome.capability, "camera");
  }
});

test("granted camera permission is not converted into a denial when hardware is unavailable", () => {
  const grants = [createGrant({ origin: MYBRAND, capability: "media.camera" })];
  const outcome = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants,
    availability: {
      ...defaultAvailability(),
      "media.camera": { bound: false, code: "camera_unavailable", detail: "No device has reported a ready camera." },
    },
  });
  assert.equal(outcome.status, "unavailable");
  if (outcome.status !== "needs_permission") {
    assert.equal(outcome.reason, "camera_unavailable");
    assert.notEqual(outcome.status, "denied");
  }
});

test("user denial stays capability_denied even if camera is also unavailable", () => {
  const outcome = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants: [],
    decisions: [{ origin: MYBRAND, capability: "media.camera", state: "DENIED", at: new Date().toISOString() }],
    availability: boundCamera(),
  });
  assert.equal(outcome.status, "denied");
  if (outcome.status !== "needs_permission") assert.equal(outcome.reason, "capability_denied");
});

test("granted capability result contains no secrets", () => {
  const outcome = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants: [],
    grantedThisRequest: true,
    availability: boundCamera(),
  });
  assert.equal(outcome.status, "granted");
  if (outcome.status !== "needs_permission") {
    assert.equal(toCapabilityResult(outcome).capability, "camera");
    assert.equal(jsonLeaksSecrets(outcome), false);
  }
});

test("invalid and forbidden requests are denied", () => {
  const unknown = mediateCapability({ appClass: "native", capability: "superpower", origin: MYBRAND, grants: [] });
  assert.equal(unknown.status, "denied");
  const forbidden = mediateCapability({
    appClass: "native",
    capability: "allow_all",
    origin: MYBRAND,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(forbidden.status, "denied");
});

test("payload origin, appId, and class are not authoritative", () => {
  const parsed = interpretAppEvent({
    data: envelope("capability.request", {
      capability: "camera",
      requestId: "1",
      origin: MYBRAND,
      appId: "mybrandos",
      class: "native",
    }),
    eventOrigin: EXAMPLE,
    eventSource: source,
    expectedOrigin: EXAMPLE,
    expectedSource: source,
    registered: true,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal("origin" in parsed.message, false);
    const outcome = mediateCapability({
      appClass: "web",
      capability: parsed.message.capability ?? "camera",
      origin: EXAMPLE,
      grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
    });
    assert.equal(outcome.status, "class_a_blocked");
  }
});

test("spoofed event origin and source are rejected", () => {
  const origin = interpretAppEvent({
    data: envelope("capability.request", { capability: "camera", requestId: "1" }),
    eventOrigin: EXAMPLE,
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
    registered: true,
  });
  assert.equal(origin.ok, false);
  const sourceSpoof = interpretAppEvent({
    data: envelope("capability.request", { capability: "camera", requestId: "1" }),
    eventOrigin: MYBRAND,
    eventSource: { id: "other" },
    expectedOrigin: MYBRAND,
    expectedSource: source,
    registered: true,
  });
  assert.equal(sourceSpoof.ok, false);
});

test("untrusted native declaration cannot obtain native capabilities", () => {
  const identity = resolveAppIdentity({
    href: `${EXAMPLE}/`,
    origin: EXAMPLE,
    manifest: {
      schema: "os-shell.manifest/0.1",
      name: "Pretend",
      version: "1",
      origin: EXAMPLE,
      class: "native",
      embed: "allow",
      launch: "/",
      requested: ["media.camera"],
    },
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.nativeUnverified, true);
  const outcome = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "digitallife.context",
    origin: EXAMPLE,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "denied");
});

test("grants persist, revoke immediately, and stay origin-scoped", () => {
  let grants = [createGrant({ origin: MYBRAND, capability: "media.camera" })];
  assert.equal(hasGrant(grants, MYBRAND, "media.camera"), true);
  assert.equal(hasGrant(grants, LIFEOS, "media.camera"), false);
  grants = revokeGrant(grants, MYBRAND, "media.camera");
  const after = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants,
    availability: boundCamera(),
  });
  assert.equal(after.status, "needs_permission");
});

test("LifeOS does not inherit a mybrandOS camera grant", () => {
  const grants = [createGrant({ origin: MYBRAND, capability: "media.camera" })];
  const lifeos = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: LIFEOS,
    grants,
    availability: boundCamera(),
  });
  assert.equal(lifeos.status, "needs_permission");
});

test("Class A is blocked for every privileged public capability", () => {
  for (const capability of ["identity", "assets", "camera", "commerce", "device_bridge", "live"]) {
    const outcome = mediateCapability({
      appClass: "web",
      capability,
      origin: GITHUB,
      grants: [],
      grantedThisRequest: true,
    });
    assert.equal(outcome.status, "class_a_blocked");
  }
});

test("mybrandOS and LifeOS capability matrix stays honest", () => {
  const cases = [
    ["camera", "granted"],
    ["commerce", "granted"],
    ["identity", "granted"],
    ["assets", "granted"],
    ["device_bridge", "unavailable"],
    ["live", "unavailable"],
  ] as const;
  for (const origin of [MYBRAND, LIFEOS]) {
    for (const [capability, expected] of cases) {
      const outcome = mediateCapability({
        appClass: "native",
        capability,
        origin,
        grants: [],
        grantedThisRequest: true,
      });
      assert.equal(outcome.status, expected, `${origin} ${capability}`);
    }
  }
});

test("duplicate capability requests coalesce to one prompt", () => {
  let pending = coalesceCapabilityRequest([], MYBRAND, "media.camera", "a").pending;
  const second = coalesceCapabilityRequest(pending, MYBRAND, "media.camera", "b");
  assert.equal(second.duplicate, true);
  assert.equal(second.pending.length, 1);
  assert.deepEqual(second.item.requestIds, ["a", "b"]);
  const taken = takePendingRequest(second.pending, MYBRAND, "media.camera");
  assert.deepEqual(taken.requestIds, ["a", "b"]);
  assert.equal(taken.pending.length, 0);
});

test("disconnect cancels pending requests without granting", () => {
  const pending = coalesceCapabilityRequest([], MYBRAND, "media.camera", "a").pending;
  const cancelled = cancelPendingForOrigin(pending, MYBRAND);
  assert.equal(cancelled.cancelled[0]?.requestIds[0], "a");
  assert.equal(cancelled.pending.length, 0);
});

test("token and credential keys are rejected on privileged requests", () => {
  for (const extra of [{ token: "x" }, { accessToken: "x" }, { refreshToken: "x" }, { authorization: "Bearer x" }, { privateKey: "k" }, { secret: "s" }, { credential: "c" }]) {
    const parsed = parseTrustedMessage({
      data: { ...envelope("capability.request", { capability: "camera", requestId: "1" }), ...extra },
      eventOrigin: MYBRAND,
      eventSource: source,
      expectedOrigin: MYBRAND,
      expectedSource: source,
    });
    assert.equal(parsed.ok, false, JSON.stringify(extra));
    if (!parsed.ok) assert.equal(parsed.code, "secret_payload");
  }
});

test("wildcard privileged postMessage is rejected", () => {
  const result = postToApp({ postMessage() {} }, "*", {
    channel: "os-shell",
    version: "0.7",
    type: "capability.result",
    requestId: "1",
    outcome: { capability: "camera", status: "granted", detail: "no" },
  });
  assert.equal(result.ok, false);
});

test("audit records metadata only", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const store = new ClientAuditStore(storage);
  store.append(
    capabilityAuditEntry({
      origin: MYBRAND,
      appId: "mybrandos",
      capability: "camera",
      decision: "grant",
      result: "ok",
      availability: "ok",
    }),
  );
  const loaded = store.load();
  assert.equal(loaded[0]?.origin, MYBRAND);
  assert.equal(JSON.stringify(loaded).includes("token"), false);
  assert.equal(jsonLeaksSecrets(loaded), false);
});

test("denied decisions persist without credentials", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const store = new ClientDecisionStore(storage);
  store.save(upsertDecision([], { origin: MYBRAND, capability: "media.camera", state: "DENIED", at: new Date().toISOString() }));
  assert.equal(store.load()[0]?.state, "DENIED");
  assert.equal(jsonLeaksSecrets(store.load()), false);
});

test("permission center rows stay origin scoped and revocable only when granted", () => {
  const rows = permissionCenterRows({
    origin: MYBRAND,
    appClass: "native",
    grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
    requested: ["media.camera"],
  });
  const camera = rows.find((row) => row.capability === "camera");
  const live = rows.find((row) => row.capability === "live");
  const commerce = rows.find((row) => row.capability === "commerce");
  assert.equal(camera?.status, "GRANTED");
  assert.equal(camera?.reason, undefined);
  assert.equal(camera?.revocable, true);
  assert.equal(live?.status, "UNAVAILABLE");
  assert.equal(live?.revocable, false);
  assert.equal(commerce?.status, "NOT_REQUESTED");
});
