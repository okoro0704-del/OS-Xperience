import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeCameraCapability,
  jsonLeaksCapabilityHandles,
  jsonLeaksSecrets,
  policyAllowsExecution,
  releaseCameraStream,
  translateBrowserCameraError,
} from "../src/index.ts";

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { getTracks: () => tracks, tracks };
}

test("camera execution is skipped when Shell policy did not grant", async () => {
  let called = false;
  const result = await executeCameraCapability({
    policyStatus: "denied",
    capture: async () => {
      called = true;
      return fakeStream();
    },
  });
  assert.equal(called, false);
  assert.equal(result.stream, null);
  assert.equal(result.execution.started, false);
  assert.equal(result.execution.status, "not_authorized");
  assert.equal(result.execution.owner, "application");
  assert.equal(policyAllowsExecution("denied"), false);
});

test("granted policy lets the application own the capture result", async () => {
  const stream = fakeStream();
  const result = await executeCameraCapability({
    policyStatus: "granted",
    capture: async () => stream,
  });
  assert.equal(result.stream, stream);
  assert.equal(result.execution.status, "success");
  assert.equal(result.execution.started, true);
  assert.equal(result.execution.owner, "application");
  assert.equal(policyAllowsExecution("granted"), true);
});

test("browser camera rejection is an execution failure, not a Shell denial rewrite", async () => {
  const result = await executeCameraCapability({
    policyStatus: "granted",
    capture: async () => {
      const error = new Error("blocked");
      error.name = "NotAllowedError";
      throw error;
    },
  });
  assert.equal(result.stream, null);
  assert.equal(result.execution.status, "failed");
  assert.equal(result.execution.reason, "NotAllowedError");
  assert.equal(result.execution.owner, "application");
});

test("missing hardware is camera_unavailable at execution, not capability_denied", async () => {
  const result = await executeCameraCapability({
    policyStatus: "granted",
    capture: async () => {
      const error = new Error("none");
      error.name = "NotFoundError";
      throw error;
    },
  });
  assert.equal(result.execution.reason, "NotFoundError");
  assert.notEqual(result.execution.reason, "capability_denied");
});

test("application release stops tracks and does not leave a Shell-owned stream", () => {
  const stream = fakeStream();
  const released = releaseCameraStream(stream);
  assert.equal(stream.tracks[0]?.stopped, true);
  assert.equal(released.status, "released");
  assert.equal(released.owner, "application");
});

test("browser error names stay distinct", () => {
  assert.equal(translateBrowserCameraError({ name: "NotReadableError" }), "NotReadableError");
  assert.equal(translateBrowserCameraError({ name: "OverconstrainedError" }), "OverconstrainedError");
  assert.equal(translateBrowserCameraError({ name: "SecurityError" }), "SecurityError");
});

test("execution metadata must not carry streams or credentials", () => {
  assert.equal(jsonLeaksCapabilityHandles({ capability: "camera", executionResult: "success" }), false);
  assert.equal(jsonLeaksCapabilityHandles({ stream: {} }), true);
  assert.equal(jsonLeaksCapabilityHandles({ mediaStream: {} }), true);
  assert.equal(jsonLeaksSecrets({ executionResult: "success", origin: "http://127.0.0.1:5176" }), false);
});
