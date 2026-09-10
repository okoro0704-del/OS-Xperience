import type { ShellCapability } from "@osshell/contract";

export interface PendingCapabilityRequest {
  origin: string;
  capability: ShellCapability;
  requestIds: string[];
}

export function coalesceCapabilityRequest(
  pending: readonly PendingCapabilityRequest[],
  origin: string,
  capability: ShellCapability,
  requestId: string,
): { pending: PendingCapabilityRequest[]; duplicate: boolean; item: PendingCapabilityRequest } {
  const existing = pending.find((item) => item.origin === origin && item.capability === capability);
  if (!existing) {
    const item = { origin, capability, requestIds: [requestId] };
    return { pending: [...pending, item], duplicate: false, item };
  }
  const requestIds = existing.requestIds.includes(requestId) ? existing.requestIds : [...existing.requestIds, requestId];
  const item = { ...existing, requestIds };
  return {
    pending: pending.map((entry) => (entry.origin === origin && entry.capability === capability ? item : entry)),
    duplicate: true,
    item,
  };
}

export function takePendingRequest(
  pending: readonly PendingCapabilityRequest[],
  origin: string,
  capability: ShellCapability,
): { pending: PendingCapabilityRequest[]; requestIds: string[] } {
  const item = pending.find((entry) => entry.origin === origin && entry.capability === capability);
  return {
    pending: pending.filter((entry) => !(entry.origin === origin && entry.capability === capability)),
    requestIds: item?.requestIds ?? [],
  };
}

export function cancelPendingForOrigin(
  pending: readonly PendingCapabilityRequest[],
  origin: string,
): { pending: PendingCapabilityRequest[]; cancelled: PendingCapabilityRequest[] } {
  return {
    pending: pending.filter((item) => item.origin !== origin),
    cancelled: pending.filter((item) => item.origin === origin),
  };
}

export function nextPrompt(pending: readonly PendingCapabilityRequest[]): PendingCapabilityRequest | null {
  return pending[0] ?? null;
}
