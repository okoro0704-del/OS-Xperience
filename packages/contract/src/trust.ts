import { isNativeOrigin, type OriginPolicy } from "./origin-policy.js";
import type { AppClass } from "./identity.js";

/**
 * Lightweight application trust state.
 * Registration does not equal privilege. Verified ≠ unlimited.
 */
export const APPLICATION_TRUST_STATES = ["UNREGISTERED", "REGISTERED", "VERIFIED", "FIRST_PARTY"] as const;
export type ApplicationTrustState = (typeof APPLICATION_TRUST_STATES)[number];

export interface ApplicationTrustRecord {
  origin: string;
  state: Exclude<ApplicationTrustState, "UNREGISTERED" | "FIRST_PARTY">;
  appId?: string;
  name?: string;
}

/** Static local registry. Not a marketplace, installer, or billing system. */
export function defaultVerifiedOrigins(extra: readonly string[] = []): readonly string[] {
  return [...extra];
}

export function resolveApplicationTrust(input: {
  origin: string;
  appClass: AppClass;
  manifestPresent: boolean;
  policy?: OriginPolicy;
  verifiedOrigins?: readonly string[];
  registeredOrigins?: readonly string[];
}): ApplicationTrustState {
  if (isNativeOrigin(input.origin, input.policy)) return "FIRST_PARTY";
  if ((input.verifiedOrigins ?? []).includes(input.origin)) return "VERIFIED";
  if (input.manifestPresent || input.appClass === "compatible" || (input.registeredOrigins ?? []).includes(input.origin)) {
    return "REGISTERED";
  }
  return "UNREGISTERED";
}

export function trustDoesNotGrantPrivilege(trust: ApplicationTrustState): boolean {
  return trust === "UNREGISTERED" || trust === "REGISTERED" || trust === "VERIFIED" || trust === "FIRST_PARTY";
}
