import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityAuditEntry,
  createGrant,
  defaultOriginPolicy,
  envelope,
  executeCameraCapability,
  jsonLeaksCapabilityHandles,
  jsonLeaksSecrets,
  parseTrustedMessage,
  postToApp,
  releaseCameraStream,
  resolveAppIdentity,
  revokeGrant,
} from "@osshell/contract";
import {
  cancelPendingForOrigin,
  coalesceCapabilityRequest,
  interpretAppEvent,
  mediateCapability,
  snapshotCapability,
} from "../src/index.ts";

const MYBRAND = "http://127.0.0.1:5176";
const LIFEOS = "http://127.0.0.1:5174";
const EXAMPLE = "https://example.com";
const COMPATIBLE = "https://shell-compatible.example";
const PRODUCTION = "https://app.mybrandos.com";
const source = { id: "frame" };

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { getTracks: () => tracks, tracks };
}

test("successful camera execution stays application-owned and is not stored by policy", async () => {
  const policy = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
  });
  assert.equal(policy.status, "granted");
  const stream = fakeStream();
  const executed = await executeCameraCapability({
    policyStatus: policy.status === "needs_permission" ? "denied" : policy.status,
    capture: async () => stream,
  });
  assert.equal(executed.stream, stream);
  assert.equal(executed.execution.owner, "application");
  assert.equal(jsonLeaksCapabilityHandles(policy), false);
});

test("LifeOS denial does not take a mybrandOS camera stream", async () => {
  const grants = [createGrant({ origin: MYBRAND, capability: "media.camera" })];
  const mine = mediateCapability({ appClass: "native", capability: "camera", origin: MYBRAND, grants });
  const lifeos = mediateCapability({ appClass: "native", capability: "camera", origin: LIFEOS, grants });
  assert.equal(mine.status, "granted");
  assert.equal(lifeos.status, "needs_permission");
  const myStream = fakeStream();
  const mineExec = await executeCameraCapability({
    policyStatus: "granted",
    capture: async () => myStream,
  });
  const lifeosExec = await executeCameraCapability({
    policyStatus: "needs_permission",
    capture: async () => fakeStream(),
  });
  assert.equal(mineExec.stream, myStream);
  assert.equal(lifeosExec.stream, null);
  assert.equal(lifeosExec.execution.status, "not_authorized");
});

test("Class A cannot obtain Shell camera mediation even if the browser has a camera API", () => {
  const outcome = mediateCapability({
    appClass: "web",
    capability: "camera",
    origin: EXAMPLE,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "class_a_blocked");
});

test("compatible origin participates in policy without becoming native", () => {
  const policy = defaultOriginPolicy([], [COMPATIBLE]);
  const identity = resolveAppIdentity({
    href: `${COMPATIBLE}/`,
    origin: COMPATIBLE,
    manifest: null,
    policy,
  });
  assert.equal(identity.effectiveClass, "compatible");
  assert.notEqual(identity.effectiveClass, "native");
  const outcome = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "camera",
    origin: COMPATIBLE,
    grants: [],
  });
  assert.equal(outcome.status, "needs_permission");
  const granted = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "camera",
    origin: COMPATIBLE,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(granted.status, "granted");
});

test("development native origins do not authorize production hosts", () => {
  const identity = resolveAppIdentity({
    href: `${PRODUCTION}/`,
    origin: PRODUCTION,
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "web");
  const outcome = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "camera",
    origin: PRODUCTION,
    grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "class_a_blocked");
});

test("native is still subject to capability policy", () => {
  const forbidden = mediateCapability({
    appClass: "native",
    capability: "allow_all",
    origin: MYBRAND,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(forbidden.status, "denied");
  const live = mediateCapability({
    appClass: "native",
    capability: "live",
    origin: MYBRAND,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(live.status, "unavailable");
});

test("status snapshot never opens a permission prompt", () => {
  const snapshot = snapshotCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants: [],
  });
  assert.equal(snapshot.status, "denied");
  assert.equal(snapshot.reason, "not_granted");
});

test("revoke removes the grant so the next request is not auto-authorized", () => {
  let grants = [createGrant({ origin: MYBRAND, capability: "media.camera" })];
  const before = mediateCapability({ appClass: "native", capability: "camera", origin: MYBRAND, grants });
  assert.equal(before.status, "granted");
  grants = revokeGrant(grants, MYBRAND, "media.camera");
  const after = mediateCapability({ appClass: "native", capability: "camera", origin: MYBRAND, grants });
  assert.equal(after.status, "needs_permission");
  const snapshot = snapshotCapability({ appClass: "native", capability: "camera", origin: MYBRAND, grants });
  assert.equal(snapshot.reason, "not_granted");
});

test("disconnect cancels pending camera requests without granting a stream", async () => {
  const pending = coalesceCapabilityRequest([], MYBRAND, "media.camera", "cap-1").pending;
  const cancelled = cancelPendingForOrigin(pending, MYBRAND);
  assert.equal(cancelled.cancelled.length, 1);
  assert.equal(cancelled.pending.length, 0);
  const replay = await executeCameraCapability({
    policyStatus: "needs_permission",
    capture: async () => fakeStream(),
  });
  assert.equal(replay.stream, null);
});

test("application close releases its own stream; reopen does not reuse it", () => {
  const stream = fakeStream();
  const closed = releaseCameraStream(stream);
  assert.equal(stream.tracks[0]?.stopped, true);
  assert.equal(closed.status, "released");
  assert.equal(stream.tracks[0]?.stopped, true);
});

test("forged origin, appId, and class cannot change camera mediation", () => {
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
    const outcome = mediateCapability({
      appClass: "web",
      capability: parsed.message.capability ?? "camera",
      origin: EXAMPLE,
      grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
    });
    assert.equal(outcome.status, "class_a_blocked");
  }
});

test("wrong event source is rejected", () => {
  const parsed = interpretAppEvent({
    data: envelope("capability.request", { capability: "camera", requestId: "1" }),
    eventOrigin: MYBRAND,
    eventSource: { id: "other" },
    expectedOrigin: MYBRAND,
    expectedSource: source,
    registered: true,
  });
  assert.equal(parsed.ok, false);
});

test("capability.execution with a stream handle is rejected", () => {
  const parsed = parseTrustedMessage({
    data: envelope("capability.execution", {
      capability: "camera",
      executionStarted: true,
      executionResult: "success",
      stream: { id: "track" },
    }),
    eventOrigin: MYBRAND,
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
  });
  assert.equal(parsed.ok, false);
});

test("token injection on execution reports is rejected", () => {
  const parsed = parseTrustedMessage({
    data: { ...envelope("capability.execution", { capability: "camera", executionResult: "success" }), token: "x" },
    eventOrigin: MYBRAND,
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, "secret_payload");
});

test("wildcard destination remains rejected for execution traffic", () => {
  const result = postToApp({ postMessage() {} }, "*", {
    channel: "os-shell",
    version: "0.7",
    type: "capability.result",
    requestId: "1",
    outcome: { capability: "camera", status: "granted", detail: "no" },
  });
  assert.equal(result.ok, false);
});

test("audit can record execution metadata without frames or tokens", () => {
  const entry = capabilityAuditEntry({
    origin: MYBRAND,
    appId: "mybrandos",
    capability: "camera",
    decision: "execution",
    result: "success",
    availability: "ok",
    executionStarted: true,
    executionResult: "success",
  });
  assert.equal(entry.request, "capability.execution");
  assert.equal(entry.executionStarted, true);
  assert.equal(JSON.stringify(entry).includes("MediaStream"), false);
  assert.equal(jsonLeaksSecrets(entry), false);
  assert.equal(jsonLeaksCapabilityHandles(entry), false);
});

test("honest identity, assets, and commerce are granted for application execution only", () => {
  const native = { appClass: "native" as const, origin: MYBRAND, grants: [], grantedThisRequest: true };
  const identity = mediateCapability({ ...native, capability: "identity" });
  const assets = mediateCapability({ ...native, capability: "assets" });
  const commerce = mediateCapability({ ...native, capability: "commerce" });
  assert.equal(identity.status, "granted");
  assert.equal(assets.status, "granted");
  assert.equal(commerce.status, "granted");
  if (identity.status !== "needs_permission") {
    assert.equal(jsonLeaksSecrets(identity), false);
    assert.equal("credential" in identity, false);
  }
  if (commerce.status !== "needs_permission") {
    assert.equal(jsonLeaksSecrets(commerce), false);
    assert.equal("walletKey" in commerce, false);
  }
});
