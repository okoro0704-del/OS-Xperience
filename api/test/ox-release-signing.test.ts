import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const app = join(root, "apps", "os-experience");
const ANDROID_DEBUG_CERT = "8e5eb29468beea2d36135b8500c376e493277a97140a69d1688bd3ea4cf336aa";

test("release signing reads only external OX_RELEASE_* values and fails closed", () => {
  const gradle = readFileSync(join(app, "android", "app", "build.gradle"), "utf8");
  for (const name of ["OX_RELEASE_STORE_FILE", "OX_RELEASE_STORE_PASSWORD", "OX_RELEASE_KEY_ALIAS", "OX_RELEASE_KEY_PASSWORD"]) {
    assert.match(gradle, new RegExp(`releaseSigningValue\\('${name}'\\)`));
  }
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.doesNotMatch(gradle, /signingConfig signingConfigs\.debug/);
  assert.match(gradle, /throw new GradleException\(\s*"OS Xperience release signing is not configured/);
  assert.doesNotMatch(gradle, /(storePassword|keyPassword)\s+["']/);
  assert.doesNotMatch(gradle, /\.(jks|keystore)["']/);
});

test("signing continuity record is public certificate metadata only", () => {
  const record = JSON.parse(readFileSync(join(app, "android-release-signing.json"), "utf8"));
  assert.equal(record.applicationId, "com.digiconomy.osexperience");
  assert.equal(record.keyAlias, "os-xperience");
  assert.match(record.certificateSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(record.certificateSha256, ANDROID_DEBUG_CERT);
  assert.equal(record.firstProductionVersionCode, 14);
  assert.deepEqual(
    Object.keys(record).filter((key) => /password|secret|private|storeFile|path/i.test(key)),
    [],
  );
});

test("keystores stay out of git and hosted APKs stay out of the native bundle", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\*\.jks$/m);
  assert.match(ignore, /^\*\.keystore$/m);
  const gradle = readFileSync(join(app, "android", "app", "build.gradle"), "utf8");
  assert.match(gradle, /ignoreAssetsPattern '[^']*:<dir>releases'/);
});
