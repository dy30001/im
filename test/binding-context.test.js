const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cleanupThreadRuntimeState,
  disposeInactiveReplyRunsForBinding,
  shouldDeliverThreadEventForActiveWorkspace,
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

test("shouldDeliverThreadEventForActiveWorkspace only allows the selected thread for the active workspace", () => {
  const runtime = {
    sessionStore: {
      getActiveWorkspaceRoot(bindingKey) {
        return bindingKey === "binding-1" ? "/repo/active" : "";
      },
      getThreadIdForWorkspace(bindingKey, workspaceRoot) {
        if (bindingKey === "binding-1" && workspaceRoot === "/repo/active") {
          return "thread-active";
        }
        return "";
      },
      buildBindingKey() {
        return "";
      },
    },
    bindingKeyByThreadId: new Map([
      ["thread-active", "binding-1"],
      ["thread-old", "binding-1"],
      ["thread-orphan", "binding-1"],
    ]),
    workspaceRootByThreadId: new Map([
      ["thread-active", "/repo/active"],
      ["thread-old", "/repo/active"],
    ]),
    pendingChatContextByThreadId: new Map(),
  };

  assert.equal(shouldDeliverThreadEventForActiveWorkspace(runtime, "thread-active"), true);
  assert.equal(shouldDeliverThreadEventForActiveWorkspace(runtime, "thread-old"), false);
  assert.equal(shouldDeliverThreadEventForActiveWorkspace(runtime, "thread-orphan"), false);
});

test("cleanupThreadRuntimeState releases inflight thread dispatch claims for aliased desktop session ids", () => {
  const claim = {
    bindingKey: "binding-1",
    workspaceRoot: "/repo",
    claimedAt: Date.now(),
    keys: ["desktop-session", "thread-1", "record-1"],
  };
  const runtime = {
    pendingApprovalByThreadId: new Map([
      ["thread-1", { id: "approval-1" }],
    ]),
    activeTurnIdByThreadId: new Map([
      ["thread-1", "turn-1"],
    ]),
    activeTurnStartedAtByThreadId: new Map([
      ["thread-1", 100],
    ]),
    lastTurnActivityAtByThreadId: new Map([
      ["thread-1", 200],
    ]),
    pendingChatContextByThreadId: new Map([
      ["thread-1", { chatId: "chat-1" }],
    ]),
    bindingKeyByThreadId: new Map([
      ["thread-1", "binding-1"],
    ]),
    workspaceRootByThreadId: new Map([
      ["thread-1", "/repo"],
    ]),
    inFlightThreadDispatchClaimsById: new Map([
      ["desktop-session", claim],
      ["thread-1", claim],
      ["record-1", claim],
    ]),
    replyCardByRunKey: new Map(),
    disposeReplyRunState() {},
  };

  cleanupThreadRuntimeState(runtime, "thread-1");

  assert.equal(runtime.inFlightThreadDispatchClaimsById.size, 0);
  assert.equal(runtime.activeTurnIdByThreadId.has("thread-1"), false);
  assert.equal(runtime.pendingApprovalByThreadId.has("thread-1"), false);
});
