import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import test from "node:test";

/**
 * A Space is the provider's software running without internet — not only its TV. MrFundzMan has
 * published media and no broadcast schedule: preparing the Space syncs that media, and offline the
 * Space opens and plays it from this installation. No broadcast route exists in this test at all.
 */
const providerId = "bootstrap.mybrandos.public";
const api = "https://mrfundzman.getlifeos.app/api/public/mrfundzman/assets";
const video = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 251));
const image = Buffer.from([255, 216, 255, 224, 0, 16]);
const catalog = {
  assets: [
    { id: "vid1", title: "Episode 1", description: "First episode", assetType: "VIDEO", publishedAt: "2026-09-20T03:22:59.022Z", mediaAvailable: true, coverAvailable: false },
    { id: "des1", title: "Real estate", description: "", assetType: "DESIGN", publishedAt: "2026-09-19T12:49:01.926Z", mediaAvailable: false, coverAvailable: true },
  ],
};

async function serveDist() {
  const dist = resolve("apps/os-experience/dist");
  const server = createServer((req: IncomingMessage, res: ServerResponse) => void (async () => {
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
  })());
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

test("Space without a broadcast: preparation syncs published media; offline the Space opens and plays it", async (t) => {
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const xperience = await serveDist();
  const base = `http://127.0.0.1:${xperience.port}`;
  const profileDir = await mkdtemp(join(tmpdir(), "ox-space-library-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 412, height: 915 } });
  const contentRequests: string[] = [];
  const providerPageRequests: string[] = [];
  const broadcastRequests: string[] = [];
  let publisherReachable = false;
  await context.route(/^https:\/\/xperience\.getlifeos\.app\//, (route) => route.abort("internetdisconnected"));
  await context.route(/^https:\/\/xperience-api-production-37ee\.up\.railway\.app\//, (route) => route.abort("internetdisconnected"));
  await context.route(/^https:\/\/(mrfundzman|app)\.getlifeos\.app\//, (route) => {
    const url = route.request().url();
    const cors = { "access-control-allow-origin": base };
    if (!publisherReachable) return route.abort("internetdisconnected");
    if (url.includes("/api/public/broadcast/")) { broadcastRequests.push(url); return route.fulfill({ status: 404, headers: cors, contentType: "application/json", body: '{"error":"broadcast_not_found"}' }); }
    if (url === api) { contentRequests.push(url); return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(catalog) }); }
    if (url === `${api}/vid1/media`) { contentRequests.push(url); return route.fulfill({ status: 200, headers: cors, contentType: "video/mp4", body: video }); }
    if (url === `${api}/des1/cover`) { contentRequests.push(url); return route.fulfill({ status: 200, headers: cors, contentType: "image/jpeg", body: image }); }
    // The provider's live software is unreachable in this test.
    providerPageRequests.push(url);
    return route.abort("internetdisconnected");
  });
  try {
    const page = await context.newPage();
    await page.goto(base);
    await page.locator('[data-testid="nav-directory"]:visible').click();
    await page.getByTestId(`provider-card-${providerId}`).locator(".ox-card-main").click();
    await page.getByTestId("app-details").waitFor();

    // Register the Space from the build's signed launch file. Nobody presses Prepare: the creator's
    // posts are the preparation, and the Space syncs them by itself while connected.
    const install = page.getByTestId(`install-space-${providerId}`);
    if (await install.isVisible().catch(() => false)) await install.click();
    assert.equal(await page.getByTestId(`install-prepare-${providerId}`).count(), 0, "there is no manual Prepare");

    // The publisher is unreachable when the Space registers: nothing arrives, and the user is told
    // it syncs by itself — not asked to do anything.
    await page.getByTestId(`install-syncing-${providerId}`).waitFor({ timeout: 15_000 });
    assert.match(await page.getByTestId(`install-syncing-${providerId}`).innerText(), /syncs automatically|Syncing/);
    assert.equal(await page.getByTestId(`install-ready-${providerId}`).count(), 0);

    // Connectivity returns: the Space syncs the creator's posts by itself, with no user action.
    publisherReachable = true;
    await context.setOffline(true);
    await page.waitForTimeout(300);
    await context.setOffline(false);
    await page.getByTestId(`install-ready-${providerId}`).waitFor({ timeout: 20_000 });
    assert.deepEqual(contentRequests, [api, `${api}/vid1/media`, `${api}/des1/cover`], "the Space's published content was synced");
    assert.equal(broadcastRequests.length, 0, "no broadcast route is configured, and none was needed");

    // Offline: the Space runs from this installation and shows its synced content.
    await context.setOffline(true);
    contentRequests.length = 0;
    await page.getByTestId(`install-enter-${providerId}`).click();
    const library = page.getByTestId("space-library");
    await library.waitFor({ timeout: 15_000 });
    assert.equal(await library.getAttribute("data-space-id"), providerId);
    assert.deepEqual(await library.locator("[data-kind]").evaluateAll((items) => items.map((item) => item.getAttribute("data-kind"))), ["VIDEO", "IMAGE"]);

    await page.getByTestId("space-library-item-vid1").click();
    const player = page.getByTestId("space-library-video");
    await player.waitFor();
    assert.match((await player.getAttribute("src")) ?? "", /^blob:/, "played from local bytes");
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByTestId("space-library-item-des1").click();
    assert.match((await page.getByTestId("space-library-image").getAttribute("src")) ?? "", /^blob:/);

    assert.deepEqual(contentRequests, [], "offline playback makes no content request");
    console.log("SPACE_LIBRARY_OFFLINE", "items:2", "broadcast-requests:0", `provider-page-requests:${providerPageRequests.length}`);
  } finally {
    await context.close();
    xperience.server.closeAllConnections();
    await new Promise<void>((done) => xperience.server.close(() => done()));
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
