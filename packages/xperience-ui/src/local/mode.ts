import type { RuntimeMode } from "@digiconomy/xperience-contract";
import { readJson, writeJson } from "./storage.js";

export const RUNTIME_MODE_KEY = "ox.runtime-mode.v1";
export const LOCKED_KERNEL_KEY = "ox.locked-kernel.v1";

export type LockedKernelMode = "APP" | "SPACE";

export function readRuntimeMode(): RuntimeMode {
  const raw = readJson<unknown>(RUNTIME_MODE_KEY);
  if (raw && typeof raw === "object" && (raw as { mode?: unknown }).mode === "XPERIENCE") {
    return "XPERIENCE";
  }
  return "HOME";
}

export function writeRuntimeMode(mode: RuntimeMode): void {
  writeJson(RUNTIME_MODE_KEY, { mode, updatedAt: new Date().toISOString() });
}

export function enterXperienceMode(): void {
  writeRuntimeMode("XPERIENCE");
}

export function leaveXperienceMode(): void {
  writeRuntimeMode("HOME");
}

export function readLockedKernelMode(): LockedKernelMode {
  const raw = readJson<unknown>(LOCKED_KERNEL_KEY);
  return raw && typeof raw === "object" && (raw as { mode?: unknown }).mode === "SPACE" ? "SPACE" : "APP";
}

export function writeLockedKernelMode(mode: LockedKernelMode): void {
  writeJson(LOCKED_KERNEL_KEY, { mode, updatedAt: new Date().toISOString() });
}
