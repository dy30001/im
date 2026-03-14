const { normalizeWorkspacePath } = require("./workspace-paths");

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

  const command = parseCommand(text);

  return {
    provider: "feishu",
    workspaceId: config.defaultWorkspaceId,
    chatId: message.chat_id || "",
    threadKey: message.root_id || "",
    senderId: sender?.sender_id?.open_id || sender?.sender_id?.user_id || "",
    messageId: message.message_id || "",
    text,
    command,
    receivedAt: new Date().toISOString(),
  };
}

function buildBindingMetadata(normalized) {
  return {
    workspaceId: normalized.workspaceId,
    chatId: normalized.chatId,
    threadKey: normalized.threadKey,
    senderId: normalized.senderId,
  };
}

function extractThreadId(response) {
  return response?.result?.threadId
    || response?.result?.thread?.id
    || response?.params?.threadId
    || null;
}

function mapCodexMessageToImEvent(message) {
  const method = message?.method;
  const params = message?.params || {};
  const threadId = extractThreadIdentifier(params);
  const turnId = extractTurnIdentifier(params);

  if (isAssistantMessageMethod(method, params)) {
    const text = extractAssistantText(params);
    if (!text) {
      return null;
    }
    return {
      type: "im.agent_reply",
      payload: {
        threadId,
        turnId,
        text,
      },
    };
  }

  if (method === "turn/started" || method === "turn/start") {
    return {
      type: "im.run_state",
      payload: {
        threadId,
        turnId,
        state: "streaming",
      },
    };
  }

  if (method === "turn/completed") {
    return {
      type: "im.run_state",
      payload: {
        threadId,
        turnId,
        state: "completed",
      },
    };
  }

  if (method === "turn/failed") {
    return {
      type: "im.run_state",
      payload: {
        threadId,
        turnId,
        state: "failed",
      },
    };
  }

  if (isApprovalRequestMethod(method)) {
    return {
      type: "im.approval_request",
      payload: {
        threadId,
        reason: params.reason || "",
        command: params.command || "",
      },
    };
  }

  return null;
}

function trackRunningTurn(activeTurnIdByThreadId, message) {
  const method = message?.method;
  const params = message?.params || {};
  const threadId = params.threadId || params.thread_id || params.turn?.threadId || params.turn?.thread_id;
  const turnId = params.turnId || params.turn_id || params.turn?.id;

  if (!threadId) {
    return;
  }

  if ((method === "turn/started" || method === "turn/start") && turnId) {
    activeTurnIdByThreadId.set(threadId, turnId);
    return;
  }

  if (method === "turn/completed" || method === "turn/failed" || method === "turn/cancelled") {
    activeTurnIdByThreadId.delete(threadId);
  }
}

function trackPendingApproval(pendingApprovalByThreadId, message) {
  const method = message?.method;
  const params = message?.params || {};
  const threadId = params.threadId || params.thread_id || "";

  if (isApprovalRequestMethod(method) && threadId && message?.id != null) {
    pendingApprovalByThreadId.set(threadId, {
      requestId: message.id,
      method,
      threadId,
      reason: params.reason || "",
      command: params.command || "",
      chatId: "",
      replyToMessageId: "",
      resolution: "",
      cardMessageId: "",
    });
    return;
  }

  if (method === "turn/completed" || method === "turn/failed" || method === "turn/cancelled") {
    pendingApprovalByThreadId.delete(threadId);
  }
}

function trackRunKeyState(currentRunKeyByThreadId, activeTurnIdByThreadId, message) {
  const method = message?.method;
  const params = message?.params || {};
  const threadId = params.threadId || params.thread_id || params.turn?.threadId || params.turn?.thread_id || "";
  const turnId = params.turnId || params.turn_id || params.turn?.id || activeTurnIdByThreadId.get(threadId) || "";
  if (!threadId) {
    return;
  }

  if ((method === "turn/started" || method === "turn/start") && turnId) {
    currentRunKeyByThreadId.set(threadId, buildRunKey(threadId, turnId));
    return;
  }

  if (method === "turn/completed" || method === "turn/failed" || method === "turn/cancelled") {
    if (turnId) {
      currentRunKeyByThreadId.set(threadId, buildRunKey(threadId, turnId));
    }
  }
}

function isApprovalRequestMethod(method) {
  if (typeof method !== "string" || !method) {
    return false;
  }

  return (
    method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method.endsWith("requestApproval")
    || method === "approval/requested"
  );
}

function resolveApprovalDecision(command, method, rawText) {
  if (command !== "approve") {
    return "decline";
  }

  const normalizedMethod = typeof method === "string" ? method.trim() : "";
  const normalizedText = typeof rawText === "string" ? rawText.trim().toLowerCase() : "";
  const isCommandApproval = isCommandApprovalMethod(normalizedMethod);
  const wantsSession = normalizedText === "/codex approve session"
    || normalizedText.endsWith(" approve session");

  if (isCommandApproval && wantsSession) {
    return "acceptForSession";
  }

  return "accept";
}

function buildApprovalResponsePayload(decision, method) {
  const normalizedMethod = String(method || "").toLowerCase();
  if (normalizedMethod.includes("requestapproval")) {
    return { decision };
  }
  return decision;
}

function buildRunKey(threadId, turnId) {
  return `${threadId}:${turnId || "pending"}`;
}

function extractTurnIdFromRunKey(runKey) {
  if (!runKey || !runKey.includes(":")) {
    return "";
  }
  return runKey.slice(runKey.indexOf(":") + 1);
}

function extractCreatedMessageId(response) {
  return response?.data?.message_id || response?.data?.message?.message_id || "";
}

function extractThreadsFromListResponse(response) {
  const candidates = [
    response?.result?.data,
    response?.result?.threads,
    response?.result?.items,
    response?.data,
    response?.threads,
    response?.items,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    return candidate
      .map((thread) => ({
        id: normalizeIdentifier(thread?.id || thread?.threadId || thread?.thread_id),
        cwd: extractThreadWorkspaceRoot(thread),
        title: extractThreadDisplayName(thread),
        updatedAt: thread?.updated_at || thread?.updatedAt || 0,
      }))
      .filter((thread) => thread.id);
  }

  return [];
}

function extractThreadListCursor(response) {
  const cursorCandidates = [
    response?.result?.next_cursor,
    response?.result?.nextCursor,
    response?.result?.cursor,
    response?.cursor,
    response?.next_cursor,
    response?.nextCursor,
  ];

  for (const candidate of cursorCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function extractRecentConversationFromResumeResponse(response, turnLimit = 3) {
  const turns = response?.result?.thread?.turns;
  if (!Array.isArray(turns) || !turns.length) {
    return [];
  }

  const recentTurns = turns.slice(-turnLimit);
  const messages = [];

  for (const turn of recentTurns) {
    const userMessage = extractResumeTurnUserInput(turn);
    if (userMessage) {
      messages.push(userMessage);
    }

    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const item of items) {
      const normalized = normalizeResumedConversationItem(item);
      if (normalized) {
        messages.push(normalized);
      }
    }
  }

  return dedupeRecentConversationMessages(messages).slice(-6);
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
    return {
      kind: value.kind,
      action: value.action || "",
    };
  }
  if (value.kind === "thread") {
    return {
      kind: value.kind,
      action: value.action || "",
      threadId: value.threadId || "",
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
  const openMessageId = data?.context?.open_message_id
    || data?.context?.openMessageId
    || data?.open_message_id
    || data?.openMessageId
    || data?.message_id
    || "card-action";
  const chatId = extractCardChatId(data);
  if (!chatId) {
    console.log("[codex-im] card callback missing chatId", {
      context_open_message_id: data?.context?.open_message_id,
      context_open_chat_id: data?.context?.open_chat_id,
      open_message_id: data?.open_message_id,
      open_chat_id: data?.open_chat_id,
      message_id: data?.message_id,
      chat_id: data?.chat_id,
    });
    return null;
  }
  return {
    provider: "feishu",
    workspaceId: config.defaultWorkspaceId,
    chatId,
    threadKey: "",
    senderId: data?.operator?.open_id || data?.operator?.operator_id?.open_id || data?.user_id || "",
    messageId: openMessageId,
    text: "",
    command: "",
    receivedAt: new Date().toISOString(),
  };
}

function eventShouldClearPendingReaction(event) {
  if (!event || typeof event !== "object") {
    return false;
  }

  if (event.type === "im.run_state") {
    const state = String(event.payload?.state || "").toLowerCase();
    return state === "completed" || state === "failed";
  }

  if (event.type === "im.approval_request") {
    return true;
  }

  return false;
}

function extractAssistantText(params) {
  const eventObject = envelopeEventObject(params);
  const itemObject = params?.item && typeof params.item === "object" ? params.item : null;

  const directCandidates = [
    params?.delta,
    params?.textDelta,
    params?.text_delta,
    params?.text,
    typeof params?.message === "string" ? params.message : "",
    params?.summary,
    params?.part,
    eventObject?.delta,
    eventObject?.text,
    typeof eventObject?.message === "string" ? eventObject.message : "",
    eventObject?.summary,
    itemObject?.delta,
    itemObject?.text,
    typeof itemObject?.message === "string" ? itemObject.message : "",
    itemObject?.summary,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const contentObjects = [
    params?.content,
    params?.message?.content,
    itemObject?.content,
    eventObject?.content,
  ];

  for (const content of contentObjects) {
    const extracted = extractTextFromContent(content);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function parseFeishuMessageText(rawContent) {
  try {
    const parsed = JSON.parse(rawContent || "{}");
    return typeof parsed.text === "string" ? parsed.text.trim() : "";
  } catch {
    return "";
  }
}

function parseCommand(text) {
  const normalized = text.trim().toLowerCase();
  const prefixes = ["/codex "];
  const exactPrefixes = ["/codex"];

  const exactCommands = {
    stop: ["stop"],
    where: ["where"],
    inspect_message: ["message"],
    help: ["help"],
    workspace: ["workspace"],
    remove: ["remove"],
    new: ["new"],
    approve: ["approve", "approve session"],
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
  if (matchesPrefixCommand(normalized, "bind")) {
    return "bind";
  }
  if (prefixes.some((prefix) => normalized.startsWith(prefix))) {
    return "unknown_command";
  }
  if (exactPrefixes.includes(normalized)) {
    return "unknown_command";
  }
  if (text.trim()) {
    return "message";
  }

  return "";
}

function matchesExactCommand(text, suffixes) {
  return suffixes.some((suffix) => (
    text === `/codex ${suffix}`
  ));
}

function matchesPrefixCommand(text, command) {
  return text.startsWith(`/codex ${command} `);
}

function isAssistantMessageMethod(method, params) {
  if (method === "item/agentMessage/delta"
    || method === "codex/event/agent_message_content_delta"
    || method === "codex/event/agent_message_delta"
    || method === "codex/event/agent_message"
    || method === "agent/message") {
    return true;
  }

  if (method === "message/created" || method === "item/completed" || method === "codex/event/item_completed") {
    return looksLikeAssistantPayload(params);
  }

  return false;
}

function looksLikeAssistantPayload(params) {
  const eventObject = envelopeEventObject(params);
  const itemObject = params?.item && typeof params.item === "object" ? params.item : null;
  const candidates = [
    params?.type,
    params?.item?.type,
    params?.role,
    params?.source,
    params?.author,
    itemObject?.type,
    itemObject?.role,
    itemObject?.source,
    itemObject?.author,
    eventObject?.type,
    eventObject?.role,
    eventObject?.source,
    eventObject?.author,
    eventObject?.item?.type,
    eventObject?.item?.role,
    eventObject?.item?.source,
    eventObject?.item?.author,
  ]
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter(Boolean);

  if (candidates.some((value) => value.includes("user"))) {
    return false;
  }

  return (
    candidates.some((value) => value.includes("assistant") || value.includes("agent"))
  );
}

function isCommandApprovalMethod(method) {
  const normalizedMethod = String(method || "").trim().toLowerCase();
  if (!normalizedMethod) {
    return false;
  }

  const compact = normalizedMethod.replace(/[^a-z]/g, "");
  return (
    compact.includes("commandexecutionrequestapproval")
    || compact.includes("commandrequestapproval")
  );
}

function extractThreadDisplayName(thread) {
  const candidates = [
    thread?.title,
    thread?.displayTitle,
    thread?.headline,
    thread?.name,
    thread?.preview,
    thread?.summary,
    thread?.thread?.title,
    thread?.thread?.displayTitle,
    thread?.thread?.headline,
    thread?.thread?.name,
    thread?.thread?.preview,
    thread?.thread?.summary,
    thread?.metadata?.title,
    thread?.thread?.metadata?.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function extractThreadWorkspaceRoot(thread) {
  const candidates = [
    thread?.cwd,
    thread?.thread?.cwd,
    thread?.workspaceRoot,
    thread?.workspace_root,
    thread?.path,
    thread?.thread?.workspaceRoot,
    thread?.thread?.workspace_root,
    thread?.thread?.path,
    thread?.workspace?.root,
    thread?.workspace?.cwd,
    thread?.workspace?.path,
  ];

  for (const candidate of candidates) {
    const extracted = extractPossiblePathValue(candidate);
    if (extracted) {
      return normalizeWorkspacePath(extracted);
    }
  }

  return "";
}

function extractPossiblePathValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const objectCandidates = [
    value.path,
    value.cwd,
    value.root,
    value.uri,
    value.url,
    value.pathname,
    value.value,
  ];

  for (const candidate of objectCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function extractResumeTurnUserInput(turn) {
  if (!turn || typeof turn !== "object") {
    return null;
  }

  const text = extractTextFromContent(turn.input);
  if (!text) {
    return null;
  }

  return {
    role: "user",
    text,
  };
}

function dedupeRecentConversationMessages(messages) {
  const deduped = [];
  for (const message of messages) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === message.role && previous.text === message.text) {
      continue;
    }
    deduped.push(message);
  }
  return deduped;
}

function normalizeResumedConversationItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const itemType = String(item.type || item.kind || "").toLowerCase();
  if (itemType === "usermessage") {
    const text = extractTextFromResumeUserMessage(item);
    return text ? { role: "user", text } : null;
  }

  if (itemType === "agentmessage") {
    const text = extractTextFromResumeAgentMessage(item);
    return text ? { role: "assistant", text } : null;
  }

  const role = String(
    item.role
      || item.author
      || item.payload?.role
      || item.payload?.author
      || item.payload?.source
      || item.source
      || ""
  ).toLowerCase();
  const contentTypes = collectResumeContentTypes(item);
  const text = extractTextFromContent(
    item.text
      || item.message
      || item.content
      || item.payload?.content
      || item.payload?.text
      || item.payload?.message
  );

  if (!text) {
    return null;
  }

  const normalizedRole = resolveResumeItemRole({ itemType, role, contentTypes });

  if (!normalizedRole) {
    return null;
  }

  return {
    role: normalizedRole,
    text,
  };
}

function collectResumeContentTypes(item) {
  const content = [];

  if (Array.isArray(item?.content)) {
    content.push(...item.content);
  }
  if (Array.isArray(item?.payload?.content)) {
    content.push(...item.payload.content);
  }

  return content
    .map((entry) => String(entry?.type || "").toLowerCase())
    .filter(Boolean);
}

function resolveResumeItemRole({ itemType, role, contentTypes }) {
  const isAssistant = (
    role.includes("assistant")
    || role.includes("agent")
    || itemType.includes("assistant")
    || itemType.includes("agent")
    || contentTypes.some((type) => (
      type.includes("output_text")
      || type.includes("assistant")
      || type.includes("agent")
    ))
  );
  if (isAssistant) {
    return "assistant";
  }

  const isUser = (
    role.includes("user")
    || itemType.includes("user")
    || contentTypes.some((type) => (
      type.includes("input_text")
      || type === "user_message"
      || type === "user"
      || type === "text"
    ))
  );
  if (isUser) {
    return "user";
  }

  if (itemType === "message") {
    return "assistant";
  }

  return "";
}

function extractTextFromResumeUserMessage(item) {
  const content = Array.isArray(item?.content) ? item.content : [];
  if (content.length) {
    const parts = [];
    for (const entry of content) {
      const entryType = String(entry?.type || "").toLowerCase();
      if (entryType === "text" && typeof entry?.text === "string" && entry.text.trim()) {
        parts.push(entry.text.trim());
        continue;
      }
      if (entryType === "skill") {
        const skillName = typeof entry?.name === "string" ? entry.name.trim() : "";
        if (skillName) {
          parts.push(`$${skillName}`);
        }
      }
    }
    const joined = parts.join(" ").trim();
    if (joined) {
      return joined;
    }
  }

  return extractTextFromContent(item?.text || item?.message || item?.payload?.text || item?.payload?.message);
}

function extractTextFromResumeAgentMessage(item) {
  return extractTextFromContent(
    item?.text
      || item?.message
      || item?.content
      || item?.payload?.text
      || item?.payload?.message
      || item?.payload?.content
  );
}

function extractCardChatId(data) {
  return data?.context?.open_chat_id
    || data?.context?.openChatId
    || data?.open_chat_id
    || data?.openChatId
    || data?.chat_id
    || "";
}

function envelopeEventObject(params) {
  if (!params || typeof params !== "object") {
    return null;
  }
  if (params.msg && typeof params.msg === "object") {
    return params.msg;
  }
  if (params.event && typeof params.event === "object") {
    return params.event;
  }
  return null;
}

function extractThreadIdentifier(params) {
  const eventObject = envelopeEventObject(params);
  return normalizeIdentifier(
    params?.threadId
      || params?.thread_id
      || params?.turn?.threadId
      || params?.turn?.thread_id
      || params?.item?.threadId
      || params?.item?.thread_id
      || eventObject?.threadId
      || eventObject?.thread_id
      || eventObject?.turn?.threadId
      || eventObject?.turn?.thread_id
      || eventObject?.item?.threadId
      || eventObject?.item?.thread_id
  );
}

function extractTurnIdentifier(params) {
  const eventObject = envelopeEventObject(params);
  return normalizeIdentifier(
    params?.turnId
      || params?.turn_id
      || params?.turn?.id
      || params?.item?.turnId
      || params?.item?.turn_id
      || eventObject?.turnId
      || eventObject?.turn_id
      || eventObject?.turn?.id
      || eventObject?.item?.turnId
      || eventObject?.item?.turn_id
  );
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function extractTextFromContent(content) {
  if (!content) {
    return "";
  }

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      const extracted = extractTextFromContent(item);
      if (extracted) {
        parts.push(extracted);
      }
    }
    return parts.join("\n").trim();
  }

  if (typeof content === "object") {
    if (typeof content.message === "string" && content.message.trim()) {
      return content.message.trim();
    }
    if (typeof content.delta === "string" && content.delta.trim()) {
      return content.delta.trim();
    }
    if (typeof content.text === "string" && content.text.trim()) {
      return content.text.trim();
    }
    if (typeof content.summary === "string" && content.summary.trim()) {
      return content.summary.trim();
    }
    if (typeof content.content === "string" && content.content.trim()) {
      return content.content.trim();
    }
    if (content.data && typeof content.data === "object") {
      const extractedFromData = extractTextFromContent(content.data);
      if (extractedFromData) {
        return extractedFromData;
      }
    }
    if (Array.isArray(content.content)) {
      return extractTextFromContent(content.content);
    }
  }

  return "";
}

module.exports = {
  buildApprovalResponsePayload,
  buildBindingMetadata,
  buildRunKey,
  eventShouldClearPendingReaction,
  extractCardAction,
  extractCreatedMessageId,
  extractThreadId,
  extractThreadListCursor,
  extractThreadsFromListResponse,
  extractTurnIdFromRunKey,
  extractRecentConversationFromResumeResponse,
  isApprovalRequestMethod,
  mapCodexMessageToImEvent,
  normalizeCardActionContext,
  normalizeFeishuTextEvent,
  resolveApprovalDecision,
  trackPendingApproval,
  trackRunKeyState,
  trackRunningTurn,
};
