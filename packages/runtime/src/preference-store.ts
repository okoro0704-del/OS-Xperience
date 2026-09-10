import {
  jsonLeaksSecrets,
  parseApplicationPreferences,
  type OSShellApplicationPreference,
} from "@osshell/contract";
import { safeGetJson, safeSetJson } from "./safe-storage.js";

const KEY = "os-shell.application-preferences.v1";

/** Shell-owned local application preferences. Not shared with applications. Not authorization. */
export class ClientPreferenceStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  load(): OSShellApplicationPreference[] {
    const loaded = safeGetJson<unknown>(this.storage, KEY);
    if (!loaded.ok) return [];
    try {
      return parseApplicationPreferences(loaded.value);
    } catch {
      this.clear();
      return [];
    }
  }

  save(list: readonly OSShellApplicationPreference[]): void {
    if (jsonLeaksSecrets(list)) throw new Error("Preferences must not contain credentials.");
    safeSetJson(this.storage, KEY, list.slice(0, 64));
  }

  clear(): void {
    this.storage.removeItem(KEY);
  }
}
