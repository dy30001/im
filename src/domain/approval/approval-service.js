const codexMessageUtils = require("../../infra/codex/message-utils");
const { extractCardChatId } = require("../../infra/feishu/client-adapter");

function buildApprovalRequestKey(threadId, requestId) {
  const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
  const normalizedRequestId = requestId == null ? "" : String(requestId).trim();
  if (!normalizedThreadId || !normalizedRequestId) {
    return "";
  }
  return `${normalizedThreadId}:${normalizedRequestId}`;
}

function beginApprovalResolution(runtime, requestKey) {
  if (!requestKey || runtime.inFlightApprovalRequestKeys.has(requestKey)) {
    return false;
  }
  runtime.inFlightApprovalRequestKeys.add(requestKey);
  return true;
}

function endApprovalResolution(runtime, requestKey) {
  if (!requestKey) {
    return;
  }
  runtime.inFlightApprovalRequestKeys.delete(requestKey);
}

async function applyApprovalDecision(runtime, {
  threadId,
  approval,
  command,
  workspaceRoot = "",
  scope = "once",
}) {
  const decision = command === "approve" ? "accept" : "decline";
  const isWorkspaceScope = scope === "workspace";
  const requestKey = buildApprovalRequestKey(threadId, approval.requestId);
  if (!beginApprovalResolution(runtime, requestKey)) {
    return {
      error: null,
      ignoredAsDuplicate: true,
      decision,
      scope: isWorkspaceScope ? "workspace" : "once",
      method: approval.method,
    };
  }

  try {
    if (
      decision === "accept"
      && isWorkspaceScope
      && codexMessageUtils.isCommandApprovalMethod(approval.method)
    ) {
      const resolvedWorkspaceRoot = workspaceRoot || runtime.resolveWorkspaceRootForThread(threadId);
      runtime.rememberApprovalPrefixForWorkspace(resolvedWorkspaceRoot, approval.commandTokens);
    }

    await runtime.codex.sendResponse(
      approval.requestId,
      codexMessageUtils.buildApprovalResponsePayload(decision)
    );
    await markApprovalResolved(runtime, threadId, decision === "accept" ? "approved" : "rejected");
    return {
      error: null,
      ignoredAsDuplicate: false,
      decision,
      scope: isWorkspaceScope ? "workspace" : "once",
      method: approval.method,
    };
  } catch (error) {
    return {
      error,
      ignoredAsDuplicate: false,
      decision,
      scope: isWorkspaceScope ? "workspace" : "once",
      method: approval.method,
    };
  } finally {
    endApprovalResolution(runtime, requestKey);
  }
}

function buildApprovalResultText({ decision, scope, method }) {
  if (decision !== "accept") {
    return "已拒绝本次请求。";
  }
  if (scope === "workspace" && codexMessageUtils.isCommandApprovalMethod(method)) {
    return "已工作区允许该命令，后续同工作区下同前缀命令将自动放行。";
  }
  return "已允许本次请求。";
}

async function handleApprovalCommand(runtime, normalized) {
  const { workspaceRoot, threadId } = runtime.getCurrentThreadContext(normalized);
  const approval = threadId ? runtime.pendingApprovalByThreadId.get(threadId) || null : null;

  if (!threadId || !approval) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "当前没有待处理的授权请求。",
    });
    return;
  }

  try {
    const outcome = await applyApprovalDecision(runtime, {
      threadId,
      approval,
      command: normalized.command,
      workspaceRoot,
      scope: codexMessageUtils.isWorkspaceApprovalCommand(normalized.text) ? "workspace" : "once",
    });
    if (outcome.error) {
      throw outcome.error;
    }
    if (outcome.ignoredAsDuplicate) {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: normalized.messageId,
        text: "该授权请求正在处理中，请稍后。",
        kind: "info",
      });
      return;
    }

    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: buildApprovalResultText(outcome),
      kind: outcome.decision === "accept" ? "success" : "info",
    });
  } catch (error) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: `处理授权失败: ${error.message}`,
    });
  }
}

async function markApprovalResolved(runtime, threadId, resolution) {
  const approval = runtime.pendingApprovalByThreadId.get(threadId);
  if (!approval) {
    return;
  }

  approval.resolution = resolution;
  runtime.pendingApprovalByThreadId.delete(threadId);

  if (approval.cardMessageId) {
    try {
      await runtime.updateInteractiveCard({
        messageId: approval.cardMessageId,
        approval,
      });
    } catch (error) {
      console.error(`[codex-im] failed to update approval card: ${error.message}`);
    }
  }
}

async function handleApprovalCardActionAsync(runtime, action, data) {
  const approval = runtime.pendingApprovalByThreadId.get(action.threadId);
  if (!approval || String(approval.requestId) !== String(action.requestId)) {
    await runtime.sendCardActionFeedback(data, "该授权请求已失效。", "error");
    return;
  }

  const chatId = approval.chatId || extractCardChatId(data);
  if (chatId) {
    await runtime.sendInfoCardMessage({
      chatId,
      replyToMessageId: approval.cardMessageId || approval.replyToMessageId || "",
      text: "正在处理授权，等待 Codex 继续执行...",
      kind: "progress",
    });
  }

  try {
    const outcome = await applyApprovalDecision(runtime, {
      threadId: action.threadId,
      approval,
      command: action.decision,
      workspaceRoot: runtime.resolveWorkspaceRootForThread(action.threadId),
      scope: action.scope === "workspace" ? "workspace" : "once",
    });
    if (outcome.error) {
      throw outcome.error;
    }
    if (outcome.ignoredAsDuplicate) {
      await runtime.sendCardActionFeedback(data, "该授权请求正在处理中，请稍后。", "info");
      return;
    }
  } catch (error) {
    await runtime.sendCardActionFeedback(data, `处理失败: ${error.message}`, "error");
  }
}

module.exports = {
  applyApprovalDecision,
  handleApprovalCommand,
  handleApprovalCardActionAsync,
};
