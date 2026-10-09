import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import type { BrowserContext, Page } from "playwright";

/**
 * Space Launch File V1 acceptance against the built os-experience dist: the installation starts with
 * an APP-only MrFundzMan provider, so its Space can only come from the signed mrfundzman.space file.
 * Preparation hydrates the real acceptance media into the Offline Kernel; nothing is mocked in the runtime.
 */
const fixtures = "C:\\Users\\Hp\\Desktop\\MRFUNDZMAN-TV-ACCEPTANCE";
const videoFile = "RCTH2872.MOV";
const canonicalMediaId = "content:sha256:e1d41422304fcce946c6640d07999c41f499c340ba4f935166e656ae9e9d774e";
const providerId = "bootstrap.mybrandos.public";
const channelId = "mrfundzman.tv";
const launchFilePath = resolve("apps/os-experience/public/spaces/mrfundzman.space");

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
        programId: `slf-p${sequence}`,
        mediaId: media.mediaId,
        title: `MRFUNDZMAN TV ${sequence + 1}`,
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

/** Production hosts and the Xperience API are never reachable: the Space path needs none of them. */
async function hermetic(context: BrowserContext) {
  await context.route(HOSTED_RUNTIME, (route) => route.abort("internetdisconnected"));
  await context.route(PRODUCTION_PROVIDERS, (route) => route.abort("internetdisconnected"));
  await context.route(XPERIENCE_API, (route) => route.abort("internetdisconnected"));
}

type Ports = { xperience: number; bootstrap: number; broadcast: number };

async function openHost(context: BrowserContext, ports: Ports) {
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(({ bootstrapPort, broadcastPort }) => {
    const host = window as Window & Record<string, unknown>;
    // APP-only provider: this installation knows MrFundzMan, but not its Space.
    host.__oxBootstrapEntry = { experienceId: "bootstrap.mybrandos.public", name: "mybrandOS", version: "test", entrypoint: `http://127.0.0.1:${bootstrapPort}/`, origin: `http://127.0.0.1:${bootstrapPort}/`, authMode: "PUBLIC", offlineCapability: "PARTIAL", status: "READY", lastUpdatedAt: new Date().toISOString(), executionModes: [{ mode: "APP" }] };
    host.__oxBroadcastApiBase = `http://127.0.0.1:${broadcastPort}`;
  }, { bootstrapPort: ports.bootstrap, broadcastPort: ports.broadcast });
  await page.goto(`http://127.0.0.1:${ports.xperience}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 15_000 });
  return {
    page,
    requests,
    toApp: () => requests.filter((url) => url.startsWith(`http://127.0.0.1:${ports.bootstrap}/`)),
    toProducer: () => requests.filter((url) => url.startsWith(`http://127.0.0.1:${ports.broadcast}/`)),
    external: () => requests.filter((url) => /mrfundzman\.getlifeos\.app|app\.getlifeos\.app/.test(url)),
  };
}

async function readiness(page: Page) {
  const row = page.getByTestId(`xperience-space-${providerId}`);
  await row.waitFor({ state: "visible" });
  await page.waitForFunction((id) => document.querySelector(`[data-testid="xperience-space-${id}"]`)?.getAttribute("data-readiness") !== "CHECKING", providerId);
  return row.getAttribute("data-readiness");
}

async function hardwareBack(page: Page) {
  return page.evaluate(() => (window as Window & { __oxHardwareBack?: () => boolean }).__oxHardwareBack?.() ?? false);
}

async function openSpaceBrowser(page: Page) {
  await page.getByTestId("nav-xperience").click();
  await page.getByTestId("xperience-chooser").waitFor();
  await page.getByTestId("xperience-choice-space").click();
  await page.getByTestId("xperience-space").waitFor();
}

async function importLaunchFile(page: Page) {
  await page.getByTestId("space-import-input").setInputFiles(launchFilePath);
  await page.getByTestId("space-import-status").waitFor();
  return page.getByTestId("space-import-status").getAttribute("data-code");
}

/** Local kernel footprint: bytes of retained media plus serialized schedule/metadata rows. */
async function preparedFootprint(page: Page) {
  return page.evaluate(() => new Promise<{ rows: number; mediaBytes: number; totalBytes: number }>((done, fail) => {
    const open = indexedDB.open("digiconomy-offline-kernel", 1);
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction("broadcast").objectStore("broadcast").getAll();
      all.onerror = () => fail(all.error);
      all.onsuccess = () => {
        let mediaBytes = 0;
        let totalBytes = 0;
        for (const row of all.result as Array<{ value: { bytes?: Uint8Array } }>) {
          const bytes = row.value.bytes?.byteLength ?? 0;
          mediaBytes += bytes;
          totalBytes += bytes + JSON.stringify({ ...row, value: { ...row.value, bytes: undefined } }).length;
        }
        done({ rows: all.result.length, mediaBytes, totalBytes });
      };
    };
  }));
}

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
  assert.equal(await page.getByTestId("space-tv").getAttribute("data-channel"), channelId);
  return { ...before, after };
}

test("Space Launch File V1: import → verify → register → prepare → READY OFFLINE → no-route Space with real TV", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const media = await loadMedia(videoFile);
  assert.equal(media.mediaId, canonicalMediaId);
  const launchFileBytes = (await stat(launchFilePath)).size;
  const producer = broadcastProducer(media);
  const broadcast = await listen(producer.handler);
  const bootstrap = await listen((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>mrfundzmanOS</title><main>mrfundzmanOS ready</main>"); });
  const xperience = await serveDist();
  const ports = { xperience: xperience.port, bootstrap: bootstrap.port, broadcast: broadcast.port };
  const profileDir = await mkdtemp(join(tmpdir(), "ox-space-file-"));
  const viewport = { width: 1440, height: 900 };
  let context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport });
  await hermetic(context);
  try {
    const online = await openHost(context, ports);
    await online.page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await online.page.reload({ waitUntil: "domcontentloaded" });
    await online.page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    const page = online.page;

    // Before import: the provider exists as an APP only; Xperience Space has nothing for it.
    await openSpaceBrowser(page);
    assert.equal(await page.getByTestId(`xperience-space-${providerId}`).count(), 0, "no Space before the launch file is imported");
    assert.deepEqual((await page.getByTestId("space-import-input").getAttribute("accept"))?.split(","), [".space", "application/vnd.digiconomy.space+json", "application/octet-stream"], "Android pickers type .space as octet-stream");

    // Import: verified, registered, listed under Xperience Space. Nobody prepares it by hand: while
    // connected, the registered Space syncs its publisher's content by itself.
    assert.equal(await importLaunchFile(page), "REGISTERED");
    assert.deepEqual(online.toApp(), [], "import never probes the App");
    const row = page.getByTestId(`xperience-space-${providerId}`);
    assert.equal(await row.getAttribute("data-registered"), "true");
    assert.equal(await page.getByTestId(`prepare-space-${providerId}`).count(), 0, "there is no manual Prepare");
    assert.match(await row.innerText(), /MrFundzMan/);
    assert.match(await row.innerText(), /mybrandOS · v1\.0\.0/i);
    assert.equal(await importLaunchFile(page), "ALREADY_INSTALLED", "re-import is deterministic");
    console.log("SPACE_FILE_IMPORT", `bytes:${launchFileBytes}`, "status:REGISTERED", "preparation:AUTOMATIC", "reimport:ALREADY_INSTALLED");

    // Import created no APP target: Xperience Apps still lists the one provider App.
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-chooser").waitFor();
    await page.getByTestId("xperience-choice-apps").click();
    await page.getByTestId("xperience-apps").waitFor();
    assert.equal(await page.locator('[data-testid^="xperience-app-"]').count(), 1);
    assert.equal(await hardwareBack(page), true);
    await page.getByTestId("xperience-chooser").waitFor();

    // Automatic preparation: the Offline Kernel acquires real media; the Space becomes READY OFFLINE.
    await page.getByTestId("xperience-choice-space").click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="xperience-space-${id}"]`)?.getAttribute("data-readiness") === "READY_OFFLINE", providerId, { timeout: 120_000 });
    assert.ok(producer.requests.includes(`/public/mrfundzman-tv/${media.label}/media`), "preparation acquires real media");
    assert.deepEqual(online.toApp(), [], "preparation never probes the App");
    const footprint = await preparedFootprint(page);
    assert.ok(footprint.mediaBytes >= media.bytes.byteLength, "prepared media is held locally");
    console.log("SPACE_PREPARED", `launch-file-bytes:${launchFileBytes}`, `prepared-media-bytes:${footprint.mediaBytes}`, `prepared-total-bytes:${footprint.totalBytes}`, `kernel-rows:${footprint.rows}`);

    // Force stop, then remove every route: shell server, App origin and producer are gone.
    await page.goto(`http://127.0.0.1:${ports.xperience}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    await context.close();
    await close(xperience.server);
    await close(bootstrap.server);
    await close(broadcast.server);

    context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport, offline: true });
    await hermetic(context);
    const offline = await openHost(context, ports);
    const p = offline.page;
    await p.waitForSelector('[data-testid="home"]', { timeout: 10_000 });
    assert.equal(await p.evaluate(() => navigator.onLine), false);
    assert.equal(await p.getByText(/sign in|log in|TrustID/i).count(), 0, "no identity prompt");

    // Registration and readiness survive the restart and are read with no network.
    await openSpaceBrowser(p);
    assert.equal(await p.getByTestId(`xperience-space-${providerId}`).getAttribute("data-registered"), "true");
    assert.equal(await readiness(p), "READY_OFFLINE");
    const requestsBefore = offline.requests.length;
    await p.getByTestId(`enter-space-${providerId}`).click();
    await p.waitForSelector(`[data-testid="in-app-experience"][data-execution-mode="SPACE"][data-provider-id="${providerId}"]`, { timeout: 15_000 });
    assert.equal(await p.locator("iframe.ox-immersive-frame").count(), 0, "an offline Space never requests the provider's live page");
    await p.getByRole("button", { name: "Summon controls" }).click();
    const played = await playTv(p);
    const during = offline.requests.slice(requestsBefore);
    assert.deepEqual(offline.toApp(), [], "APP requests: 0");
    assert.deepEqual(offline.toProducer(), [], "producer requests: 0");
    assert.equal(during.filter((url) => url.endsWith("/media")).length, 0, "external media requests: 0");
    assert.deepEqual(offline.external(), []);
    console.log("SPACE_FILE_NO_ROUTE", `video:${played.width}x${played.height}`, `time:${played.time}->${played.after}`, "app-requests:0", "producer-requests:0", "external-media:0");

    // Removing the registration removes the Space from Xperience Space but keeps prepared data.
    await p.getByTestId("in-app-experience").waitFor();
    assert.equal(await hardwareBack(p), true);
    await p.getByTestId("xperience-space").waitFor();
    await p.getByTestId(`remove-space-${providerId}`).click();
    await p.waitForFunction((id) => !document.querySelector(`[data-testid="xperience-space-${id}"]`), providerId);
    const retained = await preparedFootprint(p);
    assert.equal(retained.mediaBytes, footprint.mediaBytes, "removing the registration does not delete prepared data");
    console.log("SPACE_REGISTRATION_REMOVED", `prepared-media-retained-bytes:${retained.mediaBytes}`);
  } finally {
    await context.close().catch(() => undefined);
    await close(broadcast.server);
    await close(bootstrap.server);
    await close(xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});
