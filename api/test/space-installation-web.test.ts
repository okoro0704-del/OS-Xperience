import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import type { BrowserContext, Page } from "playwright";

/**
 * Space Installation V1 in a browser (no native home-entry host): Directory → INSTALL SPACE runs the
 * bundled signed artifact through the Space Launch File V1 verifier, preparation reaches READY OFFLINE,
 * and the home-screen capability is reported UNSUPPORTED rather than faked.
 */
const providerId = "bootstrap.mybrandos.public";
const channelId = "mrfundzman.tv";
const artifactPath = "/spaces/mrfundzman.space";

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
        programId: `install-p${sequence}`, mediaId, title: `Program ${sequence + 1}`,
        scheduledStart: new Date(startedAt + sequence * 600_000).toISOString(), durationMs: 600_000, sequence,
        media: { path: "/public/install/media", version: "1", contentType: "video/mp4", byteLength: bytes.byteLength, checksum },
      }));
      res.end(JSON.stringify({ channelId, publisherId: "mrfundzman", scheduleId: "install", scheduleVersion: 1, programs }));
      return;
    }
    if (url === "/public/install/media") {
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
  const requests: string[] = [];
  const served = await listen(async (req, res) => {
    const pathname = (req.url ?? "/").split("?")[0]!;
    requests.push(pathname);
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
  return { ...served, requests };
}

async function hermetic(context: BrowserContext) {
  await context.route(/^https:\/\/xperience\.getlifeos\.app\//, (route) => route.abort("internetdisconnected"));
  await context.route(/^https:\/\/(mrfundzman|app)\.getlifeos\.app\//, (route) => route.abort("internetdisconnected"));
  await context.route(/^https:\/\/xperience-api-production-37ee\.up\.railway\.app\//, (route) => route.abort("internetdisconnected"));
}

async function kernelRows(page: Page) {
  return page.evaluate(() => new Promise<number>((done, fail) => {
    const open = indexedDB.open("digiconomy-offline-kernel", 1);
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const count = open.result.transaction("broadcast").objectStore("broadcast").count();
      count.onerror = () => fail(count.error);
      count.onsuccess = () => done(count.result);
    };
  }));
}

async function openDetail(page: Page) {
  await page.locator('[data-testid="nav-directory"]:visible').click();
  await page.getByTestId(`provider-card-${providerId}`).locator(".ox-card-main").click();
  await page.getByTestId("app-details").waitFor();
  const card = page.getByTestId(`space-install-${providerId}`);
  await card.waitFor();
  return card;
}

test("Space Installation V1 (browser): Directory → Install Space → verify → prepare → READY OFFLINE; home entry UNSUPPORTED", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const producer = broadcastProducer();
  const broadcast = await listen(producer.handler);
  const bootstrap = await listen((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>mrfundzmanOS</title>"); });
  const xperience = await serveDist();
  const profileDir = await mkdtemp(join(tmpdir(), "ox-space-install-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  await hermetic(context);
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.addInitScript(({ bootstrapPort, broadcastPort }) => {
      const host = window as Window & Record<string, unknown>;
      host.__oxBootstrapEntry = { experienceId: "bootstrap.mybrandos.public", name: "mybrandOS", version: "test", entrypoint: `http://127.0.0.1:${bootstrapPort}/`, origin: `http://127.0.0.1:${bootstrapPort}/`, authMode: "PUBLIC", offlineCapability: "PARTIAL", status: "READY", lastUpdatedAt: new Date().toISOString(), executionModes: [{ mode: "APP" }] };
      host.__oxBroadcastApiBase = `http://127.0.0.1:${broadcastPort}`;
    }, { bootstrapPort: bootstrap.port, broadcastPort: broadcast.port });
    await page.goto(`http://127.0.0.1:${xperience.port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="home"]', { timeout: 15_000 });
    const toApp = () => requests.filter((url) => url.startsWith(`http://127.0.0.1:${bootstrap.port}/`));

    const card = await openDetail(page);
    assert.equal(await card.getAttribute("data-stage"), "NOT_INSTALLED");
    assert.equal(await card.getAttribute("data-home-entry"), "UNSUPPORTED", "browsers cannot create an Android home entry");

    // A tampered artifact is refused by the V1 verifier: no registration, no preparation, no home entry.
    await page.route((url) => url.pathname === artifactPath, async (route) => {      const original = await readFile(resolve(`apps/os-experience/public${artifactPath}`), "utf8");
      await route.fulfill({ status: 200, contentType: "application/octet-stream", body: original.replace('"MrFundzMan"', '"FakeTV"') });
    });
    await page.getByTestId(`install-space-${providerId}`).click();
    await page.getByTestId("space-install-status").waitFor();
    assert.equal(await page.getByTestId("space-install-status").getAttribute("data-code"), "INTEGRITY_FAILED");
    assert.equal(await card.getAttribute("data-stage"), "NOT_INSTALLED");
    assert.equal(await page.getByTestId(`install-prepare-${providerId}`).count(), 0);
    await page.unrouteAll();

    // The genuine artifact installs through the same verifier, from this installation's own bundle.
    await page.getByTestId(`install-space-${providerId}`).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="space-install-status"]')?.getAttribute("data-code") === "REGISTERED");
    assert.ok(xperience.requests.includes(artifactPath), "the signed artifact comes from the bundle");
    assert.deepEqual(producer.requests, [], "installing fetches nothing from the producer");
    assert.deepEqual(toApp(), [], "installing never probes the App");
    await page.waitForFunction((id) => document.querySelector(`[data-testid="space-install-${id}"]`)?.getAttribute("data-stage") === "REGISTERED", providerId);
    assert.match(await card.innerText(), /Publisher verified/);
    assert.match(await card.innerText(), /MrFundzMan/);

    await page.getByTestId(`install-prepare-${providerId}`).click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="space-install-${id}"]`)?.getAttribute("data-stage") === "READY_OFFLINE", providerId, { timeout: 60_000 });
    assert.ok(producer.requests.includes("/public/install/media"), "preparation acquires media");
    assert.equal(await page.getByTestId(`install-ready-${providerId}`).innerText(), "Ready offline.");
    assert.equal(await page.getByTestId(`install-add-home-${providerId}`).count(), 0, "no fake Add to Home Screen in a browser");
    assert.deepEqual(toApp(), []);
    const preparedRows = await kernelRows(page);
    assert.ok(preparedRows >= 2, `prepared kernel rows: ${preparedRows}`);

    // Manage: delete offline data is explained first, then removes only prepared data.
    await page.getByTestId(`install-manage-${providerId}`).click();
    const row = page.getByTestId(`xperience-space-${providerId}`);
    await row.waitFor();
    await page.getByTestId(`space-manage-${providerId}`).waitFor();
    assert.equal(await page.getByTestId(`space-verification-${providerId}`).innerText(), "Verified publisher signature");
    assert.equal(await page.getByTestId(`remove-home-${providerId}`).count(), 0, "no home entry to remove");
    assert.equal(await row.getAttribute("data-home-entry"), "UNSUPPORTED");
    await page.getByTestId(`delete-offline-${providerId}`).click();
    await page.getByTestId("delete-offline-modal").waitFor();
    await page.getByTestId("confirm-delete-offline").click();
    await page.waitForFunction((id) => document.querySelector(`[data-testid="xperience-space-${id}"]`)?.getAttribute("data-readiness") === "NOT_PREPARED", providerId);
    assert.equal(await kernelRows(page), 0, "prepared schedule and media deleted");
    assert.equal(await row.getAttribute("data-registered"), "true", "registration unchanged");
    console.log("SPACE_INSTALL_BROWSER", "tampered:INTEGRITY_FAILED", "install:REGISTERED", "prepare:READY_OFFLINE", "home-entry:UNSUPPORTED", `deleted-rows:${preparedRows}`, "app-requests:0");
  } finally {
    await context.close().catch(() => undefined);
    await close(broadcast.server);
    await close(bootstrap.server);
    await close(xperience.server);
    await rm(profileDir, { recursive: true, force: true });
  }
});
