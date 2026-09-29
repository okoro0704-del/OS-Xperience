/**
 * Migrated from locked-by-default kernel hydration.
 *
 * The old tests assumed every viewport opened already inside the provider
 * and could pick TV from the deliverables menu. That encoded
 * device profile → Space.
 *
 * Current invariant, for desktop, phone, and large-display alike:
 * - general launch stays on the Directory host (APP is not auto-entered, SPACE is not auto-entered);
 * - explicit Xperience App uses the provider UI and does not touch the Offline Kernel broadcast;
 * - explicit Xperience Space hydrates the Offline Kernel from the canonical MrFundzMan media;
 * - after the producer is gone, TV plays that saved media from a local blob.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import type { BrowserContext, Page } from "playwright";

const fixture = "C:\\Users\\Hp\\Desktop\\MRFUNDZMAN-TV-ACCEPTANCE\\RCTH2872.MOV";
const canonicalMediaId = "content:sha256:e1d41422304fcce946c6640d07999c41f499c340ba4f935166e656ae9e9d774e";
const providerId = "bootstrap.mybrandos.public";
const channelId = "mrfundzman.tv";
const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: "large-display", viewport: { width: 1920, height: 1080 }, isMobile: false, hasTouch: false },
] as const;

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

for (const profile of profiles) {
  test(`explicit ${profile.name} presentation does not select execution; SPACE hydrates the offline kernel`, async (t) => {
    let chromium: typeof import("playwright").chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      t.skip("playwright unavailable");
      return;
    }

    const bytes = await readFile(fixture);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    assert.equal(checksum, canonicalMediaId.slice("content:sha256:".length));
    const requests: string[] = [];
    const startedAt = new Date(Date.now() - 10_000).toISOString();
    const broadcast = await listen((req, res) => {
      const url = req.url ?? "";
      requests.push(url);
      res.setHeader("access-control-allow-origin", "*");
      if (url === `/api/public/broadcast/${channelId}`) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          channelId,
          publisherId: "mrfundzman",
          scheduleId: "mrfundzman-tv",
          scheduleVersion: 1,
          programs: [0, 1, 2].map((sequence) => ({
            programId: `p${sequence}`,
            mediaId: canonicalMediaId,
            title: `MRFUNDZMAN TV RCTH2872 ${sequence + 1}`,
            scheduledStart: new Date(Date.parse(startedAt) + sequence * 600_000).toISOString(),
            durationMs: 600_000,
            sequence,
            media: {
              path: "/public/mrfundzman-tv/RCTH2872/media",
              version: "1",
              contentType: "video/quicktime",
              byteLength: bytes.byteLength,
              checksum,
            },
          })),
        }));
        return;
      }
      if (url.includes("/media")) {
        res.setHeader("content-type", "video/quicktime");
        res.end(bytes);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const bootstrap = await listen((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>mrfundzmanOS</title><main>mrfundzmanOS ready</main>");
    });
    const xperience = await serveDist();
    const profileDir = await mkdtemp(join(tmpdir(), "ox-hydration-"));
    let browser = await chromium.launchPersistentContext(profileDir, { headless: true, ...profile });

    const arm = async (context: BrowserContext) => {
      const page = await context.newPage();
      const external: string[] = [];
      const producer: string[] = [];
      page.on("request", (request) => {
        const url = request.url();
        if (/mrfundzman\.getlifeos\.app|app\.getlifeos\.app/.test(url)) external.push(url);
        if (url.startsWith(`http://127.0.0.1:${broadcast.port}/`)) producer.push(url);
      });
      await page.addInitScript(({ bootstrapPort, broadcastPort }) => {
        const host = window as Window & Record<string, unknown>;
        host.__oxBootstrapEntry = {
          experienceId: "bootstrap.mybrandos.public",
          name: "mybrandOS",
          version: "test",
          entrypoint: `http://127.0.0.1:${bootstrapPort}/`,
          origin: `http://127.0.0.1:${bootstrapPort}/`,
          authMode: "PUBLIC",
          offlineCapability: "PARTIAL",
          status: "READY",
          lastUpdatedAt: new Date().toISOString(),
        };
        host.__oxBroadcastApiBase = `http://127.0.0.1:${broadcastPort}`;
      }, { bootstrapPort: bootstrap.port, broadcastPort: broadcast.port });
      await page.goto(`http://127.0.0.1:${xperience.port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 15_000 });
      return { page, external, producer };
    };

    const expectMode = (page: Page, mode: "APP" | "SPACE") =>
      page.waitForSelector(`[data-testid="in-app-experience"][data-execution-mode="${mode}"][data-provider-id="${providerId}"]`, { timeout: 15_000 });

    try {
      const { page, external } = await arm(browser);
      await page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
      assert.equal(await page.getByTestId("in-app-experience").count(), 0, `${profile.name} must not auto-enter Space or App`);
      await page.getByTestId("nav-directory").click();
      const card = page.getByTestId(`provider-card-${providerId}`);
      await card.waitFor({ state: "visible" });
      assert.deepEqual(await page.getByTestId(`provider-modes-${providerId}`).locator("em").allInnerTexts(), ["APP", "SPACE"]);
      await card.locator(".ox-card-main").click();
      await page.getByTestId(`xperience-target-${providerId}-app`).click();
      await expectMode(page, "APP");
      assert.equal(requests.length, 0, "APP must not hydrate the offline broadcast");
      assert.equal(await page.getByTestId("space-tv").count(), 0);

      await page.getByTestId("xperience-host-controls").click();
      await page.getByRole("menuitem", { name: "Xperience Space" }).click();
      await expectMode(page, "SPACE");
      assert.equal(await page.getByTestId("in-app-experience").getAttribute("data-provider-id"), providerId);
      await page.getByRole("button", { name: "Summon controls" }).click();
      if (profile.name === "phone") {
        const box = await page.getByRole("button", { name: "TV", exact: true }).boundingBox();
        assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= profile.viewport.width && box.y + box.height <= profile.viewport.height);
      }
      await page.getByRole("button", { name: "TV", exact: true }).click();
      await page.waitForFunction((mediaId) => {
        const video = document.querySelector<HTMLVideoElement>('[data-testid="space-tv-video"]');
        const title = document.querySelector("[data-testid='space-tv-title']")?.textContent ?? "";
        return Boolean(video && video.src.startsWith("blob:") && title === mediaId && video.readyState >= 2 && video.videoWidth > 0);
      }, canonicalMediaId, { timeout: 90_000 });
      const before = await page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime);
      await page.waitForTimeout(700);
      const after = await page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime);
      assert.ok(after > before, `video clock did not advance: ${before} → ${after}`);
      assert.ok(requests.includes(`/api/public/broadcast/${channelId}`));
      assert.ok(requests.some((path) => path.includes("/media")));
      const persisted = await page.evaluate(() => new Promise<Array<{ key: string }>>((done, fail) => {
        const request = indexedDB.open("digiconomy-offline-kernel");
        request.onsuccess = () => {
          const all = request.result.transaction("broadcast").objectStore("broadcast").getAll();
          all.onsuccess = () => done(all.result as Array<{ key: string }>);
          all.onerror = () => fail(all.error);
        };
        request.onerror = () => fail(request.error);
      }));
      assert.ok(persisted.some((row) => row.key === `schedule:${channelId}`));
      assert.ok(persisted.some((row) => row.key === `media:${canonicalMediaId}`));
      assert.equal(external.length, 0);

      await browser.close();
      await close(broadcast.server);
      browser = await chromium.launchPersistentContext(profileDir, { headless: true, ...profile });
      const offline = await arm(browser);
      await expectMode(offline.page, "SPACE");
      await offline.page.getByRole("button", { name: "Summon controls" }).click();
      await offline.page.getByRole("button", { name: "TV", exact: true }).click();
      await offline.page.waitForFunction((mediaId) => {
        const video = document.querySelector<HTMLVideoElement>('[data-testid="space-tv-video"]');
        const title = document.querySelector("[data-testid='space-tv-title']")?.textContent ?? "";
        return Boolean(video && video.src.startsWith("blob:") && title === mediaId && video.readyState >= 2 && video.videoWidth > 0);
      }, canonicalMediaId, { timeout: 90_000 });
      const offlineBefore = await offline.page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime);
      await offline.page.waitForTimeout(700);
      const offlineAfter = await offline.page.getByTestId("space-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime);
      assert.ok(offlineAfter > offlineBefore, `offline video clock did not advance: ${offlineBefore} → ${offlineAfter}`);
      const mediaAttempts = offline.producer.filter((url) => url.includes("/media")).length;
      assert.equal(mediaAttempts, 0, "NO_ROUTE playback must not request media bytes");
      assert.ok(offline.producer.some((url) => url.includes("/broadcast/")), "NO_ROUTE still attempts the unavailable projection");
      assert.equal(offline.external.length, 0);
    } finally {
      await browser.close().catch(() => undefined);
      await close(broadcast.server);
      await close(bootstrap.server);
      await close(xperience.server);
      await rm(profileDir, { recursive: true, force: true });
    }
  });
}
