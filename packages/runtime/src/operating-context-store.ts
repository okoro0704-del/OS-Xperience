import {
  jsonLeaksSecrets,
  parseOperatingContexts,
  validateOperatingContext,
  rememberRecentContinuity,
  type CurrentOperatingContext,
} from "@osshell/contract";
import { safeGetJson, safeSetJson } from "./safe-storage.js";

const CURRENT_KEY = "os-shell.operating-context.current.v1";
const RECENT_KEY = "os-shell.operating-context.recent.v1";

/**
 * Shell-owned local operating context.
 * Current place prefers sessionStorage (tab-local); recent is bounded localStorage.
 * Corrupt entries are cleared — never crash the Shell.
 */
export class ClientOperatingContextStore {
  constructor(
    private readonly sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private readonly localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = sessionStorage,
  ) {}

  current(): CurrentOperatingContext | null {
    const fromSession = safeGetJson<unknown>(this.sessionStorage, CURRENT_KEY);
    const raw = fromSession.ok
      ? fromSession
      : safeGetJson<unknown>(this.localStorage, CURRENT_KEY);
    if (!raw.ok) return null;
    const validated = validateOperatingContext(raw.value);
    if (!validated.ok) {
      this.clearCurrent();
      return null;
    }
    return validated.context;
  }

  setCurrent(input: unknown):
    | { ok: true; context: CurrentOperatingContext }
    | { ok: false; code: string; detail: string } {
    if (jsonLeaksSecrets(input)) {
      return { ok: false, code: "secret_payload", detail: "Operating context must not contain secrets." };
    }
    const validated = validateOperatingContext(input);
    if (!validated.ok) {
      return { ok: false, code: validated.code, detail: validated.detail };
    }
    try {
      safeSetJson(this.sessionStorage, CURRENT_KEY, validated.context);
      try {
        safeSetJson(this.localStorage, CURRENT_KEY, validated.context);
      } catch {
        /* quota / private mode — session copy is enough */
      }
    } catch (error) {
      return {
        ok: false,
        code: "malformed_payload",
        detail: error instanceof Error ? error.message : "Failed to persist operating context.",
      };
    }
    const recent = rememberRecentContinuity(this.recent(), validated.context);
    this.saveRecent(recent);
    return { ok: true, context: validated.context };
  }

  recent(): CurrentOperatingContext[] {
    const loaded = safeGetJson<unknown>(this.localStorage, RECENT_KEY);
    if (!loaded.ok) return [];
    return parseOperatingContexts(loaded.value);
  }

  open(id: string): CurrentOperatingContext | null {
    const current = this.current();
    if (current?.id === id) return current;
    const hit = this.recent().find((item) => item.id === id);
    if (!hit) return null;
    this.setCurrent(hit);
    return hit;
  }

  clearCurrent(): void {
    this.sessionStorage.removeItem(CURRENT_KEY);
    try {
      this.localStorage.removeItem(CURRENT_KEY);
    } catch {
      /* ignore */
    }
  }

  clearRecent(): void {
    this.localStorage.removeItem(RECENT_KEY);
  }

  clearAll(): void {
    this.clearCurrent();
    this.clearRecent();
  }

  private saveRecent(list: readonly CurrentOperatingContext[]): void {
    if (jsonLeaksSecrets(list)) throw new Error("Continuity must not contain credentials.");
    safeSetJson(this.localStorage, RECENT_KEY, list.slice(0, 4));
  }
}
