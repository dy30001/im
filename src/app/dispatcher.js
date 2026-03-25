const messageNormalizers = require("../presentation/message/normalizers");
const eventsRuntime = require("./codex-event-service");
const { buildMissingWorkspaceGuideText, formatFailureText } = require("../shared/error-text");

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
  const traceId = buildOpenClawTraceId(message);
  if (shouldLogVoiceDiagnostics(runtime)) {
    logVoiceDiagnostics(runtime, "ingress", {
      traceId,
      messageId: resolveIncomingMessageId(message),
      messageType: Number(message?.message_type) || 0,
      itemTypes: Array.isArray(message?.item_list)
        ? message.item_list.map((item) => Number(item?.type) || 0)
        : [],
    });
  }
  const normalized = attachTraceIdToNormalized(
    messageNormalizers.normalizeOpenClawTextEvent(message, runtime.config),
    traceId
  );
  if (shouldLogVoiceDiagnostics(runtime) && !normalized && looksLikeVoiceMessage(message)) {
    logVoiceDiagnostics(runtime, "drop", {
      traceId,
      reason: "normalize-returned-null",
      messageId: resolveIncomingMessageId(message),
      messageType: Number(message?.message_type) || 0,
      itemKeySummary: summarizeOpenClawVoiceItemKeys(message?.item_list),
    });
  }
  const prepared = await prepareOpenClawNormalizedEvent(runtime, normalized);
  if (!prepared) {
    return;
  }
  if (shouldLogVoiceDiagnostics(runtime) && normalized?.inputKind === "text" && !extractOpenClawTextPayload(normalized) && normalized?.voiceAttachment == null) {
    logVoiceDiagnostics(runtime, "transcript-fallback", {
      traceId: prepared.traceId || traceId,
      messageId: prepared.messageId || "",
      textLength: String(prepared?.text || "").length,
    });
  }
  if (shouldLogVoiceDiagnostics(runtime) && normalized?.inputKind === "voice") {
    logVoiceDiagnostics(runtime, "normalized", {
      traceId: prepared.traceId || traceId,
      messageId: prepared.messageId || "",
      chatId: prepared.chatId || "",
      hasAttachment: Boolean(normalized?.voiceAttachment),
      hasDownloadUrl: Boolean(normalized?.voiceAttachment?.downloadUrl),
      hasDataUrl: Boolean(normalized?.voiceAttachment?.dataUrl),
      hasBase64Data: Boolean(normalized?.voiceAttachment?.base64Data),
      hasMediaId: Boolean(normalized?.voiceAttachment?.mediaId),
    });
  }
  if (typeof runtime.rememberInboundContext === "function") {
    runtime.rememberInboundContext(prepared);
  }
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
    missingWorkspaceText: buildMissingWorkspaceGuideText(),
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
  if (runtime.config?.openclaw?.voiceInputEnabled === false) {
    if (runtime.config.verboseCodexLogs) {
      console.log(
        `[codex-im] openclaw voice input disabled: skipping voice message=${normalized.messageId}`
      );
    }
    return null;
  }

  try {
    if (shouldLogVoiceDiagnostics(runtime)) {
      logVoiceDiagnostics(runtime, "transcribe-start", {
        traceId: normalized.traceId || "",
        messageId: normalized.messageId || "",
      });
    }
    if (runtime.config.verboseCodexLogs) {
      const voiceAttachment = normalized?.voiceAttachment || {};
      console.log(
        "[codex-im] openclaw voice attachment",
        JSON.stringify({
          messageId: normalized.messageId || "",
          itemType: voiceAttachment.itemType || 0,
          hasDownloadUrl: Boolean(voiceAttachment.downloadUrl),
          hasDataUrl: Boolean(voiceAttachment.dataUrl),
          hasBase64Data: Boolean(voiceAttachment.base64Data),
          hasMediaId: Boolean(voiceAttachment.mediaId),
          mimeType: voiceAttachment.mimeType || "",
          fileName: voiceAttachment.fileName || "",
        })
      );
    }
    const transcribedText = await runtime.transcribeOpenClawVoiceMessage(normalized);
    if (shouldLogVoiceDiagnostics(runtime)) {
      logVoiceDiagnostics(runtime, "transcribe-success", {
        traceId: normalized.traceId || "",
        messageId: normalized.messageId || "",
        textLength: String(transcribedText || "").length,
      });
    }
    if (runtime.config.verboseCodexLogs) {
      const previewLength = String(transcribedText || "").length;
      console.log(
        `[codex-im] openclaw transcribed voice message=${normalized.messageId} `
        + `text_length=${previewLength}`
      );
    }
    return messageNormalizers.applyNormalizedText(normalized, transcribedText);
  } catch (error) {
    if (shouldLogVoiceDiagnostics(runtime)) {
      logVoiceDiagnostics(runtime, "transcribe-fail", {
        traceId: normalized.traceId || "",
        messageId: normalized.messageId || "",
        error: String(error?.message || error || "").slice(0, 200),
      });
    }
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      contextToken: normalized.contextToken,
      text: formatFailureText("语音转写失败", error),
    });
    return null;
  }
}

function shouldLogVoiceDiagnostics(runtime) {
  return Boolean(runtime?.config?.verboseCodexLogs || runtime?.config?.openclaw?.voiceDiagnosticsEnabled);
}

function looksLikeVoiceMessage(message) {
  if (Number(message?.message_type) === 3) {
    return true;
  }
  const items = Array.isArray(message?.item_list) ? message.item_list : [];
  return items.some((item) => {
    const type = Number(item?.type);
    return type === 3 || type === 4 || type === 5 || type === 6;
  });
}

function resolveIncomingMessageId(message) {
  return String(
    message?.message_id
      ?? message?.messageId
      ?? message?.msg_id
      ?? message?.msgId
      ?? message?.id
      ?? ""
  ).trim();
}

function attachTraceIdToNormalized(normalized, traceId) {
  if (!normalized || !traceId) {
    return normalized;
  }
  return {
    ...normalized,
    traceId,
  };
}

function buildOpenClawTraceId(message) {
  const messageId = resolveIncomingMessageId(message);
  const sessionId = String(message?.session_id ?? message?.sessionId ?? "").trim();
  const tail = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (messageId) {
    return `wx-${messageId}`;
  }
  if (sessionId) {
    return `wx-${sessionId}-${tail}`;
  }
  return `wx-${tail}`;
}

function logVoiceDiagnostics(_runtime, phase, payload = {}) {
  console.log(`[codex-im][voice] ${phase} ${JSON.stringify(payload)}`);
}

function summarizeOpenClawVoiceItemKeys(itemList) {
  if (!Array.isArray(itemList) || !itemList.length) {
    return [];
  }

  return itemList.map((item) => ({
    type: Number(item?.type) || 0,
    keys: collectObjectKeys(item),
    voiceItemKeys: collectObjectKeys(item?.voice_item),
    voiceItemMediaType: describeValueType(item?.voice_item?.media),
    voiceItemMediaKeys: collectObjectKeys(item?.voice_item?.media),
    voiceItemMediaLength: typeof item?.voice_item?.media === "string" ? item?.voice_item?.media.length : 0,
    voiceItemTextType: describeValueType(item?.voice_item?.text),
    voiceItemTextLength: typeof item?.voice_item?.text === "string" ? item?.voice_item?.text.length : 0,
    recordItemKeys: collectObjectKeys(item?.record_item),
    audioItemKeys: collectObjectKeys(item?.audio_item),
    mediaItemKeys: collectObjectKeys(item?.media_item),
  }));
}

function collectObjectKeys(value) {
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.keys(value).sort();
}

function extractOpenClawTextPayload(normalized) {
  return typeof normalized?.text === "string" ? normalized.text.trim() : "";
}

function describeValueType(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
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
