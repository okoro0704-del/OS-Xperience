/**
 * Production environment configuration (release hardening).
 * Development defaults stay localhost; production never falls back to them.
 * Shell mode is a build/runtime boundary — not a new feature plane.
 */
import { originOf } from "./url.js";

export const SHELL_ENV_MODES = ["development", "staging", "production"] as const;
export type ShellEnvMode = (typeof SHELL_ENV_MODES)[number];

export interface ShellEnvironmentConfig {
  mode: ShellEnvMode;
  shellOrigins: readonly string[];
  mybrandosOrigins: readonly string[];
  lifeosOrigins: readonly string[];
  /** Compatible third-party / demo origins. Empty in production by default. */
  compatibleOrigins: readonly string[];
  /** When false, simulation and localhost trust shortcuts are impossible. */
  allowDevelopmentFeatures: boolean;
  /** When true, HTTP localhost origins are rejected for native trust. */
  requireHttpsOrigins: boolean;
}

/** Vite production builds tree-shake these away so localhost never ships. */
const IS_PRODUCTION_BUILD = typeof __OSSHELL_PRODUCTION__ !== "undefined" && __OSSHELL_PRODUCTION__;

const DEV_SHELL: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5180", "http://localhost:5180"];
const DEV_MYBRAND: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5176", "http://localhost:5176"];
const DEV_LIFEOS: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5174", "http://localhost:5174"];
const DEV_DEMO: readonly string[] = IS_PRODUCTION_BUILD
  ? []
  : ["http://127.0.0.1:5185", "http://localhost:5185"];


function splitOrigins(value: string | undefined | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => Boolean(originOf(item)));
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Capacitor Android (androidScheme: https) hosts the Shell at https://localhost — allowed in production. */
function isCapacitorShellOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === "capacitor:") return true;
    return url.protocol === "https:" && url.hostname === "localhost";
  } catch {
    return false;
  }
}

function assertNoLoopbackInProduction(mode: ShellEnvMode, origins: readonly string[], label: string): void {
  if (mode === "development") return;
  for (const origin of origins) {
    if (isLoopbackOrigin(origin) && !isCapacitorShellOrigin(origin)) {
      throw new Error(`Production/staging ${label} must not include loopback origin: ${origin}`);
    }
  }
}

export function resolveShellEnvMode(raw?: string | null): ShellEnvMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "production" || value === "prod") return "production";
  if (value === "staging" || value === "stage") return "staging";
  if (value === "development" || value === "dev") return "development";
  return "development";
}

/**
 * Build environment config from explicit values / Vite env.
 * Production requires HTTPS first-party origins and forbids localhost.
 */
export function createShellEnvironment(input?: {
  mode?: string | null;
  shellOrigins?: string | readonly string[] | null;
  mybrandosOrigins?: string | readonly string[] | null;
  lifeosOrigins?: string | readonly string[] | null;
  compatibleOrigins?: string | readonly string[] | null;
}): ShellEnvironmentConfig {
  const mode = resolveShellEnvMode(input?.mode);
  const asList = (value: string | readonly string[] | null | undefined, fallback: readonly string[]): string[] => {
    if (Array.isArray(value)) return value.filter((item) => Boolean(originOf(item)));
    if (typeof value === "string") {
      const parsed = splitOrigins(value);
      return parsed.length ? parsed : mode === "development" ? [...fallback] : [];
    }
    return mode === "development" ? [...fallback] : [];
  };

  const shellOrigins = asList(input?.shellOrigins, DEV_SHELL);
  const mybrandosOrigins = asList(input?.mybrandosOrigins, DEV_MYBRAND);
  const lifeosOrigins = asList(input?.lifeosOrigins, DEV_LIFEOS);
  const compatibleOrigins = asList(input?.compatibleOrigins, DEV_DEMO);

  if (mode !== "development") {
    assertNoLoopbackInProduction(mode, shellOrigins, "shellOrigins");
    assertNoLoopbackInProduction(mode, mybrandosOrigins, "mybrandosOrigins");
    assertNoLoopbackInProduction(mode, lifeosOrigins, "lifeosOrigins");
    assertNoLoopbackInProduction(mode, compatibleOrigins, "compatibleOrigins");
    for (const origin of [...shellOrigins, ...mybrandosOrigins, ...lifeosOrigins]) {
      const ok =
        origin.startsWith("https://") ||
        origin === "capacitor://localhost" ||
        origin.startsWith("capacitor://");
      if (!ok) {
        throw new Error(`Production first-party origin must be https or Capacitor: ${origin}`);
      }
    }
  }

  return {
    mode,
    shellOrigins,
    mybrandosOrigins,
    lifeosOrigins,
    compatibleOrigins,
    allowDevelopmentFeatures: mode === "development",
    requireHttpsOrigins: mode !== "development",
  };
}

/** Browser helper: read Vite-injected env. Safe when import.meta.env is absent. */
export function readShellEnvironmentFromVite(env?: Record<string, string | boolean | undefined>): ShellEnvironmentConfig {
  const source =
    env ??
    (typeof import.meta !== "undefined"
      ? ((import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env ?? {})
      : {});
  const modeRaw =
    (typeof source.VITE_SHELL_MODE === "string" ? source.VITE_SHELL_MODE : null) ??
    (source.PROD === true || source.MODE === "production" ? "production" : "development");
  return createShellEnvironment({
    mode: String(modeRaw),
    shellOrigins: typeof source.VITE_SHELL_ORIGINS === "string" ? source.VITE_SHELL_ORIGINS : null,
    mybrandosOrigins: typeof source.VITE_MYBRANDOS_ORIGINS === "string" ? source.VITE_MYBRANDOS_ORIGINS : null,
    lifeosOrigins: typeof source.VITE_LIFEOS_ORIGINS === "string" ? source.VITE_LIFEOS_ORIGINS : null,
    compatibleOrigins: typeof source.VITE_COMPATIBLE_ORIGINS === "string" ? source.VITE_COMPATIBLE_ORIGINS : null,
  });
}

export function productionBuildRejectsLocalhost(config: ShellEnvironmentConfig): boolean {
  if (config.mode === "development") return false;
  const all = [
    ...config.shellOrigins,
    ...config.mybrandosOrigins,
    ...config.lifeosOrigins,
    ...config.compatibleOrigins,
  ];
  return all.every((origin) => !isLoopbackOrigin(origin) || isCapacitorShellOrigin(origin));
}

export function isDevelopmentShellHost(origin: string, config?: ShellEnvironmentConfig): boolean {
  const env = config ?? createShellEnvironment({ mode: "development" });
  if (!env.allowDevelopmentFeatures) return false;
  return isLoopbackOrigin(origin);
}
