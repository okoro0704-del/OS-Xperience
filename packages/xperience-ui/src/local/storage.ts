/** Injectable key-value store — localStorage in browsers, memory in tests. */

export interface KvStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();

export const memoryKvStore: KvStore = {
  getItem(key) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  setItem(key, value) {
    memory.set(key, value);
  },
  removeItem(key) {
    memory.delete(key);
  },
};

function browserStore(): KvStore {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode / blocked storage */
  }
  return memoryKvStore;
}

let active: KvStore = browserStore();

export function getKvStore(): KvStore {
  return active;
}

/** Test-only: swap store and optionally clear memory backing. */
export function setKvStoreForTests(store: KvStore | null): void {
  if (store == null) {
    memory.clear();
    active = browserStore();
    return;
  }
  active = store;
}

export function clearMemoryKvStore(): void {
  memory.clear();
}

export function readJson<T>(key: string): T | null {
  const raw = active.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  active.setItem(key, JSON.stringify(value));
}
