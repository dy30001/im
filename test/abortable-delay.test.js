const assert = require("node:assert/strict");
const { getEventListeners } = require("node:events");
const test = require("node:test");

const { delayWithAbort } = require("../src/shared/abortable-delay");

test("delayWithAbort removes abort listeners after the timer resolves", async () => {
  const controller = new AbortController();

  for (let index = 0; index < 15; index += 1) {
    await delayWithAbort(1, controller.signal);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("delayWithAbort removes abort listeners when the signal aborts early", async () => {
  const controller = new AbortController();
  const delayPromise = delayWithAbort(10_000, controller.signal);

  controller.abort();
  await delayPromise;

  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
