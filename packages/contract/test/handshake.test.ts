import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SHELL_MESSAGE_VERSION,
  classifyNavigation,
  confirmReady,
  createAppClient,
  createGrant,
  decideBack,
  defaultOriginPolicy,
  detectShellOrigin,
  envelope,
  getApplicationContext,
  hasGrant,
  jsonLeaksSecrets,
  openLifecycle,
  parseIncomingMessage,
  parseTrustedMessage,
  postToApp,
  postTargetIsSafe,
  resolveAppIdentity,
  resolveCapabilityName,
  revokeGrant,
} from "../src/index.ts";

const MYBRAND = "http://127.0.0.1:5176";
const LIFEOS = "http://127.0.0.1:5174";
const GITHUB = "https://github.com";
const source = { id: "iframe" };

function ready(extra: Record<string, unknown> = {}) {
  return envelope("application.ready", { title: "mybrandOS", path: "/", canGoBack: false, ...extra });
}

test("valid first-party handshake is accepted from the registered origin and source", () => {
  const parsed = parseTrustedMessage({
    data: ready(),
    eventOrigin: MYBRAND,
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.message.type, "ready");
});

test("unknown origin handshake is rejected", () => {
  const parsed = parseTrustedMessage({
    data: ready(),
    eventOrigin: "https://evil.example",
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, "unknown_origin");
});

test("spoofed source handshake is rejected even when origin matches", () => {
  const parsed = parseTrustedMessage({
    data: ready(),
    eventOrigin: MYBRAND,
    eventSource: { id: "popup" },
    expectedOrigin: MYBRAND,
    expectedSource: source,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, "spoofed_source");
});

test("malformed handshake without version is rejected", () => {
  const parsed = parseIncomingMessage({ channel: "os-shell", type: "application.ready" }, MYBRAND, MYBRAND);
  assert.equal(parsed, null);
});

test("ready without a launched application does not invent ACTIVE", () => {
  const records = confirmReady([], MYBRAND);
  assert.equal(records.length, 0);
});

test("shell, application, and external navigation stay distinct", () => {
  assert.equal(classifyNavigation({ shellSurface: true, appClass: "native" }), "shell");
  assert.equal(classifyNavigation({ shellSurface: false, appClass: "native" }), "application");
  assert.equal(classifyNavigation({ shellSurface: false, appClass: "web" }), "external");
});

test("back prefers application history, then Shell, then browser", () => {
  assert.equal(decideBack({ appCanGoBack: true, shellHasHistory: true, kind: "application" }), "application");
  assert.equal(decideBack({ appCanGoBack: false, shellHasHistory: true, kind: "application" }), "shell");
  assert.equal(decideBack({ appCanGoBack: false, shellHasHistory: false, kind: "external" }), "browser");
});

test("capability aliases resolve to the existing contract names", () => {
  assert.equal(resolveCapabilityName("camera"), "media.camera");
  assert.equal(resolveCapabilityName("identity"), "identity.public");
  assert.equal(resolveCapabilityName("assets"), "storage.read");
  assert.equal(resolveCapabilityName("commerce"), "commerce.checkout");
  assert.equal(resolveCapabilityName("device_bridge"), "device_bridge");
  assert.equal(resolveCapabilityName("live"), "live");
});

test("application context stays least privilege and includes current-app fields", () => {
  const context = getApplicationContext({
    origin: MYBRAND,
    name: "mybrandOS",
    class: "native",
    version: "0.17.0",
    kind: "application",
    lifecycle: "ACTIVE",
    requested: ["media.camera"],
    grants: [createGrant({ origin: MYBRAND, capability: "media.camera" })],
  });
  assert.equal(context.appId, "mybrandos");
  assert.deepEqual(context.grantedCapabilities, ["media.camera"]);
  assert.equal(jsonLeaksSecrets(context), false);
  assert.equal("token" in context, false);
});

test("wildcard postMessage targets are rejected", () => {
  assert.equal(postTargetIsSafe("*"), false);
  let sent = 0;
  const result = postToApp({ postMessage: () => void sent++ }, "*", {
    channel: "os-shell",
    version: SHELL_MESSAGE_VERSION,
    type: "application.back",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "wildcard_rejected");
  assert.equal(sent, 0);
});

test("token-bearing payloads are rejected", () => {
  const parsed = parseTrustedMessage({
    data: { ...ready(), token: "secret", trustId: "TD-1" },
    eventOrigin: MYBRAND,
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, "secret_payload");
});

test("forbidden capability requests are unexpected", () => {
  const parsed = parseTrustedMessage({
    data: envelope("capability.request", { capability: "allow_all", requestId: "1" }),
    eventOrigin: MYBRAND,
    eventSource: source,
    expectedOrigin: MYBRAND,
    expectedSource: source,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, "unexpected_capability");
});

test("detectShellOrigin only trusts the Shell, never an arbitrary parent", () => {
  assert.equal(detectShellOrigin(["https://evil.example"], "https://evil.example/"), null);
  assert.equal(detectShellOrigin(["http://127.0.0.1:5180"], ""), "http://127.0.0.1:5180");
});

test("app client is a no-op outside a trusted Shell iframe and never uses *", () => {
  const posts: Array<{ origin: string }> = [];
  const self = { addEventListener() {}, removeEventListener() {} } as unknown as Window;
  const parent = { postMessage: (_message: unknown, origin: string) => posts.push({ origin }) };
  const client = createAppClient({
    parent,
    self,
    getTitle: () => "App",
    getPath: () => "/",
    canGoBack: () => false,
  });
  const detach = client.attach({ ancestorOrigins: ["https://evil.example"], referrer: "" });
  detach();
  assert.equal(posts.length, 0);
  const live = createAppClient({
    parent,
    self,
    getTitle: () => "App",
    getPath: () => "/",
    canGoBack: () => false,
  });
  live.attach({ ancestorOrigins: ["http://127.0.0.1:5180"], referrer: "" });
  assert.equal(posts.length > 0, true);
  assert.equal(posts.every((item) => item.origin === "http://127.0.0.1:5180"), true);
});

test("a recent GitHub URL cannot promote itself to native", () => {
  const identity = resolveAppIdentity({
    href: "https://github.com/",
    origin: GITHUB,
    manifest: {
      schema: "os-shell.manifest/0.1",
      name: "GitHub",
      version: "1",
      origin: GITHUB,
      class: "native",
      embed: "allow",
      launch: "/",
      requested: ["media.camera"],
    },
    policy: defaultOriginPolicy(),
  });
  assert.equal(identity.effectiveClass, "compatible");
  assert.equal(identity.nativeUnverified, true);
});

test("mybrandOS camera grant is not LifeOS or GitHub camera grant", () => {
  const grants = [createGrant({ origin: MYBRAND, capability: "media.camera" })];
  assert.equal(hasGrant(grants, MYBRAND, "media.camera"), true);
  assert.equal(hasGrant(grants, LIFEOS, "media.camera"), false);
  assert.equal(hasGrant(grants, GITHUB, "media.camera"), false);
  const afterRevoke = revokeGrant(grants, MYBRAND, "media.camera");
  assert.equal(hasGrant(afterRevoke, MYBRAND, "media.camera"), false);
});

test("launched first-party app becomes ACTIVE only after ready", () => {
  let records = openLifecycle([], MYBRAND);
  records = openLifecycle(records, LIFEOS);
  assert.equal(records.find((item) => item.origin === MYBRAND)?.lifecycle, "BACKGROUND");
  records = confirmReady(records, LIFEOS);
  assert.equal(records.find((item) => item.origin === LIFEOS)?.lifecycle, "ACTIVE");
  records = confirmReady(records, MYBRAND);
  assert.equal(records.find((item) => item.origin === MYBRAND)?.lifecycle, "ACTIVE");
  assert.equal(records.find((item) => item.origin === LIFEOS)?.lifecycle, "BACKGROUND");
});
