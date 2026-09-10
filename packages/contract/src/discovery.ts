import {
  CAPABILITY_REGISTRY,
  classMayRequest,
  type PublicCapability,
} from "./capability-registry.js";
import { defaultAvailability, type AvailabilityMap } from "./capabilities.js";
import type { AppClass } from "./identity.js";
import { decisionFor, type PermissionDecision } from "./permission-state.js";
import { hasGrant, type PermissionGrant } from "./permissions.js";

export type DiscoverableCapabilityStatus =
  | "available"
  | "permission_required"
  | "denied"
  | "unavailable"
  | "class_a_blocked"
  | "granted";

export interface OSShellCapabilityDescriptor {
  id: PublicCapability;
  status: DiscoverableCapabilityStatus;
  description: string;
  permissionRequired: boolean;
  requestable: boolean;
}

/**
 * Public capability discovery. Describes what an application may request.
 * Does not expose primitive internals, endpoints, or credentials.
 */
export function discoverCapabilities(input: {
  appClass: AppClass;
  origin: string;
  grants?: readonly PermissionGrant[];
  decisions?: readonly PermissionDecision[];
  availability?: AvailabilityMap;
}): OSShellCapabilityDescriptor[] {
  const availability = input.availability ?? defaultAvailability();
  const grants = input.grants ?? [];
  const decisions = input.decisions ?? [];

  return CAPABILITY_REGISTRY.map((descriptor) => {
    if (input.appClass === "web") {
      return {
        id: descriptor.id,
        status: "class_a_blocked",
        description: descriptor.description,
        permissionRequired: descriptor.permissionRequired,
        requestable: false,
      };
    }
    if (!classMayRequest(input.appClass, descriptor) || !descriptor.requestable) {
      return {
        id: descriptor.id,
        status: "unavailable",
        description: descriptor.description,
        permissionRequired: descriptor.permissionRequired,
        requestable: false,
      };
    }
    const mapped = descriptor.mapsTo;
    if (!mapped) {
      return {
        id: descriptor.id,
        status: "unavailable",
        description: descriptor.description,
        permissionRequired: false,
        requestable: false,
      };
    }
    const avail = availability[mapped];
    const decision = decisionFor(decisions, input.origin, mapped);
    if (decision?.state === "DENIED") {
      return {
        id: descriptor.id,
        status: "denied",
        description: descriptor.description,
        permissionRequired: true,
        requestable: true,
      };
    }
    if (hasGrant(grants, input.origin, mapped)) {
      if (!avail.bound || avail.code !== "ok") {
        return {
          id: descriptor.id,
          status: "unavailable",
          description: descriptor.description,
          permissionRequired: true,
          requestable: true,
        };
      }
      return {
        id: descriptor.id,
        status: "granted",
        description: descriptor.description,
        permissionRequired: true,
        requestable: true,
      };
    }
    if (!avail.bound || avail.code !== "ok") {
      return {
        id: descriptor.id,
        status: "unavailable",
        description: descriptor.description,
        permissionRequired: true,
        requestable: true,
      };
    }
    if (descriptor.permissionRequired) {
      return {
        id: descriptor.id,
        status: "permission_required",
        description: descriptor.description,
        permissionRequired: true,
        requestable: true,
      };
    }
    return {
      id: descriptor.id,
      status: "available",
      description: descriptor.description,
      permissionRequired: false,
      requestable: true,
    };
  });
}
