const { readConfig } = require("../infra/config/config");
const { SessionStore } = require("../infra/storage/session-store");
const { CodexRpcClient } = require("../infra/codex/rpc-client");
const {
  buildCardResponse,
  buildCardToast,
  buildEffortInfoText,
  buildEffortListText,
  buildEffortValidationErrorText,
  buildHelpCardText,
  buildModelInfoText,
  buildModelListText,
  buildModelValidationErrorText,
  buildStatusPanelCard,
  buildThreadMessagesSummary,
  buildThreadPickerCard,
  buildWorkspaceBrowserCard,
  buildWorkspaceBindingsCard,
  listBoundWorkspaces,
} = require("../presentation/card/builders");
const {
  addPendingReaction,
  clearPendingReactionForBinding,
  clearPendingReactionForThread,
  disposeReplyRunState,
  handleCardAction,
  movePendingReactionToThread,
  patchInteractiveCard,
  queueCardActionWithFeedback,
  runCardActionTask,
  sendCardActionFeedback,
  sendCardActionFeedbackByContext,
  sendInfoCardMessage,
  sendInteractiveApprovalCard,
  sendInteractiveCard,
  updateInteractiveCard,
  upsertAssistantReplyCard,
} = require("../presentation/card/card-service");
const {
  FeishuClientAdapter,
  patchWsClientForCardCallbacks,
} = require("../infra/feishu/client-adapter");
const runtimeCommands = require("./command-dispatcher");
const {
  attachRuntimeForwarders: attachSharedRuntimeForwarders,
  initializeCommonRuntimeState,
} = require("./runtime-base");
const approvalRuntime = require("../domain/approval/approval-service");
const runtimeState = require("../domain/session/binding-context");
const threadRuntime = require("../domain/thread/thread-service");
const workspaceRuntime = require("../domain/workspace/workspace-service");
const eventsRuntime = require("./codex-event-service");
const approvalPolicyRuntime = require("../domain/approval/approval-policy");
const appDispatcher = require("./dispatcher");
const fs = require("fs");

class FeishuBotRuntime {
  constructor(config = readConfig()) {
    this.config = config;
    this.sessionStore = new SessionStore({
      filePath: config.sessionsFile,
      fallbackFilePaths: config.sessionFallbackFiles,
    });
    this.codex = new CodexRpcClient({
      endpoint: config.codexEndpoint,
      env: process.env,
      codexCommand: config.codexCommand,
      verboseLogs: config.verboseCodexLogs,
    });
    this.lark = null;
    this.client = null;
    this.wsClient = null;
    this.feishuAdapter = null;
    initializeCommonRuntimeState(this);
    this.codex.onMessage((message) => appDispatcher.onCodexMessage(this, message));
  }

  async start() {
    this.validateConfig();
    this.initializeFeishuSdk();
    await this.codex.connect();
    await this.codex.initialize();
    this.startLongConnection();
    console.log(`[codex-im] feishu-bot runtime ready for app ${maskSecret(this.config.feishu.appId)}`);
  }

  async stop() {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.isStopping = true;
    this.stopPromise = (async () => {
      for (const timer of this.replyFlushTimersByRunKey.values()) {
        clearTimeout(timer);
      }
      this.replyFlushTimersByRunKey.clear();
      for (const timer of this.replyProgressTimersByRunKey.values()) {
        clearTimeout(timer);
      }
      this.replyProgressTimersByRunKey.clear();
      for (const timer of this.replyProgressFollowupTimersByRunKey.values()) {
        clearTimeout(timer);
      }
      this.replyProgressFollowupTimersByRunKey.clear();

      try {
        if (this.wsClient?.close) {
          this.wsClient.close();
        }
      } catch (error) {
        console.error(`[codex-im] failed to close Feishu WS client: ${error.message}`);
      }

      try {
        await this.codex.close();
      } catch (error) {
        console.error(`[codex-im] failed to close Codex client: ${error.message}`);
      }

      try {
        if (typeof this.sessionStore.close === "function") {
          await this.sessionStore.close();
        } else {
          await this.sessionStore.flush();
        }
      } catch (error) {
        console.error(`[codex-im] failed to close session store: ${error.message}`);
      }
    })();

    return this.stopPromise;
  }

  validateConfig() {
    if (!this.config.feishu.appId || !this.config.feishu.appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required for feishu-bot mode");
    }
    if (!String(this.config.defaultCodexModel || "").trim()) {
      throw new Error("CODEX_IM_DEFAULT_CODEX_MODEL is required");
    }
    if (!String(this.config.defaultCodexEffort || "").trim()) {
      throw new Error("CODEX_IM_DEFAULT_CODEX_EFFORT is required");
    }
    if (!String(this.config.defaultCodexAccessMode || "").trim()) {
      throw new Error(
        "CODEX_IM_DEFAULT_CODEX_ACCESS_MODE is required and must be one of: default, full-access"
      );
    }
  }

  initializeFeishuSdk() {
    try {
      // Official SDK: https://github.com/larksuite/node-sdk
      this.lark = require("@larksuiteoapi/node-sdk");
    } catch {
      throw new Error(
        "Missing @larksuiteoapi/node-sdk. Run `npm install` in codex-im before starting feishu-bot mode."
      );
    }

    this.client = new this.lark.Client({
      appId: this.config.feishu.appId,
      appSecret: this.config.feishu.appSecret,
      appType: this.lark.AppType.SelfBuild,
      domain: this.lark.Domain.Feishu,
      loggerLevel: this.lark.LoggerLevel.info,
    });

    this.wsClient = new this.lark.WSClient({
      appId: this.config.feishu.appId,
      appSecret: this.config.feishu.appSecret,
      appType: this.lark.AppType.SelfBuild,
      domain: this.lark.Domain.Feishu,
      loggerLevel: this.lark.LoggerLevel.info,
      wsConfig: {
        PingInterval: 30,
        PingTimeout: 5,
      },
    });
    this.feishuAdapter = new FeishuClientAdapter(this.client);
    patchWsClientForCardCallbacks(this.wsClient);
  }

  startLongConnection() {
    const eventDispatcher = new this.lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        appDispatcher.onFeishuTextEvent(this, data).catch((error) => {
          console.error(`[codex-im] failed to process Feishu message: ${error.message}`);
        });
      },
      "card.action.trigger": async (data) => appDispatcher.onFeishuCardAction(this, data),
    });

    this.wsClient.start({ eventDispatcher });
    console.log("[codex-im] Feishu long connection started");
  }

  resolveReplyToMessageId(normalized, replyToMessageId = "") {
    return replyToMessageId || normalized.messageId;
  }

  getBindingContext(normalized) {
    const bindingKey = this.sessionStore.buildBindingKey(normalized);
    const workspaceRoot = this.resolveWorkspaceRootForBinding(bindingKey);
    return { bindingKey, workspaceRoot };
  }

  getCurrentThreadContext(normalized) {
    const { bindingKey, workspaceRoot } = this.getBindingContext(normalized);
    const threadId = workspaceRoot ? this.resolveThreadIdForBinding(bindingKey, workspaceRoot) : "";
    return { bindingKey, workspaceRoot, threadId };
  }

  requireFeishuAdapter() {
    if (!this.feishuAdapter) {
      throw new Error("Feishu adapter is not initialized");
    }
    return this.feishuAdapter;
  }

  async resolveWorkspaceStats(workspaceRoot) {
    try {
      const stats = await fs.promises.stat(workspaceRoot);
      return {
        exists: true,
        isDirectory: stats.isDirectory(),
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { exists: false, isDirectory: false };
      }
      throw error;
    }
  }
}

function attachRuntimeForwarders() {
  const proto = FeishuBotRuntime.prototype;

  const plainForwarders = {
    buildCardResponse,
    buildCardToast,
    buildEffortInfoText,
    buildEffortListText,
    buildEffortValidationErrorText,
    buildHelpCardText,
    buildModelInfoText,
    buildModelListText,
    buildModelValidationErrorText,
    buildStatusPanelCard,
    buildThreadMessagesSummary,
    buildThreadPickerCard,
    buildWorkspaceBrowserCard,
    buildWorkspaceBindingsCard,
    listBoundWorkspaces,
  };

  const runtimeFirstForwarders = {
    dispatchTextCommand: runtimeCommands.dispatchTextCommand,
    resolveWorkspaceContext: workspaceRuntime.resolveWorkspaceContext,
    resolveWorkspaceThreadState: threadRuntime.resolveWorkspaceThreadState,
    ensureThreadAndSendMessage: threadRuntime.ensureThreadAndSendMessage,
    ensureThreadResumed: threadRuntime.ensureThreadResumed,
    resolveWorkspaceRootForBinding: runtimeState.resolveWorkspaceRootForBinding,
    resolveThreadIdForBinding: runtimeState.resolveThreadIdForBinding,
    setThreadBindingKey: runtimeState.setThreadBindingKey,
    setThreadWorkspaceRoot: runtimeState.setThreadWorkspaceRoot,
    setPendingBindingContext: runtimeState.setPendingBindingContext,
    setPendingThreadContext: runtimeState.setPendingThreadContext,
    setReplyCardEntry: runtimeState.setReplyCardEntry,
    setCurrentRunKeyForThread: runtimeState.setCurrentRunKeyForThread,
    rememberSelectionContext: runtimeState.rememberSelectionContext,
    resolveSelectionContext: runtimeState.resolveSelectionContext,
    disposeInactiveReplyRunsForBinding: runtimeState.disposeInactiveReplyRunsForBinding,
    resolveWorkspaceRootForThread: runtimeState.resolveWorkspaceRootForThread,
    shouldDeliverThreadEventForActiveWorkspace: runtimeState.shouldDeliverThreadEventForActiveWorkspace,
    rememberApprovalPrefixForWorkspace: approvalPolicyRuntime.rememberApprovalPrefixForWorkspace,
    shouldAutoApproveRequest: approvalPolicyRuntime.shouldAutoApproveRequest,
    tryAutoApproveRequest: approvalPolicyRuntime.tryAutoApproveRequest,
    applyApprovalDecision: approvalRuntime.applyApprovalDecision,
    handleBindCommand: workspaceRuntime.handleBindCommand,
    handleBrowseCommand: workspaceRuntime.handleBrowseCommand,
    handleWhereCommand: workspaceRuntime.handleWhereCommand,
    showStatusPanel: workspaceRuntime.showStatusPanel,
    handleMessageCommand: workspaceRuntime.handleMessageCommand,
    handleHelpCommand: workspaceRuntime.handleHelpCommand,
    handleUnknownCommand: workspaceRuntime.handleUnknownCommand,
    handleThreadsCommand: workspaceRuntime.handleThreadsCommand,
    handleWorkspacesCommand: workspaceRuntime.handleWorkspacesCommand,
    showThreadPicker: workspaceRuntime.showThreadPicker,
    handleNewCommand: threadRuntime.handleNewCommand,
    handleSwitchCommand: threadRuntime.handleSwitchCommand,
    handleRemoveCommand: workspaceRuntime.handleRemoveCommand,
    handleSendCommand: workspaceRuntime.handleSendCommand,
    handleModelCommand: workspaceRuntime.handleModelCommand,
    handleEffortCommand: workspaceRuntime.handleEffortCommand,
    refreshWorkspaceThreads: threadRuntime.refreshWorkspaceThreads,
    getWorkspaceThreadRefreshState: threadRuntime.getWorkspaceThreadRefreshState,
    describeWorkspaceStatus: threadRuntime.describeWorkspaceStatus,
    switchThreadById: threadRuntime.switchThreadById,
    handleStopCommand: eventsRuntime.handleStopCommand,
    handleApprovalCommand: approvalRuntime.handleApprovalCommand,
    deliverToProvider: eventsRuntime.deliverToProvider,
    clearQueuedMessagesForBinding: appDispatcher.clearQueuedMessagesForBinding,
    drainQueuedMessagesForBinding: appDispatcher.drainQueuedMessagesForBinding,
    processQueuedNormalizedTextEvent: appDispatcher.processQueuedNormalizedTextEvent,
    sendInfoCardMessage,
    sendInteractiveApprovalCard,
    updateInteractiveCard,
    sendInteractiveCard,
    patchInteractiveCard,
    handleCardAction,
    dispatchCardAction: runtimeCommands.dispatchCardAction,
    handlePanelCardAction: runtimeCommands.handlePanelCardAction,
    handleThreadCardAction: runtimeCommands.handleThreadCardAction,
    handleWorkspaceCardAction: runtimeCommands.handleWorkspaceCardAction,
    queueCardActionWithFeedback,
    runCardActionTask,
    handleApprovalCardActionAsync: approvalRuntime.handleApprovalCardActionAsync,
    sendCardActionFeedbackByContext,
    sendCardActionFeedback,
    switchWorkspaceByPath: workspaceRuntime.switchWorkspaceByPath,
    removeWorkspaceByPath: workspaceRuntime.removeWorkspaceByPath,
    upsertAssistantReplyCard,
    addPendingReaction,
    movePendingReactionToThread,
    clearPendingReactionForBinding,
    clearPendingReactionForThread,
    disposeReplyRunState,
    cleanupThreadRuntimeState: runtimeState.cleanupThreadRuntimeState,
    pruneRuntimeMapSizes: runtimeState.pruneRuntimeMapSizes,
  };

  attachSharedRuntimeForwarders(proto, {
    plainForwarders,
    runtimeFirstForwarders,
  });
}

attachRuntimeForwarders();

FeishuBotRuntime.prototype.supportsInteractiveCards = function supportsInteractiveCards() {
  return true;
};

FeishuBotRuntime.prototype.supportsReactions = function supportsReactions() {
  return true;
};

FeishuBotRuntime.prototype.supportsFileMessages = function supportsFileMessages() {
  return true;
};

FeishuBotRuntime.prototype.rememberInboundContext = function rememberInboundContext(normalized) {
  if (!normalized?.messageId) {
    return;
  }
  rememberContext(this.messageContextByMessageId, normalized.messageId, normalized);
  if (normalized.chatId) {
    rememberContext(this.latestMessageContextByChatId, normalized.chatId, normalized);
  }
};

FeishuBotRuntime.prototype.resolveMessageContext = function resolveMessageContext({ replyToMessageId = "", chatId = "" } = {}) {
  const fromReply = replyToMessageId ? this.messageContextByMessageId.get(replyToMessageId) || null : null;
  if (fromReply) {
    return fromReply;
  }
  return chatId ? this.latestMessageContextByChatId.get(chatId) || null : null;
};

FeishuBotRuntime.prototype.sendFileMessage = function sendFileMessage(args) {
  return this.requireFeishuAdapter().sendFileMessage(args);
};

FeishuBotRuntime.prototype.sendTextMessage = function sendTextMessage({ chatId, text, replyToMessageId = "", replyInThread = false }) {
  if (!chatId || !text) {
    return null;
  }
  return this.requireFeishuAdapter().sendTextMessage({
    chatId,
    text,
    replyToMessageId,
    replyInThread,
  });
};

function rememberContext(map, key, value) {
  if (!map || !key) {
    return;
  }
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > 1000) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) {
      break;
    }
    map.delete(oldestKey);
  }
}

function maskSecret(value) {
  if (!value) {
    return "";
  }
  if (value.length <= 6) {
    return "***";
  }
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

module.exports = { FeishuBotRuntime };
