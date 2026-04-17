const appDispatcher = require("./dispatcher");
const { normalizeOpenClawTextEvent } = require("../presentation/message/normalizers");

function applyOpenClawPollResponse(runtime, response) {
  if (typeof response?.get_updates_buf === "string") {
    runtime.syncCursor = response.get_updates_buf;
  }
  return Array.isArray(response?.msgs) ? response.msgs : [];
}

function logOpenClawPolledMessages(runtime, messages) {
  if (!runtime.config.verboseCodexLogs || !messages.length) {
    return;
  }
  console.log(`[codex-im] openclaw poll received ${messages.length} message(s)`);
}

function logOpenClawMessageEnvelope(runtime, message) {
  if (!runtime.config.verboseCodexLogs) {
    return;
  }
  console.log(
    "[codex-im] openclaw message",
    JSON.stringify({
      messageId: message?.message_id ?? "",
      fromUserId: message?.from_user_id ?? "",
      toUserId: message?.to_user_id ?? "",
      sessionId: message?.session_id ?? "",
      messageType: message?.message_type ?? "",
      itemTypes: Array.isArray(message?.item_list)
        ? message.item_list.map((item) => item?.type ?? "")
        : [],
    })
  );
}

async function dispatchOpenClawMessages(runtime, messages) {
  const groups = groupOpenClawMessagesByBinding(runtime, messages);
  await Promise.all(groups.map(async (group) => {
    for (const message of group) {
      logOpenClawMessageEnvelope(runtime, message);
      await appDispatcher.onOpenClawTextEvent(runtime, message).catch((error) => {
        console.error(`[codex-im] failed to process OpenClaw message: ${error.message}`);
      });
    }
  }));
}

function groupOpenClawMessagesByBinding(runtime, messages) {
  const groupsByKey = new Map();
  const orderedGroups = [];

  messages.forEach((message, index) => {
    const groupKey = buildOpenClawMessageGroupKey(runtime, message, index);
    let group = groupsByKey.get(groupKey);
    if (!group) {
      group = [];
      groupsByKey.set(groupKey, group);
      orderedGroups.push(group);
    }
    group.push(message);
  });

  return orderedGroups;
}

function buildOpenClawMessageGroupKey(runtime, message, index) {
  const normalized = normalizeOpenClawTextEvent(message, runtime?.config || {});
  if (normalized && typeof runtime?.sessionStore?.buildBindingKey === "function") {
    const bindingKey = String(runtime.sessionStore.buildBindingKey(normalized) || "").trim();
    if (bindingKey) {
      return `binding:${bindingKey}`;
    }
  }

  const messageId = String(normalized?.messageId || message?.message_id || message?.messageId || index).trim();
  const chatId = String(normalized?.chatId || message?.from_user_id || message?.fromUserId || "").trim();
  const threadKey = String(normalized?.threadKey || message?.session_id || message?.sessionId || "").trim();
  return `fallback:${chatId}:${threadKey}:${messageId}`;
}

module.exports = {
  applyOpenClawPollResponse,
  dispatchOpenClawMessages,
  logOpenClawPolledMessages,
};
