import type { AppClass } from "./identity.js";
import type { AvailabilityMap } from "./capabilities.js";
import { defaultAvailability } from "./capabilities.js";
import type { PermissionGrant } from "./permissions.js";
import { grantIsActive, hasGrant } from "./permissions.js";
import { CAPABILITY_REGISTRY, type PublicCapability } from "./capability-registry.js";

export const CAPABILITY_PERMISSION_STATES = [
  "NOT_REQUESTED",
  "REQUESTED",
  "GRANTED",
  "DENIED",
  "REVOKED",
  "UNAVAILABLE",
  "NOT_CONNECTED",
  "BLOCKED",
  "REQUIRES_USER_ACTION",
] as const;

export type CapabilityPermissionState = (typeof CAPABILITY_PERMISSION_STATES)[number];

export type PermissionDecisionState = "DENIED" | "REVOKED";

export interface PermissionDecision {
  origin: string;
  capability: string;
  state: PermissionDecisionState;
  at: string;
}

export function decisionFor(
  decisions: readonly PermissionDecision[],
  origin: string,
  capability: string,
): PermissionDecision | null {
  return decisions.find((item) => item.origin === origin && item.capability === capability) ?? null;
}

export function upsertDecision(
  decisions: readonly PermissionDecision[],
  next: PermissionDecision,
): PermissionDecision[] {
  return [...decisions.filter((item) => !(item.origin === next.origin && item.capability === next.capability)), next];
}

export function clearDecision(
  decisions: readonly PermissionDecision[],
  origin: string,
  capability: string,
): PermissionDecision[] {
  return decisions.filter((item) => !(item.origin === origin && item.capability === capability));
}

export type PermissionCenterDisplay = "Granted" | "Denied" | "Revoked" | "Unavailable" | "Blocked" | "Available";

export interface PermissionCenterRow {
  capability: PublicCapability;
  label: string;
  status: CapabilityPermissionState;
  display: PermissionCenterDisplay;
  reason?: string;
  grantedAt?: string;
  revocable: boolean;
}

export function permissionCenterRows(input: {
  origin: string;
  appClass: AppClass;
  grants: readonly PermissionGrant[];
  requested: readonly string[];
  decisions?: readonly PermissionDecision[];
  availability?: AvailabilityMap;
}): PermissionCenterRow[] {
  const availability = input.availability ?? defaultAvailability();
  return CAPABILITY_REGISTRY.map((descriptor) => {
    if (input.appClass === "web") {
      return row(descriptor.id, "BLOCKED", "class_a_blocked");
    }
    const mapped = descriptor.mapsTo;
    const grant = mapped
      ? input.grants.find((item) => item.origin === input.origin && item.capability === mapped && grantIsActive(item))
      : undefined;
    const decision = decisionFor(input.decisions ?? [], input.origin, mapped ?? descriptor.id);
    const asked = mapped ? input.requested.includes(mapped) || input.requested.includes(descriptor.id) : input.requested.includes(descriptor.id);
    if (!descriptor.requestable) {
      return row(descriptor.id, "UNAVAILABLE", descriptor.unavailableCode);
    }
    if (mapped) {
      const avail = availability[mapped];
      if (grant) {
        return row(
          descriptor.id,
          "GRANTED",
          !avail.bound || avail.code !== "ok" ? avail.code : undefined,
          grant.issuedAt,
          true,
        );
      }
    }
    if (decision?.state === "DENIED") return row(descriptor.id, "DENIED");
    if (decision?.state === "REVOKED") return row(descriptor.id, "REVOKED");
    if (asked) return row(descriptor.id, "REQUESTED");
    return row(descriptor.id, "NOT_REQUESTED");
  });
}

export function grantedCapabilityNotes(input: {
  origin: string;
  grants: readonly PermissionGrant[];
}): string[] {
  return CAPABILITY_REGISTRY.filter((descriptor) => {
    if (!descriptor.mapsTo) return false;
    return hasGrant(input.grants, input.origin, descriptor.mapsTo);
  }).map((descriptor) => `${labelFor(descriptor.id)} permission granted`);
}

function displayFor(status: CapabilityPermissionState): PermissionCenterDisplay {
  if (status === "GRANTED") return "Granted";
  if (status === "DENIED") return "Denied";
  if (status === "REVOKED") return "Revoked";
  if (status === "UNAVAILABLE") return "Unavailable";
  if (status === "BLOCKED") return "Blocked";
  return "Available";
}

function row(
  capability: PublicCapability,
  status: CapabilityPermissionState,
  reason?: string,
  grantedAt?: string,
  revocable = false,
): PermissionCenterRow {
  return {
    capability,
    label: labelFor(capability),
    status,
    display: displayFor(status),
    reason,
    grantedAt,
    revocable,
  };
}

function labelFor(id: PublicCapability): string {
  if (id === "device_bridge") return "Device Bridge";
  if (id === "live") return "Live";
  return id.charAt(0).toUpperCase() + id.slice(1);
}
