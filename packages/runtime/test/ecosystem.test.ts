import assert from "node:assert/strict";
import { test } from "node:test";
import { findApplicationById, seedApplicationCatalog, threeApplicationTestIds } from "@osshell/contract";
import { ClientApplicationStore } from "../src/index.ts";

test("three-application registry persists removals without a Shell backend", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const store = new ClientApplicationStore(storage);
  const first = store.load();
  for (const id of threeApplicationTestIds()) {
    assert.ok(findApplicationById(first, id), id);
  }
  const removed = store.remove(first, "shell-demo-notes");
  assert.equal(findApplicationById(removed.list, "shell-demo-notes"), null);
  assert.equal(findApplicationById(store.load(), "shell-demo-notes"), null);
  assert.ok(findApplicationById(store.load(), "lifeos"));
  assert.ok(findApplicationById(store.load(), "mybrandos"));
});

test("seeded catalog is the same conceptual model for first-party and external apps", () => {
  const seeded = seedApplicationCatalog();
  for (const app of seeded) {
    assert.ok(app.appId);
    assert.ok(app.origin);
    assert.ok(app.source);
    assert.ok(app.trustState);
    assert.ok(Array.isArray(app.requestedCapabilities));
  }
});
