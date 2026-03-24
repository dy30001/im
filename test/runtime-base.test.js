const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attachRuntimeForwarders,
  initializeCommonRuntimeState,
} = require("../src/app/runtime-base");

test("initializeCommonRuntimeState seeds shared runtime containers", () => {
  const runtime = {};

  initializeCommonRuntimeState(runtime);

  assert.ok(runtime.pendingChatContextByThreadId instanceof Map);
  assert.ok(runtime.pendingChatContextByBindingKey instanceof Map);
  assert.ok(runtime.activeTurnIdByThreadId instanceof Map);
  assert.ok(runtime.pendingApprovalByThreadId instanceof Map);
  assert.ok(runtime.replyCardByRunKey instanceof Map);
  assert.ok(runtime.currentRunKeyByThreadId instanceof Map);
  assert.ok(runtime.replyFlushTimersByRunKey instanceof Map);
  assert.ok(runtime.pendingReactionByBindingKey instanceof Map);
  assert.ok(runtime.pendingReactionByThreadId instanceof Map);
  assert.ok(runtime.bindingKeyByThreadId instanceof Map);
  assert.ok(runtime.workspaceRootByThreadId instanceof Map);
  assert.ok(runtime.approvalAllowlistByWorkspaceRoot instanceof Map);
  assert.ok(runtime.inFlightApprovalRequestKeys instanceof Set);
  assert.ok(runtime.resumedThreadIds instanceof Set);
  assert.ok(runtime.messageContextByMessageId instanceof Map);
  assert.ok(runtime.latestMessageContextByChatId instanceof Map);
  assert.ok(runtime.workspaceThreadListCache instanceof Map);
  assert.ok(runtime.workspaceThreadRefreshStateByKey instanceof Map);
  assert.equal(runtime.isStopping, false);
  assert.equal(runtime.stopPromise, null);
});

test("attachRuntimeForwarders wires plain and runtime-first helpers onto the runtime prototype", () => {
  class TestRuntime {
    constructor() {
      this.prefix = "runtime:";
      this.sessionStore = {
        getCodexParamsForWorkspace(bindingKey, workspaceRoot) {
          return { bindingKey, workspaceRoot };
        },
      };
    }
  }

  attachRuntimeForwarders(TestRuntime.prototype, {
    plainForwarders: {
      add: (left, right) => left + right,
    },
    runtimeFirstForwarders: {
      withPrefix: (runtime, value) => `${runtime.prefix}${value}`,
    },
  });

  const runtime = new TestRuntime();

  assert.equal(runtime.add(1, 2), 3);
  assert.equal(runtime.withPrefix("value"), "runtime:value");
  assert.deepEqual(runtime.getCodexParamsForWorkspace("binding-1", "/repo"), {
    bindingKey: "binding-1",
    workspaceRoot: "/repo",
  });
});
