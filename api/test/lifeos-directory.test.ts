import assert from "node:assert/strict";
import test from "node:test";
import { isLifeOSDirectoryEligible, type LifeOSCatalogApplicationClaim } from "@digiconomy/xperience-contract";
import { DomainError, XperienceService } from "../src/domain.js";
import { StaticLifeOSCatalog } from "../src/lifeos-catalog.js";
import { MemoryApplicationRepository } from "../src/repository.js";
import { VerificationService } from "../src/verification.js";

const claim = (
  overrides: Partial<LifeOSCatalogApplicationClaim> & Pick<LifeOSCatalogApplicationClaim, "applicationId" | "name">,
): LifeOSCatalogApplicationClaim => ({
  version: "1.0.0",
  origin: `https://${overrides.applicationId.replace(/\./g, "-")}.lifeos.example`,
  productionUrl: `https://${overrides.applicationId.replace(/\./g, "-")}.lifeos.example/app`,
  xperienceUrl: `https://${overrides.applicationId.replace(/\./g, "-")}.lifeos.example/xperience`,
  capabilities: ["COMMERCE", "PAYMENTS"],
  visibility: "PUBLIC",
  publicationState: "PUBLISHED",
  developerName: "LifeOS",
  description: "Digiconomy vertical",
  ...overrides,
});

test("LifeOS eligibility rejects draft, private, and invalid destinations", () => {
  assert.equal(isLifeOSDirectoryEligible(claim({ applicationId: "mr.fundzman", name: "Mr FundzMan" })), true);
  assert.equal(
    isLifeOSDirectoryEligible(
      claim({ applicationId: "mr.fundzman", name: "Mr FundzMan", publicationState: "DRAFT" }),
    ),
    false,
  );
  assert.equal(
    isLifeOSDirectoryEligible(
      claim({ applicationId: "mr.fundzman", name: "Mr FundzMan", visibility: "PRIVATE" }),
    ),
    false,
  );
  assert.equal(
    isLifeOSDirectoryEligible(
      claim({
        applicationId: "bad.local",
        name: "Bad",
        origin: "http://localhost:5174",
        productionUrl: "http://localhost:5174/app",
        xperienceUrl: "http://localhost:5174/x",
      }),
    ),
    false,
  );
});

test("eligible LifeOS vertical appears in Directory without Application row", async () => {
  const catalog = new StaticLifeOSCatalog([
    claim({ applicationId: "mr.fundzman", name: "Mr FundzMan" }),
    claim({ applicationId: "draft.vertical", name: "Draft Vertical", publicationState: "DRAFT" }),
    claim({ applicationId: "private.vertical", name: "Private Vertical", visibility: "PRIVATE" }),
  ]);
  const svc = new XperienceService(new MemoryApplicationRepository(), new VerificationService(), catalog);
  const user = { id: "user-1", role: "USER" as const };

  const directory = await svc.listDirectory(user);
  assert.equal(directory.length, 1);
  assert.equal(directory[0]?.id, "mr.fundzman");
  assert.equal(directory[0]?.ecosystemSource, "LIFEOS");
  assert.equal(directory[0]?.name, "Mr FundzMan");

  const search = await svc.listDirectory(user, { q: "FundzMan" });
  assert.equal(search.length, 1);

  await assert.rejects(
    () => svc.getDirectoryApplication(user, "draft.vertical"),
    (err: unknown) => err instanceof DomainError && err.code === "not_found",
  );
  await assert.rejects(
    () => svc.getDirectoryApplication(user, "private.vertical"),
    (err: unknown) => err instanceof DomainError && err.code === "not_found",
  );
});

test("LifeOS Directory Experience → My Experience → Stop keeps catalog entry", async () => {
  const catalog = new StaticLifeOSCatalog([claim({ applicationId: "mr.fundzman", name: "Mr FundzMan" })]);
  const svc = new XperienceService(new MemoryApplicationRepository(), new VerificationService(), catalog);
  const user = { id: "user-1", role: "USER" as const };

  const started = await svc.startExperience(user, "mr.fundzman");
  assert.equal(started.application.ecosystemSource, "LIFEOS");
  assert.equal((await svc.listMyExperience(user)).length, 1);

  const opened = await svc.openExperience(user, "mr.fundzman");
  assert.equal(opened.name, "Mr FundzMan");
  assert.match(opened.embedUrl, /^https:\/\//);

  await svc.stopExperience(user, "mr.fundzman");
  assert.equal((await svc.listMyExperience(user)).length, 0);

  const still = await svc.getDirectoryApplication(user, "mr.fundzman");
  assert.equal(still.id, "mr.fundzman");
  assert.equal(still.experienced, false);

  await svc.startExperience(user, "mr.fundzman");
  assert.equal((await svc.listMyExperience(user)).length, 1);
});

test("published LifeOS claim becoming unpublished excludes from Directory", async () => {
  const mutable: LifeOSCatalogApplicationClaim[] = [
    claim({ applicationId: "finance.os", name: "FinanceOS" }),
  ];
  const catalog = {
    async listEligible() {
      return mutable.filter((c) => c.publicationState === "PUBLISHED" && c.visibility === "PUBLIC");
    },
    async getEligibleById(id: string) {
      const hit = mutable.find((c) => c.applicationId === id);
      if (!hit || hit.publicationState !== "PUBLISHED" || hit.visibility !== "PUBLIC") return null;
      return hit;
    },
  };
  const svc = new XperienceService(new MemoryApplicationRepository(), new VerificationService(), catalog);
  const user = { id: "user-1", role: "USER" as const };
  assert.equal((await svc.listDirectory(user)).length, 1);
  mutable[0]!.publicationState = "UNPUBLISHED";
  assert.equal((await svc.listDirectory(user)).length, 0);
});
