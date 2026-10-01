import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestUrls } from "../../apps/os-experience/src/update-sources.ts";

const app = join(dirname(fileURLToPath(import.meta.url)), "../../apps/os-experience");

test("native OTA reads the hosted release manifest before the bundled origin copy", () => {
  assert.deepEqual(manifestUrls("https://xperience.getlifeos.app", "https://localhost"), [
    "https://xperience.getlifeos.app/ox-update-manifest.json",
    "https://localhost/ox-update-manifest.json",
  ]);
});

test("hosted web origin is not fetched twice", () => {
  assert.deepEqual(manifestUrls("https://xperience.getlifeos.app/", "https://xperience.getlifeos.app"), [
    "https://xperience.getlifeos.app/ox-update-manifest.json",
  ]);
});

test("without a stamped runtime URL the origin manifest is the only source", () => {
  assert.deepEqual(manifestUrls("", "https://localhost"), ["https://localhost/ox-update-manifest.json"]);
});

test("update check runs after mount, rechecks on reconnect, and never installs silently", () => {
  const gate = readFileSync(join(app, "src", "UpdateGate.tsx"), "utf8");
  assert.match(gate, /setTimeout\(\(\) => void runCheck\(\), 1500\)/);
  assert.match(gate, /addEventListener\("online", onOnline\)/);
  const check = readFileSync(join(app, "src", "update-check.ts"), "utf8");
  assert.match(check, /CapacitorHttp\.get/);
  assert.match(check, /openExternalUrl\(apkUrl\)/);
  const manifest = readFileSync(join(app, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  assert.doesNotMatch(manifest, /REQUEST_INSTALL_PACKAGES/);
});
