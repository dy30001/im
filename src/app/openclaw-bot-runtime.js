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
  buildThreadPickerText,
  buildThreadSyncText,
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
  OpenClawClientAdapter,
} = require("../infra/openclaw/client-adapter");
const desktopSessionBridge = require("../infra/acpx/session-bridge");
const runtimeCommands = require("./command-dispatcher");
const {
  attachRuntimeForwarders: attachSharedRuntimeForwarders,
  initializeCommonRuntimeState,
} = require("./runtime-base");
const {
  applyOpenClawPollResponse,
  dispatchOpenClawMessages,
  logOpenClawPolledMessages,
} = require("./openclaw-polling-service");
const {
  markThreadSyncLocalActivity,
  rememberSelectedThreadForSync,
  syncSelectedDesktopSessionBinding,
  syncSelectedThreadBinding,
  syncSelectedThreads,
  threadSyncLoop,
} = require("./openclaw-thread-sync-service");
const {
  applyOpenClawCredentials,
  ensureOpenClawCredentials,
  reloadOpenClawCredentialsFromStore,
  tryRecoverFromPollError,
} = require("./openclaw-credentials-service");
const {
  forgetInboundContext,
  rememberInboundContext,
  resolveMessageContext,
  resolveReplyToMessageId,
} = require("./openclaw-message-context-service");
const approvalRuntime = require("../domain/approval/approval-service");
const runtimeState = require("../domain/session/binding-context");
const threadRuntime = require("../domain/thread/thread-service");
const workspaceRuntime = require("../domain/workspace/workspace-service");
const eventsRuntime = require("./codex-event-service");
const approvalPolicyRuntime = require("../domain/approval/approval-policy");
const appDispatcher = require("./dispatcher");
const { extractModelCatalogFromListResponse } = require("../shared/model-catalog");
const fs = require("fs");
const os = require("os");
const path = require("path");

const THREAD_SYNC_POLL_INTERVAL_MS = 5_000;
const DEFAULT_OPENCLAW_HEARTBEAT_FILE = path.join(
  os.homedir(),
  ".codex-im",
  "openclaw-bot.lock",
  "heartbeat.json"
);

class OpenClawBotRuntime {
  constructor(config = readConfig()) {
    this.config = config;
    this.providerKind = "openclaw";
    this.heartbeatFile = resolveOpenClawHeartbeatFile();
    this.heartbeatWritePromise = Promise.resolve();
    this.lastHeartbeatWriteAt = 0;
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
    this.openclawAdapter = new OpenClawClientAdapter({
      baseUrl: config.openclaw?.baseUrl,
      token: config.openclaw?.token,
      verboseLogs: config.verboseCodexLogs,
    });
    this.pollAbortController = null;
    this.pollLoopPromise = null;
    this.syncCursor = "";
    initializeCommonRuntimeState(this);
    this.desktopSessionsByWorkspaceRoot = new Map();
    this.threadSyncStateByKey = new Map();
    this.threadSyncLoopPromise = null;
    this.codex.onMessage((message) => appDispatcher.onCodexMessage(this, message));
  }

  async start() {
    this.validateConfig();
    await this.ensureOpenClawCredentials();
    await this.codex.connect();
    await this.codex.initialize();
    await this.refreshAvailableModelCatalogAtStartup();
    await this.markHeartbeat("runtime-ready");
    this.startPolling();
    this.startThreadSyncLoop();
    console.log(`[codex-im] openclaw-bot runtime ready for ${maskUrl(this.config.openclaw.baseUrl)}`);
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

      if (this.pollAbortController) {
        this.pollAbortController.abort();
      }

      if (this.pollLoopPromise) {
        await this.pollLoopPromise.catch((error) => {
          if (error?.name !== "AbortError") {
            console.error(`[codex-im] openclaw poll loop stopped with error: ${error.message}`);
          }
        });
      }

      if (this.threadSyncLoopPromise) {
        await this.threadSyncLoopPromise.catch((error) => {
          if (error?.name !== "AbortError") {
            console.error(`[codex-im] openclaw thread sync loop stopped with error: ${error.message}`);
          }
        });
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
    if (!String(this.config.openclaw?.baseUrl || "").trim()) {
      throw new Error("CODEX_IM_OPENCLAW_BASE_URL is required for openclaw-bot mode");
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

  async ensureOpenClawCredentials() {
    return ensureOpenClawCredentials(this);
  }

  reloadOpenClawCredentialsFromStore() {
    return reloadOpenClawCredentialsFromStore(this);
  }

  async tryRecoverFromPollError(error) {
    return tryRecoverFromPollError(this, error);
  }

  applyOpenClawCredentials({ token, baseUrl }) {
    return applyOpenClawCredentials(this, { token, baseUrl });
  }

  startPolling() {
    if (this.pollLoopPromise) {
      return;
    }
    this.pollAbortController = new AbortController();
    this.pollLoopPromise = this.pollLoop(this.pollAbortController.signal);
  }

  startThreadSyncLoop() {
    if (this.threadSyncLoopPromise || !this.pollAbortController) {
      return;
    }
    this.threadSyncLoopPromise = this.threadSyncLoop(this.pollAbortController.signal);
  }

  async pollLoop(signal) {
    while (!signal.aborted && !this.isStopping) {
      try {
        const response = await this.openclawAdapter.getUpdates({
          cursor: this.syncCursor,
          timeoutMs: this.config.openclaw.longPollTimeoutMs,
          signal,
        });
        if (signal.aborted || this.isStopping) {
          break;
        }

        await this.markHeartbeat("poll");
        const messages = applyOpenClawPollResponse(this, response);
        logOpenClawPolledMessages(this, messages);
        await dispatchOpenClawMessages(this, messages);
      } catch (error) {
        if (signal.aborted || this.isStopping) {
          break;
        }
        const recovered = await this.tryRecoverFromPollError(error);
        if (recovered) {
          continue;
        }
        console.error(`[codex-im] openclaw poll failed: ${error.message}`);
        await delay(1_000, signal);
      }
    }
  }

  rememberSelectedThreadForSync(bindingKey, workspaceRoot, threadId) {
    return rememberSelectedThreadForSync(this, bindingKey, workspaceRoot, threadId);
  }

  markThreadSyncLocalActivity(threadId) {
    return markThreadSyncLocalActivity(this, threadId);
  }

  async threadSyncLoop(signal) {
    return threadSyncLoop(this, signal, THREAD_SYNC_POLL_INTERVAL_MS);
  }

  async syncSelectedThreads(signal) {
    return syncSelectedThreads(this, signal);
  }

  async syncSelectedThreadBinding({ bindingKey, binding }) {
    return syncSelectedThreadBinding(this, { bindingKey, binding });
  }

  async syncSelectedDesktopSessionBinding({ bindingKey, binding }) {
    return syncSelectedDesktopSessionBinding(this, { bindingKey, binding });
  }

  async maybeSendThreadSyncWarning(state, { chatId, text, errorKey }) {
    if (!state || !chatId || !text || !errorKey || state.lastError === errorKey) {
      return;
    }
    await this.sendTextMessage({ chatId, text });
    state.lastError = errorKey;
  }

  async refreshAvailableModelCatalogAtStartup() {
    const response = await this.codex.listModels();
    const models = extractModelCatalogFromListResponse(response);
    if (!models.length) {
      throw new Error("model/list returned no models at startup");
    }
    this.sessionStore.setAvailableModelCatalog(models);
    const validatedDefaults = workspaceRuntime.validateDefaultCodexParamsConfig(this, models);
    if (!validatedDefaults.model) {
      throw new Error(`Invalid CODEX_IM_DEFAULT_CODEX_MODEL: ${this.config.defaultCodexModel}`);
    }
    if (!validatedDefaults.effort) {
      throw new Error(
        `Invalid CODEX_IM_DEFAULT_CODEX_EFFORT: ${this.config.defaultCodexEffort} for model ${validatedDefaults.model}`
      );
    }
    console.log(`[codex-im] model catalog refreshed at startup: ${models.length} entries`);
  }

  resolveReplyToMessageId(normalized, replyToMessageId = "") {
    return resolveReplyToMessageId(this, normalized, replyToMessageId);
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

  rememberInboundContext(normalized) {
    return rememberInboundContext(this, normalized);
  }

  forgetInboundContext(normalized) {
    return forgetInboundContext(this, normalized);
  }

  resolveMessageContext({ replyToMessageId = "", chatId = "" } = {}) {
    return resolveMessageContext(this, { replyToMessageId, chatId });
  }

  supportsInteractiveCards() {
    return false;
  }

  supportsReactions() {
    return false;
  }

  supportsFileMessages() {
    return false;
  }

  async sendTextMessage({ chatId, text, replyToMessageId = "", contextToken = "" } = {}) {
    return sendOpenClawTextMessage(this, {
      chatId,
      text,
      replyToMessageId,
      contextToken,
    });
  }

  async sendFileMessage() {
    throw new Error("Current provider does not support file sending");
  }

  usesDesktopSessionSource() {
    return String(this.config.openclaw?.threadSource || "").trim().toLowerCase() === "acpx";
  }

  async listDesktopSessionsForWorkspace(workspaceRoot) {
    return desktopSessionBridge.listDesktopSessionsForWorkspace(this, workspaceRoot);
  }

  resolveDesktopSessionById(workspaceRoot, sessionId) {
    return desktopSessionBridge.resolveDesktopSessionById(this, workspaceRoot, sessionId);
  }

  async hydrateDesktopSession(session) {
    return desktopSessionBridge.hydrateDesktopSession(this, session);
  }

  isRuntimeBindingEntry(binding) {
    const bindingProvider = normalizeBindingProvider(binding);
    if (bindingProvider) {
      return bindingProvider === this.providerKind;
    }

    const chatId = String(binding?.chatId || "").trim().toLowerCase();
    const senderId = String(binding?.senderId || "").trim().toLowerCase();
    const threadKey = String(binding?.threadKey || "").trim().toLowerCase();
    if (chatId.includes("@im.wechat") || senderId.includes("@im.wechat")) {
      return true;
    }
    if (looksLikeFeishuBinding(chatId, senderId, threadKey)) {
      return false;
    }
    return Boolean(chatId || senderId || threadKey);
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

  async markHeartbeat(reason = "runtime") {
    const normalizedReason = String(reason || "").trim() || "runtime";
    const nextUpdatedAt = Date.now();
    this.lastHeartbeatWriteAt = nextUpdatedAt;
    const payload = JSON.stringify({
      updatedAt: nextUpdatedAt,
      reason: normalizedReason,
      pid: process.pid,
    });

    this.heartbeatWritePromise = this.heartbeatWritePromise
      .catch(() => {})
      .then(async () => {
        await fs.promises.mkdir(path.dirname(this.heartbeatFile), { recursive: true });
        await fs.promises.writeFile(this.heartbeatFile, `${payload}\n`, "utf8");
      })
      .catch((error) => {
        console.error(`[codex-im] failed to write openclaw heartbeat: ${error.message}`);
      });

    return this.heartbeatWritePromise;
  }
}

function attachRuntimeForwarders() {
  const proto = OpenClawBotRuntime.prototype;

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
    buildThreadPickerText,
    buildThreadSyncText,
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
    resolveWorkspaceRootForThread: runtimeState.resolveWorkspaceRootForThread,
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

function normalizeBindingProvider(binding) {
  return String(binding?.provider || "").trim().toLowerCase();
}

function looksLikeFeishuBinding(chatId, senderId, threadKey) {
  return startsWithAny(chatId, ["oc_", "chat_"])
    || startsWithAny(senderId, ["ou_", "on_"])
    || startsWithAny(threadKey, ["om_"]);
}

async function sendOpenClawTextMessage(runtime, {
  chatId,
  text,
  replyToMessageId = "",
  contextToken = "",
} = {}) {
  const messageContext = runtime.resolveMessageContext({ replyToMessageId, chatId });
  const resolvedContextToken = String(contextToken || messageContext?.contextToken || "").trim();
  const payload = {
    toUserId: chatId,
    text,
    contextToken: resolvedContextToken,
    signal: runtime.pollAbortController?.signal,
  };

  try {
    const response = await runtime.openclawAdapter.sendTextMessage(payload);
    runtime.markHeartbeat("send").catch(() => {});
    return response;
  } catch (error) {
    if (!resolvedContextToken || !shouldRetryOpenClawSendWithoutContextToken(error)) {
      throw error;
    }
    if (shouldLogOpenClawSendRetryWarning(runtime, resolvedContextToken, error)) {
      console.warn("[codex-im] openclaw sendMessage failed with context token, retrying without context token");
    }
    const response = await runtime.openclawAdapter.sendTextMessage({
      ...payload,
      contextToken: "",
    });
    runtime.markHeartbeat("send-retry").catch(() => {});
    return response;
  }
}

function resolveOpenClawHeartbeatFile() {
  const explicitPath = String(process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE || "").trim();
  return explicitPath || DEFAULT_OPENCLAW_HEARTBEAT_FILE;
}

function shouldLogOpenClawSendRetryWarning(runtime, contextToken, error) {
  const logKey = buildOpenClawSendRetryWarningKey(contextToken, error);
  if (!logKey) {
    return true;
  }
  const seenKeys = getRuntimeLogKeySet(runtime, "_openclawSendRetryWarningKeys");
  if (seenKeys.has(logKey)) {
    return false;
  }
  seenKeys.add(logKey);
  return true;
}

function buildOpenClawSendRetryWarningKey(contextToken, error) {
  const normalizedContextToken = String(contextToken || "").trim();
  const normalizedError = String(error?.message || "").trim().toLowerCase();
  if (!normalizedContextToken && !normalizedError) {
    return "";
  }
  return `${normalizedContextToken || "<empty>"}|${normalizedError || "<unknown>"}`;
}

function getRuntimeLogKeySet(runtime, propertyName) {
  if (!runtime) {
    return new Set();
  }
  if (!(runtime[propertyName] instanceof Set)) {
    runtime[propertyName] = new Set();
  }
  return runtime[propertyName];
}

function shouldRetryOpenClawSendWithoutContextToken(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) {
    return false;
  }
  return message.includes("sendmessage errcode=-2") || message.includes("unknown error");
}

function startsWithAny(value, prefixes) {
  if (!value) {
    return false;
  }
  return prefixes.some((prefix) => value.startsWith(prefix));
}

async function delay(ms, signal) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    }
  });
}

function maskUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return value;
  }
}

attachRuntimeForwarders();

module.exports = { OpenClawBotRuntime };
