const codexMessageUtils = require("../infra/codex/message-utils");
const { formatFailureText } = require("../shared/error-text");

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
      runtime.clearPendingReactionForThread(threadId).catch((error) => {
        console.error(`[codex-im] failed to clear pending reaction: ${error.message}`);
      });
      runtime.cleanupThreadRuntimeState(threadId);
  });
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
      if (!streamingOutput) {
        return;
      }
      await runtime.upsertAssistantReplyCard({
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        chatId: event.payload.chatId,
        state: "streaming",
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

module.exports = {
  deliverToProvider,
  handleCodexMessage,
  handleStopCommand,
  logProviderDeliveryFailureOnce,
};
