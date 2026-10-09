import { findSpaceHomeEntry, recordSpaceHomeEntry, removeSpaceHomeEntry, spaceHomeEntryEligibility, spaceShortcutRequest } from "../local/space-home-entry.js";
import type { SpaceImportCode } from "../local/space-registry.js";
import { launchEntryRequest, type ConfirmationGuidance, type InstallationPlatformAdapter, type LaunchEntryResult } from "./platform.js";
import { findInstalledTarget, recordInstalledTarget, removeInstalledTarget } from "./registry.js";
import { validateInstallableTarget, type InstallableTarget, type SpaceInstallTarget } from "./target.js";

export type InstallResultCode =
  | "INSTALLED"
  | "ALREADY_INSTALLED"
  | "INSTALLATION_PENDING_PLATFORM_CONFIRMATION"
  | "UNSUPPORTED_PLATFORM"
  | "INVALID_TARGET"
  | "INSTALLATION_FAILED"
  | "SPACE_HYDRATION_FAILED"
  | "LAUNCH_ENTRY_FAILED";

export interface InstallResult {
  code: InstallResultCode;
  target?: InstallableTarget;
  /** Internal reason code — logged and tested, never shown verbatim. */
  reason?: string;
  guidance?: ConfirmationGuidance;
}

export type SpacePreparationOutcome = "READY" | "OFFLINE" | "NO_ROUTE" | "FAILED";

/**
 * The Space path reuses Space Installation V1 owners. These are the frozen operations, supplied by
 * the host: Space Launch File V1 verification/registration, and Offline Kernel preparation.
 */
export interface SpaceInstallationSteps {
  isRegistered(spaceId: string): boolean;
  /** Runs the V1 verifier over the build's signed artifact and registers it. */
  register(target: SpaceInstallTarget): Promise<{ ok: true } | { ok: false; code: SpaceImportCode | "ARTIFACT_UNAVAILABLE" }>;
  /** True when the Offline Kernel can run the Space from this installation right now. */
  locallyReady(target: SpaceInstallTarget): Promise<boolean>;
  prepare(target: SpaceInstallTarget): Promise<SpacePreparationOutcome>;
}

export interface InstallationDeps {
  adapter: InstallationPlatformAdapter | null;
  space: SpaceInstallationSteps;
  now?: () => Date;
}

/** Verifier refusals mean the target itself is not genuine; anything else is an installation failure. */
const SPACE_INVALID_CODES = new Set<string>([
  "LAUNCH_FILE_TOO_LARGE",
  "INVALID_FORMAT",
  "UNSUPPORTED_SCHEMA",
  "PUBLISHER_UNKNOWN",
  "INTEGRITY_FAILED",
  "SIGNATURE_INVALID",
  "IDENTITY_CONFLICT",
  "INCOMPATIBLE_XPERIENCE",
  "INCOMPATIBLE_RUNTIME",
  "PROVIDER_UNKNOWN",
  "DOWNGRADE_REJECTED",
]);

function entryOutcome(result: LaunchEntryResult): { code: InstallResultCode; confirmed: boolean; guidance?: ConfirmationGuidance; reason?: string } {
  switch (result.status) {
    case "CREATED":
      return { code: "INSTALLED", confirmed: true };
    case "ALREADY_PRESENT":
      return { code: "ALREADY_INSTALLED", confirmed: true };
    case "PENDING_CONFIRMATION":
      return { code: "INSTALLATION_PENDING_PLATFORM_CONFIRMATION", confirmed: false, guidance: result.guidance };
    case "DISMISSED":
      return { code: "INSTALLATION_FAILED", confirmed: false, reason: "USER_DISMISSED" };
    case "UNSUPPORTED":
      return { code: "UNSUPPORTED_PLATFORM", confirmed: false, reason: result.reason };
    case "FAILED":
      return { code: "LAUNCH_ENTRY_FAILED", confirmed: false, reason: result.reason };
  }
}

/**
 * InstallationOrchestrator — the single INSTALL entry point for OS Xperience Web, Android and iOS.
 *
 *   validate → APP | SPACE → platform adapter → launch entry → InstallResult
 *
 * APP records WHAT launches. SPACE first runs the frozen Space path (verify/register → prepare in
 * the Offline Kernel → Space Installation V1 home-entry record) and only then asks the platform
 * for an entry. No path authenticates, and no record or entry carries a credential.
 */
export async function installTarget(raw: unknown, deps: InstallationDeps): Promise<InstallResult> {
  const validation = validateInstallableTarget(raw);
  if (!validation.ok) return { code: "INVALID_TARGET", reason: validation.reason };
  const target = validation.target;
  const now = deps.now ?? (() => new Date());
  if (!deps.adapter) return { code: "UNSUPPORTED_PLATFORM", target, reason: "NO_ADAPTER" };
  const capability = await deps.adapter.capability().catch(() => null);
  if (!capability?.supported) return { code: "UNSUPPORTED_PLATFORM", target, reason: capability?.reason ?? "CAPABILITY_UNKNOWN" };

  // iOS native: the entry is created by Safari in the web runtime's own storage. Nothing is
  // registered, prepared or recorded here — that would claim an install this runtime does not have.
  if (capability.mechanism === "IOS_SAFARI_HANDOFF") {
    const outcome = entryOutcome(await deps.adapter.createEntry(launchEntryRequest(target)));
    return { code: outcome.code, target, ...(outcome.guidance ? { guidance: outcome.guidance } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) };
  }

  if (target.type === "SPACE") {
    const prepared = await prepareSpace(target, deps.space);
    if (prepared) return prepared;
  }

  const platform = deps.adapter.platform;
  const previous = findInstalledTarget(target.type, target.id);
  const hadSpaceRecord = target.type === "SPACE" && Boolean(findSpaceHomeEntry(target.id));
  let installed: InstallableTarget = target;
  if (target.type === "SPACE") {
    // Space Installation V1 resolves home entries through its own record; keep it authoritative.
    const eligibility = spaceHomeEntryEligibility({ id: target.id });
    if (!eligibility.eligible) return { code: "INVALID_TARGET", target, reason: eligibility.reason };
    recordSpaceHomeEntry(eligibility.presentation, now());
    // The entry is named by the presentation verified just now (signed launch file), not the pre-install guess.
    const { presentation } = eligibility;
    const { monogram, color } = spaceShortcutRequest({ spaceId: target.id, name: presentation.name });
    installed = { ...target, name: presentation.name, icon: { monogram, color }, ...(presentation.version ? { version: presentation.version } : {}), source: presentation.source };
  }

  let result: LaunchEntryResult;
  try {
    result = await deps.adapter.createEntry(launchEntryRequest(installed));
  } catch {
    result = { status: "FAILED", reason: "ADAPTER_THREW" };
  }
  const outcome = entryOutcome(result);
  const entryExists = outcome.code === "INSTALLED" || outcome.code === "ALREADY_INSTALLED" || outcome.code === "INSTALLATION_PENDING_PLATFORM_CONFIRMATION";
  if (!entryExists) {
    // Never leave a false installed state behind: undo only what this attempt added.
    if (!previous) removeInstalledTarget(target.type, target.id);
    if (target.type === "SPACE" && !hadSpaceRecord) removeSpaceHomeEntry(target.id);
    return { code: outcome.code, target: installed, ...(outcome.reason ? { reason: outcome.reason } : {}) };
  }
  recordInstalledTarget({
    type: installed.type,
    id: installed.id,
    label: installed.name,
    ...(installed.version ? { version: installed.version } : {}),
    platform,
    launchEntryState: outcome.confirmed || previous?.launchEntryState === "CONFIRMED" ? "CONFIRMED" : "PENDING_CONFIRMATION",
  }, now());
  return { code: outcome.code, target: installed, ...(outcome.guidance ? { guidance: outcome.guidance } : {}) };
}

async function prepareSpace(target: SpaceInstallTarget, steps: SpaceInstallationSteps): Promise<InstallResult | null> {
  if (!steps.isRegistered(target.id)) {
    if (!target.launchFile.bundledArtifact) return { code: "INVALID_TARGET", target, reason: "NO_VERIFIABLE_LAUNCH_FILE" };
    const registered = await steps.register(target).catch(() => ({ ok: false as const, code: "IMPORT_FAILED" as const }));
    // A concurrent import may already have registered it; the V1 registry is the authority.
    if (!registered.ok && !(registered.code === "ALREADY_INSTALLED" && steps.isRegistered(target.id))) {
      return { code: SPACE_INVALID_CODES.has(registered.code) ? "INVALID_TARGET" : "INSTALLATION_FAILED", target, reason: registered.code };
    }
  }
  if (await steps.locallyReady(target).catch(() => false)) return null;
  const outcome = await steps.prepare(target).catch(() => "FAILED" as const);
  if (outcome === "READY") return null;
  // Registered and kept: only the continuity resources are missing. Nothing remote is faked.
  return { code: "SPACE_HYDRATION_FAILED", target, reason: outcome };
}

/* ------------------------------------------------------------------ copy */

const GUIDANCE_COPY: Record<ConfirmationGuidance, (name: string) => string> = {
  LAUNCHER: (name) => `Confirm on your Home Screen to add ${name}.`,
  BROWSER_PROMPT: (name) => `Tap Install again to confirm ${name} in your browser.`,
  BROWSER_MENU: (name) => `Open your browser menu and choose Install app or Add to Home screen to finish adding ${name}.`,
  SHARE_ADD_TO_HOME_SCREEN: (name) => `Tap Share, then Add to Home Screen, to finish adding ${name}.`,
  ADD_TO_DOCK: (name) => `Choose File, then Add to Dock, to finish adding ${name}.`,
  SAFARI: (name) => `Continue in Safari: tap Share, then Add to Home Screen, to add ${name}.`,
};

/** Human copy. Internal codes stay internal; the person only ever reads plain language. */
export function installResultMessage(result: InstallResult, fallbackName = "This"): string {
  const name = result.target?.name ?? fallbackName;
  switch (result.code) {
    case "INSTALLED":
      return `${name} is installed. You'll find it on your Home Screen.`;
    case "ALREADY_INSTALLED":
      return `${name} is on your Home Screen.`;
    case "INSTALLATION_PENDING_PLATFORM_CONFIRMATION":
      return GUIDANCE_COPY[result.guidance ?? "LAUNCHER"](name);
    case "UNSUPPORTED_PLATFORM":
      return result.reason === "IOS_STANDALONE_HAS_NO_SHARE_SHEET"
        ? `Open OS Xperience in Safari to install ${name}.`
        : `Installing isn't available here yet.`;
    case "INVALID_TARGET":
      return `${name} can't be installed because it couldn't be verified.`;
    case "SPACE_HYDRATION_FAILED":
      if (result.reason === "OFFLINE") return `${name} needs a connection to finish installing. Connect and tap Install again.`;
      // Online but no broadcast route: a connection would not help, so don't ask for one.
      if (result.reason === "NO_ROUTE") return `${name} can't be installed yet. This device has no preparation route for it.`;
      return `${name} couldn't be prepared on this device. Try again while connected.`;
    case "LAUNCH_ENTRY_FAILED":
      return result.reason === "SERVICE_WORKER_NOT_READY"
        ? `${name} couldn't be added yet. Try again in a moment.`
        : `${name} couldn't be added to your Home Screen.`;
    case "INSTALLATION_FAILED":
      return result.reason === "USER_DISMISSED" ? `${name} wasn't installed. You can install it any time.` : `${name} couldn't be installed.`;
  }
}
