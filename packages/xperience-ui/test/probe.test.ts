import assert from "node:assert/strict";
import test from "node:test";
import { probeExperienceUrl } from "../src/local/probe.js";

test("probeExperienceUrl rejects invalid URLs", async () => {
  assert.equal((await probeExperienceUrl("")).ok, false);
  assert.equal((await probeExperienceUrl("not-a-url")).ok, false);
  assert.equal((await probeExperienceUrl("ftp://example.com")).ok, false);
});

test("probeExperienceUrl fails closed when offline", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, "onLine");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: false },
  });
  try {
    const result = await probeExperienceUrl("https://example.com");
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /connection/i);
  } finally {
    if (original) {
      Object.defineProperty(globalThis.navigator, "onLine", original);
    } else {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { onLine: true },
      });
    }
  }
});
