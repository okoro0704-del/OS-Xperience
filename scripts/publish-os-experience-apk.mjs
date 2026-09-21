/**
 * Copy the latest OS Xperience debug APK to the Desktop as stable files.
 * Always overwrites:
 *   Desktop/OS-Xperience.apk
 *   Desktop/SEND-TO-PHONE-OS-Xperience.apk
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apkDir = join(root, "apps", "os-experience", "android", "app", "build", "outputs", "apk", "debug");
const desktop = join(homedir(), "Desktop");
const stablePath = join(desktop, "OS-Xperience.apk");
const sendPath = join(desktop, "SEND-TO-PHONE-OS-Xperience.apk");
const liveUrl = process.env.CAPACITOR_SERVER_URL || process.env.OX_LIVE_URL || "https://os-xperience.netlify.app";

function findApk(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".apk"))
    .map((name) => {
      const path = join(dir, name);
      return { path, mtime: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.path ?? null;
}

const source = findApk(apkDir);
if (!source) {
  console.error(`No debug APK found under ${apkDir}`);
  console.error("Build first: npm run android:experience:debug");
  process.exit(1);
}

if (!existsSync(desktop)) mkdirSync(desktop, { recursive: true });
copyFileSync(source, stablePath);
copyFileSync(source, sendPath);

writeFileSync(
  join(desktop, "OS-Xperience-UPDATE.txt"),
  [
    "OS Xperience — LIVE OTA APK",
    "",
    `Updated: ${new Date().toLocaleString()}`,
    `Files:`,
    `  ${stablePath}`,
    `  ${sendPath}`,
    "",
    "INSTALL ONCE on your phone (tap Update if already installed).",
    "",
    "AFTER THAT — updates are automatic:",
    `This build loads ${liveUrl} every time you open the app.`,
    "When a new UI is deployed to Netlify, just open OS Xperience —",
    "it uses the new version by itself. You do NOT install another APK.",
    "",
    "Only native Android shell changes need a new APK.",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Copied APK → ${stablePath}`);
console.log(`Copied APK → ${sendPath}`);
