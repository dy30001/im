const codexMessageUtils = require("../../infra/codex/message-utils");
const { buildMissingWorkspaceGuideText } = require("../../shared/error-text");
const { refreshWorkspaceThreads } = require("./thread-list-service");
const {
  isThreadUnavailableForBinding,
  selectAutoThreadForBinding,
} = require("./thread-selection-service");
const {
  createWorkspaceThread,
  sendMessageToThread,
  shouldRecreateThread,
} = require("./thread-send-service");

async function resolveDesktopSessionState(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  autoSelectThread = true,
  allowClaimedThreadReuse = true,
}) {
  const threads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
  const selectedThreadId = runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot);
  const selectedThreadUnavailable = isThreadUnavailableForBinding(
    runtime,
    bindingKey,
    workspaceRoot,
    selectedThreadId,
    { allowClaimedThreadReuse }
  );
  let selectedThread = null;
  let threadId = "";
  let desktopVisibleExpected = true;

  if (selectedThreadId && !selectedThreadUnavailable) {
    selectedThread = await hydrateSelectedDesktopSession(runtime, workspaceRoot, selectedThreadId);
    if (!selectedThread) {
      threadId = selectedThreadId;
      desktopVisibleExpected = false;
    } else if (selectedThread?.writable && selectedThread?.acpSessionId) {
      threadId = selectedThread.id;
    } else if (autoSelectThread) {
      const recoveredThread = await findWritableDesktopSession(runtime, workspaceRoot, threads, {
        excludedSessionId: selectedThreadId,
        bindingKey,
        allowClaimedThreadReuse,
      });
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
    const recoveredThread = await findWritableDesktopSession(runtime, workspaceRoot, threads, {
      excludedSessionId: selectedThreadId,
      bindingKey,
      allowClaimedThreadReuse,
    });
    if (recoveredThread) {
      selectedThread = recoveredThread;
      threadId = recoveredThread.id;
      runtime.sessionStore.setThreadIdForWorkspace(
        bindingKey,
        workspaceRoot,
        threadId,
        codexMessageUtils.buildBindingMetadata(normalized)
      );
    } else {
      const autoSelectedThreadId = selectAutoThreadForBinding(runtime, bindingKey, workspaceRoot, threads, {
        allowClaimedThreadReuse,
      });
      if (autoSelectedThreadId) {
        selectedThread = (
          await hydrateSelectedDesktopSession(runtime, workspaceRoot, autoSelectedThreadId)
        ) || threads.find((thread) => thread?.id === autoSelectedThreadId) || null;
      }
      threadId = String(selectedThread?.id || "").trim();
      if (threadId) {
        runtime.sessionStore.setThreadIdForWorkspace(
          bindingKey,
          workspaceRoot,
          threadId,
          codexMessageUtils.buildBindingMetadata(normalized)
        );
      }
    }
  }

  if (!selectedThread && selectedThreadId && threadId !== selectedThreadId) {
    runtime.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
  }

  if (threadId) {
    runtime.setThreadBindingKey(threadId, bindingKey);
    runtime.setThreadWorkspaceRoot(threadId, workspaceRoot);
    if (typeof runtime.rememberSelectedThreadForSync === "function") {
      runtime.rememberSelectedThreadForSync(bindingKey, workspaceRoot, threadId, {
        desktopVisibleExpected,
      });
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
    if (!forceRecoverThread) {
      throw new Error("当前项目在桌面 App 里还没有可见会话。请先在电脑端打开该项目并创建/恢复会话。");
    }

    const createdThreadId = await createWorkspaceThread(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      desktopVisibleExpected: false,
    });
    console.warn(
      `[codex-im] no desktop session visible; created writable recovery session ${createdThreadId} for workspace=${workspaceRoot}`
    );
    await runtime.codex.sendUserMessage({
      threadId: createdThreadId,
      text: normalized.text,
      model: codexParams.model || null,
      effort: codexParams.effort || null,
      accessMode: runtime.config.defaultCodexAccessMode,
      workspaceRoot,
    });
    runtime.sessionStore.setThreadIdForWorkspace(
      bindingKey,
      workspaceRoot,
      createdThreadId,
      codexMessageUtils.buildBindingMetadata(normalized)
    );
    runtime.setThreadBindingKey(createdThreadId, bindingKey);
    runtime.setThreadWorkspaceRoot(createdThreadId, workspaceRoot);
    return createdThreadId;
  }

  const originalThreadId = threadId;
  let selectedSession = await hydrateSelectedDesktopSession(runtime, workspaceRoot, threadId);
  if (!selectedSession) {
    try {
      await sendMessageToThread(runtime, {
        bindingKey,
        workspaceRoot,
        normalized,
        threadId,
        desktopVisibleExpected: false,
        model: codexParams.model || null,
        effort: codexParams.effort || null,
      });
      return threadId;
    } catch (error) {
      if (!forceRecoverThread || !shouldRecreateThread(error)) {
        throw error;
      }
      runtime.resumedThreadIds.delete(threadId);
    }
  }

  if (!selectedSession || !selectedSession.writable || !selectedSession.acpSessionId) {
    const availableThreads = await refreshWorkspaceThreads(runtime, bindingKey, workspaceRoot, normalized);
    const recoveredSession = await findWritableDesktopSession(runtime, workspaceRoot, availableThreads, {
      excludedSessionId: threadId,
      bindingKey,
      allowClaimedThreadReuse: false,
    });
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
        desktopVisibleExpected: false,
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

  await sendMessageToThread(runtime, {
    bindingKey,
    workspaceRoot,
    normalized,
    threadId: selectedSession.acpSessionId || threadId,
    persistedThreadId: selectedSession.id,
    desktopVisibleExpected: true,
    model: codexParams.model || null,
    effort: codexParams.effort || null,
  });
  return selectedSession.id;
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
  const selectedThread = availableThreads.find((session) => (
    session.id === threadId
    || session.acpSessionId === threadId
    || session.acpxRecordId === threadId
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
  if (typeof runtime.disposeInactiveReplyRunsForBinding === "function") {
    runtime.disposeInactiveReplyRunsForBinding(bindingKey, workspaceRoot);
  }
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

async function findWritableDesktopSession(runtime, workspaceRoot, sessions, {
  excludedSessionId = "",
  bindingKey = "",
  allowClaimedThreadReuse = true,
} = {}) {
  if (!Array.isArray(sessions) || !sessions.length) {
    return null;
  }

  for (const session of sessions) {
    if (!session?.id || session.id === excludedSessionId) {
      continue;
    }
    if (isThreadUnavailableForBinding(runtime, bindingKey, workspaceRoot, session, { allowClaimedThreadReuse })) {
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
  ensureDesktopSessionAndSendMessage,
  findWritableDesktopSession,
  hydrateSelectedDesktopSession,
  resolveDesktopSessionState,
  switchDesktopSessionById,
};
