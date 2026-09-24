import assert from "node:assert/strict";
import test from "node:test";
import {
  MRFUNDZMANOS_EXPERIENCE_ID,
  lockFrameLineup,
  localSpaceResult,
  onlineDeliverableResult,
  resolveLockedExperience,
} from "../src/locked-xperience.ts";
import {
  clearMemoryKvStore,
  memoryKvStore,
  readLockedKernelMode,
  setKvStoreForTests,
  writeLockedKernelMode,
} from "../src/local/index.ts";

test("configured mrfundzmanOS lock resolves stale targets to the actual registry ID", () => {
  assert.equal(MRFUNDZMANOS_EXPERIENCE_ID, "bootstrap.mybrandos.public");
  assert.equal(resolveLockedExperience("another.experience"), MRFUNDZMANOS_EXPERIENCE_ID);
  assert.equal(resolveLockedExperience("another.experience", null), "another.experience");
});

test("locked Xperience has one actual frame and fails closed when it is absent", () => {
  const frames = [
    { experienceId: "another.experience", name: "Other" },
    { experienceId: MRFUNDZMANOS_EXPERIENCE_ID, name: "mrfundzmanOS" },
  ];
  assert.deepEqual(lockFrameLineup(frames), [frames[1]]);
  assert.deepEqual(lockFrameLineup([frames[0]]), []);
});

test("kernel selection persists through the existing local runtime store", () => {
  setKvStoreForTests(memoryKvStore);
  clearMemoryKvStore();
  assert.equal(readLockedKernelMode(), "APP");
  writeLockedKernelMode("SPACE");
  assert.equal(readLockedKernelMode(), "SPACE");
  setKvStoreForTests(null);
});

test("NO_ROUTE requires online delivery for APP while local SPACE availability remains available", () => {
  assert.equal(onlineDeliverableResult(false), "ONLINE_REQUIRED");
  assert.equal(localSpaceResult(true), "AVAILABLE_LOCAL");
  assert.equal(localSpaceResult(false), "AWAITING_ROUTE");
});
