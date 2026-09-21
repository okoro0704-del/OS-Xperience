/**
 * Build OS Xperience debug APK with LIVE OTA (Netlify) and copy to Desktop.
 * Install once — later UI updates arrive when the app opens (no new APK).
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps", "os-experience");
const androidDir = join(appDir, "android");
const jbr = "C:\\Program Files\\Android\\Android Studio\\jbr";
const sdk = join(homedir(), "AppData", "Local", "Android", "Sdk");
const liveUrl = (process.env.CAPACITOR_SERVER_URL || process.env.OX_LIVE_URL || "https://os-xperience.netlify.app").trim();

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
  // Force live OTA into capacitor.config.ts (never bundled-only for this script).
  OX_BUNDLED_ONLY: "",
  OX_LIVE_OTA: "1",
  CAPACITOR_SERVER_URL: liveUrl,
  OX_LIVE_URL: liveUrl,
  Path: `${join(jbr, "bin")};${process.env.Path || ""}`,
};

function run(cmd, args, cwd, options = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: options.shell ?? false,
    windowsHide: true,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log(`Live OTA URL: ${liveUrl}`);
run("npm", ["run", "build:os-experience"], root, { shell: true });
run("npx", ["cap", "sync", "android"], appDir, { shell: true });
run(join(androidDir, "gradlew.bat"), ["assembleDebug"], androidDir, { shell: true });
run(process.execPath, [join(root, "scripts", "publish-os-experience-apk.mjs")], root);

console.log("\nDone.");
console.log("  Desktop\\OS-Xperience.apk");
console.log("  Desktop\\SEND-TO-PHONE-OS-Xperience.apk");
console.log(`Live OTA: opens ${liveUrl} on every launch — UI updates without a new APK.`);
