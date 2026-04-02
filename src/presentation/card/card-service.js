const codexMessageUtils = require("../../infra/codex/message-utils");
const messageNormalizers = require("../message/normalizers");
const reactionRepo = require("../../infra/feishu/reaction-repo");
const { formatFailureText } = require("../../shared/error-text");
const {
  buildApprovalCard,
  buildApprovalResolvedCard,
  buildAssistantReplyCard,
  buildCardResponse,
  buildInfoCard,
  mergeReplyText,
  summarizeCardToText,
} = require("./builders");

const DEFAULT_OPENCLAW_PROGRESS_NOTICE_DELAY_MS = 2500;
const DEFAULT_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_OPENCLAW_PROGRESS_NOTICE_TEXT = "已收到，正在处理，请稍等。";
const DEFAULT_OPENCLAW_PROGRESS_FOLLOWUP_TEXT = "已经处理 5 分钟了，还在继续，请稍等。";

async function sendInfoCardMessage(
  runtime,
  {
    chatId,
    text,
    replyToMessageId = "",
    replyInThread = false,
    kind = "info",
    selectionContext = null,
    contextToken = "",
  }
) {
  if (!chatId || !text) {
    return null;
  }

  if (!runtime.supportsInteractiveCards()) {
    const response = await runtime.sendTextMessage({
      chatId,
      replyToMessageId,
      contextToken,
      text: formatPlainTextNotice(text, kind),
    });
    rememberSelectionContext(runtime, {
      chatId,
      replyToMessageId,
      selectionContext,
      response,
    });
    return response;
  }

  return sendInteractiveCard(runtime, {
    chatId,
    replyToMessageId,
    replyInThread,
    card: buildInfoCard(text, { kind }),
    selectionContext,
  });
}

async function sendFeedbackByContext(runtime, normalized, { text, kind = "info", replyToMessageId = "" } = {}) {
  if (!normalized?.chatId || !text) {
    return null;
  }
  return sendInfoCardMessage(runtime, {
    chatId: normalized.chatId,
    replyToMessageId: replyToMessageId || normalized.messageId || "",
    text,
    kind,
  });
}

async function sendInteractiveApprovalCard(runtime, { chatId, approval, replyToMessageId = "", replyInThread = false }) {
  if (!chatId || !approval) {
    return null;
  }

  if (!runtime.supportsInteractiveCards()) {
    return runtime.sendTextMessage({
      chatId,
      replyToMessageId,
      text: buildApprovalFallbackText(approval),
    });
  }

  return sendInteractiveCard(runtime, {
    chatId,
    replyToMessageId,
    replyInThread,
    card: buildApprovalCard(approval),
  });
}

async function updateInteractiveCard(runtime, { messageId, approval }) {
  if (!messageId || !approval) {
    return null;
  }
  if (!runtime.supportsInteractiveCards()) {
    return null;
  }
  return patchInteractiveCard(runtime, {
    messageId,
    card: buildApprovalResolvedCard(approval),
  });
}

async function sendInteractiveCard(
  runtime,
  { chatId, card, replyToMessageId = "", replyInThread = false, selectionContext = null }
) {
  if (!chatId || !card) {
    return null;
  }

  let response;
  if (!runtime.supportsInteractiveCards()) {
    response = await runtime.sendTextMessage({
      chatId,
      replyToMessageId,
      text: summarizeCardToText(card),
    });
  } else {
    response = await runtime.requireFeishuAdapter().sendInteractiveCard({
      chatId,
      card,
      replyToMessageId,
      replyInThread,
    });
  }

  rememberSelectionContext(runtime, {
    chatId,
    replyToMessageId,
    selectionContext,
    response,
  });
  return response;
}

async function patchInteractiveCard(runtime, { messageId, card }) {
  if (!messageId || !card) {
    return null;
  }
  if (!runtime.supportsInteractiveCards()) {
    return null;
  }
  return runtime.requireFeishuAdapter().patchInteractiveCard({ messageId, card });
}

function rememberSelectionContext(runtime, { chatId, replyToMessageId = "", selectionContext = null, response = null } = {}) {
  if (typeof runtime.rememberSelectionContext !== "function") {
    return;
  }

  const bindingKey = String(selectionContext?.bindingKey || "").trim();
  const command = String(selectionContext?.command || "").trim();
  if (!bindingKey || !command) {
    return;
  }

  runtime.rememberSelectionContext({
    bindingKey,
    command,
    page: normalizeSelectionPage(selectionContext?.page),
    messageId: codexMessageUtils.extractCreatedMessageId(response),
    chatId,
    replyToMessageId,
  });
}

function normalizeSelectionPage(page) {
  const numericPage = Number(page);
  if (!Number.isFinite(numericPage)) {
    return 0;
  }
  return Math.max(Math.floor(numericPage), 0);
}

async function handleCardAction(runtime, data) {
  if (runtime.isStopping) {
    return buildCardToast("当前正在停止，请稍后重试。");
  }
  const action = messageNormalizers.extractCardAction(data);
  if (runtime.config.verboseCodexLogs) {
    console.log(
      `[codex-im] card callback kind=${action?.kind || "-"} action=${action?.action || "-"} `
      + `thread=${action?.threadId || "-"} page=${action?.page ?? "-"} `
      + `request=${action?.requestId || "-"} selected=${action?.selectedValue || "-"} `
      + `message=${data?.context?.open_message_id || "-"}`
    );
  }
  if (!action) {
    runCardActionTask(runtime, sendCardActionFeedback(runtime, data, "无法识别卡片操作。", "error"));
    return buildCardToast("无法识别卡片操作。");
  }

  if (action.kind === "approval") {
    runCardActionTask(runtime, runtime.handleApprovalCardActionAsync(action, data));
    return buildCardToast("正在处理授权...");
  }

  const normalized = messageNormalizers.normalizeCardActionContext(data, runtime.config);
  if (!normalized) {
    runCardActionTask(runtime, sendCardActionFeedback(runtime, data, "无法解析当前卡片上下文。", "error"));
    return buildCardToast("无法解析当前卡片上下文。");
  }

  try {
    const handled = runtime.dispatchCardAction(action, normalized);
    if (handled) {
      return handled;
    }
  } catch (error) {
    runCardActionTask(
      runtime,
      sendCardActionFeedbackByContext(runtime, normalized, formatFailureText("处理失败", error), "error")
    );
    return buildCardToast(formatFailureText("处理失败", error));
  }

  runCardActionTask(runtime, sendCardActionFeedbackByContext(runtime, normalized, "未支持的卡片操作。", "error"));
  return buildCardToast("未支持的卡片操作。");
}

function queueCardActionWithFeedback(runtime, normalized, feedbackText, task) {
  runCardActionTask(runtime, (async () => {
    await task();
  })());
  return buildCardToast(feedbackText);
}

function runCardActionTask(runtime, taskPromise) {
  Promise.resolve(taskPromise).catch((error) => {
    console.error(`[codex-im] async card action failed: ${error.message}`);
  });
}

async function sendCardActionFeedbackByContext(runtime, normalized, text, kind = "info") {
  await sendFeedbackByContext(runtime, normalized, { text, kind });
}

async function sendCardActionFeedback(runtime, data, text, kind = "info") {
  const normalized = messageNormalizers.normalizeCardActionContext(data, runtime.config);
  if (!normalized) {
    return;
  }
  await sendCardActionFeedbackByContext(runtime, normalized, text, kind);
}

async function upsertAssistantReplyCard(
  runtime,
  { threadId, turnId, chatId, text, state, deferFlush = false }
) {
  if (!threadId || !chatId) {
    return;
  }

  const resolvedTurnId = turnId
    || runtime.activeTurnIdByThreadId.get(threadId)
    || codexMessageUtils.extractTurnIdFromRunKey(runtime.currentRunKeyByThreadId.get(threadId) || "")
    || "";
  const preferredRunKey = codexMessageUtils.buildRunKey(threadId, resolvedTurnId);
  let runKey = preferredRunKey;
  let existing = runtime.replyCardByRunKey.get(runKey) || null;

  if (!existing) {
    const currentRunKey = runtime.currentRunKeyByThreadId.get(threadId) || "";
    const currentEntry = runtime.replyCardByRunKey.get(currentRunKey) || null;
    const shouldReuseCurrent = !!(
      currentEntry
      && currentEntry.state !== "completed"
      && currentEntry.state !== "failed"
      && (!resolvedTurnId || !currentEntry.turnId || currentEntry.turnId === resolvedTurnId)
    );
    if (shouldReuseCurrent) {
      runKey = currentRunKey;
      existing = currentEntry;
    }
  }

  if (!existing) {
    existing = {
      messageId: "",
      chatId,
      replyToMessageId: "",
      contextToken: "",
      sentTextLength: 0,
      text: "",
      state: "streaming",
      threadId,
      turnId: resolvedTurnId,
      progressNoticeStage: 0,
    };
  }

  if (typeof text === "string" && text.trim()) {
    existing.text = mergeReplyText(existing.text, text.trim());
  }
  existing.chatId = chatId;
  existing.replyToMessageId = runtime.pendingChatContextByThreadId.get(threadId)?.messageId || existing.replyToMessageId || "";
  existing.contextToken = runtime.pendingChatContextByThreadId.get(threadId)?.contextToken || existing.contextToken || "";
  if (state) {
    existing.state = state;
  }
  if (resolvedTurnId) {
    existing.turnId = resolvedTurnId;
  }

  runtime.setReplyCardEntry(runKey, existing);
  runtime.setCurrentRunKeyForThread(threadId, runKey);

  if (!runtime.supportsInteractiveCards()) {
    if (shouldScheduleOpenClawProgressNotice(runtime, existing)) {
      scheduleOpenClawProgressNotices(runtime, runKey, existing);
    }
    if (runtime.config.openclawStreamingOutput && existing.text) {
      const unsentText = existing.text.slice(existing.sentTextLength || 0).trim();
      if (unsentText) {
        await runtime.sendTextMessage({
          chatId: entryChatId(existing, chatId),
          replyToMessageId: existing.replyToMessageId,
          contextToken: existing.contextToken,
          text: unsentText,
        });
        existing.sentTextLength = existing.text.length;
        runtime.setReplyCardEntry(runKey, existing);
      }
    }
    if (existing.state === "completed" || existing.state === "failed") {
      clearProgressNoticeTimers(runtime, runKey);
      const remainingText = existing.text.slice(existing.sentTextLength || 0).trim();
      const fallbackText = remainingText || (
        !existing.sentTextLength ? (existing.text || (existing.state === "failed" ? "执行失败" : "执行完成")) : ""
      );
      if (fallbackText) {
        await runtime.sendTextMessage({
          chatId: entryChatId(existing, chatId),
          replyToMessageId: existing.replyToMessageId,
          contextToken: existing.contextToken,
          text: fallbackText,
        });
      }
      runtime.disposeReplyRunState(runKey, threadId);
    }
    return;
  }

  if (deferFlush && existing.state !== "completed" && existing.state !== "failed") {
    return;
  }

  const shouldFlushImmediately = existing.state === "completed"
    || existing.state === "failed"
    || (!existing.messageId && typeof existing.text === "string" && existing.text.trim());
  await scheduleReplyCardFlush(runtime, runKey, { immediate: shouldFlushImmediately });
}

async function scheduleReplyCardFlush(runtime, runKey, { immediate = false } = {}) {
  const entry = runtime.replyCardByRunKey.get(runKey);
  if (!entry) {
    return;
  }

  if (immediate) {
    clearReplyFlushTimer(runtime, runKey);
    await flushReplyCard(runtime, runKey);
    return;
  }

  if (runtime.replyFlushTimersByRunKey.has(runKey)) {
    return;
  }

  const timer = setTimeout(() => {
    runtime.replyFlushTimersByRunKey.delete(runKey);
    flushReplyCard(runtime, runKey).catch((error) => {
      console.error(`[codex-im] failed to flush reply card: ${error.message}`);
    });
  }, 300);
  runtime.replyFlushTimersByRunKey.set(runKey, timer);
}

function clearReplyFlushTimer(runtime, runKey) {
  const timer = runtime.replyFlushTimersByRunKey.get(runKey);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  runtime.replyFlushTimersByRunKey.delete(runKey);
}

function shouldScheduleOpenClawProgressNotice(runtime, entry) {
  if (!runtime || (typeof runtime.supportsInteractiveCards === "function" && runtime.supportsInteractiveCards())) {
    return false;
  }
  if (runtime.config?.openclawStreamingOutput) {
    return false;
  }
  if (!entry || entry.state !== "streaming") {
    return false;
  }
  return Boolean(entry.threadId && entry.chatId);
}

function scheduleOpenClawProgressNotices(runtime, runKey, entry) {
  if (!shouldScheduleOpenClawProgressNotice(runtime, entry)) {
    return;
  }
  if (Number(entry.progressNoticeStage || 0) < 1) {
    scheduleOpenClawInitialProgressNotice(runtime, runKey, entry);
  }
  if (Number(entry.progressNoticeStage || 0) < 2) {
    scheduleOpenClawFollowupProgressNotice(runtime, runKey, entry);
  }
}

function scheduleOpenClawInitialProgressNotice(runtime, runKey, entry) {
  if (!runtime || !runKey || !entry) {
    return;
  }
  if (runtime.replyProgressTimersByRunKey instanceof Map && runtime.replyProgressTimersByRunKey.has(runKey)) {
    return;
  }

  const delayMs = resolveOpenClawProgressNoticeDelayMs(runtime);
  const timer = setTimeout(() => {
    if (runtime.replyProgressTimersByRunKey instanceof Map) {
      runtime.replyProgressTimersByRunKey.delete(runKey);
    }

    const currentEntry = runtime.replyCardByRunKey.get(runKey) || entry;
    if (
      !currentEntry
      || currentEntry.state !== "streaming"
      || Number(currentEntry.progressNoticeStage || 0) >= 1
      || runtime.isStopping
    ) {
      return;
    }

    currentEntry.progressNoticeStage = 1;
    runtime.setReplyCardEntry(runKey, currentEntry);
    runtime.sendTextMessage({
      chatId: entryChatId(currentEntry, currentEntry.chatId),
      replyToMessageId: currentEntry.replyToMessageId,
      contextToken: currentEntry.contextToken,
      text: buildOpenClawProgressNoticeText(),
    }).catch((error) => {
      console.error(`[codex-im] failed to send OpenClaw progress notice: ${error.message}`);
    });
  }, delayMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  if (runtime.replyProgressTimersByRunKey instanceof Map) {
    runtime.replyProgressTimersByRunKey.set(runKey, timer);
  }
}

function scheduleOpenClawFollowupProgressNotice(runtime, runKey, entry) {
  if (!runtime || !runKey || !entry) {
    return;
  }
  if (runtime.replyProgressFollowupTimersByRunKey instanceof Map && runtime.replyProgressFollowupTimersByRunKey.has(runKey)) {
    return;
  }

  const delayMs = resolveOpenClawProgressFollowupDelayMs(runtime);
  const timer = setTimeout(() => {
    if (runtime.replyProgressFollowupTimersByRunKey instanceof Map) {
      runtime.replyProgressFollowupTimersByRunKey.delete(runKey);
    }

    const currentEntry = runtime.replyCardByRunKey.get(runKey) || entry;
    if (
      !currentEntry
      || currentEntry.state !== "streaming"
      || Number(currentEntry.progressNoticeStage || 0) >= 2
      || runtime.isStopping
    ) {
      return;
    }

    currentEntry.progressNoticeStage = 2;
    runtime.setReplyCardEntry(runKey, currentEntry);
    runtime.sendTextMessage({
      chatId: entryChatId(currentEntry, currentEntry.chatId),
      replyToMessageId: currentEntry.replyToMessageId,
      contextToken: currentEntry.contextToken,
      text: buildOpenClawProgressFollowupText(),
    }).catch((error) => {
      console.error(`[codex-im] failed to send OpenClaw progress follow-up: ${error.message}`);
    });
  }, delayMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  if (runtime.replyProgressFollowupTimersByRunKey instanceof Map) {
    runtime.replyProgressFollowupTimersByRunKey.set(runKey, timer);
  }
}

function clearProgressNoticeTimer(runtime, runKey) {
  if (!runtime || !(runtime.replyProgressTimersByRunKey instanceof Map) || !runKey) {
    return;
  }
  const timer = runtime.replyProgressTimersByRunKey.get(runKey);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  runtime.replyProgressTimersByRunKey.delete(runKey);
}

function clearProgressFollowupTimer(runtime, runKey) {
  if (!runtime || !(runtime.replyProgressFollowupTimersByRunKey instanceof Map) || !runKey) {
    return;
  }
  const timer = runtime.replyProgressFollowupTimersByRunKey.get(runKey);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  runtime.replyProgressFollowupTimersByRunKey.delete(runKey);
}

function clearProgressNoticeTimers(runtime, runKey) {
  clearProgressNoticeTimer(runtime, runKey);
  clearProgressFollowupTimer(runtime, runKey);
}

function resolveOpenClawProgressNoticeDelayMs(runtime) {
  const rawDelay = Number(runtime?.config?.openclawProgressNoticeDelayMs);
  if (Number.isFinite(rawDelay) && rawDelay >= 0) {
    return rawDelay;
  }
  return DEFAULT_OPENCLAW_PROGRESS_NOTICE_DELAY_MS;
}

function resolveOpenClawProgressFollowupDelayMs(runtime) {
  const rawDelay = Number(runtime?.config?.openclawProgressFollowupDelayMs);
  if (Number.isFinite(rawDelay) && rawDelay >= 0) {
    return rawDelay;
  }
  return DEFAULT_OPENCLAW_PROGRESS_FOLLOWUP_DELAY_MS;
}

function buildOpenClawProgressNoticeText() {
  return formatPlainTextNotice(DEFAULT_OPENCLAW_PROGRESS_NOTICE_TEXT, "progress");
}

function buildOpenClawProgressFollowupText() {
  return formatPlainTextNotice(DEFAULT_OPENCLAW_PROGRESS_FOLLOWUP_TEXT, "progress");
}

async function flushReplyCard(runtime, runKey) {
  const entry = runtime.replyCardByRunKey.get(runKey);
  if (!entry) {
    return;
  }

  const card = buildAssistantReplyCard({
    text: entry.text,
    state: entry.state,
  });

  if (!entry.messageId) {
    const response = await sendInteractiveCard(runtime, {
      chatId: entry.chatId,
      card,
      replyToMessageId: entry.replyToMessageId,
    });
    entry.messageId = codexMessageUtils.extractCreatedMessageId(response);
    if (!entry.messageId) {
      return;
    }
    runtime.setReplyCardEntry(runKey, entry);
    runtime.clearPendingReactionForThread(entry.threadId).catch((error) => {
      console.error(`[codex-im] failed to clear pending reaction after first reply card: ${error.message}`);
    });
    if (entry.state === "completed" || entry.state === "failed") {
      runtime.disposeReplyRunState(runKey, entry.threadId);
    }
    return;
  }

  await patchInteractiveCard(runtime, {
    messageId: entry.messageId,
    card,
  });

  if (entry.state === "completed" || entry.state === "failed") {
    runtime.disposeReplyRunState(runKey, entry.threadId);
  }
}

async function addPendingReaction(runtime, bindingKey, messageId) {
  if (!bindingKey || !messageId) {
    return;
  }
  if (!runtime.supportsReactions()) {
    return;
  }

  await clearPendingReactionForBinding(runtime, bindingKey);

  const reaction = await createReaction(runtime, {
    messageId,
    emojiType: "Typing",
  });
  runtime.pendingReactionByBindingKey.set(bindingKey, {
    messageId,
    reactionId: reaction.reactionId,
  });
}

function movePendingReactionToThread(runtime, bindingKey, threadId) {
  if (!bindingKey || !threadId) {
    return;
  }

  const pending = runtime.pendingReactionByBindingKey.get(bindingKey);
  if (!pending) {
    return;
  }
  runtime.pendingReactionByBindingKey.delete(bindingKey);
  runtime.pendingReactionByThreadId.set(threadId, pending);
}

async function clearPendingReactionForBinding(runtime, bindingKey) {
  if (!runtime.supportsReactions()) {
    return;
  }
  const pending = runtime.pendingReactionByBindingKey.get(bindingKey);
  if (!pending) {
    return;
  }
  runtime.pendingReactionByBindingKey.delete(bindingKey);
  await deleteReaction(runtime, pending);
}

async function clearPendingReactionForThread(runtime, threadId) {
  if (!runtime.supportsReactions()) {
    return;
  }
  if (!threadId) {
    return;
  }
  const pending = runtime.pendingReactionByThreadId.get(threadId);
  if (!pending) {
    return;
  }
  runtime.pendingReactionByThreadId.delete(threadId);
  await deleteReaction(runtime, pending);
}

async function createReaction(runtime, { messageId, emojiType }) {
  if (!runtime.supportsReactions()) {
    return { reactionId: "" };
  }
  return reactionRepo.createReaction(runtime.requireFeishuAdapter(), { messageId, emojiType });
}

async function deleteReaction(runtime, { messageId, reactionId }) {
  if (!runtime.supportsReactions()) {
    return;
  }
  await reactionRepo.deleteReaction(runtime.requireFeishuAdapter(), { messageId, reactionId });
}

function disposeReplyRunState(runtime, runKey, threadId) {
  if (runKey) {
    clearReplyFlushTimer(runtime, runKey);
    clearProgressNoticeTimers(runtime, runKey);
    runtime.replyCardByRunKey.delete(runKey);
  }
  if (threadId && runtime.currentRunKeyByThreadId.get(threadId) === runKey) {
    runtime.currentRunKeyByThreadId.delete(threadId);
  }
}

function formatPlainTextNotice(text, kind) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return "";
  }
  if (kind === "progress") {
    return `处理中\n\n${normalizedText}`;
  }
  if (kind === "error") {
    return `处理失败\n\n${normalizedText}`;
  }
  if (kind === "success") {
    return `已完成\n\n${normalizedText}`;
  }
  return normalizedText;
}

function buildApprovalFallbackText(approval) {
  const requestType = approval?.method && approval.method.includes("command") ? "命令执行" : "敏感操作";
  const commandLine = Array.isArray(approval?.command)
    ? approval.command.join(" ")
    : Array.isArray(approval?.commandTokens)
      ? approval.commandTokens.join(" ")
      : String(approval?.command || "").trim();
  return [
    "Codex 需要授权。",
    `请求类型：${requestType}`,
    approval?.reason ? `原因：${approval.reason}` : "",
    commandLine ? `命令：${commandLine}` : "",
    "",
    "请使用：",
    "`/codex approve`",
    "`/codex approve workspace`",
    "`/codex reject`",
    "语音简写：`同意工作区` / `拒绝工作区`",
  ].filter(Boolean).join("\n");
}

function entryChatId(entry, fallbackChatId) {
  return String(entry?.chatId || fallbackChatId || "").trim();
}


module.exports = {
  addPendingReaction,
  clearPendingReactionForBinding,
  clearPendingReactionForThread,
  disposeReplyRunState,
  handleCardAction,
  movePendingReactionToThread,
  patchInteractiveCard,
  queueCardActionWithFeedback,
  runCardActionTask,
  sendCardActionFeedback,
  sendCardActionFeedbackByContext,
  sendInfoCardMessage,
  sendInteractiveApprovalCard,
  sendInteractiveCard,
  updateInteractiveCard,
  upsertAssistantReplyCard,
};
