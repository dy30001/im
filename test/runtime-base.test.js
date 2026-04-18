const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attachRuntimeForwarders,
  buildCommonPlainForwarders,
  buildCommonRuntimeFirstForwarders,
  initializeCommonRuntimeState,
  startRuntimeCodex,
  stopRuntime,
} = require("../src/app/runtime-base");

test("initializeCommonRuntimeState seeds shared runtime containers", () => {
  const runtime = {};

  initializeCommonRuntimeState(runtime);

  assert.ok(runtime.pendingChatContextByThreadId instanceof Map);
  assert.ok(runtime.pendingChatContextByBindingKey instanceof Map);
  assert.ok(runtime.pendingMessageQueueByBindingKey instanceof Map);
  assert.ok(runtime.activeTurnIdByThreadId instanceof Map);
  assert.ok(runtime.activeTurnStartedAtByThreadId instanceof Map);
  assert.ok(runtime.lastTurnActivityAtByThreadId instanceof Map);
  assert.ok(runtime.pendingApprovalByThreadId instanceof Map);
  assert.ok(runtime.replyCardByRunKey instanceof Map);
  assert.ok(runtime.currentRunKeyByThreadId instanceof Map);
  assert.ok(runtime.replyFlushTimersByRunKey instanceof Map);
  assert.ok(runtime.replyProgressTimersByRunKey instanceof Map);
  assert.ok(runtime.replyProgressFollowupTimersByRunKey instanceof Map);
  assert.ok(runtime.pendingReactionByBindingKey instanceof Map);
  assert.ok(runtime.pendingReactionByThreadId instanceof Map);
  assert.ok(runtime.bindingKeyByThreadId instanceof Map);
  assert.ok(runtime.workspaceRootByThreadId instanceof Map);
  assert.ok(runtime.inFlightThreadDispatchClaimsById instanceof Map);
  assert.ok(runtime.inFlightApprovalRequestKeys instanceof Set);
  assert.ok(runtime.resumedThreadIds instanceof Set);
  assert.ok(runtime.messageContextByMessageId instanceof Map);
  assert.ok(runtime.latestMessageContextByChatId instanceof Map);
  assert.ok(runtime.workspaceThreadRefreshStateByKey instanceof Map);
  assert.ok(runtime.workspaceThreadSharedCacheByKey instanceof Map);
  assert.ok(runtime.workspaceThreadRefreshPromiseByKey instanceof Map);
  assert.ok(runtime.inFlightBindingDispatchKeys instanceof Set);
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

test("buildCommonPlainForwarders keeps the shared builder set and optional extras", () => {
  const builders = {
    buildCardResponse() {},
    buildThreadPickerText() {},
    buildThreadSyncText() {},
  };

  const plainForwarders = buildCommonPlainForwarders(builders, [
    "buildThreadPickerText",
    "buildThreadSyncText",
  ]);

  assert.equal(plainForwarders.buildCardResponse, builders.buildCardResponse);
  assert.equal(plainForwarders.buildThreadPickerText, builders.buildThreadPickerText);
  assert.equal(plainForwarders.buildThreadSyncText, builders.buildThreadSyncText);
});

test("buildCommonRuntimeFirstForwarders assembles shared runtime helpers once", () => {
  const runtimeCommands = {
    dispatchTextCommand() {},
    dispatchCardAction() {},
    handlePanelCardAction() {},
    handleThreadCardAction() {},
    handleWorkspaceCardAction() {},
  };
  const workspaceRuntime = {
    resolveWorkspaceContext() {},
    handleBindCommand() {},
    handleBrowseCommand() {},
    handleWhereCommand() {},
    showStatusPanel() {},
    handleMessageCommand() {},
    handleHelpCommand() {},
    handleUnknownCommand() {},
    handleThreadsCommand() {},
    handleWorkspacesCommand() {},
    showThreadPicker() {},
    handleRemoveCommand() {},
    handleSendCommand() {},
    handleModelCommand() {},
    handleEffortCommand() {},
    switchWorkspaceByPath() {},
    removeWorkspaceByPath() {},
  };
  const threadRuntime = {
    resolveWorkspaceThreadState() {},
    ensureThreadAndSendMessage() {},
    ensureThreadResumed() {},
    handleNewCommand() {},
    handleSwitchCommand() {},
    refreshWorkspaceThreads() {},
    getWorkspaceThreadRefreshState() {},
    describeWorkspaceStatus() {},
    switchThreadById() {},
  };
  const runtimeState = {
    resolveWorkspaceRootForBinding() {},
    resolveThreadIdForBinding() {},
    setThreadBindingKey() {},
    setThreadWorkspaceRoot() {},
    setPendingBindingContext() {},
    setPendingThreadContext() {},
    setReplyCardEntry() {},
    setCurrentRunKeyForThread() {},
    rememberSelectionContext() {},
    resolveSelectionContext() {},
    disposeInactiveReplyRunsForBinding() {},
    resolveWorkspaceRootForThread() {},
    shouldDeliverThreadEventForActiveWorkspace() {},
    cleanupThreadRuntimeState() {},
    pruneRuntimeMapSizes() {},
  };
  const approvalPolicyRuntime = {
    rememberApprovalPrefixForWorkspace() {},
    shouldAutoApproveRequest() {},
    tryAutoApproveRequest() {},
  };
  const approvalRuntime = {
    applyApprovalDecision() {},
    handleApprovalCommand() {},
    handleApprovalCardActionAsync() {},
  };
  const eventsRuntime = {
    handleStopCommand() {},
    deliverToProvider() {},
  };
  const appDispatcher = {
    clearQueuedMessagesForBinding() {},
    drainQueuedMessagesForBinding() {},
    processQueuedNormalizedTextEvent() {},
  };
  const cardService = {
    sendInfoCardMessage() {},
    sendInteractiveApprovalCard() {},
    updateInteractiveCard() {},
    sendInteractiveCard() {},
    patchInteractiveCard() {},
    handleCardAction() {},
    queueCardActionWithFeedback() {},
    runCardActionTask() {},
    sendCardActionFeedbackByContext() {},
    sendCardActionFeedback() {},
    upsertAssistantReplyCard() {},
    addPendingReaction() {},
    movePendingReactionToThread() {},
    clearPendingReactionForBinding() {},
    clearPendingReactionForThread() {},
    disposeReplyRunState() {},
  };

  const runtimeFirstForwarders = buildCommonRuntimeFirstForwarders({
    runtimeCommands,
    workspaceRuntime,
    threadRuntime,
    runtimeState,
    approvalPolicyRuntime,
    approvalRuntime,
    eventsRuntime,
    appDispatcher,
    cardService,
  });

  assert.equal(runtimeFirstForwarders.dispatchTextCommand, runtimeCommands.dispatchTextCommand);
  assert.equal(runtimeFirstForwarders.showThreadPicker, workspaceRuntime.showThreadPicker);
  assert.equal(runtimeFirstForwarders.handleSwitchCommand, threadRuntime.handleSwitchCommand);
  assert.equal(runtimeFirstForwarders.handleApprovalCommand, approvalRuntime.handleApprovalCommand);
  assert.equal(runtimeFirstForwarders.sendInteractiveCard, cardService.sendInteractiveCard);
  assert.equal(
    runtimeFirstForwarders.processQueuedNormalizedTextEvent,
    appDispatcher.processQueuedNormalizedTextEvent
  );
});

test("startRuntimeCodex connects and initializes the codex client", async () => {
  const calls = [];
  const runtime = {
    codex: {
      connect: async () => {
        calls.push("connect");
      },
      initialize: async () => {
        calls.push("initialize");
      },
    },
  };

  await startRuntimeCodex(runtime);

  assert.deepEqual(calls, ["connect", "initialize"]);
});

test("stopRuntime clears shared timers and closes shared resources once", async () => {
  const calls = [];
  const runtime = {
    replyFlushTimersByRunKey: new Map([["flush", setTimeout(() => {}, 1_000)]]),
    replyProgressTimersByRunKey: new Map([["progress", setTimeout(() => {}, 1_000)]]),
    replyProgressFollowupTimersByRunKey: new Map([["followup", setTimeout(() => {}, 1_000)]]),
    codex: {
      close: async () => {
        calls.push("codex");
      },
    },
    sessionStore: {
      flush: async () => {
        calls.push("flush");
      },
    },
    isStopping: false,
    stopPromise: null,
  };

  try {
    await stopRuntime(runtime, {
      beforeStop: async () => {
        calls.push("before");
      },
    });
    await stopRuntime(runtime, {
      beforeStop: async () => {
        calls.push("again");
      },
    });
  } finally {
    for (const timer of runtime.replyFlushTimersByRunKey.values()) {
      clearTimeout(timer);
    }
    for (const timer of runtime.replyProgressTimersByRunKey.values()) {
      clearTimeout(timer);
    }
    for (const timer of runtime.replyProgressFollowupTimersByRunKey.values()) {
      clearTimeout(timer);
    }
  }

  assert.equal(runtime.isStopping, true);
  assert.equal(runtime.replyFlushTimersByRunKey.size, 0);
  assert.equal(runtime.replyProgressTimersByRunKey.size, 0);
  assert.equal(runtime.replyProgressFollowupTimersByRunKey.size, 0);
  assert.deepEqual(calls, ["before", "codex", "flush"]);
});
