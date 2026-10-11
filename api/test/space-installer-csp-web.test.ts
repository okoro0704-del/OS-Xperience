import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { LANTERN, buildFixtures, hermetic, importToTrust, openSpaceScreen, seedTrust, serveApp } from "./space-installer-harness.js";

/**
 * SP3 hardening — the candidate Content-Security-Policy (apps/os-experience/csp.ts) in a real browser.
 * Runs only against a build made with OX_CSP=enforce; the default build carries no policy.
 * Checks that the shell and package rendering work with zero violations, and that injected markup,
 * inline script, blob: script and blob:/data: frames are refused.
 */
test("SP3 CSP: the shell and package rendering run clean; injected script and package frames are blocked", { timeout: 240_000 }, async (t) => {
  const html = await readFile(resolve("apps/os-experience/dist/index.html"), "utf8");
  if (!html.includes("Content-Security-Policy")) { t.skip("dist was built without OX_CSP=enforce"); return; }
  let chromium: typeof import("playwright").chromium;
  try { ({ chromium } = await import("playwright")); } catch { t.skip("playwright unavailable"); return; }
  const scratch = await mkdtemp(join(tmpdir(), "ox-sp3-csp-"));
  const fixtures = await buildFixtures(join(scratch, "files"));
  const app = await serveApp();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await hermetic(context);
    // Init scripts are injected by the test driver, outside the page's policy: they only observe.
    await context.addInitScript({ content: `globalThis.__name = (fn) => fn; window.__violations = []; document.addEventListener("securitypolicyviolation", (event) => window.__violations.push(event.violatedDirective + " " + event.blockedURI));` });
    const page = await context.newPage();
    await page.goto(`${app.base}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="os-experience"]', { state: "visible", timeout: 20_000 });
    assert.match(await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? ""), /script-src 'self'/);
    await seedTrust(page, fixtures.trust);

    // Normal use: Space screen, launch-file import, install and render a package (image, audio, text).
    await openSpaceScreen(page);
    await page.getByTestId("space-import-input").setInputFiles("apps/os-experience/public/spaces/mrfundzman.space");
    await page.getByTestId("space-import-status").waitFor();
    await importToTrust(page, fixtures.files["isolation.space"]!);
    await page.getByTestId("trust-install").click();
    await page.getByTestId("install-confirm").click();
    await page.getByTestId("install-continue").click();
    await page.locator('[data-testid="installed-space"][data-health="HEALTHY"]').waitFor({ timeout: 20_000 });
    await page.getByTestId("installed-open").click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="package-image-lantern"]') as HTMLImageElement | null)?.naturalWidth! > 0, undefined, { timeout: 20_000 });
    const audioReady = await page.evaluate(() => new Promise<boolean>((done) => {
      const audio = document.querySelector('[data-testid="package-audio-chime"]') as HTMLAudioElement;
      if (audio.readyState >= 1) return done(true);
      audio.addEventListener("loadedmetadata", () => done(true), { once: true });
      audio.addEventListener("error", () => done(false), { once: true });
      audio.load();
    }));
    assert.equal(audioReady, true, "blob: audio loads under media-src");
    const normal = await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations.slice());
    // Google Fonts is blocked by the hermetic test network, not by the policy; anything else is a real violation.
    assert.deepEqual(normal, [], `no violations during normal use: ${normal}`);

    // Hostile: everything a hostile package or injected markup might try.
    const blobUrl = await page.evaluate(() => URL.createObjectURL(new Blob(["window.__pwned = 'blob-script'"], { type: "text/javascript" })));
    const htmlBlob = await page.evaluate(() => URL.createObjectURL(new Blob(["<script>parent.__pwned = 'blob-frame'</script>"], { type: "text/html" })));
    await page.evaluate(({ blobUrl, htmlBlob }) => {
      const host = document.createElement("div");
      host.innerHTML = `<img src="x" onerror="window.__pwned = 'onerror'"><a id="js-link" href="javascript:window.__pwned='js-url'">x</a>`;
      document.body.append(host);
      const inline = document.createElement("script"); inline.textContent = "window.__pwned = 'inline'"; document.body.append(inline);
      const external = document.createElement("script"); external.src = blobUrl; document.body.append(external);
      const frame = document.createElement("iframe"); frame.src = htmlBlob; document.body.append(frame);
      const dataFrame = document.createElement("iframe"); dataFrame.src = "data:text/html,<script>parent.__pwned='data-frame'</script>"; document.body.append(dataFrame);
      const embed = document.createElement("object"); embed.data = htmlBlob; document.body.append(embed);
      // String evaluation must be attempted from the page's own task, not the test driver: DevTools-run code
      // is exempt from the page's eval rules.
      (setTimeout as (code: string, ms: number) => number)("window.__pwned = 'timer-string'", 0);
      setTimeout(() => { try { (0, eval)("window.__pwned = 'eval'"); } catch { /* refused */ } }, 0);
      setTimeout(() => { try { new Function("window.__pwned = 'function'")(); } catch { /* refused */ } }, 0);
      (document.getElementById("js-link") as HTMLAnchorElement).click();
    }, { blobUrl, htmlBlob });
    await page.waitForTimeout(1500);
    const hostile = await page.evaluate(() => ({ pwned: (window as unknown as { __pwned?: string }).__pwned ?? null, violations: (window as unknown as { __violations: string[] }).__violations.slice() }));
    assert.equal(hostile.pwned, null, `nothing executed: ${hostile.pwned}`);
    const directives = [...new Set(hostile.violations.map((item) => item.split(" ")[0]))].sort();
    for (const directive of ["frame-src", "object-src", "script-src-attr", "script-src-elem"]) assert.ok(directives.includes(directive), `${directive} enforced: ${directives}`);
    await context.close();
    console.log("SP3_CSP", "normal-violations:0", "package-render:OK(image,audio,text)", "launch-file:OK", `hostile-blocked:${directives.join(",")}`, "executed:none");
  } finally {
    await browser.close();
    await app.close();
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
});
