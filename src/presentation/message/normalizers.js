const codexMessageUtils = require("../../infra/codex/message-utils");
const { COMMAND_ROOTS, detectNaturalCommand } = require("../../shared/command-parsing");

function normalizeFeishuTextEvent(event, config) {
  const message = event?.message || {};
  const sender = event?.sender || {};
  if (message.message_type !== "text") {
    return null;
  }

  const text = parseFeishuMessageText(message.content);
  if (!text) {
    return null;
  }

  return {
    provider: "feishu",
    workspaceId: config.defaultWorkspaceId,
    chatId: message.chat_id || "",
    threadKey: message.root_id || "",
    senderId: sender?.sender_id?.open_id || sender?.sender_id?.user_id || "",
    messageId: message.message_id || "",
    text,
    command: parseCommand(text),
    receivedAt: new Date().toISOString(),
  };
}

function normalizeOpenClawTextEvent(message, config) {
  const text = extractOpenClawText(message?.item_list);
  const voiceText = extractOpenClawVoiceText(message?.item_list);
  const messageType = Number(message?.message_type) || 0;
  if (messageType !== 1 && messageType !== 3) {
    return null;
  }
  if (!text && !voiceText) {
    return null;
  }

  const fromUserId = resolveOpenClawSenderId(message);
  const sessionId = resolveOpenClawSessionId(message);
  const messageId = resolveOpenClawMessageId(message);
  if (!fromUserId || !messageId) {
    return null;
  }
  const createdAt = Number.isFinite(Number(message?.create_time_ms))
    ? new Date(Number(message.create_time_ms)).toISOString()
    : new Date().toISOString();

  const normalizedText = text || voiceText;

  return {
    provider: "openclaw",
    workspaceId: config.defaultWorkspaceId,
    chatId: fromUserId,
    threadKey: sessionId,
    senderId: fromUserId,
    messageId,
    text: normalizedText,
    command: normalizedText ? parseCommand(normalizedText) : "message",
    receivedAt: createdAt,
    contextToken: normalizeIdentifier(message?.context_token),
    inputKind: "text",
  };
}

function extractCardAction(data) {
  const action = data?.action || {};
  const value = action.value || {};
  if (!value.kind) {
    console.log("[codex-im] card callback action missing kind", {
      action,
      hasValue: !!action.value,
    });
    return null;
  }

  if (value.kind === "approval") {
    return {
      kind: value.kind,
      decision: value.decision,
      scope: value.scope || "once",
      requestId: value.requestId,
      threadId: value.threadId,
    };
  }
  if (value.kind === "panel") {
    const selectedValue = extractCardSelectedValue(action, value);
    return {
      kind: value.kind,
      action: value.action || "",
      selectedValue,
    };
  }
  if (value.kind === "thread") {
    return {
      kind: value.kind,
      action: value.action || "",
      threadId: value.threadId || "",
      page: normalizeActionPage(value.page),
    };
  }
  if (value.kind === "workspace") {
    return {
      kind: value.kind,
      action: value.action || "",
      workspaceRoot: value.workspaceRoot || "",
    };
  }
  return null;
}

function normalizeCardActionContext(data, config) {
  const messageId = normalizeIdentifier(data?.context?.open_message_id);
  const chatId = extractCardChatId(data);
  const senderId = normalizeIdentifier(data?.operator?.open_id);

  if (!chatId || !messageId || !senderId) {
    console.log("[codex-im] card callback missing required context", {
      context_open_message_id: data?.context?.open_message_id,
      context_open_chat_id: data?.context?.open_chat_id,
      operator_open_id: data?.operator?.open_id,
    });
    return null;
  }

  return {
    provider: "feishu",
    workspaceId: config.defaultWorkspaceId,
    chatId,
    threadKey: "",
    senderId,
    messageId,
    text: "",
    command: "",
    receivedAt: new Date().toISOString(),
  };
}

function mapCodexMessageToImEvent(message) {
  return codexMessageUtils.mapCodexMessageToImEvent(message);
}

function parseFeishuMessageText(rawContent) {
  try {
    const parsed = JSON.parse(rawContent || "{}");
    return typeof parsed.text === "string" ? parsed.text.trim() : "";
  } catch {
    return "";
  }
}

function extractOpenClawText(itemList) {
  if (!Array.isArray(itemList)) {
    return "";
  }

  const textParts = itemList
    .filter((item) => Number(item?.type) === 1)
    .map((item) => String(item?.text_item?.text || "").trim())
    .filter(Boolean);

  return textParts.join("\n\n");
}

function extractOpenClawVoiceText(itemList) {
  if (!Array.isArray(itemList)) {
    return "";
  }

  for (const item of itemList) {
    const voiceText = extractOpenClawVoiceTextFromItem(item);
    if (voiceText) {
      return voiceText;
    }
  }

  return "";
}

function extractOpenClawVoiceTextFromItem(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const payload = pickFirstObject(item.voice_item, item.voiceItem);
  if (!payload || typeof payload !== "object") {
    return "";
  }

  return normalizeText(
    payload.text
      || payload.transcript
      || payload.transcribed_text
      || payload.transcribedText
      || payload.caption
      || payload.content
  );
}

function pickFirstObject(...candidates) {
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      return candidate;
    }
  }
  return null;
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function parseCommand(text) {
  const normalized = text.trim().toLowerCase();

  const exactCommands = {
    stop: ["stop"],
    where: ["where"],
    browse: ["browse"],
    threads: ["threads"],
    inspect_message: ["message"],
    help: ["help"],
    workspace: ["workspace"],
    remove: ["remove"],
    send: ["send"],
    new: ["new"],
    model: ["model"],
    effort: ["effort"],
    status: ["status"],
    approve: ["approve", "approve workspace"],
    reject: ["reject"],
  };

  for (const [command, suffixes] of Object.entries(exactCommands)) {
    if (matchesExactCommand(normalized, suffixes)) {
      return command;
    }
  }

  if (matchesPrefixCommand(normalized, "switch")) {
    return "switch";
  }
  if (matchesPrefixCommand(normalized, "remove")) {
    return "remove";
  }
  if (matchesPrefixCommand(normalized, "send")) {
    return "send";
  }
  if (matchesPrefixCommand(normalized, "bind")) {
    return "bind";
  }
  if (matchesPrefixCommand(normalized, "model")) {
    return "model";
  }
  if (matchesPrefixCommand(normalized, "effort")) {
    return "effort";
  }
  const naturalCommand = detectNaturalCommand(text);
  if (naturalCommand) {
    return naturalCommand;
  }
  if (matchesCommandRoot(normalized)) {
    return "unknown_command";
  }
  if (text.trim()) {
    return "message";
  }

  return "";
}

function matchesExactCommand(text, suffixes) {
  return suffixes.some((suffix) => COMMAND_ROOTS.some((root) => text === `${root} ${suffix}`));
}

function matchesPrefixCommand(text, command) {
  return COMMAND_ROOTS.some((root) => text.startsWith(`${root} ${command} `));
}

function matchesCommandRoot(text) {
  return COMMAND_ROOTS.some((root) => text === root || text.startsWith(`${root} `));
}

function extractCardChatId(data) {
  return normalizeIdentifier(data?.context?.open_chat_id);
}

function extractCardSelectedValue(action, value) {
  if (typeof action?.option?.value === "string" && action.option.value.trim()) {
    return action.option.value.trim();
  }
  if (typeof action?.option === "string" && action.option.trim()) {
    return action.option.trim();
  }
  return typeof value?.selectedValue === "string" ? value.selectedValue.trim() : "";
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeLooseIdentifier(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function resolveOpenClawSenderId(message) {
  return (
    normalizeLooseIdentifier(message?.from_user_id)
    || normalizeLooseIdentifier(message?.fromUserId)
    || normalizeLooseIdentifier(message?.sender_id)
    || normalizeLooseIdentifier(message?.senderId)
    || normalizeLooseIdentifier(message?.from_id)
    || normalizeLooseIdentifier(message?.fromId)
    || normalizeLooseIdentifier(message?.from?.user_id)
    || normalizeLooseIdentifier(message?.from?.userId)
    || normalizeLooseIdentifier(message?.user_id)
    || normalizeLooseIdentifier(message?.userId)
  );
}

function resolveOpenClawSessionId(message) {
  return (
    normalizeLooseIdentifier(message?.session_id)
    || normalizeLooseIdentifier(message?.sessionId)
    || normalizeLooseIdentifier(message?.chat_id)
    || normalizeLooseIdentifier(message?.chatId)
  );
}

function resolveOpenClawMessageId(message) {
  return (
    normalizeLooseIdentifier(message?.message_id)
    || normalizeLooseIdentifier(message?.messageId)
    || normalizeLooseIdentifier(message?.msg_id)
    || normalizeLooseIdentifier(message?.msgId)
    || normalizeLooseIdentifier(message?.id)
  );
}

function normalizeActionPage(value) {
  const page = Number(value);
  if (Number.isInteger(page) && page >= 0) {
    return page;
  }
  if (value !== undefined && value !== null && value !== "") {
    console.warn("[codex-im] invalid thread action page, falling back to 0", {
      rawPage: value,
    });
  }
  return 0;
}

module.exports = {
  extractCardAction,
  mapCodexMessageToImEvent,
  normalizeCardActionContext,
  normalizeFeishuTextEvent,
  normalizeOpenClawTextEvent,
};
