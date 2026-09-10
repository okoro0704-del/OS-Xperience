import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activateLifecycle,
  appKindFromClass,
  builtinAppRegistry,
  capabilityStatusSurface,
  closeLifecycle,
  confirmReady,
  contextsAreIsolated,
  createGrant,
  defaultAvailability,
  defaultOriginPolicy,
  getApplicationContext,
  jsonLeaksSecrets,
  lifecycleFor,
  openLifecycle,
  parseIncomingMessage,
  platformSupports,
  publicAppLabel,
  pushRecent,
  resolveAppIdentity,
  revokeGrant,
  sanitizeLaunchUrl,
  suspendLifecycle,
  toRecentApp,
  toggleFavorite,
} from "@osshell/contract";
import { ClientFavoriteStore, ClientRecentStore, contextForSession, mediateCapability } from "../src/index.ts";

test("lifecycle opens OPEN, ready makes ACTIVE, and backgrounds the rest", () => {
  let records = openLifecycle([], "http://127.0.0.1:5176");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5176"), "OPEN");
  records = confirmReady(records, "http://127.0.0.1:5176");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5176"), "ACTIVE");
  records = openLifecycle(records, "http://127.0.0.1:5174");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5174"), "OPEN");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5176"), "BACKGROUND");
  records = confirmReady(records, "http://127.0.0.1:5174");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5174"), "ACTIVE");
  records = activateLifecycle(records, "http://127.0.0.1:5176");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5176"), "ACTIVE");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5174"), "BACKGROUND");
  records = suspendLifecycle(records);
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5176"), "SUSPENDED");
  records = closeLifecycle(records, "http://127.0.0.1:5176");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5176"), "CLOSED");
  assert.equal(lifecycleFor(records, "http://127.0.0.1:5174"), "ACTIVE");
});

test("application context is origin-isolated", () => {
  const grants = [
    createGrant({ origin: "https://app-a.example", capability: "media.camera" }),
    createGrant({ origin: "https://app-b.example", capability: "commerce.checkout" }),
  ];
  const a = getApplicationContext({
    origin: "https://app-a.example",
    name: "A",
    class: "compatible",
    version: "1",
    kind: "application",
    lifecycle: "ACTIVE",
    requested: ["media.camera"],
    grants,
  });
  const b = getApplicationContext({
    origin: "https://app-b.example",
    name: "B",
    class: "compatible",
    version: "1",
    kind: "application",
    lifecycle: "BACKGROUND",
    requested: ["commerce.checkout"],
    grants,
  });
  assert.equal(a.granted.includes("media.camera"), true);
  assert.equal(a.granted.includes("commerce.checkout"), false);
  assert.equal(b.permissions.every((item) => item.origin === "https://app-b.example"), true);
  assert.equal(contextsAreIsolated(a, b), true);
});

test("revoking a grant removes it from application context", () => {
  const origin = "https://app-a.example";
  let grants = [createGrant({ origin, capability: "media.microphone" })];
  grants = revokeGrant(grants, origin, "media.microphone");
  const context = getApplicationContext({
    origin,
    name: "A",
    class: "compatible",
    version: null,
    kind: "application",
    lifecycle: "ACTIVE",
    requested: ["media.microphone"],
    grants,
  });
  assert.equal(context.granted.includes("media.microphone"), false);
});

test("ordinary web apps stay kind url and receive no native privileges", () => {
  const identity = resolveAppIdentity({
    href: "https://github.com/",
    origin: "https://github.com",
    manifest: null,
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "web");
  assert.equal(appKindFromClass(identity.effectiveClass), "url");
  assert.equal(publicAppLabel(identity), "Github.com");
  const context = contextForSession({
    identity,
    grants: [createGrant({ origin: "http://127.0.0.1:5176", capability: "media.camera" })],
    requested: [],
    records: openLifecycle([], identity.origin),
  });
  assert.equal(context.granted.length, 0);
  const blocked = mediateCapability({
    appClass: identity.effectiveClass,
    capability: "digitallife.context",
    origin: identity.origin,
    grants: [],
    grantedThisRequest: true,
  });
  assert.equal(blocked.status, "class_a_blocked");
});

test("capability status stays honest and never turns unavailable into ready", () => {
  const rows = capabilityStatusSurface({
    appClass: "native",
    origin: "http://127.0.0.1:5176",
    requested: ["commerce.checkout", "media.camera"],
    grants: [createGrant({ origin: "http://127.0.0.1:5176", capability: "commerce.checkout" })],
    availability: defaultAvailability(),
  });
  const commerce = rows.find((row) => row.label === "Commerce");
  const camera = rows.find((row) => row.label === "Camera");
  const devices = rows.find((row) => row.id === "devices");
  const live = rows.find((row) => row.id === "live");
  assert.equal(commerce?.state, "granted");
  assert.equal(camera?.state, "not_granted");
  assert.equal(devices?.code, "device_bridge_unavailable");
  assert.equal(live?.code, "live_provider_unavailable");
  assert.equal(rows.some((row) => row.state === "available" && row.code === "payments_unavailable"), false);
});

test("recents and favorites strip credentials and do not leak tokens", () => {
  const dirty = toRecentApp({
    origin: "https://github.com",
    href: "https://github.com/?trustId=TD-1&token=secret",
    name: "Github.com",
    class: "web",
  });
  assert.ok(dirty);
  assert.equal(dirty.href.includes("token="), false);
  assert.equal(dirty.href.includes("trustId="), false);
  assert.equal(jsonLeaksSecrets(dirty), false);
  const recents = pushRecent([], dirty);
  const favorites = toggleFavorite([], { origin: dirty.origin, name: dirty.name, class: "web", kind: "url" });
  assert.equal(favorites.some((item) => item.origin === dirty.origin), true);
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  };
  const recentStore = new ClientRecentStore(storage);
  recentStore.remember(dirty);
  const favoriteStore = new ClientFavoriteStore(storage);
  favoriteStore.toggle({ origin: dirty.origin, name: dirty.name, class: "web", kind: "url" });
  assert.equal(recentStore.load()[0]?.origin, "https://github.com");
  assert.equal(JSON.stringify(recentStore.load()).includes("secret"), false);
});

test("URL launch cannot inject Trust ID credentials into an embed href", () => {
  const clean = sanitizeLaunchUrl("http://127.0.0.1:5176/?trustId=TD-OWNER&token=abc&deviceToken=phone");
  assert.equal(clean.includes("trustId="), false);
  assert.equal(clean.includes("token="), false);
  assert.equal(clean.includes("deviceToken="), false);
});

test("cross-app Digital Life access is denied", () => {
  const other = mediateCapability({
    appClass: "compatible",
    capability: "digitallife.context",
    origin: "https://evil.example",
    grants: [createGrant({ origin: "http://127.0.0.1:5176", capability: "digitallife.context" })],
    grantedThisRequest: false,
  });
  assert.equal(other.status, "denied");
});

test("builtin registry includes first-party and external apps and is not a store", () => {
  const registry = builtinAppRegistry();
  assert.deepEqual(registry.map((item) => item.id).sort(), ["lifeos", "mybrandos", "shell-demo-notes"]);
  assert.equal(registry.filter((item) => item.class === "native").length, 2);
  assert.equal(registry.find((item) => item.id === "shell-demo-notes")?.class, "compatible");
});

test("context.request from the wrong origin is dropped", () => {
  const parsed = parseIncomingMessage(
    { channel: "os-shell", type: "context.request", requestId: "1" },
    "https://evil.example",
    "http://127.0.0.1:5176",
  );
  assert.equal(parsed, null);
});

test("unimplemented native platforms report capability_unavailable", () => {
  const ios = platformSupports("media.camera", "ios");
  assert.equal(ios.supported, false);
  assert.equal(ios.code, "capability_unavailable");
});
