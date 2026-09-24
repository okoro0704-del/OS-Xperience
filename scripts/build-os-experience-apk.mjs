/**
 * Build a production-installable OS Xperience debug APK that boots from BUNDLED assets.
 * Hard-fails if web build / Capacitor sync assets are missing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "os-experience");
const androidDir = join(appDir, "android");
const distIndex = join(appDir, "dist", "index.html");
const assetsIndex = join(androidDir, "app", "src", "main", "assets", "public", "index.html");
const capConfig = join(androidDir, "app", "src", "main", "assets", "capacitor.config.json");
const jbr = "C:\\Program Files\\Android\\Android Studio\\jbr";
const sdk = join(homedir(), "AppData", "Local", "Android", "Sdk");

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

function assertFile(path, label) {
  if (!existsSync(path)) {
    console.error(`FATAL: ${label} missing: ${path}`);
    process.exit(1);
  }
}

console.log("Building BUNDLED OS Xperience APK (no Capacitor server.url).");
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

run(join(androidDir, "gradlew.bat"), ["assembleDebug"], androidDir, { shell: true });
run(process.execPath, [join(root, "scripts", "publish-os-experience-apk.mjs")], root);

console.log("\nDone — bundled APK on Desktop.");
console.log("  Desktop\\OS-Xperience.apk");
console.log("  Desktop\\SEND-TO-PHONE-OS-Xperience.apk");
console.log("Boot: local assets only. Network sync/update checks run after shell is ready.");
