/**
 * Publish the latest OS Xperience APK to the Windows Desktop.
 * Overwrites the stable Desktop APKs and removes older OS-Xperience*.apk
 * files on the Desktop only (never deletes unrelated APKs elsewhere).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apkDir = join(root, "apps", "os-experience", "android", "app", "build", "outputs", "apk", "debug");
const versionsPath = join(root, "apps", "os-experience", "ox-versions.json");
const liveUrl =
  process.env.CAPACITOR_SERVER_URL ||
  process.env.OX_LIVE_URL ||
  "https://xperience.getlifeos.app";

const stableName = "OS-Xperience.apk";
const sendName = "SEND-TO-PHONE-OS-Xperience.apk";

/** Resolve the real Windows Desktop (handles OneDrive / localized / redirected folders). */
function resolveDesktopDir() {
  if (process.env.OX_APK_RELEASE_DIR?.trim()) return process.env.OX_APK_RELEASE_DIR.trim();
  try {
    const known = execSync(
      'powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"',
      { encoding: "utf8", windowsHide: true },
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    if (known && existsSync(known)) return known;
  } catch {
    /* fall through */
  }
  const candidates = [
    join(homedir(), "Desktop"),
    join(homedir(), "OneDrive", "Desktop"),
    process.env.OneDrive ? join(process.env.OneDrive, "Desktop") : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return join(homedir(), "Desktop");
}

function findNewestApk(dir) {
  if (!existsSync(dir)) return null;
  return (
    readdirSync(dir)
      .filter((name) => name.endsWith(".apk"))
      .map((name) => {
        const path = join(dir, name);
        return { path, name, mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)[0] ?? null
  );
}

/** Remove older OS-Xperience*.apk on Desktop except the stable copies we keep. */
function pruneOldOsXperienceApks(dir, keepNames) {
  if (!existsSync(dir)) return [];
  const keep = new Set(keepNames);
  const removed = [];
  for (const name of readdirSync(dir)) {
    if (!/^OS-Xperience.*\.apk$/i.test(name)) continue;
    if (keep.has(name)) continue;
    unlinkSync(join(dir, name));
    removed.push(name);
  }
  return removed;
}

const desktop = resolveDesktopDir();
const stablePath = join(desktop, stableName);
const sendPath = join(desktop, sendName);

const source = findNewestApk(apkDir);
if (!source) {
  console.error(`No debug APK found under ${apkDir}`);
  console.error("Build first: npm run android:experience:debug");
  process.exit(1);
}

let nativeVersion = "0.0.0";
let nativeBuildNumber = 0;
let runtimeVersion = "unknown";
try {
  const versions = JSON.parse(readFileSync(versionsPath, "utf8"));
  nativeVersion = String(versions.nativeVersion ?? nativeVersion);
  nativeBuildNumber = Number(versions.nativeBuildNumber ?? nativeBuildNumber);
  runtimeVersion = String(versions.runtimeVersion ?? runtimeVersion);
} catch {
  /* optional */
}

if (!existsSync(desktop)) mkdirSync(desktop, { recursive: true });

copyFileSync(source.path, stablePath);
copyFileSync(source.path, sendPath);

const removed = pruneOldOsXperienceApks(desktop, [stableName, sendName]);

writeFileSync(
  join(desktop, "OS-Xperience-UPDATE.txt"),
  [
    "OS Xperience — BUNDLED APK",
    "",
    `Updated: ${new Date().toLocaleString()}`,
    `Native: ${nativeVersion} (build ${nativeBuildNumber})`,
    `Runtime: ${runtimeVersion}`,
    `Desktop folder: ${desktop}`,
    "",
    "Saved on your Desktop:",
    `  ${stablePath}`,
    `  ${sendPath}`,
    "",
    "INSTALL ONCE (tap Update if already installed).",
    "This build boots from bundled local assets (offline shell).",
    "Network / catalog / update checks run after the shell is visible.",
    "Only native Android shell changes need a new APK from the Desktop.",
    "",
    removed.length
      ? `Removed previous OS Xperience APKs from Desktop: ${removed.join(", ")}`
      : "No previous OS Xperience APKs to remove on Desktop.",
    "",
  ].join("\n"),
  "utf8",
);

const stableStat = statSync(stablePath);
console.log(`Desktop folder: ${desktop}`);
console.log(`Desktop → ${stablePath} (${stableStat.size} bytes)`);
console.log(`Desktop → ${sendPath}`);
if (removed.length) console.log(`Pruned on Desktop: ${removed.join(", ")}`);
if (!existsSync(stablePath)) {
  console.error("ERROR: APK was not written to Desktop.");
  process.exit(1);
}
