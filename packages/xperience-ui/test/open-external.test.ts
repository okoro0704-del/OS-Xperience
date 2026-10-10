import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { OPEN_EXTERNAL_MIN_INTERVAL_MS, decideOpenExternal } from "../src/local/open-external.ts";

const appWindow = { name: "mybrandOS frame" };
const otherWindow = { name: "another frame" };
const frames = [
  { embedUrl: "https://mrfundzman.getlifeos.app/", window: appWindow },
  { embedUrl: "https://shop.example/", window: otherWindow },
];
const base = {
  data: { type: "ox.openExternal", version: 1, url: "https://mrfundzman.getlifeos.app/auth/handoff?h=abc" },
  origin: "https://mrfundzman.getlifeos.app",
  source: appWindow,
  frames,
  now: 10_000,
  lastAcceptedAt: 0,
};

test("an App may open its own https page in the device browser", () => {
  assert.deepEqual(decideOpenExternal(base), { ok: true, url: "https://mrfundzman.getlifeos.app/auth/handoff?h=abc" });
});

test("only mounted App frames, from their own origin, for their own pages", () => {
  const cases: Array<[Partial<typeof base>, string]> = [
    [{ source: { name: "unknown" } }, "unknown_sender"],
    [{ source: null }, "unknown_sender"],
    [{ origin: "https://evil.example" }, "origin_mismatch"],
    [{ source: otherWindow }, "origin_mismatch"],
    [{ data: { ...base.data, url: "https://trustedid.netlify.app/oauth/consent" } }, "foreign_url"],
    [{ data: { ...base.data, url: "https://evil.example/phish" } }, "foreign_url"],
    [{ data: { ...base.data, url: "http://mrfundzman.getlifeos.app/auth/handoff" } }, "not_https"],
    [{ data: { ...base.data, url: "javascript:alert(1)" } }, "not_https"],
    [{ data: { ...base.data, url: "https://user:pass@mrfundzman.getlifeos.app/x" } }, "not_https"],
    [{ data: { ...base.data, version: 2 } }, "malformed"],
    [{ data: { ...base.data, url: 42 } }, "malformed"],
    [{ data: { type: "something-else" } }, "not_open_external"],
    [{ data: null }, "not_open_external"],
    [{ lastAcceptedAt: base.now - OPEN_EXTERNAL_MIN_INTERVAL_MS + 1 }, "rate_limited"],
  ];
  for (const [override, reason] of cases) {
    assert.deepEqual(decideOpenExternal({ ...base, ...override } as typeof base), { ok: false, reason }, reason);
  }
});

test("ExperienceApp routes accepted requests to the existing device-browser opener only", () => {
  const app = readFileSync(new URL("../src/ExperienceApp.tsx", import.meta.url), "utf8");
  const listener = app.slice(app.indexOf("const lastOpenExternalAt"), app.indexOf("const refreshMemberships"));
  assert.match(listener, /decideOpenExternal\(\{/);
  assert.match(listener, /if \(!decision\.ok\) return;/);
  assert.match(listener, /openHttps\(decision\.url\);/);
  // Senders are matched against the actual mounted App frames.
  assert.match(listener, /iframe\.ox-immersive-frame/);
  // Nothing is posted back to the frame.
  assert.doesNotMatch(listener, /postMessage/);
});
