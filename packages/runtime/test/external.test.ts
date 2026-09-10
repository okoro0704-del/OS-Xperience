import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGrant,
  createSimulationConfig,
  defaultOriginPolicy,
  discoverCapabilities,
  envelope,
  resolveAppIdentity,
  resolveApplicationTrust,
  validateDeveloperManifest,
} from "@osshell/contract";
import { interpretAppEvent, mediateCapability, snapshotCapability } from "../src/index.ts";

const DEMO = "http://127.0.0.1:5185";
const MYBRAND = "http://127.0.0.1:5176";
const EXAMPLE = "https://example.com";
const source = { id: "frame" };

test("external demo can request camera under compatible policy", () => {
  const identity = resolveAppIdentity({
    href: `${DEMO}/`,
    origin: DEMO,
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "compatible");
  const needs = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "camera",
    origin: DEMO,
    grants: [],
  });
  assert.equal(needs.status, "needs_permission");
  const granted = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "camera",
    origin: DEMO,
    grants: [createGrant({ origin: DEMO, capability: "media.camera" })],
  });
  assert.equal(granted.status, "granted");
});

test("external app grants stay isolated from mybrandOS", () => {
  const grants = [createGrant({ origin: DEMO, capability: "media.camera" })];
  assert.equal(
    mediateCapability({ appClass: "compatible", capability: "camera", origin: DEMO, grants }).status,
    "granted",
  );
  assert.equal(
    mediateCapability({ appClass: "native", capability: "camera", origin: MYBRAND, grants }).status,
    "needs_permission",
  );
});

test("Class A remains blocked for discovery and requests", () => {
  const listed = discoverCapabilities({ appClass: "web", origin: EXAMPLE });
  assert.equal(listed.every((item) => item.status === "class_a_blocked"), true);
  const outcome = mediateCapability({
    appClass: "web",
    capability: "camera",
    origin: EXAMPLE,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "class_a_blocked");
});

test("capability.discover message is accepted from registered source", () => {
  const parsed = interpretAppEvent({
    data: envelope("capability.discover", { requestId: "d1" }),
    eventOrigin: DEMO,
    eventSource: source,
    expectedOrigin: DEMO,
    expectedSource: source,
    registered: true,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.message.type, "capability.discover");
});

test("forged class and appId cannot elevate external app", () => {
  const parsed = interpretAppEvent({
    data: envelope("capability.request", {
      capability: "camera",
      requestId: "1",
      class: "native",
      appId: "mybrandos",
      origin: MYBRAND,
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

test("status snapshot does not open a prompt for external apps", () => {
  const snapshot = snapshotCapability({
    appClass: "compatible",
    capability: "camera",
    origin: DEMO,
    grants: [],
  });
  assert.equal(snapshot.reason, "not_granted");
});

test("simulation mediates contract outcomes on localhost only", () => {
  const denied = mediateCapability({
    appClass: "compatible",
    capability: "camera",
    origin: DEMO,
    grants: [createGrant({ origin: DEMO, capability: "media.camera" })],
    shellHostOrigin: "http://127.0.0.1:5180",
    simulation: createSimulationConfig({ camera: "denied" }),
  });
  assert.equal(denied.status, "denied");
  if ("detail" in denied) assert.match(denied.detail ?? "", /SIMULATION ONLY/);

  const productionHost = mediateCapability({
    appClass: "compatible",
    capability: "camera",
    origin: DEMO,
    grants: [createGrant({ origin: DEMO, capability: "media.camera" })],
    shellHostOrigin: "https://shell.example",
    simulation: createSimulationConfig({ camera: "denied" }),
  });
  assert.equal(productionHost.status, "granted");

  for (const scenario of ["granted", "unavailable", "class_a_blocked", "permission_required"] as const) {
    const outcome = mediateCapability({
      appClass: "compatible",
      capability: "camera",
      origin: DEMO,
      grants: [],
      shellHostOrigin: "http://localhost:5180",
      simulation: createSimulationConfig({ camera: scenario }),
    });
    if (scenario === "permission_required") assert.equal(outcome.status, "needs_permission");
    else assert.equal(outcome.status, scenario === "granted" ? "granted" : scenario);
  }
});

test("well-known style manifest validates for the demo origin", () => {
  const result = validateDeveloperManifest(
    {
      schema: "os-shell.manifest/0.1",
      appId: "shell-demo-notes",
      name: "Shell Demo Notes",
      version: "1.1.0",
      origin: DEMO,
      class: "compatible",
      embed: "allow",
      launch: "/",
      requestedCapabilities: ["camera"],
    },
    DEMO,
  );
  assert.equal(result.ok, true);
  assert.equal(resolveApplicationTrust({ origin: DEMO, appClass: "compatible", manifestPresent: true }), "REGISTERED");
});
