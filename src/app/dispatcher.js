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

async function onNormalizedTextEvent(runtime, normalized, { alreadyRemembered = false, skipDispatchLock = false } = {}) {
  if (!normalized) {
    return { status: "noop" };
  }
  if (!alreadyRemembered && typeof runtime.rememberInboundContext === "function") {
    runtime.rememberInboundContext(normalized);
  }

  if (await runtime.dispatchTextCommand(normalized)) {
    return { status: "handled" };
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
    return { status: "handled" };
  }
  const { bindingKey, workspaceRoot } = workspaceContext;
  let ownsBindingLock = false;
  let keepBindingLock = false;
  if (!skipDispatchLock) {
    if (!tryAcquireBindingDispatchLock(runtime, bindingKey)) {
      const queueAheadCount = enqueueBindingMessage(runtime, bindingKey, normalized);
      await sendQueuedMessageNotice(runtime, normalized, "dispatching", queueAheadCount);
      return { status: "queued", queueAheadCount };
    }
    ownsBindingLock = true;
  }

  try {
    const { threadId } = await runtime.resolveWorkspaceThreadState({
      bindingKey,
      workspaceRoot,
      normalized,
      autoSelectThread: true,
      refreshThreadList: false,
      allowClaimedThreadReuse: false,
    });

    const busyState = resolveBusyThreadState(runtime, threadId);
    if (busyState) {
      const queueAheadCount = enqueueBindingMessage(runtime, bindingKey, normalized);
      await sendQueuedMessageNotice(runtime, normalized, busyState, queueAheadCount);
      keepBindingLock = true;
      return { status: "queued", queueAheadCount };
    }

    const acknowledgedNormalized = await maybeSendOpenClawInboundReceipt(runtime, normalized);
    const preparedNormalized = typeof runtime.prepareInboundMessage === "function"
      ? await runtime.prepareInboundMessage(acknowledgedNormalized, { bindingKey, workspaceRoot })
      : acknowledgedNormalized;
    const effectiveNormalized = preparedNormalized || acknowledgedNormalized;

    runtime.setPendingBindingContext(bindingKey, effectiveNormalized);
    if (threadId) {
      runtime.setPendingThreadContext(threadId, effectiveNormalized);
    }

    await runtime.addPendingReaction(bindingKey, effectiveNormalized.messageId);

    try {
      const resolvedThreadId = await runtime.ensureThreadAndSendMessage({
        bindingKey,
        workspaceRoot,
        normalized: effectiveNormalized,
        threadId,
        forceRecoverThread: true,
      });
      runtime.movePendingReactionToThread(bindingKey, resolvedThreadId);
      keepBindingLock = true;
      return { status: "started", threadId: resolvedThreadId };
    } catch (error) {
      await runtime.clearPendingReactionForBinding(bindingKey);
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: normalized.messageId,
        text: formatFailureText("处理失败", error),
      });
      throw error;
    }
  } finally {
    if (ownsBindingLock && !keepBindingLock) {
      releaseBindingDispatchLock(runtime, bindingKey);
    }
  }
}

async function processQueuedNormalizedTextEvent(runtime, normalized) {
  return onNormalizedTextEvent(runtime, normalized, {
    alreadyRemembered: true,
    skipDispatchLock: true,
  });
}

async function drainQueuedMessagesForBinding(runtime, bindingKey) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  if (!normalizedBindingKey) {
    return false;
  }

  while (!runtime.isStopping) {
    const nextNormalized = shiftQueuedMessage(runtime, normalizedBindingKey);
    if (!nextNormalized) {
      releaseBindingDispatchLock(runtime, normalizedBindingKey);
      return false;
    }

    try {
      const outcome = await processQueuedNormalizedTextEvent(runtime, nextNormalized);
      if (outcome?.status === "started" || outcome?.status === "queued") {
        return true;
      }
    } catch (error) {
      console.error(`[codex-im] failed to process queued message: ${error.message}`);
    }
  }

  releaseBindingDispatchLock(runtime, normalizedBindingKey);
  return false;
}

function tryAcquireBindingDispatchLock(runtime, bindingKey) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  if (!normalizedBindingKey) {
    return true;
  }

  const inFlightBindings = getInFlightBindingDispatchSet(runtime);
  if (inFlightBindings.has(normalizedBindingKey)) {
    return false;
  }
  inFlightBindings.add(normalizedBindingKey);
  return true;
}

function releaseBindingDispatchLock(runtime, bindingKey) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  if (!normalizedBindingKey) {
    return;
  }
  getInFlightBindingDispatchSet(runtime).delete(normalizedBindingKey);
}

function normalizeBindingKey(bindingKey) {
  return String(bindingKey || "").trim();
}

function getInFlightBindingDispatchSet(runtime) {
  if (!(runtime.inFlightBindingDispatchKeys instanceof Set)) {
    runtime.inFlightBindingDispatchKeys = new Set();
  }
  return runtime.inFlightBindingDispatchKeys;
}

function getPendingMessageQueueMap(runtime) {
  if (!(runtime.pendingMessageQueueByBindingKey instanceof Map)) {
    runtime.pendingMessageQueueByBindingKey = new Map();
  }
  return runtime.pendingMessageQueueByBindingKey;
}

function enqueueBindingMessage(runtime, bindingKey, normalized) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  if (!normalizedBindingKey || !normalized) {
    return 0;
  }

  const queues = getPendingMessageQueueMap(runtime);
  const queue = queues.get(normalizedBindingKey) || [];
  const queueAheadCount = queue.length + 1;
  queue.push(normalized);
  queues.set(normalizedBindingKey, queue);
  return queueAheadCount;
}

function shiftQueuedMessage(runtime, bindingKey) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  if (!normalizedBindingKey) {
    return null;
  }

  const queues = getPendingMessageQueueMap(runtime);
  const queue = queues.get(normalizedBindingKey) || null;
  if (!Array.isArray(queue) || queue.length === 0) {
    queues.delete(normalizedBindingKey);
    return null;
  }

  const nextNormalized = queue.shift() || null;
  if (queue.length === 0) {
    queues.delete(normalizedBindingKey);
  } else {
    queues.set(normalizedBindingKey, queue);
  }
  return nextNormalized;
}

function resolveBusyThreadState(runtime, threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    return "";
  }
  if (runtime.pendingApprovalByThreadId?.has(normalizedThreadId)) {
    return "approval";
  }
  if (runtime.activeTurnIdByThreadId?.has(normalizedThreadId)) {
    return "running";
  }
  return "";
}

async function sendQueuedMessageNotice(runtime, normalized, state, queueAheadCount) {
  await runtime.sendInfoCardMessage({
    chatId: normalized.chatId,
    replyToMessageId: normalized.messageId,
    contextToken: normalized.contextToken || "",
    text: buildQueuedMessageNoticeText(normalized, state, queueAheadCount),
  });
}

function buildQueuedMessageNoticeText(normalized, state, queueAheadCount) {
  const receivedPrefix = buildQueuedMessagePrefix(normalized);
  const normalizedQueueAheadCount = Number.isFinite(queueAheadCount) && queueAheadCount > 0
    ? Math.floor(queueAheadCount)
    : 1;
  const queueText = normalizedQueueAheadCount === 1
    ? "当前前面还有 1 条消息。"
    : `当前前面还有 ${normalizedQueueAheadCount} 条消息。`;
  if (state === "approval") {
    return `${receivedPrefix}，上一条消息正在等待授权，已加入队列。${queueText}轮到时会自动继续；需要中断可发送 \`/codex stop\`。`;
  }
  if (state === "dispatching") {
    return `${receivedPrefix}，上一条消息刚开始处理，已加入队列。${queueText}轮到时会自动继续；需要中断可发送 \`/codex stop\`。`;
  }
  return `${receivedPrefix}，上一条消息还在处理中，已加入队列。${queueText}轮到时会自动继续；需要中断可发送 \`/codex stop\`。`;
}

function buildQueuedMessagePrefix(normalized) {
  const attachments = Array.isArray(normalized?.attachments) ? normalized.attachments : [];
  if (attachments.length > 0) {
    return buildInboundAttachmentReceiptPrefix(attachments);
  }
  return "已收到消息";
}

async function maybeSendOpenClawInboundReceipt(runtime, normalized) {
  if (!shouldSendOpenClawInboundReceipt(runtime, normalized)) {
    return normalized;
  }

  await runtime.sendInfoCardMessage({
    chatId: normalized.chatId,
    replyToMessageId: normalized.messageId,
    contextToken: normalized.contextToken || "",
    kind: "progress",
    text: buildOpenClawInboundReceiptText(normalized.attachments),
  });

  return {
    ...normalized,
    openclawReceiptAcked: true,
  };
}

function shouldSendOpenClawInboundReceipt(runtime, normalized) {
  if (!runtime || typeof runtime.supportsInteractiveCards !== "function" || runtime.supportsInteractiveCards()) {
    return false;
  }
  if (normalized?.provider !== "openclaw" || normalized?.command !== "message") {
    return false;
  }
  return Array.isArray(normalized?.attachments) && normalized.attachments.length > 0;
}

function buildOpenClawInboundReceiptText(attachments) {
  return `${buildInboundAttachmentReceiptPrefix(attachments)}，正在下载并处理，请稍等。`;
}

function buildInboundAttachmentReceiptPrefix(attachments) {
  const kinds = new Set((attachments || []).map((attachment) => String(attachment?.kind || "").trim()));
  if (kinds.size === 1 && kinds.has("image")) {
    return "已收到图片";
  }
  if (kinds.size === 1 && kinds.has("file")) {
    return "已收到文件";
  }
  return "已收到附件";
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
  drainQueuedMessagesForBinding,
  onCodexMessage,
  onFeishuCardAction,
  onFeishuTextEvent,
  onOpenClawTextEvent,
  processQueuedNormalizedTextEvent,
};
