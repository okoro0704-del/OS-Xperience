import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { DevelopmentAuthenticationProvider } from "../src/auth.js";
import { MemoryApplicationRepository } from "../src/repository.js";
import { createApiServer, createRuntime } from "../src/server.js";

const manifest = {
  schemaVersion: "1" as const,
  applicationId: "app.browser",
  name: "Browser App",
  version: "1.0.0",
  origin: "https://app-browser.example.com",
  productionUrl: "https://app-browser.example.com",
  xperienceUrl: "https://app-browser.example.com/xperience",
  capabilities: ["IDENTITY", "FILES"] as const,
};

async function listen(server: { listen: Function; address: Function }) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port as number;
}

test("Playwright browser workflow: developer + admin + isolation", async (t) => {
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

  // Placeholder ports resolved after listen; harness injected with real API port.
  let apiPort = 0;
  const ui = createServer((req, res) => {
    const harness = `<!doctype html><html><body><pre id="out">boot</pre>
    <script type="module">
    const API = "http://127.0.0.1:${apiPort}";
    async function req(actor, method, path, body) {
      const res = await fetch(API + path, {
        method,
        headers: { "Content-Type": "application/json", "X-Xperience-Dev-Actor": actor },
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || String(res.status));
      return data;
    }
    window.runDeveloper = async () => {
      await req("DEVELOPER:dev-1", "POST", "/v1/applications", { manifest: ${JSON.stringify(manifest)} });
      await req("DEVELOPER:dev-1", "PATCH", "/v1/applications/app.browser/manifest", {
        manifest: { ...${JSON.stringify(manifest)}, version: "1.0.1", capabilities: ["IDENTITY", "FILES", "MESSAGING"] }
      });
      await req("DEVELOPER:dev-1", "POST", "/v1/applications/app.browser/evidence", {
        type: "DOMAIN", locator: "https://app-browser.example.com"
      });
      return req("DEVELOPER:dev-1", "POST", "/v1/applications/app.browser/submit");
    };
    window.runIsolation = async () => {
      try {
        await req("DEVELOPER:dev-2", "GET", "/v1/applications/app.browser");
        return "leak";
      } catch (e) {
        return "isolated:" + e.message;
      }
    };
    window.runAdmin = async () => {
      await req("ADMIN:admin-1", "GET", "/v1/admin/queue");
      await req("ADMIN:admin-1", "GET", "/v1/admin/applications/app.browser");
      await req("ADMIN:admin-1", "GET", "/v1/admin/applications/app.browser/evidence");
      await req("ADMIN:admin-1", "POST", "/v1/admin/applications/app.browser/actions/start-review");
      await req("ADMIN:admin-1", "POST", "/v1/admin/applications/app.browser/capabilities", {
        capability: "IDENTITY", status: "APPROVED"
      });
      await req("ADMIN:admin-1", "POST", "/v1/admin/applications/app.browser/actions/request-changes", {
        reason: "tighten claims"
      });
      await req("DEVELOPER:dev-1", "POST", "/v1/applications/app.browser/submit");
      await req("ADMIN:admin-1", "POST", "/v1/admin/applications/app.browser/actions/start-review");
      await req("ADMIN:admin-1", "POST", "/v1/admin/applications/app.browser/actions/approve");
      return req("ADMIN:admin-1", "GET", "/v1/admin/applications/app.browser/audit");
    };
    </script></body></html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(harness);
  });
  const uiPort = await listen(ui);
  process.env.XPERIENCE_CONSOLE_ORIGINS = `http://127.0.0.1:${uiPort}`;

  const live = createApiServer(
    createRuntime({
      repository: repo,
      auth: new DevelopmentAuthenticationProvider(true),
    }),
  );
  apiPort = await listen(live);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: "domcontentloaded" });

    const submitted = await page.evaluate(async () =>
      (window as unknown as { runDeveloper: () => Promise<{ state: string }> }).runDeveloper(),
    );
    assert.equal(submitted.state, "SUBMITTED");

    const isolation = await page.evaluate(async () =>
      (window as unknown as { runIsolation: () => Promise<string> }).runIsolation(),
    );
    assert.match(isolation, /isolated:/);

    const audit = await page.evaluate(async () =>
      (window as unknown as { runAdmin: () => Promise<{ events: Array<{ action: string }> }> }).runAdmin(),
    );
    assert.ok(audit.events.some((e) => e.action === "STATE:APPROVED"));
    assert.ok(audit.events.some((e) => e.action === "CAPABILITY_APPROVED:IDENTITY"));
    assert.ok(audit.events.every((e) => !/password|secret|credential/i.test(JSON.stringify(e))));
  } finally {
    await browser.close();
    live.close();
    ui.close();
  }
});
