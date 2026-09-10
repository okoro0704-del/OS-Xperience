import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoverIntentHandlers,
  envelope,
  seedApplicationCatalog,
  threeApplicationTestIds,
  validateIntentRequest,
} from "@osshell/contract";
import { ClientDefaultHandlerStore, interpretAppEvent } from "../src/index.ts";

test("three applications participate in interoperability under one model", () => {
  const registry = seedApplicationCatalog();
  for (const id of threeApplicationTestIds()) {
    assert.ok(registry.some((item) => item.appId === id));
  }
  const fromDemo = validateIntentRequest({
    sourceAppId: "shell-demo-notes",
    payload: {
      intent: "share",
      requestId: "a",
      context: { type: "text", text: "hello from external app" },
    },
  });
  assert.equal(fromDemo.ok, true);
  const toLife = discoverIntentHandlers({
    intent: "view",
    contextType: "asset",
    registry,
    excludeAppId: "shell-demo-notes",
  });
  assert.ok(toLife.some((item) => item.appId === "lifeos"));
  assert.ok(toLife.some((item) => item.appId === "mybrandos"));
});

test("intent.request message is accepted from registered source", () => {
  const source = { id: "frame" };
  const parsed = interpretAppEvent({
    data: envelope("intent.request", {
      requestId: "i1",
      intent: "view",
      context: { type: "text", text: "x" },
    }),
    eventOrigin: "http://127.0.0.1:5185",
    eventSource: source,
    expectedOrigin: "http://127.0.0.1:5185",
    expectedSource: source,
    registered: true,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.message.type, "intent.request");
});

test("default handler store persists without becoming a backend", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const store = new ClientDefaultHandlerStore(storage);
  store.save([{ intent: "view", contextType: "text", appId: "shell-demo-notes" }]);
  assert.equal(store.load()[0]?.appId, "shell-demo-notes");
});
