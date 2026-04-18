const codexMessageUtils = require("../infra/codex/message-utils");
const { formatFailureText } = require("../shared/error-text");
const {
  calculatePerfDurationMs,
  getPerfFlag,
  getPerfTrace,
  logPerf,
  markPerfTimestamp,
  setPerfFlag,
  setPerfTraceFields,
} = require("../shared/perf-trace");

async function handleStopCommand(runtime, normalized) {
  const bindingKey = runtime.sessionStore.buildBindingKey(normalized);
  const workspaceRoot = runtime.resolveWorkspaceRootForBinding(bindingKey);
  const threadId = workspaceRoot ? runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot) : null;
  const turnId = threadId ? runtime.activeTurnIdByThreadId.get(threadId) || null : null;

  if (!threadId) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "当前会话还没有可停止的运行任务。",
    });
    return;
  }

  try {
    await runtime.codex.sendRequest("turn/cancel", {
      threadId,
      turnId,
    });
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "已发送停止请求。",
    });
  } catch (error) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: formatFailureText("停止失败", error),
    });
  }
}

function handleCodexMessage(runtime, message) {
  if (runtime.isStopping) {
    return;
  }
  if (typeof message?.method === "string") {
    if (runtime.config.verboseCodexLogs) {
      console.log(`[codex-im] codex event ${message.method}`);
    }
  }
  codexMessageUtils.trackRunningTurn(runtime.activeTurnIdByThreadId, message);
  trackTurnActivity(runtime, message);
  codexMessageUtils.trackPendingApproval(runtime.pendingApprovalByThreadId, message);
  codexMessageUtils.trackRunKeyState(runtime.currentRunKeyByThreadId, runtime.activeTurnIdByThreadId, message);
  runtime.pruneRuntimeMapSizes();
  const outbound = codexMessageUtils.mapCodexMessageToImEvent(message);
  if (!outbound) {
    return;
  }

  const threadId = outbound.payload?.threadId || "";
  if (!outbound.payload.turnId) {
    outbound.payload.turnId = runtime.activeTurnIdByThreadId.get(threadId) || "";
  }
  if (
    threadId
    && typeof runtime.shouldDeliverThreadEventForActiveWorkspace === "function"
    && !runtime.shouldDeliverThreadEventForActiveWorkspace(threadId)
  ) {
    const shouldCleanupThreadState = isTerminalTurnMessage(message);
    if (shouldCleanupThreadState) {
      const context = runtime.pendingChatContextByThreadId.get(threadId) || null;
      finalizeTerminalTurn(runtime, threadId, context).catch((error) => {
        console.error(`[codex-im] failed to finalize terminal turn: ${error.message}`);
      });
    }
    return;
  }
  if (
    threadId
    && typeof runtime.markThreadSyncLocalActivity === "function"
    && (outbound.type === "im.agent_reply" || outbound.type === "im.run_state")
  ) {
    runtime.markThreadSyncLocalActivity(threadId);
  }
  const context = runtime.pendingChatContextByThreadId.get(threadId);
  if (context) {
    outbound.payload.chatId = context.chatId;
    outbound.payload.threadKey = context.threadKey;
  }
  recordCodexTurnPerf(runtime, outbound, context);
  persistActiveWorkspaceThreadSelection(runtime, threadId, context);

  if (codexMessageUtils.eventShouldClearPendingReaction(outbound)) {
    runtime.clearPendingReactionForThread(threadId).catch((error) => {
      console.error(`[codex-im] failed to clear pending reaction: ${error.message}`);
    });
  }

  const shouldCleanupThreadState = isTerminalTurnMessage(message);
  runtime.deliverToProvider(outbound)
    .catch((error) => {
      logProviderDeliveryFailureOnce(runtime, outbound, error);
    })
    .finally(() => {
      if (!shouldCleanupThreadState || !threadId) {
        return;
      }
      finalizeTerminalTurn(runtime, threadId, context).catch((error) => {
        console.error(`[codex-im] failed to finalize terminal turn: ${error.message}`);
      });
    });
}

async function finalizeTerminalTurn(runtime, threadId, context) {
  const bindingKey = resolveBindingKeyForTerminalTurn(runtime, threadId, context);
  logCompletedTurnPerf(runtime, threadId, context);
  await runtime.clearPendingReactionForThread(threadId).catch((error) => {
    console.error(`[codex-im] failed to clear pending reaction: ${error.message}`);
  });
  runtime.cleanupThreadRuntimeState(threadId);
  if (!bindingKey || typeof runtime.drainQueuedMessagesForBinding !== "function") {
    return;
  }
  await runtime.drainQueuedMessagesForBinding(bindingKey);
}

function resolveBindingKeyForTerminalTurn(runtime, threadId, context) {
  const fromThreadMap = String(runtime.bindingKeyByThreadId?.get(threadId) || "").trim();
  if (fromThreadMap) {
    return fromThreadMap;
  }
  if (!context || typeof runtime.sessionStore?.buildBindingKey !== "function") {
    return "";
  }
  return String(runtime.sessionStore.buildBindingKey(context) || "").trim();
}

function persistActiveWorkspaceThreadSelection(runtime, threadId, context) {
  const normalizedThreadId = String(threadId || "").trim();
  if (
    !normalizedThreadId
    || typeof runtime?.sessionStore?.getActiveWorkspaceRoot !== "function"
    || typeof runtime?.sessionStore?.getThreadIdForWorkspace !== "function"
    || typeof runtime?.sessionStore?.setThreadIdForWorkspace !== "function"
  ) {
    return;
  }

  const bindingKey = resolveBindingKeyForTerminalTurn(runtime, normalizedThreadId, context);
  if (!bindingKey) {
    return;
  }

  const activeWorkspaceRoot = String(runtime.sessionStore.getActiveWorkspaceRoot(bindingKey) || "").trim();
  const threadWorkspaceRoot = typeof runtime?.resolveWorkspaceRootForThread === "function"
    ? String(runtime.resolveWorkspaceRootForThread(normalizedThreadId) || "").trim()
    : "";
  if (!activeWorkspaceRoot || !threadWorkspaceRoot || activeWorkspaceRoot !== threadWorkspaceRoot) {
    return;
  }

  const currentSelectedThreadId = String(
    runtime.sessionStore.getThreadIdForWorkspace(bindingKey, activeWorkspaceRoot) || ""
  ).trim();
  if (currentSelectedThreadId) {
    return;
  }

  runtime.sessionStore.setThreadIdForWorkspace(
    bindingKey,
    activeWorkspaceRoot,
    normalizedThreadId,
    context ? codexMessageUtils.buildBindingMetadata(context) : {}
  );
}

function logProviderDeliveryFailureOnce(runtime, outbound, error) {
  const logKey = buildProviderDeliveryFailureKey(outbound, error);
  const seenKeys = getRuntimeLogKeySet(runtime, "_providerDeliveryFailureLogKeys");
  if (logKey && seenKeys.has(logKey)) {
    return false;
  }
  if (logKey) {
    seenKeys.add(logKey);
  }
  console.error(`[codex-im] failed to deliver provider message: ${error.message}`);
  return true;
}

function buildProviderDeliveryFailureKey(outbound, error) {
  const eventType = String(outbound?.type || "").trim();
  const threadId = String(outbound?.payload?.threadId || "").trim();
  const message = String(error?.message || "").trim().toLowerCase();
  if (!eventType && !threadId && !message) {
    return "";
  }
  return `${eventType || "<event>"}|${threadId || "<thread>"}|${message || "<unknown>"}`;
}

function getRuntimeLogKeySet(runtime, propertyName) {
  if (!runtime) {
    return new Set();
  }
  if (!(runtime[propertyName] instanceof Set)) {
    runtime[propertyName] = new Set();
  }
  return runtime[propertyName];
}

function recordCodexTurnPerf(runtime, outbound, context) {
  const threadId = String(outbound?.payload?.threadId || "").trim();
  if (!threadId) {
    return;
  }
  const trace = getPerfTrace(context);
  if (!trace) {
    return;
  }

  const turnId = String(outbound?.payload?.turnId || "").trim();
  setPerfTraceFields(trace, {
    threadId,
    turnId,
    chatId: outbound?.payload?.chatId || trace.chatId,
    workspaceRoot: resolvePerfWorkspaceRoot(runtime, threadId),
  });

  if (
    outbound.type === "im.run_state"
    && outbound.payload?.state === "streaming"
    && !getPerfFlag(trace, "turn_started_logged")
  ) {
    const turnStartedAt = Date.now();
    markPerfTimestamp(trace, "turnStartedAt", turnStartedAt);
    setPerfFlag(trace, "turn_started_logged");
    logPerf(runtime, "phone-turn-started", {
      chat: trace.chatId,
      msg: trace.messageId,
      workspace: trace.workspaceRoot,
      thread: threadId,
      turn: turnId,
      totalMs: calculatePerfDurationMs(trace.startedAt, turnStartedAt),
    });
  }

  if (outbound.type === "im.agent_reply" && !getPerfFlag(trace, "first_codex_reply_logged")) {
    const firstReplyAt = Date.now();
    markPerfTimestamp(trace, "firstCodexReplyAt", firstReplyAt);
    setPerfFlag(trace, "first_codex_reply_logged");
    logPerf(runtime, "phone-first-codex-reply", {
      chat: trace.chatId,
      msg: trace.messageId,
      workspace: trace.workspaceRoot,
      thread: threadId,
      turn: turnId,
      totalMs: calculatePerfDurationMs(trace.startedAt, firstReplyAt),
      sinceTurnMs: calculatePerfDurationMs(trace.turnStartedAt, firstReplyAt),
    });
  }
}

function logCompletedTurnPerf(runtime, threadId, context) {
  const trace = getPerfTrace(context);
  if (!trace || getPerfFlag(trace, "turn_completed_logged")) {
    return false;
  }
  const completedAt = Date.now();
  markPerfTimestamp(trace, "completedAt", completedAt);
  setPerfFlag(trace, "turn_completed_logged");
  return logPerf(runtime, "phone-turn-completed", {
    chat: trace.chatId,
    msg: trace.messageId,
    workspace: trace.workspaceRoot || resolvePerfWorkspaceRoot(runtime, threadId),
    thread: threadId || trace.threadId,
    turn: trace.turnId,
    totalMs: calculatePerfDurationMs(trace.startedAt, completedAt),
    firstCodexReplyMs: calculatePerfDurationMs(trace.startedAt, trace.firstCodexReplyAt),
    firstPhoneReplyMs: calculatePerfDurationMs(trace.startedAt, trace.firstPhoneReplyAt),
  });
}

function resolvePerfWorkspaceRoot(runtime, threadId) {
  if (!threadId || typeof runtime?.resolveWorkspaceRootForThread !== "function") {
    return "";
  }
  return String(runtime.resolveWorkspaceRootForThread(threadId) || "").trim();
}

async function deliverToProvider(runtime, event) {
  if (runtime.isStopping) {
    return;
  }
  const streamingOutput = runtime.supportsInteractiveCards()
    ? runtime.config.feishuStreamingOutput
    : runtime.config.openclawStreamingOutput;

  if (event.type === "im.agent_reply") {
    await runtime.upsertAssistantReplyCard({
      threadId: event.payload.threadId,
      turnId: event.payload.turnId,
      chatId: event.payload.chatId,
      text: event.payload.text,
      state: "streaming",
      deferFlush: !streamingOutput,
    });
    return;
  }

  if (event.type === "im.run_state") {
    if (event.payload.state === "streaming") {
      await runtime.upsertAssistantReplyCard({
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        chatId: event.payload.chatId,
        state: "streaming",
        deferFlush: !streamingOutput,
      });
    } else if (event.payload.state === "completed") {
      await runtime.upsertAssistantReplyCard({
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        chatId: event.payload.chatId,
        state: "completed",
      });
    } else if (event.payload.state === "failed") {
      await runtime.upsertAssistantReplyCard({
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        chatId: event.payload.chatId,
        text: event.payload.text || "执行失败",
        state: "failed",
      });
    }
    return;
  }

  if (event.type === "im.approval_request") {
    const approval = runtime.pendingApprovalByThreadId.get(event.payload.threadId);
    if (!approval) {
      return;
    }
    const autoApproved = await runtime.tryAutoApproveRequest(event.payload.threadId, approval);
    if (autoApproved) {
      return;
    }
    approval.chatId = event.payload.chatId || approval.chatId || "";
    approval.replyToMessageId = runtime.pendingChatContextByThreadId.get(event.payload.threadId)?.messageId || approval.replyToMessageId || "";
    const response = await runtime.sendInteractiveApprovalCard({
      chatId: approval.chatId,
      approval,
      replyToMessageId: approval.replyToMessageId || "",
    });
    const messageId = codexMessageUtils.extractCreatedMessageId(response);
    if (messageId) {
      approval.cardMessageId = messageId;
    }
  }
}

function isTerminalTurnMessage(message) {
  const method = typeof message?.method === "string" ? message.method : "";
  return method === "turn/completed" || method === "turn/failed" || method === "turn/cancelled";
}

function trackTurnActivity(runtime, message, now = Date.now()) {
  const method = typeof message?.method === "string" ? message.method : "";
  const params = message?.params || {};
  const threadId = String(params?.threadId || "").trim();
  if (!threadId) {
    return;
  }

  const turnId = String(params?.turnId || params?.turn?.id || runtime.activeTurnIdByThreadId.get(threadId) || "").trim();
  if (isTerminalTurnMessage(message)) {
    runtime.activeTurnStartedAtByThreadId?.delete(threadId);
    runtime.lastTurnActivityAtByThreadId?.delete(threadId);
    return;
  }

  if (method === "turn/started" || method === "turn/start") {
    if (turnId && !runtime.activeTurnStartedAtByThreadId?.has(threadId)) {
      runtime.activeTurnStartedAtByThreadId?.set(threadId, now);
    }
    runtime.lastTurnActivityAtByThreadId?.set(threadId, now);
    return;
  }

  if (turnId || runtime.activeTurnIdByThreadId?.has(threadId) || runtime.lastTurnActivityAtByThreadId?.has(threadId)) {
    runtime.lastTurnActivityAtByThreadId?.set(threadId, now);
  }
}

module.exports = {
  deliverToProvider,
  handleCodexMessage,
  handleStopCommand,
  logProviderDeliveryFailureOnce,
};
