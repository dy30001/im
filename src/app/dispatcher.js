const messageNormalizers = require("../presentation/message/normalizers");
const eventsRuntime = require("./codex-event-service");
const { formatFailureText } = require("../shared/error-text");

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
  if (normalized && typeof runtime.rememberInboundContext === "function") {
    runtime.rememberInboundContext(normalized);
  }
  const prepared = await prepareOpenClawNormalizedEvent(runtime, normalized);
  if (runtime.config.verboseCodexLogs) {
    console.log(
      `[codex-im] openclaw normalized command=${prepared?.command || "-"} `
      + `chat=${prepared?.chatId || "-"} message=${prepared?.messageId || "-"}`
    );
  }
  return onNormalizedTextEvent(runtime, prepared, { alreadyRemembered: true });
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

  const workspaceContext = await runtime.resolveWorkspaceContext(normalized, {
    replyToMessageId: normalized.messageId,
    missingWorkspaceText: "当前会话还未绑定项目。先发送 `/codex bind /绝对路径`。",
  });
  if (!workspaceContext) {
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

async function prepareOpenClawNormalizedEvent(runtime, normalized) {
  if (!normalized || normalized.inputKind !== "voice") {
    return normalized;
  }

  try {
    const transcribedText = await runtime.transcribeOpenClawVoiceMessage(normalized);
    if (runtime.config.verboseCodexLogs) {
      const previewLength = String(transcribedText || "").length;
      console.log(
        `[codex-im] openclaw transcribed voice message=${normalized.messageId} `
        + `text_length=${previewLength}`
      );
    }
    return messageNormalizers.applyNormalizedText(normalized, transcribedText);
  } catch (error) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: formatFailureText("语音转写失败", error),
    });
    return null;
  }
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
