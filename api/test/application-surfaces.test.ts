import assert from "node:assert/strict";
import test from "node:test";
import { DomainError, XperienceService } from "../src/domain.js";
import { StaticLifeOSCatalog } from "../src/lifeos-catalog.js";
import { EmptyManagementAccess, StaticManagementAccess } from "../src/management-access.js";
import { MemoryApplicationRepository } from "../src/repository.js";
import { VerificationService } from "../src/verification.js";
import type { LifeOSCatalogApplicationClaim } from "@digiconomy/xperience-contract";

const claim = (
  overrides: Partial<LifeOSCatalogApplicationClaim> & Pick<LifeOSCatalogApplicationClaim, "applicationId" | "name">,
): LifeOSCatalogApplicationClaim => ({
  version: "1.0.0",
  origin: "https://mrfundzman.getlifeos.app/",
  productionUrl: "https://mrfundzman.getlifeos.app/",
  xperienceUrl: "https://mrfundzman.getlifeos.app/",
  capabilities: ["COMMERCE"],
  visibility: "PUBLIC",
  publicationState: "PUBLISHED",
  developerName: "Mr FundzMan",
  description: "Creator brand on LifeOS",
  ...overrides,
});

function service(catalog: StaticLifeOSCatalog, access = new EmptyManagementAccess()) {
  return new XperienceService(
    new MemoryApplicationRepository(),
    new VerificationService(),
    catalog,
    access,
  );
}

test("one Directory identity exposes declared public and management surfaces", async () => {
  const catalog = new StaticLifeOSCatalog([
    claim({
      applicationId: "mr.fundzman",
      name: "Mr FundzMan",
      managementUrl: "https://mrfundzman.getlifeos.app/admin",
      managementOperatorIds: ["owner-1"],
    }),
  ]);
  const svc = service(catalog);
  const visitor = { id: "visitor-1", role: "USER" as const };
  const owner = { id: "owner-1", role: "USER" as const };

  const directory = await svc.listDirectory(visitor);
  assert.equal(directory.length, 1);
  assert.equal(directory[0]?.id, "mr.fundzman");
  assert.equal(directory[0]?.productionUrl, "https://mrfundzman.getlifeos.app/");
  assert.equal(directory[0]?.managementUrl, "https://mrfundzman.getlifeos.app/admin");
  assert.equal(directory[0]?.canManage, false);

  const ownerView = await svc.getDirectoryApplication(owner, "mr.fundzman");
  assert.equal(ownerView.canManage, true);
  assert.equal(ownerView.managementUrl, "https://mrfundzman.getlifeos.app/admin");
});

test("Open always resolves PUBLIC; Manage requires relationship and declared URL", async () => {
  const catalog = new StaticLifeOSCatalog([
    claim({
      applicationId: "mr.fundzman",
      name: "Mr FundzMan",
      managementUrl: "https://mrfundzman.getlifeos.app/admin",
      managementOperatorIds: ["owner-1"],
    }),
  ]);
  const svc = service(catalog);
  const owner = { id: "owner-1", role: "USER" as const };
  const visitor = { id: "visitor-1", role: "USER" as const };

  await svc.startExperience(owner, "mr.fundzman");
  await svc.startExperience(visitor, "mr.fundzman");

  const ownerPublic = await svc.openExperience(owner, "mr.fundzman", { surface: "PUBLIC" });
  assert.equal(ownerPublic.surface, "PUBLIC");
  assert.equal(ownerPublic.embedUrl, "https://mrfundzman.getlifeos.app/");

  const ownerManage = await svc.openExperience(owner, "mr.fundzman", { surface: "MANAGEMENT" });
  assert.equal(ownerManage.surface, "MANAGEMENT");
  assert.equal(ownerManage.embedUrl, "https://mrfundzman.getlifeos.app/admin");

  await assert.rejects(
    () => svc.openExperience(visitor, "mr.fundzman", { surface: "MANAGEMENT" }),
    (err: unknown) => err instanceof DomainError && err.code === "forbidden",
  );

  const visitorPublic = await svc.openExperience(visitor, "mr.fundzman");
  assert.equal(visitorPublic.surface, "PUBLIC");
  assert.equal(visitorPublic.embedUrl, "https://mrfundzman.getlifeos.app/");
});

test("management URL alone does not grant Manage; env grants do", async () => {
  const catalog = new StaticLifeOSCatalog([
    claim({
      applicationId: "dabris.kitchen",
      name: "Dabris Kitchen",
      origin: "https://dabris.getlifeos.app/",
      productionUrl: "https://dabris.getlifeos.app/",
      xperienceUrl: "https://dabris.getlifeos.app/",
      managementUrl: "https://dabris.getlifeos.app/staff",
    }),
  ]);
  const visitorSvc = service(catalog);
  const visitor = { id: "staff-1", role: "USER" as const };
  const view = await visitorSvc.getDirectoryApplication(visitor, "dabris.kitchen");
  assert.equal(view.managementUrl, "https://dabris.getlifeos.app/staff");
  assert.equal(view.canManage, false);

  const granted = service(
    catalog,
    new StaticManagementAccess([{ applicationId: "dabris.kitchen", participantIds: ["staff-1"] }]),
  );
  const staffView = await granted.getDirectoryApplication(visitor, "dabris.kitchen");
  assert.equal(staffView.canManage, true);
  await granted.startExperience(visitor, "dabris.kitchen");
  const managed = await granted.openExperience(visitor, "dabris.kitchen", { surface: "MANAGEMENT" });
  assert.equal(managed.embedUrl, "https://dabris.getlifeos.app/staff");
});

test("does not invent /admin when managementUrl is undeclared", async () => {
  const catalog = new StaticLifeOSCatalog([
    claim({
      applicationId: "plain.vertical",
      name: "Plain Vertical",
      origin: "https://plain.getlifeos.app/",
      productionUrl: "https://plain.getlifeos.app/",
      xperienceUrl: "https://plain.getlifeos.app/",
    }),
  ]);
  const svc = service(
    catalog,
    new StaticManagementAccess([{ applicationId: "plain.vertical", participantIds: ["owner-1"] }]),
  );
  const owner = { id: "owner-1", role: "USER" as const };
  const view = await svc.getDirectoryApplication(owner, "plain.vertical");
  assert.equal(view.managementUrl, undefined);
  assert.equal(view.canManage, false);
  await svc.startExperience(owner, "plain.vertical");
  await assert.rejects(
    () => svc.openExperience(owner, "plain.vertical", { surface: "MANAGEMENT" }),
    (err: unknown) => err instanceof DomainError && err.code === "forbidden",
  );
});
