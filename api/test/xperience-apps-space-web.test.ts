import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import type { BrowserContext, Page } from "playwright";
import { exportGeneratedCatalogKeysForTests, resetCatalogSigningKeysForTests } from "../src/catalog-keys.js";
import { resetReleaseCatalogForTests } from "../src/release-catalog.js";

/**
 * Xperience Apps / Xperience Space split and network-free OS entry, against the built
 * os-experience dist and the real MrFundzMan TV acceptance media. Nothing is mocked in the
 * runtime: the Offline Kernel hydrates real bytes, persists them in IndexedDB and plays blobs.
 */
const fixtures = "C:\\Users\\Hp\\Desktop\\MRFUNDZMAN-TV-ACCEPTANCE";
const videoFile = "RCTH2872.MOV";
const canonicalMediaId = "content:sha256:e1d41422304fcce946c6640d07999c41f499c340ba4f935166e656ae9e9d774e";
const providerId = "bootstrap.mybrandos.public";
const channelId = "mrfundzman.tv";
const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: "tablet", viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
] as const;

type Media = { bytes: Buffer; checksum: string; mediaId: string; label: string };

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

async function loadMedia(file: string): Promise<Media> {
  const bytes = await readFile(join(fixtures, file));
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return { bytes, checksum, mediaId: `content:sha256:${checksum}`, label: file.replace(/\.[^.]+$/, "") };
}

function broadcastProducer(media: Media) {
  const requests: string[] = [];
  const startedAt = new Date(Date.now() - 10_000).toISOString();
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    requests.push(url);
    res.setHeader("access-control-allow-origin", "*");
    if (url === `/api/public/broadcast/${channelId}`) {
      res.setHeader("content-type", "application/json");
      const programs = [0, 1, 2].map((sequence) => ({
        programId: `v1-p${sequence}`,
        mediaId: media.mediaId,
        title: `MRFUNDZMAN TV ${media.label} ${sequence + 1}`,
        scheduledStart: new Date(Date.parse(startedAt) + sequence * 600_000).toISOString(),
        durationMs: 600_000,
        sequence,
        media: { path: `/public/mrfundzman-tv/${media.label}/media`, version: "1", contentType: "video/quicktime", byteLength: media.bytes.byteLength, checksum: media.checksum },
      }));
      res.end(JSON.stringify({ channelId, publisherId: "mrfundzman", scheduleId: "mrfundzman-tv", scheduleVersion: 1, programs }));
      return;
    }
    if (url === `/public/mrfundzman-tv/${media.label}/media`) {
      res.setHeader("content-type", "video/quicktime");
      res.end(media.bytes);
      return;
    }
    res.statusCode = 404;
    res.end();
  };
  return { handler, requests };
}

async function serveDist() {
  const dist = resolve("apps/os-experience/dist");
  return listen(async (req, res) => {
    const pathname = (req.url ?? "/").split("?")[0]!;
    const target = join(dist, pathname === "/" ? "index.html" : pathname);
    try {
      const body = await readFile(target);
      const extension = extname(target);
      res.setHeader("content-type", extension === ".js" ? "text/javascript" : extension === ".css" ? "text/css" : extension === ".html" ? "text/html" : extension === ".json" || extension === ".webmanifest" ? "application/json" : extension === ".svg" ? "image/svg+xml" : "application/octet-stream");
      res.end(body);
    } catch {
      res.setHeader("content-type", "text/html");
      res.end(await readFile(join(dist, "index.html")));
    }
  });
}

const XPERIENCE_API = /^https:\/\/xperience-api-production-37ee\.up\.railway\.app\//;
const HOSTED_RUNTIME = /^https:\/\/xperience\.getlifeos\.app\//;
const PRODUCTION_PROVIDERS = /^https:\/\/(mrfundzman|app)\.getlifeos\.app\//;

type LiveRecord = { id: string; name: string; origin: string; productionUrl: string } & Record<string, unknown>;
type LiveDirectory = { applications: LiveRecord[]; featured: LiveRecord[]; catalog: unknown; publicKeySpkiBase64: string };

/** Production hosts are never contacted. The Xperience API is unreachable unless a live Directory is supplied. */
async function hermetic(context: BrowserContext, live?: LiveDirectory) {
  const calls: string[] = [];
  await context.route(HOSTED_RUNTIME, (route) => route.abort("internetdisconnected"));
  await context.route(PRODUCTION_PROVIDERS, (route) => route.abort("internetdisconnected"));
  await context.route(XPERIENCE_API, async (route) => {
    const request = route.request();
    const method = request.method();
    const { pathname } = new URL(request.url());
    if (method !== "OPTIONS") calls.push(`${method} ${pathname}`);
    if (!live) return route.abort("internetdisconnected");
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "content-type": "application/json" };
    const reply = (body: unknown, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    const record = (id: string) => live.applications.find((app) => app.id === decodeURIComponent(id));
    if (pathname === "/v1/directory") return reply({ applications: live.applications });
    if (pathname === "/v1/directory/featured") return reply({ applications: live.featured });
    if (pathname === "/v1/experience" && method === "GET") return reply({ experiences: [] });
    if (pathname === "/v1/catalog/manifest") return reply(live.catalog);
    if (pathname === "/v1/catalog/public-key") return reply({ algorithm: "Ed25519", publicKeySpkiBase64: live.publicKeySpkiBase64 });
    if (pathname === "/v1/presentation/active") return reply({ presentation: null });
    if (pathname === "/v1/me") return reply({ id: "user-1", role: "PARTICIPANT" });
    const open = pathname.match(/^\/v1\/experience\/([^/]+)\/open$/);
    if (open && record(open[1]!)) {
      const app = record(open[1]!)!;
      return reply({ applicationId: app.id, name: app.name, origin: app.origin, embedUrl: app.productionUrl, surface: "PUBLIC", status: "ACTIVE" });
    }
    const start = pathname.match(/^\/v1\/experience\/([^/]+)$/);
    if (start && method === "POST" && record(start[1]!)) {
      const app = record(start[1]!)!;
      return reply({ applicationId: app.id, status: "ACTIVE", addedAt: new Date().toISOString(), application: app });
    }
    return reply({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
  });
  return calls;
}

type Ports = { xperience: number; bootstrap: number; broadcast: number };

async function openHost(context: BrowserContext, ports: Ports) {
  const page = await context.newPage();
  const requests: string[] = [];
  const typed: Array<{ url: string; type: string }> = [];
  page.on("request", (request) => {
    requests.push(request.url());
    typed.push({ url: request.url(), type: request.resourceType() });
  });
  await page.addInitScript(({ bootstrapPort, broadcastPort }) => {
    const host = window as Window & Record<string, unknown>;
    host.__oxBootstrapEntry = { experienceId: "bootstrap.mybrandos.public", name: "mybrandOS", version: "test", entrypoint: `http://127.0.0.1:${bootstrapPort}/`, origin: `http://127.0.0.1:${bootstrapPort}/`, authMode: "PUBLIC", offlineCapability: "PARTIAL", status: "READY", lastUpdatedAt: new Date().toISOString() };
    host.__oxBroadcastApiBase = `http://127.0.0.1:${broadcastPort}`;
  }, { bootstrapPort: ports.bootstrap, broadcastPort: ports.broadcast });
  await page.goto(`http://127.0.0.1:${ports.xperience}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 15_000 });
  return {
    page,
    requests,
    toApp: () => requests.filter((url) => url.startsWith(`http://127.0.0.1:${ports.bootstrap}/`)),
    /** Reachability probes are script fetches; the App page itself loads as a document. */
    appProbes: () => typed.filter((item) => item.url.startsWith(`http://127.0.0.1:${ports.bootstrap}/`) && item.type !== "document").length,
    toProducer: () => requests.filter((url) => url.startsWith(`http://127.0.0.1:${ports.broadcast}/`)),
    external: () => requests.filter((url) => /mrfundzman\.getlifeos\.app|app\.getlifeos\.app/.test(url)),
  };
}

const runtime = (page: Page) => page.getByTestId("in-app-experience");

async function expectTarget(page: Page, mode: "APP" | "SPACE") {
  await page.waitForSelector(`[data-testid="in-app-experience"][data-execution-mode="${mode}"][data-provider-id="${providerId}"]`, { timeout: 15_000 });
}

async function hardwareBack(page: Page) {
  return page.evaluate(() => (window as Window & { __oxHardwareBack?: () => boolean }).__oxHardwareBack?.() ?? false);
}

async function readiness(page: Page) {
  const row = page.getByTestId(`xperience-space-${providerId}`);
  await row.waitFor({ state: "visible" });
  await page.waitForFunction((id) => document.querySelector(`[data-testid="xperience-space-${id}"]`)?.getAttribute("data-readiness") !== "CHECKING", providerId);
  return row.getAttribute("data-readiness");
}

/** Plays the on-air program and proves real decoded frames from a local blob with an advancing clock. */
async function playTv(page: Page) {
  await page.getByRole("button", { name: "TV", exact: true }).click();
  await page.waitForFunction((mediaId) => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="space-tv-video"]');
    const title = document.querySelector('[data-testid="space-tv-title"]')?.textContent ?? "";
    return Boolean(video && video.src.startsWith("blob:") && title === mediaId && video.readyState >= 2 && video.videoWidth > 0);
  }, canonicalMediaId, { timeout: 90_000 });
  const video = page.getByTestId("space-tv-video");
  const before = await video.evaluate((element: HTMLVideoElement) => ({ time: element.currentTime, width: element.videoWidth, height: element.videoHeight, src: element.src }));
  await page.waitForTimeout(700);
  const after = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  assert.ok(after > before.time, `video clock did not advance: ${before.time} → ${after}`);
  assert.ok(before.width > 0 && before.height > 0, "no decoded video frames");
  assert.equal(await page.getByTestId("space-tv").getAttribute("data-channel"), channelId);
  return { ...before, after };
}

async function menuItems(page: Page) {
  await page.getByTestId("xperience-host-controls").click();
  const items = await page.getByRole("menu", { name: "Xperience controls" }).getByRole("menuitem").allInnerTexts();
  await page.getByTestId("xperience-host-controls").click();
  return items;
}

function rectWithin(box: { x: number; y: number; width: number; height: number } | null, viewport: { width: number; height: number }) {
  return Boolean(box && box.width > 0 && box.height > 0 && box.x >= 0 && box.x + box.width <= viewport.width + 1);
}

async function servers(media: Media) {
  const producer = broadcastProducer(media);
  const broadcast = await listen(producer.handler);
  const bootstrap = await listen((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>mrfundzmanOS</title><main>mrfundzmanOS ready</main>"); });
  const xperience = await serveDist();
  return { producer, broadcast, bootstrap, xperience, ports: { xperience: xperience.port, bootstrap: bootstrap.port, broadcast: broadcast.port } };
}

for (const profile of profiles) test(`Xperience chooser splits Apps and Space on ${profile.name}`, async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const media = await loadMedia(videoFile);
  assert.equal(media.mediaId, canonicalMediaId);
  const env = await servers(media);
  const profileDir = await mkdtemp(join(tmpdir(), "ox-split-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, ...profile });
  await hermetic(context);
  try {
    const host = await openHost(context, env.ports);
    const { page } = host;
    await page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });

    // Chooser: two substantial choices; entering Xperience never auto-resumes a provider.
    await page.getByTestId("nav-xperience").click();
    await page.getByTestId("xperience-chooser").waitFor();
    assert.equal(await runtime(page).count(), 0, "nav → Xperience must show the chooser, not resume a provider");
    const apps = page.getByTestId("xperience-choice-apps");
    const space = page.getByTestId("xperience-choice-space");
    assert.match(await apps.innerText(), /XPERIENCE APPS/);
    assert.match(await apps.innerText(), /Online-first experiences/i);
    assert.match(await space.innerText(), /XPERIENCE SPACE/);
    assert.match(await space.innerText(), /Offline-ready experiences/i);
    const [appsBox, spaceBox] = [await apps.boundingBox(), await space.boundingBox()];
    for (const box of [appsBox, spaceBox]) {
      assert.ok(rectWithin(box, profile.viewport), `${profile.name}: choice outside the viewport`);
      assert.ok(box!.height >= 150, `${profile.name}: choice is a tiny tab (${box!.height}px)`);
      assert.ok(box!.width >= Math.min(300, profile.viewport.width * 0.4), `${profile.name}: choice too narrow (${box!.width}px)`);
    }
    if (profile.viewport.width >= 720) assert.ok(Math.abs(appsBox!.y - spaceBox!.y) < 2, "wide layouts place the choices side by side");
    console.log("CHOOSER", profile.name, `apps:${Math.round(appsBox!.width)}x${Math.round(appsBox!.height)}`, `space:${Math.round(spaceBox!.width)}x${Math.round(spaceBox!.height)}`);

    // Apps browser: APP releases only, launches APP only, with no Space execution controls.
    await apps.click();
    await page.getByTestId("xperience-apps").waitFor();
    assert.equal(await page.getByTestId(`xperience-app-${providerId}`).getAttribute("data-availability"), "AVAILABLE");
    assert.equal(await page.locator('[data-testid^="xperience-space-"]').count(), 0);
    await page.getByTestId(`open-app-${providerId}`).click();
    await expectTarget(page, "APP");
    await page.frameLocator("iframe.ox-immersive-frame.is-active").getByText("mrfundzmanOS ready").waitFor({ timeout: 15_000 });
    assert.equal(await page.locator(".ox-space-summon").count(), 0);
    assert.equal(await page.getByTestId("space-tv").count(), 0);
    assert.deepEqual(await menuItems(page), ["Switch provider", "Leave Xperience"], "App entered from Xperience Apps carries no Space control");
    await page.getByTestId("summon-switcher").dispatchEvent("click");
    await page.waitForSelector('[data-testid="experience-switcher"]');
    assert.equal(await page.getByTestId("switcher-mode-space").count(), 0, "the switcher offers no Space mode in Xperience Apps");
    await page.getByTestId("switcher-dismiss").click();
    assert.equal(env.producer.requests.length, 0, "APP never touches the Offline Kernel broadcast path");

    // Back: App → Apps browser → chooser → Home; Home is the root (no loop).
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-apps").waitFor();
    assert.equal(await runtime(page).count(), 0);
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-chooser").waitFor();
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("home").waitFor();
    assert.equal(await hardwareBack(page), false, "Home is the root; Back hands control to the system");
    console.log("APPS_BROWSER", profile.name, "app-only", "space-controls:absent", "back:app>apps>chooser>home");

    // Space browser: SPACE declarations only, launches SPACE only — same provider identity.
    await page.getByTestId("nav-xperience").click();
    await page.getByTestId("xperience-choice-space").click();
    await page.getByTestId("xperience-space").waitFor();
    assert.equal(await page.locator('[data-testid^="xperience-app-"]').count(), 0);
    assert.equal(await readiness(page), "NOT_PREPARED", "an unprepared Space is honestly NOT PREPARED online");
    const probesBefore = host.appProbes();
    await page.getByTestId(`enter-space-${providerId}`).click();
    await expectTarget(page, "SPACE");
    assert.equal(await runtime(page).getAttribute("data-provider-id"), providerId);
    await page.getByRole("button", { name: "Summon controls" }).click();
    assert.deepEqual(await page.getByTestId("space-controls").getByRole("button").allInnerTexts(), ["TV", "Space Switch", "Revolve", "Return to App"]);
    if (profile.isMobile) {
      const tvBox = await page.getByRole("button", { name: "TV", exact: true }).boundingBox();
      assert.ok(rectWithin(tvBox, profile.viewport) && tvBox!.y + tvBox!.height <= profile.viewport.height, `${profile.name}: TV control not reachable`);
    }
    const played = await playTv(page);
    assert.equal(host.appProbes() - probesBefore, 0, "Space launch never probes the App URL");
    assert.ok(env.producer.requests.includes(`/public/mrfundzman-tv/${media.label}/media`), "online Space prepares real media");
    console.log("SPACE_BROWSER", profile.name, "space-only", `video:${played.width}x${played.height}`, `time:${played.time}->${played.after}`);

    // Space runtime Back returns to the Space browser, where the Space is now READY OFFLINE.
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-space").waitFor();
    assert.equal(await readiness(page), "READY_OFFLINE");
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-chooser").waitFor();
    await page.waitForFunction(() => /ready offline/.test(document.querySelector('[data-testid="xperience-choice-space-count"]')?.textContent ?? ""));
    assert.match(await page.getByTestId("xperience-choice-space-count").innerText(), /1 ready offline/);
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("home").waitFor();
    assert.deepEqual(host.external(), []);
    console.log("SPACE_READY_OFFLINE", profile.name, "back:space>browser>chooser>home");
  } finally {
    await context.close().catch(() => undefined);
    await close(env.broadcast.server);
    await close(env.bootstrap.server);
    await close(env.xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("network-free OS entry: cold start offline → Home → Xperience → Space → prepared Space → Offline Kernel", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const media = await loadMedia(videoFile);
  const env = await servers(media);
  const profileDir = await mkdtemp(join(tmpdir(), "ox-offline-entry-"));
  const viewport = { width: 1440, height: 900 };
  let context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport });
  await hermetic(context);
  try {
    // Prepare online: the web shell installs into its service-worker cache, the Space hydrates real media.
    const online = await openHost(context, env.ports);
    await online.page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await online.page.reload({ waitUntil: "domcontentloaded" });
    await online.page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    assert.ok(await online.page.evaluate(() => Boolean(navigator.serviceWorker.controller)), "shell is not installed for offline launch");
    await online.page.getByTestId("nav-xperience").click();
    await online.page.getByTestId("xperience-choice-space").click();
    await online.page.getByTestId(`enter-space-${providerId}`).click();
    await expectTarget(online.page, "SPACE");
    await online.page.getByRole("button", { name: "Summon controls" }).click();
    await playTv(online.page);
    assert.equal(await hardwareBack(online.page), true);
    await online.page.getByTestId("xperience-space").waitFor();
    assert.equal(await readiness(online.page), "READY_OFFLINE");
    await online.page.goto(`http://127.0.0.1:${env.ports.xperience}/`, { waitUntil: "domcontentloaded" });
    await online.page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });

    // Force stop, then remove every route: the shell server, the App origin and the producer all go away.
    await context.close();
    await close(env.xperience.server);
    await close(env.bootstrap.server);
    await close(env.broadcast.server);

    context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport, offline: true });
    await hermetic(context);
    const started = Date.now();
    const offline = await openHost(context, env.ports);
    const { page } = offline;
    await page.waitForSelector('[data-testid="home"]', { timeout: 10_000 });
    const shellMs = Date.now() - started;
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    await page.getByTestId("offline-banner").waitFor();
    assert.equal(await runtime(page).count(), 0, "cold start lands on Home, not inside a provider");
    assert.equal(await page.getByText(/sign in|log in|TrustID/i).count(), 0, "local OS entry asks for no remote identity");
    console.log("OFFLINE_COLD_START", `shell-visible-ms:${shellMs}`);

    // Offline Xperience navigation: chooser → Space browser shows the prepared Space as READY OFFLINE.
    await page.getByTestId("nav-xperience").click();
    await page.getByTestId("xperience-chooser").waitFor();
    await page.getByTestId("xperience-choice-space").click();
    assert.equal(await readiness(page), "READY_OFFLINE");
    const requestsBefore = offline.requests.length;
    await page.getByTestId(`enter-space-${providerId}`).click();
    await expectTarget(page, "SPACE");
    assert.equal(await page.locator("iframe.ox-immersive-frame").count(), 0, "an offline Space never requests the provider's live page");
    assert.match(await page.getByTestId("space-provider-unreachable").innerText(), /Offline/);
    await page.getByRole("button", { name: "Summon controls" }).click();
    const played = await playTv(page);
    const during = offline.requests.slice(requestsBefore);
    assert.deepEqual(offline.toApp(), [], "no App probe and no App page request offline");
    assert.deepEqual(offline.toProducer(), [], "NO_ROUTE with local media: zero producer requests");
    assert.equal(during.filter((url) => url.endsWith("/media")).length, 0, "zero external media requests");
    // The background OTA check may fire (and fail) while offline; it never gates the shell or the Space.
    const otaChecks = during.filter((url) => url === "https://xperience.getlifeos.app/ox-update-manifest.json").length;
    assert.deepEqual(during.filter((url) => !url.startsWith("blob:") && !url.startsWith("data:") && !url.startsWith(`http://127.0.0.1:${env.ports.xperience}/`) && url !== "https://xperience.getlifeos.app/ox-update-manifest.json"), []);
    console.log("OFFLINE_OTA_NON_BLOCKING", `background-ota-checks:${otaChecks}`);
    console.log("OFFLINE_PREPARED_SPACE", `video:${played.width}x${played.height}`, `time:${played.time}->${played.after}`, `src:${played.src.slice(0, 5)}`, "app-requests:0", "producer-requests:0");

    // Return to App offline is an honest connection-required state; the prepared Space keeps running.
    await page.getByTestId("switch-to-app").click();
    await page.getByTestId("space-notice").waitFor();
    assert.match(await page.getByTestId("space-notice").innerText(), /needs a connection/);
    await expectTarget(page, "SPACE");
    const still = await page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => ({ src: video.src, time: video.currentTime }));
    assert.equal(still.src, played.src, "Return to App offline must not tear down the Space");
    await page.waitForTimeout(500);
    assert.ok(await page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime) > still.time);
    console.log("RETURN_TO_APP_OFFLINE", "connection-required", "space-preserved");

    // App offline from Xperience Apps: connection-required, never an automatic fallback into Space.
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-space").waitFor();
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-choice-apps").click();
    assert.equal(await page.getByTestId(`xperience-app-${providerId}`).getAttribute("data-availability"), "CONNECTION_REQUIRED");
    await page.getByTestId(`open-app-${providerId}`).click();
    await page.getByTestId("restore-notice").waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId("restore-notice").innerText(), /needs a connection/);
    await page.getByTestId("xperience-apps").waitFor();
    assert.equal(await runtime(page).count(), 0, "no Space fallback and no white App frame");
    assert.deepEqual(offline.toApp(), []);
    console.log("APP_OFFLINE_FROM_APPS", "connection-required", "space-fallback:none");
  } finally {
    await context.close().catch(() => undefined);
    await close(env.broadcast.server);
    await close(env.bootstrap.server);
    await close(env.xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("first install with no internet: the OS launches and the bundled Space needs online preparation", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const media = await loadMedia(videoFile);
  const env = await servers(media);
  const profileDir = await mkdtemp(join(tmpdir(), "ox-first-offline-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await hermetic(context);
  try {
    const host = await openHost(context, env.ports);
    const { page } = host;
    // The shell is installed (as an APK bundles it); the installation's local state is then empty.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    await page.evaluate(() => localStorage.clear());
    await context.setOffline(true);
    await close(env.xperience.server);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="home"]', { timeout: 10_000 });
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    assert.equal(await page.evaluate(() => new Promise<number>((done) => {
      const request = indexedDB.open("digiconomy-offline-kernel");
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("broadcast")) { db.close(); done(0); return; }
        const count = db.transaction("broadcast").objectStore("broadcast").count();
        count.onsuccess = () => { db.close(); done(count.result); };
      };
      request.onerror = () => done(-1);
    })), 0, "no prepared Offline Kernel state on a first install");
    await page.getByTestId("nav-xperience").click();
    await page.getByTestId("xperience-choice-space").click();
    assert.equal(await readiness(page), "ONLINE_PREPARATION_REQUIRED");
    assert.equal(await page.getByTestId(`enter-space-${providerId}`).isDisabled(), true);
    assert.equal(await page.getByTestId(`xperience-space-${providerId}`).locator("em").innerText(), "ONLINE PREPARATION REQUIRED");
    assert.deepEqual(host.toProducer(), []);
    console.log("FIRST_INSTALL_OFFLINE", "bundled-space:listed", "readiness:ONLINE_PREPARATION_REQUIRED");
  } finally {
    await context.close().catch(() => undefined);
    await close(env.broadcast.server);
    await close(env.bootstrap.server);
    await close(env.xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("network recovery refreshes in the background without killing the running Space; runtime restore is preserved", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const media = await loadMedia(videoFile);
  const env = await servers(media);
  const profileDir = await mkdtemp(join(tmpdir(), "ox-recovery-"));
  const viewport = { width: 1440, height: 900 };
  let context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport });
  await hermetic(context);
  try {
    const first = await openHost(context, env.ports);
    await first.page.getByTestId("nav-xperience").click();
    await first.page.getByTestId("xperience-choice-space").click();
    await first.page.getByTestId(`enter-space-${providerId}`).click();
    await expectTarget(first.page, "SPACE");
    await first.page.getByRole("button", { name: "Summon controls" }).click();
    await playTv(first.page);

    // Disconnect, keep consuming locally, reconnect: the Space and its playback survive the refresh.
    await context.setOffline(true);
    await first.page.waitForSelector('[data-testid="offline-banner"]');
    const offlinePlay = await playTv(first.page);
    await context.setOffline(false);
    await first.page.waitForSelector('[data-testid="offline-banner"]', { state: "detached" });
    await first.page.waitForTimeout(1500);
    await expectTarget(first.page, "SPACE");
    const afterRecovery = await first.page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => ({ src: video.src, time: video.currentTime }));
    assert.equal(afterRecovery.src, offlinePlay.src, "network recovery restarted the Space playback");
    await first.page.waitForTimeout(500);
    assert.ok(await first.page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime) > afterRecovery.time);
    console.log("NETWORK_RECOVERY", "space:kept", "playback:continuous");

    // X2 runtime restoration: an active Space restores on relaunch — distinct from navigating into Xperience.
    await context.close();
    context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport });
    await hermetic(context);
    const restored = await openHost(context, env.ports);
    await expectTarget(restored.page, "SPACE");
    await restored.page.getByRole("button", { name: "Summon controls" }).click();
    await playTv(restored.page);
    await restored.page.evaluate(() => (window as Window & { __oxExitExperienceToHome?: () => void }).__oxExitExperienceToHome?.());
    await restored.page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    await restored.page.getByTestId("nav-xperience").click();
    await restored.page.getByTestId("xperience-chooser").waitFor();
    assert.equal(await runtime(restored.page).count(), 0, "navigation into Xperience shows the chooser, not a runtime restore");
    console.log("RUNTIME_RESTORE", "space:restored-on-relaunch", "nav:chooser");
  } finally {
    await context.close().catch(() => undefined);
    await close(env.broadcast.server);
    await close(env.bootstrap.server);
    await close(env.xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});

function liveRecord(id: string, name: string, origin: string): LiveRecord {
  return { id, name, version: "live", origin, productionUrl: `${origin}/`, xperienceUrl: `${origin}/`, canManage: false, authMode: "PUBLIC", offlineCapability: "NONE", category: "Finance", description: `${name} from the live Directory`, capabilities: [], publicationState: "PUBLISHED", experienced: false };
}

test("connected Directory: Xperience executes only the signed canonical provider; live records stay discovery-only", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  resetCatalogSigningKeysForTests();
  const keys = await exportGeneratedCatalogKeysForTests();
  const catalog = await resetReleaseCatalogForTests().buildDeviceSignedCatalog();
  const liveMrFundzMan = liveRecord("ins_9c57cac9f6fa4167", "MrFundzMan", "https://mrfundzman.getlifeos.app");
  const lookalike = liveRecord("ins_5dc163addb3a4f20", "MrFundzMan", "https://mrfundzman-lookalike.invalid");
  const unknown = liveRecord("ins_unknown0000000001", "Unknown Provider", "https://unknown-provider.invalid");
  const live: LiveDirectory = { applications: [liveMrFundzMan, lookalike, unknown], featured: [liveMrFundzMan], catalog, publicKeySpkiBase64: keys.publicKeySpkiBase64 };
  const media = await loadMedia(videoFile);
  const env = await servers(media);
  const profileDir = await mkdtemp(join(tmpdir(), "ox-split-connected-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 1440, height: 900 } });
  const calls = await hermetic(context, live);
  try {
    const { page } = await openHost(context, env.ports);
    await page.getByTestId("nav-directory").click();
    await page.getByTestId(`provider-card-${unknown.id}`).waitFor({ state: "visible", timeout: 15_000 });

    await page.getByTestId("nav-xperience").click();
    await page.getByTestId("xperience-choice-apps").click();
    assert.deepEqual(
      await page.locator('[data-testid^="xperience-app-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid"))),
      [`xperience-app-${providerId}`],
    );
    assert.match(await page.getByTestId(`xperience-app-${providerId}`).innerText(), /MrFundzMan/);
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-choice-space").click();
    assert.deepEqual(
      await page.locator('[data-testid^="xperience-space-"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-testid"))),
      [`xperience-space-${providerId}`],
    );
    await page.getByTestId(`enter-space-${providerId}`).click();
    await expectTarget(page, "SPACE");
    assert.equal(calls.filter((call) => call.includes("/open") || call.startsWith("POST ")).length, 0, "Space consumption needs no Directory server call");
    console.log("CONNECTED_XPERIENCE", "apps:[canonical]", "space:[canonical]", "unknown/lookalike:discovery-only");
  } finally {
    await context.close().catch(() => undefined);
    await close(env.broadcast.server);
    await close(env.bootstrap.server);
    await close(env.xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});
