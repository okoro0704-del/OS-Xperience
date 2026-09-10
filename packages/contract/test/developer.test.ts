import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSimulationConfig,
  defaultOriginPolicy,
  discoverCapabilities,
  isSimulationAllowed,
  resolveAppIdentity,
  resolveApplicationTrust,
  simulateCapabilityResult,
  validateDeveloperManifest,
  developerManifestToWellKnown,
  shellError,
  buildDeveloperDiagnostics,
  createGrant,
} from "../src/index.ts";

const DEMO = "http://127.0.0.1:5185";
const EXAMPLE = "https://example.com";

test("valid developer manifest is accepted", () => {
  const result = validateDeveloperManifest(
    {
      appId: "shell-demo-notes",
      name: "Shell Demo Notes",
      version: "1.1.0",
      origin: DEMO,
      class: "compatible",
      requestedCapabilities: ["camera"],
    },
    DEMO,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.manifest.appId, "shell-demo-notes");
    const wellKnown = developerManifestToWellKnown(result.manifest);
    assert.equal(wellKnown.requested[0], "media.camera");
  }
});

test("missing fields and invalid origin are rejected", () => {
  assert.equal(validateDeveloperManifest({ name: "X" }, DEMO).ok, false);
  const mismatch = validateDeveloperManifest(
    {
      appId: "demo",
      name: "Demo",
      version: "1.0.0",
      origin: EXAMPLE,
      class: "compatible",
      requestedCapabilities: [],
    },
    DEMO,
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, "origin_mismatch");
});

test("invalid class falls back to web; unknown and duplicate capabilities fail", () => {
  const unknown = validateDeveloperManifest(
    {
      appId: "demo",
      name: "Demo",
      version: "1.0.0",
      origin: DEMO,
      class: "compatible",
      requestedCapabilities: ["telepathy"],
    },
    DEMO,
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "capability_unknown");

  const duplicate = validateDeveloperManifest(
    {
      appId: "demo",
      name: "Demo",
      version: "1.0.0",
      origin: DEMO,
      class: "compatible",
      requestedCapabilities: ["camera", "camera"],
    },
    DEMO,
  );
  assert.equal(duplicate.ok, false);

  const classA = validateDeveloperManifest(
    {
      appId: "demo",
      name: "Demo",
      version: "1.0.0",
      origin: DEMO,
      class: "A",
      requestedCapabilities: [],
    },
    DEMO,
  );
  assert.equal(classA.ok, true);
  if (classA.ok) assert.equal(classA.manifest.class, "web");
});

test("native declaration from untrusted origin stays native_unverified compatible", () => {
  const identity = resolveAppIdentity({
    href: `${EXAMPLE}/`,
    origin: EXAMPLE,
    manifest: {
      schema: "os-shell.manifest/0.1",
      name: "Pretend",
      version: "1.0.0",
      origin: EXAMPLE,
      class: "native",
      embed: "allow",
      launch: "/",
      requested: ["media.camera"],
    },
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "compatible");
  assert.equal(identity.nativeUnverified, true);
  assert.equal(resolveApplicationTrust({ origin: EXAMPLE, appClass: identity.effectiveClass, manifestPresent: true }), "REGISTERED");
});

test("demo origin is compatible by origin policy, not first-party native", () => {
  const identity = resolveAppIdentity({
    href: `${DEMO}/`,
    origin: DEMO,
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "compatible");
  assert.equal(resolveApplicationTrust({ origin: DEMO, appClass: "compatible", manifestPresent: true }), "REGISTERED");
  assert.equal(resolveApplicationTrust({ origin: "http://127.0.0.1:5176", appClass: "native", manifestPresent: false }), "FIRST_PARTY");
});

test("capability discovery stays class-aware and secret-free", () => {
  const blocked = discoverCapabilities({ appClass: "web", origin: EXAMPLE });
  assert.equal(blocked.every((item) => item.status === "class_a_blocked"), true);
  const compatible = discoverCapabilities({
    appClass: "compatible",
    origin: DEMO,
    grants: [createGrant({ origin: DEMO, capability: "media.camera" })],
  });
  const camera = compatible.find((item) => item.id === "camera");
  assert.equal(camera?.status, "granted");
  const serialized = JSON.stringify(compatible);
  assert.equal(serialized.includes("accessToken"), false);
  assert.equal(serialized.includes("FundzMan endpoint"), false);
  assert.equal(serialized.includes("privateKey"), false);
  assert.equal(Object.keys(compatible[0] ?? {}).sort().join(","), "description,id,permissionRequired,requestable,status");
});

test("simulation is localhost-only and never invents credentials", () => {
  const config = createSimulationConfig({ camera: "denied" });
  assert.equal(isSimulationAllowed("http://127.0.0.1:5180", config), true);
  assert.equal(isSimulationAllowed("https://shell.example", config), false);
  const denied = simulateCapabilityResult("camera", "denied");
  assert.equal("status" in denied && denied.status === "denied", true);
  if ("detail" in denied) assert.match(denied.detail, /SIMULATION ONLY/);
  assert.equal(JSON.stringify(denied).includes("accessToken"), false);
});

test("developer diagnostics omit secrets", () => {
  const diagnostics = buildDeveloperDiagnostics({
    application: "Shell Demo Notes",
    origin: DEMO,
    trustClass: "compatible",
    trustState: "REGISTERED",
    manifestVersion: "1.1.0",
    requested: ["camera"],
    discovery: discoverCapabilities({ appClass: "compatible", origin: DEMO }),
  });
  assert.equal(diagnostics.protocolVersion, "0.7");
  assert.equal(diagnostics.shellVersion.startsWith("2.0"), true);
  assert.equal(JSON.stringify(diagnostics).includes("privateKey"), false);
});

test("shell errors are actionable", () => {
  const error = shellError("shell_unavailable", "Not hosted", "Open inside OS Shell.");
  assert.equal(error.code, "shell_unavailable");
  assert.ok(error.actionable);
});
