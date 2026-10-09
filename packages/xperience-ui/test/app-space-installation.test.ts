import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateCatalogSigningKeyPair, signExperienceCatalog, type CatalogExperienceEntry } from "@digiconomy/xperience-contract";
import {
  MYBRANDOS_PUBLIC_ENTRY,
  MYBRANDOS_PUBLIC_ID,
  SPACE_LAUNCH_ACTION,
  SPACE_LAUNCH_EXTRA,
  clearMemoryKvStore,
  findSpaceHomeEntry,
  findSpaceRegistration,
  importSpaceLaunchFile,
  memoryKvStore,
  readSpaceHomeEntries,
  registryToDirectoryView,
  resolveInstalledSpace,
  setKvStoreForTests,
  setTrustedSpacePublishersForTests,
  spaceShortcutRequest,
  storeSignedCatalog,
  type SpaceHomeEntryHost,
  type SpaceShortcutRequest,
} from "../src/local/index.ts";
import {
  APP_LAUNCH_ACTION,
  APP_LAUNCH_EXTRA,
  INSTALLED_TARGETS_KEY,
  appInstallTarget,
  appShortcutRequest,
  createAndroidInstallationAdapter,
  createIosInstallationAdapter,
  createUnsupportedInstallationAdapter,
  createWebInstallationAdapter,
  detectWebBrowser,
  entryManifest,
  findInstalledTarget,
  installResultMessage,
  installTarget,
  installableTargetsFor,
  launchEntryRequest,
  monogramSvg,
  parseTargetKey,
  readInstalledTargets,
  recordInstalledTarget,
  resolveInstalledApp,
  resolveLaunchMode,
  routeTargetLaunch,
  spaceInstallTarget,
  targetInstallationView,
  targetKey,
  validateInstallableTarget,
  webInstallCapability,
  webInstallUrl,
  webLaunchFromUrl,
  webLaunchPath,
  type AppHomeEntryHost,
  type AppShortcutRequest,
  type DeferredInstallPrompt,
  type InstallationPlatformAdapter,
  type LaunchEntryResult,
  type SpaceInstallationSteps,
  type WebEntryResource,
  type WebInstallEnvironment,
} from "../src/installation/index.ts";

/**
 * OS Xperience APP + SPACE Installation V1: one INSTALL action, two different things underneath.
 * APP records what launches; SPACE runs the frozen Space path (V1 verifier → Offline Kernel →
 * Space Installation V1 record) before any platform entry. Launch entries carry identity only.
 */
const root = new URL("../../../", import.meta.url);
const fixture = readFileSync(new URL("apps/os-experience/public/spaces/mrfundzman.space", root));
const xperienceVersion = "0.3.6";
const channelId = "mrfundzman.tv";
const APP_ID = "lifeos";
const realFetch = globalThis.fetch;
let fetchCalls = 0;

const mybrandosView = () => registryToDirectoryView({ ...MYBRANDOS_PUBLIC_ENTRY });
const lifeosView = () => registryToDirectoryView({
  ...MYBRANDOS_PUBLIC_ENTRY,
  experienceId: APP_ID,
  name: "LifeOS",
  entrypoint: "https://app.getlifeos.app/",
  origin: "https://app.getlifeos.app/",
  offlineCapability: "NONE",
  authMode: "APP_MANAGED",
  executionModes: [{ mode: "APP" }],
});

function catalogEntry(experienceId: string, name: string, modes: CatalogExperienceEntry["executionModes"], version = "1.0.0"): CatalogExperienceEntry {
  return {
    experienceId, name, version, entrypoint: `https://${experienceId}.example/`, origin: `https://${experienceId}.example/`,
    authMode: "PUBLIC", offlineCapability: "PARTIAL", releaseState: "LIVE", visibility: "LISTED", preloadPolicy: "NONE", packageVersion: "1", contentHash: "sha256:x",
    updatedAt: new Date().toISOString(), executionModes: modes,
  };
}

async function signedCatalog(entries: CatalogExperienceEntry[]) {
  const keys = await generateCatalogSigningKeyPair();
  const now = new Date().toISOString();
  const catalog = await signExperienceCatalog({ manifestVersion: 1, generatedAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), experiences: entries }, keys.privateKey);
  assert.equal((await storeSignedCatalog(catalog, keys.publicKeySpkiBase64)).ok, true);
}

/** Records every request the platform receives, so tests can prove what an entry carries. */
function fakeAndroid(options: { pinned?: string[]; supported?: boolean } = {}) {
  const pinned = new Set(options.pinned ?? []);
  const requests: (SpaceShortcutRequest | AppShortcutRequest)[] = [];
  const disabled: string[] = [];
  const pin = async (request: SpaceShortcutRequest | AppShortcutRequest) => {
    requests.push(request);
    const alreadyPinned = pinned.has(request.shortcutId);
    pinned.add(request.shortcutId);
    return { requested: true, alreadyPinned };
  };
  const space: SpaceHomeEntryHost = {
    supported: async () => options.supported ?? true,
    pinnedShortcutIds: async () => [...pinned],
    requestPin: pin,
    update: async () => undefined,
    disable: async (id) => void disabled.push(id),
    takeLaunch: async () => null,
    onLaunch: () => () => undefined,
    onPinnedChange: () => () => undefined,
  };
  const app: AppHomeEntryHost = { requestPin: pin, update: async () => undefined, disable: async (id) => void disabled.push(id) };
  return { adapter: createAndroidInstallationAdapter({ space, app }), requests, pinned, disabled };
}

/** The frozen Space owners, wired to the real V1 verifier and a scripted Offline Kernel outcome. */
function spaceSteps(prepare: Awaited<ReturnType<SpaceInstallationSteps["prepare"]>> = "READY", options: { ready?: boolean; artifact?: Uint8Array } = {}) {
  const calls = { register: 0, prepare: 0 };
  let ready = options.ready ?? false;
  const steps: SpaceInstallationSteps = {
    isRegistered: (id) => Boolean(findSpaceRegistration(id)),
    register: async () => {
      calls.register += 1;
      const result = await importSpaceLaunchFile(options.artifact ?? new Uint8Array(fixture), { xperienceVersion });
      return result.ok ? { ok: true } : { ok: false, code: result.code };
    },
    locallyReady: async () => ready,
    prepare: async () => {
      calls.prepare += 1;
      if (prepare === "READY") ready = true;
      return prepare;
    },
  };
  return { steps, calls };
}

const appLaunch = (appId: unknown, patch: Record<string, unknown> = {}) => ({ action: APP_LAUNCH_ACTION, hasData: false, extraKeys: [APP_LAUNCH_EXTRA], appId, ...patch });
const spaceLaunch = (spaceId: unknown, patch: Record<string, unknown> = {}) => ({ action: SPACE_LAUNCH_ACTION, hasData: false, extraKeys: [SPACE_LAUNCH_EXTRA], spaceId, ...patch });

const CREDENTIAL_PATTERN = /token|secret|password|session|cookie|bearer|biometric|face|embedding|template|credential|authority|grant|trustid|pdi|jwt|apikey|privatekey|signature/i;

function assertNoCredentials(value: unknown, label: string) {
  const json = JSON.stringify(value);
  for (const key of JSON.stringify(value).match(/"([^"]+)":/g) ?? []) {
    assert.doesNotMatch(key, CREDENTIAL_PATTERN, `${label}: field ${key}`);
  }
  assert.doesNotMatch(json, /eyJ[A-Za-z0-9_-]{10,}/, `${label}: JWT-like value`);
}

test.beforeEach(() => {
  clearMemoryKvStore();
  setKvStoreForTests(memoryKvStore);
  delete (globalThis as { window?: unknown }).window;
  setTrustedSpacePublishersForTests(null);
  fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network used"); }) as typeof fetch;
});

test.after(() => {
  setKvStoreForTests(null);
  setTrustedSpacePublishersForTests(null);
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
});

/* ------------------------------------------------------------------ unified contract */

test("unified contract: APP and SPACE targets come from trusted local state and keep their own fields", async () => {
  const app = appInstallTarget(mybrandosView());
  assert.ok(app);
  assert.equal(app.type, "APP");
  assert.deepEqual(app.launchTarget, { mode: "APP" });
  assert.equal(app.offlineCapability, "PARTIAL", "installing never upgrades an App's own offline capability");
  assert.equal("launchFile" in app, false);

  const space = spaceInstallTarget(mybrandosView());
  assert.ok(space, "the bundled signed artifact makes the Space installable before registration");
  assert.equal(space.type, "SPACE");
  assert.deepEqual(space.launchTarget, { mode: "SPACE", broadcastChannelId: channelId });
  assert.deepEqual(space.launchFile, { registered: false, bundledArtifact: "spaces/mrfundzman.space" });
  assert.equal(space.source, "BUNDLED_LAUNCH_FILE");
  assert.equal("offlineCapability" in space, false);

  assert.deepEqual(installableTargetsFor(mybrandosView()).map((target) => target.type), ["APP", "SPACE"], "one provider, two distinct installable targets");
  assert.equal(targetKey("APP", MYBRANDOS_PUBLIC_ID) === targetKey("SPACE", MYBRANDOS_PUBLIC_ID), false);
  assert.equal(targetKey("SPACE", MYBRANDOS_PUBLIC_ID), spaceShortcutRequest({ spaceId: MYBRANDOS_PUBLIC_ID, name: "x" }).shortcutId, "SPACE keys are the frozen V1 shortcut IDs");

  assert.equal((await importSpaceLaunchFile(new Uint8Array(fixture), { xperienceVersion })).ok, true);
  const registered = spaceInstallTarget(mybrandosView());
  assert.equal(registered?.name, "MrFundzMan", "a registered Space is named by its signed launch file");
  assert.equal(registered?.source, "LAUNCH_FILE");
  assert.equal(fetchCalls, 0);
});

test("unified contract: validation refuses malformed, unknown-type, unsafe and smuggled fields", () => {
  const app = appInstallTarget(mybrandosView())!;
  const space = spaceInstallTarget(mybrandosView())!;
  assert.equal(validateInstallableTarget(app).ok, true);
  assert.equal(validateInstallableTarget(space).ok, true);
  const reason = (raw: unknown) => {
    const result = validateInstallableTarget(raw);
    return result.ok ? "OK" : result.reason;
  };
  assert.equal(reason(null), "MALFORMED");
  assert.equal(reason([app]), "MALFORMED");
  assert.equal(reason({ ...app, type: "PWA" }), "UNKNOWN_TYPE");
  assert.equal(reason({ ...app, type: undefined }), "UNKNOWN_TYPE");
  assert.equal(reason({ ...app, id: "../etc" }), "INVALID_ID");
  assert.equal(reason({ ...app, id: "https://evil.example" }), "INVALID_ID");
  assert.equal(reason({ ...app, name: "" }), "INVALID_NAME");
  assert.equal(reason({ ...app, name: "Life\u0000OS" }), "INVALID_NAME");
  assert.equal(reason({ ...app, icon: { monogram: "<s>", color: "#000000" } }), "INVALID_ICON");
  assert.equal(reason({ ...app, icon: { ...app.icon, src: "https://evil.example/i.png" } }), "INVALID_ICON");
  assert.equal(reason({ ...app, launchTarget: { mode: "SPACE" } }), "INVALID_LAUNCH_TARGET", "APP never carries a SPACE launch");
  assert.equal(reason({ ...app, launchTarget: { mode: "APP", url: "https://evil.example" } }), "INVALID_LAUNCH_TARGET");
  assert.equal(reason({ ...space, launchTarget: { mode: "APP" } }), "INVALID_LAUNCH_TARGET", "SPACE never becomes an APP");
  assert.equal(reason({ ...app, sessionToken: "abc" }), "UNSAFE_METADATA");
  assert.equal(reason({ ...space, trustIdCredential: "abc" }), "UNSAFE_METADATA");
  assert.equal(reason({ ...app, launchFile: space.launchFile }), "UNSAFE_METADATA", "type-specific fields stay type-specific");
});

/* ------------------------------------------------------------------ APP install */

test("APP install: entry created, recorded once, reinstall is ALREADY_INSTALLED, never authenticates", async () => {
  const android = fakeAndroid();
  const app = appInstallTarget(mybrandosView())!;
  const { steps, calls } = spaceSteps();
  const first = await installTarget(app, { adapter: android.adapter, space: steps });
  assert.equal(first.code, "INSTALLATION_PENDING_PLATFORM_CONFIRMATION");
  assert.equal(first.guidance, "LAUNCHER");
  assert.equal(installResultMessage(first), "Confirm on your Home Screen to add mybrandOS.");
  assert.deepEqual(android.requests, [appShortcutRequest(launchEntryRequest(app))]);
  assert.equal(findInstalledTarget("APP", MYBRANDOS_PUBLIC_ID)?.launchEntryState, "PENDING_CONFIRMATION");
  assert.deepEqual(calls, { register: 0, prepare: 0 }, "APP installation runs no Space step");
  assert.equal(findSpaceRegistration(MYBRANDOS_PUBLIC_ID), null, "installing the App does not install the Space");

  const again = await installTarget(app, { adapter: android.adapter, space: steps });
  assert.equal(again.code, "ALREADY_INSTALLED");
  assert.equal(installResultMessage(again), "mybrandOS is on your Home Screen.");
  assert.equal(readInstalledTargets().length, 1, "reinstalling refreshes one row, never duplicates it");
  assert.equal(findInstalledTarget("APP", MYBRANDOS_PUBLIC_ID)?.launchEntryState, "CONFIRMED");
  assertNoCredentials(readInstalledTargets(), "installed registry");
  assert.equal(fetchCalls, 0);
});

test("APP direct launch resolves the installed App, survives a runtime restart, and refuses wrong or missing Apps", async () => {
  const android = fakeAndroid();
  const { steps } = spaceSteps();
  assert.equal((await installTarget(appInstallTarget(mybrandosView())!, { adapter: android.adapter, space: steps })).code, "INSTALLATION_PENDING_PLATFORM_CONFIRMATION");

  // Runtime restart: a new process reads the same persisted store and nothing else.
  const persisted = memoryKvStore.getItem(INSTALLED_TARGETS_KEY);
  clearMemoryKvStore();
  memoryKvStore.setItem(INSTALLED_TARGETS_KEY, persisted!);

  const resolved = resolveInstalledApp(MYBRANDOS_PUBLIC_ID, { apps: [mybrandosView()] });
  assert.equal(resolved.kind, "RESOLVED");
  assert.equal(resolved.kind === "RESOLVED" && resolved.target.executionMode, "APP", "an App entry never opens the Space");
  assert.equal(resolveInstalledApp("someone.else", { apps: [mybrandosView()] }).kind, "NOT_INSTALLED", "wrong App ID");
  assert.equal(resolveInstalledApp("../etc").kind, "INVALID_TARGET");
  assert.equal(resolveInstalledApp(MYBRANDOS_PUBLIC_ID, { apps: [mybrandosView()], fixedMode: "SPACE" }).kind, "UNAVAILABLE", "a SPACE-locked host never runs an App");

  // Missing App: recorded, but no released APP target any more (a signed catalog withdraws it).
  recordInstalledTarget({ type: "APP", id: APP_ID, label: "LifeOS", platform: "ANDROID", launchEntryState: "CONFIRMED" });
  await signedCatalog([catalogEntry(MYBRANDOS_PUBLIC_ID, "mybrandOS", [{ mode: "APP" }])]);
  assert.equal(resolveInstalledApp(APP_ID, { apps: [lifeosView()] }).kind, "UNAVAILABLE");
  assert.equal(fetchCalls, 0, "App resolution reads local state only");
});

test("APP install refuses targets that are not released, and platforms that cannot install", async () => {
  await signedCatalog([catalogEntry(MYBRANDOS_PUBLIC_ID, "mybrandOS", [{ mode: "APP" }])]);
  assert.equal(appInstallTarget(lifeosView()), null, "under a signed catalog an uncarried App is not released, so not installable");
  const app = appInstallTarget(mybrandosView())!;
  assert.equal(app.source, "SIGNED_CATALOG");
  const { steps } = spaceSteps();
  const none = await installTarget(app, { adapter: null, space: steps });
  assert.equal(none.code, "UNSUPPORTED_PLATFORM");
  const windows = await installTarget(app, { adapter: createUnsupportedInstallationAdapter("WEB", "BROWSER_HAS_NO_INSTALL_MECHANISM"), space: steps });
  assert.equal(windows.code, "UNSUPPORTED_PLATFORM");
  assert.equal(installResultMessage(windows), "Installing isn't available here yet.");
  const launcherRefuses = await installTarget(app, { adapter: fakeAndroid({ supported: false }).adapter, space: steps });
  assert.equal(launcherRefuses.code, "UNSUPPORTED_PLATFORM");
  assert.deepEqual(readInstalledTargets(), [], "no false installed state");
  assert.equal((await installTarget({ ...app, type: "WIDGET" }, { adapter: fakeAndroid().adapter, space: steps })).code, "INVALID_TARGET");
});

test("APP install: a failed or dismissed launch entry leaves no installed record", async () => {
  const app = appInstallTarget(mybrandosView())!;
  const { steps } = spaceSteps();
  const failing: InstallationPlatformAdapter = {
    platform: "WEB",
    capability: async () => ({ platform: "WEB", mechanism: "WEB_INSTALL_PROMPT", supported: true, requiresUserConfirmation: true }),
    createEntry: async () => ({ status: "FAILED", reason: "SERVICE_WORKER_NOT_READY" }),
    presentEntries: async () => null,
  };
  const failed = await installTarget(app, { adapter: failing, space: steps });
  assert.equal(failed.code, "LAUNCH_ENTRY_FAILED");
  assert.equal(failed.reason, "SERVICE_WORKER_NOT_READY");
  assert.equal(installResultMessage(failed), "mybrandOS couldn't be added yet. Try again in a moment.");
  const dismissed = await installTarget(app, { adapter: { ...failing, createEntry: async () => ({ status: "DISMISSED" }) }, space: steps });
  assert.equal(dismissed.code, "INSTALLATION_FAILED");
  assert.equal(dismissed.reason, "USER_DISMISSED");
  assert.deepEqual(readInstalledTargets(), []);
});

/* ------------------------------------------------------------------ SPACE regression */

test("SPACE install reuses the frozen path: V1 verify → register → prepare → V1 home record → entry; alreadyPinned preserved", async () => {
  const android = fakeAndroid();
  const { steps, calls } = spaceSteps("READY");
  const space = spaceInstallTarget(mybrandosView())!;
  const first = await installTarget(space, { adapter: android.adapter, space: steps });
  assert.equal(first.code, "INSTALLATION_PENDING_PLATFORM_CONFIRMATION");
  assert.deepEqual(calls, { register: 1, prepare: 1 });
  const registration = findSpaceRegistration(MYBRANDOS_PUBLIC_ID);
  assert.equal(registration?.name, "MrFundzMan", "registered through the Space Launch File V1 verifier");
  assert.equal(findSpaceHomeEntry(MYBRANDOS_PUBLIC_ID)?.presentationSource, "LAUNCH_FILE", "the V1 home-entry record stays authoritative");
  assert.deepEqual(android.requests, [spaceShortcutRequest({ spaceId: MYBRANDOS_PUBLIC_ID, name: "MrFundzMan" })], "Android receives exactly the frozen V1 Space request");
  assert.equal(findInstalledTarget("SPACE", MYBRANDOS_PUBLIC_ID)?.label, "MrFundzMan");

  // Re-add: the frozen alreadyPinned behaviour — no confirmation the launcher will never show.
  const again = await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: android.adapter, space: steps });
  assert.equal(again.code, "ALREADY_INSTALLED");
  assert.equal(installResultMessage(again), "MrFundzMan is on your Home Screen.");
  assert.deepEqual(calls, { register: 1, prepare: 1 }, "already registered and prepared: nothing is redone");
  assert.equal(readSpaceHomeEntries().length, 1);
  assert.equal(readInstalledTargets().length, 1);

  const resolved = resolveInstalledSpace(MYBRANDOS_PUBLIC_ID, { apps: [mybrandosView()] });
  assert.equal(resolved.kind, "RESOLVED");
  assert.equal(resolved.kind === "RESOLVED" && resolved.target.executionMode, "SPACE", "a Space entry never becomes an App");
  assert.equal(fetchCalls, 0);
});

test("SPACE install: a tampered launch file is INVALID_TARGET; hydration failure keeps the registration and adds no entry", async () => {
  const android = fakeAndroid();
  const tampered = new TextEncoder().encode(fixture.toString("utf8").replace('"MrFundzMan"', '"FakeTV"'));
  const forged = spaceSteps("READY", { artifact: tampered });
  const refused = await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: android.adapter, space: forged.steps });
  assert.equal(refused.code, "INVALID_TARGET");
  assert.equal(refused.reason, "INTEGRITY_FAILED");
  assert.equal(findSpaceRegistration(MYBRANDOS_PUBLIC_ID), null);
  assert.deepEqual(android.requests, []);

  for (const outcome of ["OFFLINE", "NO_ROUTE", "FAILED"] as const) {
    const { steps } = spaceSteps(outcome);
    const result = await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: android.adapter, space: steps });
    assert.equal(result.code, "SPACE_HYDRATION_FAILED", outcome);
    assert.equal(result.reason, outcome);
  }
  assert.match(installResultMessage({ code: "SPACE_HYDRATION_FAILED", reason: "OFFLINE" }, "MrFundzMan"), /needs a connection/);
  const noRoute = installResultMessage({ code: "SPACE_HYDRATION_FAILED", reason: "NO_ROUTE" }, "MrFundzMan");
  assert.match(noRoute, /no preparation route/);
  assert.doesNotMatch(noRoute, /connect/i, "an online device without a route is not told to connect");
  assert.ok(findSpaceRegistration(MYBRANDOS_PUBLIC_ID), "registration is kept for the next attempt");
  assert.equal(findSpaceHomeEntry(MYBRANDOS_PUBLIC_ID), null, "no home entry for a Space that cannot run");
  assert.deepEqual(android.requests, [], "no launcher entry for an unprepared Space");
  assert.deepEqual(readInstalledTargets(), []);
});

test("SPACE install: an entry failure rolls back only what this attempt added", async () => {
  const { steps } = spaceSteps("READY");
  const failing: InstallationPlatformAdapter = {
    platform: "ANDROID",
    capability: async () => ({ platform: "ANDROID", mechanism: "ANDROID_PINNED_SHORTCUT", supported: true, requiresUserConfirmation: true }),
    createEntry: async () => ({ status: "FAILED", reason: "PIN_REQUEST_FAILED" }),
    presentEntries: async () => [],
  };
  const result = await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: failing, space: steps });
  assert.equal(result.code, "LAUNCH_ENTRY_FAILED");
  assert.equal(findSpaceHomeEntry(MYBRANDOS_PUBLIC_ID), null, "V1 behaviour: no home-entry record without an entry");
  assert.ok(findSpaceRegistration(MYBRANDOS_PUBLIC_ID), "verified registration stays");
  assert.deepEqual(readInstalledTargets(), []);
});

test("SPACE offline launch: an installed, prepared Space resolves from local state with no network", async () => {
  const { steps } = spaceSteps("READY");
  await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: fakeAndroid().adapter, space: steps });
  fetchCalls = 0;
  const mode = resolveLaunchMode(spaceLaunch(MYBRANDOS_PUBLIC_ID));
  assert.deepEqual(mode, { kind: "DIRECT_SPACE", spaceId: MYBRANDOS_PUBLIC_ID, source: "ANDROID", standalone: true });
  const resolved = resolveInstalledSpace(MYBRANDOS_PUBLIC_ID, {});
  assert.equal(resolved.kind, "RESOLVED");
  assert.equal(fetchCalls, 0);
});

/* ------------------------------------------------------------------ router + launch mode */

test("router: APP and SPACE entries route by type; unknown, malformed and smuggled requests fail safely", () => {
  assert.deepEqual(routeTargetLaunch(appLaunch(APP_ID)), { kind: "APP", appId: APP_ID, source: "ANDROID", standalone: true });
  assert.deepEqual(routeTargetLaunch(spaceLaunch(MYBRANDOS_PUBLIC_ID)), { kind: "SPACE", spaceId: MYBRANDOS_PUBLIC_ID, source: "ANDROID", standalone: true });
  const invalid = [
    null, undefined, "app:lifeos", [], {},
    { action: "android.intent.action.MAIN", hasData: false, extraKeys: [] },
    appLaunch(APP_ID, { hasData: true }),
    appLaunch(APP_ID, { extraKeys: [APP_LAUNCH_EXTRA, "ox.mode"] }),
    appLaunch(APP_ID, { extraKeys: [APP_LAUNCH_EXTRA, APP_LAUNCH_EXTRA] }),
    appLaunch(APP_ID, { extraKeys: [SPACE_LAUNCH_EXTRA] }),
    appLaunch("../etc"),
    appLaunch("https://evil.example"),
    appLaunch(APP_ID, { extraKeys: [APP_LAUNCH_EXTRA, SPACE_LAUNCH_EXTRA] }),
    spaceLaunch(MYBRANDOS_PUBLIC_ID, { extraKeys: [SPACE_LAUNCH_EXTRA, APP_LAUNCH_EXTRA] }),
    spaceLaunch(MYBRANDOS_PUBLIC_ID, { hasData: true }),
    { ...spaceLaunch(MYBRANDOS_PUBLIC_ID), action: APP_LAUNCH_ACTION },
    { source: "WEB", key: "widget:lifeos", standalone: true },
    { source: "WEB", key: "app:../etc", standalone: true },
    { source: "WEB", key: 42, standalone: true },
  ];
  for (const raw of invalid) assert.deepEqual(routeTargetLaunch(raw), { kind: "INVALID" }, JSON.stringify(raw));

  assert.deepEqual(routeTargetLaunch({ source: "WEB", key: `space:${MYBRANDOS_PUBLIC_ID}`, standalone: true }), { kind: "SPACE", spaceId: MYBRANDOS_PUBLIC_ID, source: "WEB", standalone: true });
  assert.deepEqual(webLaunchFromUrl(`https://xperience.getlifeos.app${webLaunchPath("APP", APP_ID)}&mode=SPACE&url=https://evil.example`, false), { source: "WEB", key: "app:lifeos", standalone: false }, "only the target key is read");
  assert.equal(webLaunchFromUrl("https://xperience.getlifeos.app/", true), null);
  assert.equal(webLaunchPath("SPACE", MYBRANDOS_PUBLIC_ID), "/?ox-launch=space%3Abootstrap.mybrandos.public");
  assert.deepEqual(parseTargetKey("space:bootstrap.mybrandos.public"), { type: "SPACE", id: MYBRANDOS_PUBLIC_ID });
  assert.equal(parseTargetKey("app:"), null);
});

test("launch mode is decided from the launch request alone: normal icon → Home, entries → DIRECT, malformed → DIRECT_INVALID", () => {
  assert.deepEqual(resolveLaunchMode(null), { kind: "XPERIENCE_NORMAL" });
  assert.deepEqual(resolveLaunchMode(undefined), { kind: "XPERIENCE_NORMAL" });
  assert.equal(resolveLaunchMode(appLaunch(APP_ID)).kind, "DIRECT_APP");
  assert.equal(resolveLaunchMode(spaceLaunch(MYBRANDOS_PUBLIC_ID)).kind, "DIRECT_SPACE");
  assert.equal(resolveLaunchMode({ source: "WEB", key: "app:lifeos", standalone: true }).kind, "DIRECT_APP");
  // A target task whose launch could not be read is still a target: never Home.
  assert.deepEqual(resolveLaunchMode({ action: null, hasData: false, extraKeys: [] }), { kind: "DIRECT_INVALID" });
  assert.deepEqual(resolveLaunchMode(appLaunch("../etc")), { kind: "DIRECT_INVALID" });
});

/* ------------------------------------------------------------------ installed state */

test("installed state separates the launch entry from Space continuity and never claims more than it knows", () => {
  const row = (launchEntryState: "CONFIRMED" | "PENDING_CONFIRMATION", version?: string) => ({ type: "APP" as const, id: APP_ID, key: "app:lifeos", label: "LifeOS", platform: "ANDROID" as const, launchEntryState, installedAt: "t", updatedAt: "t", ...(version ? { version } : {}) });
  assert.equal(targetInstallationView({ type: "APP", record: null, present: null }).state, "NOT_INSTALLED");
  assert.equal(targetInstallationView({ type: "APP", record: row("PENDING_CONFIRMATION"), present: false }).state, "NOT_INSTALLED", "a request the launcher never confirmed is not an install");
  assert.equal(targetInstallationView({ type: "APP", record: row("CONFIRMED"), present: false }).state, "NOT_INSTALLED", "icon removed from the launcher");
  assert.deepEqual(targetInstallationView({ type: "APP", record: row("CONFIRMED"), present: true }), { state: "INSTALLED", launchEntry: "PRESENT" });
  assert.deepEqual(targetInstallationView({ type: "APP", record: row("CONFIRMED"), present: null }), { state: "INSTALLED", launchEntry: "UNKNOWN" }, "browsers cannot enumerate installed web apps");
  assert.equal(targetInstallationView({ type: "APP", record: row("CONFIRMED", "1.0.0"), present: true, currentVersion: "1.1.0" }).state, "UPDATE_AVAILABLE");
  assert.equal(targetInstallationView({ type: "APP", record: row("CONFIRMED"), present: true, installing: true }).state, "INSTALLING");
  assert.equal(targetInstallationView({ type: "APP", record: row("CONFIRMED"), present: true, removing: true }).state, "REMOVING");
  const space = { ...row("CONFIRMED"), type: "SPACE" as const, key: "space:x", id: "x" };
  assert.deepEqual(targetInstallationView({ type: "SPACE", record: space, present: true, spaceRegistered: false, spaceHomeRecord: true, spaceReadiness: "READY_OFFLINE" }), { state: "BROKEN", launchEntry: "PRESENT", continuity: "MISSING_REGISTRATION" }, "an icon alone is not a Space");
  assert.deepEqual(targetInstallationView({ type: "SPACE", record: space, present: true, spaceRegistered: true, spaceHomeRecord: true, spaceReadiness: "NOT_PREPARED" }), { state: "INSTALLED", launchEntry: "PRESENT", continuity: "NEEDS_PREPARATION" });
  assert.equal(targetInstallationView({ type: "SPACE", record: space, present: true, spaceRegistered: true, spaceHomeRecord: false, spaceReadiness: "READY_OFFLINE" }).state, "BROKEN");
});

test("registry ignores forged, malformed and credential-carrying rows", () => {
  const good = recordInstalledTarget({ type: "APP", id: APP_ID, label: "LifeOS", platform: "WEB", launchEntryState: "CONFIRMED" });
  const raw = JSON.parse(memoryKvStore.getItem(INSTALLED_TARGETS_KEY)!) as { targets: unknown[] };
  raw.targets.push(
    { ...good, id: "other", key: "app:lifeos" },
    { ...good, key: "app:x", id: "x", sessionToken: "abc" },
    { ...good, key: "space:y", id: "y", type: "SPACE", platform: "MARS" },
    good,
  );
  memoryKvStore.setItem(INSTALLED_TARGETS_KEY, JSON.stringify(raw));
  assert.deepEqual(readInstalledTargets(), [good]);
  assert.throws(() => recordInstalledTarget({ type: "APP", id: "../etc", label: "x", platform: "WEB", launchEntryState: "CONFIRMED" }));
});

/* ------------------------------------------------------------------ security */

test("security: launch entries, manifests and records carry identity and presentation only", async () => {
  const android = fakeAndroid();
  const { steps } = spaceSteps("READY");
  await installTarget(appInstallTarget(mybrandosView())!, { adapter: android.adapter, space: steps });
  await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: android.adapter, space: steps });
  assert.deepEqual(android.requests.map((request) => Object.keys(request).sort()), [
    ["appId", "color", "label", "monogram", "shortcutId"],
    ["color", "label", "monogram", "shortcutId", "spaceId"],
  ]);
  assertNoCredentials(android.requests, "Android launch entries");
  const manifest = entryManifest(launchEntryRequest(appInstallTarget(mybrandosView())!), { png: true });
  assert.deepEqual(Object.keys(manifest).sort(), ["background_color", "display", "icons", "id", "name", "scope", "short_name", "start_url", "theme_color"]);
  assert.equal(manifest.start_url, "/?ox-launch=app%3Abootstrap.mybrandos.public");
  assert.equal(manifest.id, manifest.start_url, "the web entry's identity is its target");
  assertNoCredentials(manifest, "web manifest");
  for (const icon of manifest.icons as { src: string }[]) assert.match(icon.src, /^\/ox-install\/app\/bootstrap\.mybrandos\.public\/icon/, "icons are local, never remote");
  assertNoCredentials(readInstalledTargets(), "installed registry");
  assertNoCredentials(readSpaceHomeEntries(), "Space home-entry records");
  assert.doesNotMatch(monogramSvg({ monogram: "M", color: "#2f7bff" }), /<script|href|xlink/i);
});

/* ------------------------------------------------------------------ Android adapter */

test("Android adapter: App and Space entries, re-add, and disable go to the right prefix", async () => {
  const android = fakeAndroid();
  const app = launchEntryRequest(appInstallTarget(mybrandosView())!);
  const space = launchEntryRequest({ ...spaceInstallTarget(mybrandosView())!, name: "MrFundzMan" });
  assert.deepEqual(await android.adapter.createEntry(app), { status: "PENDING_CONFIRMATION", guidance: "LAUNCHER" });
  assert.deepEqual(await android.adapter.createEntry(space), { status: "PENDING_CONFIRMATION", guidance: "LAUNCHER" });
  assert.deepEqual(await android.adapter.createEntry(app), { status: "ALREADY_PRESENT" });
  assert.deepEqual(await android.adapter.createEntry(space), { status: "ALREADY_PRESENT" });
  assert.deepEqual((await android.adapter.presentEntries())?.sort(), [`app:${MYBRANDOS_PUBLIC_ID}`, `space:${MYBRANDOS_PUBLIC_ID}`]);
  await android.adapter.disableEntry?.(`app:${MYBRANDOS_PUBLIC_ID}`);
  await android.adapter.disableEntry?.(`space:${MYBRANDOS_PUBLIC_ID}`);
  assert.deepEqual(android.disabled, [`app:${MYBRANDOS_PUBLIC_ID}`, `space:${MYBRANDOS_PUBLIC_ID}`]);
  // An older native shell without APP entries says so instead of pinning a Space in its place.
  const spaceOnly = fakeAndroid();
  const legacy = createAndroidInstallationAdapter({ space: { supported: async () => true, pinnedShortcutIds: async () => [], requestPin: async () => ({ requested: true }), update: async () => undefined, disable: async () => undefined, takeLaunch: async () => null, onLaunch: () => () => undefined, onPinnedChange: () => () => undefined }, app: null });
  assert.deepEqual(await legacy.createEntry(app), { status: "UNSUPPORTED", reason: "APP_ENTRIES_UNAVAILABLE" });
  assert.deepEqual(spaceOnly.requests, []);
});

/* ------------------------------------------------------------------ web adapter */

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 16; CPH2727) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
};

function fakeWeb(overrides: Partial<WebInstallEnvironment> & { prompt?: DeferredInstallPrompt | null } = {}) {
  const resources: WebEntryResource[] = [];
  const log: string[] = [];
  const env: WebInstallEnvironment = {
    userAgent: UA.androidChrome,
    maxTouchPoints: 5,
    standalone: () => false,
    hasInstallPromptApi: true,
    hasServiceWorker: true,
    serviceWorkerControlled: async () => true,
    putEntryResources: async (items) => void resources.push(...items),
    renderPng: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    setManifest: (href) => void log.push(`manifest:${href ?? "default"}`),
    setAppleEntry: (entry) => void log.push(`apple:${entry ? entry.title : "default"}`),
    setLaunchUrl: (path) => void log.push(`url:${path ?? "restore"}`),
    nextInstallPrompt: async () => overrides.prompt ?? null,
    ...overrides,
  };
  return { adapter: createWebInstallationAdapter(env), env, resources, log };
}

function prompt(outcome: "accepted" | "dismissed", options: { needsGesture?: number } = {}): DeferredInstallPrompt & { calls: number } {
  let refusals = options.needsGesture ?? 0;
  const value = {
    calls: 0,
    async prompt() {
      value.calls += 1;
      if (refusals > 0) { refusals -= 1; throw new DOMException("user activation", "NotAllowedError"); }
    },
    userChoice: Promise.resolve({ outcome }),
  };
  return value;
}

test("web capability: the strongest real mechanism per browser, and an honest UNSUPPORTED elsewhere", () => {
  const capability = (userAgent: string, hasInstallPromptApi: boolean, maxTouchPoints: number, standalone = false) =>
    webInstallCapability({ ...fakeWeb().env, userAgent, hasInstallPromptApi, maxTouchPoints, standalone: () => standalone });
  assert.equal(capability(UA.androidChrome, true, 5).mechanism, "WEB_INSTALL_PROMPT");
  assert.equal(capability(UA.desktopChrome, true, 0).mechanism, "WEB_INSTALL_PROMPT");
  assert.equal(capability(UA.iphone, false, 5).mechanism, "WEB_ADD_TO_HOME_SCREEN");
  assert.equal(capability(UA.ipad, false, 5).mechanism, "WEB_ADD_TO_HOME_SCREEN", "iPadOS reports a Mac user agent");
  assert.equal(capability(UA.macSafari, false, 0).mechanism, "WEB_ADD_TO_DOCK");
  assert.deepEqual(capability(UA.firefox, false, 0), { platform: "WEB", mechanism: "NONE", supported: false, requiresUserConfirmation: false, reason: "BROWSER_HAS_NO_INSTALL_MECHANISM" });
  assert.equal(capability(UA.iphone, false, 5, true).reason, "IOS_STANDALONE_HAS_NO_SHARE_SHEET");
  assert.equal(webInstallCapability({ ...fakeWeb().env, hasServiceWorker: false }).supported, false);
  assert.equal(detectWebBrowser({ userAgent: UA.iphone, maxTouchPoints: 5, hasInstallPromptApi: false }), "IOS");
});

test("web install (Chromium): per-target manifest + icons, browser prompt, and an honest pending state", async () => {
  const request = launchEntryRequest(appInstallTarget(mybrandosView())!);
  const accepted = fakeWeb({ prompt: prompt("accepted") });
  assert.deepEqual(await accepted.adapter.createEntry(request), { status: "CREATED" });
  assert.deepEqual(accepted.resources.map((item) => item.path), [
    "/ox-install/app/bootstrap.mybrandos.public/manifest.webmanifest",
    "/ox-install/app/bootstrap.mybrandos.public/icon.svg",
    "/ox-install/app/bootstrap.mybrandos.public/icon-192.png",
    "/ox-install/app/bootstrap.mybrandos.public/icon-512.png",
  ]);
  const manifest = JSON.parse(String(accepted.resources[0]!.body)) as { name: string; start_url: string };
  assert.equal(manifest.name, "mybrandOS");
  assert.equal(manifest.start_url, "/?ox-launch=app%3Abootstrap.mybrandos.public");
  assert.ok(accepted.log.includes("manifest:/ox-install/app/bootstrap.mybrandos.public/manifest.webmanifest"));
  assert.equal(accepted.log.at(-3), "manifest:default", "OS Xperience's own manifest is restored afterwards");

  assert.deepEqual(await fakeWeb({ prompt: prompt("dismissed") }).adapter.createEntry(request), { status: "DISMISSED" });
  assert.deepEqual(await fakeWeb({ prompt: null }).adapter.createEntry(request), { status: "PENDING_CONFIRMATION", guidance: "BROWSER_MENU" });

  const gesture = prompt("accepted", { needsGesture: 1 });
  const needsTap = fakeWeb({ prompt: gesture });
  assert.deepEqual(await needsTap.adapter.createEntry(request), { status: "PENDING_CONFIRMATION", guidance: "BROWSER_PROMPT" });
  assert.deepEqual(await needsTap.adapter.confirmPending(), { status: "CREATED" });
  assert.equal(gesture.calls, 2);
  assert.deepEqual(await needsTap.adapter.confirmPending(), { status: "FAILED", reason: "NO_PENDING_PROMPT" });

  assert.deepEqual(await fakeWeb({ serviceWorkerControlled: async () => false }).adapter.createEntry(request), { status: "FAILED", reason: "SERVICE_WORKER_NOT_READY" });
  assert.deepEqual(await fakeWeb({ userAgent: UA.firefox, hasInstallPromptApi: false, maxTouchPoints: 0 }).adapter.createEntry(request), { status: "UNSUPPORTED", reason: "BROWSER_HAS_NO_INSTALL_MECHANISM" });
});

test("web install (iOS Safari): guided Add to Home Screen with the target's name, icon and launch URL", async () => {
  const ios = fakeWeb({ userAgent: UA.iphone, hasInstallPromptApi: false });
  const space = launchEntryRequest({ ...spaceInstallTarget(mybrandosView())!, name: "MrFundzMan" });
  assert.deepEqual(await ios.adapter.createEntry(space), { status: "PENDING_CONFIRMATION", guidance: "SHARE_ADD_TO_HOME_SCREEN" });
  assert.deepEqual(ios.log.slice(-3), [
    "manifest:/ox-install/space/bootstrap.mybrandos.public/manifest.webmanifest",
    "apple:MrFundzMan",
    "url:/?ox-launch=space%3Abootstrap.mybrandos.public",
  ]);
  assert.match(installResultMessage({ code: "INSTALLATION_PENDING_PLATFORM_CONFIRMATION", guidance: "SHARE_ADD_TO_HOME_SCREEN" }, "MrFundzMan"), /Share, then Add to Home Screen/);
  ios.adapter.reset();
  assert.deepEqual(ios.log.slice(-3), ["manifest:default", "apple:default", "url:restore"]);
});

test("web install through the orchestrator: APP pending then confirmed; SPACE still runs the frozen path first", async () => {
  const web = fakeWeb({ prompt: prompt("accepted") });
  const { steps, calls } = spaceSteps("READY");
  const app = await installTarget(appInstallTarget(mybrandosView())!, { adapter: web.adapter, space: steps });
  assert.equal(app.code, "INSTALLED");
  assert.equal(findInstalledTarget("APP", MYBRANDOS_PUBLIC_ID)?.platform, "WEB");
  const space = await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: fakeWeb({ prompt: prompt("accepted") }).adapter, space: steps });
  assert.equal(space.code, "INSTALLED");
  assert.deepEqual(calls, { register: 1, prepare: 1 });
  assert.ok(findSpaceHomeEntry(MYBRANDOS_PUBLIC_ID), "a web-installed Space resolves through the same V1 record");
  assert.equal(resolveInstalledSpace(MYBRANDOS_PUBLIC_ID, {}).kind, "RESOLVED");
});

/* ------------------------------------------------------------------ iOS adapter */

test("iOS native: INSTALL hands the target to Safari and records nothing it cannot prove", async () => {
  const opened: string[] = [];
  const ios = createIosInstallationAdapter({ runtimeOrigin: "https://xperience.getlifeos.app", openInSafari: (url) => void opened.push(url) });
  assert.equal((await ios.capability()).mechanism, "IOS_SAFARI_HANDOFF");
  const { steps, calls } = spaceSteps("READY");
  const result = await installTarget(spaceInstallTarget(mybrandosView())!, { adapter: ios, space: steps });
  assert.equal(result.code, "INSTALLATION_PENDING_PLATFORM_CONFIRMATION");
  assert.equal(result.guidance, "SAFARI");
  assert.deepEqual(opened, ["https://xperience.getlifeos.app/?ox-install=space%3Abootstrap.mybrandos.public"]);
  assert.deepEqual(calls, { register: 0, prepare: 0 }, "Safari's entry lives in the web runtime's storage, not this app's");
  assert.deepEqual(readInstalledTargets(), []);
  assert.equal(findSpaceHomeEntry(MYBRANDOS_PUBLIC_ID), null);
  assert.equal(webInstallUrl("http://insecure.example", "APP", APP_ID), null);
  const noOrigin = createIosInstallationAdapter({ runtimeOrigin: null, openInSafari: null });
  assert.equal((await installTarget(appInstallTarget(mybrandosView())!, { adapter: noOrigin, space: steps })).code, "UNSUPPORTED_PLATFORM");
});

test("Android entry results map to explicit install codes", async () => {
  const cases: [LaunchEntryResult, string][] = [
    [{ status: "CREATED" }, "INSTALLED"],
    [{ status: "ALREADY_PRESENT" }, "ALREADY_INSTALLED"],
    [{ status: "PENDING_CONFIRMATION", guidance: "LAUNCHER" }, "INSTALLATION_PENDING_PLATFORM_CONFIRMATION"],
    [{ status: "UNSUPPORTED", reason: "x" }, "UNSUPPORTED_PLATFORM"],
    [{ status: "FAILED", reason: "x" }, "LAUNCH_ENTRY_FAILED"],
  ];
  for (const [entry, code] of cases) {
    clearMemoryKvStore();
    const adapter: InstallationPlatformAdapter = {
      platform: "ANDROID",
      capability: async () => ({ platform: "ANDROID", mechanism: "ANDROID_PINNED_SHORTCUT", supported: true, requiresUserConfirmation: true }),
      createEntry: async () => entry,
      presentEntries: async () => null,
    };
    assert.equal((await installTarget(appInstallTarget(mybrandosView())!, { adapter, space: spaceSteps().steps })).code, code, entry.status);
  }
});
