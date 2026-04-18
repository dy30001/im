const {
  extractSwitchThreadId,
  extractNaturalBrowseSelectionIndex,
  extractNaturalThreadSelectionIndex,
  isNaturalSelectionTextCompatibleWithCommand,
} = require("../../shared/command-parsing");
const codexMessageUtils = require("../../infra/codex/message-utils");
const { buildMissingWorkspaceGuideText } = require("../../shared/error-text");
const {
  getWorkspaceThreadRefreshState,
  refreshWorkspaceThreads,
} = require("./thread-list-service");
const {
  isThreadUnavailableForBinding,
  selectAutoThreadForBinding,
} = require("./thread-selection-service");
const {
  createWorkspaceThread,
  ensureCodexThreadAndSendMessage,
  ensureThreadResumed,
  shouldRecreateThread,
} = require("./thread-send-service");
const {
  ensureDesktopSessionAndSendMessage,
  resolveDesktopSessionState,
  switchDesktopSessionById,
} = require("./thread-desktop-service");

async function resolveWorkspaceThreadState(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  autoSelectThread = true,
  refreshThreadList = true,
  allowClaimedThreadReuse = true,
}) {
  if (shouldUseDesktopSessions(runtime)) {
    return resolveDesktopSessionState(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      autoSelectThread,
      allowClaimedThreadReuse,
    });
  }

  const selectedThreadId = runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot);
  const selectedThreadUnavailable = isThreadUnavailableForBinding(
    runtime,
    bindingKey,
    workspaceRoot,
    selectedThreadId,
    { allowClaimedThreadReuse }
  );
  const threads = refreshThreadList || !selectedThreadId || selectedThreadUnavailable
    ? await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized)
    : [];
  const reusableSelectedThreadId = selectedThreadUnavailable ? "" : selectedThreadId;
  const threadId = reusableSelectedThreadId || (
    autoSelectThread
      ? selectAutoThreadForBinding(runtime, bindingKey, workspaceRoot, threads, {
        allowClaimedThreadReuse,
      })
      : ""
  );
  if (threadId && threadId !== selectedThreadId) {
    runtime.sessionStore.setThreadIdForWorkspace(
      bindingKey,
      workspaceRoot,
      threadId,
      codexMessageUtils.buildBindingMetadata(normalized)
    );
  }
  if (threadId) {
    runtime.setThreadBindingKey(threadId, bindingKey);
    runtime.setThreadWorkspaceRoot(threadId, workspaceRoot);
    if (typeof runtime.rememberSelectedThreadForSync === "function") {
      runtime.rememberSelectedThreadForSync(bindingKey, workspaceRoot, threadId);
    }
  }
  return { threads, threadId, selectedThreadId };
}

async function ensureThreadAndSendMessage(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  threadId,
  forceRecoverThread = false,
}) {
  if (shouldUseDesktopSessions(runtime)) {
    return ensureDesktopSessionAndSendMessage(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
      forceRecoverThread,
    });
  }

  return ensureCodexThreadAndSendMessage(runtime, {
    bindingKey,
    workspaceRoot,
    normalized,
    threadId,
  });
}

async function handleNewCommand(runtime, normalized) {
  const bindingKey = runtime.sessionStore.buildBindingKey(normalized);
  const workspaceRoot = runtime.resolveWorkspaceRootForBinding(bindingKey);
  if (!workspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: buildMissingWorkspaceGuideText(),
    });
    return;
  }

  try {
    const createdThreadId = await createWorkspaceThread(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      desktopVisibleExpected: !shouldUseDesktopSessions(runtime),
    });
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: `已创建新线程并切换到它:\n${workspaceRoot}\n\nthread: ${createdThreadId}`,
    });
    await runtime.showStatusPanel(normalized, { replyToMessageId: normalized.messageId });
  } catch (error) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: `创建新线程失败: ${error.message}`,
    });
  }
}

async function handleSwitchCommand(runtime, normalized) {
  const threadId = extractSwitchThreadId(normalized.text);
  if (!threadId) {
    const selectionContext = typeof runtime.resolveSelectionContext === "function"
      ? runtime.resolveSelectionContext(normalized)
      : null;
    const threadIndex = extractNaturalThreadSelectionIndex(normalized.text);
    const genericThreadIndex = selectionContext?.command === "threads"
      && isNaturalSelectionTextCompatibleWithCommand(normalized.text, "threads")
      ? extractNaturalBrowseSelectionIndex(normalized.text)
      : 0;
    const resolvedThreadIndex = threadIndex > 0 ? threadIndex : genericThreadIndex;
    if (resolvedThreadIndex > 0) {
      await switchThreadByIndex(runtime, normalized, resolvedThreadIndex, { replyToMessageId: normalized.messageId });
      return;
    }
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: shouldUseDesktopSessions(runtime)
        ? "用法: `/codex switch <sessionId>`，或直接说 `切换第二个线程`。"
        : "用法: `/codex switch <threadId>`，或直接说 `切换第二个线程`。",
    });
    return;
  }

  await switchThreadById(runtime, normalized, threadId, { replyToMessageId: normalized.messageId });
}

async function switchThreadByIndex(runtime, normalized, threadIndex, { replyToMessageId } = {}) {
  const replyTarget = runtime.resolveReplyToMessageId(normalized, replyToMessageId);
  const { bindingKey, workspaceRoot } = runtime.getBindingContext(normalized);
  if (!workspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: buildMissingWorkspaceGuideText(),
    });
    return;
  }

  const availableThreads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized, {
    forceRefresh: true,
  });
  const selectedThread = availableThreads[threadIndex - 1] || null;
  if (!selectedThread) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: availableThreads.length
        ? `当前只有 ${availableThreads.length} 个线程，无法选择第 ${threadIndex} 个。`
        : "当前没有可切换的线程。先发送 `/codex threads` 查看列表。",
    });
    return;
  }

  await switchThreadById(runtime, normalized, selectedThread.id, { replyToMessageId: replyTarget });
}

function describeWorkspaceStatus(runtime, threadId) {
  if (!threadId) {
    return { code: "idle", label: "空闲" };
  }
  if (runtime.pendingApprovalByThreadId.has(threadId)) {
    return { code: "approval", label: "等待授权" };
  }
  if (runtime.activeTurnIdByThreadId.has(threadId)) {
    return { code: "running", label: "运行中" };
  }
  return { code: "idle", label: "空闲" };
}

async function switchThreadById(runtime, normalized, threadId, { replyToMessageId } = {}) {
  if (shouldUseDesktopSessions(runtime)) {
    return switchDesktopSessionById(runtime, normalized, threadId, { replyToMessageId });
  }

  const replyTarget = runtime.resolveReplyToMessageId(normalized, replyToMessageId);
  const { bindingKey, workspaceRoot } = runtime.getBindingContext(normalized);
  if (!workspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: buildMissingWorkspaceGuideText(),
    });
    return;
  }

  const currentThreadId = runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot);
  if (currentThreadId && currentThreadId === threadId) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "已经是当前线程，无需切换。",
    });
    return;
  }

  const availableThreads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized, {
    forceRefresh: true,
  });
  const selectedThread = availableThreads.find((thread) => thread.id === threadId) || null;
  if (!selectedThread) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "指定线程当前不可用，请刷新后重试。",
    });
    return;
  }

  const resolvedWorkspaceRoot = selectedThread.cwd || workspaceRoot;
  runtime.sessionStore.setActiveWorkspaceRoot(bindingKey, resolvedWorkspaceRoot);
  if (typeof runtime.disposeInactiveReplyRunsForBinding === "function") {
    runtime.disposeInactiveReplyRunsForBinding(bindingKey, resolvedWorkspaceRoot);
  }
  runtime.sessionStore.setThreadIdForWorkspace(
    bindingKey,
    resolvedWorkspaceRoot,
    threadId,
    codexMessageUtils.buildBindingMetadata(normalized)
  );
  runtime.setThreadBindingKey(threadId, bindingKey);
  runtime.setThreadWorkspaceRoot(threadId, resolvedWorkspaceRoot);
  if (typeof runtime.rememberSelectedThreadForSync === "function") {
    runtime.rememberSelectedThreadForSync(bindingKey, resolvedWorkspaceRoot, threadId);
  }
  runtime.resumedThreadIds.delete(threadId);
  try {
    await ensureThreadResumed(runtime, threadId);
  } catch (error) {
    if (shouldRecreateThread(error)) {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: replyTarget,
        text: "指定线程当前不可用，请刷新后重试。",
      });
      return;
    }
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: `切换线程失败: ${error.message}`,
    });
    return;
  }
  await runtime.showStatusPanel(normalized, { replyToMessageId: replyTarget });
}

function shouldUseDesktopSessions(runtime) {
  return typeof runtime.usesDesktopSessionSource === "function" && runtime.usesDesktopSessionSource();
}

module.exports = {
  createWorkspaceThread,
  describeWorkspaceStatus,
  ensureThreadAndSendMessage,
  ensureThreadResumed,
  handleNewCommand,
  handleSwitchCommand,
  getWorkspaceThreadRefreshState,
  refreshWorkspaceThreads,
  resolveWorkspaceThreadState,
  switchThreadById,
};
