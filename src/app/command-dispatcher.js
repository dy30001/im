const { normalizeWorkspacePath } = require("../shared/workspace-paths");
const {
  extractNaturalThreadListCommand,
  isNaturalSelectionTextCompatibleWithCommand,
} = require("../shared/command-parsing");
const {
  PANEL_ACTION_CONFIG,
  THREAD_ACTION_CONFIG,
  WORKSPACE_ACTION_CONFIG,
} = require("./card-action-config");

const TEXT_COMMAND_HANDLER_METHODS = {
  stop: "handleStopCommand",
  bind: "handleBindCommand",
  browse: "handleBrowseCommand",
  threads: "handleThreadsCommand",
  where: "handleWhereCommand",
  inspect_message: "handleMessageCommand",
  help: "handleHelpCommand",
  unknown_command: "handleUnknownCommand",
  workspace: "handleWorkspacesCommand",
  switch: "handleSwitchCommand",
  remove: "handleRemoveCommand",
  send: "handleSendCommand",
  new: "handleNewCommand",
  model: "handleModelCommand",
  effort: "handleEffortCommand",
  status: "handleWhereCommand",
  approve: "handleApprovalCommand",
  reject: "handleApprovalCommand",
  prev_page: "handleThreadsCommand",
  next_page: "handleThreadsCommand",
  refresh_threads: "handleThreadsCommand",
};

const CARD_ACTION_KIND_METHODS = {
  panel: "handlePanelCardAction",
  thread: "handleThreadCardAction",
  workspace: "handleWorkspaceCardAction",
};

const PANEL_CARD_ACTIONS = {
  browse: {
    feedback: PANEL_ACTION_CONFIG.browse.feedback,
    run: (runtime, normalized) => runtime.handleBrowseCommand(normalized, {
      replyToMessageId: normalized.messageId,
    }),
  },
  open_threads: {
    feedback: PANEL_ACTION_CONFIG.open_threads.feedback,
    run: (runtime, normalized) => runtime.showThreadPicker(normalized, { replyToMessageId: normalized.messageId }),
  },
  new_thread: {
    feedback: PANEL_ACTION_CONFIG.new_thread.feedback,
    run: (runtime, normalized) => runtime.handleNewCommand(normalized),
  },
  show_messages: {
    feedback: PANEL_ACTION_CONFIG.show_messages.feedback,
    run: (runtime, normalized) => runtime.handleMessageCommand(normalized),
  },
  stop: {
    feedback: PANEL_ACTION_CONFIG.stop.feedback,
    run: (runtime, normalized) => runtime.handleStopCommand(normalized),
  },
  status: {
    feedback: PANEL_ACTION_CONFIG.status.feedback,
    run: (runtime, normalized) => runtime.showStatusPanel(normalized, { replyToMessageId: normalized.messageId }),
  },
  set_model: buildPanelSelectAction(PANEL_ACTION_CONFIG.set_model),
  set_effort: buildPanelSelectAction(PANEL_ACTION_CONFIG.set_effort),
};

const THREAD_CARD_ACTIONS = {
  prev_page: {
    feedback: THREAD_ACTION_CONFIG.prev_page.feedback,
    run: (runtime, normalized, action) => (
      runtime.showThreadPicker(normalized, {
        replyToMessageId: normalized.messageId,
        page: action.page,
      })
    ),
  },
  next_page: {
    feedback: THREAD_ACTION_CONFIG.next_page.feedback,
    run: (runtime, normalized, action) => (
      runtime.showThreadPicker(normalized, {
        replyToMessageId: normalized.messageId,
        page: action.page,
      })
    ),
  },
  refresh: {
    feedback: THREAD_ACTION_CONFIG.refresh.feedback,
    run: (runtime, normalized, action) => (
      runtime.showThreadPicker(normalized, {
        replyToMessageId: normalized.messageId,
        page: action.page,
      })
    ),
  },
  switch: {
    feedback: THREAD_ACTION_CONFIG.switch.feedback,
    validate: (runtime, normalized, action) => {
      if (!action.threadId) {
        return { text: THREAD_ACTION_CONFIG.switch.missingThreadIdText, kind: "error" };
      }
      const { threadId: currentThreadId } = runtime.getCurrentThreadContext(normalized);
      if (currentThreadId && currentThreadId === action.threadId) {
        return { text: THREAD_ACTION_CONFIG.switch.alreadyCurrentText, kind: "info" };
      }
      return null;
    },
    run: (runtime, normalized, action) => (
      runtime.switchThreadById(normalized, action.threadId, { replyToMessageId: normalized.messageId })
    ),
  },
  messages: {
    feedback: THREAD_ACTION_CONFIG.messages.feedback,
    validate: (runtime, normalized, action) => {
      if (!action.threadId) {
        return { text: THREAD_ACTION_CONFIG.messages.missingThreadIdText, kind: "error" };
      }
      const { threadId: currentThreadId } = runtime.getCurrentThreadContext(normalized);
      if (!currentThreadId || currentThreadId !== action.threadId) {
        return { text: THREAD_ACTION_CONFIG.messages.notCurrentText, kind: "error" };
      }
      return null;
    },
    run: (runtime, normalized) => runtime.handleMessageCommand(normalized),
  },
};

const WORKSPACE_CARD_ACTIONS = {
  browse_bind: {
    feedback: WORKSPACE_ACTION_CONFIG.browse_bind.feedback,
    run: (runtime, normalized, action) => runtime.handleBrowseCommand(normalized, {
      replyToMessageId: normalized.messageId,
      bindPath: action.workspaceRoot,
    }),
  },
  browse_open: {
    feedback: WORKSPACE_ACTION_CONFIG.browse_open.feedback,
    run: (runtime, normalized, action) => runtime.handleBrowseCommand(normalized, {
      replyToMessageId: normalized.messageId,
      browsePath: action.workspaceRoot,
    }),
  },
  browse_parent: {
    feedback: WORKSPACE_ACTION_CONFIG.browse_parent.feedback,
    run: (runtime, normalized, action) => runtime.handleBrowseCommand(normalized, {
      replyToMessageId: normalized.messageId,
      browsePath: action.workspaceRoot,
    }),
  },
  status: {
    feedback: WORKSPACE_ACTION_CONFIG.status.feedback,
    run: (runtime, normalized) => runtime.showStatusPanel(normalized, { replyToMessageId: normalized.messageId }),
  },
  remove: {
    feedback: WORKSPACE_ACTION_CONFIG.remove.feedback,
    run: (runtime, normalized, action) => (
      runtime.removeWorkspaceByPath(normalized, action.workspaceRoot, { replyToMessageId: normalized.messageId })
    ),
  },
  switch: {
    feedback: WORKSPACE_ACTION_CONFIG.switch.feedback,
    validate: (runtime, normalized, action) => {
      const { workspaceRoot: currentWorkspaceRoot } = runtime.getBindingContext(normalized);
      const targetWorkspaceRoot = normalizeWorkspacePath(action.workspaceRoot);
      if (currentWorkspaceRoot && targetWorkspaceRoot && currentWorkspaceRoot === targetWorkspaceRoot) {
        return { text: WORKSPACE_ACTION_CONFIG.switch.alreadyCurrentText, kind: "info" };
      }
      return null;
    },
    run: (runtime, normalized, action) => (
      runtime.switchWorkspaceByPath(normalized, action.workspaceRoot, { replyToMessageId: normalized.messageId })
    ),
  },
};

async function dispatchTextCommand(runtime, normalized) {
  const routedCommand = resolveContextualTextCommand(runtime, normalized);
  const handlerMethod = TEXT_COMMAND_HANDLER_METHODS[routedCommand];
  if (!handlerMethod || typeof runtime[handlerMethod] !== "function") {
    return false;
  }

  const routedNormalized = routedCommand === normalized.command
    ? normalized
    : {
      ...normalized,
      command: routedCommand,
    };

  await runtime[handlerMethod](routedNormalized);
  return true;
}

function resolveContextualTextCommand(runtime, normalized) {
  const command = String(normalized?.command || "").trim();
  if (!command || command === "unknown_command") {
    return command;
  }

  const selectionContext = typeof runtime?.resolveSelectionContext === "function"
    ? runtime.resolveSelectionContext(normalized)
    : null;
  const selectionCommand = String(selectionContext?.command || "").trim();
  if (!selectionCommand) {
    return command;
  }

  if (selectionCommand === "threads" && command === "message") {
    const threadListCommand = extractNaturalThreadListCommand(normalized?.text, { allowBare: true });
    if (threadListCommand) {
      return threadListCommand;
    }
  }

  if (!isNaturalSelectionTextCompatibleWithCommand(normalized?.text, selectionCommand)) {
    return command;
  }

  if (selectionCommand === "threads") {
    return command === "message" || command === "browse" ? "switch" : command;
  }

  if (selectionCommand === "workspace") {
    return command === "message" || command === "browse" ? "workspace" : command;
  }

  if (selectionCommand === "browse") {
    return command === "message" ? "browse" : command;
  }

  return command;
}

function dispatchCardAction(runtime, action, normalized) {
  const handlerMethod = CARD_ACTION_KIND_METHODS[action.kind];
  if (!handlerMethod) {
    return null;
  }
  if (typeof runtime[handlerMethod] === "function") {
    return runtime[handlerMethod](action, normalized);
  }

  if (handlerMethod === "handlePanelCardAction") {
    return handlePanelCardAction(runtime, action, normalized);
  }
  if (handlerMethod === "handleThreadCardAction") {
    return handleThreadCardAction(runtime, action, normalized);
  }
  if (handlerMethod === "handleWorkspaceCardAction") {
    return handleWorkspaceCardAction(runtime, action, normalized);
  }
  return null;
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
    if (typeof runtime.buildCardToast === "function") {
      return runtime.buildCardToast(validation.text);
    }
    return runtime.buildCardResponse({});
  }

  return runtime.queueCardActionWithFeedback(
    normalized,
    handler.feedback,
    () => handler.run(runtime, normalized, action)
  );
}

async function runCodexCommandFromCard(runtime, normalized, command, value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return;
  }
  const synthetic = {
    ...normalized,
    text: `/codex ${command} ${normalizedValue}`,
    command,
  };
  if (command === "model") {
    await runtime.handleModelCommand(synthetic);
    return;
  }
  if (command === "effort") {
    await runtime.handleEffortCommand(synthetic);
  }
}

function buildPanelSelectAction({ command, feedback, missingValueText }) {
  return {
    feedback,
    validate: (_runtime, _normalized, action) => {
      if (!action.selectedValue) {
        console.warn(`[codex-im] panel ${command} missing selectedValue`, {
          actionKind: action.kind,
          actionName: action.action,
          selectedValue: action.selectedValue || "",
        });
        return { text: missingValueText, kind: "error" };
      }
      return null;
    },
    run: (runtime, normalized, action) => runCodexCommandFromCard(
      runtime,
      normalized,
      command,
      action.selectedValue
    ),
  };
}

module.exports = {
  dispatchTextCommand,
  dispatchCardAction,
  handlePanelCardAction,
  handleThreadCardAction,
  handleWorkspaceCardAction,
};
