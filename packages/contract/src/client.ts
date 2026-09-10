import { envelope, postTargetIsSafe } from "./envelope.js";
import { createShellEnvironment } from "./environment.js";
import { SHELL_MESSAGE_VERSION } from "./version.js";

/** Development-only defaults. Production Shell / SDK must pass trustedShellOrigins explicitly. */
const IS_PRODUCTION_BUILD = typeof __OSSHELL_PRODUCTION__ !== "undefined" && __OSSHELL_PRODUCTION__;

export const DEFAULT_TRUSTED_SHELL_ORIGINS: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5180", "http://localhost:5180"];


export function trustedShellOriginsForMode(mode: "development" | "staging" | "production" = "development"): readonly string[] {
  const env = createShellEnvironment({ mode });
  return env.shellOrigins.length ? env.shellOrigins : mode === "development" ? DEFAULT_TRUSTED_SHELL_ORIGINS : [];
}

export function detectShellOrigin(
  ancestorOrigins: ArrayLike<string> | undefined,
  referrer: string,
  trusted: readonly string[] = DEFAULT_TRUSTED_SHELL_ORIGINS,
): string | null {
  const ancestor = ancestorOrigins && ancestorOrigins.length > 0 ? ancestorOrigins[0] : null;
  if (ancestor && trusted.includes(ancestor)) return ancestor;
  if (referrer) {
    try {
      const origin = new URL(referrer).origin;
      if (trusted.includes(origin)) return origin;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function applicationReadyMessage(input: { title: string; path: string; canGoBack: boolean; name?: string }) {
  return envelope("application.ready", input);
}

export function createAppClient(input: {
  parent: { postMessage: (message: unknown, targetOrigin: string) => void };
  self: Window;
  trustedShellOrigins?: readonly string[];
  getTitle: () => string;
  getPath: () => string;
  canGoBack: () => boolean;
  onBack?: () => void;
  onContext?: (context: unknown) => void;
  onCapabilityResult?: (result: unknown) => void;
  onCapabilityStatus?: (result: unknown) => void;
}) {
  const trusted = input.trustedShellOrigins ?? DEFAULT_TRUSTED_SHELL_ORIGINS;
  let shellOrigin: string | null = null;
  let requestCount = 0;

  function send(message: unknown) {
    if (!shellOrigin || !postTargetIsSafe(shellOrigin)) return;
    input.parent.postMessage(message, shellOrigin);
  }

  function ready() {
    send(applicationReadyMessage({ title: input.getTitle(), path: input.getPath(), canGoBack: input.canGoBack() }));
  }

  function navigation() {
    send(envelope("application.navigation", { path: input.getPath(), title: input.getTitle(), canGoBack: input.canGoBack() }));
    send(envelope("application.lifecycle", { path: input.getPath(), canGoBack: input.canGoBack() }));
    send(envelope("application.title", { title: input.getTitle() }));
  }

  function requestCapability(capability: string) {
    requestCount += 1;
    send(envelope("capability.request", { capability, requestId: `cap-${requestCount}` }));
  }

  function getCapabilityStatus(capability: string) {
    requestCount += 1;
    send(envelope("capability.status", { capability, requestId: `status-${requestCount}` }));
  }

  function reportExecution(capability: string, input: { started: boolean; result: string }) {
    send(
      envelope("capability.execution", {
        capability,
        executionStarted: input.started,
        executionResult: input.result,
      }),
    );
  }

  function attach(detect: { ancestorOrigins?: ArrayLike<string>; referrer: string }) {
    if (input.parent === input.self) return () => undefined;
    shellOrigin = detectShellOrigin(detect.ancestorOrigins, detect.referrer, trusted);
    if (!shellOrigin) return () => undefined;
    function onMessage(event: MessageEvent) {
      if (!shellOrigin || event.origin !== shellOrigin) return;
      const data = event.data as { channel?: string; version?: string; type?: string } | null;
      if (!data || data.channel !== "os-shell" || data.version !== SHELL_MESSAGE_VERSION) return;
      if (data.type === "application.back") input.onBack?.();
      if (data.type === "application.context" || data.type === "context.result") input.onContext?.(data);
      if (data.type === "capability.result" || data.type === "permission.result") input.onCapabilityResult?.(data);
      if (data.type === "capability.status.result") input.onCapabilityStatus?.(data);
    }
    input.self.addEventListener("message", onMessage);
    ready();
    navigation();
    return () => input.self.removeEventListener("message", onMessage);
  }

  return { attach, ready, navigation, send, requestCapability, getCapabilityStatus, reportExecution };
}
