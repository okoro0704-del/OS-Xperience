import {
  CAPABILITY_LABELS,
  SHELL_CAPABILITIES,
  defaultAvailability,
  isShellCapability,
  resolveCapabilityName,
  type AvailabilityMap,
  type ShellCapability,
} from "./capabilities.js";
import type { AppClass } from "./identity.js";
import { hasGrant, type PermissionGrant } from "./permissions.js";

export type CapabilitySurfaceState =
  | "available"
  | "granted"
  | "not_granted"
  | "not_requested"
  | "unavailable"
  | "class_a_blocked"
  | "owned_elsewhere";

export interface CapabilityStatusRow {
  id: string;
  label: string;
  state: CapabilitySurfaceState;
  code?: string;
  detail: string;
}

export const DOMAIN_STATUS_ROWS: CapabilityStatusRow[] = [
  {
    id: "devices",
    label: "Devices",
    state: "owned_elsewhere",
    code: "device_bridge_unavailable",
    detail: "Device Bridge is owned by mybrandOS Production Sessions. The Shell does not pair devices.",
  },
  {
    id: "live",
    label: "Live",
    state: "unavailable",
    code: "live_provider_unavailable",
    detail: "Live stays in mybrandOS. The Shell does not start a broadcast.",
  },
  {
    id: "production",
    label: "Production",
    state: "owned_elsewhere",
    code: "owned_by_mybrandos",
    detail: "Production Session is mybrandOS domain state. The Shell only launches mybrandOS.",
  },
];

export function capabilityStatusSurface(input: {
  appClass: AppClass;
  origin: string;
  requested: readonly string[];
  grants: readonly PermissionGrant[];
  availability?: AvailabilityMap;
}): CapabilityStatusRow[] {
  if (input.appClass === "web") {
    return [
      {
        id: "digiconomy",
        label: "Digiconomy capabilities",
        state: "class_a_blocked",
        detail: "No Digiconomy capabilities. Ordinary web apps run normally.",
      },
      ...DOMAIN_STATUS_ROWS,
    ];
  }
  const availability = input.availability ?? defaultAvailability();
  const rows = SHELL_CAPABILITIES.map((capability) =>
    rowForCapability(capability, input.origin, input.requested, input.grants, availability),
  );
  return [...collapseByLabel(rows), ...DOMAIN_STATUS_ROWS];
}

function collapseByLabel(rows: CapabilityStatusRow[]): CapabilityStatusRow[] {
  const rank: Record<CapabilitySurfaceState, number> = {
    unavailable: 0,
    class_a_blocked: 1,
    owned_elsewhere: 2,
    not_granted: 3,
    granted: 4,
    available: 5,
    not_requested: 6,
  };
  const byLabel = new Map<string, CapabilityStatusRow>();
  for (const row of rows) {
    const current = byLabel.get(row.label);
    if (!current || rank[row.state] < rank[current.state]) byLabel.set(row.label, row);
  }
  return [...byLabel.values()];
}

function rowForCapability(
  capability: ShellCapability,
  origin: string,
  requested: readonly string[],
  grants: readonly PermissionGrant[],
  availability: AvailabilityMap,
): CapabilityStatusRow {
  const avail = availability[capability];
  const granted = hasGrant(grants, origin, capability);
  const asked = requested.includes(capability);
  if (!avail.bound || avail.code !== "ok") {
    return {
      id: capability,
      label: surfaceLabel(capability),
      state: "unavailable",
      code: avail.code,
      detail: granted ? `${avail.detail} A grant exists, but the provider is not ready.` : avail.detail,
    };
  }
  if (granted) {
    return {
      id: capability,
      label: surfaceLabel(capability),
      state: "granted",
      code: "ok",
      detail: "Allowed for this origin only.",
    };
  }
  if (asked) {
    return {
      id: capability,
      label: surfaceLabel(capability),
      state: "not_granted",
      detail: "Requested. The user has not granted this origin.",
    };
  }
  return {
    id: capability,
    label: surfaceLabel(capability),
    state: "not_requested",
    detail: "This origin has not asked for this capability.",
  };
}

function surfaceLabel(capability: ShellCapability): string {
  if (capability === "identity.authenticate" || capability === "identity.public") return "Identity";
  if (capability === "storage.read" || capability === "storage.write") return "Assets";
  if (capability.startsWith("media.camera")) return "Camera";
  if (capability.startsWith("media.microphone")) return "Microphone";
  if (capability.startsWith("media.screen")) return "Screen";
  if (capability.startsWith("commerce.")) return "Commerce";
  if (capability === "digitallife.context") return "Digital Life";
  return CAPABILITY_LABELS[capability];
}

export function rememberRequest(requested: readonly string[], capability: string): string[] {
  const resolved = resolveCapabilityName(capability);
  if (!isShellCapability(resolved) || requested.includes(resolved)) return [...requested];
  return [...requested, resolved];
}
