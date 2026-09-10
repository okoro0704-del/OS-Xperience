import type { PublicCapability } from "./capability-registry.js";
import type { CapabilityOutcome } from "./outcome.js";
import { outcomeOf } from "./outcome.js";

/**
 * DEVELOPMENT / SIMULATION ONLY.
 * Tests Shell contract behavior. Never creates fake tokens, balances, identity, or device handles.
 * Must not silently affect production authorization.
 */
export const SIMULATION_MODE_LABEL = "DEVELOPMENT / SIMULATION ONLY";

export type SimulationScenario =
  | "granted"
  | "denied"
  | "unavailable"
  | "permission_required"
  | "class_a_blocked";

export interface SimulationConfig {
  enabled: boolean;
  /** Explicit opt-in. Production hosts must leave this false. */
  developmentOnly: true;
  scenarios: Partial<Record<PublicCapability, SimulationScenario>>;
}

export function createSimulationConfig(
  scenarios: Partial<Record<PublicCapability, SimulationScenario>> = {},
): SimulationConfig {
  return {
    enabled: true,
    developmentOnly: true,
    scenarios,
  };
}

export function isSimulationAllowed(hostOrigin: string, config: SimulationConfig | null | undefined): boolean {
  if (!config?.enabled || !config.developmentOnly) return false;
  try {
    const host = new URL(hostOrigin).hostname;
    // Production / staging builds must never enable simulation even if storage is poisoned.
    if (typeof import.meta !== "undefined") {
      const env = (import.meta as ImportMeta & { env?: { PROD?: boolean; VITE_SHELL_MODE?: string } }).env;
      if (env?.PROD === true) return false;
      const mode = (env?.VITE_SHELL_MODE ?? "").toLowerCase();
      if (mode === "production" || mode === "prod" || mode === "staging" || mode === "stage") return false;
    }
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Read localhost-only simulation from storage.
 * Expected JSON: `{ "enabled": true, "scenarios": { "camera": "denied" } }`
 * Key: `os-shell.simulation`. Production hosts always get null.
 */
export function readLocalSimulationConfig(
  hostOrigin: string,
  storage?: Pick<Storage, "getItem"> | null,
): SimulationConfig | null {
  const probe: SimulationConfig = { enabled: true, developmentOnly: true, scenarios: {} };
  if (!isSimulationAllowed(hostOrigin, probe) || !storage) return null;
  try {
    const raw = storage.getItem("os-shell.simulation");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      enabled?: boolean;
      developmentOnly?: boolean;
      scenarios?: Partial<Record<PublicCapability, SimulationScenario>>;
    };
    if (parsed.enabled === false) return null;
    if (parsed.developmentOnly === false) return null;
    return createSimulationConfig(parsed.scenarios ?? {});
  } catch {
    return null;
  }
}

export function simulateCapabilityResult(
  capability: PublicCapability,
  scenario: SimulationScenario,
): CapabilityOutcome | { status: "needs_permission"; capability: string; origin: string; simulation: true } {
  if (scenario === "permission_required") {
    return { status: "needs_permission", capability, origin: "simulation", simulation: true };
  }
  if (scenario === "class_a_blocked") {
    return outcomeOf({
      capability,
      status: "class_a_blocked",
      reason: "class_a_blocked",
      detail: `${SIMULATION_MODE_LABEL}. Simulated Class A block.`,
    });
  }
  if (scenario === "denied") {
    return outcomeOf({
      capability,
      status: "denied",
      reason: "capability_denied",
      detail: `${SIMULATION_MODE_LABEL}. Simulated denial.`,
    });
  }
  if (scenario === "unavailable") {
    return outcomeOf({
      capability,
      status: "unavailable",
      reason: capability === "camera" ? "camera_unavailable" : "capability_unavailable",
      detail: `${SIMULATION_MODE_LABEL}. Simulated unavailability. No fake infrastructure was created.`,
    });
  }
  return outcomeOf({
    capability,
    status: "granted",
    reason: "ok",
    detail: `${SIMULATION_MODE_LABEL}. Simulated grant. No tokens, balances, or device handles were created.`,
  });
}
