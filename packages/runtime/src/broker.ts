import {
  PUBLIC_CAPABILITIES,
  classMayRequest,
  capabilityDescriptor,
  decisionFor,
  defaultAvailability,
  grantCapabilityFor,
  hasGrant,
  isForbiddenCapability,
  isShellCapability,
  isSimulationAllowed,
  leastPrivilegeDigitalLifeContext,
  outcomeOf,
  publicCapabilityId,
  resolveCapabilityName,
  simulateCapabilityResult,
  type AppClass,
  type AvailabilityMap,
  type CapabilityOutcome,
  type PermissionDecision,
  type PermissionGrant,
  type PublicCapability,
  type ShellCapability,
  type SimulationConfig,
} from "@osshell/contract";

export function mediateCapability(input: {
  appClass: AppClass;
  capability: string;
  origin: string;
  grants: readonly PermissionGrant[];
  decisions?: readonly PermissionDecision[];
  availability?: AvailabilityMap;
  grantedThisRequest?: boolean;
  appName?: string;
  /** DEVELOPMENT / SIMULATION ONLY. Ignored unless shellHostOrigin is localhost. */
  simulation?: SimulationConfig | null;
  shellHostOrigin?: string;
}): CapabilityOutcome | { status: "needs_permission"; capability: ShellCapability; origin: string } {
  const publicId = publicCapabilityId(input.capability) ?? resolveCapabilityName(input.capability);

  if (input.shellHostOrigin && isSimulationAllowed(input.shellHostOrigin, input.simulation)) {
    const simulatedId = (PUBLIC_CAPABILITIES as readonly string[]).includes(publicId)
      ? (publicId as PublicCapability)
      : publicCapabilityId(input.capability);
    const scenario = simulatedId ? input.simulation?.scenarios[simulatedId] : undefined;
    if (simulatedId && scenario) {
      const simulated = simulateCapabilityResult(simulatedId, scenario);
      if (simulated.status === "needs_permission") {
        const mapsTo = capabilityDescriptor(simulatedId)?.mapsTo;
        if (mapsTo && isShellCapability(mapsTo)) {
          return { status: "needs_permission", capability: mapsTo, origin: input.origin };
        }
        return outcomeOf({
          capability: simulatedId,
          status: "unavailable",
          reason: "capability_unavailable",
          detail: "DEVELOPMENT / SIMULATION ONLY. Simulated permission_required for a non-requestable capability.",
        });
      }
      return simulated;
    }
  }

  const descriptor = capabilityDescriptor(input.capability);

  if (input.appClass === "web") {
    return outcomeOf({
      capability: publicId,
      status: "class_a_blocked",
      reason: "class_a_blocked",
      detail: "Ordinary web apps receive no Digiconomy capabilities.",
    });
  }

  if (descriptor && !classMayRequest(input.appClass, descriptor)) {
    return outcomeOf({
      capability: descriptor.id,
      status: "denied",
      reason: "capability_denied",
      detail: "This application class may not request that capability. Native is not unlimited.",
    });
  }

  if (descriptor && !descriptor.requestable) {
    return outcomeOf({
      capability: descriptor.id,
      status: "unavailable",
      reason: descriptor.unavailableCode,
      detail:
        descriptor.id === "live"
          ? "Live stays in mybrandOS. The Shell does not start a broadcast."
          : "Device Bridge stays in mybrandOS Production Sessions. The Shell does not pair devices.",
    });
  }

  const resolved = descriptor?.mapsTo ?? resolveCapabilityName(input.capability);
  if (isForbiddenCapability(resolved) || !isShellCapability(resolved)) {
    return outcomeOf({
      capability: publicId,
      status: "denied",
      reason: "capability_denied",
      detail: "Unknown or forbidden capability. There is no allow_all grant.",
    });
  }

  if (resolved === "digitallife.context" && input.appClass !== "native") {
    return outcomeOf({
      capability: publicId,
      status: "denied",
      reason: "capability_denied",
      detail: "Digital Life context is only offered to origin-policy native apps.",
    });
  }

  const decision = decisionFor(input.decisions ?? [], input.origin, resolved);
  if (decision?.state === "DENIED") {
    return outcomeOf({
      capability: publicId,
      status: "denied",
      reason: "capability_denied",
      detail: "The user denied this capability for this application.",
    });
  }

  const granted = input.grantedThisRequest || hasGrant(input.grants, input.origin, resolved);
  if (!granted) {
    return { status: "needs_permission", capability: resolved, origin: input.origin };
  }

  const availability = (input.availability ?? defaultAvailability())[resolved];
  if (!availability.bound || availability.code !== "ok") {
    return outcomeOf({
      capability: publicId,
      status: "unavailable",
      reason: availability.code,
      scope: scopeFor(resolved),
      detail: availability.detail,
    });
  }

  const outcome = outcomeOf({
    capability: publicId,
    status: "granted",
    reason: "ok",
    scope: scopeFor(resolved),
    detail: grantDetail(resolved),
  });
  if (resolved === "digitallife.context") {
    outcome.context = leastPrivilegeDigitalLifeContext({
      origin: input.origin,
      name: input.appName ?? input.origin,
      class: input.appClass,
    });
    outcome.detail = "Least-privilege Digital Life context. No devices, balances, files, or owner session.";
  }
  return outcome;
}

function scopeFor(capability: ShellCapability): string | undefined {
  if (capability === "media.camera") return "origin-media";
  if (capability === "identity.public" || capability === "identity.authenticate") return "public-display-name";
  if (capability === "storage.read" || capability === "storage.write") return "explicit-items";
  if (capability === "commerce.checkout") return "checkout";
  if (capability === "digitallife.context") return "presence";
  return undefined;
}

function grantDetail(capability: ShellCapability): string {
  if (capability === "media.camera") return "Granted. The browser remains the camera owner. The Shell mediated permission only.";
  if (capability === "commerce.checkout") {
    return "Granted. FundzMan remains the payment owner. No balances or payment secrets were returned.";
  }
  if (capability === "identity.public" || capability === "identity.authenticate") {
    return "Granted. Trust ID remains the identity provider. No credentials or biometrics were returned.";
  }
  if (capability === "storage.read" || capability === "storage.write") {
    return "Granted for explicit items only. The Shell does not list Assets, files, or DataZone IDs.";
  }
  return "Granted. The Shell mediated the request; it did not implement the capability.";
}

export function grantTarget(capability: string): ShellCapability | null {
  return grantCapabilityFor(capability);
}

/** Status-only evaluation. Never opens a permission prompt. */
export function snapshotCapability(input: {
  appClass: AppClass;
  capability: string;
  origin: string;
  grants: readonly PermissionGrant[];
  decisions?: readonly PermissionDecision[];
  availability?: AvailabilityMap;
  appName?: string;
  simulation?: SimulationConfig | null;
  shellHostOrigin?: string;
}): CapabilityOutcome {
  const mediated = mediateCapability(input);
  if (mediated.status === "needs_permission") {
    return outcomeOf({
      capability: publicCapabilityId(input.capability) ?? resolveCapabilityName(input.capability),
      status: "denied",
      reason: "not_granted",
      detail: "No Shell grant is currently active. A status check does not open a permission prompt.",
    });
  }
  return mediated;
}
