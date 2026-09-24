import test from "node:test";
import assert from "node:assert/strict";
import {
  compareDottedVersion,
  decideOxUpdate,
  isOxUpdateManifest,
  type OxUpdateManifest,
} from "../src/update.js";

const baseManifest = (): OxUpdateManifest => ({
  nativeVersion: "0.3.2",
  nativeBuildNumber: 10,
  runtimeVersion: "2026.09.21.1",
  minimumRuntimeVersion: "2026.09.01.0",
  minimumNativeVersion: "0.3.0",
  minimumNativeBuildNumber: 8,
  releaseId: "test-release",
  publishedAt: "2026-09-21T00:00:00.000Z",
  apkUrl: "https://example.com/OS-Xperience.apk",
  runtimeUrl: "https://xperience.getlifeos.app",
});

test("compareDottedVersion orders numeric segments", () => {
  assert.equal(compareDottedVersion("0.3.2", "0.3.1"), 1);
  assert.equal(compareDottedVersion("0.3.0", "0.3.2"), -1);
  assert.equal(compareDottedVersion("2026.09.21.1", "2026.09.21.1"), 0);
  assert.equal(compareDottedVersion("2026.09.21.2", "2026.09.21.1"), 1);
});

test("isOxUpdateManifest validates required fields", () => {
  assert.equal(isOxUpdateManifest(baseManifest()), true);
  assert.equal(isOxUpdateManifest({ nativeVersion: "1.0.0" }), false);
});

test("native below minimum requires APK update", () => {
  const decision = decideOxUpdate(
    { nativeVersion: "0.2.9", nativeBuildNumber: 7, runtimeVersion: "2026.09.21.1" },
    baseManifest(),
  );
  assert.equal(decision.kind, "native_apk");
});

test("native behind latest requires APK update even if above minimum", () => {
  const decision = decideOxUpdate(
    { nativeVersion: "0.3.1", nativeBuildNumber: 9, runtimeVersion: "2026.09.21.1" },
    baseManifest(),
  );
  assert.equal(decision.kind, "native_apk");
  assert.match(decision.reason, /native APK/i);
});

test("runtime behind with current native uses web OTA", () => {
  const decision = decideOxUpdate(
    { nativeVersion: "0.3.2", nativeBuildNumber: 10, runtimeVersion: "2026.09.20.0" },
    baseManifest(),
  );
  assert.equal(decision.kind, "web_ota");
});

test("matching versions need no update", () => {
  const decision = decideOxUpdate(
    { nativeVersion: "0.3.2", nativeBuildNumber: 10, runtimeVersion: "2026.09.21.1" },
    baseManifest(),
  );
  assert.equal(decision.kind, "none");
});
