import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import type { BrowserContext, Page } from "playwright";

const fixtures = "C:\\Users\\Hp\\Desktop\\MRFUNDZMAN-TV-ACCEPTANCE";
const videoA = { file: "RCTH2872.MOV", canonicalMediaId: "content:sha256:e1d41422304fcce946c6640d07999c41f499c340ba4f935166e656ae9e9d774e" };
const videoBFile = "KHRL4632.MOV";
const providerId = "bootstrap.mybrandos.public";
const channelId = "mrfundzman.tv";
const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: "large-display", viewport: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false },
] as const;

type Rect = { width: number; height: number; left: number; top: number; right: number; bottom: number };
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

/** Real producer projection. `current` is the program on air now; the schedule version is bumped on each publish. */
function broadcastProducer(media: Record<string, Media>) {
  const requests: string[] = [];
  let scheduleVersion = 1;
  let current: Media = Object.values(media)[0]!;
  let rotation: Media[] = [current];
  const start = () => new Date(Date.now() - 10_000).toISOString();
  let startedAt = start();
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    requests.push(url);
    res.setHeader("access-control-allow-origin", "*");
    if (url === `/api/public/broadcast/${channelId}`) {
      res.setHeader("content-type", "application/json");
      const programs = [current, ...rotation.filter((item) => item !== current), current].map((item, sequence) => ({
        programId: `v${scheduleVersion}-p${sequence}`,
        mediaId: item.mediaId,
        title: `MRFUNDZMAN TV ${item.label} ${sequence + 1}`,
        // Long programs keep the on-air media fixed for the whole run, including the NO_ROUTE reopen.
        scheduledStart: new Date(Date.parse(startedAt) + sequence * 600_000).toISOString(),
        durationMs: 600_000,
        sequence,
        media: { path: `/public/mrfundzman-tv/${item.label}/media`, version: "1", contentType: "video/quicktime", byteLength: item.bytes.byteLength, checksum: item.checksum },
      }));
      res.end(JSON.stringify({ channelId, publisherId: "mrfundzman", scheduleId: "mrfundzman-tv", scheduleVersion, programs }));
      return;
    }
    const mediaMatch = url.match(/^\/public\/mrfundzman-tv\/([^/]+)\/media$/);
    const item = mediaMatch ? Object.values(media).find((entry) => entry.label === mediaMatch[1]) : undefined;
    if (item) {
      res.setHeader("content-type", "video/quicktime");
      res.end(item.bytes);
      return;
    }
    res.statusCode = 404;
    res.end();
  };
  return {
    handler,
    requests,
    publish(next: Media, all: Media[]) {
      scheduleVersion += 1;
      current = next;
      rotation = all;
      startedAt = start();
    },
    get scheduleVersion() { return scheduleVersion; },
  };
}

async function serveDist() {
  const dist = resolve("apps/os-experience/dist");
  return listen(async (req, res) => {
    const pathname = (req.url ?? "/").split("?")[0]!;
    const target = join(dist, pathname === "/" ? "index.html" : pathname);
    try {
      const body = await readFile(target);
      const extension = extname(target);
      res.setHeader("content-type", extension === ".js" ? "text/javascript" : extension === ".css" ? "text/css" : extension === ".html" ? "text/html" : "application/octet-stream");
      res.end(body);
    } catch {
      res.setHeader("content-type", "text/html");
      res.end(await readFile(join(dist, "index.html")));
    }
  });
}

async function openHost(
  context: BrowserContext,
  ports: { xperience: number; bootstrap: number; broadcast: number },
  locked?: { providerId: string; executionMode?: string; purpose?: string },
) {
  const page = await context.newPage();
  const external: string[] = [];
  const producer: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/mrfundzman\.getlifeos\.app|app\.getlifeos\.app/.test(url)) external.push(url);
    if (url.startsWith(`http://127.0.0.1:${ports.broadcast}/`)) producer.push(url);
  });
  await page.addInitScript(({ bootstrapPort, broadcastPort, lock }) => {
    const host = window as Window & Record<string, unknown>;
    host.__oxBootstrapEntry = { experienceId: "bootstrap.mybrandos.public", name: "mybrandOS", version: "test", entrypoint: `http://127.0.0.1:${bootstrapPort}/`, origin: `http://127.0.0.1:${bootstrapPort}/`, authMode: "PUBLIC", offlineCapability: "PARTIAL", status: "READY", lastUpdatedAt: new Date().toISOString() };
    host.__oxBroadcastApiBase = `http://127.0.0.1:${broadcastPort}`;
    if (lock) host.__oxLockedExperience = lock;
  }, { bootstrapPort: ports.bootstrap, broadcastPort: ports.broadcast, lock: locked ?? null });
  await page.goto(`http://127.0.0.1:${ports.xperience}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 15_000 });
  return { page, external, producer };
}

const frame = (page: Page) => page.getByTestId("in-app-experience");

async function expectTarget(page: Page, mode: "APP" | "SPACE") {
  await page.waitForSelector(`[data-testid="in-app-experience"][data-execution-mode="${mode}"][data-provider-id="${providerId}"]`, { timeout: 15_000 });
}

/** The Offline Kernel titles local media by canonical content id, so the id proves which real video is on air. */
async function playTv(page: Page, expected: Media, previousSource?: string | null) {
  const expectedLabel = expected.label;
  await page.getByRole("button", { name: "TV", exact: true }).click();
  await page.waitForFunction(({ mediaId, previous }) => {
    const video = document.querySelector<HTMLVideoElement>('[data-testid="space-tv-video"]');
    const title = document.querySelector('[data-testid="space-tv-title"]')?.textContent ?? "";
    return Boolean(video && video.src.startsWith("blob:") && video.src !== previous && title === mediaId && video.readyState >= 2);
  }, { mediaId: expected.mediaId, previous: previousSource ?? null }, { timeout: 90_000 });
  const video = page.getByTestId("space-tv-video");
  const before = await video.evaluate((element: HTMLVideoElement) => ({ time: element.currentTime, width: element.videoWidth, height: element.videoHeight, renderedWidth: element.getBoundingClientRect().width, renderedHeight: element.getBoundingClientRect().height, src: element.src }));
  await page.waitForTimeout(700);
  const after = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  assert.ok(after > before.time, `${expectedLabel} clock did not advance: ${before.time} → ${after}`);
  assert.ok(before.width > 0 && before.height > 0, `${expectedLabel} has no decoded video frames`);
  assert.ok(Math.abs(before.renderedWidth / before.renderedHeight - before.width / before.height) < 0.02, `${expectedLabel} aspect ratio distorted`);
  assert.equal(await page.getByTestId("space-tv").getAttribute("data-channel"), channelId);
  return { ...before, after };
}

async function persistedBroadcast(page: Page) {
  return page.evaluate(() => new Promise<Array<{ key: string; value: { scheduleVersion?: number; programs?: Array<{ mediaId: string }>; bytes?: Uint8Array; checksum?: string } }>>((done, fail) => {
    const request = indexedDB.open("digiconomy-offline-kernel");
    request.onsuccess = () => {
      const all = request.result.transaction("broadcast").objectStore("broadcast").getAll();
      all.onsuccess = () => done(all.result as never);
      all.onerror = () => fail(all.error);
    };
    request.onerror = () => fail(request.error);
  }));
}

function reachable(rect: Rect | undefined, viewport: { width: number; height: number }) {
  return Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height);
}

async function rectOf(page: Page, selector: string): Promise<Rect | undefined> {
  return page.evaluate((query) => {
    const rect = document.querySelector<HTMLElement>(query)?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : undefined;
  }, selector);
}

for (const profile of profiles) test(`dual-xperience directory acceptance on ${profile.name}`, async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const a = await loadMedia(videoA.file);
  assert.equal(a.mediaId, videoA.canonicalMediaId);
  const b = await loadMedia(videoBFile);
  assert.notEqual(a.mediaId, b.mediaId);
  const producer = broadcastProducer({ a, b });
  const broadcast = await listen(producer.handler);
  const bootstrap = await listen((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>mrfundzmanOS</title><main>mrfundzmanOS ready</main>"); });
  const xperience = await serveDist();
  const ports = { xperience: xperience.port, bootstrap: bootstrap.port, broadcast: broadcast.port };
  const profileDir = await mkdtemp(join(tmpdir(), "ox-dual-"));
  let context = await chromium.launchPersistentContext(profileDir, { headless: true, ...profile });
  try {
    const { page, external } = await openHost(context, ports);

    // A — general host opens on OS Xperience, not inside a provider; the Directory lists the provider with both modes.
    await page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    assert.equal(await frame(page).count(), 0, "general mode must not auto-enter a provider");
    await page.getByTestId("nav-directory").click();
    await page.waitForSelector('[data-testid="directory"]');
    const card = page.getByTestId(`provider-card-${providerId}`);
    await card.waitFor({ state: "visible" });
    assert.deepEqual(await page.getByTestId(`provider-modes-${providerId}`).locator("em").allInnerTexts(), ["APP", "SPACE"]);
    await card.locator(".ox-card-main").click();
    await page.waitForSelector('[data-testid="app-details"]');
    const appButton = page.getByTestId(`xperience-target-${providerId}-app`);
    const spaceButton = page.getByTestId(`xperience-target-${providerId}-space`);
    assert.equal(await appButton.innerText(), "Xperience App");
    assert.equal(await spaceButton.innerText(), "Xperience Space");
    console.log("ACCEPTANCE_A_DIRECTORY", profile.name, "provider:", providerId, "modes:APP,SPACE");

    // B — APP is the provider's own UI on the Online Kernel: no Space overlay, no TV, no Offline Kernel traffic.
    await appButton.click();
    await expectTarget(page, "APP");
    await page.frameLocator("iframe.ox-immersive-frame.is-active").getByText("mrfundzmanOS ready").waitFor({ timeout: 15_000 });
    assert.equal(await page.locator("iframe.ox-immersive-frame.is-active").getAttribute("src"), `http://127.0.0.1:${bootstrap.port}/`);
    assert.equal(await page.locator(".ox-space-summon").count(), 0);
    assert.equal(await page.getByTestId("space-tv").count(), 0);
    assert.equal(await page.getByRole("button", { name: "mrfundzmanOS deliverables" }).count(), 0);
    assert.equal(producer.requests.length, 0, "APP must not touch the Offline Kernel broadcast path");
    if (profile.name === "phone") {
      assert.ok(reachable(await rectOf(page, '[data-testid="top-voice"]'), profile.viewport), "phone top microphone is not reachable");
      assert.ok(reachable(await rectOf(page, '[data-testid="xperience-host-controls"]'), profile.viewport), "phone host control is not reachable");
      assert.equal(await page.locator(".ox-bottom-nav button").count(), 0, "bottom navigation must be suppressed in the Xperience frame");
    }
    await page.getByTestId("xperience-host-controls").click();
    const menu = page.getByRole("menu", { name: "Xperience controls" });
    assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts(), ["Xperience Space", "Switch provider", "Leave Xperience"]);
    console.log("ACCEPTANCE_B_APP", profile.name, "provider-ui:online", "space-overlay:absent", "offline-kernel-requests:0");

    // C — SPACE is the same provider identity on the Offline Kernel path.
    await menu.getByRole("menuitem", { name: "Xperience Space" }).click();
    await expectTarget(page, "SPACE");
    assert.equal(await page.getByTestId("xperience-host-controls").count(), 0);
    await page.getByRole("button", { name: "Summon controls" }).click();
    const controls = page.getByTestId("space-controls");
    assert.deepEqual(await controls.getByRole("button").allInnerTexts(), ["TV", "Space Switch", "Revolve", "Return to App"]);
    if (profile.name === "phone") {
      const tvBox = await page.getByRole("button", { name: "TV", exact: true }).boundingBox();
      assert.ok(tvBox && reachable({ width: tvBox.width, height: tvBox.height, left: tvBox.x, top: tvBox.y, right: tvBox.x + tvBox.width, bottom: tvBox.y + tvBox.height }, profile.viewport), "phone SPACE TV control is not reachable");
    }
    await page.getByRole("button", { name: "Revolve" }).click();
    await page.getByText("NO OTHER EXTERNAL SPACES").waitFor();
    console.log("ACCEPTANCE_C_SPACE", profile.name, "same-provider:", providerId);

    // D — TV plays real Video A from local blob storage, then real Video B after the producer publishes it.
    const playedA = await playTv(page, a);
    assert.ok(producer.requests.includes(`/api/public/broadcast/${channelId}`));
    assert.ok(producer.requests.includes(`/public/mrfundzman-tv/${a.label}/media`));
    console.log("ACCEPTANCE_D_VIDEO_A", profile.name, `${playedA.width}x${playedA.height}`, `time:${playedA.time}->${playedA.after}`);
    producer.publish(b, [b, a]);
    const playedB = await playTv(page, b, playedA.src);
    assert.ok(producer.requests.includes(`/public/mrfundzman-tv/${b.label}/media`));
    const persisted = await persistedBroadcast(page);
    assert.equal(persisted.find((row) => row.key === `schedule:${channelId}`)?.value.scheduleVersion, producer.scheduleVersion);
    assert.equal(persisted.find((row) => row.key === `media:${a.mediaId}`)?.value.checksum, a.checksum);
    assert.equal(persisted.find((row) => row.key === `media:${b.mediaId}`)?.value.checksum, b.checksum);
    console.log("ACCEPTANCE_D_VIDEO_B", profile.name, `${playedB.width}x${playedB.height}`, `time:${playedB.time}->${playedB.after}`);

    // Switcher keeps provider switching and APP ↔ SPACE switching separate.
    await page.getByTestId("summon-switcher").dispatchEvent("click");
    await page.waitForSelector('[data-testid="experience-switcher"]');
    assert.equal(await page.getByTestId("switcher-mode-space").getAttribute("aria-checked"), "true");
    assert.equal(await page.getByTestId("switcher-mode-app").getAttribute("aria-checked"), "false");
    assert.ok(await page.getByTestId(`switcher-item-${providerId}`).isVisible());
    await page.getByTestId("switcher-dismiss").click();
    assert.equal(await page.title(), "OS Xperience");
    assert.equal(external.length, 0);

    await context.close();
    await close(broadcast.server);
    console.log("ACCEPTANCE_PRODUCER_UNAVAILABLE", profile.name);

    // E — NO_ROUTE: producer gone; continuity reopens the same provider in SPACE and TV plays from local media only.
    context = await chromium.launchPersistentContext(profileDir, { headless: true, ...profile });
    const offline = await openHost(context, ports);
    await expectTarget(offline.page, "SPACE");
    const stored = await persistedBroadcast(offline.page);
    assert.equal(stored.find((row) => row.key === `media:${a.mediaId}`)?.value.bytes?.byteLength, a.bytes.byteLength);
    assert.equal(stored.find((row) => row.key === `media:${b.mediaId}`)?.value.bytes?.byteLength, b.bytes.byteLength);
    await offline.page.getByRole("button", { name: "Summon controls" }).click();
    const playedOffline = await playTv(offline.page, b);
    const projectionAttempts = offline.producer.filter((url) => url.includes("/broadcast/")).length;
    assert.ok(projectionAttempts >= 1, "NO_ROUTE run did not attempt the unavailable projection");
    assert.equal(offline.external.length, 0);
    console.log("ACCEPTANCE_E_NO_ROUTE", profile.name, `projection-attempts:${projectionAttempts}`, `local-blob:${playedOffline.src.startsWith("blob:")}`, `time:${playedOffline.time}->${playedOffline.after}`);
  } finally {
    await context.close().catch(() => undefined);
    await close(broadcast.server);
    await close(bootstrap.server);
    await close(xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});

test("locked mode stays available and distinct from general mode", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const a = await loadMedia(videoA.file);
  const producer = broadcastProducer({ a });
  const broadcast = await listen(producer.handler);
  const bootstrap = await listen((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>mrfundzmanOS</title><main>mrfundzmanOS ready</main>"); });
  const xperience = await serveDist();
  const ports = { xperience: xperience.port, bootstrap: bootstrap.port, broadcast: broadcast.port };
  const dirs: string[] = [];
  const contexts: BrowserContext[] = [];
  const launch = async () => {
    const dir = await mkdtemp(join(tmpdir(), "ox-locked-"));
    dirs.push(dir);
    const context = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1440, height: 900 } });
    contexts.push(context);
    return context;
  };
  try {
    // Presentation lock: enters the pinned provider directly, in APP, with APP ↔ SPACE switching only.
    const presentation = await openHost(await launch(), ports, { providerId, purpose: "ACCEPTANCE" });
    await expectTarget(presentation.page, "APP");
    assert.equal(await frame(presentation.page).getAttribute("data-host-mode"), "LOCKED");
    await presentation.page.getByTestId("xperience-host-controls").click();
    assert.deepEqual(await presentation.page.getByRole("menu", { name: "Xperience controls" }).getByRole("menuitem").allInnerTexts(), ["Xperience Space"]);
    await presentation.page.getByRole("menuitem", { name: "Xperience Space" }).click();
    await expectTarget(presentation.page, "SPACE");
    await presentation.page.getByRole("button", { name: "Summon controls" }).click();
    const played = await playTv(presentation.page, a);
    await presentation.page.getByTestId("summon-switcher").dispatchEvent("click");
    assert.deepEqual(await presentation.page.locator('[data-testid^="switcher-item-"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-testid"))), [`switcher-item-${providerId}`]);
    console.log("LOCKED_PRESENTATION", "APP->SPACE->TV", `${played.width}x${played.height}`);

    // Kiosk lock with a fixed SPACE mode: no directory, no return to APP.
    const kiosk = await openHost(await launch(), ports, { providerId, executionMode: "SPACE", purpose: "KIOSK" });
    await expectTarget(kiosk.page, "SPACE");
    await kiosk.page.getByRole("button", { name: "Summon controls" }).click();
    assert.equal(await kiosk.page.getByTestId("switch-to-app").count(), 0);
    await playTv(kiosk.page, a);
    console.log("LOCKED_KIOSK", "SPACE-fixed", "return-to-app:absent");

    // A general host in the same build is unaffected by those locks.
    const general = await openHost(await launch(), ports);
    await general.page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    assert.equal(await frame(general.page).count(), 0);
    console.log("GENERAL_UNAFFECTED_BY_LOCK");
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await close(broadcast.server);
    await close(bootstrap.server);
    await close(xperience.server);
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  }
});
