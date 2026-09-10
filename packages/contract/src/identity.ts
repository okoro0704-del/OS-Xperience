import type { AppManifest, ClassReason, EffectiveClass } from "./manifest.js";
import { isCompatibleOrigin, isNativeOrigin, nativeAppForOrigin, type OriginPolicy } from "./origin-policy.js";

export type AppClass = "web" | "compatible" | "native";

export interface AppIdentity {
  origin: string;
  href: string;
  name: string;
  version: string | null;
  declaredClass: EffectiveClass | null;
  effectiveClass: AppClass;
  classReason: ClassReason;
  nativeUnverified: boolean;
  embed: "deny" | "allow";
  requested: string[];
  publisher: string | null;
  manifestPresent: boolean;
}

export function resolveAppIdentity(input: {
  href: string;
  origin: string;
  manifest: AppManifest | null;
  policy: OriginPolicy;
}): AppIdentity {
  const native = isNativeOrigin(input.origin, input.policy);
  const compatible = isCompatibleOrigin(input.origin, input.policy);
  const manifest = input.manifest;

  if (!manifest) {
    const effectiveClass: AppClass = native ? "native" : compatible ? "compatible" : "web";
    return {
      origin: input.origin,
      href: input.href,
      name: native ? nativeName(input.origin) : publicAppLabel({ origin: input.origin, name: input.origin, effectiveClass, manifestPresent: false }),
      version: null,
      declaredClass: null,
      effectiveClass,
      classReason: native || compatible ? "origin_policy" : "ordinary",
      nativeUnverified: false,
      embed: "deny",
      requested: [],
      publisher: null,
      manifestPresent: false,
    };
  }

  const claimedNative = manifest.class === "native";
  const nativeUnverified = claimedNative && !native;
  const effectiveClass: AppClass = native
    ? "native"
    : compatible
      ? "compatible"
      : manifest.class === "web" && !nativeUnverified
        ? "web"
        : "compatible";

  return {
    origin: input.origin,
    href: input.href,
    name: manifest.name,
    version: manifest.version,
    declaredClass: manifest.class,
    effectiveClass,
    classReason: native ? "origin_policy" : nativeUnverified ? "native_unverified" : "manifest",
    nativeUnverified,
    embed: manifest.embed,
    requested: [...manifest.requested],
    publisher: manifest.publisher ?? null,
    manifestPresent: true,
  };
}

function nativeName(origin: string): string {
  return nativeAppForOrigin(origin)?.name ?? origin;
}

export function publicAppLabel(identity: { origin: string; name: string; effectiveClass: AppClass; manifestPresent: boolean }): string {
  if (identity.effectiveClass !== "web" || identity.manifestPresent) return identity.name;
  try {
    const host = new URL(identity.origin).hostname.replace(/^www\./, "");
    return host ? host.charAt(0).toUpperCase() + host.slice(1) : identity.origin;
  } catch {
    return identity.origin;
  }
}
