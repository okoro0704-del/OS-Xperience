import type { AppClass } from "./identity.js";
import type { ShellCapability, UnavailableCode } from "./capabilities.js";
import { resolveCapabilityName } from "./capabilities.js";

export const PUBLIC_CAPABILITIES = ["identity", "assets", "camera", "commerce", "device_bridge", "live"] as const;
export type PublicCapability = (typeof PUBLIC_CAPABILITIES)[number];

export type CapabilityAvailabilitySource =
  | "trust-id"
  | "sovereign-drive"
  | "browser-media"
  | "fundzman"
  | "mybrandos"
  | "none";

export type CapabilityPolicyOwner = "shell";
export type CapabilityExecutionOwner = "application" | "mybrandos";
export type CapabilityInfrastructureOwner =
  | "browser"
  | "trust-id"
  | "sovereign-drive"
  | "fundzman"
  | "mybrandos";

export interface CapabilityDescriptor {
  id: PublicCapability;
  description: string;
  allowedClasses: readonly AppClass[];
  policyOwner: CapabilityPolicyOwner;
  executionOwner: CapabilityExecutionOwner;
  infrastructureOwner: CapabilityInfrastructureOwner;
  requestable: boolean;
  availabilitySource: CapabilityAvailabilitySource;
  permissionRequired: boolean;
  mapsTo: ShellCapability | null;
  ownedBy: string;
  unavailableCode: UnavailableCode;
}

export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = [
  {
    id: "identity",
    description: "Authorization to initiate Trust ID. Granted does not mean authenticated. No tokens or biometrics.",
    allowedClasses: ["compatible", "native"],
    policyOwner: "shell",
    executionOwner: "application",
    infrastructureOwner: "trust-id",
    requestable: true,
    availabilitySource: "trust-id",
    permissionRequired: true,
    mapsTo: "identity.public",
    ownedBy: "trust-id",
    unavailableCode: "TRUST_ID_UNAVAILABLE",
  },
  {
    id: "assets",
    description: "Authorization to ask the application for least-privilege files. Not a Universal Asset API.",
    allowedClasses: ["native"],
    policyOwner: "shell",
    executionOwner: "application",
    infrastructureOwner: "sovereign-drive",
    requestable: true,
    availabilitySource: "sovereign-drive",
    permissionRequired: true,
    mapsTo: "storage.read",
    ownedBy: "application / sovereign-drive",
    unavailableCode: "DATAZONE_UNAVAILABLE",
  },
  {
    id: "camera",
    description: "Authorization to use the browser camera for this origin. The Shell is not the camera owner.",
    allowedClasses: ["compatible", "native"],
    policyOwner: "shell",
    executionOwner: "application",
    infrastructureOwner: "browser",
    requestable: true,
    availabilitySource: "browser-media",
    permissionRequired: true,
    mapsTo: "media.camera",
    ownedBy: "browser / application",
    unavailableCode: "camera_unavailable",
  },
  {
    id: "commerce",
    description: "Authorization to start an application checkout. FundzMan remains the money boundary.",
    allowedClasses: ["compatible", "native"],
    policyOwner: "shell",
    executionOwner: "application",
    infrastructureOwner: "fundzman",
    requestable: true,
    availabilitySource: "fundzman",
    permissionRequired: true,
    mapsTo: "commerce.checkout",
    ownedBy: "fundzman",
    unavailableCode: "payments_unavailable",
  },
  {
    id: "device_bridge",
    description: "Policy only. Device Bridge pairing and capture stay in mybrandOS.",
    allowedClasses: ["native"],
    policyOwner: "shell",
    executionOwner: "mybrandos",
    infrastructureOwner: "mybrandos",
    requestable: false,
    availabilitySource: "mybrandos",
    permissionRequired: false,
    mapsTo: null,
    ownedBy: "mybrandOS",
    unavailableCode: "device_bridge_unavailable",
  },
  {
    id: "live",
    description: "Policy only. Live destinations and stream keys stay in mybrandOS.",
    allowedClasses: ["native"],
    policyOwner: "shell",
    executionOwner: "mybrandos",
    infrastructureOwner: "mybrandos",
    requestable: false,
    availabilitySource: "mybrandos",
    permissionRequired: false,
    mapsTo: null,
    ownedBy: "mybrandOS",
    unavailableCode: "live_provider_unavailable",
  },
];

export function capabilityDescriptor(id: string): CapabilityDescriptor | null {
  const resolved = resolveCapabilityName(id);
  return (
    CAPABILITY_REGISTRY.find((item) => item.id === id || item.id === resolved || item.mapsTo === resolved) ?? null
  );
}

export function publicCapabilityId(value: string): PublicCapability | null {
  return capabilityDescriptor(value)?.id ?? null;
}

export function grantCapabilityFor(value: string): ShellCapability | null {
  return capabilityDescriptor(value)?.mapsTo ?? null;
}

export function classMayRequest(appClass: AppClass, descriptor: CapabilityDescriptor): boolean {
  return descriptor.allowedClasses.includes(appClass);
}

export function allowedCapabilitiesForClass(appClass: AppClass): PublicCapability[] {
  return CAPABILITY_REGISTRY.filter((item) => item.allowedClasses.includes(appClass) && item.requestable).map((item) => item.id);
}

export function capabilityOwnership(id: string): {
  capability: string;
  policyOwner: CapabilityPolicyOwner;
  executionOwner: CapabilityExecutionOwner;
  infrastructureOwner: CapabilityInfrastructureOwner;
} | null {
  const descriptor = capabilityDescriptor(id);
  if (!descriptor) return null;
  return {
    capability: descriptor.id,
    policyOwner: descriptor.policyOwner,
    executionOwner: descriptor.executionOwner,
    infrastructureOwner: descriptor.infrastructureOwner,
  };
}
