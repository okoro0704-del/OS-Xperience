import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGrant,
  defaultAvailability,
  hasGrant,
  openLifecycle,
  resolveAppIdentity,
  defaultOriginPolicy,
  revokeGrant,
} from "@osshell/contract";
import {
  ClientGrantStore,
  applyClose,
  applyDisconnect,
  applyOpen,
  applyReady,
  contextForSession,
  interpretAppEvent,
  mediateCapability,
} from "../src/index.ts";

const MYBRAND = "http://127.0.0.1:5176";
const LIFEOS = "http://127.0.0.1:5174";
const GITHUB = "https://github.com";
const source = { id: "frame" };

test("handshake associates only with a registered application source", () => {
  const accepted = interpretAppEvent({
    data: { channel: "os-shell", version: "0.7", type: "application.ready", title: "mybrandOS", path: "/" },
    eventOrigin: MYBRAND,
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
    registered: true,
  });
  assert.equal(accepted.ok, true);
  const unknown = interpretAppEvent({
    data: { channel: "os-shell", version: "0.7", type: "application.ready" },
    eventOrigin: "https://evil.example",
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
    registered: false,
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, "application_not_registered");
});

test("camera, commerce, identity, assets, Device Bridge, and Live stay honest", () => {
  const native = { appClass: "native" as const, origin: MYBRAND, grants: [], grantedThisRequest: true };
  assert.equal(mediateCapability({ ...native, capability: "camera" }).status, "granted");
  assert.equal(mediateCapability({ ...native, capability: "commerce" }).status, "granted");
  assert.equal(mediateCapability({ ...native, capability: "identity" }).status, "granted");
  assert.equal(mediateCapability({ ...native, capability: "assets" }).status, "granted");
  const bridge = mediateCapability({ ...native, capability: "device_bridge" });
  assert.equal(bridge.status, "unavailable");
  if (bridge.status === "unavailable") assert.equal(bridge.code, "device_bridge_unavailable");
  const live = mediateCapability({ ...native, capability: "live" });
  assert.equal(live.status, "unavailable");
  if (live.status === "unavailable") assert.equal(live.code, "live_provider_unavailable");
});

test("GitHub remains Class A and cannot inherit mybrandOS camera permission", () => {
  const identity = resolveAppIdentity({
    href: `${GITHUB}/`,
    origin: GITHUB,
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "web");
  const outcome = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "camera",
    origin: GITHUB,
    grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
    grantedThisRequest: true,
  });
  assert.equal(outcome.status, "class_a_blocked");
});

test("LifeOS permission is isolated from mybrandOS permission", () => {
  const grants = [createGrant({ origin: MYBRAND, capability: "media.camera" })];
  const lifeos = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: LIFEOS,
    grants,
  });
  assert.equal(lifeos.status, "needs_permission");
  const mine = mediateCapability({
    appClass: "native",
    capability: "camera",
    origin: MYBRAND,
    grants,
    availability: defaultAvailability(),
  });
  assert.equal(mine.status, "granted");
});

test("grants persist locally and revoke without storing credentials", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const store = new ClientGrantStore(storage);
  store.save([createGrant({ origin: MYBRAND, capability: "media.camera" })]);
  const reloaded = new ClientGrantStore(storage).load();
  assert.equal(hasGrant(reloaded, MYBRAND, "media.camera"), true);
  assert.equal(JSON.stringify(reloaded).includes("token"), false);
  store.save(revokeGrant(reloaded, MYBRAND, "media.camera"));
  assert.equal(hasGrant(new ClientGrantStore(storage).load(), MYBRAND, "media.camera"), false);
});

test("disconnect will not leave an application ACTIVE", () => {
  let records = applyReady(applyOpen([], MYBRAND), MYBRAND);
  assert.equal(records[0]?.lifecycle, "ACTIVE");
  records = applyDisconnect(records, MYBRAND);
  assert.equal(records[0]?.lifecycle, "BACKGROUND");
  records = applyClose(records, MYBRAND);
  assert.equal(records.some((item) => item.origin === MYBRAND), false);
});

test("reopen walks CLOSED to OPEN to ACTIVE", () => {
  let records = applyClose(applyReady(applyOpen([], MYBRAND), MYBRAND), MYBRAND);
  records = applyOpen(records, MYBRAND);
  assert.equal(records[0]?.lifecycle, "OPEN");
  records = applyReady(records, MYBRAND);
  assert.equal(records[0]?.lifecycle, "ACTIVE");
});

test("application context for the current app does not include the other app's grants", () => {
  const identity = resolveAppIdentity({
    href: `${MYBRAND}/`,
    origin: MYBRAND,
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  const context = contextForSession({
    identity,
    grants: [
      createGrant({ origin: MYBRAND, capability: "media.camera" }),
      createGrant({ origin: LIFEOS, capability: "media.camera" }),
    ],
    requested: ["media.camera"],
    records: applyReady(applyOpen(openLifecycle([], LIFEOS), MYBRAND), MYBRAND),
  });
  assert.equal(context.permissions.every((item) => item.origin === MYBRAND), true);
  assert.equal(context.granted.includes("media.camera"), true);
});
