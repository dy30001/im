const MAX_MESSAGE_CONTEXT_ENTRIES = 1_000;

function resolveReplyToMessageId(_runtime, normalized, replyToMessageId = "") {
  return replyToMessageId || normalized.messageId;
}

function rememberInboundContext(runtime, normalized) {
  if (!normalized?.messageId) {
    return;
  }
  setBoundedMapEntry(runtime.messageContextByMessageId, normalized.messageId, normalized, MAX_MESSAGE_CONTEXT_ENTRIES);
  if (normalized.chatId) {
    setBoundedMapEntry(runtime.latestMessageContextByChatId, normalized.chatId, normalized, MAX_MESSAGE_CONTEXT_ENTRIES);
  }
}

function forgetInboundContext(runtime, normalized) {
  if (!normalized?.messageId) {
    return;
  }
  runtime.messageContextByMessageId.delete(normalized.messageId);
  if (normalized.chatId) {
    runtime.latestMessageContextByChatId.delete(normalized.chatId);
  }
}

function resolveMessageContext(runtime, { replyToMessageId = "", chatId = "" } = {}) {
  const byMessageId = replyToMessageId ? runtime.messageContextByMessageId.get(replyToMessageId) || null : null;
  if (byMessageId) {
    return byMessageId;
  }
  return chatId ? runtime.latestMessageContextByChatId.get(chatId) || null : null;
}

function setBoundedMapEntry(map, key, value, limit) {
  if (!map || !key) {
    return;
  }
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > limit) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) {
      break;
    }
    map.delete(oldestKey);
  }
}

module.exports = {
  resolveReplyToMessageId,
  rememberInboundContext,
  forgetInboundContext,
  resolveMessageContext,
};
