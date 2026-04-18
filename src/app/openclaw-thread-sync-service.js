const { delayWithAbort } = require("../shared/abortable-delay");
const { pathMatchesWorkspaceRoot } = require("../shared/workspace-paths");

const THREAD_SYNC_DELIVERY_RETRY_COOLDOWN_MS = 60_000;
const THREAD_SYNC_IDLE_POLL_INTERVALS_MS = [5_000, 10_000, 20_000, 30_000];

function rememberSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId, { desktopVisibleExpected = true } = {}) {
  const syncKey = buildThreadSyncKey(bindingKey, workspaceRoot);
  const normalizedThreadId = String(threadId || "").trim();
  if (!syncKey || !normalizedThreadId) {
    return;
  }

  const current = runtime.threadSyncStateByKey.get(syncKey) || null;
  const nextDesktopVisibleExpected = (
    current?.threadId === normalizedThreadId && current?.desktopVisibleExpected === false
  )
    ? false
    : desktopVisibleExpected !== false;
  if (
    current?.threadId === normalizedThreadId
    && current?.desktopVisibleExpected === nextDesktopVisibleExpected
  ) {
    return;
  }

  runtime.threadSyncStateByKey.set(syncKey, {
    threadId: normalizedThreadId,
    desktopVisibleExpected: nextDesktopVisibleExpected,
    needsBaseline: true,
    skipNextSync: false,
    lastUpdatedAt: 0,
    lastMessageSignature: "",
    lastError: "",
    lastDeliveryFailureAt: 0,
    lastDeliveryFailureSignature: "",
    idlePollLevel: 0,
    nextSyncAt: 0,
    thread: null,
  });
}

function markThreadSyncLocalActivity(runtime, threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    return;
  }

  for (const state of runtime.threadSyncStateByKey.values()) {
    if (state?.threadId === normalizedThreadId) {
      state.skipNextSync = true;
      resetThreadSyncPollSchedule(state, { immediate: true });
    }
  }
}

async function threadSyncLoop(runtime, signal, pollIntervalMs) {
  while (!signal.aborted && !runtime.isStopping) {
    try {
      await syncSelectedThreads(runtime, signal);
    } catch (error) {
      if (signal.aborted || runtime.isStopping) {
        break;
      }
      console.error(`[codex-im] openclaw thread sync failed: ${error.message}`);
    }
    if (signal.aborted || runtime.isStopping) {
      break;
    }
    await delayWithAbort(pollIntervalMs, signal);
  }
}

async function syncSelectedThreads(runtime, signal) {
  const bindings = typeof runtime.sessionStore.listBindings === "function"
    ? runtime.sessionStore.listBindings({ clone: false })
    : [];

  for (const entry of bindings) {
    if (signal.aborted || runtime.isStopping) {
      break;
    }
    if (!runtime.isRuntimeBindingEntry(entry?.binding)) {
      continue;
    }
    await runtime.syncSelectedThreadBinding(entry).catch((error) => {
      console.error(`[codex-im] failed to sync selected thread: ${error.message}`);
    });
  }
}

async function syncSelectedThreadBinding(runtime, { bindingKey, binding }) {
  if (runtime.usesDesktopSessionSource()) {
    return runtime.syncSelectedDesktopSessionBinding({ bindingKey, binding });
  }

  const workspaceRoot = String(binding?.activeWorkspaceRoot || "").trim();
  const chatId = String(binding?.chatId || "").trim();
  const threadId = String(binding?.threadIdByWorkspaceRoot?.[workspaceRoot] || "").trim();
  if (!bindingKey || !workspaceRoot || !chatId || !threadId) {
    return;
  }
  if (shouldPauseThreadSyncForBinding(runtime, bindingKey)) {
    return;
  }
  if (runtime.activeTurnIdByThreadId.has(threadId) || runtime.pendingApprovalByThreadId.has(threadId)) {
    return;
  }

  rememberSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId);
  const syncKey = buildThreadSyncKey(bindingKey, workspaceRoot);
  const state = runtime.threadSyncStateByKey.get(syncKey);
  if (!state || state.threadId !== threadId) {
    return;
  }
  if (!isCurrentThreadSyncSelection(runtime, bindingKey, workspaceRoot, threadId)) {
    return;
  }
  if (shouldSkipThreadSyncPoll(state)) {
    return;
  }

  let resumeResponse = null;
  try {
    resumeResponse = await runtime.codex.resumeThread({ threadId });
  } catch (error) {
    const selectedThread = await refreshCodexThreadSnapshotForSync(runtime, {
      bindingKey,
      binding,
      workspaceRoot,
      chatId,
      threadId,
      state,
      forceRefresh: true,
    });
    if (!selectedThread && isMissingCodexThreadError(error)) {
      advanceThreadSyncPollSchedule(state);
      if (!isCurrentThreadSyncSelection(runtime, bindingKey, workspaceRoot, threadId)) {
        return;
      }
      await maybeSendThreadSyncWarning(runtime, state, {
        chatId,
        text: [
          "当前选中的线程已不可用，请重新切换线程。",
          `项目：\`${workspaceRoot}\``,
          `线程ID：\`${threadId}\``,
        ].join("\n"),
        errorKey: `missing:${threadId}`,
      });
      return;
    }
    throw error;
  }

  let selectedThread = mergeThreadSyncSnapshot(
    buildFallbackThreadSyncSnapshot(workspaceRoot, threadId),
    state.thread,
    extractResumedThreadSnapshot(resumeResponse)
  );
  if (!hasCodexThreadSnapshotDetails(selectedThread)) {
    selectedThread = mergeThreadSyncSnapshot(
      selectedThread,
      await refreshCodexThreadSnapshotForSync(runtime, {
        bindingKey,
        binding,
        workspaceRoot,
        chatId,
        threadId,
        state,
      })
    );
  }
  if (!isCurrentThreadSyncSelection(runtime, bindingKey, workspaceRoot, threadId)) {
    return;
  }
  if (!threadSyncSnapshotMatchesWorkspace(selectedThread, workspaceRoot)) {
    clearSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId, state);
    return;
  }
  state.thread = selectedThread;

  const recentMessages = codexMessageUtils.extractRecentConversationFromResumeResponse(resumeResponse);
  const signature = codexMessageUtils.buildRecentConversationSignature(recentMessages);
  const updatedAt = Number(selectedThread?.updatedAt || state.lastUpdatedAt || 0);
  maybeClearThreadSyncDeliveryFailure(state, signature);

  if (state.needsBaseline) {
    state.needsBaseline = false;
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    clearThreadSyncDeliveryFailure(state);
    resetThreadSyncPollSchedule(state);
    return;
  }

  if ((signature && signature === state.lastMessageSignature) || !recentMessages.length) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.lastError = "";
    advanceThreadSyncPollSchedule(state);
    return;
  }

  if (state.skipNextSync) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    resetThreadSyncPollSchedule(state);
    return;
  }

  if (shouldDeferThreadSyncDelivery(state, signature)) {
    state.lastUpdatedAt = updatedAt;
    state.lastError = "";
    advanceThreadSyncPollSchedule(state);
    return;
  }

  try {
    await runtime.sendTextMessage({
      chatId,
      text: runtime.buildThreadSyncText({
        workspaceRoot,
        thread: selectedThread || buildFallbackThreadSyncSnapshot(workspaceRoot, threadId),
        recentMessages,
      }),
      useChatContext: false,
    });
  } catch (error) {
    if (handleThreadSyncDeliveryFailure(state, error, signature)) {
      return;
    }
    throw error;
  }
  state.lastUpdatedAt = updatedAt;
  state.lastMessageSignature = signature;
  state.lastError = "";
  clearThreadSyncDeliveryFailure(state);
  resetThreadSyncPollSchedule(state);
}

async function syncSelectedDesktopSessionBinding(runtime, { bindingKey, binding }) {
  const workspaceRoot = String(binding?.activeWorkspaceRoot || "").trim();
  const chatId = String(binding?.chatId || "").trim();
  const threadId = String(binding?.threadIdByWorkspaceRoot?.[workspaceRoot] || "").trim();
  if (!bindingKey || !workspaceRoot || !chatId || !threadId) {
    return;
  }
  if (shouldPauseThreadSyncForBinding(runtime, bindingKey)) {
    return;
  }

  rememberSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId);
  const syncKey = buildThreadSyncKey(bindingKey, workspaceRoot);
  const state = runtime.threadSyncStateByKey.get(syncKey);
  if (!state || state.threadId !== threadId) {
    return;
  }
  if (shouldSkipThreadSyncPoll(state)) {
    return;
  }

  const sessions = await runtime.listDesktopSessionsForWorkspace(workspaceRoot);
  const selectedSession = sessions.find((session) => (
    session?.id === threadId
    || session?.acpSessionId === threadId
    || session?.acpxRecordId === threadId
  )) || null;
  if (!selectedSession) {
    if (state.desktopVisibleExpected === false) {
      state.lastError = "";
      advanceThreadSyncPollSchedule(state);
      return;
    }
    if (await canResumeHiddenDesktopRecoveryThread(runtime, threadId)) {
      state.desktopVisibleExpected = false;
      state.lastError = "";
      advanceThreadSyncPollSchedule(state);
      return;
    }
    advanceThreadSyncPollSchedule(state);
    await maybeSendThreadSyncWarning(runtime, state, {
      chatId,
      text: [
        "当前选中的桌面会话已不可用，请重新切换会话。",
        `项目：\`${workspaceRoot}\``,
        `会话ID：\`${threadId}\``,
      ].join("\n"),
      errorKey: `missing:${threadId}`,
    });
    return;
  }

  const selectedUpdatedAt = Number(selectedSession.updatedAt || 0);
  if (!state.needsBaseline && selectedUpdatedAt > 0 && selectedUpdatedAt <= state.lastUpdatedAt) {
    state.lastError = "";
    advanceThreadSyncPollSchedule(state);
    return;
  }

  const hydrated = await runtime.hydrateDesktopSession(selectedSession, {
    includeBridgeStatus: false,
  });
  if (!hydrated) {
    return;
  }

  const updatedAt = Number(hydrated.updatedAt || selectedUpdatedAt || 0);
  if (!state.needsBaseline && updatedAt > 0 && updatedAt <= state.lastUpdatedAt) {
    state.lastError = "";
    advanceThreadSyncPollSchedule(state);
    return;
  }

  const recentMessages = Array.isArray(hydrated.recentMessages) ? hydrated.recentMessages : [];
  const signature = codexMessageUtils.buildRecentConversationSignature(recentMessages);
  maybeClearThreadSyncDeliveryFailure(state, signature);

  if (state.needsBaseline) {
    state.needsBaseline = false;
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    clearThreadSyncDeliveryFailure(state);
    resetThreadSyncPollSchedule(state);
    return;
  }

  if ((signature && signature === state.lastMessageSignature) || !recentMessages.length) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.lastError = "";
    advanceThreadSyncPollSchedule(state);
    return;
  }

  if (state.skipNextSync) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    resetThreadSyncPollSchedule(state);
    return;
  }

  if (shouldDeferThreadSyncDelivery(state, signature)) {
    state.lastUpdatedAt = updatedAt;
    state.lastError = "";
    advanceThreadSyncPollSchedule(state);
    return;
  }

  try {
    await runtime.sendTextMessage({
      chatId,
      text: runtime.buildThreadSyncText({
        workspaceRoot,
        thread: hydrated,
        recentMessages,
      }),
      useChatContext: false,
    });
  } catch (error) {
    if (handleThreadSyncDeliveryFailure(state, error, signature)) {
      return;
    }
    throw error;
  }
  state.lastUpdatedAt = updatedAt;
  state.lastMessageSignature = signature;
  state.lastError = "";
  clearThreadSyncDeliveryFailure(state);
  resetThreadSyncPollSchedule(state);
}

async function canResumeHiddenDesktopRecoveryThread(runtime, threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId || typeof runtime?.codex?.resumeThread !== "function") {
    return false;
  }

  try {
    await runtime.codex.resumeThread({ threadId: normalizedThreadId });
    if (runtime.resumedThreadIds instanceof Set) {
      runtime.resumedThreadIds.add(normalizedThreadId);
    }
    return true;
  } catch {
    return false;
  }
}

async function maybeSendThreadSyncWarning(runtime, state, { chatId, text, errorKey }) {
  if (!state || !chatId || !text || !errorKey || state.lastError === errorKey) {
    return;
  }
  await runtime.sendTextMessage({ chatId, text, useChatContext: false });
  state.lastError = errorKey;
}

async function refreshCodexThreadSnapshotForSync(runtime, {
  bindingKey,
  binding,
  workspaceRoot,
  chatId,
  threadId,
  state,
  forceRefresh = false,
}) {
  const threads = await runtime.refreshWorkspaceThreads(bindingKey, workspaceRoot, {
    workspaceId: binding?.workspaceId || runtime.config.defaultWorkspaceId,
    chatId,
    threadKey: binding?.threadKey || "",
    senderId: binding?.senderId || "",
    messageId: "",
  }, {
    forceRefresh,
  });
  const selectedThread = threads.find((thread) => thread?.id === threadId) || null;
  if (selectedThread && state) {
    state.thread = mergeThreadSyncSnapshot(state.thread, selectedThread);
  }
  return selectedThread;
}

function extractResumedThreadSnapshot(response) {
  const thread = response?.result?.thread;
  if (!thread || typeof thread !== "object") {
    return null;
  }

  const threadId = String(thread.id || "").trim();
  if (!threadId) {
    return null;
  }

  const updatedAt = Number(thread.updatedAt || 0);
  return {
    id: threadId,
    cwd: String(thread.cwd || "").trim(),
    title: String(thread.name || thread.title || thread.preview || "").trim(),
    updatedAt: updatedAt > 0 ? updatedAt : 0,
    sourceKind: String(thread.source || "").trim() || "unknown",
  };
}

function buildFallbackThreadSyncSnapshot(workspaceRoot, threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    return null;
  }
  return {
    id: normalizedThreadId,
    cwd: String(workspaceRoot || "").trim(),
    title: "",
    updatedAt: 0,
    sourceKind: "unknown",
  };
}

function mergeThreadSyncSnapshot(...snapshots) {
  const merged = {};
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object") {
      continue;
    }

    const id = String(snapshot.id || "").trim();
    const cwd = String(snapshot.cwd || "").trim();
    const title = String(snapshot.title || "").trim();
    const sourceKind = String(snapshot.sourceKind || "").trim();
    const updatedAt = Number(snapshot.updatedAt || 0);

    if (id) {
      merged.id = id;
    }
    if (cwd) {
      merged.cwd = cwd;
    }
    if (title) {
      merged.title = title;
    }
    if (sourceKind) {
      merged.sourceKind = sourceKind;
    }
    if (updatedAt > 0) {
      merged.updatedAt = updatedAt;
    }
  }

  return merged.id ? merged : null;
}

function hasCodexThreadSnapshotDetails(thread) {
  if (!thread || typeof thread !== "object") {
    return false;
  }
  return Boolean(
    String(thread.title || "").trim()
    || Number(thread.updatedAt || 0) > 0
  );
}

function isMissingCodexThreadError(error) {
  const message = String(error?.message || "").trim().toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("thread missing")
    || message.includes("thread not found")
    || message.includes("unknown thread")
  );
}

function shouldDeferThreadSyncDelivery(state, signature) {
  if (!state || !signature) {
    return false;
  }

  const previousFailureSignature = String(state.lastDeliveryFailureSignature || "").trim();
  if (!previousFailureSignature || previousFailureSignature !== signature) {
    return false;
  }

  const lastFailureAt = Number(state.lastDeliveryFailureAt || 0);
  if (lastFailureAt <= 0) {
    return false;
  }

  return (Date.now() - lastFailureAt) < THREAD_SYNC_DELIVERY_RETRY_COOLDOWN_MS;
}

function shouldSkipThreadSyncPoll(state, { now = Date.now() } = {}) {
  if (!state || state.needsBaseline) {
    return false;
  }

  return Number(state.nextSyncAt || 0) > now;
}

function resetThreadSyncPollSchedule(state, { now = Date.now(), immediate = false } = {}) {
  if (!state) {
    return;
  }

  state.idlePollLevel = 0;
  state.nextSyncAt = immediate ? 0 : now + THREAD_SYNC_IDLE_POLL_INTERVALS_MS[0];
}

function advanceThreadSyncPollSchedule(state, { now = Date.now() } = {}) {
  if (!state) {
    return;
  }

  const currentLevel = Number.isInteger(state.idlePollLevel) ? state.idlePollLevel : 0;
  const nextLevel = Math.min(currentLevel + 1, THREAD_SYNC_IDLE_POLL_INTERVALS_MS.length - 1);
  state.idlePollLevel = nextLevel;
  state.nextSyncAt = now + THREAD_SYNC_IDLE_POLL_INTERVALS_MS[nextLevel];
}

function rememberThreadSyncDeliveryFailure(state, signature) {
  if (!state) {
    return;
  }
  state.lastDeliveryFailureSignature = String(signature || "").trim();
  state.lastDeliveryFailureAt = Date.now();
}

function handleThreadSyncDeliveryFailure(state, error, signature) {
  rememberThreadSyncDeliveryFailure(state, signature);
  if (!shouldSuppressThreadSyncDeliveryError(error)) {
    return false;
  }
  if (state) {
    state.lastError = "";
    advanceThreadSyncPollSchedule(state);
  }
  return true;
}

function shouldSuppressThreadSyncDeliveryError(error) {
  const message = String(error?.message || "").trim().toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("sendmessage errcode=-2")
    || (error?.retryable === true && message.includes("sendmessage errcode="))
  );
}

function maybeClearThreadSyncDeliveryFailure(state, signature) {
  if (!state) {
    return;
  }

  const previousFailureSignature = String(state.lastDeliveryFailureSignature || "").trim();
  const nextSignature = String(signature || "").trim();
  if (!previousFailureSignature || !nextSignature || previousFailureSignature === nextSignature) {
    return;
  }

  clearThreadSyncDeliveryFailure(state);
}

function clearThreadSyncDeliveryFailure(state) {
  if (!state) {
    return;
  }
  state.lastDeliveryFailureSignature = "";
  state.lastDeliveryFailureAt = 0;
}

function buildThreadSyncKey(bindingKey, workspaceRoot) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (!normalizedBindingKey || !normalizedWorkspaceRoot) {
    return "";
  }
  return `${normalizedBindingKey}::${normalizedWorkspaceRoot}`;
}

function shouldPauseThreadSyncForBinding(runtime, bindingKey) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  if (!normalizedBindingKey) {
    return false;
  }

  if (
    runtime?.inFlightBindingDispatchKeys instanceof Set
    && runtime.inFlightBindingDispatchKeys.has(normalizedBindingKey)
  ) {
    return true;
  }

  const pendingQueue = runtime?.pendingMessageQueueByBindingKey instanceof Map
    ? runtime.pendingMessageQueueByBindingKey.get(normalizedBindingKey)
    : null;
  return Array.isArray(pendingQueue) && pendingQueue.length > 0;
}

function isCurrentThreadSyncSelection(runtime, bindingKey, workspaceRoot, threadId) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedBindingKey || !normalizedWorkspaceRoot || !normalizedThreadId) {
    return false;
  }
  if (typeof runtime?.sessionStore?.getActiveWorkspaceRoot === "function") {
    const activeWorkspaceRoot = runtime.sessionStore.getActiveWorkspaceRoot(normalizedBindingKey);
    if (activeWorkspaceRoot && activeWorkspaceRoot !== normalizedWorkspaceRoot) {
      return false;
    }
  }
  if (typeof runtime?.sessionStore?.getThreadIdForWorkspace === "function") {
    const selectedThreadId = runtime.sessionStore.getThreadIdForWorkspace(
      normalizedBindingKey,
      normalizedWorkspaceRoot
    );
    if (selectedThreadId && selectedThreadId !== normalizedThreadId) {
      return false;
    }
  }
  return true;
}

function threadSyncSnapshotMatchesWorkspace(thread, workspaceRoot) {
  if (!thread) {
    return false;
  }
  const threadCwd = String(thread.cwd || "").trim();
  if (!threadCwd) {
    return false;
  }
  return pathMatchesWorkspaceRoot(threadCwd, workspaceRoot);
}

function clearSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId, state) {
  if (typeof runtime?.sessionStore?.clearThreadIdForWorkspace === "function") {
    const currentThreadId = typeof runtime?.sessionStore?.getThreadIdForWorkspace === "function"
      ? runtime.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot)
      : "";
    if (!currentThreadId || currentThreadId === threadId) {
      runtime.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
    }
  }
  if (state) {
    state.thread = null;
    state.needsBaseline = true;
    state.lastUpdatedAt = 0;
    state.lastMessageSignature = "";
    state.lastError = "";
    clearThreadSyncDeliveryFailure(state);
    resetThreadSyncPollSchedule(state, { immediate: true });
  }
}

module.exports = {
  markThreadSyncLocalActivity,
  rememberSelectedThreadForSync,
  syncSelectedDesktopSessionBinding,
  syncSelectedThreadBinding,
  syncSelectedThreads,
  threadSyncLoop,
};
const codexMessageUtils = require("../infra/codex/message-utils");
