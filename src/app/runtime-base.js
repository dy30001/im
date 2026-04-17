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

module.exports = {
  attachRuntimeForwarders,
  initializeCommonRuntimeState,
};
