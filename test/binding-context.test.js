const assert = require("node:assert/strict");
const test = require("node:test");

const {
  disposeInactiveReplyRunsForBinding,
} = require("../src/domain/session/binding-context");

test("disposeInactiveReplyRunsForBinding clears reply runs from other workspaces in the same binding", () => {
  const disposed = [];
  const runtime = {
    replyCardByRunKey: new Map([
      ["run-old", { threadId: "thread-old" }],
      ["run-active", { threadId: "thread-active" }],
      ["run-other-binding", { threadId: "thread-other-binding" }],
    ]),
    bindingKeyByThreadId: new Map([
      ["thread-old", "binding-1"],
      ["thread-active", "binding-1"],
      ["thread-other-binding", "binding-2"],
    ]),
    workspaceRootByThreadId: new Map([
      ["thread-old", "/repo/old"],
      ["thread-active", "/repo/active"],
      ["thread-other-binding", "/repo/other"],
    ]),
    disposeReplyRunState(runKey, threadId) {
      disposed.push({ runKey, threadId });
    },
  };

  disposeInactiveReplyRunsForBinding(runtime, "binding-1", "/repo/active");

  assert.deepEqual(disposed, [{
    runKey: "run-old",
    threadId: "thread-old",
  }]);
});
