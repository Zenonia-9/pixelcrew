import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceScheduler } from "../server/workspace-scheduler";

test("two readers overlap, a third waits, and nested workspace writes are exclusive", async () => {
  const scheduler = new WorkspaceScheduler();
  const first = await scheduler.acquire("C:/work", false, () => false);
  const second = await scheduler.acquire("C:/other", false, () => false);
  let thirdStarted = false,
    writerStarted = false;
  const third = scheduler
    .acquire("C:/third", false, () => false)
    .then((release) => {
      thirdStarted = true;
      return release;
    });
  const writer = scheduler
    .acquire("C:/work/project", true, () => false)
    .then((release) => {
      writerStarted = true;
      return release;
    });
  await Promise.resolve();
  assert.equal(thirdStarted, false);
  assert.equal(writerStarted, false);
  second();
  const releaseThird = await third;
  assert.equal(writerStarted, false);
  first();
  const releaseWriter = await writer;
  assert.equal(writerStarted, true);
  releaseWriter();
  releaseThird();
});

test("cancelling a waiting assignment does not start its execution", async () => {
  const scheduler = new WorkspaceScheduler();
  const release = await scheduler.acquire("C:/work", true, () => false);
  let stopped = false;
  const waiting = scheduler.acquire("C:/work/sub", false, () => stopped);
  stopped = true;
  scheduler.wake();
  await assert.rejects(waiting, /Run stopped/);
  release();
});
