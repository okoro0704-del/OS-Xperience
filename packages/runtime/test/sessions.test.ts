import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizeSessionParticipation,
  ClientOperatingSessionStore,
  publicSessionView,
} from "../src/index.ts";
import { createContextReference } from "@osshell/contract";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  } as Storage;
}

test("operating session store create switch end and recovery", () => {
  const sessionStorage = memoryStorage();
  const recovery = memoryStorage();
  const store = new ClientOperatingSessionStore(sessionStorage, recovery);
  const created = store.create("Edit video");
  assert.equal(created.state, "ACTIVE");
  store.join(created.sessionId, "lifeos");
  const ctx = createContextReference({ type: "asset", id: "a1", title: "Example Video", metadata: { assetType: "VIDEO" } });
  assert.equal(ctx.ok, true);
  if (!ctx.ok) return;
  store.recordIntent({
    sessionId: created.sessionId,
    sourceAppId: "lifeos",
    targetAppId: "mybrandos",
    intent: "edit",
    context: ctx.context,
  });
  assert.equal(store.current()?.context.activeApplicationId, "mybrandos");
  const second = store.create("Write article");
  assert.equal(store.current()?.sessionId, second.sessionId);
  store.switchTo(created.sessionId);
  assert.equal(store.current()?.sessionId, created.sessionId);
  const view = publicSessionView(store.current());
  assert.equal(view?.contextType, "asset");
  assert.equal("text" in (view ?? {}), false);

  const ended = store.end(created.sessionId);
  assert.equal(ended.ok, true);
  // resume-safe recovery metadata may remain in recovery storage
  assert.ok(Array.isArray(store.loadRecovery()));
});

test("forged session and unauthorized participation are rejected", () => {
  const store = new ClientOperatingSessionStore(memoryStorage(), memoryStorage());
  const created = store.create("A");
  store.join(created.sessionId, "lifeos");
  assert.equal(store.join("sess-nope-xxxx", "lifeos").ok, false);
  const auth = authorizeSessionParticipation({
    session: null,
    appId: "mybrandos",
    sessionId: "sess-forged-id01",
  });
  assert.equal(auth.ok, false);
  if (!auth.ok) assert.equal(auth.code, "session_unknown");
});

test("standalone-style absence of shell store still allows empty load", () => {
  const store = new ClientOperatingSessionStore(memoryStorage());
  assert.deepEqual(store.load(), []);
  assert.equal(store.current(), null);
});
