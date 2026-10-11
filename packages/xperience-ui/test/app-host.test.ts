import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appReadyFrame, frameSrc } from "../src/local/app-host.ts";

test("first-party Apps are told whether they run as the App or the installed Space", () => {
  assert.equal(frameSrc("https://mrfundzman.getlifeos.app/", "SPACE"), "https://mrfundzman.getlifeos.app/?ox-mode=space&entry=space");
  assert.equal(frameSrc("https://mrfundzman.getlifeos.app/?a=1", "APP"), "https://mrfundzman.getlifeos.app/?a=1&ox-mode=app");
  assert.equal(frameSrc("https://shop.example/", "SPACE"), "https://shop.example/");
});

test("only a mounted frame, from its own origin, can say its App is ready", () => {
  const win = {};
  const frames = [{ id: "mybrandos", embedUrl: "https://mrfundzman.getlifeos.app/?ox-mode=space&entry=space", window: win }];
  const base = { data: { type: "ox.appReady", version: 1 }, origin: "https://mrfundzman.getlifeos.app", source: win, frames };
  assert.equal(appReadyFrame(base), "mybrandos");
  assert.equal(appReadyFrame({ ...base, source: {} }), null);
  assert.equal(appReadyFrame({ ...base, origin: "https://evil.example" }), null);
  assert.equal(appReadyFrame({ ...base, data: { type: "ox.appReady", version: 2 } }), null);
  assert.equal(appReadyFrame({ ...base, data: null }), null);
});

test("the installed Space has no shell controls and stays the App offline", () => {
  const app = readFileSync(new URL("../src/ExperienceApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /Summon controls|className="ox-space-summon"|className="ox-deliverable-trigger"|data-testid="space-controls"/);
  assert.match(app, /!\(executionMode === "SPACE" && offline && offlineAppMissing\)/);
  assert.match(app, /src=\{frameSrc\(frame\.embedUrl, executionMode\)\}/);
});

test("installed first-party Spaces are prepared invisibly while online", async () => {
  const { spacePrepareSrc, SPACE_SYNCED_MESSAGE } = await import("../src/local/app-host.ts");
  assert.equal(spacePrepareSrc("https://mrfundzman.getlifeos.app/"), "https://mrfundzman.getlifeos.app/?ox-mode=space&entry=space&ox-prepare=1");
  assert.equal(spacePrepareSrc("https://shop.example/"), null);
  const win = {};
  const frames = [{ id: "mybrandos", embedUrl: "https://mrfundzman.getlifeos.app/?ox-prepare=1", window: win }];
  const msg = { data: { type: SPACE_SYNCED_MESSAGE, version: 1 }, origin: "https://mrfundzman.getlifeos.app", source: win, frames };
  assert.equal(appReadyFrame(msg, SPACE_SYNCED_MESSAGE), "mybrandos");
  assert.equal(appReadyFrame(msg), null, "a synced report is not an app-ready signal");
  const app = readFileSync(new URL("../src/ExperienceApp.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(offline \|\| !registeredSpaceKey\) return;\n    const due/);
  assert.match(app, /className="ox-prepare-frame"/);
  assert.match(app, /prepareFrames\.filter\(\(frame\) => frame\.id !== activeExperienceId\)/);
});
