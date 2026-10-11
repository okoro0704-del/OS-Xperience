import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  LANTERN,
  buildFixtures,
  check,
  hermetic,
  importToTrust,
  loadHarness,
  openSpaceScreen,
  seedTrust,
  serveApp,
  type Fixtures,
} from "./space-installer-harness.js";

/**
 * SP3 — the graphical Space installer and lifecycle manager, exercised in a real browser against the
 * built OS Xperience. Trust anchors are synthetic Lantern test keys seeded into this profile only.
 */
type Harness = Window & { SpacePackage: typeof import("../../packages/space-package/src/index.js"); __pwned?: unknown };

let chromium: typeof import("playwright").chromium | null = null;
let browser: Browser | null = null;
let app: Awaited<ReturnType<typeof serveApp>>;
let fixtures: Fixtures;
let scratch: string;

before(async () => {
  try { ({ chromium } = await import("playwright")); } catch { chromium = null; return; }
  scratch = await mkdtemp(join(tmpdir(), "ox-sp3-"));
  fixtures = await buildFixtures(join(scratch, "files"));
  app = await serveApp();
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await app?.close();
  if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
});

async function freshPage(options: { trust?: boolean; init?: string; profile?: string; beforeLoad?: (page: Page) => Promise<void> } = {}): Promise<{ context: BrowserContext; page: Page; external: string[] }> {
  const viewport = { width: 1280, height: 860 };
  const context = options.profile ? await chromium!.launchPersistentContext(options.profile, { headless: true, viewport }) : await browser!.newContext({ viewport });
  const external = await hermetic(context);
  // tsx names functions with an `__name` helper; page.evaluate bodies need it defined in the page.
  await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  const page = await context.newPage();
  if (options.init) await page.addInitScript(options.init);
  await options.beforeLoad?.(page);
  await page.goto(`${app.base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 20_000 });
  if (options.trust !== false) await seedTrust(page, fixtures.trust);
  return { context, page, external };
}

async function installViaUi(page: Page, file: string) {
  await importToTrust(page, file);
  assert.equal((await check(page, "eligibility")).status, "PASS", "eligible");
  await page.getByTestId("trust-install").click();
  await page.getByTestId("install-confirm").click();
  await page.getByTestId("install-result").waitFor({ timeout: 20_000 });
  assert.equal(await page.getByTestId("install-result").getAttribute("data-status"), "INSTALLED");
  await page.getByTestId("install-continue").click();
  await page.locator('[data-testid="installed-space"][data-health="HEALTHY"]').waitFor({ timeout: 20_000 });
}

async function dropUpdate(page: Page, doc: string, pkg: string) {
  await page.getByTestId("installed-update").click();
  await page.getByTestId("update-drop-input").setInputFiles([fixtures.files[doc]!, fixtures.files[pkg]!]);
  await page.getByTestId("update-check").waitFor({ timeout: 20_000 });
  const node = page.getByTestId("update-check");
  return { acceptable: await node.getAttribute("data-acceptable"), code: await node.getAttribute("data-code") };
}

async function bytesOf(name: string) {
  return [...(await readFile(fixtures.files[name]!))];
}

async function noticeCode(page: Page) {
  await page.getByTestId("installer-notice").waitFor({ timeout: 20_000 }).catch(async (error) => { console.log("NOTICE_DEBUG", await page.getByTestId("space-installer").innerText().catch(() => "?")); throw error; });
  return page.getByTestId("installer-notice").getAttribute("data-code");
}

const skip = (t: test.TestContext) => { if (!browser) { t.skip("playwright unavailable"); return true; } return false; };

test("SP3 import: content decides the format; launch files keep their path; ambiguous and unknown input is refused", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page } = await freshPage();
  try {
    await openSpaceScreen(page);

    // A Space Launch File (JSON) stays on the existing launch-file path; the installer never opens.
    await page.getByTestId("space-import-input").setInputFiles("apps/os-experience/public/spaces/mrfundzman.space");
    await page.getByTestId("space-import-status").waitFor();
    const launchCode = await page.getByTestId("space-import-status").getAttribute("data-code");
    assert.notEqual(launchCode, "IMPORT_FAILED");
    assert.equal(await page.getByTestId("space-installer").count(), 0, "a launch file never opens the package installer");

    // A package named .json is still a package: identified by its contents.
    await page.getByTestId("space-import-input").setInputFiles(fixtures.files["lantern-renamed.json"]!);
    await page.getByTestId("space-installer").waitFor();
    await page.waitForFunction(() => /portable Space package/.test(document.querySelector('[data-testid="inspect-kind"]')?.textContent ?? ""), undefined, { timeout: 20_000 });
    assert.equal(await page.evaluate(() => (window as Window & { __oxHardwareBack?: () => boolean }).__oxHardwareBack?.()), true, "Android Back walks the installer");
    assert.equal(await page.getByTestId("space-installer").getAttribute("data-view"), "import");
    assert.equal(await page.evaluate(() => (window as Window & { __oxHardwareBack?: () => boolean }).__oxHardwareBack?.()), true);
    await page.getByTestId("xperience-space").waitFor();

    // JSON with a ZIP directory appended could be read two ways: refused.
    await page.getByTestId("space-import-input").setInputFiles(fixtures.files["polyglot.space"]!);
    await page.getByTestId("space-package-notice").waitFor();
    assert.equal(await page.getByTestId("space-installer").count(), 0);

    // Neither format: the existing launch-file path refuses it as before.
    await page.getByTestId("space-import-input").setInputFiles(fixtures.files["not-a-space.space"]!);
    await page.waitForFunction((previous) => document.querySelector('[data-testid="space-import-status"]')?.getAttribute("data-code") !== previous, launchCode);
    const unknownCode = await page.getByTestId("space-import-status").getAttribute("data-code");
    assert.notEqual(unknownCode, "REGISTERED");
    assert.equal(await page.getByTestId("space-installer").count(), 0);

    // Drag-and-drop onto the Space import area routes the same way.
    const bytes = await bytesOf("lantern-1.0.0.space");
    await page.evaluate((data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(data)], "dropped.bin", { type: "application/octet-stream" }));
      const zone = document.querySelector('[data-testid="space-import-zone"]')!;
      zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, bytes);
    await page.locator('[data-testid="space-installer"][data-view="inspect"]').waitFor();
    console.log("SP3_IMPORT_ROUTING", `launch-file:${launchCode}`, "renamed-package:INSTALLER", "polyglot:REFUSED", `plain-text:${unknownCode}`, "drop:INSTALLER");
  } finally {
    await context.close();
  }
});

test("SP3 trust: tampering, unknown publishers and missing trust fail closed; each check is reported separately", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page } = await freshPage();
  try {
    await openSpaceScreen(page);
    await importToTrust(page, fixtures.files["lantern-1.0.0.space"]!);
    const good = Object.fromEntries(await Promise.all(["integrity", "signature", "publisher", "revocation", "permissions", "compatibility", "eligibility"].map(async (name) => [name, (await check(page, name)).status])));
    assert.deepEqual(good, { integrity: "PASS", signature: "PASS", publisher: "PASS", revocation: "WARN", permissions: "PASS", compatibility: "PASS", eligibility: "PASS" }, "revocation is honestly UNKNOWN until a list is received");
    await page.getByTestId("trust-cancel").click();
    await page.getByTestId("xperience-space").waitFor();

    await importToTrust(page, fixtures.files["lantern-tampered.space"]!);
    const tampered = await check(page, "integrity");
    assert.equal(tampered.status, "FAIL");
    assert.equal((await check(page, "eligibility")).status, "FAIL");
    assert.equal(await page.getByTestId("trust-install").isDisabled(), true);
    await page.getByTestId("trust-cancel").click();

    await importToTrust(page, fixtures.files["lantern-stranger.space"]!);
    const stranger = await check(page, "publisher");
    assert.deepEqual(stranger, { status: "FAIL", code: "PUBLISHER_UNKNOWN" });
    assert.equal((await check(page, "signature")).status, "NOT_EVALUATED");
    assert.equal(await page.getByTestId("trust-install").isDisabled(), true);
    await page.getByTestId("trust-cancel").click();

    // A device holding no trust anchors trusts nothing, including the genuine Lantern package.
    await seedTrust(page, null);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible" });
    await openSpaceScreen(page);
    await importToTrust(page, fixtures.files["lantern-1.0.0.space"]!);
    assert.deepEqual(await check(page, "publisher"), { status: "FAIL", code: "PUBLISHER_UNKNOWN" });
    assert.equal(await page.getByTestId("trust-install").isDisabled(), true);
    console.log("SP3_TRUST", `tampered:${tampered.code}`, `stranger:${stranger.code}`, "no-anchors:PUBLISHER_UNKNOWN", "install-disabled:true");
  } finally {
    await context.close();
  }
});

test("SP3 ZIP decompression attacks are refused before anything is stored", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page } = await freshPage();
  try {
    await openSpaceScreen(page);
    const codes: string[] = [];
    for (const name of ["bomb-ratio.space", "bomb-liar.space"]) {
      await importToTrust(page, fixtures.files[name]!);
      const structure = await check(page, "structure");
      assert.equal(structure.status, "FAIL", name);
      assert.equal(await page.getByTestId("trust-install").isDisabled(), true);
      codes.push(`${name}:${structure.code}`);
      await page.getByTestId("trust-cancel").click();
      await page.getByTestId("xperience-space").waitFor();
    }
    assert.equal(await page.locator('[data-testid^="portable-space-"]').count(), 0, "nothing installed");
    console.log("SP3_DECOMPRESSION", ...codes);
  } finally {
    await context.close();
  }
});

test("SP3 rendering: validated content only, typed blob URLs, no iframes, markup shown as text", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page, external } = await freshPage();
  try {
    await openSpaceScreen(page);
    await installViaUi(page, fixtures.files["isolation.space"]!);
    const framesBefore = page.frames().length;
    const externalBefore = external.length;
    await page.getByTestId("installed-open").click();
    await page.getByTestId("package-text-notes").waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => (document.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement | null)?.naturalWidth! > 0);
    const probe = await page.evaluate(() => {
      const renderer = document.querySelector('[data-testid="package-renderer"]')!;
      return {
        iframes: renderer.querySelectorAll("iframe, object, embed, script").length,
        imgSrc: (renderer.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement).src,
        audioSrc: (renderer.querySelector('[data-testid="package-audio-chime"]') as HTMLAudioElement).src,
        text: renderer.querySelector('[data-testid="package-text-notes"]')!.textContent,
        imgs: renderer.querySelectorAll("img").length,
        pwned: (window as unknown as Harness).__pwned ?? null,
      };
    });
    assert.equal(await page.evaluate(() => (window as Window & { __oxExperienceActive?: boolean }).__oxExperienceActive), true, "a rendered package is an active experience (native escape reaches it)");
    assert.equal(probe.iframes, 0);
    assert.match(probe.imgSrc, /^blob:/);
    assert.match(probe.audioSrc, /^blob:/);
    assert.match(probe.text ?? "", /^<script>window.__pwned = 1<\/script><img/);
    assert.equal(probe.imgs, 1, "only the verified image is an image");
    assert.equal(probe.pwned, null);
    assert.equal(page.frames().length, framesBefore, "no frame was created");
    // fetch(blob:) needs connect-src blob:, which the candidate CSP deliberately omits; a CSP build is covered
    // by space-installer-csp-web.test.ts instead.
    const underCsp = await page.evaluate(() => Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]')));
    if (!underCsp) {
      const blobType = await page.evaluate(async (src) => (await fetch(src)).headers.get("content-type"), probe.imgSrc);
      assert.equal(blobType, "image/png", "blob typed from the verified manifest");
    }

    // Closing revokes the object URLs.
    await page.getByTestId("package-renderer-close").click();
    await page.getByTestId("package-renderer").waitFor({ state: "detached" });
    if (!underCsp) {
      const revoked = await page.evaluate(async (src) => { try { await fetch(src); return false; } catch { return true; } }, probe.imgSrc);
      assert.equal(revoked, true, "object URL revoked");
    }
    assert.deepEqual(external.slice(externalBefore), [], "opening the Space made no external request");
    console.log("SP3_RENDER_ISOLATION", "iframes:0", "scripts:0", "img:blob:image/png", "markup:TEXT", "pwned:none", "urls-revoked:true");
  } finally {
    await context.close();
  }
});

test("SP3 permissions: an update requesting a new permission needs explicit approval", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page } = await freshPage();
  try {
    await openSpaceScreen(page);
    await installViaUi(page, fixtures.files["lantern-1.0.0.space"]!);
    const result = await dropUpdate(page, "lantern-2.0.0-wider.update.json", "lantern-2.0.0-wider.space");
    assert.deepEqual(result, { acceptable: "false", code: "PERMISSION_ESCALATION" });
    await page.getByTestId("permission-approval").waitFor();
    // Applying without approving is refused by the engine itself.
    await page.getByTestId("update-apply").click();
    assert.equal(await noticeCode(page), "PERMISSION_ESCALATION");
    await page.getByTestId("approve-storage.local").check();
    await page.getByTestId("update-apply").click();
    await page.locator('[data-testid="update-result"][data-state="ACTIVE"]').waitFor({ timeout: 30_000 });
    await page.getByTestId("installer-back").click();
    await page.locator('[data-testid="installed-space"][data-version="2.0.0"]').waitFor();
    // My Xperience lists the same installation and opens it in the installer.
    await page.locator('[data-testid="nav-my-experience"]:visible').first().click();
    await page.getByTestId("my-experience").waitFor();
    await page.getByTestId(`portable-space-${LANTERN}`).getByRole("button").click();
    await page.locator('[data-testid="installed-space"][data-version="2.0.0"]').waitFor();
    console.log("SP3_PERMISSIONS", "unapproved:PERMISSION_ESCALATION", "approved:ACTIVE", "my-xperience:LISTED");
  } finally {
    await context.close();
  }
});

test("SP3 revocation freshness: security-sensitive updates need CURRENT revocation evidence", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page } = await freshPage();
  try {
    await openSpaceScreen(page);
    await installViaUi(page, fixtures.files["lantern-1.0.0.space"]!);
    const unknown = await dropUpdate(page, "lantern-2.0.0-sensitive.update.json", "lantern-2.0.0.space");
    assert.equal(unknown.acceptable, "false", "UNKNOWN revocation status fails closed");

    // Receive a signed (empty) revocation list from the publisher's trusted key: evidence becomes CURRENT.
    await loadHarness(page);
    const { k1 } = fixtures;
    await page.evaluate(async (key) => {
      const S = (window as unknown as Harness).SpacePackage;
      const list = await S.signStatement({ format: "digiconomy.space-key-revocations", formatVersion: 1, publisherId: "digiconomy.demo", sequence: 1, issuedAt: new Date().toISOString(), revokedKeyIds: [], authorizedBy: { keyId: key.keyId } } as never, key);
      const runtime = await S.BrowserSpaceRuntime.create();
      await runtime.applyTrustStatement(new TextEncoder().encode(JSON.stringify(list)));
      runtime.close();
    }, k1);
    // STALE: the same evidence seen eight days later is not CURRENT.
    const stale = await page.evaluate(async ({ doc, pkg }) => {
      const S = (window as unknown as Harness).SpacePackage;
      const later = new Date(Date.now() + 8 * 86_400_000);
      const runtime = await S.BrowserSpaceRuntime.create({ now: () => later });
      const result = await runtime.inspectUpdate(new Uint8Array(doc), new Uint8Array(pkg), []);
      runtime.close();
      return "code" in result ? result.code : "ACCEPTED";
    }, { doc: await bytesOf("lantern-2.0.0-sensitive.update.json"), pkg: await bytesOf("lantern-2.0.0.space") });
    assert.notEqual(stale, "ACCEPTED", "STALE evidence fails closed");
    await page.getByTestId("update-drop-input").setInputFiles([fixtures.files["lantern-2.0.0-sensitive.update.json"]!, fixtures.files["lantern-2.0.0.space"]!]);
    await page.locator('[data-testid="update-check"][data-acceptable="true"]').waitFor({ timeout: 20_000 });
    console.log("SP3_REVOCATION_FRESHNESS", `unknown:${unknown.code}`, `stale:${stale}`, "current:ACCEPTED");
  } finally {
    await context.close();
  }
});

test("SP3 browser support: no Web Locks means read-only; no Ed25519 means no verification; no storage is explained", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const results: string[] = [];
  {
    const { context, page } = await freshPage({ init: "Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true });" });
    try {
      await openSpaceScreen(page);
      await importToTrust(page, fixtures.files["lantern-1.0.0.space"]!);
      await page.getByTestId("installer-readonly").waitFor();
      assert.equal((await check(page, "signature")).status, "PASS", "verification still works");
      assert.equal(await page.getByTestId("trust-install").isDisabled(), true, "but nothing may change without cross-tab coordination");
      results.push("no-web-locks:READ_ONLY");
    } finally { await context.close(); }
  }
  {
    // Ed25519 refused by WebCrypto: the RFC 8032 self-test fails, so nothing is verified or installed.
    const init = `(() => { const original = SubtleCrypto.prototype.importKey; SubtleCrypto.prototype.importKey = function (format, data, algorithm, ...rest) {
      const name = typeof algorithm === "string" ? algorithm : algorithm && algorithm.name;
      if (name === "Ed25519") return Promise.reject(new DOMException("Unrecognized name", "NotSupportedError"));
      return original.call(this, format, data, algorithm, ...rest); }; })();`;
    const { context, page } = await freshPage({ init });
    try {
      await openSpaceScreen(page);
      await page.getByTestId("space-import-input").setInputFiles(fixtures.files["lantern-1.0.0.space"]!);
      await page.getByTestId("installer-unsupported").waitFor({ timeout: 20_000 });
      assert.match(await page.getByTestId("installer-unsupported").innerText(), /Ed25519/i);
      results.push("no-ed25519:UNSUPPORTED");
    } finally { await context.close(); }
  }
  {
    // IndexedDB refuses the package database (e.g. storage disabled): the installer says so and stores nothing.
    const init = `(() => { const original = IDBFactory.prototype.open; IDBFactory.prototype.open = function (name, ...rest) {
      if (name === "digiconomy-space-packages") throw new DOMException("blocked", "SecurityError");
      return original.call(this, name, ...rest); }; })();`;
    const { context, page } = await freshPage({ init, trust: false });
    try {
      await openSpaceScreen(page);
      await page.getByTestId("open-installer").click();
      await page.getByTestId("installer-unavailable").waitFor();
      await page.waitForFunction(() => !/Preparing/.test(document.querySelector('[data-testid="installer-unavailable"]')?.textContent ?? "Preparing"));
      results.push(`no-storage:${JSON.stringify(await page.getByTestId("installer-unavailable").innerText())}`);
    } finally { await context.close(); }
  }
  console.log("SP3_PLATFORM_SUPPORT", ...results);
});

test("SP3 storage: quota exhaustion installs nothing; a retry with room succeeds; lost artifacts are never reported healthy", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  // Chromium enforces a CDP quota override only for a real (non-incognito) profile.
  // The override must be in place before the origin first uses storage, or Chromium keeps its cached quota.
  let cdp: import("playwright").CDPSession | null = null;
  const { context, page } = await freshPage({
    profile: await mkdtemp(join(scratch, "quota-")),
    beforeLoad: async (target) => { cdp = await target.context().newCDPSession(target); await cdp.send("Storage.overrideQuotaForOrigin", { origin: app.base, quotaSize: 500_000 }); },
  });
  try {
    await openSpaceScreen(page);
    await importToTrust(page, fixtures.files["large.space"]!);
    await page.getByTestId("trust-install").click();
    await page.getByTestId("install-confirm").click();
    const code = await noticeCode(page);
    assert.equal(code, "STORAGE_QUOTA_EXCEEDED");
    await loadHarness(page);
    const after = await page.evaluate(async () => {
      const S = (window as unknown as Harness).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      const records = await runtime.installations();
      runtime.close();
      return records.length;
    });
    assert.equal(after, 0, "no partial installation exists");

    // Room again: the same button retries and the installation is complete.
    await cdp!.send("Storage.overrideQuotaForOrigin", { origin: app.base });
    await page.getByTestId("install-confirm").click();
    await page.getByTestId("install-result").waitFor({ timeout: 20_000 });
    await page.getByTestId("install-continue").click();
    await page.locator('[data-testid="installed-space"][data-health="HEALTHY"]').waitFor();

    // Storage loses one asset row (eviction, manual clearing): never shown as healthy, never opened.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("digiconomy-space-packages", 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("assets", "readwrite");
        const store = tx.objectStore("assets");
        const keys = store.getAllKeys();
        keys.onsuccess = () => { const key = (keys.result as string[]).find((item) => item.startsWith("org.digiconomy.demo.large") && item.endsWith("lantern.png")); if (key) store.delete(key); };
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible" });
    await openSpaceScreen(page);
    await page.getByTestId("portable-space-org.digiconomy.demo.large").getByRole("button").click();
    await page.locator('[data-testid="installed-space"][data-health="MISSING_RELEASE"]').waitFor({ timeout: 20_000 });
    assert.equal(await page.getByTestId("installed-open").isDisabled(), true);
    await page.getByTestId("installed-recovery").click();
    assert.match(await page.getByTestId("recovery-missing").innerText(), /lantern\.png/);
    // Importing the identical package restores the lost part; state is untouched.
    await page.getByTestId("repair-drop-input").setInputFiles(fixtures.files["large.space"]!);
    await page.locator('[data-testid="recovery-health"][data-status="HEALTHY"]').waitFor({ timeout: 20_000 });
    console.log("SP3_STORAGE", `quota:${code}`, "partial-records:0", "retry:INSTALLED", "lost-asset:MISSING_RELEASE", "open:DISABLED", "repair:HEALTHY");
  } finally {
    await context.close();
  }
});

/** Drives the real engine on the app's IndexedDB with a crash failpoint, as a dying tab would. */
async function crashDuringActivation(page: Page, point: string) {
  await loadHarness(page);
  return page.evaluate(async ({ point, doc, pkg }) => {
    const S = (window as unknown as Harness).SpacePackage;
    const backend = new S.IndexedDbLifecycleBackend();
    const trust = (await backend.readTrust())!;
    const lifecycle = new S.SpaceLifecycle(backend, { trust: () => trust, runtime: { version: S.SPACE_RUNTIME_VERSION }, failpoint: (at) => { if (at === point) throw new S.SimulatedCrash(at); } });
    const staged = await lifecycle.stageUpdate(new Uint8Array(doc), new Uint8Array(pkg));
    await lifecycle.verifyUpdate(staged.packageId, staged.txId);
    await lifecycle.prepareMigration(staged.packageId, staged.txId);
    let crashed = "";
    try { await lifecycle.activate(staged.packageId, staged.txId); } catch (error) { crashed = (error as Error).name; }
    backend.close();
    return crashed;
  }, { point, doc: await bytesOf("lantern-2.0.0.update.json"), pkg: await bytesOf("lantern-2.0.0.space") });
}

test("SP3 interrupted activation: recovery returns to V1 before the commit point and completes V2 after it", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const outcomes: string[] = [];
  for (const [point, expected] of [["release-written", "1.0.0"], ["record-committed", "2.0.0"]] as const) {
    const { context, page } = await freshPage();
    try {
      await openSpaceScreen(page);
      await installViaUi(page, fixtures.files["lantern-1.0.0.space"]!);
      assert.equal(await crashDuringActivation(page, point), "SimulatedCrash");
      // The tab dies; a new one opens the installer and recovers.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="os-experience"]', { state: "visible" });
      await openSpaceScreen(page);
      await page.getByTestId(`portable-space-${LANTERN}`).getByRole("button").click();
      await page.getByTestId("installed-space").waitFor();
      await page.getByTestId("installed-recovery").click();
      await page.getByTestId("recovery-run").click();
      await page.getByTestId("recovery-result").waitFor({ timeout: 20_000 });
      const recovered = await page.getByTestId("recovery-result").innerText();
      await page.locator('[data-testid="recovery-health"][data-status="HEALTHY"]').waitFor({ timeout: 20_000 });
      await page.getByTestId("installer-back").click();
      await page.locator(`[data-testid="installed-space"][data-version="${expected}"][data-health="HEALTHY"]`).waitFor({ timeout: 20_000 });
      // A second recovery is a no-op (idempotent).
      await page.getByTestId("installed-recovery").click();
      await page.getByTestId("recovery-run").click();
      await page.waitForFunction(() => document.querySelector('[data-testid="recovery-result"]')?.getAttribute("data-recovered") === "0");
      outcomes.push(`${point}:${recovered.replace(/\s+/g, " ")}=>${expected}`);
    } finally { await context.close(); }
  }
  console.log("SP3_INTERRUPTED_ACTIVATION", ...outcomes, "second-recovery:NOOP");
});

test("SP3 concurrent tabs: mutations serialize across tabs; other tabs refresh; a held lock reports LIFECYCLE_BUSY", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page } = await freshPage();
  try {
    const tabA = await context.newPage();
    const tabB = await context.newPage();
    for (const tab of [tabA, tabB]) { await tab.goto(`${app.base}/`, { waitUntil: "domcontentloaded" }); await loadHarness(tab); }
    await openSpaceScreen(page);

    // Two tabs install the same package at the same instant: one installation results.
    const v1 = await bytesOf("lantern-1.0.0.space");
    const install = (tab: Page) => tab.evaluate(async (bytes) => {
      const S = (window as unknown as Harness).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      try { return (await runtime.install(new Uint8Array(bytes))).status; } finally { runtime.close(); }
    }, v1);
    const statuses = (await Promise.all([install(tabA), install(tabB)])).sort();
    assert.deepEqual(statuses, ["ALREADY_INSTALLED", "INSTALLED"]);
    // The UI tab learns of it without a reload (BroadcastChannel).
    await page.getByTestId(`portable-space-${LANTERN}`).waitFor({ timeout: 10_000 });

    // Both tabs try to apply the same update: exactly one activation; the other is refused, nothing corrupt.
    const update = { doc: await bytesOf("lantern-2.0.0.update.json"), pkg: await bytesOf("lantern-2.0.0.space") };
    const apply = (tab: Page) => tab.evaluate(async ({ doc, pkg }) => {
      const S = (window as unknown as Harness).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      try {
        const staged = await runtime.stageUpdate(new Uint8Array(doc), new Uint8Array(pkg));
        const verified = await runtime.verifyUpdate(staged.packageId, staged.txId, []);
        if (verified.state !== "VERIFIED") return verified.state;
        return (await runtime.activateUpdate(staged.packageId, staged.txId)).state;
      } catch (error) { return (error as { code?: string }).code ?? String(error); } finally { runtime.close(); }
    }, update);
    const raced = await Promise.all([apply(tabA), apply(tabB)]);
    assert.equal(raced.filter((state) => state === "ACTIVE").length, 1, `one activation: ${raced}`);
    const final = await tabA.evaluate(async (id) => {
      const S = (window as unknown as Harness).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      try {
        const history = await runtime.lifecycle.history(id);
        return { version: (await runtime.lifecycle.record(id)).active.version, health: (await runtime.health(id)).status, states: history.map((tx) => tx.state).sort() };
      } finally { runtime.close(); }
    }, LANTERN);
    assert.deepEqual({ version: final.version, health: final.health }, { version: "2.0.0", health: "HEALTHY" });
    console.log("SP3_RACE_TRANSACTIONS", final.states.join(","));
    assert.ok(final.states.every((state) => ["ACTIVE", "REJECTED", "INTERRUPTED", "ROLLED_BACK"].includes(state)), `no unfinished transaction: ${final.states}`);

    // Tab A holds the lifecycle lock (a long mutation); tab B waits, then reports busy instead of racing.
    await tabA.evaluate(() => { void navigator.locks.request("digiconomy-space-lifecycle", () => new Promise((resolve) => setTimeout(resolve, 20_000))); });
    const busy = await tabB.evaluate(async (bytes) => {
      const S = (window as unknown as Harness).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      try { await runtime.install(new Uint8Array(bytes)); return "NO_WAIT"; } catch (error) { return (error as { code?: string }).code; } finally { runtime.close(); }
    }, v1);
    assert.equal(busy, "LIFECYCLE_BUSY");
    console.log("SP3_CONCURRENT_TABS", `install-race:${statuses.join("+")}`, `update-race:${raced.join("+")}`, "ui-refresh:BROADCAST", `held-lock:${busy}`);
  } finally {
    await context.close();
  }
});

test("SP3 Lantern journey: import V1 → verify → install → open → offline restart → restore → V2 → preserved state → rollback → revoked update refused", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const profile = await mkdtemp(join(scratch, "journey-"));
  const server = await serveApp();
  const viewport = { width: 1280, height: 860 };
  const launch = async (offline: boolean) => {
    const context = await chromium!.launchPersistentContext(profile, { headless: true, viewport, offline });
    const external = await hermetic(context);
    await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
    const page = context.pages()[0] ?? (await context.newPage());
    return { context, page, external };
  };
  const evidence: string[] = [];
  let { context, page } = await launch(false);
  try {
    // ── Online: the shell is cached by its service worker, as on any installed PWA.
    await page.goto(`${server.base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 20_000 });
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => undefined), new Promise((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 30_000))]));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 20_000 });
    await seedTrust(page, fixtures.trust);

    // Import V1 → Verify → Install.
    await openSpaceScreen(page);
    await importToTrust(page, fixtures.files["lantern-1.0.0.space"]!);
    const checks = await Promise.all(["integrity", "signature", "publisher", "revocation", "permissions", "compatibility", "eligibility"].map(async (name) => `${name}=${(await check(page, name)).status}`));
    evidence.push(`verify:${checks.join(",")}`);
    await page.getByTestId("trust-install").click();
    await page.getByTestId("install-confirm").click();
    await page.getByTestId("install-continue").click();
    const installed = page.locator('[data-testid="installed-space"][data-health="HEALTHY"]');
    await installed.waitFor({ timeout: 20_000 });
    const installationId = await installed.getAttribute("data-installation-id");
    assert.equal(await installed.getAttribute("data-version"), "1.0.0");
    evidence.push(`install:1.0.0:${installationId}`);

    // Open (online).
    await page.getByTestId("installed-open").click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement | null)?.naturalWidth! > 0, undefined, { timeout: 20_000 });
    await page.getByTestId("package-renderer-close").click();
    evidence.push("open-online:RENDERED");

    // The person uses the Space: a preference, a playlist and a pending payment request (consequential).
    await loadHarness(page);
    await page.evaluate(async (id) => {
      const S = (window as unknown as Harness).SpacePackage;
      const runtime = await S.BrowserSpaceRuntime.create();
      try {
        await runtime.writeState(id, (state) => ({
          ...state,
          preferences: { ...state.preferences, theme: "dusk" },
          playlists: [{ id: "evening", title: "Evening", items: ["lantern", "chime"] }],
          pendingOperations: [{ opId: "pay-1", kind: "payment.request", consequential: true, status: "PENDING", createdAt: new Date().toISOString(), payload: { amount: 5 } }],
        }));
      } finally { runtime.close(); }
    }, LANTERN);

    // ── Go offline: stop the browser, take the server away, start again with no network.
    await page.goto(`${server.base}/`, { waitUntil: "domcontentloaded" });
    // The shell's service worker caches its bundle as it is fetched (without waitUntil); going offline is only
    // meaningful once the shell is actually in the cache, so wait for that rather than racing the write.
    await page.waitForFunction(async () => {
      const cache = await caches.open("os-experience-shell-v3");
      const paths = (await cache.keys()).map((request) => new URL(request.url).pathname);
      const scripts = [...document.querySelectorAll("script[src], link[rel=stylesheet]")].map((node) => new URL((node as HTMLScriptElement).src || (node as HTMLLinkElement).href).pathname);
      return scripts.every((path) => paths.includes(path)) && paths.includes("/index.html");
    }, undefined, { timeout: 20_000, polling: 250 });
    await context.close();
    await server.close();
    ({ context, page } = await launch(true));
    const offlineRequests: string[] = [];
    page.on("request", (request) => { if (!/^(blob|data):/.test(request.url())) offlineRequests.push(request.url()); });
    await page.goto(`${server.base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 20_000 });
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    const shellRequests = offlineRequests.length;

    // Restart → Restore: the installation, its identity and its state come back from this device alone.
    await openSpaceScreen(page);
    await page.getByTestId(`portable-space-${LANTERN}`).getByRole("button").click();
    const restored = page.locator('[data-testid="installed-space"][data-health="HEALTHY"]');
    await restored.waitFor({ timeout: 20_000 });
    assert.equal(await restored.getAttribute("data-installation-id"), installationId);
    assert.match(await page.getByTestId("local-state-summary").innerText(), /1 preferences · 1 playlists · 0 of your items · 1 pending operations/);
    assert.equal(await page.getByTestId("operation-pay-1").getAttribute("data-status"), "PENDING");
    await page.getByTestId("installed-open").click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement | null)?.naturalWidth! > 0, undefined, { timeout: 20_000 });
    assert.equal(await page.locator('[data-testid="package-renderer"]').getAttribute("data-state"), "READY");
    // Two-finger escape leaves the Space for OS Xperience Home.
    await page.evaluate(() => window.dispatchEvent(new Event("ox-experience-escape")));
    await page.getByTestId("package-renderer").waitFor({ state: "detached" });
    await page.getByTestId("home").waitFor();
    evidence.push(`offline-restore:${installationId}:HEALTHY`, "open-offline:RENDERED", "escape:HOME");

    // Stage V2 → Activate (offline: the update arrives as files).
    await openSpaceScreen(page);
    await page.getByTestId(`portable-space-${LANTERN}`).getByRole("button").click();
    await restored.waitFor();
    await page.getByTestId("installed-update").click();
    await page.getByTestId("update-drop-input").setInputFiles([fixtures.files["lantern-2.0.0.update.json"]!, fixtures.files["lantern-2.0.0.space"]!]);
    await page.locator('[data-testid="update-check"][data-acceptable="true"]').waitFor({ timeout: 20_000 });
    await page.getByTestId("update-apply").click();
    await page.locator('[data-testid="update-result"][data-state="ACTIVE"]').waitFor({ timeout: 30_000 });
    await page.getByTestId("installer-back").click();

    // Verify preserved state: same installation, migrated (data version 2), nothing lost.
    const updated = page.locator('[data-testid="installed-space"][data-version="2.0.0"][data-health="HEALTHY"]');
    await updated.waitFor({ timeout: 20_000 });
    assert.equal(await updated.getAttribute("data-installation-id"), installationId);
    assert.equal(await page.getByTestId("local-state").getAttribute("data-data-version"), "2");
    assert.match(await page.getByTestId("local-state-summary").innerText(), /2 preferences · 1 playlists · 0 of your items · 1 pending operations/);
    assert.equal(await page.getByTestId("operation-pay-1").getAttribute("data-status"), "PENDING");
    await page.getByTestId("installed-open").click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement | null)?.naturalWidth! > 0, undefined, { timeout: 20_000 });
    await page.getByTestId("package-renderer-close").click();
    evidence.push(`update:2.0.0:${installationId}`, "state:dataVersion=2,preferences=2,playlists=1,pay-1=PENDING");

    // Rollback: back on V1, state kept, the payment request HELD — never replayed by itself.
    await page.getByTestId("installed-rollback").click();
    await page.getByTestId("rollback-confirm").click();
    await page.locator('[data-testid="rollback-result"][data-status="ROLLED_BACK"]').waitFor({ timeout: 20_000 });
    await page.getByTestId("installer-back").click();
    const rolled = page.locator('[data-testid="installed-space"][data-version="1.0.0"]');
    await rolled.waitFor({ timeout: 20_000 });
    assert.equal(await rolled.getAttribute("data-installation-id"), installationId);
    assert.equal(await page.getByTestId("operation-pay-1").getAttribute("data-status"), "HELD");
    await page.getByTestId("reconfirm-pay-1").waitFor();
    assert.match(await page.getByTestId("local-state-summary").innerText(), /1 playlists/);
    evidence.push("rollback:1.0.0", "pay-1:HELD (awaiting explicit reconfirmation)");

    // Reject revoked update: the publisher rotates to a new key and revokes the old one (signed statements).
    await page.getByTestId("installer-back").click();
    await page.getByTestId("xperience-space").waitFor();
    await importToTrust(page, fixtures.files["lantern-1.0.0.space"]!);
    assert.deepEqual(await check(page, "eligibility"), { status: "WARN", code: "ALREADY_INSTALLED" });
    // Each applied statement re-runs verification (the checks unmount, then return).
    const applyStatement = async (name: string) => {
      const stale = await page.getByTestId("check-eligibility").elementHandle();
      await page.getByTestId("trust-drop-input").setInputFiles(fixtures.files[name]!);
      await stale!.waitForElementState("hidden", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForFunction(() => !document.querySelector('[data-testid="installer-busy"]') && !!document.querySelector('[data-testid="check-eligibility"]'), undefined, { timeout: 20_000 });
      const notice = await page.getByTestId("installer-notice").getAttribute("data-code").catch(() => null);
      assert.equal(notice, null, `${name} applied without error`);
    };
    await applyStatement("rotation-k1-k2.json");
    await applyStatement("revoke-k1.json");
    await page.locator('[data-testid="check-signature"][data-code="KEY_REVOKED"]').waitFor({ timeout: 20_000 });
    assert.equal(await page.getByTestId("trust-install").isDisabled(), true);
    await page.getByTestId("trust-cancel").click();
    await page.getByTestId("xperience-space").waitFor();
    await page.getByTestId(`portable-space-${LANTERN}`).getByRole("button").click();
    await page.getByTestId("installed-space").waitFor();
    const revoked = await dropUpdate(page, "lantern-2.0.0.update.json", "lantern-2.0.0.space");
    assert.equal(revoked.acceptable, "false");
    assert.match(revoked.code ?? "", /REVOKED|NOT_AUTHORIZED/);
    await page.getByTestId("update-apply").click();
    await page.getByTestId("installer-notice").waitFor({ timeout: 20_000 });
    const refusal = await page.getByTestId("installer-notice").getAttribute("data-code");
    await page.getByTestId("installer-back").click();
    assert.equal(await page.locator('[data-testid="installed-space"]').getAttribute("data-version"), "1.0.0", "nothing changed");
    evidence.push(`revoked-update:${revoked.code}`, `apply-refused:${refusal}`);

    // The browser is offline, so any request would have failed: every step above succeeding is the proof.
    // The shell keeps its own pre-SP3 background checks (update manifest, catalog key), which fail offline
    // and are not Space operations. Anything else after the restart fails the test.
    const after = offlineRequests.slice(shellRequests);
    const isShellBackground = (url: string) => { const { pathname } = new URL(url); return pathname === "/ox-update-manifest.json" || pathname === "/v1/catalog/public-key" || pathname === "/v1/catalog/manifest" || pathname.startsWith("/v1/directory") || pathname === "/v1/experience"; };
    const spaceRequests = after.filter((url) => !isShellBackground(url));
    assert.deepEqual(spaceRequests, [], "every Space operation after the restart ran with zero network requests");
    evidence.push(`offline-space-network-requests:${spaceRequests.length}`, `offline-shell-load-requests(service worker):${shellRequests}`, `shell-background-checks(failed offline, not Space):${after.length - spaceRequests.length}`);
    console.log("SP3_LANTERN_JOURNEY", ...evidence);
  } finally {
    await context.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});

test("SP3 share intake: a file shared to the Web Share Target reaches the installer once, identified by content", { timeout: 240_000 }, async (t) => {
  if (skip(t)) return;
  const { context, page } = await freshPage();
  try {
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => undefined), new Promise((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 30_000))]));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 20_000 });
    // What the browser does for a share: a multipart POST of the file to the manifest's share_target action.
    const bytes = await bytesOf("lantern-1.0.0.space");
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("ox-share") === "space" || url.pathname === "/", { timeout: 20_000 }),
      page.evaluate((data) => {
        const form = document.createElement("form");
        form.method = "POST"; form.action = "/share-space"; form.enctype = "multipart/form-data";
        const input = document.createElement("input");
        input.type = "file"; input.name = "space";
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(data)], "shared-from-files.bin", { type: "application/octet-stream" }));
        input.files = transfer.files;
        form.append(input); document.body.append(form); form.submit();
      }, bytes),
    ]);
    await page.locator('[data-testid="space-installer"][data-view="inspect"]').waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => /portable Space package/.test(document.querySelector('[data-testid="inspect-kind"]')?.textContent ?? ""), undefined, { timeout: 20_000 });
    assert.equal(new URL(page.url()).searchParams.get("ox-share"), null, "the share marker is consumed");
    // Taken exactly once: a reload does not offer it again.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 20_000 });
    assert.equal(await page.getByTestId("space-installer").count(), 0);
    console.log("SP3_SHARE_INTAKE", "web-share-target:INSTALLER(inspect)", "consumed-once:true");
  } finally {
    await context.close();
  }
});
