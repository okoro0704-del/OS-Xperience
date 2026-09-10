export const SHELL_CAPABILITIES = [
  "identity.authenticate",
  "identity.public",
  "storage.read",
  "storage.write",
  "messaging.notify",
  "messaging.inbox.open",
  "jobs.dispatch",
  "commerce.checkout",
  "deploy.request",
  "media.camera",
  "media.microphone",
  "media.screen",
  "digitallife.context",
] as const;

export type ShellCapability = (typeof SHELL_CAPABILITIES)[number];

export const FORBIDDEN_CAPABILITY_IDS = ["super_app", "allow_all", "trusted_everything"] as const;

export const FORBIDDEN_CAPABILITY_PREFIXES = ["production.", "live.", "device.bridge."] as const;

export type UnavailableCode =
  | "TRUST_ID_UNAVAILABLE"
  | "DATAZONE_UNAVAILABLE"
  | "ELFCOM_UNAVAILABLE"
  | "PLATFORM_JOBS_UNAVAILABLE"
  | "MASTER_DISTRIBUTOR_UNAVAILABLE"
  | "FUNDZMAN_UNAVAILABLE"
  | "payments_unavailable"
  | "messaging_unavailable"
  | "camera_unavailable"
  | "microphone_unavailable"
  | "screen_capture_unavailable"
  | "live_provider_unavailable"
  | "device_bridge_unavailable";

export type CapabilityAvailability = {
  bound: boolean;
  code: UnavailableCode | "ok";
  detail: string;
};

export type AvailabilityMap = Record<ShellCapability, CapabilityAvailability>;

export const CAPABILITY_ALIASES: Record<string, ShellCapability | "device_bridge" | "live"> = {
  camera: "media.camera",
  microphone: "media.microphone",
  screen: "media.screen",
  identity: "identity.public",
  assets: "storage.read",
  commerce: "commerce.checkout",
  device_bridge: "device_bridge",
  devices: "device_bridge",
  live: "live",
};

export function resolveCapabilityName(value: string): string {
  const trimmed = value.trim();
  return CAPABILITY_ALIASES[trimmed] ?? trimmed;
}

export function isShellCapability(value: string): value is ShellCapability {
  return (SHELL_CAPABILITIES as readonly string[]).includes(value);
}

export function isForbiddenCapability(value: string): boolean {
  if ((FORBIDDEN_CAPABILITY_IDS as readonly string[]).includes(value)) return true;
  return FORBIDDEN_CAPABILITY_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function defaultAvailability(): AvailabilityMap {
  const unbound = (code: UnavailableCode, detail: string): CapabilityAvailability => ({
    bound: false,
    code,
    detail,
  });
  return {
    "identity.authenticate": {
      bound: true,
      code: "ok",
      detail: "Trust ID is the application execution path. Granted does not mean authenticated.",
    },
    "identity.public": {
      bound: true,
      code: "ok",
      detail: "Trust ID is the application execution path. Granted does not mean authenticated.",
    },
    "storage.read": {
      bound: true,
      code: "ok",
      detail: "The application owns Asset access. The Shell does not list files or DataZone IDs.",
    },
    "storage.write": {
      bound: true,
      code: "ok",
      detail: "The application owns Asset writes. The Shell does not store files.",
    },
    "messaging.notify": unbound("messaging_unavailable", "ElfCom is not bound."),
    "messaging.inbox.open": unbound("ELFCOM_UNAVAILABLE", "ElfCom is not bound."),
    "jobs.dispatch": unbound("PLATFORM_JOBS_UNAVAILABLE", "Platform Jobs is not bound. Work was not queued locally."),
    "commerce.checkout": {
      bound: true,
      code: "ok",
      detail: "FundzMan is the application execution path. Granted does not mean paid.",
    },
    "deploy.request": unbound("MASTER_DISTRIBUTOR_UNAVAILABLE", "Master Distributor is not bound."),
    "media.camera": {
      bound: true,
      code: "ok",
      detail: "Browser camera API is the application execution path. The Shell does not own the stream.",
    },
    "media.microphone": unbound("microphone_unavailable", "No device has reported a ready microphone to this origin."),
    "media.screen": unbound("screen_capture_unavailable", "Screen capture has not been reported ready."),
    "digitallife.context": { bound: true, code: "ok", detail: "Least-privilege context only. Empty until the user authorizes specific items." },
  };
}

export const CAPABILITY_LABELS: Record<ShellCapability, string> = {
  "identity.authenticate": "Start Trust ID sign-in for this app",
  "identity.public": "Read your public display name",
  "storage.read": "Read specific Sovereign Drive files you authorize",
  "storage.write": "Write specific Sovereign Drive files you authorize",
  "messaging.notify": "Send a notification through ElfCom",
  "messaging.inbox.open": "Open your ElfCom inbox",
  "jobs.dispatch": "Ask Platform Jobs to run background work",
  "commerce.checkout": "Start a FundzMan checkout",
  "deploy.request": "Request a Master Distributor deploy",
  "media.camera": "Use this origin's camera (browser prompt)",
  "media.microphone": "Use this origin's microphone (browser prompt)",
  "media.screen": "Use this origin's screen capture (browser prompt)",
  "digitallife.context": "Read a narrow Digital Life context you authorize",
};
