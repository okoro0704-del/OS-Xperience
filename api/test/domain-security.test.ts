import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedDoesNotAutoPublish,
  capabilityApprovalIsNotRuntimeAuthorization,
} from "@digiconomy/xperience-contract";
import { DevelopmentAuthenticationProvider, TrustIdAuthenticationProvider } from "../src/auth.js";
import { DomainError, XperienceService } from "../src/domain.js";
import { createApplicationRepository, MemoryApplicationRepository } from "../src/repository.js";
import { createApiServer, createRuntime } from "../src/server.js";
import { VerificationService } from "../src/verification.js";

const manifest = (id: string) => ({
  schemaVersion: "1" as const,
  applicationId: id,
  name: "Atlas",
  version: "1.0.0",
  origin: `https://${id.replace(/\./g, "-")}.example.com`,
  productionUrl: `https://${id.replace(/\./g, "-")}.example.com`,
  xperienceUrl: `https://${id.replace(/\./g, "-")}.example.com/xperience`,
  capabilities: ["IDENTITY", "FILES"] as const,
});

function service() {
  return new XperienceService(new MemoryApplicationRepository(), new VerificationService());
}

test("developer workflow persists through repository abstraction", async () => {
  const svc = service();
  const dev = { id: "dev-a", role: "DEVELOPER" as const, email: "a@example.com" };
  const app = await svc.register(dev, manifest("app.alpha"));
  assert.equal(app.state, "DRAFT");
  assert.equal(app.capabilities[0]?.status, "REQUESTED");
  await svc.addEvidence(dev, app.id, "DOMAIN", "https://app-alpha.example.com");
  const submitted = await svc.transition(dev, app.id, "SUBMITTED");
  assert.equal(submitted.state, "SUBMITTED");
  assert.equal(approvedDoesNotAutoPublish(submitted.state), true);
});

test("admin review transitions are authoritative and audited", async () => {
  const svc = service();
  const dev = { id: "dev-a", role: "DEVELOPER" as const };
  const admin = { id: "admin-1", role: "ADMIN" as const };
  await svc.register(dev, manifest("app.beta"));
  await svc.transition(dev, "app.beta", "SUBMITTED");
  await svc.transition(admin, "app.beta", "UNDER_REVIEW");
  await svc.reviewCapability(admin, "app.beta", "IDENTITY", "APPROVED");
  assert.equal(capabilityApprovalIsNotRuntimeAuthorization(), true);
  const approved = await svc.transition(admin, "app.beta", "APPROVED");
  assert.equal(approved.state, "APPROVED");
  assert.notEqual(approved.state, "PUBLISHED");
  const published = await svc.transition(admin, "app.beta", "PUBLISHED");
  assert.equal(published.state, "PUBLISHED");
  const events = await svc.listAudit(admin, "app.beta");
  assert.ok(events.some((e) => e.action === "STATE:APPROVED"));
  assert.ok(events.some((e) => e.action === "STATE:PUBLISHED"));
  assert.ok(events.every((e) => !/password|secret|credential/i.test(JSON.stringify(e))));
});

test("developer isolation and admin authorization", async () => {
  const svc = service();
  const a = { id: "dev-a", role: "DEVELOPER" as const };
  const b = { id: "dev-b", role: "DEVELOPER" as const };
  await svc.register(a, manifest("app.a"));
  await svc.register(b, manifest("app.b"));
  await assert.rejects(() => svc.get(a, "app.b"), (err: unknown) => err instanceof DomainError && err.code === "forbidden");
  await assert.rejects(() => svc.listReviewQueue(a), (err: unknown) => err instanceof DomainError && err.code === "forbidden");
  await assert.rejects(() => svc.transition(a, "app.a", "APPROVED"), (err: unknown) => err instanceof DomainError && err.code === "forbidden");
  await assert.rejects(
    () => svc.reviewCapability(b, "app.a", "IDENTITY", "APPROVED"),
    (err: unknown) => err instanceof DomainError && err.code === "forbidden",
  );
});

test("invalid transitions and capability changes after approval require review", async () => {
  const svc = service();
  const dev = { id: "dev-a", role: "DEVELOPER" as const };
  const admin = { id: "admin-1", role: "ADMIN" as const };
  await svc.register(dev, manifest("app.gamma"));
  await assert.rejects(() => svc.transition(dev, "app.gamma", "PUBLISHED"));
  await svc.transition(dev, "app.gamma", "SUBMITTED");
  await svc.transition(admin, "app.gamma", "UNDER_REVIEW");
  await svc.transition(admin, "app.gamma", "APPROVED");
  await svc.reviewCapability(admin, "app.gamma", "IDENTITY", "APPROVED");
  const revised = await svc.updateManifest(dev, "app.gamma", {
    ...manifest("app.gamma"),
    capabilities: ["IDENTITY", "FILES", "MESSAGING"],
  });
  assert.equal(revised.state, "CHANGES_REQUIRED");
  assert.equal(revised.capabilities.find((c) => c.capability === "IDENTITY")?.status, "REQUIRES_CHANGES");
});

test("unsafe verification locators are rejected and never verified", async () => {
  const svc = service();
  const dev = { id: "dev-a", role: "DEVELOPER" as const };
  await svc.register(dev, manifest("app.delta"));
  await assert.rejects(() => svc.addEvidence(dev, "app.delta", "DOMAIN", "https://localhost/secret"));
  await assert.rejects(() => svc.addEvidence(dev, "app.delta", "DOMAIN", "https://user:pass@example.com"));
  const result = await svc.addEvidence(dev, "app.delta", "DOMAIN", "https://app-delta.example.com");
  assert.equal(result.verification.status, "UNAVAILABLE");
});

test("HTTP API enforces auth, isolation, and admin gates", async () => {
  const runtime = createRuntime({
    repository: new MemoryApplicationRepository(),
    auth: new DevelopmentAuthenticationProvider(true),
  });
  const server = createApiServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  async function call(actor: string | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (actor) headers["X-Xperience-Dev-Actor"] = actor;
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    assert.equal((await call(null, "GET", "/v1/applications")).status, 401);

    const created = await call("DEVELOPER:dev-a", "POST", "/v1/applications", { manifest: manifest("app.http") });
    assert.equal(created.status, 201);

    const denied = await call("DEVELOPER:dev-b", "GET", `/v1/applications/app.http`);
    assert.equal(denied.status, 403);

    const adminDenied = await call("DEVELOPER:dev-a", "POST", `/v1/admin/applications/app.http/actions/approve`);
    assert.equal(adminDenied.status, 403);

    await call("DEVELOPER:dev-a", "POST", `/v1/applications/app.http/submit`);
    await call("ADMIN:admin-1", "POST", `/v1/admin/applications/app.http/actions/start-review`);
    const approved = await call("ADMIN:admin-1", "POST", `/v1/admin/applications/app.http/actions/approve`);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.state, "APPROVED");
    assert.notEqual(approved.body.state, "PUBLISHED");

    const audit = await call("ADMIN:admin-1", "GET", `/v1/admin/applications/app.http/audit`);
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.some((e: { action: string }) => e.action === "STATE:APPROVED"));
  } finally {
    server.close();
  }
});

test("memory repository is forbidden in production", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => createApplicationRepository("memory"), /forbidden/);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test("production cannot use development authentication", async () => {
  const disabled = new DevelopmentAuthenticationProvider(false);
  assert.equal(await disabled.authenticate({ "x-xperience-dev-actor": "ADMIN:evil" }), null);
  assert.equal(await new TrustIdAuthenticationProvider().authenticate({}), null);
});

test("health endpoint does not require auth", async () => {
  const server = createApiServer(
    createRuntime({
      repository: new MemoryApplicationRepository(),
      auth: new DevelopmentAuthenticationProvider(true),
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
  } finally {
    server.close();
  }
});
