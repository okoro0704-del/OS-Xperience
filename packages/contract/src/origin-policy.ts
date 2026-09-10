import { originOf } from "./url.js";
import {
  createShellEnvironment,
  type ShellEnvironmentConfig,
} from "./environment.js";

/** Development-only defaults. Production must supply origins via ShellEnvironmentConfig. */
const IS_PRODUCTION_BUILD = typeof __OSSHELL_PRODUCTION__ !== "undefined" && __OSSHELL_PRODUCTION__;

export const DEFAULT_MYBRANDOS_ORIGINS: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5176", "http://localhost:5176"];
export const DEFAULT_LIFEOS_ORIGINS: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5174", "http://localhost:5174"];
/** Local external developer demo. Compatible, not native. */
export const DEFAULT_DEMO_ORIGINS: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5185", "http://localhost:5185"];


export interface NativeAppDescriptor {
  id: "mybrandos" | "lifeos";
  name: string;
  purpose: string;
  origins: readonly string[];
}

export function nativeAppDescriptorsFor(env: ShellEnvironmentConfig): readonly NativeAppDescriptor[] {
  const mybrand =
    env.mybrandosOrigins.length > 0
      ? env.mybrandosOrigins
      : env.allowDevelopmentFeatures
        ? DEFAULT_MYBRANDOS_ORIGINS
        : [];
  const lifeos =
    env.lifeosOrigins.length > 0
      ? env.lifeosOrigins
      : env.allowDevelopmentFeatures
        ? DEFAULT_LIFEOS_ORIGINS
        : [];
  return [
    {
      id: "mybrandos",
      name: "mybrandOS",
      purpose: "Creator Digital Life workstation. Production, Device Bridge, and Live stay inside mybrandOS.",
      origins: mybrand,
    },
    {
      id: "lifeos",
      name: "LifeOS",
      purpose: "Consumer Digital Life gateway. Vertical OS embedding stays inside LifeOS.",
      origins: lifeos,
    },
  ];
}

/** Development catalog descriptors. Prefer nativeAppDescriptorsFor(env) in Shell UI. */
export const NATIVE_APP_DESCRIPTORS: readonly NativeAppDescriptor[] = nativeAppDescriptorsFor(
  createShellEnvironment({ mode: "development" }),
);

export interface OriginPolicy {
  nativeOrigins: readonly string[];
  compatibleOrigins?: readonly string[];
}

export function originPolicyFromEnvironment(
  env: ShellEnvironmentConfig,
  extra: readonly string[] = [],
  extraCompatible: readonly string[] = [],
): OriginPolicy {
  const descriptors = nativeAppDescriptorsFor(env);
  return {
    nativeOrigins: [
      ...descriptors.flatMap((item) => item.origins),
      ...extra.filter((item) => Boolean(originOf(item))),
    ],
    compatibleOrigins: [
      ...env.compatibleOrigins,
      ...extraCompatible.filter((item) => Boolean(originOf(item))),
    ],
  };
}

/** Defaults to development policy for tests and local tooling. Production Shell must pass env. */
export function defaultOriginPolicy(extra: readonly string[] = [], extraCompatible: readonly string[] = []): OriginPolicy {
  return originPolicyFromEnvironment(createShellEnvironment({ mode: "development" }), extra, extraCompatible);
}

export function isNativeOrigin(origin: string, policy: OriginPolicy = defaultOriginPolicy()): boolean {
  return policy.nativeOrigins.includes(origin);
}

export function isCompatibleOrigin(origin: string, policy: OriginPolicy = defaultOriginPolicy()): boolean {
  return (policy.compatibleOrigins ?? []).includes(origin);
}

export function nativeAppForOrigin(
  origin: string,
  env: ShellEnvironmentConfig = createShellEnvironment({ mode: "development" }),
): NativeAppDescriptor | null {
  return nativeAppDescriptorsFor(env).find((app) => app.origins.includes(origin)) ?? null;
}
