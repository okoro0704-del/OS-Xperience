import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRODUCTION_RELEASE_CONTRACT_VERSION,
  SHELL_MESSAGE_VERSION,
  createShellEnvironment,
  isSimulationAllowed,
  createSimulationConfig,
  originPolicyFromEnvironment,
  productionBuildRejectsLocalhost,
  sanitizeLaunchUrl,
  urlContainsCredentialParams,
} from "../src/index.ts";
import { safeGetJson, safeParseJson, safeSetJson } from "../../runtime/src/safe-storage.ts";

test("production release contract is 2.0.1 and protocol stays 0.7", () => {
  assert.equal(PRODUCTION_RELEASE_CONTRACT_VERSION, "2.0.1");
  assert.equal(SHELL_MESSAGE_VERSION, "0.7");
});

test("production environment rejects localhost defaults", () => {
  assert.throws(() =>
    createShellEnvironment({
      mode: "production",
      shellOrigins: "http://127.0.0.1:5180",
      mybrandosOrigins: "https://mybrandos.example",
      lifeosOrigins: "https://lifeos.example",
    }),
  );
  const prod = createShellEnvironment({
    mode: "production",
    shellOrigins: "https://shell.digiconomy.example",
    mybrandosOrigins: "https://mybrandos.digiconomy.example",
    lifeosOrigins: "https://lifeos.digiconomy.example",
    compatibleOrigins: "",
  });
  assert.equal(prod.allowDevelopmentFeatures, false);
  assert.equal(productionBuildRejectsLocalhost(prod), true);
  assert.equal(prod.compatibleOrigins.length, 0);
});

test("development environment keeps localhost for local tooling", () => {
  const dev = createShellEnvironment({ mode: "development" });
  assert.equal(dev.allowDevelopmentFeatures, true);
  assert.ok(dev.shellOrigins.some((item) => item.includes("127.0.0.1") || item.includes("localhost")));
});

test("origin policy from production env never trusts loopback", () => {
  const env = createShellEnvironment({
    mode: "production",
    shellOrigins: "https://shell.digiconomy.example",
    mybrandosOrigins: "https://mybrandos.digiconomy.example",
    lifeosOrigins: "https://lifeos.digiconomy.example",
  });
  const policy = originPolicyFromEnvironment(env);
  assert.equal(policy.nativeOrigins.includes("http://127.0.0.1:5176"), false);
  assert.ok(policy.nativeOrigins.includes("https://mybrandos.digiconomy.example"));
});

test("launch URLs strip password secret api_key otp pin", () => {
  const dirty =
    "https://app.example/?password=x&secret=y&api_key=z&otp=1&pin=2&token=abc&trustId=td&keep=1";
  assert.equal(urlContainsCredentialParams(dirty), true);
  const clean = sanitizeLaunchUrl(dirty);
  assert.equal(urlContainsCredentialParams(clean), false);
  assert.match(clean, /keep=1/);
});

test("simulation remains localhost-only", () => {
  const config = createSimulationConfig({ camera: "denied" });
  assert.equal(isSimulationAllowed("http://127.0.0.1:5180", config), true);
  assert.equal(isSimulationAllowed("https://shell.digiconomy.example", config), false);
});

test("safe storage recovers from invalid JSON and secrets", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
  };
  assert.equal(safeParseJson("{").ok, false);
  memory.set("bad", "{not-json");
  const cleared = safeGetJson(storage, "bad");
  assert.equal(cleared.ok, false);
  assert.equal(memory.has("bad"), false);
  memory.set("secret", JSON.stringify({ token: "nope" }));
  const secret = safeGetJson(storage, "secret");
  assert.equal(secret.ok, false);
  safeSetJson(storage, "ok", { preference: true });
  assert.equal(safeGetJson(storage, "ok").ok, true);
});

test("production origin policy never falls back to localhost natives", () => {
  const env = createShellEnvironment({
    mode: "production",
    shellOrigins: "https://shell.digiconomy.example",
    mybrandosOrigins: "",
    lifeosOrigins: "",
  });
  const policy = originPolicyFromEnvironment(env);
  assert.equal(policy.nativeOrigins.length, 0);
  assert.equal(policy.nativeOrigins.some((o) => o.includes("127.0.0.1")), false);
});
