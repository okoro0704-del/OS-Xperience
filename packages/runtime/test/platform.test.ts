import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicationCapabilityContext,
  builtinAppRegistry,
  capabilityOwnership,
  classifyFailure,
  createGrant,
  executeCommerceCapability,
  executeIdentityCapability,
  getApplicationContext,
  jsonLeaksSecrets,
  payloadStaysOnControlPlane,
  permissionCenterRows,
} from "@osshell/contract";
import { mediateCapability } from "../src/index.ts";

const MYBRAND = "http://127.0.0.1:5176";
const LIFEOS = "http://127.0.0.1:5174";

test("capability ownership table is explicit and Shell never executes the domain", () => {
  assert.deepEqual(capabilityOwnership("camera"), {
    capability: "camera",
    policyOwner: "shell",
    executionOwner: "application",
    infrastructureOwner: "browser",
  });
  assert.deepEqual(capabilityOwnership("identity"), {
    capability: "identity",
    policyOwner: "shell",
    executionOwner: "application",
    infrastructureOwner: "trust-id",
  });
  assert.deepEqual(capabilityOwnership("commerce"), {
    capability: "commerce",
    policyOwner: "shell",
    executionOwner: "application",
    infrastructureOwner: "fundzman",
  });
  assert.equal(capabilityOwnership("device_bridge")?.executionOwner, "mybrandos");
  assert.equal(capabilityOwnership("live")?.infrastructureOwner, "mybrandos");
});

test("granted identity is authorization, not authentication, and carries no credential", async () => {
  const policy = mediateCapability({
    appClass: "native",
    capability: "identity",
    origin: LIFEOS,
    grants: [createGrant({ origin: LIFEOS, capability: "identity.public" })],
  });
  assert.equal(policy.status, "granted");
  const executed = await executeIdentityCapability({
    policyStatus: "granted",
    authenticate: async () => ({ status: "authentication_required" }),
  });
  assert.equal("credential" in executed, false);
  assert.equal(executed.execution.reason, "authentication_required");
  assert.equal(executed.execution.owner, "application");
  assert.equal(jsonLeaksSecrets(executed), false);
  assert.equal(classifyFailure("authentication_required"), "execution");
  assert.equal(classifyFailure("identity_unavailable"), "infrastructure");
  assert.equal(classifyFailure("capability_denied"), "policy");
});

test("denied identity never starts Trust ID", async () => {
  let called = false;
  const executed = await executeIdentityCapability({
    policyStatus: "denied",
    authenticate: async () => {
      called = true;
      return { status: "handoff" };
    },
  });
  assert.equal(called, false);
  assert.equal(executed.execution.status, "not_authorized");
  assert.equal("credential" in executed, false);
});

test("granted commerce is authorization, not payment, and carries no financial secret", async () => {
  const policy = mediateCapability({
    appClass: "native",
    capability: "commerce",
    origin: LIFEOS,
    grants: [createGrant({ origin: LIFEOS, capability: "commerce.checkout" })],
  });
  assert.equal(policy.status, "granted");
  const executed = await executeCommerceCapability({
    policyStatus: "granted",
    checkout: async () => ({ status: "payments_unavailable" }),
  });
  assert.equal("payment" in executed, false);
  assert.equal(executed.execution.reason, "payments_unavailable");
  assert.equal(classifyFailure("payments_unavailable"), "infrastructure");
  assert.equal(jsonLeaksSecrets(executed), false);
});

test("capability context is origin-scoped and credential-free", () => {
  const context = applicationCapabilityContext({
    appId: "lifeos",
    origin: LIFEOS,
    capability: "identity",
    status: "granted",
    scope: "public-display-name",
  });
  assert.equal(context.appId, "lifeos");
  assert.equal(JSON.stringify(context).includes("token"), false);
});

test("applications cannot see each other's grants", () => {
  const grants = [
    createGrant({ origin: MYBRAND, capability: "media.camera" }),
    createGrant({ origin: LIFEOS, capability: "identity.public" }),
  ];
  const mine = getApplicationContext({
    origin: MYBRAND,
    name: "mybrandOS",
    class: "native",
    version: null,
    kind: "application",
    lifecycle: "ACTIVE",
    requested: ["media.camera"],
    grants,
  });
  const life = getApplicationContext({
    origin: LIFEOS,
    name: "LifeOS",
    class: "native",
    version: null,
    kind: "application",
    lifecycle: "BACKGROUND",
    requested: ["identity.public"],
    grants,
  });
  assert.equal(mine.permissions.every((item) => item.origin === MYBRAND), true);
  assert.equal(life.permissions.every((item) => item.origin === LIFEOS), true);
  assert.equal(mine.granted.includes("identity.public"), false);
  assert.equal(life.granted.includes("media.camera"), false);
});

test("Permission Center labels stay user-facing and isolated", () => {
  const rows = permissionCenterRows({
    origin: MYBRAND,
    appClass: "native",
    grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
    requested: ["media.camera", "identity"],
    decisions: [{ origin: LIFEOS, capability: "media.camera", state: "DENIED", at: new Date().toISOString() }],
  });
  assert.equal(rows.find((row) => row.capability === "camera")?.display, "Granted");
  assert.equal(rows.find((row) => row.capability === "identity")?.display, "Available");
  assert.equal(rows.find((row) => row.capability === "device_bridge")?.display, "Unavailable");
  const lifeos = permissionCenterRows({
    origin: LIFEOS,
    appClass: "native",
    grants: [],
    requested: ["camera"],
    decisions: [{ origin: LIFEOS, capability: "media.camera", state: "DENIED", at: new Date().toISOString() }],
  });
  assert.equal(lifeos.find((row) => row.capability === "camera")?.display, "Denied");
});

test("registry lists first-party apps and allowed capabilities, not internals", () => {
  const registry = builtinAppRegistry();
  assert.deepEqual(registry.map((item) => item.id).sort(), ["lifeos", "mybrandos", "shell-demo-notes"]);
  assert.equal(registry.every((item) => item.allowedCapabilities.includes("camera")), true);
  assert.equal(JSON.stringify(registry).includes("database"), false);
  assert.equal(JSON.stringify(registry).includes("apiKey"), false);
});

test("control-plane payloads reject data-plane handles", () => {
  assert.equal(payloadStaysOnControlPlane({ capability: "camera", status: "granted" }), true);
  assert.equal(payloadStaysOnControlPlane({ stream: {} }), false);
  assert.equal(payloadStaysOnControlPlane({ token: "x" }), false);
});
