function initializeCommonRuntimeState(runtime) {
  runtime.pendingChatContextByThreadId = new Map();
  runtime.pendingChatContextByBindingKey = new Map();
  runtime.pendingMessageQueueByBindingKey = new Map();
  runtime.activeTurnIdByThreadId = new Map();
  runtime.activeTurnStartedAtByThreadId = new Map();
  runtime.lastTurnActivityAtByThreadId = new Map();
  runtime.pendingApprovalByThreadId = new Map();
  runtime.replyCardByRunKey = new Map();
  runtime.currentRunKeyByThreadId = new Map();
  runtime.replyFlushTimersByRunKey = new Map();
  runtime.replyProgressTimersByRunKey = new Map();
  runtime.replyProgressFollowupTimersByRunKey = new Map();
  runtime.pendingReactionByBindingKey = new Map();
  runtime.pendingReactionByThreadId = new Map();
  runtime.bindingKeyByThreadId = new Map();
  runtime.workspaceRootByThreadId = new Map();
  runtime.inFlightThreadDispatchClaimsById = new Map();
  runtime.inFlightApprovalRequestKeys = new Set();
  runtime.resumedThreadIds = new Set();
  runtime.messageContextByMessageId = new Map();
  runtime.latestMessageContextByChatId = new Map();
  runtime.latestSelectionContextByBindingKey = new Map();
  runtime.workspaceThreadRefreshStateByKey = new Map();
  runtime.workspaceThreadListCacheByKey = new Map();
  runtime.workspaceThreadSharedCacheByKey = new Map();
  runtime.workspaceThreadRefreshPromiseByKey = new Map();
  runtime.firstUseWorkspaceGuideSentByBindingKey = new Set();
  runtime.inFlightBindingDispatchKeys = new Set();
  runtime.isStopping = false;
  runtime.stopPromise = null;
  return runtime;
}

function buildCommonPlainForwarders(builders = {}, additionalNames = []) {
  return pickNamedFunctions(builders, [
    "buildCardResponse",
    "buildCardToast",
    "buildEffortInfoText",
    "buildEffortListText",
    "buildEffortValidationErrorText",
    "buildHelpCardText",
    "buildModelInfoText",
    "buildModelListText",
    "buildModelValidationErrorText",
    "buildStatusPanelCard",
    "buildThreadMessagesSummary",
    "buildThreadPickerCard",
    "buildWorkspaceBrowserCard",
    "buildWorkspaceBindingsCard",
    "listBoundWorkspaces",
    ...additionalNames,
  ]);
}

function buildCommonRuntimeFirstForwarders({
  runtimeCommands,
  workspaceRuntime,
  threadRuntime,
  runtimeState,
  approvalPolicyRuntime,
  approvalRuntime,
  eventsRuntime,
  appDispatcher,
  cardService,
} = {}) {
  return {
    dispatchTextCommand: runtimeCommands.dispatchTextCommand,
    resolveWorkspaceContext: workspaceRuntime.resolveWorkspaceContext,
    resolveWorkspaceThreadState: threadRuntime.resolveWorkspaceThreadState,
    ensureThreadAndSendMessage: threadRuntime.ensureThreadAndSendMessage,
    ensureThreadResumed: threadRuntime.ensureThreadResumed,
    resolveWorkspaceRootForBinding: runtimeState.resolveWorkspaceRootForBinding,
    resolveThreadIdForBinding: runtimeState.resolveThreadIdForBinding,
    setThreadBindingKey: runtimeState.setThreadBindingKey,
    setThreadWorkspaceRoot: runtimeState.setThreadWorkspaceRoot,
    setPendingBindingContext: runtimeState.setPendingBindingContext,
    setPendingThreadContext: runtimeState.setPendingThreadContext,
    setReplyCardEntry: runtimeState.setReplyCardEntry,
    setCurrentRunKeyForThread: runtimeState.setCurrentRunKeyForThread,
    rememberSelectionContext: runtimeState.rememberSelectionContext,
    resolveSelectionContext: runtimeState.resolveSelectionContext,
    disposeInactiveReplyRunsForBinding: runtimeState.disposeInactiveReplyRunsForBinding,
    resolveWorkspaceRootForThread: runtimeState.resolveWorkspaceRootForThread,
    shouldDeliverThreadEventForActiveWorkspace: runtimeState.shouldDeliverThreadEventForActiveWorkspace,
    rememberApprovalPrefixForWorkspace: approvalPolicyRuntime.rememberApprovalPrefixForWorkspace,
    shouldAutoApproveRequest: approvalPolicyRuntime.shouldAutoApproveRequest,
    tryAutoApproveRequest: approvalPolicyRuntime.tryAutoApproveRequest,
    applyApprovalDecision: approvalRuntime.applyApprovalDecision,
    handleBindCommand: workspaceRuntime.handleBindCommand,
    handleBrowseCommand: workspaceRuntime.handleBrowseCommand,
    handleWhereCommand: workspaceRuntime.handleWhereCommand,
    showStatusPanel: workspaceRuntime.showStatusPanel,
    handleMessageCommand: workspaceRuntime.handleMessageCommand,
    handleHelpCommand: workspaceRuntime.handleHelpCommand,
    handleUnknownCommand: workspaceRuntime.handleUnknownCommand,
    handleThreadsCommand: workspaceRuntime.handleThreadsCommand,
    handleWorkspacesCommand: workspaceRuntime.handleWorkspacesCommand,
    showThreadPicker: workspaceRuntime.showThreadPicker,
    handleNewCommand: threadRuntime.handleNewCommand,
    handleSwitchCommand: threadRuntime.handleSwitchCommand,
    handleRemoveCommand: workspaceRuntime.handleRemoveCommand,
    handleSendCommand: workspaceRuntime.handleSendCommand,
    handleModelCommand: workspaceRuntime.handleModelCommand,
    handleEffortCommand: workspaceRuntime.handleEffortCommand,
    refreshWorkspaceThreads: threadRuntime.refreshWorkspaceThreads,
    getWorkspaceThreadRefreshState: threadRuntime.getWorkspaceThreadRefreshState,
    describeWorkspaceStatus: threadRuntime.describeWorkspaceStatus,
    switchThreadById: threadRuntime.switchThreadById,
    handleStopCommand: eventsRuntime.handleStopCommand,
    handleApprovalCommand: approvalRuntime.handleApprovalCommand,
    deliverToProvider: eventsRuntime.deliverToProvider,
    clearQueuedMessagesForBinding: appDispatcher.clearQueuedMessagesForBinding,
    drainQueuedMessagesForBinding: appDispatcher.drainQueuedMessagesForBinding,
    processQueuedNormalizedTextEvent: appDispatcher.processQueuedNormalizedTextEvent,
    sendInfoCardMessage: cardService.sendInfoCardMessage,
    sendInteractiveApprovalCard: cardService.sendInteractiveApprovalCard,
    updateInteractiveCard: cardService.updateInteractiveCard,
    sendInteractiveCard: cardService.sendInteractiveCard,
    patchInteractiveCard: cardService.patchInteractiveCard,
    handleCardAction: cardService.handleCardAction,
    dispatchCardAction: runtimeCommands.dispatchCardAction,
    handlePanelCardAction: runtimeCommands.handlePanelCardAction,
    handleThreadCardAction: runtimeCommands.handleThreadCardAction,
    handleWorkspaceCardAction: runtimeCommands.handleWorkspaceCardAction,
    queueCardActionWithFeedback: cardService.queueCardActionWithFeedback,
    runCardActionTask: cardService.runCardActionTask,
    handleApprovalCardActionAsync: approvalRuntime.handleApprovalCardActionAsync,
    sendCardActionFeedbackByContext: cardService.sendCardActionFeedbackByContext,
    sendCardActionFeedback: cardService.sendCardActionFeedback,
    switchWorkspaceByPath: workspaceRuntime.switchWorkspaceByPath,
    removeWorkspaceByPath: workspaceRuntime.removeWorkspaceByPath,
    upsertAssistantReplyCard: cardService.upsertAssistantReplyCard,
    addPendingReaction: cardService.addPendingReaction,
    movePendingReactionToThread: cardService.movePendingReactionToThread,
    clearPendingReactionForBinding: cardService.clearPendingReactionForBinding,
    clearPendingReactionForThread: cardService.clearPendingReactionForThread,
    disposeReplyRunState: cardService.disposeReplyRunState,
    cleanupThreadRuntimeState: runtimeState.cleanupThreadRuntimeState,
    pruneRuntimeMapSizes: runtimeState.pruneRuntimeMapSizes,
  };
}

function attachRuntimeForwarders(proto, {
  plainForwarders = {},
  runtimeFirstForwarders = {},
} = {}) {
  for (const [methodName, fn] of Object.entries(plainForwarders)) {
    proto[methodName] = function forwardedPlain(...args) {
      return fn(...args);
    };
  }

  for (const [methodName, fn] of Object.entries(runtimeFirstForwarders)) {
    proto[methodName] = function forwardedRuntimeFirst(...args) {
      return fn(this, ...args);
    };
  }

  proto.getCodexParamsForWorkspace = function getCodexParamsForWorkspace(bindingKey, workspaceRoot) {
    return this.sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  };

  return proto;
}

async function startRuntimeCodex(runtime) {
  await runtime.codex.connect();
  await runtime.codex.initialize();
}

function stopRuntime(runtime, { beforeStop } = {}) {
  if (runtime.stopPromise) {
    return runtime.stopPromise;
  }

  runtime.isStopping = true;
  runtime.stopPromise = (async () => {
    clearTimerMap(runtime.replyFlushTimersByRunKey);
    clearTimerMap(runtime.replyProgressTimersByRunKey);
    clearTimerMap(runtime.replyProgressFollowupTimersByRunKey);

    if (typeof beforeStop === "function") {
      await beforeStop(runtime);
    }

    try {
      if (typeof runtime.codex?.close === "function") {
        await runtime.codex.close();
      }
    } catch (error) {
      console.error(`[codex-im] failed to close Codex client: ${error.message}`);
    }

    try {
      if (typeof runtime.sessionStore?.close === "function") {
        await runtime.sessionStore.close();
      } else if (typeof runtime.sessionStore?.flush === "function") {
        await runtime.sessionStore.flush();
      }
    } catch (error) {
      console.error(`[codex-im] failed to close session store: ${error.message}`);
    }
  })();

  return runtime.stopPromise;
}

function clearTimerMap(map) {
  if (!(map instanceof Map)) {
    return;
  }
  for (const timer of map.values()) {
    clearTimeout(timer);
  }
  map.clear();
}

function pickNamedFunctions(source, names) {
  const forwarders = {};
  for (const name of names) {
    if (typeof source?.[name] === "function") {
      forwarders[name] = source[name];
    }
  }
  return forwarders;
}

module.exports = {
  attachRuntimeForwarders,
  buildCommonPlainForwarders,
  buildCommonRuntimeFirstForwarders,
  initializeCommonRuntimeState,
  startRuntimeCodex,
  stopRuntime,
};
