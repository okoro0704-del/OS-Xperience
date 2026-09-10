import type { AppClass } from "./identity.js";
import { nativeAppForOrigin } from "./origin-policy.js";
import type { AppKind, AppLifecycle } from "./lifecycle.js";
import type { PermissionGrant } from "./permissions.js";
import { grantsForOrigin } from "./permissions.js";
import type { ShellCapability } from "./capabilities.js";
import { SHELL_CAPABILITIES } from "./capabilities.js";

export interface ApplicationContext {
  origin: string;
  name: string;
  class: AppClass;
  version: string | null;
  kind: AppKind;
  lifecycle: AppLifecycle;
  appId: string | null;
  requested: string[];
  granted: ShellCapability[];
  requestedCapabilities: string[];
  grantedCapabilities: ShellCapability[];
  permissions: PermissionGrant[];
}

export function getApplicationContext(input: {
  origin: string;
  name: string;
  class: AppClass;
  version: string | null;
  kind: AppKind;
  lifecycle: AppLifecycle;
  requested: readonly string[];
  grants: readonly PermissionGrant[];
  appId?: string | null;
}): ApplicationContext {
  const permissions = grantsForOrigin(input.grants, input.origin);
  const granted = SHELL_CAPABILITIES.filter((capability) => permissions.some((grant) => grant.capability === capability));
  return {
    origin: input.origin,
    name: input.name,
    class: input.class,
    version: input.version,
    kind: input.kind,
    lifecycle: input.lifecycle,
    appId: input.appId ?? nativeAppForOrigin(input.origin)?.id ?? null,
    requested: [...input.requested],
    granted,
    requestedCapabilities: [...input.requested],
    grantedCapabilities: granted,
    permissions,
  };
}

export function contextsAreIsolated(a: ApplicationContext, b: ApplicationContext): boolean {
  if (a.origin === b.origin) return true;
  const aOrigins = new Set(a.permissions.map((item) => item.origin));
  const bOrigins = new Set(b.permissions.map((item) => item.origin));
  return ![...aOrigins].some((origin) => origin === b.origin) && ![...bOrigins].some((origin) => origin === a.origin);
}
