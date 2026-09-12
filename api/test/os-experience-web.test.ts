import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DevelopmentAuthenticationProvider } from "../src/auth.js";
import { XperienceService } from "../src/domain.js";
import { StaticLifeOSCatalog } from "../src/lifeos-catalog.js";
import { MemoryApplicationRepository } from "../src/repository.js";
import { createApiServer, createRuntime } from "../src/server.js";
import { VerificationService } from "../src/verification.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../apps/os-experience/dist");

const manifest = {
  schemaVersion: "1" as const,
  applicationId: "app.web",
  name: "Web App",
  version: "1.0.0",
  origin: "https://app-web.example.com",
  productionUrl: "https://app-web.example.com/app",
  xperienceUrl: "https://app-web.example.com/xperience",
  capabilities: ["IDENTITY", "FILES"] as const,
};

async function listen(server: { listen: Function; address: Function }) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port as number;
}

test("OS Experience web consumer: build artifacts and browser journey", async (t) => {
  process.env.NODE_ENV = "development";
  process.env.XPERIENCE_DEV_AUTH = "true";

  let indexHtml: string;
  try {
    indexHtml = await readFile(path.join(distDir, "index.html"), "utf8");
  } catch {
    t.skip("apps/os-experience/dist missing — run build:os-experience first");
    return;
  }

  assert.match(indexHtml, /OS Experience/);
  assert.doesNotMatch(indexHtml, /OS Shell 2\.0\.1/);

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    t.skip("playwright package is not installed");
    return;
  }

  const catalog = new StaticLifeOSCatalog([
    {
      applicationId: "mr.fundzman",
      name: "Mr FundzMan",
      version: "1.0.0",
      origin: "https://mr-fundzman.lifeos.example",
      productionUrl: "https://mr-fundzman.lifeos.example/app",
      xperienceUrl: "https://mr-fundzman.lifeos.example/xperience",
      capabilities: ["COMMERCE", "PAYMENTS"],
      visibility: "PUBLIC",
      publicationState: "PUBLISHED",
      developerName: "LifeOS",
      description: "Creator finance vertical",
    },
  ]);

  const repo = new MemoryApplicationRepository();
  const svc = new XperienceService(repo, new VerificationService(), catalog);
  const dev = { id: "dev-1", role: "DEVELOPER" as const };
  const admin = { id: "admin-1", role: "ADMIN" as const };
  await svc.register(dev, manifest);
  await svc.transition(dev, "app.web", "SUBMITTED");
  await svc.transition(admin, "app.web", "UNDER_REVIEW");
  await svc.transition(admin, "app.web", "APPROVED");
  await svc.transition(admin, "app.web", "PUBLISHED");

  const ui = createServer(async (req, res) => {
    const url = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
    try {
      const filePath = path.join(distDir, decodeURIComponent(url.split("?")[0]!));
      const body = await readFile(filePath);
      const type = filePath.endsWith(".js")
        ? "text/javascript"
        : filePath.endsWith(".css")
          ? "text/css"
          : "text/html";
      res.writeHead(200, { "Content-Type": type });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("missing");
    }
  });
  const uiPort = await listen(ui);
  process.env.XPERIENCE_CONSOLE_ORIGINS = `http://127.0.0.1:${uiPort}`;

  const api = createApiServer(
    createRuntime({
      repository: repo,
      auth: new DevelopmentAuthenticationProvider(true),
      lifeosCatalog: catalog,
    }),
  );
  const apiPort = await listen(api);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.title(), "OS Experience");

    const journey = await page.evaluate(`(async () => {
      const API = "http://127.0.0.1:${apiPort}";
      async function req(method, path, body) {
        const res = await fetch(API + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Xperience-Dev-Actor": "USER:user-1",
            "X-Xperience-Dev-Name": "Melvin"
          },
          body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || String(res.status));
        return data;
      }
      const homeBrand = document.body.innerText.includes("OS Experience");
      const shellLegacy = /Find an app|OS Shell 2\\.0\\.1|Not a primitive/i.test(document.body.innerText);
      const modernHome = /Your Digital Life|Explore Directory|Continue Your Experience|Your Experience is waiting/i.test(document.body.innerText);
      const search = await req("GET", "/v1/directory?q=FundzMan");
      await req("POST", "/v1/experience/mr.fundzman");
      const mine = await req("GET", "/v1/experience");
      await req("POST", "/v1/experience/mr.fundzman/open");
      await req("DELETE", "/v1/experience/mr.fundzman");
      const after = await req("GET", "/v1/experience");
      const still = await req("GET", "/v1/directory/mr.fundzman");
      await req("POST", "/v1/experience/mr.fundzman");
      return {
        homeBrand,
        shellLegacy,
        modernHome,
        searchHit: search.applications[0]?.id,
        mine: mine.experiences.length,
        after: after.experiences.length,
        still: still.id,
        source: still.ecosystemSource
      };
    })()`);
    assert.equal(journey.homeBrand, true);
    assert.equal(journey.shellLegacy, false);
    assert.equal(journey.modernHome, true);
    assert.equal(journey.searchHit, "mr.fundzman");
    assert.equal(journey.mine, 1);
    assert.equal(journey.after, 0);
    assert.equal(journey.still, "mr.fundzman");
    assert.equal(journey.source, "LIFEOS");
  } finally {
    await browser.close();
    api.close();
    ui.close();
  }
});
