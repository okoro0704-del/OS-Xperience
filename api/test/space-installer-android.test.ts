import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import type { Browser, Page } from "playwright";
import { LANTERN, buildFixtures, check, seedTrust, type Fixtures } from "./space-installer-harness.js";

/**
 * SP3 on Android: the installed debug APK (Capacitor WebView, bundled assets) driven over the WebView's
 * DevTools socket. Back is the real Android key event, offline is real airplane mode, restart is a real
 * force-stop. Runs only when OX_ANDROID_SERIAL names a connected device or emulator with the APK installed.
 */
const serial = process.env.OX_ANDROID_SERIAL;
const APP = "com.digiconomy.osexperience";
const sdk = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? "", "Android/Sdk");
const adb = (...args: string[]) => execFileSync(join(sdk, "platform-tools/adb"), ["-s", serial!, ...args], { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const PORT = 9339;

async function attach(chromium: typeof import("playwright").chromium): Promise<{ browser: Browser; page: Page }> {
  let socket = "";
  for (let i = 0; i < 60 && !socket; i++) {
    const pid = adb("shell", "pidof", APP);
    socket = adb("shell", "cat", "/proc/net/unix").split("\n").map((line) => line.trim().split(" ").pop() ?? "").find((name) => name === `@webview_devtools_remote_${pid}`)?.slice(1) ?? "";
    if (!socket) await sleep(1000);
  }
  assert.ok(socket, "WebView DevTools socket (debug build)");
  try { adb("forward", "--remove", `tcp:${PORT}`); } catch { /* none */ }
  adb("forward", `tcp:${PORT}`, `localabstract:${socket}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page: Page | undefined;
  for (let i = 0; i < 30 && !page; i++) { page = browser.contexts()[0]?.pages().find((item) => item.url().startsWith("https://localhost")); if (!page) await sleep(500); }
  assert.ok(page, "app page");
  await page.addInitScript({ content: "globalThis.__name = (fn) => fn;" }).catch(() => undefined);
  await page.evaluate("globalThis.__name = (fn) => fn;");
  await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 30_000 });
  // Online, the shell may offer a newer production APK; a person would choose "later" and carry on.
  // (The check runs 1.5 s after start; offline it never appears.)
  if (await page.getByTestId("native-update-prompt").waitFor({ timeout: 8_000 }).then(() => true, () => false)) {
    const covered = await page.getByTestId("native-update-prompt").locator("button.secondary").click({ trial: true, timeout: 2_000 }).then(() => false, () => true);
    if (covered) console.log("ANDROID_NOTE update-prompt 'Later' button is covered by the dialog text on this viewport");
    await page.getByTestId("native-update-prompt").locator("button.secondary").evaluate((button: HTMLButtonElement) => button.click());
    await page.getByTestId("native-update-prompt").waitFor({ state: "detached" });
  }
  return { browser, page };
}

async function launch(chromium: typeof import("playwright").chromium) {
  adb("shell", "am", "force-stop", APP);
  adb("shell", "am", "start", "-W", "-n", `${APP}/.MainActivity`);
  return attach(chromium);
}

const file = async (fixtures: Fixtures, name: string) => ({ name: basename(name), mimeType: "application/octet-stream", buffer: await readFile(fixtures.files[name]!) });
const back = async (page: Page) => { adb("shell", "input", "keyevent", "4"); await page.waitForTimeout(600); };

/**
 * A real two-finger horizontal swipe injected into the emulator's touchscreen through the emulator console
 * (multi-touch protocol B), so it reaches MainActivity's native gesture detector exactly as fingers would.
 * Emulator only; a physical device needs a person's fingers.
 */
function twoFingerSwipe() {
  const [width, height] = adb("shell", "wm", "size").match(/(\d+)x(\d+)/)!.slice(1).map(Number) as [number, number];
  const ax = (px: number) => Math.round((px * 32767) / width);
  const ay = (px: number) => Math.round((px * 32767) / height);
  const frame = (x: number, down: boolean) => [
    "EV_ABS:ABS_MT_SLOT:0", ...(down ? ["EV_ABS:ABS_MT_TRACKING_ID:101"] : []), `EV_ABS:ABS_MT_POSITION_X:${ax(x)}`, `EV_ABS:ABS_MT_POSITION_Y:${ay(height * 0.45)}`,
    "EV_ABS:ABS_MT_SLOT:1", ...(down ? ["EV_ABS:ABS_MT_TRACKING_ID:102"] : []), `EV_ABS:ABS_MT_POSITION_X:${ax(x)}`, `EV_ABS:ABS_MT_POSITION_Y:${ay(height * 0.55)}`,
    ...(down ? ["EV_KEY:BTN_TOUCH:1"] : []), "EV_SYN:0:0",
  ];
  const start = Math.round(width * 0.15);
  adb("emu", "event", "send", ...frame(start, true));
  for (let step = 1; step <= 6; step++) adb("emu", "event", "send", ...frame(start + Math.round((step * width * 0.55) / 6), false));
  adb("emu", "event", "send", "EV_ABS:ABS_MT_SLOT:0", "EV_ABS:ABS_MT_TRACKING_ID:-1", "EV_ABS:ABS_MT_SLOT:1", "EV_ABS:ABS_MT_TRACKING_ID:-1", "EV_KEY:BTN_TOUCH:0", "EV_SYN:0:0");
}

test("SP3 Android: import → install → open → airplane-mode restart → update → preserved state → rollback → Back/escape → revoked update", { timeout: 600_000 }, async (t) => {
  if (!serial) { t.skip("set OX_ANDROID_SERIAL to a connected device or emulator"); return; }
  const { chromium } = await import("playwright");
  const scratch = await mkdtemp(join(tmpdir(), "ox-sp3-android-"));
  const fixtures = await buildFixtures(join(scratch, "files"));
  const harness = (await build({ entryPoints: [resolve("packages/space-package/src/index.ts")], bundle: true, format: "iife", globalName: "SpacePackage", platform: "browser", target: "es2022", write: false, logLevel: "silent" })).outputFiles[0]!.text;
  const evidence: string[] = [`device:${adb("shell", "getprop", "ro.product.model")}`, `android:${adb("shell", "getprop", "ro.build.version.release")}`];
  try {
    adb("shell", "pm", "clear", APP);
  } catch {
    // Some vendors (e.g. OPPO) refuse `pm clear` from adb; a debuggable app's data can be reset with run-as.
    adb("shell", "am", "force-stop", APP);
    adb("shell", "run-as", APP, "sh", "-c", "'rm -rf app_webview cache code_cache shared_prefs databases files no_backup'");
  }
  adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
  let { browser, page } = await launch(chromium);
  try {
    evidence.push(`webview:${await page.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "?")}`, `origin:${new URL(page.url()).origin}`);
    await seedTrust(page, fixtures.trust);

    // Import V1 → verify → install → open.
    await page.locator('[data-testid="nav-xperience"]:visible').first().click();
    await page.getByTestId("xperience-choice-space").click();
    await page.getByTestId("portable-spaces").waitFor();
    await page.getByTestId("space-import-input").setInputFiles(await file(fixtures, "lantern-1.0.0.space"));
    await page.getByTestId("space-installer").waitFor();
    await page.getByTestId("inspect-continue").click();
    await page.getByTestId("check-eligibility").waitFor({ timeout: 30_000 });
    const checks = await Promise.all(["integrity", "signature", "publisher", "revocation", "eligibility"].map(async (name) => `${name}=${(await check(page, name)).status}`));
    evidence.push(`verify:${checks.join(",")}`);
    await page.getByTestId("trust-install").click();
    await page.getByTestId("install-confirm").click();
    await page.getByTestId("install-continue").click();
    const installed = page.locator('[data-testid="installed-space"][data-health="HEALTHY"]');
    await installed.waitFor({ timeout: 30_000 });
    const installationId = await installed.getAttribute("data-installation-id");
    await page.getByTestId("installed-open").click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement | null)?.naturalWidth! > 0, undefined, { timeout: 30_000 });
    // Android Back closes the rendered Space, then walks the installer.
    await back(page);
    assert.equal(await page.getByTestId("package-renderer").count(), 0, "Back closes the rendered Space");
    assert.equal(await page.getByTestId("space-installer").getAttribute("data-view"), "installed", "Back stays in the installer");
    evidence.push(`install:1.0.0:${installationId}`, "open:RENDERED", "back:CLOSES_RENDERER");

    // A pending consequential operation (test fixture, written through the real engine on the device).
    await page.addScriptTag({ content: harness });
    await page.evaluate(async (id) => {
      const S = (window as unknown as { SpacePackage: typeof import("../../packages/space-package/src/index.js") }).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      try {
        await runtime.writeState(id, (state) => ({ ...state, preferences: { ...state.preferences, theme: "dusk" }, pendingOperations: [{ opId: "pay-1", kind: "payment.request", consequential: true, status: "PENDING", createdAt: new Date().toISOString(), payload: { amount: 5 } }] }));
      } finally { runtime.close(); }
    }, LANTERN);

    // Offline restart: airplane mode, force-stop, cold start from bundled assets.
    adb("shell", "cmd", "connectivity", "airplane-mode", "enable");
    await browser.close().catch(() => undefined);
    await sleep(3000);
    ({ browser, page } = await launch(chromium));
    const requests: string[] = [];
    page.on("request", (request) => { if (!/^(blob|data):/.test(request.url())) requests.push(request.url()); });
    assert.equal(await page.evaluate(() => navigator.onLine), false, "device offline");
    await page.locator('[data-testid="nav-xperience"]:visible').first().click();
    await page.getByTestId("xperience-choice-space").click();
    await page.getByTestId(`portable-space-${LANTERN}`).getByRole("button").click();
    const restored = page.locator('[data-testid="installed-space"][data-health="HEALTHY"]');
    await restored.waitFor({ timeout: 30_000 });
    assert.equal(await restored.getAttribute("data-installation-id"), installationId);
    assert.equal(await page.getByTestId("operation-pay-1").getAttribute("data-status"), "PENDING");
    await page.getByTestId("installed-open").click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement | null)?.naturalWidth! > 0, undefined, { timeout: 30_000 });
    // Two-finger escape from the rendered Space goes Home.
    // A physical device needs a person's two fingers; only an emulator accepts injected multi-touch.
    if (serial!.startsWith("emulator-")) twoFingerSwipe();
    const escaped = serial!.startsWith("emulator-") && await page.getByTestId("home").waitFor({ timeout: 8_000 }).then(() => true, () => false);
    evidence.push("offline-restart:HEALTHY", "open-offline:RENDERED", `two-finger-escape:${escaped ? "HOME" : "NOT_VERIFIED(needs real fingers)"}`);

    // Update to V2 offline; state preserved.
    if (escaped) {
      await page.locator('[data-testid="nav-xperience"]:visible').first().click();
      await page.getByTestId("xperience-choice-space").click();
      await page.getByTestId(`portable-space-${LANTERN}`).getByRole("button").click();
    } else {
      await back(page);
    }
    await restored.waitFor({ timeout: 30_000 });
    await page.getByTestId("installed-update").click();
    await page.getByTestId("update-drop-input").setInputFiles([await file(fixtures, "lantern-2.0.0.update.json"), await file(fixtures, "lantern-2.0.0.space")]);
    await page.locator('[data-testid="update-check"][data-acceptable="true"]').waitFor({ timeout: 30_000 });
    await page.getByTestId("update-apply").click();
    await page.locator('[data-testid="update-result"][data-state="ACTIVE"]').waitFor({ timeout: 60_000 });
    await back(page);
    const updated = page.locator('[data-testid="installed-space"][data-version="2.0.0"][data-health="HEALTHY"]');
    await updated.waitFor({ timeout: 30_000 });
    assert.equal(await updated.getAttribute("data-installation-id"), installationId);
    assert.equal(await page.getByTestId("local-state").getAttribute("data-data-version"), "2");
    assert.equal(await page.getByTestId("operation-pay-1").getAttribute("data-status"), "PENDING");
    evidence.push("update:2.0.0", "state:dataVersion=2,pay-1=PENDING", "back:INSTALLER_STEP");

    // Rollback: consequential operation HELD.
    await page.getByTestId("installed-rollback").click();
    await page.getByTestId("rollback-confirm").click();
    await page.locator('[data-testid="rollback-result"][data-status="ROLLED_BACK"]').waitFor({ timeout: 30_000 });
    await back(page);
    await page.locator('[data-testid="installed-space"][data-version="1.0.0"]').waitFor({ timeout: 30_000 });
    assert.equal(await page.getByTestId("operation-pay-1").getAttribute("data-status"), "HELD");
    evidence.push("rollback:1.0.0", "pay-1:HELD");

    // Revoked update refused (signed rotation + revocation applied on the device).
    await page.addScriptTag({ content: harness });
    await page.evaluate(async (statements) => {
      const S = (window as unknown as { SpacePackage: typeof import("../../packages/space-package/src/index.js") }).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      try { for (const text of statements) await runtime.applyTrustStatement(new TextEncoder().encode(text)); } finally { runtime.close(); }
    }, [await readFile(fixtures.files["rotation-k1-k2.json"]!, "utf8"), await readFile(fixtures.files["revoke-k1.json"]!, "utf8")]);
    await page.getByTestId("installed-update").click();
    await page.getByTestId("update-drop-input").setInputFiles([await file(fixtures, "lantern-2.0.0.update.json"), await file(fixtures, "lantern-2.0.0.space")]);
    await page.getByTestId("update-check").waitFor({ timeout: 30_000 });
    const refused = await page.getByTestId("update-check").getAttribute("data-code");
    assert.equal(await page.getByTestId("update-check").getAttribute("data-acceptable"), "false");
    evidence.push(`revoked-update:${refused}`);

    // Back out of the installer to Xperience Space.
    await back(page); await back(page);
    const leftInstaller = (await page.getByTestId("space-installer").count()) === 0;
    evidence.push(`back-exits-installer:${leftInstaller}`);
    const external = requests.filter((url) => !url.startsWith("https://localhost/"));
    evidence.push(`offline-requests-non-local:${external.length}${external.length ? `[${external.map((url) => new URL(url).host + new URL(url).pathname).join(" ")}]` : ""}`);
    console.log("SP3_ANDROID", ...evidence);
    assert.equal(leftInstaller, true);
  } catch (error) {
    const screen = await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].filter((node) => (node as HTMLElement).offsetParent !== null).slice(0, 12).map((node) => node.getAttribute("data-testid")).join(",")).catch(() => "?");
    console.log("SP3_ANDROID_PARTIAL", ...evidence, `visible:${screen}`);
    throw error;
  } finally {
    adb("shell", "cmd", "connectivity", "airplane-mode", "disable");
    await browser.close().catch(() => undefined);
    try { adb("forward", "--remove", `tcp:${PORT}`); } catch { /* none */ }
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
});
