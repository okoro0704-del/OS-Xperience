import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeExperienceAuthMode,
  normalizeOfflineCapability,
  type DirectoryApplicationView,
} from "@digiconomy/xperience-contract";
import {
  MYBRANDOS_PUBLIC_ID,
  assertSafeRestoreState,
  bootFromLocal,
  buildLocalOpenPayload,
  canClaimAuthenticatedWithoutTrustId,
  canOperateOffline,
  clearMemoryKvStore,
  ensureInstallation,
  memoryKvStore,
  readInstallation,
  readLastExperience,
  rememberOpenedExperience,
  sessionsAreIsolated,
  setKvStoreForTests,
  shellAuthPosture,
  touchExperienceSlot,
} from "../src/local/index.js";
import { writeRegistry } from "../src/local/registry.js";
import { MYBRANDOS_PUBLIC_ENTRY } from "../src/local/bootstrap.js";
import {
  isCacheableShellAsset,
  isPrivateOrApiPath,
} from "../../../apps/os-experience/src/sw-cache-policy.js";

function resetStore() {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
}

function sampleApp(overrides: Partial<DirectoryApplicationView> = {}): DirectoryApplicationView {
  return {
    id: "app.lifeos",
    name: "LifeOS",
    version: "1.0.0",
    origin: "https://lifeos.example/",
    productionUrl: "https://lifeos.example/",
    xperienceUrl: "https://lifeos.example/x",
    canManage: false,
    authMode: "APP_MANAGED",
    offlineCapability: "PARTIAL",
    category: "Lifestyle",
    capabilities: ["IDENTITY"],
    publicationState: "PUBLISHED",
    experienced: true,
    experienceStatus: "ACTIVE",
    ...overrides,
  };
}

test.beforeEach(() => {
  resetStore();
});

test("1. Xperience opens without authentication", () => {
  const boot = bootFromLocal({ online: false });
  assert.equal(boot.requiresXperienceLogin, false);
  assert.ok(boot.installation.installationId);
  assert.ok(boot.directory.length >= 1);
});

test("2. First initialized installation receives a local installation ID", () => {
  assert.equal(readInstallation(), null);
  const first = ensureInstallation();
  assert.match(first.installationId, /./);
  assert.ok(first.createdAt);
});

test("3. Existing installation ID survives restart", () => {
  const first = ensureInstallation();
  const second = ensureInstallation(new Date(Date.now() + 1000));
  assert.equal(second.installationId, first.installationId);
  assert.notEqual(second.lastOpenedAt, first.lastOpenedAt);
});

test("4. Xperience shell loads offline after installation", () => {
  ensureInstallation();
  writeRegistry([MYBRANDOS_PUBLIC_ENTRY]);
  const boot = bootFromLocal({ online: false });
  assert.equal(boot.usedNetwork, false);
  assert.equal(boot.requiresXperienceLogin, false);
  assert.ok(boot.registry.length >= 1);
});

test("5. Last Experience is restored", () => {
  ensureInstallation();
  writeRegistry([MYBRANDOS_PUBLIC_ENTRY]);
  rememberOpenedExperience(
    {
      id: MYBRANDOS_PUBLIC_ID,
      name: "mybrandOS",
      version: "1.0.0",
      origin: MYBRANDOS_PUBLIC_ENTRY.origin,
      productionUrl: MYBRANDOS_PUBLIC_ENTRY.entrypoint,
      xperienceUrl: MYBRANDOS_PUBLIC_ENTRY.entrypoint,
      canManage: false,
      authMode: "PUBLIC",
      offlineCapability: "PARTIAL",
      category: "Lifestyle",
      capabilities: [],
      publicationState: "PUBLISHED",
      experienced: true,
    },
    "PUBLIC",
  );
  const last = readLastExperience();
  assert.equal(last?.lastExperienceId, MYBRANDOS_PUBLIC_ID);
  const boot = bootFromLocal({ online: false });
  assert.equal(boot.restore?.app.id, MYBRANDOS_PUBLIC_ID);
  assert.ok(boot.restore?.payload?.embedUrl);
});

test("6. No backend login call is required for Xperience startup", () => {
  const boot = bootFromLocal({ online: false });
  assert.equal(boot.usedNetwork, false);
  assert.equal(boot.requiresXperienceLogin, false);
});

test("7. PUBLIC Experience opens without auth", () => {
  const posture = shellAuthPosture("PUBLIC");
  assert.equal(posture.mode, "PUBLIC");
  assert.equal(posture.shellClaimsAuthenticated, false);
  const payload = buildLocalOpenPayload(
    sampleApp({ authMode: "PUBLIC", id: MYBRANDOS_PUBLIC_ID, name: "mybrandOS" }),
    "PUBLIC",
  );
  assert.ok(payload.embedUrl);
});

test("8. APP_MANAGED Experience retains control of its own auth", () => {
  const posture = shellAuthPosture("APP_MANAGED");
  assert.equal(posture.mode, "APP_MANAGED");
  assert.equal(posture.shellClaimsAuthenticated, false);
  if (posture.mode === "APP_MANAGED") {
    assert.equal(posture.owner, "application");
  }
});

test("9. TRUSTID Experience cannot be opened as authenticated without TrustID", () => {
  const posture = shellAuthPosture("TRUSTID");
  assert.equal(posture.shellClaimsAuthenticated, false);
  assert.equal(canClaimAuthenticatedWithoutTrustId("TRUSTID"), false);
  assert.equal(canClaimAuthenticatedWithoutTrustId("PUBLIC"), true);
});

test("10. Xperience does not copy one app's auth session into another", () => {
  touchExperienceSlot({ experienceId: "lifeos", restoreState: "opaque-lifeos-hint" });
  touchExperienceSlot({ experienceId: "studio", restoreState: "opaque-studio-hint" });
  assert.equal(sessionsAreIsolated("lifeos", "studio"), true);
  assert.throws(() => assertSafeRestoreState("password=secret"));
  assert.throws(() => assertSafeRestoreState("Bearer token abc"));
});

test("11. Restarting Xperience does not destroy valid app state unnecessarily", () => {
  touchExperienceSlot({ experienceId: "lifeos", route: "/home", restoreState: "slot-a" });
  const before = readLastExperience();
  ensureInstallation();
  const after = readLastExperience();
  assert.equal(after?.lastExperienceId, before?.lastExperienceId);
  assert.equal(after?.experienceStateReference, "slot-a");
});

test("12. Offline mode does not redirect to Xperience login", () => {
  const boot = bootFromLocal({ online: false });
  assert.equal(boot.requiresXperienceLogin, false);
});

test("13. Missing network does not crash the shell", () => {
  assert.doesNotThrow(() => bootFromLocal({ online: false }));
});

test("14. An online-only Experience fails gracefully offline", () => {
  ensureInstallation();
  writeRegistry([
    {
      ...MYBRANDOS_PUBLIC_ENTRY,
      experienceId: "online.only",
      name: "Online Only",
      offlineCapability: "NONE",
      status: "ONLINE_ONLY",
    },
  ]);
  rememberOpenedExperience(
    sampleApp({
      id: "online.only",
      name: "Online Only",
      offlineCapability: "NONE",
      authMode: "PUBLIC",
    }),
  );
  const boot = bootFromLocal({ online: false });
  assert.equal(boot.restore?.offlineBlocked, true);
  assert.match(boot.restore?.offlineMessage ?? "", /connection/i);
  assert.equal(canOperateOffline("NONE", false).ok, false);
});

test("15. mybrandOS public Experience launches correctly", () => {
  const boot = bootFromLocal({ online: true });
  assert.ok(boot.directory.some((app) => app.id === MYBRANDOS_PUBLIC_ID || /mybrand/i.test(app.name)));
  assert.equal(boot.restore?.app.authMode ?? "PUBLIC", "PUBLIC");
  const payload = boot.restore?.payload;
  assert.ok(payload?.embedUrl.includes("mrfundzman") || payload?.applicationId === MYBRANDOS_PUBLIC_ID);
});

test("16. creator/admin routes remain protected", () => {
  const publicApp = sampleApp({
    managementUrl: "https://studio.example/admin",
    canManage: false,
    authMode: "TRUSTID",
  });
  assert.throws(() => buildLocalOpenPayload(publicApp, "MANAGEMENT"));
  const allowed = sampleApp({
    managementUrl: "https://studio.example/admin",
    canManage: true,
    authMode: "TRUSTID",
  });
  const payload = buildLocalOpenPayload(allowed, "MANAGEMENT");
  assert.equal(payload.surface, "MANAGEMENT");
  assert.equal(payload.embedUrl, "https://studio.example/admin");
});

test("17. service worker caches only appropriate public/runtime assets", () => {
  assert.equal(isCacheableShellAsset("/index.html"), true);
  assert.equal(isCacheableShellAsset("/assets/index-abc.js"), true);
  assert.equal(isCacheableShellAsset("/icons/icon.svg"), true);
  assert.equal(isCacheableShellAsset("/v1/directory"), false);
  assert.equal(isCacheableShellAsset("/api/private/me"), false);
});

test("18. protected/private API responses are not accidentally stored in public caches", () => {
  assert.equal(isPrivateOrApiPath("/v1/me"), true);
  assert.equal(isPrivateOrApiPath("/v1/experiences"), true);
  assert.equal(isPrivateOrApiPath("/api/session"), true);
  assert.equal(isPrivateOrApiPath("/admin/dashboard"), true);
  assert.equal(isPrivateOrApiPath("/private/token"), true);
  assert.equal(isPrivateOrApiPath("/auth/login"), true);
  assert.equal(isCacheableShellAsset("/v1/me"), false);
});

test("authMode / offlineCapability normalizers", () => {
  assert.equal(normalizeExperienceAuthMode("TRUSTID"), "TRUSTID");
  assert.equal(normalizeExperienceAuthMode("nope"), "PUBLIC");
  assert.equal(normalizeOfflineCapability("FULL"), "FULL");
  assert.equal(normalizeOfflineCapability("x"), "NONE");
});
