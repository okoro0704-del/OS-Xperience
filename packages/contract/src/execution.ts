export type CapabilityLayer = "policy" | "execution" | "infrastructure";

export type DomainExecutionStatus = "success" | "failed" | "not_authorized" | "released" | "handoff";

export interface CapabilityExecutionResult {
  capability: string;
  layer: "execution";
  started: boolean;
  status: DomainExecutionStatus;
  reason?: string;
  owner: "application";
}

export interface CameraCapture {
  getTracks(): Array<{ stop: () => void }>;
}

export interface ApplicationCapabilityContext {
  appId: string | null;
  origin: string;
  capability: string;
  status: string;
  scope?: string;
}

export function applicationCapabilityContext(input: {
  appId?: string | null;
  origin: string;
  capability: string;
  status: string;
  scope?: string;
}): ApplicationCapabilityContext {
  return {
    appId: input.appId ?? null,
    origin: input.origin,
    capability: input.capability,
    status: input.status,
    scope: input.scope,
  };
}

export function classifyFailure(code: string): CapabilityLayer {
  if (
    code === "capability_denied" ||
    code === "class_a_blocked" ||
    code === "not_granted" ||
    code === "application_disconnected"
  ) {
    return "policy";
  }
  if (
    code === "NotAllowedError" ||
    code === "NotFoundError" ||
    code === "NotReadableError" ||
    code === "OverconstrainedError" ||
    code === "SecurityError" ||
    code === "authentication_required"
  ) {
    return "execution";
  }
  return "infrastructure";
}

/**
 * Application-owned camera execution. The Shell never receives the capture.
 * `capture` is injected so OS Shell tests do not call the browser camera API.
 */
export async function executeCameraCapability(input: {
  policyStatus: string;
  capture: () => Promise<CameraCapture>;
}): Promise<{ execution: CapabilityExecutionResult; stream: CameraCapture | null }> {
  if (input.policyStatus !== "granted") {
    return {
      stream: null,
      execution: {
        capability: "camera",
        layer: "execution",
        started: false,
        status: "not_authorized",
        reason: input.policyStatus === "denied" || input.policyStatus === "capability_denied" ? "capability_denied" : input.policyStatus,
        owner: "application",
      },
    };
  }
  try {
    const stream = await input.capture();
    return {
      stream,
      execution: {
        capability: "camera",
        layer: "execution",
        started: true,
        status: "success",
        owner: "application",
      },
    };
  } catch (error) {
    return {
      stream: null,
      execution: {
        capability: "camera",
        layer: "execution",
        started: true,
        status: "failed",
        reason: translateBrowserCameraError(error),
        owner: "application",
      },
    };
  }
}

/**
 * Application-owned identity execution. Trust ID stays outside the Shell.
 * The injected `authenticate` must never return tokens or biometrics.
 * The Shell never receives or returns credential material.
 */
export async function executeIdentityCapability(input: {
  policyStatus: string;
  authenticate: () => Promise<{ status: "authentication_required" | "identity_unavailable" | "handoff"; reason?: string }>;
}): Promise<{ execution: CapabilityExecutionResult }> {
  if (input.policyStatus !== "granted") {
    return {
      execution: {
        capability: "identity",
        layer: "execution",
        started: false,
        status: "not_authorized",
        reason: input.policyStatus === "denied" || input.policyStatus === "capability_denied" ? "capability_denied" : input.policyStatus,
        owner: "application",
      },
    };
  }
  try {
    const result = await input.authenticate();
    return {
      execution: {
        capability: "identity",
        layer: "execution",
        started: true,
        status: result.status === "handoff" ? "handoff" : "failed",
        reason: result.reason ?? result.status,
        owner: "application",
      },
    };
  } catch {
    return {
      execution: {
        capability: "identity",
        layer: "execution",
        started: true,
        status: "failed",
        reason: "identity_unavailable",
        owner: "application",
      },
    };
  }
}

/**
 * Application-owned commerce execution. FundzMan stays outside the Shell.
 * The injected `checkout` must never return wallet keys or payment credentials.
 * The Shell never receives or returns financial secrets.
 */
export async function executeCommerceCapability(input: {
  policyStatus: string;
  checkout: () => Promise<{ status: "handoff" | "payments_unavailable"; reason?: string }>;
}): Promise<{ execution: CapabilityExecutionResult }> {
  if (input.policyStatus !== "granted") {
    return {
      execution: {
        capability: "commerce",
        layer: "execution",
        started: false,
        status: "not_authorized",
        reason: input.policyStatus === "denied" || input.policyStatus === "capability_denied" ? "capability_denied" : input.policyStatus,
        owner: "application",
      },
    };
  }
  try {
    const result = await input.checkout();
    return {
      execution: {
        capability: "commerce",
        layer: "execution",
        started: true,
        status: result.status === "handoff" ? "handoff" : "failed",
        reason: result.reason ?? result.status,
        owner: "application",
      },
    };
  } catch {
    return {
      execution: {
        capability: "commerce",
        layer: "execution",
        started: true,
        status: "failed",
        reason: "payments_unavailable",
        owner: "application",
      },
    };
  }
}

export function translateBrowserCameraError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "NotAllowedError";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "NotFoundError";
  if (name === "NotReadableError" || name === "TrackStartError") return "NotReadableError";
  if (name === "OverconstrainedError") return "OverconstrainedError";
  if (name === "SecurityError") return "SecurityError";
  return "camera_unavailable";
}

export function releaseCameraStream(stream: CameraCapture | null): CapabilityExecutionResult {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  return {
    capability: "camera",
    layer: "execution",
    started: false,
    status: "released",
    owner: "application",
  };
}

export function policyAllowsExecution(policyStatus: string): boolean {
  return policyStatus === "granted";
}
