import type { AppClass } from "./identity.js";
import { appKindFromClass, type AppKind } from "./lifecycle.js";
import { WELL_KNOWN_MANIFEST_PATH } from "./version.js";
import { DEFAULT_DEMO_ORIGINS, NATIVE_APP_DESCRIPTORS } from "./origin-policy.js";
import { allowedCapabilitiesForClass, type PublicCapability } from "./capability-registry.js";

/** Local identity/loading catalog. Not a marketplace, installer, or billing system. */
export interface ShellAppRecord {
  id: string;
  name: string;
  origin: string;
  class: AppClass;
  kind: AppKind;
  version: string | null;
  manifestPath: string;
  allowedCapabilities: readonly PublicCapability[];
  purpose?: string;
}

export function builtinAppRegistry(): ShellAppRecord[] {
  const natives = NATIVE_APP_DESCRIPTORS.map((app) => ({
    id: app.id,
    name: app.name,
    origin: app.origins[0]!,
    class: "native" as const,
    kind: "application" as const,
    version: null,
    manifestPath: WELL_KNOWN_MANIFEST_PATH,
    allowedCapabilities: allowedCapabilitiesForClass("native"),
    purpose: app.purpose,
  }));
  const demo: ShellAppRecord = {
    id: "shell-demo-notes",
    name: "Shell Demo Notes",
    origin: DEFAULT_DEMO_ORIGINS[0]!,
    class: "compatible",
    kind: "application",
    version: "1.5.0",
    manifestPath: WELL_KNOWN_MANIFEST_PATH,
    allowedCapabilities: allowedCapabilitiesForClass("compatible"),
    purpose: "External developer example. Uses the public Shell contract only.",
  };
  return [...natives, demo];
}

export function recordFromOpen(input: {
  origin: string;
  name: string;
  class: AppClass;
  href?: string;
  version?: string | null;
}): ShellAppRecord {
  return {
    id: input.origin,
    name: input.name,
    origin: input.origin,
    class: input.class,
    kind: appKindFromClass(input.class),
    version: input.version ?? null,
    manifestPath: WELL_KNOWN_MANIFEST_PATH,
    allowedCapabilities: allowedCapabilitiesForClass(input.class),
  };
}

export function mergeRegistry(builtin: readonly ShellAppRecord[], extras: readonly ShellAppRecord[]): ShellAppRecord[] {
  const byOrigin = new Map<string, ShellAppRecord>();
  for (const item of builtin) byOrigin.set(item.origin, item);
  for (const item of extras) {
    const existing = byOrigin.get(item.origin);
    if (existing?.class === "native") continue;
    byOrigin.set(item.origin, item);
  }
  return [...byOrigin.values()];
}
