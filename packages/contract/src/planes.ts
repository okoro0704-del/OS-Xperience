import { INCOMING_MESSAGE_TYPES, jsonLeaksCapabilityHandles } from "./envelope.js";
import { jsonLeaksSecrets } from "./permissions.js";

/** Shell control plane. Policy, lifecycle, navigation, session continuity, and context only. */
export const CONTROL_PLANE_CONCERNS = [
  "identity-class",
  "permissions",
  "capability-requests",
  "lifecycle",
  "navigation",
  "application-context",
  "operating-session",
  "policy",
] as const;

/** Application/domain data plane. Never transported by the Shell. */
export const DATA_PLANE_CONCERNS = [
  "camera-frames",
  "files",
  "media",
  "payments",
  "messages",
  "assets",
  "projects",
  "production-streams",
] as const;

export const CONTROL_PLANE_MESSAGE_TYPES = INCOMING_MESSAGE_TYPES;

export function isControlPlaneMessage(type: string): boolean {
  return (CONTROL_PLANE_MESSAGE_TYPES as readonly string[]).includes(type) ||
    type === "capability.result" ||
    type === "capability.status.result" ||
    type === "permission.result" ||
    type === "application.context" ||
    type === "application.back" ||
    type === "application.lifecycle" ||
    type === "context.result";
}

export function payloadStaysOnControlPlane(value: unknown): boolean {
  return !jsonLeaksSecrets(value) && !jsonLeaksCapabilityHandles(value);
}
