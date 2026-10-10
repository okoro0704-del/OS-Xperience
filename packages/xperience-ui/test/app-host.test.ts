import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { appReadyFrame, frameSrc } from "../src/local/app-host.ts";

test("first-party Apps are told whether they run as the App or the installed Space", () => {
  assert.equal(frameSrc("https://mrfundzman.getlifeos.app/", "SPACE"), "https://mrfundzman.getlifeos.app/?ox-mode=space");
  assert.equal(frameSrc("https://mrfundzman.getlifeos.app/?a=1", "APP"), "https://mrfundzman.getlifeos.app/?a=1&ox-mode=app");
  assert.equal(frameSrc("https://shop.example/", "SPACE"), "https://shop.example/");
});

test("only a mounted frame, from its own origin, can say its App is ready", () => {
  const win = {};
  const frames = [{ id: "mybrandos", embedUrl: "https://mrfundzman.getlifeos.app/?ox-mode=space", window: win }];
  const base = { data: { type: "ox.appReady", version: 1 }, origin: "https://mrfundzman.getlifeos.app", source: win, frames };
  assert.equal(appReadyFrame(base), "mybrandos");
  assert.equal(appReadyFrame({ ...base, source: {} }), null);
  assert.equal(appReadyFrame({ ...base, origin: "https://evil.example" }), null);
  assert.equal(appReadyFrame({ ...base, data: { type: "ox.appReady", version: 2 } }), null);
  assert.equal(appReadyFrame({ ...base, data: null }), null);
});

test("the installed Space has no shell controls and stays the App offline", () => {
  const app = readFileSync(new URL("../src/ExperienceApp.tsx", import.meta.url), "utf8");
  assert.match(app, /: direct \? null : <>\s*<button type="button" className="ox-space-summon"/);
  assert.match(app, /!\(executionMode === "SPACE" && offline && offlineAppMissing\)/);
  assert.match(app, /src=\{frameSrc\(frame\.embedUrl, executionMode\)\}/);
});
