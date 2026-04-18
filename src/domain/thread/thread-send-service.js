const codexMessageUtils = require("../../infra/codex/message-utils");
const {
  getPerfTrace,
  markPerfStage,
  setPerfTraceFields,
} = require("../../shared/perf-trace");
const { invalidateWorkspaceThreadListCache } = require("./thread-list-service");

async function ensureCodexThreadAndSendMessage(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  threadId,
}) {
  const codexParams = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  const perfTrace = getPerfTrace(normalized);
  setPerfTraceFields(perfTrace, {
    bindingKey,
    workspaceRoot,
    threadId,
  });

  if (!threadId) {
    const createThreadStartedAt = Date.now();
    const createdThreadId = await createWorkspaceThread(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      desktopVisibleExpected: true,
    });
    markPerfStage(perfTrace, "start_thread", createThreadStartedAt, {
      threadId: createdThreadId,
    });
    console.log(`[codex-im] turn/start first message thread=${createdThreadId}`);
    const sendUserMessageStartedAt = Date.now();
    await sendUserMessage(runtime, {
      threadId: createdThreadId,
      text: normalized.text,
      model: codexParams.model || null,
      effort: codexParams.effort || null,
      workspaceRoot,
    });
    markPerfStage(perfTrace, "turn_start_request", sendUserMessageStartedAt, {
      threadId: createdThreadId,
    });
    runtime.setThreadBindingKey(createdThreadId, bindingKey);
    runtime.setThreadWorkspaceRoot(createdThreadId, workspaceRoot);
    return createdThreadId;
  }

  try {
    await ensureThreadResumed(runtime, threadId, { normalized });
    const sendUserMessageStartedAt = Date.now();
    await sendUserMessage(runtime, {
      threadId,
      text: normalized.text,
      model: codexParams.model || null,
      effort: codexParams.effort || null,
      workspaceRoot,
    });
    markPerfStage(perfTrace, "turn_start_request", sendUserMessageStartedAt, {
      threadId,
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
    setPerfTraceFields(perfTrace, {
      recreatedThread: true,
    });
    const recreateThreadStartedAt = Date.now();
    const recreatedThreadId = await createWorkspaceThread(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      desktopVisibleExpected: true,
    });
    markPerfStage(perfTrace, "start_thread", recreateThreadStartedAt, {
      threadId: recreatedThreadId,
      recreatedThread: true,
    });
    console.log(`[codex-im] turn/start retry thread=${recreatedThreadId}`);
    const retrySendStartedAt = Date.now();
    await sendUserMessage(runtime, {
      threadId: recreatedThreadId,
      text: normalized.text,
      model: codexParams.model || null,
      effort: codexParams.effort || null,
      workspaceRoot,
    });
    markPerfStage(perfTrace, "turn_start_request", retrySendStartedAt, {
      threadId: recreatedThreadId,
      recreatedThread: true,
    });
    runtime.setThreadBindingKey(recreatedThreadId, bindingKey);
    runtime.setThreadWorkspaceRoot(recreatedThreadId, workspaceRoot);
    return recreatedThreadId;
  }
}

async function sendMessageToThread(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  threadId,
  persistedThreadId = "",
  desktopVisibleExpected = true,
  model = null,
  effort = null,
}) {
  const resolvedThreadId = String(threadId || "").trim();
  if (!resolvedThreadId) {
    throw new Error("missing thread id");
  }

  await ensureThreadResumed(runtime, resolvedThreadId);
  await sendUserMessage(runtime, {
    threadId: resolvedThreadId,
    text: normalized.text,
    model,
    effort,
    workspaceRoot,
  });
  const storedThreadId = String(persistedThreadId || resolvedThreadId).trim() || resolvedThreadId;
  runtime.sessionStore.setThreadIdForWorkspace(
    bindingKey,
    workspaceRoot,
    storedThreadId,
    codexMessageUtils.buildBindingMetadata(normalized)
  );
  runtime.setThreadBindingKey(storedThreadId, bindingKey);
  runtime.setThreadWorkspaceRoot(storedThreadId, workspaceRoot);
  runtime.setThreadBindingKey(resolvedThreadId, bindingKey);
  runtime.setThreadWorkspaceRoot(resolvedThreadId, workspaceRoot);
  if (typeof runtime.rememberSelectedThreadForSync === "function") {
    runtime.rememberSelectedThreadForSync(bindingKey, workspaceRoot, storedThreadId, {
      desktopVisibleExpected,
    });
  }
}

async function createWorkspaceThread(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  desktopVisibleExpected = true,
}) {
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
    runtime.rememberSelectedThreadForSync(bindingKey, workspaceRoot, resolvedThreadId, {
      desktopVisibleExpected,
    });
  }
  invalidateWorkspaceThreadListCache(runtime, bindingKey, workspaceRoot);
  return resolvedThreadId;
}

async function ensureThreadResumed(runtime, threadId, { normalized = null } = {}) {
  const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
  const perfTrace = getPerfTrace(normalized) || getPerfTrace(runtime.pendingChatContextByThreadId?.get(normalizedThreadId));
  const resumeStartedAt = Date.now();
  if (!normalizedThreadId || runtime.resumedThreadIds.has(normalizedThreadId)) {
    markPerfStage(perfTrace, "resume_thread", resumeStartedAt, {
      threadId: normalizedThreadId,
      resumedFromCache: true,
    });
    return null;
  }

  const response = await runtime.codex.resumeThread({ threadId: normalizedThreadId });
  markPerfStage(perfTrace, "resume_thread", resumeStartedAt, {
    threadId: normalizedThreadId,
    resumedFromCache: false,
  });
  runtime.resumedThreadIds.add(normalizedThreadId);
  console.log(`[codex-im] thread/resume ok thread=${normalizedThreadId}`);
  return response;
}

async function sendUserMessage(runtime, {
  threadId,
  text,
  model = null,
  effort = null,
  workspaceRoot,
}) {
  return runtime.codex.sendUserMessage({
    threadId,
    text,
    model,
    effort,
    accessMode: runtime.config.defaultCodexAccessMode,
    workspaceRoot,
  });
}

function shouldRecreateThread(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("thread not found") || message.includes("unknown thread");
}

module.exports = {
  createWorkspaceThread,
  ensureCodexThreadAndSendMessage,
  ensureThreadResumed,
  sendMessageToThread,
  shouldRecreateThread,
};
