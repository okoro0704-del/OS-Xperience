import assert from "node:assert/strict";
import test from "node:test";
import { prepareAppTv, prepareSpaceTv, resolveBroadcastNow, type BroadcastMedia, type BroadcastSchedule } from "../src/index.ts";

const base = Date.parse("2026-01-01T08:00:00Z");
const schedule: BroadcastSchedule = { channelId:"mrfundzman.tv", publisherId:"mrfundzman", scheduleId:"mrfundzman.tv.daily", scheduleVersion:1, programs:Array.from({length:10}, (_, sequence) => ({ programId:`program-${sequence+1}`, mediaId:`VIDEO_${String(sequence+1).padStart(2,"0")}`, scheduledStart:new Date(base+sequence*600000).toISOString(), durationMs:600000, sequence })) };
const media: BroadcastMedia[] = schedule.programs.map((program) => ({ mediaId:program.mediaId, publisherId:"mrfundzman", title:program.mediaId, durationMs:600000, version:"1", contentType:"video/mp4", byteLength:100, checksum:`sha-${program.mediaId}`, availability:"AVAILABLE_LOCAL" }));

test("one canonical ten-video schedule resolves deterministic current, offset, and next", () => {
  const now = new Date(base + 2 * 600000 + 180000);
  const result = resolveBroadcastNow(schedule, now)!;
  assert.equal(result.currentProgram.mediaId, "VIDEO_03"); assert.equal(result.offsetIntoProgramMs, 180000); assert.equal(result.nextProgram?.mediaId, "VIDEO_04");
});
test("APP and SPACE independently resolve the same mid-program broadcast state", () => {
  const now = new Date(base + 1380000); const app = prepareAppTv(schedule, now, true); const space = prepareSpaceTv(schedule, media, now);
  assert.equal("currentProgram" in app && app.currentProgram.mediaId, "VIDEO_03"); assert.equal(space.state, "LOCAL_PLAYING"); if (space.state === "LOCAL_PLAYING") assert.equal(space.media.mediaId, "VIDEO_03");
});
test("APP fails closed without route while SPACE starts local playback", () => {
  assert.equal(prepareAppTv(schedule, new Date(base), false).state, "ONLINE_REQUIRED"); assert.equal(prepareSpaceTv(schedule, media, new Date(base)).state, "LOCAL_PLAYING");
});
test("SPACE rejects missing, corrupt, and stale channel projections", () => {
  assert.equal(prepareSpaceTv(schedule, media.map((item) => item.mediaId === "VIDEO_04" ? {...item,availability:"MISSING" as const} : item), new Date(base+3*600000)).state, "MISSING_ASSET");
  assert.equal(prepareSpaceTv(schedule, media.map((item) => item.mediaId === "VIDEO_04" ? {...item,availability:"INVALID" as const} : item), new Date(base+3*600000)).state, "CORRUPT_ASSET");
  assert.equal(prepareSpaceTv(schedule, media, new Date(base), 2).state, "STALE_SCHEDULE");
});
