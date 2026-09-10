import {
  activateLifecycle,
  appKindFromClass,
  closeLifecycle,
  confirmReady,
  disconnectLifecycle,
  getApplicationContext,
  lifecycleFor,
  nativeAppForOrigin,
  openLifecycle,
  rememberRequest,
  suspendLifecycle,
  type AppIdentity,
  type ApplicationContext,
  type AppLifecycle,
  type LifecycleRecord,
  type PermissionGrant,
} from "@osshell/contract";

export function applyOpen(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  return openLifecycle(records, origin);
}

export function applyReady(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  return confirmReady(records, origin);
}

export function applyActivate(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  return activateLifecycle(records, origin);
}

export function applyDisconnect(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  return disconnectLifecycle(records, origin);
}

export function applyClose(records: readonly LifecycleRecord[], origin: string): LifecycleRecord[] {
  return closeLifecycle(records, origin);
}

export function applySuspend(records: readonly LifecycleRecord[]): LifecycleRecord[] {
  return suspendLifecycle(records);
}

export function contextForSession(input: {
  identity: AppIdentity;
  grants: readonly PermissionGrant[];
  requested: readonly string[];
  records: readonly LifecycleRecord[];
  appId?: string | null;
}): ApplicationContext {
  return getApplicationContext({
    origin: input.identity.origin,
    name: input.identity.name,
    class: input.identity.effectiveClass,
    version: input.identity.version,
    kind: appKindFromClass(input.identity.effectiveClass),
    lifecycle: lifecycleFor(input.records, input.identity.origin),
    requested: input.requested,
    grants: input.grants,
    appId: input.appId ?? nativeAppForOrigin(input.identity.origin)?.id ?? null,
  });
}

export function markRequested(requested: readonly string[], capability: string): string[] {
  return rememberRequest(requested, capability);
}

export function activeOriginOf(records: readonly LifecycleRecord[]): string | null {
  return records.find((item) => item.lifecycle === "ACTIVE")?.origin ?? null;
}

export function isOpen(lifecycle: AppLifecycle): boolean {
  return lifecycle !== "CLOSED";
}
