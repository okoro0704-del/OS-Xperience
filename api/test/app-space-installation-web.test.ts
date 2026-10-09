import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import type { BrowserContext, Page } from "playwright";

/**
 * OS Xperience APP + SPACE Installation V1 on OS Xperience Web (the same ExperienceApp the Android and
 * iOS shells run). INSTALL goes through the one orchestrator; a launched entry is a DIRECT launch:
 * the target is the first and only product UI — OS Xperience Home, Directory, navigation and
 * branding are never mounted (the OPPO "Space icon → OS Xperience → Space" regression).
 */
const providerId = "bootstrap.mybrandos.public";
const channelId = "mrfundzman.tv";
const spaceKey = `space:${providerId}`;
const appKey = `app:${providerId}`;
const launchUrl = (base: string, key: string) => `${base}/?ox-launch=${encodeURIComponent(key)}`;

/** Selectors that only exist when the OS Xperience shell is visible. */
const SHELL_SELECTORS = ['[data-testid="home"]', '[data-testid="os-experience"]', '[data-testid="directory"]', ".ox-topbar", ".ox-bottom-nav", ".ox-sidebar", ".ox-brand"];

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

async function close(server: ReturnType<typeof createServer>) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
}

function broadcastProducer() {
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const mediaId = `content:sha256:${checksum}`;
  const requests: string[] = [];
  const startedAt = Date.now() - 10_000;
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    requests.push(url);
    res.setHeader("access-control-allow-origin", "*");
    if (url === `/api/public/broadcast/${channelId}`) {
      res.setHeader("content-type", "application/json");
      const programs = [0, 1, 2].map((sequence) => ({
        programId: `direct-p${sequence}`, mediaId, title: `Program ${sequence + 1}`,
        scheduledStart: new Date(startedAt + sequence * 600_000).toISOString(), durationMs: 600_000, sequence,
        media: { path: "/public/direct/media", version: "1", contentType: "video/mp4", byteLength: bytes.byteLength, checksum },
      }));
      res.end(JSON.stringify({ channelId, publisherId: "mrfundzman", scheduleId: "direct", scheduleVersion: 1, programs }));
      return;
    }
    if (url === "/public/direct/media") {
      res.setHeader("content-type", "video/mp4");
      res.end(bytes);
      return;
    }
    res.statusCode = 404;
    res.end();
  };
  return { handler, requests };
}

async function serveDist() {
  const dist = resolve("apps/os-experience/dist");
  const served = await listen(async (req, res) => {
    const pathname = (req.url ?? "/").split("?")[0]!;
    const target = join(dist, pathname === "/" ? "index.html" : pathname);
    try {
      const body = await readFile(target);
      const extension = extname(target);
      res.setHeader("content-type", extension === ".js" ? "text/javascript" : extension === ".css" ? "text/css" : extension === ".html" ? "text/html" : extension === ".json" || extension === ".webmanifest" ? "application/json" : extension === ".svg" ? "image/svg+xml" : "application/octet-stream");
      res.end(body);
    } catch {
      // Static hosting's SPA fallback: an unknown path is the app shell, never a target manifest.
      res.setHeader("content-type", "text/html");
      res.end(await readFile(join(dist, "index.html")));
    }
  });
  return served;
}

async function hermetic(context: BrowserContext) {
  await context.route(/^https:\/\/xperience\.getlifeos\.app\//, (route) => route.abort("internetdisconnected"));
  await context.route(/^https:\/\/(mrfundzman|app)\.getlifeos\.app\//, (route) => route.abort("internetdisconnected"));
  await context.route(/^https:\/\/xperience-api-production-37ee\.up\.railway\.app\//, (route) => route.abort("internetdisconnected"));
}

/** Host overrides (local bootstrap + broadcast route), and optionally an installed-web-app window. */
async function prepare(page: Page, ports: { bootstrap: number; broadcast: number }, options: { standalone?: boolean; watchShell?: boolean } = {}) {
  await page.addInitScript(({ bootstrapPort, broadcastPort, standalone, watchShell, selectors }) => {
    const host = window as Window & Record<string, unknown>;
    host.__oxBootstrapEntry = { experienceId: "bootstrap.mybrandos.public", name: "mybrandOS", version: "test", entrypoint: `http://127.0.0.1:${bootstrapPort}/`, origin: `http://127.0.0.1:${bootstrapPort}/`, authMode: "PUBLIC", offlineCapability: "PARTIAL", status: "READY", lastUpdatedAt: new Date().toISOString(), executionModes: [{ mode: "APP" }] };
    host.__oxBroadcastApiBase = `http://127.0.0.1:${broadcastPort}`;
    if (standalone) {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => (query.includes("display-mode: standalone") ? { ...real(query), matches: true, media: query } as MediaQueryList : real(query));
    }
    if (watchShell) {
      const seen = new Set<string>();
      host.__oxShellSeen = seen;
      const check = () => { for (const selector of selectors) if (document.querySelector(selector)) seen.add(selector); };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
    }
  }, { bootstrapPort: ports.bootstrap, broadcastPort: ports.broadcast, standalone: options.standalone ?? false, watchShell: options.watchShell ?? false, selectors: SHELL_SELECTORS });
}

async function shellSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as Window & { __oxShellSeen?: Set<string> }).__oxShellSeen ?? [])]);
}

async function openDetail(page: Page) {
  await page.locator('[data-testid="nav-directory"]:visible').click();
  await page.getByTestId(`provider-card-${providerId}`).locator(".ox-card-main").click();
  await page.getByTestId("app-details").waitFor();
  await page.getByTestId(`install-panel-${providerId}`).waitFor();
}

test("App + Space Installation (web): INSTALL from Directory, then each entry launches DIRECTLY — OS Xperience never visible", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const producer = broadcastProducer();
  const broadcast = await listen(producer.handler);
  const appRequests: string[] = [];
  const bootstrap = await listen((req, res) => { appRequests.push(req.url ?? ""); res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>mybrandOS App</title><h1>mybrandOS App</h1>"); });
  const xperience = await serveDist();
  const base = `http://127.0.0.1:${xperience.port}`;
  const ports = { bootstrap: bootstrap.port, broadcast: broadcast.port };
  const profileDir = await mkdtemp(join(tmpdir(), "ox-app-space-install-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 412, height: 915 }, serviceWorkers: "allow" });
  await hermetic(context);
  try {
    /* ---------------- normal OS Xperience icon → OS Xperience Home */
    const shell = await context.newPage();
    await prepare(shell, ports);
    await shell.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await shell.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    await shell.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 });
    const ownManifest = await shell.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href"));
    assert.ok(ownManifest?.endsWith("manifest.webmanifest"));

    /* ---------------- INSTALL: one panel, App [Open][Install], Space [Enter][Install] */
    await openDetail(shell);
    const appRow = shell.getByTestId(`install-target-row-app-${providerId}`);
    const spaceRow = shell.getByTestId(`install-target-row-space-${providerId}`);
    assert.equal(await appRow.getAttribute("data-install-state"), "NOT_INSTALLED");
    assert.equal(await spaceRow.getAttribute("data-install-state"), "NOT_INSTALLED");
    assert.equal(await shell.getByTestId(`install-panel-${providerId}`).getAttribute("data-install-mechanism"), "WEB_INSTALL_PROMPT");
    assert.equal(await shell.getByTestId(`open-target-app-${providerId}`).innerText(), "Open");
    const panelText = await shell.getByTestId(`install-panel-${providerId}`).innerText();
    assert.doesNotMatch(panelText, /PWA|shortcut|deep link|manifest|launch file|register/i, "product language is INSTALL only");

    await shell.getByTestId(`install-target-space-${providerId}`).click();
    await shell.waitForFunction(() => document.querySelector('[data-testid="install-notice"]')?.getAttribute("data-code") === "INSTALLATION_PENDING_PLATFORM_CONFIRMATION", undefined, { timeout: 60_000 });
    // Headless Chromium offers no install prompt: the browser menu is the honest remaining step.
    assert.match(await shell.getByTestId("install-notice").innerText(), /browser menu/);
    assert.ok(producer.requests.includes("/public/direct/media"), "SPACE install prepared the Space in the Offline Kernel");
    const spaceManifest = await shell.evaluate(async (id) => (await fetch(`/ox-install/space/${id}/manifest.webmanifest`)).json(), providerId) as Record<string, unknown>;
    assert.equal(spaceManifest.name, "MrFundzMan", "named by the verified launch file");
    assert.equal(spaceManifest.start_url, `/?ox-launch=${encodeURIComponent(spaceKey)}`);
    assert.equal(spaceManifest.id, spaceManifest.start_url);
    assert.equal(await shell.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href")), `/ox-install/space/${providerId}/manifest.webmanifest`);
    const icon = await shell.evaluate(async (id) => { const r = await fetch(`/ox-install/space/${id}/icon-512.png`); return { status: r.status, type: r.headers.get("content-type") }; }, providerId);
    assert.deepEqual(icon, { status: 200, type: "image/png" });
    assert.equal(await shell.evaluate(async () => (await fetch("/ox-install/space/not.installed/manifest.webmanifest")).status), 404, "the service worker serves only entries this page wrote");

    await shell.getByTestId(`install-target-app-${providerId}`).click();
    await shell.waitForFunction((id) => document.querySelector('[data-testid="install-notice"]')?.getAttribute("data-code") === "INSTALLATION_PENDING_PLATFORM_CONFIRMATION" && document.querySelector('link[rel="manifest"]')?.getAttribute("href") === `/ox-install/app/${id}/manifest.webmanifest`, providerId, { timeout: 30_000 });
    const appManifest = await shell.evaluate(async (id) => (await fetch(`/ox-install/app/${id}/manifest.webmanifest`)).json(), providerId) as Record<string, unknown>;
    assert.equal(appManifest.start_url, `/?ox-launch=${encodeURIComponent(appKey)}`);
    assert.notEqual(appManifest.id, spaceManifest.id, "App and Space of one provider are distinct installed entries");
    for (const manifest of [appManifest, spaceManifest]) assert.doesNotMatch(JSON.stringify(manifest), /token|session|secret|password|credential|trustid/i);
    const installed = await shell.evaluate(() => localStorage.getItem("ox.installed-targets.v1"));
    assert.doesNotMatch(installed ?? "", /token|session|secret|password|credential|trustid|biometric/i);
    await shell.locator('[data-testid="nav-home"]:visible').click();
    await shell.waitForSelector('[data-testid="home"]');
    assert.equal(await shell.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href")), ownManifest, "leaving the target restores OS Xperience's own manifest");
    await shell.close();

    /* ---------------- tap the installed Space → the Space (cold start, OS Xperience never mounted) */
    const spacePage = await context.newPage();
    await prepare(spacePage, ports, { standalone: true, watchShell: true });
    const appBefore = appRequests.length;
    await spacePage.goto(launchUrl(base, spaceKey), { waitUntil: "domcontentloaded" });
    await spacePage.waitForSelector('[data-testid="in-app-experience"][data-execution-mode="SPACE"]', { timeout: 30_000 });
    await spacePage.waitForSelector('[data-testid="space-tv-video"]', { timeout: 30_000 });
    assert.equal(await spacePage.getByTestId("direct-launch-root").getAttribute("data-launch-mode"), "DIRECT_SPACE");
    assert.equal(await spacePage.getByTestId("in-app-experience").getAttribute("data-xperience-mode"), "DIRECT");
    assert.deepEqual(await shellSeen(spacePage), [], "DIRECT_SPACE: OS Xperience Home/shell was never mounted");
    assert.equal(await spacePage.title(), "MrFundzMan", "the window is the Space, not OS Xperience");
    assert.equal(await spacePage.getByTestId("summon-switcher").count(), 0, "no OS Xperience switcher inside a direct target");
    assert.equal(await spacePage.evaluate(() => (window as Window & { __oxHardwareBack?: () => boolean }).__oxHardwareBack?.()), false, "Back at the target root leaves to the OS");
    await spacePage.waitForTimeout(300);
    assert.deepEqual(await shellSeen(spacePage), [], "Back never reveals OS Xperience");
    void appBefore; // Online, V1 Spaces mount the provider's live page under the local TV; offline (below) nothing is requested.
    await spacePage.close();

    /* ---------------- tap the installed App → the App (cold start, OS Xperience never mounted) */
    const appPage = await context.newPage();
    await prepare(appPage, ports, { standalone: true, watchShell: true });
    await appPage.goto(launchUrl(base, appKey), { waitUntil: "domcontentloaded" });
    await appPage.waitForSelector('[data-testid="in-app-experience"][data-execution-mode="APP"] iframe.is-active', { timeout: 30_000 });
    assert.equal(await appPage.locator("iframe.is-active").getAttribute("src"), `http://127.0.0.1:${bootstrap.port}/`);
    assert.equal(await appPage.getByTestId("direct-launch-root").getAttribute("data-launch-mode"), "DIRECT_APP");
    // The App sits between the system bars: the Android host reports their heights as --ox-safe-*.
    await appPage.evaluate(() => { const root = document.documentElement; root.style.setProperty("--ox-safe-top", "44px"); root.style.setProperty("--ox-safe-bottom", "48px"); });
    const frame = await appPage.locator("iframe.is-active").evaluate((element) => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: window.innerHeight }; });
    assert.equal(frame.top, 44, "the App's header is below the status bar");
    assert.equal(frame.bottom, frame.height - 48, "the App's bottom navigation is above the system navigation bar");
    assert.equal(await appPage.getByTestId("xperience-host-controls").count(), 0, "no OS Xperience controls over a directly launched App");
    assert.deepEqual(await shellSeen(appPage), [], "DIRECT_APP: OS Xperience Home/shell was never mounted");
    assert.equal(await appPage.evaluate(() => (window as Window & { __oxHardwareBack?: () => boolean }).__oxHardwareBack?.()), false);
    await appPage.close();

    /* ---------------- offline: the Space continues locally; the App honestly needs a connection */
    await context.setOffline(true);
    const offlineSpace = await context.newPage();
    await prepare(offlineSpace, ports, { standalone: true, watchShell: true });
    const producerBefore = producer.requests.length;
    await offlineSpace.goto(launchUrl(base, spaceKey), { waitUntil: "domcontentloaded" });
    await offlineSpace.waitForSelector('[data-testid="space-tv-video"]', { timeout: 30_000 });
    assert.equal(producer.requests.length, producerBefore, "offline Space playback is local: nothing is fetched from the producer");
    assert.deepEqual(await shellSeen(offlineSpace), []);
    await offlineSpace.close();

    const offlineApp = await context.newPage();
    await prepare(offlineApp, ports, { standalone: true, watchShell: true });
    await offlineApp.goto(launchUrl(base, appKey), { waitUntil: "domcontentloaded" });
    await offlineApp.waitForSelector('[data-testid="space-launch"][data-status="ONLINE_REQUIRED"]', { timeout: 30_000 });
    assert.equal(await offlineApp.getByTestId("space-launch").getAttribute("data-target-type"), "APP");
    assert.match(await offlineApp.getByTestId("space-launch-message").innerText(), /mybrandOS needs a connection/);
    assert.deepEqual(await shellSeen(offlineApp), [], "an offline App is a target state, not a trip to OS Xperience");
    await offlineApp.close();
    await context.setOffline(false);

    /* ---------------- broken / invalid entries fail as the target, never as OS Xperience */
    const missing = await context.newPage();
    await prepare(missing, ports, { watchShell: true });
    await missing.goto(launchUrl(base, "app:not.installed"), { waitUntil: "domcontentloaded" });
    await missing.waitForSelector('[data-testid="space-launch"][data-status="NOT_INSTALLED"]', { timeout: 30_000 });
    assert.match(await missing.getByTestId("target-launch-title").innerText(), /couldn't be opened/);
    for (const action of ["target-launch-retry", "target-launch-repair", "target-launch-remove"]) assert.equal(await missing.getByTestId(action).count(), 1, action);
    assert.equal(await missing.getByTestId("space-launch-home").count(), 0, "no way into OS Xperience from a direct target");
    assert.deepEqual(await shellSeen(missing), []);
    await missing.close();

    const invalid = await context.newPage();
    await prepare(invalid, ports, { watchShell: true });
    await invalid.goto(launchUrl(base, "widget:../etc"), { waitUntil: "domcontentloaded" });
    await invalid.waitForSelector('[data-testid="space-launch"][data-status="INVALID"]', { timeout: 30_000 });
    assert.equal(await invalid.getByTestId("direct-launch-root").getAttribute("data-launch-mode"), "DIRECT_INVALID");
    assert.deepEqual(await shellSeen(invalid), []);
    await invalid.close();

    /* ---------------- re-add from OS Xperience: still one record per target */
    const again = await context.newPage();
    await prepare(again, ports);
    await again.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await again.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    const rows = await again.evaluate(() => (JSON.parse(localStorage.getItem("ox.installed-targets.v1") ?? "{}") as { targets?: { key: string }[] }).targets?.map((row) => row.key).sort());
    assert.deepEqual(rows, [appKey, spaceKey]);
    await again.close();
    console.log("APP_SPACE_INSTALL_WEB", "install:PENDING_BROWSER_CONFIRMATION", "space:DIRECT_SPACE", "app:DIRECT_APP", "offline-space:LOCAL", "offline-app:ONLINE_REQUIRED", "shell-mounted:0");
  } finally {
    await context.close().catch(() => undefined);
    await close(broadcast.server);
    await close(bootstrap.server);
    await close(xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("An installed web entry in its own storage (iOS Home Screen web apps) re-verifies and opens the Space directly", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const producer = broadcastProducer();
  const broadcast = await listen(producer.handler);
  const bootstrap = await listen((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>app</title>"); });
  const xperience = await serveDist();
  const base = `http://127.0.0.1:${xperience.port}`;
  const profileDir = await mkdtemp(join(tmpdir(), "ox-web-entry-adopt-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await hermetic(context);
  try {
    // Standalone + empty storage: the Home Screen entry itself is the installation.
    const page = await context.newPage();
    await prepare(page, { bootstrap: bootstrap.port, broadcast: broadcast.port }, { standalone: true, watchShell: true });
    await page.goto(launchUrl(base, spaceKey), { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="space-tv-video"]', { timeout: 60_000 });
    assert.deepEqual(await shellSeen(page), []);
    const registered = await page.evaluate(() => localStorage.getItem("ox.space-registrations.v1"));
    assert.match(registered ?? "", /MrFundzMan/, "re-verified from the build's signed launch file");
    await page.close();

    // The same URL in an ordinary tab is a link, not an installation: nothing is adopted.
    const tab = await context.newPage();
    await prepare(tab, { bootstrap: bootstrap.port, broadcast: broadcast.port });
    await tab.goto(launchUrl(base, "app:never.installed"), { waitUntil: "domcontentloaded" });
    await tab.waitForSelector('[data-testid="space-launch"][data-status="NOT_INSTALLED"]', { timeout: 30_000 });
    const rows = await tab.evaluate(() => localStorage.getItem("ox.installed-targets.v1"));
    assert.doesNotMatch(rows ?? "", /never\.installed/);
    await tab.close();
  } finally {
    await context.close().catch(() => undefined);
    await close(broadcast.server);
    await close(bootstrap.server);
    await close(xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});
