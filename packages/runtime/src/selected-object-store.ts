import { jsonLeaksSecrets, validateContextReference, type OSShellContextReference } from "@osshell/contract";

const KEY = "os-shell.selected-object.v1";
const RECENT_ACTIONS_KEY = "os-shell.recent-actions.v1";

/** Tab-local selected object + recent action labels. Not a global object database. */
export class ClientSelectedObjectStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  current(): OSShellContextReference | null {
    const raw = this.storage.getItem(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (jsonLeaksSecrets(parsed)) {
        this.clear();
        return null;
      }
      const validated = validateContextReference(parsed);
      return validated.ok ? validated.context : null;
    } catch {
      return null;
    }
  }

  select(object: unknown): { ok: true; object: OSShellContextReference } | { ok: false; code: string; detail: string } {
    if (jsonLeaksSecrets(object)) {
      return { ok: false, code: "secret_payload", detail: "Selected object must not contain secrets." };
    }
    const validated = validateContextReference(object);
    if (!validated.ok) {
      return { ok: false, code: validated.code, detail: validated.detail };
    }
    this.storage.setItem(KEY, JSON.stringify(validated.context));
    return { ok: true, object: validated.context };
  }

  clear(): void {
    this.storage.removeItem(KEY);
  }

  recentActions(): string[] {
    const raw = this.storage.getItem(RECENT_ACTIONS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is string => typeof item === "string").slice(0, 8);
    } catch {
      return [];
    }
  }

  rememberAction(action: string): string[] {
    const next = [action, ...this.recentActions().filter((item) => item !== action)].slice(0, 8);
    this.storage.setItem(RECENT_ACTIONS_KEY, JSON.stringify(next));
    return next;
  }
}
