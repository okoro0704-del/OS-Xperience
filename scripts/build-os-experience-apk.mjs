/**
 * Build an OS Xperience APK that boots from BUNDLED assets.
 * Hard-fails if web build / Capacitor sync assets are missing.
 *
 *   node scripts/build-os-experience-apk.mjs            debug APK, published to the Desktop
 *   node scripts/build-os-experience-apk.mjs --release  production-signed APK, verified against
 *                                                        apps/os-experience/android-release-signing.json
 *                                                        and staged at public/releases/OS-Xperience.apk
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const release = process.argv.includes("--release");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "os-experience");
const androidDir = join(appDir, "android");
const distIndex = join(appDir, "dist", "index.html");
const assetsIndex = join(androidDir, "app", "src", "main", "assets", "public", "index.html");
const capConfig = join(androidDir, "app", "src", "main", "assets", "capacitor.config.json");
const releaseApk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
const hostedApk = join(appDir, "public", "releases", "OS-Xperience.apk");
const signingRecord = join(appDir, "android-release-signing.json");
const jbr = "C:\\Program Files\\Android\\Android Studio\\jbr";
const sdk = join(homedir(), "AppData", "Local", "Android", "Sdk");
const DEBUG_CERT_SHA256 = "8e5eb29468beea2d36135b8500c376e493277a97140a69d1688bd3ea4cf336aa";

if (!existsSync(join(jbr, "bin", "java.exe"))) {
  console.error("Android Studio JBR not found at", jbr);
  process.exit(1);
}
if (!existsSync(sdk)) {
  console.error("Android SDK not found at", sdk);
  process.exit(1);
}

const props = join(androidDir, "local.properties");
const escaped = sdk.replace(/\\/g, "\\\\").replace(":", "\\:");
writeFileSync(props, `sdk.dir=${escaped}\n`, "utf8");

const env = {
  ...process.env,
  JAVA_HOME: jbr,
  ANDROID_HOME: sdk,
  // Release APKs must NOT inject server.url.
  OX_LIVE_OTA: "",
  OX_BUNDLED_ONLY: "1",
  CAPACITOR_SERVER_URL: "",
  OX_LIVE_URL: "",
  Path: `${join(jbr, "bin")};${process.env.Path || ""}`,
};

function run(cmd, args, cwd, options = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const useShell = options.shell ?? false;
  const command = useShell && /\s/.test(cmd) ? `"${cmd}"` : cmd;
  const r = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: useShell,
    windowsHide: true,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { env, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function fail(message) {
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

function assertFile(path, label) {
  if (!existsSync(path)) fail(`${label} missing: ${path}`);
}

function buildTool(name) {
  const dir = join(sdk, "build-tools");
  const latest = readdirSync(dir)
    .filter((v) => existsSync(join(dir, v, name)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .pop();
  if (!latest) fail(`${name} not found under ${dir}`);
  return join(dir, latest, name);
}

function verifyReleaseApk(apk) {
  const versions = JSON.parse(readFileSync(join(appDir, "ox-versions.json"), "utf8"));
  const record = JSON.parse(readFileSync(signingRecord, "utf8"));
  const expectedCert = String(record.certificateSha256).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedCert) || expectedCert === DEBUG_CERT_SHA256) {
    fail("android-release-signing.json does not hold a production certificate fingerprint");
  }

  const badging = capture(buildTool("aapt.exe"), ["dump", "badging", apk]);
  const pkg = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
  if (!pkg) fail("could not read APK package identity");
  const [, packageName, versionCode, versionName] = pkg;
  if (packageName !== record.applicationId) fail(`package ${packageName} != ${record.applicationId}`);
  if (Number(versionCode) !== Number(versions.nativeBuildNumber)) fail(`versionCode ${versionCode} != ox-versions.json`);
  if (versionName !== String(versions.nativeVersion)) fail(`versionName ${versionName} != ox-versions.json`);
  if (/application-debuggable/.test(badging)) fail("release APK is debuggable");
  if (/INSTALL_PACKAGES/.test(badging)) fail("release APK requests an install-packages permission");

  const entries = capture(buildTool("aapt.exe"), ["list", apk]);
  if (/^assets\/public\/releases\//m.test(entries)) fail("release APK bundles public/releases");

  const certs = capture(join(jbr, "bin", "java.exe"), ["-jar", buildTool(join("lib", "apksigner.jar")), "verify", "--print-certs", apk]);
  const signers = [...certs.matchAll(/Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})/g)].map((m) => m[1]);
  if (signers.length !== 1 || signers[0] !== expectedCert) {
    fail(`release APK signer ${signers.join(",") || "none"} != android-release-signing.json ${expectedCert}`);
  }

  const bytes = readFileSync(apk);
  return {
    packageName,
    versionName,
    versionCode: Number(versionCode),
    signer: signers[0],
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

console.log(`Building BUNDLED OS Xperience ${release ? "RELEASE" : "debug"} APK (no Capacitor server.url).`);
if (release) assertFile(signingRecord, "signing continuity record");
run(process.execPath, [join(root, "scripts", "write-ox-update-manifest.mjs")], root);
run("npm", ["run", "build:os-experience"], root, { shell: true });
assertFile(distIndex, "web production build dist/index.html");

run("npx", ["cap", "sync", "android"], appDir, { shell: true });
assertFile(assetsIndex, "Capacitor synced assets/public/index.html");
assertFile(capConfig, "Capacitor android config");

const synced = JSON.parse(readFileSync(capConfig, "utf8"));
if (synced?.server?.url) {
  console.error("FATAL: capacitor.config.json still contains server.url — release APK must be bundled-only.");
  console.error("  server.url =", synced.server.url);
  process.exit(1);
}

if (release) {
  run(join(androidDir, "gradlew.bat"), ["assembleRelease"], androidDir, { shell: true });
  assertFile(releaseApk, "signed release APK");
  const verified = verifyReleaseApk(releaseApk);
  copyFileSync(releaseApk, hostedApk);
  console.log("\nVerified production release APK:");
  console.log(`  ${verified.packageName} ${verified.versionName} (${verified.versionCode})`);
  console.log(`  signer  ${verified.signer}`);
  console.log(`  size    ${verified.size}`);
  console.log(`  sha256  ${verified.sha256}`);
  console.log(`Staged for hosting → ${hostedApk}`);
  console.log("Publish to the Desktop after the hosted copy is verified:");
  console.log("  node scripts/publish-os-experience-apk.mjs --release");
} else {
  run(join(androidDir, "gradlew.bat"), ["assembleDebug"], androidDir, { shell: true });
  run(process.execPath, [join(root, "scripts", "publish-os-experience-apk.mjs")], root);

  console.log("\nDone — bundled APK on Desktop.");
  console.log("  Desktop\\OS-Xperience.apk");
  console.log("  Desktop\\SEND-TO-PHONE-OS-Xperience.apk");
  console.log("Boot: local assets only. Network sync/update checks run after shell is ready.");
}
