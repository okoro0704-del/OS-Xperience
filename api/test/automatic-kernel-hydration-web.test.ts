import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import test from "node:test";

const fixture = "C:\\Users\\Hp\\Desktop\\d apple ville backup\\dapple-ville-haven\\test-results\\04-wallet-Wallet---Authent-daff7-ser-should-load-wallet-page-chromium\\video.webm";
async function listen(handler: Parameters<typeof createServer>[0]) { const server = createServer(handler); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address === "object"); return { server, port: address.port }; }
async function close(server: ReturnType<typeof createServer>) { if (!server.listening) return; await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

test("automatic kernel hydration uses controlled HTTP and never production DNS", async (t) => {
  let chromium: typeof import("playwright").chromium; try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const bytes = await readFile(fixture); const checksum = createHash("sha256").update(bytes).digest("hex"); const start = new Date(Date.now() - 10_000).toISOString(); const requests: string[] = [];
  const broadcast = await listen((req, res) => { requests.push(req.url ?? ""); res.setHeader("access-control-allow-origin", "*"); if (req.url === "/api/public/broadcast/mrfundzman.tv") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ channelId:"mrfundzman.tv", publisherId:"test", scheduleId:"test", scheduleVersion:1, programs:[0,1,2].map((sequence) => ({ programId:`p${sequence}`, mediaId:`asset${sequence}`, title:`PROGRAM_${sequence}`, scheduledStart:new Date(Date.parse(start)+sequence*60_000).toISOString(), durationMs:60_000, sequence, media:{ path:`/public/test/assets/asset${sequence}/media`, version:"1", contentType:"video/webm", byteLength:bytes.byteLength, checksum } })) })); } if (req.url?.includes("/media")) { res.setHeader("content-type", "video/webm"); return res.end(bytes); } res.statusCode=404; res.end(); });
  const bootstrap = await listen((_req, res) => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>mrfundzmanOS</title><main>mrfundzmanOS ready</main>"); });
  const dist = resolve("apps/os-experience/dist");
  const xperience = await listen(async (req, res) => { const pathname = (req.url ?? "/").split("?")[0]!; const target = join(dist, pathname === "/" ? "index.html" : pathname); try { const body = await readFile(target); const extension = extname(target); res.setHeader("content-type", extension === ".js" ? "text/javascript" : extension === ".css" ? "text/css" : extension === ".html" ? "text/html" : "application/octet-stream"); res.end(body); } catch { res.setHeader("content-type", "text/html"); res.end(await readFile(join(dist, "index.html"))); } });
  const profile = await mkdtemp(join(tmpdir(), "ox-hydration-")); let browser = await chromium.launchPersistentContext(profile, { headless:true, viewport:{width:1280,height:800} });
  try {
    const page = await browser.newPage(); const external:string[]=[]; page.on("request", request => { if (/mrfundzman\.getlifeos\.app|app\.getlifeos\.app/.test(request.url())) external.push(request.url()); });
    await page.addInitScript(({ bootstrapPort, broadcastPort }) => { window.__oxBootstrapEntry = { experienceId:"bootstrap.mybrandos.public", name:"mybrandOS", version:"test", entrypoint:`http://127.0.0.1:${bootstrapPort}/`, origin:`http://127.0.0.1:${bootstrapPort}/`, authMode:"PUBLIC", offlineCapability:"PARTIAL", status:"READY", lastUpdatedAt:new Date().toISOString() }; window.__oxBroadcastApiBase=`http://127.0.0.1:${broadcastPort}`; }, { bootstrapPort:bootstrap.port, broadcastPort:broadcast.port });
    await page.goto(`http://127.0.0.1:${xperience.port}/`, { waitUntil:"domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state:"visible", timeout:15_000 });
    const deliverables = page.getByRole("button", { name: "mrfundzmanOS deliverables" });
    await deliverables.click();
    const tv = page.getByRole("menuitem", { name: "TV" });
    await tv.click();
    await page.waitForSelector('[data-testid="mrfundzman-tv"]', { state:"visible", timeout:15_000 });
    await page.waitForSelector('[data-testid="mrfundzman-tv-video"]', { state:"visible", timeout:15_000 });
    assert.ok(requests.includes("/api/public/broadcast/mrfundzman.tv")); assert.ok(requests.some((path) => path.includes("/media")));
    const source = await page.getByTestId("mrfundzman-tv-video").getAttribute("src"); assert.match(source ?? "", /^blob:/);
    await page.waitForFunction(() => { const video = document.querySelector<HTMLVideoElement>('[data-testid="mrfundzman-tv-video"]'); return Boolean(video && video.readyState >= 2); });
    const before = await page.getByTestId("mrfundzman-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime);
    await page.waitForTimeout(600);
    const after = await page.getByTestId("mrfundzman-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime);
    assert.ok(after > before, `video clock did not advance: ${before} → ${after}`);
    const persisted = await page.evaluate(async () => new Promise<Array<{ key:string; value:unknown }>>((resolve, reject) => { const request = indexedDB.open("digiconomy-offline-kernel"); request.onsuccess = () => { const getAll = request.result.transaction("broadcast").objectStore("broadcast").getAll(); getAll.onsuccess = () => resolve(getAll.result as Array<{ key:string; value:unknown }>); getAll.onerror = () => reject(getAll.error); }; request.onerror = () => reject(request.error); }));
    assert.ok(persisted.some((row) => row.key === "schedule:mrfundzman.tv")); assert.ok(persisted.some((row) => row.key === "media:asset0")); console.log("PHASE2_BROWSER1_PERSISTED", "schedule:mrfundzman.tv", "media:asset0");
    await deliverables.click(); await page.getByRole("menuitem", { name:"Space" }).click(); await page.getByRole("button", { name:"Summon controls" }).click(); await page.getByRole("button", { name:"Return to App" }).click(); await deliverables.waitFor({ state:"visible" }); console.log("PHASE2_REAL_UI_APP_TO_SPACE");
    assert.equal(await page.title(), "OS Xperience"); assert.equal(external.length, 0);
    await browser.close(); await close(broadcast.server); console.log("PHASE2_PRODUCER_UNAVAILABLE");
    browser = await chromium.launchPersistentContext(profile, { headless:true, viewport:{width:1280,height:800} });
    const offlinePage = await browser.newPage(); const offlineExternal:string[]=[]; offlinePage.on("request", request => { if (/mrfundzman\.getlifeos\.app|app\.getlifeos\.app/.test(request.url())) offlineExternal.push(request.url()); });
    const offlineProducerAttempts:string[]=[]; offlinePage.on("request", request => { if (request.url().startsWith(`http://127.0.0.1:${broadcast.port}/`)) offlineProducerAttempts.push(request.url()); });
    await offlinePage.addInitScript(({ bootstrapPort, broadcastPort }) => { window.__oxBootstrapEntry = { experienceId:"bootstrap.mybrandos.public", name:"mybrandOS", version:"test", entrypoint:`http://127.0.0.1:${bootstrapPort}/`, origin:`http://127.0.0.1:${bootstrapPort}/`, authMode:"PUBLIC", offlineCapability:"PARTIAL", status:"READY", lastUpdatedAt:new Date().toISOString() }; window.__oxBroadcastApiBase=`http://127.0.0.1:${broadcastPort}`; }, { bootstrapPort:bootstrap.port, broadcastPort:broadcast.port });
    await offlinePage.goto(`http://127.0.0.1:${xperience.port}/`, { waitUntil:"domcontentloaded" }); await offlinePage.waitForSelector('[data-testid="os-experience"]', { state:"visible", timeout:15_000 });
    const persistedBeforeTv = await offlinePage.evaluate(async () => new Promise<Array<{ key:string; value:{ scheduleVersion?:number; programs?:Array<{ programId:string; mediaId:string }>; bytes?:Uint8Array; checksum?:string } }>>((resolve, reject) => { const request = indexedDB.open("digiconomy-offline-kernel"); request.onsuccess = () => { const getAll = request.result.transaction("broadcast").objectStore("broadcast").getAll(); getAll.onsuccess = () => resolve(getAll.result as Array<{ key:string; value:{ scheduleVersion?:number; programs?:Array<{ programId:string; mediaId:string }>; bytes?:Uint8Array; checksum?:string } }>); getAll.onerror = () => reject(getAll.error); }; request.onerror = () => reject(request.error); }));
    const schedule = persistedBeforeTv.find((row) => row.key === "schedule:mrfundzman.tv"); const media = persistedBeforeTv.find((row) => row.key === "media:asset0"); assert.equal(schedule?.value.scheduleVersion, 1); assert.equal(schedule?.value.programs?.[0]?.programId, "p0"); assert.equal(schedule?.value.programs?.[0]?.mediaId, "asset0"); assert.equal(media?.value.bytes?.byteLength, bytes.byteLength); assert.equal(media?.value.checksum, checksum); console.log("PHASE2_BROWSER2_PERSISTED_BEFORE_TV", "schedule:v1", "p0:asset0", "asset0:bytes+checksum");
    console.log("PHASE2_BROWSER2_REAL_UI", (await offlinePage.locator("body").innerText()).slice(0, 400));
    await offlinePage.getByRole("button", { name:"mrfundzmanOS deliverables" }).click(); await offlinePage.getByRole("menuitem", { name:"Space" }).click(); await offlinePage.getByRole("button", { name:"Summon controls" }).click(); await offlinePage.getByRole("button", { name:"TV", exact:true }).click();
    await offlinePage.waitForSelector('[data-testid="mrfundzman-tv-video"]', { state:"visible", timeout:15_000 });
    const offlineSource = await offlinePage.getByTestId("mrfundzman-tv-video").getAttribute("src"); assert.match(offlineSource ?? "", /^blob:/); await offlinePage.waitForFunction(() => { const video = document.querySelector<HTMLVideoElement>('[data-testid="mrfundzman-tv-video"]'); return Boolean(video && video.readyState >= 2); }); const videoState = await offlinePage.getByTestId("mrfundzman-tv-video").evaluate((video: HTMLVideoElement) => ({ readyState:video.readyState, width:video.videoWidth, height:video.videoHeight, time:video.currentTime })); await offlinePage.waitForTimeout(700); const videoAfter = await offlinePage.getByTestId("mrfundzman-tv-video").evaluate((video: HTMLVideoElement) => video.currentTime); assert.ok(videoAfter > videoState.time, `offline video clock did not advance: ${videoState.time} → ${videoAfter}`); console.log("PHASE2_LOCAL_BLOB_PLAYBACK", offlineSource);
    const projectionAttempts = offlineProducerAttempts.filter((url) => url.includes("/broadcast/")).length; const mediaAttempts = offlineProducerAttempts.filter((url) => url.includes("/media")).length; assert.ok(projectionAttempts >= 1, "browser 2 did not attempt the unavailable projection"); assert.equal(offlineExternal.length, 0); console.log("PHASE2_APP_TO_SPACE_TO_TV_COMPLETE", `projection-attempts:${projectionAttempts}`, `media-attempts:${mediaAttempts}`, `ready:${videoState.readyState}`, `dimensions:${videoState.width}x${videoState.height}`, `time:${videoState.time}->${videoAfter}`);
  } finally { await browser.close(); await close(broadcast.server); await close(bootstrap.server); await close(xperience.server); await rm(profile,{recursive:true,force:true}); }
});
