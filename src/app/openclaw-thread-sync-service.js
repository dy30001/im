function rememberSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId) {
  const syncKey = buildThreadSyncKey(bindingKey, workspaceRoot);
  const normalizedThreadId = String(threadId || "").trim();
  if (!syncKey || !normalizedThreadId) {
    return;
  }

  const current = runtime.threadSyncStateByKey.get(syncKey) || null;
  if (current?.threadId === normalizedThreadId) {
    return;
  }

  runtime.threadSyncStateByKey.set(syncKey, {
    threadId: normalizedThreadId,
    needsBaseline: true,
    skipNextSync: false,
    lastUpdatedAt: 0,
    lastMessageSignature: "",
    lastError: "",
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
    await delay(pollIntervalMs, signal);
  }
}

async function syncSelectedThreads(runtime, signal) {
  const bindings = typeof runtime.sessionStore.listBindings === "function"
    ? runtime.sessionStore.listBindings()
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
  if (runtime.activeTurnIdByThreadId.has(threadId) || runtime.pendingApprovalByThreadId.has(threadId)) {
    return;
  }

  rememberSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId);
  const syncKey = buildThreadSyncKey(bindingKey, workspaceRoot);
  const state = runtime.threadSyncStateByKey.get(syncKey);
  if (!state || state.threadId !== threadId) {
    return;
  }

  const threads = await runtime.refreshWorkspaceThreads(bindingKey, workspaceRoot, {
    workspaceId: binding?.workspaceId || runtime.config.defaultWorkspaceId,
    chatId,
    threadKey: binding?.threadKey || "",
    senderId: binding?.senderId || "",
    messageId: "",
  });
  const selectedThread = threads.find((thread) => thread?.id === threadId) || null;
  if (!selectedThread) {
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

  const updatedAt = Number(selectedThread.updatedAt || 0);
  if (!state.needsBaseline && updatedAt > 0 && updatedAt <= state.lastUpdatedAt) {
    state.lastError = "";
    return;
  }

  const resumeResponse = await runtime.codex.resumeThread({ threadId });
  const recentMessages = codexMessageUtils.extractRecentConversationFromResumeResponse(resumeResponse);
  const signature = codexMessageUtils.buildRecentConversationSignature(recentMessages);

  if (state.needsBaseline) {
    state.needsBaseline = false;
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    return;
  }

  if ((signature && signature === state.lastMessageSignature) || !recentMessages.length) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.lastError = "";
    return;
  }

  if (state.skipNextSync) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    return;
  }

  await runtime.sendTextMessage({
    chatId,
    text: runtime.buildThreadSyncText({
      workspaceRoot,
      thread: selectedThread,
      recentMessages,
    }),
  });
  state.lastUpdatedAt = updatedAt;
  state.lastMessageSignature = signature;
  state.lastError = "";
}

async function syncSelectedDesktopSessionBinding(runtime, { bindingKey, binding }) {
  const workspaceRoot = String(binding?.activeWorkspaceRoot || "").trim();
  const chatId = String(binding?.chatId || "").trim();
  const threadId = String(binding?.threadIdByWorkspaceRoot?.[workspaceRoot] || "").trim();
  if (!bindingKey || !workspaceRoot || !chatId || !threadId) {
    return;
  }

  rememberSelectedThreadForSync(runtime, bindingKey, workspaceRoot, threadId);
  const syncKey = buildThreadSyncKey(bindingKey, workspaceRoot);
  const state = runtime.threadSyncStateByKey.get(syncKey);
  if (!state || state.threadId !== threadId) {
    return;
  }

  const sessions = await runtime.listDesktopSessionsForWorkspace(workspaceRoot);
  const selectedSession = sessions.find((session) => (
    session?.id === threadId
    || session?.acpSessionId === threadId
    || session?.acpxRecordId === threadId
  )) || null;
  if (!selectedSession) {
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

  const hydrated = await runtime.hydrateDesktopSession(selectedSession);
  if (!hydrated) {
    return;
  }

  const updatedAt = Number(hydrated.updatedAt || selectedSession.updatedAt || 0);
  if (!state.needsBaseline && updatedAt > 0 && updatedAt <= state.lastUpdatedAt) {
    state.lastError = "";
    return;
  }

  const recentMessages = Array.isArray(hydrated.recentMessages) ? hydrated.recentMessages : [];
  const signature = codexMessageUtils.buildRecentConversationSignature(recentMessages);

  if (state.needsBaseline) {
    state.needsBaseline = false;
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    return;
  }

  if ((signature && signature === state.lastMessageSignature) || !recentMessages.length) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.lastError = "";
    return;
  }

  if (state.skipNextSync) {
    state.lastUpdatedAt = updatedAt;
    state.lastMessageSignature = signature;
    state.skipNextSync = false;
    state.lastError = "";
    return;
  }

  await runtime.sendTextMessage({
    chatId,
    text: runtime.buildThreadSyncText({
      workspaceRoot,
      thread: hydrated,
      recentMessages,
    }),
  });
  state.lastUpdatedAt = updatedAt;
  state.lastMessageSignature = signature;
  state.lastError = "";
}

async function maybeSendThreadSyncWarning(runtime, state, { chatId, text, errorKey }) {
  if (!state || !chatId || !text || !errorKey || state.lastError === errorKey) {
    return;
  }
  await runtime.sendTextMessage({ chatId, text });
  state.lastError = errorKey;
}

function buildThreadSyncKey(bindingKey, workspaceRoot) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (!normalizedBindingKey || !normalizedWorkspaceRoot) {
    return "";
  }
  return `${normalizedBindingKey}::${normalizedWorkspaceRoot}`;
}

async function delay(ms, signal) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
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
