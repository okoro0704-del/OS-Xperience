import type { DigitalLifeContext } from "./context.js";

export type CapabilityOutcomeStatus = "granted" | "denied" | "unavailable" | "class_a_blocked";

export interface CapabilityOutcome {
  capability: string;
  status: CapabilityOutcomeStatus;
  reason?: string;
  scope?: string;
  expiresAt?: string;
  code?: string;
  detail: string;
  context?: DigitalLifeContext;
}

export function toCapabilityResult(outcome: CapabilityOutcome): {
  capability: string;
  status: CapabilityOutcomeStatus;
  reason?: string;
  scope?: string;
  expiresAt?: string;
} {
  return {
    capability: outcome.capability,
    status: outcome.status,
    reason: outcome.reason ?? outcome.code,
    scope: outcome.scope,
    expiresAt: outcome.expiresAt,
  };
}

export function outcomeOf(input: {
  capability: string;
  status: CapabilityOutcomeStatus;
  reason?: string;
  detail: string;
  scope?: string;
  expiresAt?: string;
  context?: DigitalLifeContext;
}): CapabilityOutcome {
  return {
    capability: input.capability,
    status: input.status,
    reason: input.reason,
    scope: input.scope,
    expiresAt: input.expiresAt,
    code: input.reason,
    detail: input.detail,
    context: input.context,
  };
}
