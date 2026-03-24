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
  OpenClawClientAdapter,
  isOpenClawCredentialError,
} = require("../infra/openclaw/client-adapter");
const { loginWithQr, openQrInBrowser } = require("../infra/openclaw/qr-login");
const {
  loadOpenClawCredentials,
  saveOpenClawCredentials,
} = require("../infra/openclaw/token-store");
const runtimeCommands = require("./command-dispatcher");
const approvalRuntime = require("../domain/approval/approval-service");
const runtimeState = require("../domain/session/binding-context");
const threadRuntime = require("../domain/thread/thread-service");
const workspaceRuntime = require("../domain/workspace/workspace-service");
const eventsRuntime = require("./codex-event-service");
const approvalPolicyRuntime = require("../domain/approval/approval-policy");
const appDispatcher = require("./dispatcher");
const { extractModelCatalogFromListResponse } = require("../shared/model-catalog");
const fs = require("fs");

const MAX_MESSAGE_CONTEXT_ENTRIES = 1_000;

class OpenClawBotRuntime {
  constructor(config = readConfig()) {
    this.config = config;
    this.providerKind = "openclaw";
    this.sessionStore = new SessionStore({ filePath: config.sessionsFile });
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
    this.pendingChatContextByThreadId = new Map();
    this.pendingChatContextByBindingKey = new Map();
    this.activeTurnIdByThreadId = new Map();
    this.pendingApprovalByThreadId = new Map();
    this.replyCardByRunKey = new Map();
    this.currentRunKeyByThreadId = new Map();
    this.replyFlushTimersByRunKey = new Map();
    this.pendingReactionByBindingKey = new Map();
    this.pendingReactionByThreadId = new Map();
    this.bindingKeyByThreadId = new Map();
    this.workspaceRootByThreadId = new Map();
    this.approvalAllowlistByWorkspaceRoot = new Map();
    this.inFlightApprovalRequestKeys = new Set();
    this.resumedThreadIds = new Set();
    this.messageContextByMessageId = new Map();
    this.latestMessageContextByChatId = new Map();
    this.workspaceThreadListCache = new Map();
    this.workspaceThreadRefreshStateByKey = new Map();
    this.isStopping = false;
    this.stopPromise = null;
    this.codex.onMessage((message) => appDispatcher.onCodexMessage(this, message));
  }

  async start() {
    this.validateConfig();
    await this.ensureOpenClawCredentials();
    await this.codex.connect();
    await this.codex.initialize();
    await this.refreshAvailableModelCatalogAtStartup();
    this.startPolling();
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

      try {
        await this.codex.close();
      } catch (error) {
        console.error(`[codex-im] failed to close Codex client: ${error.message}`);
      }

      try {
        await this.sessionStore.flush();
      } catch (error) {
        console.error(`[codex-im] failed to flush session store: ${error.message}`);
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
    const storedCredentials = loadOpenClawCredentials(this.config.openclaw.credentialsFile);
    const resolvedToken = String(this.config.openclaw.token || "").trim() || storedCredentials?.token || "";
    const resolvedBaseUrl = this.config.openclaw.baseUrlExplicit
      ? String(this.config.openclaw.baseUrl || "").trim()
      : (storedCredentials?.baseUrl || String(this.config.openclaw.baseUrl || "").trim());

    if (resolvedToken) {
      this.applyOpenClawCredentials({
        token: resolvedToken,
        baseUrl: resolvedBaseUrl,
      });
      return;
    }

    console.log("[codex-im] no OpenClaw token found, starting Weixin QR login");
    let lastStatus = "";
    const loginResult = await loginWithQr({
      baseUrl: resolvedBaseUrl,
      onQrCode: async ({ qrcodeUrl, refreshCount }) => {
        const actionText = refreshCount > 0 ? "二维码已刷新" : "二维码已就绪";
        console.log(`[codex-im] ${actionText}，请使用微信扫码`);
        const opened = await openQrInBrowser(qrcodeUrl);
        if (opened) {
          console.log("[codex-im] QR link opened in the default browser");
        }
        console.log(`[codex-im] QR URL: ${qrcodeUrl}`);
      },
      onStatus: (status) => {
        if (!status || status === lastStatus) {
          return;
        }
        lastStatus = status;
        if (status === "scaned") {
          console.log("[codex-im] QR scanned, confirm the login in Weixin");
        } else if (status === "confirmed") {
          console.log("[codex-im] QR login confirmed");
        } else if (status === "expired") {
          console.log("[codex-im] QR expired, refreshing");
        }
      },
    });

    saveOpenClawCredentials(this.config.openclaw.credentialsFile, {
      token: loginResult.token,
      baseUrl: loginResult.baseUrl,
      accountId: loginResult.accountId,
      userId: loginResult.userId,
    });
    this.applyOpenClawCredentials({
      token: loginResult.token,
      baseUrl: loginResult.baseUrl,
    });
  }

  reloadOpenClawCredentialsFromStore() {
    const storedCredentials = loadOpenClawCredentials(this.config.openclaw.credentialsFile);
    const storedToken = String(storedCredentials?.token || "").trim();
    const storedBaseUrl = String(storedCredentials?.baseUrl || this.config.openclaw.baseUrl || "").trim();
    if (!storedToken) {
      return false;
    }

    const currentToken = String(this.config.openclaw.token || "").trim();
    const currentBaseUrl = String(this.config.openclaw.baseUrl || "").trim();
    if (storedToken === currentToken && storedBaseUrl === currentBaseUrl) {
      return false;
    }

    this.syncCursor = "";
    this.applyOpenClawCredentials({
      token: storedToken,
      baseUrl: storedBaseUrl,
    });
    console.warn("[codex-im] reloaded OpenClaw credentials from the local credentials file");
    return true;
  }

  async tryRecoverFromPollError(error) {
    if (!isOpenClawCredentialError(error)) {
      return false;
    }

    if (this.reloadOpenClawCredentialsFromStore()) {
      return true;
    }

    console.error(
      "[codex-im] OpenClaw credentials may have expired. Run `codex-im openclaw-bot` and complete Weixin QR login again."
    );
    return false;
  }

  applyOpenClawCredentials({ token, baseUrl }) {
    const resolvedToken = String(token || "").trim();
    const resolvedBaseUrl = String(baseUrl || this.config.openclaw.baseUrl || "").trim();
    this.config.openclaw.token = resolvedToken;
    this.config.openclaw.baseUrl = resolvedBaseUrl;
    this.openclawAdapter.setCredentials({
      token: resolvedToken,
      baseUrl: resolvedBaseUrl,
    });
  }

  startPolling() {
    if (this.pollLoopPromise) {
      return;
    }
    this.pollAbortController = new AbortController();
    this.pollLoopPromise = this.pollLoop(this.pollAbortController.signal);
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

        if (typeof response?.get_updates_buf === "string") {
          this.syncCursor = response.get_updates_buf;
        }
        const messages = Array.isArray(response?.msgs) ? response.msgs : [];
        if (this.config.verboseCodexLogs && messages.length) {
          console.log(`[codex-im] openclaw poll received ${messages.length} message(s)`);
        }
        for (const message of messages) {
          if (this.config.verboseCodexLogs) {
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
          await appDispatcher.onOpenClawTextEvent(this, message).catch((error) => {
            console.error(`[codex-im] failed to process OpenClaw message: ${error.message}`);
          });
        }
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

  rememberInboundContext(normalized) {
    if (!normalized?.messageId) {
      return;
    }
    setBoundedMapEntry(this.messageContextByMessageId, normalized.messageId, normalized, MAX_MESSAGE_CONTEXT_ENTRIES);
    if (normalized.chatId) {
      setBoundedMapEntry(this.latestMessageContextByChatId, normalized.chatId, normalized, MAX_MESSAGE_CONTEXT_ENTRIES);
    }
  }

  resolveMessageContext({ replyToMessageId = "", chatId = "" } = {}) {
    const byMessageId = replyToMessageId ? this.messageContextByMessageId.get(replyToMessageId) || null : null;
    if (byMessageId) {
      return byMessageId;
    }
    return chatId ? this.latestMessageContextByChatId.get(chatId) || null : null;
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
    const messageContext = this.resolveMessageContext({ replyToMessageId, chatId });
    return this.openclawAdapter.sendTextMessage({
      toUserId: chatId,
      text,
      contextToken: contextToken || messageContext?.contextToken || "",
      signal: this.pollAbortController?.signal,
    });
  }

  async sendFileMessage() {
    throw new Error("Current provider does not support file sending");
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
    buildWorkspaceBrowserCard,
    buildWorkspaceBindingsCard,
    listBoundWorkspaces,
  };

  for (const [methodName, fn] of Object.entries(plainForwarders)) {
    proto[methodName] = function forwardedPlain(...args) {
      return fn(...args);
    };
  }

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

  for (const [methodName, fn] of Object.entries(runtimeFirstForwarders)) {
    proto[methodName] = function forwardedRuntimeFirst(...args) {
      return fn(this, ...args);
    };
  }

  proto.getCodexParamsForWorkspace = function getCodexParamsForWorkspace(bindingKey, workspaceRoot) {
    return this.sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  };
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
