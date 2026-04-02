const { filterThreadsByWorkspaceRoot } = require("../../shared/workspace-paths");
const {
  extractSwitchThreadId,
  extractNaturalBrowseSelectionIndex,
  extractNaturalThreadSelectionIndex,
  isNaturalSelectionTextCompatibleWithCommand,
} = require("../../shared/command-parsing");
const codexMessageUtils = require("../../infra/codex/message-utils");
const { buildMissingWorkspaceGuideText } = require("../../shared/error-text");

const THREAD_SOURCE_KINDS = new Set([
  "app",
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
]);
const DEFAULT_WORKSPACE_THREAD_LIST_CACHE_TTL_MS = 5_000;
const DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT = 50;

async function resolveWorkspaceThreadState(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  autoSelectThread = true,
  refreshThreadList = true,
}) {
  if (shouldUseDesktopSessions(runtime)) {
    return resolveDesktopSessionState(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      autoSelectThread,
    });
  }

  const selectedThreadId = runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot);
  const threads = refreshThreadList || !selectedThreadId
    ? await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized)
    : [];
  const threadId = selectedThreadId || (autoSelectThread ? (threads[0]?.id || "") : "");
  if (!selectedThreadId && threadId) {
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

  const codexParams = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);

  if (!threadId) {
    const createdThreadId = await createWorkspaceThread(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
    });
    console.log(`[codex-im] turn/start first message thread=${createdThreadId}`);
    await runtime.codex.sendUserMessage({
      threadId: createdThreadId,
      text: normalized.text,
      model: codexParams.model || null,
      effort: codexParams.effort || null,
      accessMode: runtime.config.defaultCodexAccessMode,
      workspaceRoot,
    });
    runtime.setThreadBindingKey(createdThreadId, bindingKey);
    runtime.setThreadWorkspaceRoot(createdThreadId, workspaceRoot);
    return createdThreadId;
  }

  try {
    await ensureThreadResumed(runtime, threadId);
    await runtime.codex.sendUserMessage({
      threadId,
      text: normalized.text,
      model: codexParams.model || null,
      effort: codexParams.effort || null,
      accessMode: runtime.config.defaultCodexAccessMode,
      workspaceRoot,
    });
    console.log(`[codex-im] turn/start ok workspace=${workspaceRoot} thread=${threadId}`);
    runtime.setThreadBindingKey(threadId, bindingKey);
    runtime.setThreadWorkspaceRoot(threadId, workspaceRoot);
    return threadId;
  } catch (error) {
    if (!shouldRecreateThread(error)) {
      throw error;
    }

    console.warn(`[codex-im] stale thread detected, recreating workspace thread: ${threadId}`);
    runtime.resumedThreadIds.delete(threadId);
    runtime.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
    const recreatedThreadId = await createWorkspaceThread(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
    });
    console.log(`[codex-im] turn/start retry thread=${recreatedThreadId}`);
    await runtime.codex.sendUserMessage({
      threadId: recreatedThreadId,
      text: normalized.text,
      model: codexParams.model || null,
      effort: codexParams.effort || null,
      accessMode: runtime.config.defaultCodexAccessMode,
      workspaceRoot,
    });
    runtime.setThreadBindingKey(recreatedThreadId, bindingKey);
    runtime.setThreadWorkspaceRoot(recreatedThreadId, workspaceRoot);
    return recreatedThreadId;
  }
}

async function resolveDesktopSessionState(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  autoSelectThread = true,
}) {
  const threads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
  const selectedThreadId = runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot);
  let selectedThread = null;
  let threadId = "";

  if (selectedThreadId) {
    selectedThread = await hydrateSelectedDesktopSession(runtime, workspaceRoot, selectedThreadId);
    if (selectedThread?.writable && selectedThread?.acpSessionId) {
      threadId = selectedThread.id;
    } else if (autoSelectThread) {
      const recoveredThread = await findWritableDesktopSession(runtime, workspaceRoot, threads, selectedThreadId);
      if (recoveredThread) {
        selectedThread = recoveredThread;
        threadId = recoveredThread.id;
        runtime.sessionStore.setThreadIdForWorkspace(
          bindingKey,
          workspaceRoot,
          threadId,
          codexMessageUtils.buildBindingMetadata(normalized)
        );
        console.warn(
          `[codex-im] desktop session ${selectedThreadId} is read-only; auto-switched to writable session ${threadId} for workspace=${workspaceRoot}`
        );
      } else {
        threadId = selectedThread?.id || "";
      }
    } else {
      threadId = selectedThread?.id || "";
    }
  }

  if (!threadId && autoSelectThread) {
    const recoveredThread = await findWritableDesktopSession(runtime, workspaceRoot, threads);
    if (recoveredThread) {
      selectedThread = recoveredThread;
      threadId = recoveredThread.id;
      runtime.sessionStore.setThreadIdForWorkspace(
        bindingKey,
        workspaceRoot,
        threadId,
        codexMessageUtils.buildBindingMetadata(normalized)
      );
    } else if (threads[0]) {
      selectedThread = await hydrateSelectedDesktopSession(runtime, workspaceRoot, threads[0].id) || threads[0];
      threadId = selectedThread.id;
      runtime.sessionStore.setThreadIdForWorkspace(
        bindingKey,
        workspaceRoot,
        threadId,
        codexMessageUtils.buildBindingMetadata(normalized)
      );
    }
  }

  if (!selectedThread && selectedThreadId) {
    runtime.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
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

async function ensureDesktopSessionAndSendMessage(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  threadId,
  forceRecoverThread = false,
}) {
  const codexParams = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  if (!threadId) {
    throw new Error("当前项目在桌面 App 里还没有可见会话。请先在电脑端打开该项目并创建/恢复会话。");
  }

  const originalThreadId = threadId;
  let selectedSession = await hydrateSelectedDesktopSession(runtime, workspaceRoot, threadId);
  if (!selectedSession || !selectedSession.writable || !selectedSession.acpSessionId) {
    const availableThreads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
    const recoveredSession = await findWritableDesktopSession(runtime, workspaceRoot, availableThreads, threadId);
    if (recoveredSession) {
      selectedSession = recoveredSession;
      threadId = recoveredSession.id;
      console.warn(
        `[codex-im] desktop session ${originalThreadId} is read-only; auto-switched to writable session ${threadId} for workspace=${workspaceRoot}`
      );
    } else if (forceRecoverThread) {
      threadId = await createWorkspaceThread(runtime, {
        bindingKey,
        workspaceRoot,
        normalized,
      });
      selectedSession = {
        id: threadId,
        acpSessionId: threadId,
        writable: true,
      };
      console.warn(
        `[codex-im] desktop session ${originalThreadId} is read-only; created writable recovery session ${threadId} for workspace=${workspaceRoot}`
      );
    } else if (!selectedSession) {
      throw new Error("当前桌面会话不可用，请刷新会话列表后重试。");
    } else {
      throw new Error("当前桌面会话仅支持查看/同步，暂不支持从微信继续聊天。");
    }
  }

  await ensureThreadResumed(runtime, selectedSession.acpSessionId || threadId);
  await runtime.codex.sendUserMessage({
    threadId: selectedSession.acpSessionId || threadId,
    text: normalized.text,
    model: codexParams.model || null,
    effort: codexParams.effort || null,
    accessMode: runtime.config.defaultCodexAccessMode,
    workspaceRoot,
  });
  runtime.sessionStore.setThreadIdForWorkspace(
    bindingKey,
    workspaceRoot,
    selectedSession.id,
    codexMessageUtils.buildBindingMetadata(normalized)
  );
  runtime.setThreadBindingKey(selectedSession.id, bindingKey);
  runtime.setThreadWorkspaceRoot(selectedSession.id, workspaceRoot);
  runtime.setThreadBindingKey(selectedSession.acpSessionId, bindingKey);
  runtime.setThreadWorkspaceRoot(selectedSession.acpSessionId, workspaceRoot);
  return selectedSession.id;
}

async function createWorkspaceThread(runtime, { bindingKey, workspaceRoot, normalized }) {
  const response = await runtime.codex.startThread({
    cwd: workspaceRoot,
  });
  console.log(`[codex-im] thread/start ok workspace=${workspaceRoot}`);

  const resolvedThreadId = codexMessageUtils.extractThreadId(response);
  if (!resolvedThreadId) {
    throw new Error("thread/start did not return a thread id");
  }

  runtime.sessionStore.setThreadIdForWorkspace(
    bindingKey,
    workspaceRoot,
    resolvedThreadId,
    codexMessageUtils.buildBindingMetadata(normalized)
  );
  runtime.resumedThreadIds.add(resolvedThreadId);
  runtime.setPendingThreadContext(resolvedThreadId, normalized);
  runtime.setThreadBindingKey(resolvedThreadId, bindingKey);
  runtime.setThreadWorkspaceRoot(resolvedThreadId, workspaceRoot);
  if (typeof runtime.rememberSelectedThreadForSync === "function") {
    runtime.rememberSelectedThreadForSync(bindingKey, workspaceRoot, resolvedThreadId);
  }
  invalidateWorkspaceThreadListCache(runtime, bindingKey, workspaceRoot);
  return resolvedThreadId;
}

async function ensureThreadResumed(runtime, threadId) {
  const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
  if (!normalizedThreadId || runtime.resumedThreadIds.has(normalizedThreadId)) {
    return null;
  }

  const response = await runtime.codex.resumeThread({ threadId: normalizedThreadId });
  runtime.resumedThreadIds.add(normalizedThreadId);
  console.log(`[codex-im] thread/resume ok thread=${normalizedThreadId}`);
  return response;
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

  if (shouldUseDesktopSessions(runtime)) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "桌面会话模式下，请先在电脑端打开当前项目并新建会话，然后再在微信里刷新。",
    });
    return;
  }

  try {
    const createdThreadId = await createWorkspaceThread(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
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

async function refreshWorkspaceThreads(
  runtime,
  bindingKey,
  workspaceRoot,
  normalized,
  { forceRefresh = false, previewOnly = false, allowStaleCache = false, previewLimit = DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT } = {}
) {
  const cacheKey = buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot);
  const cachedResult = readWorkspaceThreadListCache(runtime, cacheKey);
  if (!forceRefresh && cachedResult && (
    isFreshWorkspaceThreadListCache(cachedResult)
    || (previewOnly && allowStaleCache)
  )) {
    setWorkspaceThreadRefreshState(runtime, cacheKey, {
      ok: true,
      fromCache: true,
      error: "",
      updatedAt: cachedResult.updatedAt,
    });
    return cachedResult.threads;
  }

  if (shouldUseDesktopSessions(runtime)) {
    try {
      const sessions = await runtime.listDesktopSessionsForWorkspace(workspaceRoot);
      if (!previewOnly) {
        persistWorkspaceThreadListCache(runtime, cacheKey, sessions);
      }
      setWorkspaceThreadRefreshState(runtime, cacheKey, {
        ok: true,
        fromCache: false,
        error: "",
        updatedAt: new Date().toISOString(),
      });
      const currentThreadId = runtime.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      if (!previewOnly && currentThreadId && !sessions.some((thread) => thread.id === currentThreadId)) {
        runtime.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      }
      return sessions;
    } catch (error) {
      console.warn(`[codex-im] desktop session refresh failed for workspace=${workspaceRoot}: ${error.message}`);
      setWorkspaceThreadRefreshState(runtime, cacheKey, {
        ok: false,
        fromCache: false,
        error: error.message,
        updatedAt: new Date().toISOString(),
      });
      return [];
    }
  }

  try {
    const threads = previewOnly
      ? await listCodexThreadsPreviewForWorkspace(runtime, workspaceRoot, previewLimit)
      : await listCodexThreadsForWorkspace(runtime, workspaceRoot);
    if (!previewOnly) {
      persistWorkspaceThreadListCache(runtime, cacheKey, threads);
    }
    setWorkspaceThreadRefreshState(runtime, cacheKey, {
      ok: true,
      fromCache: false,
      error: "",
      updatedAt: new Date().toISOString(),
    });
    if (!previewOnly) {
      const currentThreadId = runtime.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      const shouldKeepCurrentThread = currentThreadId && runtime.resumedThreadIds.has(currentThreadId);
      if (currentThreadId && !shouldKeepCurrentThread && !threads.some((thread) => thread.id === currentThreadId)) {
        runtime.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      }
    }
    return threads;
  } catch (error) {
    console.warn(`[codex-im] thread/list failed for workspace=${workspaceRoot}: ${error.message}`);
    setWorkspaceThreadRefreshState(runtime, cacheKey, {
      ok: false,
      fromCache: false,
      error: error.message,
      updatedAt: new Date().toISOString(),
    });
    if (cachedResult) {
      setWorkspaceThreadRefreshState(runtime, cacheKey, {
        ok: true,
        fromCache: true,
        error: "",
        updatedAt: cachedResult.updatedAt,
      });
      return cachedResult.threads;
    }
    return [];
  }
}

async function listCodexThreadsForWorkspace(runtime, workspaceRoot) {
  const allThreads = await listCodexThreadsPaginated(runtime);
  const sourceFiltered = allThreads.filter((thread) => isSupportedThreadSourceKind(thread?.sourceKind));
  return filterThreadsByWorkspaceRoot(sourceFiltered, workspaceRoot);
}

async function listCodexThreadsPreviewForWorkspace(runtime, workspaceRoot, previewLimit = DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT) {
  const normalizedLimit = Number.isInteger(previewLimit) && previewLimit > 0
    ? Math.min(previewLimit, 200)
    : DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT;
  const response = await runtime.codex.listThreads({
    cursor: null,
    limit: normalizedLimit,
    sortKey: "updated_at",
  });
  const pageThreads = codexMessageUtils.extractThreadsFromListResponse(response);
  const sourceFiltered = pageThreads.filter((thread) => isSupportedThreadSourceKind(thread?.sourceKind));
  return filterThreadsByWorkspaceRoot(sourceFiltered, workspaceRoot);
}

async function listCodexThreadsPaginated(runtime) {
  const allThreads = [];
  const seenThreadIds = new Set();
  let cursor = null;

  for (let page = 0; page < 10; page += 1) {
    const response = await runtime.codex.listThreads({
      cursor,
      limit: 200,
      sortKey: "updated_at",
    });
    const pageThreads = codexMessageUtils.extractThreadsFromListResponse(response);
    for (const thread of pageThreads) {
      if (seenThreadIds.has(thread.id)) {
        continue;
      }
      seenThreadIds.add(thread.id);
      allThreads.push(thread);
    }

    const nextCursor = codexMessageUtils.extractThreadListCursor(response);
    if (!nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
    if (pageThreads.length === 0) {
      break;
    }
  }

  return allThreads;
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

async function switchDesktopSessionById(runtime, normalized, threadId, { replyToMessageId } = {}) {
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

  const availableThreads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
  const selectedThread = availableThreads.find((thread) => (
    thread.id === threadId
    || thread.acpSessionId === threadId
    || thread.acpxRecordId === threadId
  )) || null;
  if (!selectedThread) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "指定桌面会话当前不可用，请刷新后重试。",
    });
    return;
  }

  runtime.sessionStore.setActiveWorkspaceRoot(bindingKey, workspaceRoot);
  runtime.sessionStore.setThreadIdForWorkspace(
    bindingKey,
    workspaceRoot,
    selectedThread.id,
    codexMessageUtils.buildBindingMetadata(normalized)
  );
  runtime.setThreadBindingKey(selectedThread.id, bindingKey);
  runtime.setThreadWorkspaceRoot(selectedThread.id, workspaceRoot);
  if (typeof runtime.rememberSelectedThreadForSync === "function") {
    runtime.rememberSelectedThreadForSync(bindingKey, workspaceRoot, selectedThread.id);
  }

  const hydrated = await hydrateSelectedDesktopSession(runtime, workspaceRoot, selectedThread.id);
  await runtime.showStatusPanel(normalized, {
    replyToMessageId: replyTarget,
    noticeText: hydrated?.writable
      ? "已切换到桌面会话，可继续在微信里追问。"
      : "已切换到桌面会话。当前仅支持查看/同步，暂不支持从微信继续聊天。",
  });
}

function getWorkspaceThreadRefreshState(runtime, bindingKey, workspaceRoot) {
  const cacheKey = buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot);
  const state = runtime.workspaceThreadRefreshStateByKey?.get(cacheKey) || null;
  if (!state || typeof state !== "object") {
    return {
      ok: true,
      fromCache: false,
      error: "",
      updatedAt: "",
    };
  }
  return {
    ok: state.ok !== false,
    fromCache: state.fromCache === true,
    error: typeof state.error === "string" ? state.error : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function readWorkspaceThreadListCache(runtime, cacheKey) {
  const cache = runtime?.workspaceThreadListCacheByKey;
  if (!(cache instanceof Map) || !cacheKey) {
    return null;
  }

  const cached = cache.get(cacheKey);
  if (!cached || !Array.isArray(cached.threads)) {
    return null;
  }

  return {
    threads: cached.threads,
    updatedAt: typeof cached.updatedAt === "string" ? cached.updatedAt : "",
  };
}

function isFreshWorkspaceThreadListCache(cachedResult) {
  const updatedAt = Date.parse(String(cachedResult?.updatedAt || "").trim());
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  return (Date.now() - updatedAt) <= DEFAULT_WORKSPACE_THREAD_LIST_CACHE_TTL_MS;
}

function persistWorkspaceThreadListCache(runtime, cacheKey, threads) {
  if (!cacheKey) {
    return null;
  }
  if (!(runtime.workspaceThreadListCacheByKey instanceof Map)) {
    runtime.workspaceThreadListCacheByKey = new Map();
  }

  const normalizedThreads = Array.isArray(threads)
    ? threads.map((thread) => ({ ...(thread || {}) }))
    : [];

  const cachedResult = {
    threads: normalizedThreads,
    updatedAt: new Date().toISOString(),
  };
  runtime.workspaceThreadListCacheByKey.set(cacheKey, cachedResult);
  return cachedResult;
}

function invalidateWorkspaceThreadListCache(runtime, bindingKey, workspaceRoot) {
  const cacheKey = buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot);
  if (!cacheKey || !(runtime.workspaceThreadListCacheByKey instanceof Map)) {
    return;
  }
  runtime.workspaceThreadListCacheByKey.delete(cacheKey);
}

function setWorkspaceThreadRefreshState(runtime, cacheKey, state) {
  if (!runtime.workspaceThreadRefreshStateByKey) {
    runtime.workspaceThreadRefreshStateByKey = new Map();
  }
  runtime.workspaceThreadRefreshStateByKey.set(cacheKey, {
    ok: state.ok !== false,
    fromCache: state.fromCache === true,
    error: typeof state.error === "string" ? state.error : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  });
}

function buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot) {
  return `${String(bindingKey || "")}::${String(workspaceRoot || "")}`;
}

function isSupportedThreadSourceKind(sourceKind) {
  const normalized = typeof sourceKind === "string" && sourceKind.trim() ? sourceKind.trim() : "unknown";
  return THREAD_SOURCE_KINDS.has(normalized);
}

function shouldRecreateThread(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("thread not found") || message.includes("unknown thread");
}

function shouldUseDesktopSessions(runtime) {
  return typeof runtime.usesDesktopSessionSource === "function" && runtime.usesDesktopSessionSource();
}

function findDesktopSessionById(runtime, workspaceRoot, sessionId) {
  if (typeof runtime.resolveDesktopSessionById !== "function") {
    return null;
  }
  return runtime.resolveDesktopSessionById(workspaceRoot, sessionId);
}

async function hydrateSelectedDesktopSession(runtime, workspaceRoot, sessionId) {
  const selectedSession = findDesktopSessionById(runtime, workspaceRoot, sessionId);
  if (!selectedSession) {
    return null;
  }
  if (typeof runtime.hydrateDesktopSession !== "function") {
    return selectedSession;
  }
  return runtime.hydrateDesktopSession(selectedSession);
}

async function findWritableDesktopSession(runtime, workspaceRoot, sessions, excludedSessionId = "") {
  if (!Array.isArray(sessions) || !sessions.length) {
    return null;
  }

  for (const session of sessions) {
    if (!session?.id || session.id === excludedSessionId) {
      continue;
    }
    const hydrated = await hydrateSelectedDesktopSession(runtime, workspaceRoot, session.id);
    if (hydrated?.writable && hydrated?.acpSessionId) {
      return hydrated;
    }
  }

  return null;
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
