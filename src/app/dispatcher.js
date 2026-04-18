const messageNormalizers = require("../presentation/message/normalizers");
const eventsRuntime = require("./codex-event-service");
const {
  buildFirstUseWorkspaceGuideText,
  buildMissingWorkspaceGuideText,
  formatFailureText,
} = require("../shared/error-text");
const {
  acquireThreadDispatchClaim,
  getActiveThreadDispatchClaim,
  releaseThreadDispatchClaim,
  resolveThreadDispatchKeys,
} = require("../shared/thread-dispatch-claims");
const {
  attachPerfTrace,
  calculatePerfDurationMs,
  ensurePerfTrace,
  logPerf,
  markPerfStage,
  setPerfTraceFields,
} = require("../shared/perf-trace");

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
  ensureInboundPerfTrace(normalized);
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

async function onNormalizedTextEvent(
  runtime,
  normalized,
  {
    alreadyRemembered = false,
    skipDispatchLock = false,
    expectedBindingKey = "",
    expectedWorkspaceRoot = "",
  } = {}
) {
  if (!normalized) {
    return { status: "noop" };
  }
  const perfTrace = ensureInboundPerfTrace(normalized);
  if (!alreadyRemembered && typeof runtime.rememberInboundContext === "function") {
    runtime.rememberInboundContext(normalized);
  }

  if (await runtime.dispatchTextCommand(normalized)) {
    return { status: "handled" };
  }

  const bindingKeyForGuide = runtime.sessionStore.buildBindingKey(normalized);
  const shouldUseFirstGuide = shouldSendFirstUseWorkspaceGuide(runtime, bindingKeyForGuide);
  const resolveWorkspaceContextStartedAt = Date.now();
  const workspaceContext = await runtime.resolveWorkspaceContext(normalized, {
    replyToMessageId: normalized.messageId,
    missingWorkspaceText: shouldUseFirstGuide
      ? buildFirstUseWorkspaceGuideText()
      : buildMissingWorkspaceGuideText(),
  });
  markPerfStage(perfTrace, "resolve_workspace_context", resolveWorkspaceContextStartedAt);
  if (!workspaceContext) {
    if (shouldUseFirstGuide) {
      markFirstUseWorkspaceGuideSent(runtime, bindingKeyForGuide);
    }
    return { status: "handled" };
  }
  const { bindingKey, workspaceRoot } = workspaceContext;
  if (
    !matchesExpectedDispatchScope({
      bindingKey,
      workspaceRoot,
      expectedBindingKey,
      expectedWorkspaceRoot,
    })
  ) {
    return { status: "dropped" };
  }
  if (expectedWorkspaceRoot && !isWorkspaceStillActive(runtime, bindingKey, expectedWorkspaceRoot)) {
    return { status: "dropped" };
  }
  let ownsBindingLock = false;
  let keepBindingLock = false;
  if (!skipDispatchLock) {
    if (!tryAcquireBindingDispatchLock(runtime, bindingKey)) {
      const queueAheadCount = enqueueBindingMessage(runtime, bindingKey, workspaceRoot, normalized);
      await sendQueuedMessageNotice(runtime, normalized, "dispatching", queueAheadCount);
      return { status: "queued", queueAheadCount };
    }
    ownsBindingLock = true;
  }

  let threadDispatchClaim = null;
  let keepThreadDispatchClaim = false;
  try {
    setPerfTraceFields(perfTrace, {
      bindingKey,
      workspaceRoot,
    });
    const resolveThreadStateStartedAt = Date.now();
    const initialThreadState = await runtime.resolveWorkspaceThreadState({
      bindingKey,
      workspaceRoot,
      normalized,
      autoSelectThread: true,
      refreshThreadList: false,
      allowClaimedThreadReuse: false,
    });
    markPerfStage(perfTrace, "resolve_thread_state", resolveThreadStateStartedAt, {
      threadId: initialThreadState?.threadId || "",
    });
    const reservedThread = await reserveThreadForDispatch(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      threadId: initialThreadState?.threadId || "",
    });
    const threadId = reservedThread.threadId;
    threadDispatchClaim = reservedThread.claim;

    if (reservedThread.queueState) {
      const queueAheadCount = enqueueBindingMessage(runtime, bindingKey, workspaceRoot, normalized);
      await sendQueuedMessageNotice(runtime, normalized, reservedThread.queueState, queueAheadCount);
      keepBindingLock = true;
      return { status: "queued", queueAheadCount };
    }

    const acknowledgedNormalized = await maybeSendOpenClawInboundReceipt(runtime, normalized);
    attachPerfTrace(acknowledgedNormalized, perfTrace);
    const prepareInboundStartedAt = Date.now();
    const preparedNormalized = typeof runtime.prepareInboundMessage === "function"
      ? await runtime.prepareInboundMessage(acknowledgedNormalized, { bindingKey, workspaceRoot })
      : acknowledgedNormalized;
    const effectiveNormalized = preparedNormalized || acknowledgedNormalized;
    attachPerfTrace(effectiveNormalized, perfTrace);
    markPerfStage(perfTrace, "prepare_inbound", prepareInboundStartedAt);
    if (expectedWorkspaceRoot && !isWorkspaceStillActive(runtime, bindingKey, expectedWorkspaceRoot)) {
      return { status: "dropped" };
    }

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
      logPhoneDispatchRequested(runtime, perfTrace, resolvedThreadId);
      if (threadDispatchClaim && resolvedThreadId && resolvedThreadId !== threadId) {
        releaseThreadDispatchClaim(runtime, {
          workspaceRoot,
          claim: threadDispatchClaim,
        });
        threadDispatchClaim = acquireThreadDispatchClaim(runtime, {
          bindingKey,
          workspaceRoot,
          target: resolvedThreadId,
        });
      }
      keepThreadDispatchClaim = Boolean(threadDispatchClaim);
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
    if (threadDispatchClaim && !keepThreadDispatchClaim) {
      releaseThreadDispatchClaim(runtime, {
        workspaceRoot,
        claim: threadDispatchClaim,
      });
    }
    if (ownsBindingLock && !keepBindingLock) {
      releaseBindingDispatchLock(runtime, bindingKey);
    }
  }
}

async function processQueuedNormalizedTextEvent(runtime, queuedEntry) {
  const normalizedEntry = normalizeQueuedMessageEntry(queuedEntry);
  if (!normalizedEntry) {
    return { status: "noop" };
  }
  if (
    normalizedEntry.workspaceRoot
    && !isWorkspaceStillActive(runtime, normalizedEntry.bindingKey, normalizedEntry.workspaceRoot)
  ) {
    return { status: "dropped" };
  }
  return onNormalizedTextEvent(runtime, normalizedEntry.normalized, {
    alreadyRemembered: true,
    skipDispatchLock: true,
    expectedBindingKey: normalizedEntry.bindingKey,
    expectedWorkspaceRoot: normalizedEntry.workspaceRoot,
  });
}

async function drainQueuedMessagesForBinding(runtime, bindingKey) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  if (!normalizedBindingKey) {
    return false;
  }

  while (!runtime.isStopping) {
    const nextQueuedEntry = shiftQueuedMessage(runtime, normalizedBindingKey);
    if (!nextQueuedEntry) {
      releaseBindingDispatchLock(runtime, normalizedBindingKey);
      return false;
    }

    try {
      const outcome = await processQueuedNormalizedTextEvent(runtime, nextQueuedEntry);
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

function enqueueBindingMessage(runtime, bindingKey, workspaceRoot, normalized) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  const queuedEntry = buildQueuedMessageEntry(bindingKey, workspaceRoot, normalized);
  if (!normalizedBindingKey || !queuedEntry) {
    return 0;
  }

  const queues = getPendingMessageQueueMap(runtime);
  const queue = queues.get(normalizedBindingKey) || [];
  const queueAheadCount = queue.length + 1;
  queue.push(queuedEntry);
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

function clearQueuedMessagesForBinding(runtime, bindingKey, workspaceRoot = "") {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  if (!normalizedBindingKey) {
    return 0;
  }

  const queues = getPendingMessageQueueMap(runtime);
  const queue = queues.get(normalizedBindingKey) || null;
  if (!Array.isArray(queue) || queue.length === 0) {
    queues.delete(normalizedBindingKey);
    return 0;
  }

  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (!normalizedWorkspaceRoot) {
    const removedCount = queue.length;
    queues.delete(normalizedBindingKey);
    return removedCount;
  }

  const filteredQueue = queue.filter((entry) => {
    const normalizedEntry = normalizeQueuedMessageEntry(entry);
    return normalizedEntry && normalizedEntry.workspaceRoot !== normalizedWorkspaceRoot;
  });
  const removedCount = queue.length - filteredQueue.length;
  if (filteredQueue.length === 0) {
    queues.delete(normalizedBindingKey);
  } else {
    queues.set(normalizedBindingKey, filteredQueue);
  }
  return removedCount;
}

async function reserveThreadForDispatch(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  threadId,
}) {
  let candidateThreadId = String(threadId || "").trim();
  let retriedSelection = false;

  while (candidateThreadId) {
    const dispatchState = resolveBusyThreadState(runtime, {
      bindingKey,
      workspaceRoot,
      threadId: candidateThreadId,
    });
    if (dispatchState.state) {
      if (!dispatchState.crossBinding) {
        return {
          threadId: candidateThreadId,
          queueState: dispatchState.state,
          claim: null,
        };
      }

      if (retriedSelection) {
        return {
          threadId: "",
          queueState: "",
          claim: null,
        };
      }

      candidateThreadId = await resolveAlternativeThreadForDispatch(runtime, {
        bindingKey,
        workspaceRoot,
        normalized,
        currentThreadId: candidateThreadId,
      });
      retriedSelection = true;
      continue;
    }

    const claim = acquireThreadDispatchClaim(runtime, {
      bindingKey,
      workspaceRoot,
      target: candidateThreadId,
    });
    if (claim) {
      return {
        threadId: candidateThreadId,
        queueState: "",
        claim,
      };
    }

    if (retriedSelection) {
      return {
        threadId: "",
        queueState: "",
        claim: null,
      };
    }

    candidateThreadId = await resolveAlternativeThreadForDispatch(runtime, {
      bindingKey,
      workspaceRoot,
      normalized,
      currentThreadId: candidateThreadId,
    });
    retriedSelection = true;
  }

  return {
    threadId: "",
    queueState: "",
    claim: null,
  };
}

async function resolveAlternativeThreadForDispatch(runtime, {
  bindingKey,
  workspaceRoot,
  normalized,
  currentThreadId,
}) {
  const alternativeState = await runtime.resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
    refreshThreadList: true,
    allowClaimedThreadReuse: false,
  });
  const alternativeThreadId = String(alternativeState?.threadId || "").trim();
  if (!alternativeThreadId || alternativeThreadId === String(currentThreadId || "").trim()) {
    return "";
  }
  return alternativeThreadId;
}

function resolveBusyThreadState(runtime, {
  bindingKey,
  workspaceRoot,
  threadId,
}) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    return { state: "", crossBinding: false };
  }
  const dispatchKeys = resolveThreadDispatchKeys(runtime, workspaceRoot, normalizedThreadId);
  const ownerBindingKey = resolveThreadOwnerBindingKey(runtime, workspaceRoot, normalizedThreadId);
  const crossBinding = ownerBindingKey && ownerBindingKey !== String(bindingKey || "").trim();
  if (dispatchKeys.some((candidateId) => runtime.pendingApprovalByThreadId?.has(candidateId))) {
    return { state: "approval", crossBinding };
  }
  if (dispatchKeys.some((candidateId) => runtime.activeTurnIdByThreadId?.has(candidateId))) {
    return { state: "running", crossBinding };
  }
  if (resolveBusyThreadClaimConflict(runtime, bindingKey, workspaceRoot, normalizedThreadId)) {
    return { state: "dispatching", crossBinding: true };
  }
  return { state: "", crossBinding: false };
}

function resolveThreadOwnerBindingKey(runtime, workspaceRoot, threadId) {
  const threadIds = resolveThreadDispatchKeys(runtime, workspaceRoot, threadId);
  for (const candidateId of threadIds) {
    const ownerBindingKey = String(runtime.bindingKeyByThreadId?.get(candidateId) || "").trim();
    if (ownerBindingKey) {
      return ownerBindingKey;
    }
  }
  return "";
}

function resolveBusyThreadClaimConflict(runtime, bindingKey, workspaceRoot, threadId) {
  const claim = getActiveThreadDispatchClaim(runtime, workspaceRoot, threadId);
  if (!claim) {
    return false;
  }
  return (
    claim.bindingKey !== String(bindingKey || "").trim()
    || claim.workspaceRoot !== String(workspaceRoot || "").trim()
  );
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

function buildQueuedMessageEntry(bindingKey, workspaceRoot, normalized) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (!normalizedBindingKey || !normalized || !normalizedWorkspaceRoot) {
    return null;
  }
  return {
    bindingKey: normalizedBindingKey,
    workspaceRoot: normalizedWorkspaceRoot,
    normalized,
  };
}

function normalizeQueuedMessageEntry(entry) {
  if (!entry || !entry.normalized) {
    return null;
  }
  return {
    bindingKey: normalizeBindingKey(entry.bindingKey),
    workspaceRoot: String(entry.workspaceRoot || "").trim(),
    normalized: entry.normalized,
  };
}

function matchesExpectedDispatchScope({
  bindingKey,
  workspaceRoot,
  expectedBindingKey,
  expectedWorkspaceRoot,
}) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  const normalizedExpectedBindingKey = normalizeBindingKey(expectedBindingKey);
  const normalizedExpectedWorkspaceRoot = String(expectedWorkspaceRoot || "").trim();
  if (normalizedExpectedBindingKey && normalizedExpectedBindingKey !== normalizedBindingKey) {
    return false;
  }
  if (normalizedExpectedWorkspaceRoot && normalizedExpectedWorkspaceRoot !== normalizedWorkspaceRoot) {
    return false;
  }
  return true;
}

function isWorkspaceStillActive(runtime, bindingKey, workspaceRoot) {
  const normalizedBindingKey = normalizeBindingKey(bindingKey);
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (!normalizedBindingKey || !normalizedWorkspaceRoot) {
    return false;
  }
  if (typeof runtime?.resolveWorkspaceRootForBinding !== "function") {
    return true;
  }
  return runtime.resolveWorkspaceRootForBinding(normalizedBindingKey) === normalizedWorkspaceRoot;
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

function ensureInboundPerfTrace(normalized) {
  if (!normalized || normalized.provider !== "openclaw") {
    return null;
  }
  return ensurePerfTrace(normalized, {
    source: normalized.provider,
    chatId: normalized.chatId,
    messageId: normalized.messageId,
  });
}

function logPhoneDispatchRequested(runtime, perfTrace, resolvedThreadId) {
  if (!perfTrace) {
    return false;
  }
  const stages = perfTrace.stageDurationsMs || {};
  return logPerf(runtime, "phone-turn-requested", {
    chat: perfTrace.chatId,
    msg: perfTrace.messageId,
    workspace: perfTrace.workspaceRoot,
    thread: resolvedThreadId || perfTrace.threadId,
    totalMs: calculatePerfDurationMs(perfTrace.startedAt),
    workspaceMs: stages.resolve_workspace_context,
    threadStateMs: stages.resolve_thread_state,
    prepareMs: stages.prepare_inbound,
    resumeMs: stages.resume_thread,
    startThreadMs: stages.start_thread,
    turnStartMs: stages.turn_start_request,
    recreated: perfTrace.recreatedThread,
  });
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
  clearQueuedMessagesForBinding,
  drainQueuedMessagesForBinding,
  onCodexMessage,
  onFeishuCardAction,
  onFeishuTextEvent,
  onOpenClawTextEvent,
  processQueuedNormalizedTextEvent,
};
