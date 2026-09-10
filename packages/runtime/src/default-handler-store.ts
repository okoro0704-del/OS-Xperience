import {
  jsonLeaksSecrets,
  parseDefaultHandlers,
  type DefaultIntentHandler,
} from "@osshell/contract";

const KEY = "os-shell.intent-defaults.v1";

/** Local default intent handlers. Revocable. Not capability grants. */
export class ClientDefaultHandlerStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {}

  load(): DefaultIntentHandler[] {
    const raw = this.storage.getItem(KEY);
    if (!raw) return [];
    try {
      return parseDefaultHandlers(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  save(list: readonly DefaultIntentHandler[]): void {
    if (jsonLeaksSecrets(list)) throw new Error("Default handlers must not contain credentials.");
    this.storage.setItem(KEY, JSON.stringify(list));
  }
}
