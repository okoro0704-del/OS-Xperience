import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { frameAllowPolicy, isFirstPartyAppUrl } from "../src/local/frame-permissions.ts";

test("camera and microphone are delegated only to first-party https apps", () => {
  for (const url of ["https://mrfundzman.getlifeos.app/", "https://kingbooker.getlifeos.app/admin"]) {
    assert.equal(isFirstPartyAppUrl(url), true, url);
    assert.match(frameAllowPolicy(url), /\bcamera\b/);
    assert.match(frameAllowPolicy(url), /\bmicrophone\b/);
  }
  for (const url of [
    "https://shop.example/",
    "http://mrfundzman.getlifeos.app/",
    "https://getlifeos.app.evil.example/",
    "https://evilgetlifeos.app/",
    "https://user:pw@mrfundzman.getlifeos.app/",
    "not a url",
  ]) {
    assert.equal(isFirstPartyAppUrl(url), false, url);
    assert.doesNotMatch(frameAllowPolicy(url), /camera|microphone/, url);
  }
});

test("every App frame carries the policy; the Android app can grant microphone access", () => {
  const app = readFileSync(new URL("../src/ExperienceApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<iframe[\s\S]*?allow=\{frameAllowPolicy\(frame\.embedUrl\)\}/);
  const manifest = readFileSync(new URL("../../../apps/os-experience/android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  for (const permission of ["CAMERA", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]) {
    assert.match(manifest, new RegExp(`android\.permission\.${permission}"`), permission);
  }
});
