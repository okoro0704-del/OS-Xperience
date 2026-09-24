/**
 * Explicit boot phases for OS Xperience native/web shell.
 * Logging is quiet unless OX_BOOT_DEBUG=1 or ?ox_boot_debug=1.
 */
export type BootPhase =
  | "NATIVE_START"
  | "LOCAL_SHELL_LOADING"
  | "LOCAL_SHELL_READY"
  | "LOCAL_STATE_RESTORING"
  | "EXPERIENCE_RESTORING"
  | "UPDATE_CHECK"
  | "READY"
  | "RECOVERY";

const PHASE_KEY = "ox.boot.phase";
const RUNTIME_MODE_KEY = "ox.runtime-mode.v1";
const LAST_EXPERIENCE_KEY = "ox.last-experience.v1";

function bootDebugEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("ox_boot_debug") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function markBootPhase(phase: BootPhase): void {
  try {
    sessionStorage.setItem(PHASE_KEY, phase);
  } catch {
    /* ignore */
  }
  (window as Window & { __oxBootPhase?: BootPhase }).__oxBootPhase = phase;
  if (bootDebugEnabled()) {
    console.info(`[ox-boot] ${phase}`);
  }
}

export function readBootPhase(): BootPhase | null {
  try {
    return (sessionStorage.getItem(PHASE_KEY) as BootPhase | null) ?? null;
  } catch {
    return null;
  }
}

/** Clear only restore pointers — never wipe installation identity or catalogs. */
export function clearInvalidRestoreState(): void {
  try {
    localStorage.removeItem(RUNTIME_MODE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LAST_EXPERIENCE_KEY);
  } catch {
    /* ignore */
  }
  markBootPhase("RECOVERY");
}
