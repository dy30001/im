const { normalizeWorkspacePath } = require("../shared/workspace-paths");

const TEXT_COMMAND_HANDLER_METHODS = {
  stop: "handleStopCommand",
  bind: "handleBindCommand",
  where: "handleWhereCommand",
  inspect_message: "handleMessageCommand",
  help: "handleHelpCommand",
  unknown_command: "handleUnknownCommand",
  workspace: "handleWorkspacesCommand",
  switch: "handleSwitchCommand",
  remove: "handleRemoveCommand",
  new: "handleNewCommand",
  approve: "handleApprovalCommand",
  reject: "handleApprovalCommand",
};

const CARD_ACTION_KIND_METHODS = {
  panel: "handlePanelCardAction",
  thread: "handleThreadCardAction",
  workspace: "handleWorkspaceCardAction",
};

const PANEL_CARD_ACTIONS = {
  open_threads: {
    feedback: "正在打开线程列表...",
    run: (runtime, normalized) => runtime.showThreadPicker(normalized, { replyToMessageId: normalized.messageId }),
  },
  new_thread: {
    feedback: "正在创建新线程...",
    run: (runtime, normalized) => runtime.handleNewCommand(normalized),
  },
  show_messages: {
    feedback: "正在获取最近消息...",
    run: (runtime, normalized) => runtime.handleMessageCommand(normalized),
  },
  stop: {
    feedback: "正在发送停止请求...",
    run: (runtime, normalized) => runtime.handleStopCommand(normalized),
  },
  status: {
    feedback: "正在刷新状态...",
    run: (runtime, normalized) => runtime.showStatusPanel(normalized, { replyToMessageId: normalized.messageId }),
  },
};

const THREAD_CARD_ACTIONS = {
  switch: {
    feedback: "正在切换线程...",
    validate: (runtime, normalized, action) => {
      const { threadId: currentThreadId } = runtime.getCurrentThreadContext(normalized);
      if (currentThreadId && currentThreadId === action.threadId) {
        return { text: "已经是当前线程，无需切换。", kind: "info" };
      }
      return null;
    },
    run: (runtime, normalized, action) => (
      runtime.switchThreadById(normalized, action.threadId, { replyToMessageId: normalized.messageId })
    ),
  },
  messages: {
    feedback: "正在获取最近消息...",
    validate: (runtime, normalized, action) => {
      const { threadId: currentThreadId } = runtime.getCurrentThreadContext(normalized);
      if (!currentThreadId || currentThreadId !== action.threadId) {
        return { text: "非当前线程，请先切换到该线程。", kind: "error" };
      }
      return null;
    },
    run: (runtime, normalized) => runtime.handleMessageCommand(normalized),
  },
};

const WORKSPACE_CARD_ACTIONS = {
  status: {
    feedback: "正在查看线程列表...",
    run: (runtime, normalized) => runtime.showStatusPanel(normalized, { replyToMessageId: normalized.messageId }),
  },
  remove: {
    feedback: "正在移除项目...",
    run: (runtime, normalized, action) => (
      runtime.removeWorkspaceByPath(normalized, action.workspaceRoot, { replyToMessageId: normalized.messageId })
    ),
  },
  switch: {
    feedback: "正在切换项目...",
    validate: (runtime, normalized, action) => {
      const { workspaceRoot: currentWorkspaceRoot } = runtime.getBindingContext(normalized);
      const targetWorkspaceRoot = normalizeWorkspacePath(action.workspaceRoot);
      if (currentWorkspaceRoot && targetWorkspaceRoot && currentWorkspaceRoot === targetWorkspaceRoot) {
        return { text: "已经是当前项目，无需切换。", kind: "info" };
      }
      return null;
    },
    run: (runtime, normalized, action) => (
      runtime.switchWorkspaceByPath(normalized, action.workspaceRoot, { replyToMessageId: normalized.messageId })
    ),
  },
};

async function dispatchTextCommand(runtime, normalized) {
  const handlerMethod = TEXT_COMMAND_HANDLER_METHODS[normalized.command];
  if (!handlerMethod || typeof runtime[handlerMethod] !== "function") {
    return false;
  }

  await runtime[handlerMethod](normalized);
  return true;
}

function dispatchCardAction(runtime, action, normalized) {
  const handlerMethod = CARD_ACTION_KIND_METHODS[action.kind];
  if (!handlerMethod || typeof runtime[handlerMethod] !== "function") {
    return null;
  }
  return runtime[handlerMethod](action, normalized);
}

function handlePanelCardAction(runtime, action, normalized) {
  return executeMappedCardAction(runtime, normalized, action, PANEL_CARD_ACTIONS);
}

function handleThreadCardAction(runtime, action, normalized) {
  return executeMappedCardAction(runtime, normalized, action, THREAD_CARD_ACTIONS);
}

function handleWorkspaceCardAction(runtime, action, normalized) {
  return executeMappedCardAction(runtime, normalized, action, WORKSPACE_CARD_ACTIONS);
}

function executeMappedCardAction(runtime, normalized, action, actionMap) {
  const handler = actionMap[action.action];
  if (!handler) {
    return null;
  }

  const validation = typeof handler.validate === "function"
    ? handler.validate(runtime, normalized, action)
    : null;
  if (validation?.text) {
    runtime.runCardActionTask(runtime.sendCardActionFeedbackByContext(
      normalized,
      validation.text,
      validation.kind || "error"
    ));
    return runtime.buildCardResponse({});
  }

  return runtime.queueCardActionWithFeedback(
    normalized,
    handler.feedback,
    () => handler.run(runtime, normalized, action)
  );
}

module.exports = {
  dispatchTextCommand,
  dispatchCardAction,
  handlePanelCardAction,
  handleThreadCardAction,
  handleWorkspaceCardAction,
};
