import assert from "node:assert/strict";
import test from "node:test";
import { DevelopmentAuthenticationProvider } from "../src/auth.js";
import { DomainError, XperienceService } from "../src/domain.js";
import { MemoryApplicationRepository } from "../src/repository.js";
import { createApiServer, createRuntime } from "../src/server.js";
import { VerificationService } from "../src/verification.js";

const manifest = (id: string, name = "Atlas") => ({
  schemaVersion: "1" as const,
  applicationId: id,
  name,
  version: "1.0.0",
  origin: `https://${id.replace(/\./g, "-")}.example.com`,
  productionUrl: `https://${id.replace(/\./g, "-")}.example.com/app`,
  xperienceUrl: `https://${id.replace(/\./g, "-")}.example.com/xperience`,
  capabilities: ["IDENTITY", "FILES"] as const,
});

async function publish(svc: XperienceService, id: string, name?: string) {
  const dev = { id: "dev-pub", role: "DEVELOPER" as const };
  const admin = { id: "admin-1", role: "ADMIN" as const };
  await svc.register(dev, manifest(id, name));
  await svc.transition(dev, id, "SUBMITTED");
  await svc.transition(admin, id, "UNDER_REVIEW");
  await svc.transition(admin, id, "APPROVED");
  await svc.transition(admin, id, "PUBLISHED");
}

test("directory lists only published applications", async () => {
  const svc = new XperienceService(new MemoryApplicationRepository(), new VerificationService());
  const user = { id: "user-1", role: "USER" as const, displayName: "Melvin" };
  await publish(svc, "app.pub", "Published App");
  const draftDev = { id: "dev-pub", role: "DEVELOPER" as const };
  await svc.register(draftDev, manifest("app.draft", "Draft App"));
  const directory = await svc.listDirectory(user);
  assert.equal(directory.length, 1);
  assert.equal(directory[0]?.id, "app.pub");
  assert.equal(directory[0]?.experienced, false);
});

test("experience start/open/pause/stop and re-experience", async () => {
  const svc = new XperienceService(new MemoryApplicationRepository(), new VerificationService());
  const user = { id: "user-1", role: "USER" as const };
  await publish(svc, "app.life", "LifeOS");
  await assert.rejects(() => svc.openExperience(user, "app.life"), (err: unknown) => err instanceof DomainError);

  const started = await svc.startExperience(user, "app.life");
  assert.equal(started.status, "ACTIVE");
  const opened = await svc.openExperience(user, "app.life");
  assert.equal(opened.origin, "https://app-life.example.com");
  assert.match(opened.embedUrl, /^https:\/\//);

  await svc.pauseExperience(user, "app.life");
  await assert.rejects(() => svc.openExperience(user, "app.life"));
  await svc.resumeExperience(user, "app.life");

  await svc.stopExperience(user, "app.life");
  const mine = await svc.listMyExperience(user);
  assert.equal(mine.length, 0);
  const stillInDirectory = await svc.getDirectoryApplication(user, "app.life");
  assert.equal(stillInDirectory.id, "app.life");
  await svc.startExperience(user, "app.life");
  assert.equal((await svc.listMyExperience(user)).length, 1);
});

test("users cannot mutate another user's experience or experience unpublished apps", async () => {
  const svc = new XperienceService(new MemoryApplicationRepository(), new VerificationService());
  const a = { id: "user-a", role: "USER" as const };
  const b = { id: "user-b", role: "USER" as const };
  await publish(svc, "app.iso");
  await svc.startExperience(a, "app.iso");
  assert.equal((await svc.listMyExperience(b)).length, 0);
  await assert.rejects(() => svc.stopExperience(b, "app.iso"), (err: unknown) => err instanceof DomainError && err.code === "not_found");

  const draftDev = { id: "dev-pub", role: "DEVELOPER" as const };
  await svc.register(draftDev, manifest("app.hidden"));
  await assert.rejects(
    () => svc.startExperience(a, "app.hidden"),
    (err: unknown) => err instanceof DomainError && err.code === "forbidden",
  );
});

test("HTTP consumer routes enforce USER role and isolation", async () => {
  const runtime = createRuntime({
    repository: new MemoryApplicationRepository(),
    auth: new DevelopmentAuthenticationProvider(true),
  });
  const svc = runtime.service;
  await publish(svc, "app.http");
  const server = createApiServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  async function call(actor: string, method: string, path: string) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Xperience-Dev-Actor": actor, "X-Xperience-Dev-Name": "Melvin" },
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    assert.equal((await call("DEVELOPER:dev-a", "GET", "/v1/directory")).status, 403);
    const dir = await call("USER:user-1", "GET", "/v1/directory");
    assert.equal(dir.status, 200);
    assert.equal(dir.body.applications.length, 1);

    const start = await call("USER:user-1", "POST", "/v1/experience/app.http");
    assert.equal(start.status, 201);
    const other = await call("USER:user-2", "DELETE", "/v1/experience/app.http");
    assert.equal(other.status, 404);
    const stop = await call("USER:user-1", "DELETE", "/v1/experience/app.http");
    assert.equal(stop.status, 200);
    assert.equal(stop.body.removed, true);
    const dirAfter = await call("USER:user-1", "GET", "/v1/directory");
    assert.equal(dirAfter.body.applications[0].id, "app.http");
  } finally {
    server.close();
  }
});
