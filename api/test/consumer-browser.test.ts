import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { DevelopmentAuthenticationProvider } from "../src/auth.js";
import { XperienceService } from "../src/domain.js";
import { MemoryApplicationRepository } from "../src/repository.js";
import { createApiServer, createRuntime } from "../src/server.js";
import { VerificationService } from "../src/verification.js";

const manifest = {
  schemaVersion: "1" as const,
  applicationId: "app.mobile",
  name: "Mobile App",
  version: "1.0.0",
  origin: "https://app-mobile.example.com",
  productionUrl: "https://app-mobile.example.com/app",
  xperienceUrl: "https://app-mobile.example.com/xperience",
  capabilities: ["IDENTITY", "FILES"] as const,
};

async function listen(server: { listen: Function; address: Function }) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port as number;
}

test("Playwright consumer journey: directory → experience → open → stop → re-experience", async (t) => {
  process.env.NODE_ENV = "development";
  process.env.XPERIENCE_DEV_AUTH = "true";

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    t.skip("playwright package is not installed");
    return;
  }

  const repo = new MemoryApplicationRepository();
  const svc = new XperienceService(repo, new VerificationService());
  const dev = { id: "dev-1", role: "DEVELOPER" as const };
  const admin = { id: "admin-1", role: "ADMIN" as const };
  await svc.register(dev, manifest);
  await svc.transition(dev, "app.mobile", "SUBMITTED");
  await svc.transition(admin, "app.mobile", "UNDER_REVIEW");
  await svc.transition(admin, "app.mobile", "APPROVED");
  await svc.transition(admin, "app.mobile", "PUBLISHED");

  let apiPort = 0;
  const ui = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body><pre id="out">boot</pre>
    <script type="module">
    const API = "http://127.0.0.1:${apiPort}";
    async function req(actor, method, path, body) {
      const res = await fetch(API + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Xperience-Dev-Actor": actor,
          "X-Xperience-Dev-Name": "Melvin"
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || String(res.status));
      return data;
    }
    window.runJourney = async () => {
      const me = await req("USER:user-1", "GET", "/v1/me");
      const directory = await req("USER:user-1", "GET", "/v1/directory");
      const unpublished = directory.applications.every(a => a.publicationState === "PUBLISHED");
      await req("USER:user-1", "POST", "/v1/experience/app.mobile");
      const mine = await req("USER:user-1", "GET", "/v1/experience");
      const opened = await req("USER:user-1", "POST", "/v1/experience/app.mobile/open");
      await req("USER:user-1", "POST", "/v1/experience/app.mobile/pause");
      await req("USER:user-1", "POST", "/v1/experience/app.mobile/resume");
      await req("USER:user-1", "DELETE", "/v1/experience/app.mobile");
      const afterStop = await req("USER:user-1", "GET", "/v1/experience");
      const stillThere = await req("USER:user-1", "GET", "/v1/directory/app.mobile");
      await req("USER:user-1", "POST", "/v1/experience/app.mobile");
      const again = await req("USER:user-1", "GET", "/v1/experience");
      const isolated = await req("USER:user-2", "GET", "/v1/experience");
      return {
        me,
        directoryCount: directory.applications.length,
        unpublishedOk: unpublished,
        mineCount: mine.experiences.length,
        opened,
        afterStop: afterStop.experiences.length,
        stillThere: stillThere.id,
        again: again.experiences.length,
        isolated: isolated.experiences.length
      };
    };
    </script></body></html>`);
  });
  const uiPort = await listen(ui);
  process.env.XPERIENCE_CONSOLE_ORIGINS = `http://127.0.0.1:${uiPort}`;

  const api = createApiServer(
    createRuntime({
      repository: repo,
      auth: new DevelopmentAuthenticationProvider(true),
    }),
  );
  apiPort = await listen(api);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: "domcontentloaded" });
    const result = await page.evaluate(async () =>
      (
        window as unknown as {
          runJourney: () => Promise<{
            me: { displayName: string };
            directoryCount: number;
            unpublishedOk: boolean;
            mineCount: number;
            opened: { embedUrl: string };
            afterStop: number;
            stillThere: string;
            again: number;
            isolated: number;
          }>;
        }
      ).runJourney(),
    );
    assert.equal(result.me.displayName, "Melvin");
    assert.equal(result.directoryCount, 1);
    assert.equal(result.unpublishedOk, true);
    assert.equal(result.mineCount, 1);
    assert.match(result.opened.embedUrl, /^https:\/\//);
    assert.equal(result.afterStop, 0);
    assert.equal(result.stillThere, "app.mobile");
    assert.equal(result.again, 1);
    assert.equal(result.isolated, 0);
  } finally {
    await browser.close();
    api.close();
    ui.close();
  }
});
