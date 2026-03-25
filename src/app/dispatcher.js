const messageNormalizers = require("../presentation/message/normalizers");
const eventsRuntime = require("./codex-event-service");
const {
  buildFirstUseWorkspaceGuideText,
  buildMissingWorkspaceGuideText,
  formatFailureText,
} = require("../shared/error-text");

async function onFeishuTextEvent(runtime, event) {
  if (runtime.isStopping) {
    return;
  }
  const normalized = messageNormalizers.normalizeFeishuTextEvent(event, runtime.config);
  return onNormalizedTextEvent(runtime, normalized);
}

async function onOpenClawTextEvent(runtime, message) {
  if (runtime.isStopping) {
    return;
  }
  const normalized = messageNormalizers.normalizeOpenClawTextEvent(message, runtime.config);
  if (!normalized) {
    return;
  }
  if (typeof runtime.rememberInboundContext === "function") {
    runtime.rememberInboundContext(normalized);
  }
  if (runtime.config.verboseCodexLogs) {
    console.log(
      `[codex-im] openclaw normalized command=${normalized?.command || "-"} `
      + `chat=${normalized?.chatId || "-"} message=${normalized?.messageId || "-"}`
    );
  }
  return onNormalizedTextEvent(runtime, normalized, { alreadyRemembered: true });
}

async function onNormalizedTextEvent(runtime, normalized, { alreadyRemembered = false } = {}) {
  if (!normalized) {
    return;
  }
  if (!alreadyRemembered && typeof runtime.rememberInboundContext === "function") {
    runtime.rememberInboundContext(normalized);
  }

  if (await runtime.dispatchTextCommand(normalized)) {
    return;
  }

  const bindingKeyForGuide = runtime.sessionStore.buildBindingKey(normalized);
  const shouldUseFirstGuide = shouldSendFirstUseWorkspaceGuide(runtime, bindingKeyForGuide);
  const workspaceContext = await runtime.resolveWorkspaceContext(normalized, {
    replyToMessageId: normalized.messageId,
    missingWorkspaceText: shouldUseFirstGuide
      ? buildFirstUseWorkspaceGuideText()
      : buildMissingWorkspaceGuideText(),
  });
  if (!workspaceContext) {
    if (shouldUseFirstGuide) {
      markFirstUseWorkspaceGuideSent(runtime, bindingKeyForGuide);
    }
    return;
  }
  const { bindingKey, workspaceRoot } = workspaceContext;
  const { threadId } = await runtime.resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
  });

  runtime.setPendingBindingContext(bindingKey, normalized);
  if (threadId) {
    runtime.setPendingThreadContext(threadId, normalized);
  }

  await runtime.addPendingReaction(bindingKey, normalized.messageId);

  try {
    const resolvedThreadId = await runtime.ensureThreadAndSendMessage({
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
      forceRecoverThread: true,
    });
    runtime.movePendingReactionToThread(bindingKey, resolvedThreadId);
  } catch (error) {
    await runtime.clearPendingReactionForBinding(bindingKey);
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: formatFailureText("处理失败", error),
    });
    throw error;
  }
}

function shouldSendFirstUseWorkspaceGuide(runtime, bindingKey) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  if (!normalizedBindingKey) {
    return false;
  }
  if (!(runtime.firstUseWorkspaceGuideSentByBindingKey instanceof Set)) {
    runtime.firstUseWorkspaceGuideSentByBindingKey = new Set();
  }
  return !runtime.firstUseWorkspaceGuideSentByBindingKey.has(normalizedBindingKey);
}

function markFirstUseWorkspaceGuideSent(runtime, bindingKey) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  if (!normalizedBindingKey) {
    return;
  }
  if (!(runtime.firstUseWorkspaceGuideSentByBindingKey instanceof Set)) {
    runtime.firstUseWorkspaceGuideSentByBindingKey = new Set();
  }
  runtime.firstUseWorkspaceGuideSentByBindingKey.add(normalizedBindingKey);
}

async function onFeishuCardAction(runtime, data) {
  if (runtime.isStopping) {
    return runtime.buildCardToast("当前正在停止，请稍后重试。");
  }
  try {
    return await runtime.handleCardAction(data);
  } catch (error) {
    console.error(`[codex-im] failed to process card action: ${error.message}`);
    return runtime.buildCardToast(formatFailureText("处理失败", error));
  }
}

function onCodexMessage(runtime, message) {
  eventsRuntime.handleCodexMessage(runtime, message);
}

module.exports = {
  onCodexMessage,
  onFeishuCardAction,
  onFeishuTextEvent,
  onOpenClawTextEvent,
};
