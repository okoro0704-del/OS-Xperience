import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const app = join(root, "apps", "os-experience");

test("release capacitor config source defaults without server.url", () => {
  const src = readFileSync(join(app, "capacitor.config.ts"), "utf8");
  assert.match(src, /const liveOta = process\.env\.OX_LIVE_OTA === "1"/);
  assert.match(src, /liveUrl\s*\?/);
  assert.doesNotMatch(src, /OX_LIVE_OTA === "1"[\s\S]*default.*https:\/\/xperience/);
});

test("vite base is relative for Capacitor asset resolution", () => {
  const src = readFileSync(join(app, "vite.config.ts"), "utf8");
  assert.match(src, /base:\s*["']\.\/["']/);
});

test("native main disables service worker on Capacitor", () => {
  const src = readFileSync(join(app, "src", "main.tsx"), "utf8");
  assert.match(src, /!Capacitor\.isNativePlatform\(\)/);
  assert.match(src, /ShellErrorBoundary/);
  assert.match(src, /BootWatchdog/);
});

test("update-check defers web OTA on native", () => {
  const src = readFileSync(join(app, "src", "update-check.ts"), "utf8");
  assert.match(src, /web_ota deferred on native bundled shell/);
  assert.match(src, /content-type/);
});

test("build script hard-fails on missing dist and rejects server.url", () => {
  const src = readFileSync(join(root, "scripts", "build-os-experience-apk.mjs"), "utf8");
  assert.match(src, /assertFile\(distIndex/);
  assert.match(src, /assertFile\(assetsIndex/);
  assert.match(src, /still contains server\.url/);
  assert.match(src, /OX_LIVE_OTA:\s*""/);
});
