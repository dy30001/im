const appDispatcher = require("./dispatcher");

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
  for (const message of messages) {
    logOpenClawMessageEnvelope(runtime, message);
    await appDispatcher.onOpenClawTextEvent(runtime, message).catch((error) => {
      console.error(`[codex-im] failed to process OpenClaw message: ${error.message}`);
    });
  }
}

module.exports = {
  applyOpenClawPollResponse,
  dispatchOpenClawMessages,
  logOpenClawPolledMessages,
};
