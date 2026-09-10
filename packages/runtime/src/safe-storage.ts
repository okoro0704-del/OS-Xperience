/**
 * Safe localStorage / sessionStorage helpers for Shell-owned stores.
 * Corrupt entries are cleared — never crash the Shell.
 */
import { jsonLeaksSecrets } from "@osshell/contract";

export type SafeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function safeParseJson<T = unknown>(
  raw: string | null,
  options?: { rejectSecrets?: boolean },
): { ok: true; value: T } | { ok: false; reason: "empty" | "invalid_json" | "secret_payload" } {
  if (raw == null || raw === "") return { ok: false, reason: "empty" };
  try {
    const value = JSON.parse(raw) as T;
    if (options?.rejectSecrets !== false && jsonLeaksSecrets(value)) {
      return { ok: false, reason: "secret_payload" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

export function safeGetJson<T = unknown>(
  storage: SafeStorage,
  key: string,
  options?: { rejectSecrets?: boolean },
): { ok: true; value: T } | { ok: false; reason: string; cleared: boolean } {
  const raw = storage.getItem(key);
  const parsed = safeParseJson<T>(raw, options);
  if (parsed.ok) return parsed;
  if (parsed.reason === "empty") return { ok: false, reason: "empty", cleared: false };
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
  return { ok: false, reason: parsed.reason, cleared: true };
}

export function safeSetJson(storage: SafeStorage, key: string, value: unknown, maxBytes = 256_000): void {
  if (jsonLeaksSecrets(value)) {
    throw new Error("Shell storage must not contain credentials or secrets.");
  }
  const payload = JSON.stringify(value);
  if (payload.length > maxBytes) {
    throw new Error("Shell storage payload exceeds bounded size.");
  }
  storage.setItem(key, payload);
}
