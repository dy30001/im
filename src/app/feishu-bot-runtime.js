const { readConfig } = require("../infra/config/config");
const { SessionStore } = require("../infra/storage/session-store");
const { CodexRpcClient } = require("../infra/codex/rpc-client");
const {
  buildCardResponse,
  buildCardToast,
  buildHelpCardText,
  buildStatusPanelCard,
  buildThreadMessagesSummary,
  buildThreadPickerCard,
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
    this.sessionStore = new SessionStore({ filePath: config.sessionsFile });
    this.codex = new CodexRpcClient({
      endpoint: config.codexEndpoint,
      env: process.env,
      codexCommand: config.codexCommand,
    });
    this.lark = null;
    this.client = null;
    this.wsClient = null;
    this.feishuAdapter = null;
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

  validateConfig() {
    if (!this.config.feishu.appId || !this.config.feishu.appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required for feishu-bot mode");
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

  async dispatchTextCommand(normalized) {
    return runtimeCommands.dispatchTextCommand(this, normalized);
  }

  buildCardResponse(payload) {
    return buildCardResponse(payload);
  }

  buildCardToast(text) {
    return buildCardToast(text);
  }

  buildHelpCardText() {
    return buildHelpCardText();
  }

  buildStatusPanelCard(payload) {
    return buildStatusPanelCard(payload);
  }

  buildThreadMessagesSummary(payload) {
    return buildThreadMessagesSummary(payload);
  }

  buildThreadPickerCard(payload) {
    return buildThreadPickerCard(payload);
  }

  buildWorkspaceBindingsCard(items) {
    return buildWorkspaceBindingsCard(items);
  }

  listBoundWorkspaces(binding) {
    return listBoundWorkspaces(binding);
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

  async resolveWorkspaceContext(
    normalized,
    {
      replyToMessageId = "",
      missingWorkspaceText = "当前会话还没有绑定项目。",
    } = {}
  ) {
    return workspaceRuntime.resolveWorkspaceContext(this, normalized, {
      replyToMessageId,
      missingWorkspaceText,
    });
  }

  async resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread = true,
  }) {
    return threadRuntime.resolveWorkspaceThreadState(this, {
      bindingKey,
      workspaceRoot,
      normalized,
      autoSelectThread,
    });
  }

  async ensureThreadAndSendMessage({ bindingKey, workspaceRoot, normalized, threadId }) {
    return threadRuntime.ensureThreadAndSendMessage(this, {
      bindingKey,
      workspaceRoot,
      normalized,
      threadId,
    });
  }

  async ensureThreadResumed(threadId) {
    return threadRuntime.ensureThreadResumed(this, threadId);
  }

  resolveWorkspaceRootForBinding(bindingKey) {
    return runtimeState.resolveWorkspaceRootForBinding(this, bindingKey);
  }

  resolveThreadIdForBinding(bindingKey, workspaceRoot) {
    return runtimeState.resolveThreadIdForBinding(this, bindingKey, workspaceRoot);
  }

  setThreadBindingKey(threadId, bindingKey) {
    runtimeState.setThreadBindingKey(this, threadId, bindingKey);
  }

  setThreadWorkspaceRoot(threadId, workspaceRoot) {
    runtimeState.setThreadWorkspaceRoot(this, threadId, workspaceRoot);
  }

  setPendingBindingContext(bindingKey, normalized) {
    runtimeState.setPendingBindingContext(this, bindingKey, normalized);
  }

  setPendingThreadContext(threadId, normalized) {
    runtimeState.setPendingThreadContext(this, threadId, normalized);
  }

  setReplyCardEntry(runKey, entry) {
    runtimeState.setReplyCardEntry(this, runKey, entry);
  }

  setCurrentRunKeyForThread(threadId, runKey) {
    runtimeState.setCurrentRunKeyForThread(this, threadId, runKey);
  }

  resolveWorkspaceRootForThread(threadId) {
    return runtimeState.resolveWorkspaceRootForThread(this, threadId);
  }

  rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens) {
    approvalPolicyRuntime.rememberApprovalPrefixForWorkspace(this, workspaceRoot, commandTokens);
  }

  shouldAutoApproveRequest(workspaceRoot, approval) {
    return approvalPolicyRuntime.shouldAutoApproveRequest(this, workspaceRoot, approval);
  }

  async tryAutoApproveRequest(threadId, approval) {
    return approvalPolicyRuntime.tryAutoApproveRequest(this, threadId, approval);
  }

  async applyApprovalDecision({
    threadId,
    approval,
    command,
    workspaceRoot = "",
    scope = "once",
  }) {
    return approvalRuntime.applyApprovalDecision(this, {
      threadId,
      approval,
      command,
      workspaceRoot,
      scope,
    });
  }

  async handleBindCommand(normalized) {
    await workspaceRuntime.handleBindCommand(this, normalized);
  }

  async handleWhereCommand(normalized) {
    await workspaceRuntime.handleWhereCommand(this, normalized);
  }

  async showStatusPanel(normalized, { replyToMessageId, noticeText = "" } = {}) {
    await workspaceRuntime.showStatusPanel(this, normalized, { replyToMessageId, noticeText });
  }

  async handleMessageCommand(normalized) {
    await workspaceRuntime.handleMessageCommand(this, normalized);
  }

  async handleHelpCommand(normalized) {
    await workspaceRuntime.handleHelpCommand(this, normalized);
  }

  async handleUnknownCommand(normalized) {
    await workspaceRuntime.handleUnknownCommand(this, normalized);
  }

  async handleWorkspacesCommand(normalized, { replyToMessageId } = {}) {
    await workspaceRuntime.handleWorkspacesCommand(this, normalized, { replyToMessageId });
  }

  async showThreadPicker(normalized, { replyToMessageId } = {}) {
    await workspaceRuntime.showThreadPicker(this, normalized, { replyToMessageId });
  }

  async handleNewCommand(normalized) {
    await threadRuntime.handleNewCommand(this, normalized);
  }

  async handleSwitchCommand(normalized) {
    await threadRuntime.handleSwitchCommand(this, normalized);
  }

  async handleRemoveCommand(normalized) {
    await workspaceRuntime.handleRemoveCommand(this, normalized);
  }

  async refreshWorkspaceThreads(bindingKey, workspaceRoot, normalized) {
    return threadRuntime.refreshWorkspaceThreads(this, bindingKey, workspaceRoot, normalized);
  }

  describeWorkspaceStatus(threadId) {
    return threadRuntime.describeWorkspaceStatus(this, threadId);
  }

  async switchThreadById(normalized, threadId, { replyToMessageId } = {}) {
    await threadRuntime.switchThreadById(this, normalized, threadId, { replyToMessageId });
  }

  async handleStopCommand(normalized) {
    await eventsRuntime.handleStopCommand(this, normalized);
  }

  async handleApprovalCommand(normalized) {
    await approvalRuntime.handleApprovalCommand(this, normalized);
  }

  async deliverToFeishu(event) {
    await eventsRuntime.deliverToFeishu(this, event);
  }

  async sendInfoCardMessage({ chatId, text, replyToMessageId = "", replyInThread = false, kind = "info" }) {
    return sendInfoCardMessage(this, { chatId, text, replyToMessageId, replyInThread, kind });
  }

  async sendInteractiveApprovalCard({ chatId, approval, replyToMessageId = "", replyInThread = false }) {
    return sendInteractiveApprovalCard(this, { chatId, approval, replyToMessageId, replyInThread });
  }

  async updateInteractiveCard({ messageId, approval }) {
    return updateInteractiveCard(this, { messageId, approval });
  }

  async sendInteractiveCard({ chatId, card, replyToMessageId = "", replyInThread = false }) {
    return sendInteractiveCard(this, { chatId, card, replyToMessageId, replyInThread });
  }

  async patchInteractiveCard({ messageId, card }) {
    return patchInteractiveCard(this, { messageId, card });
  }

  async handleCardAction(data) {
    return handleCardAction(this, data);
  }

  dispatchCardAction(action, normalized) {
    return runtimeCommands.dispatchCardAction(this, action, normalized);
  }

  handlePanelCardAction(action, normalized) {
    return runtimeCommands.handlePanelCardAction(this, action, normalized);
  }

  handleThreadCardAction(action, normalized) {
    return runtimeCommands.handleThreadCardAction(this, action, normalized);
  }

  handleWorkspaceCardAction(action, normalized) {
    return runtimeCommands.handleWorkspaceCardAction(this, action, normalized);
  }

  queueCardActionWithFeedback(normalized, feedbackText, task) {
    return queueCardActionWithFeedback(this, normalized, feedbackText, task);
  }


  runCardActionTask(taskPromise) {
    runCardActionTask(this, taskPromise);
  }

  async handleApprovalCardActionAsync(action, data) {
    await approvalRuntime.handleApprovalCardActionAsync(this, action, data);
  }

  async sendCardActionFeedbackByContext(normalized, text, kind = "info") {
    await sendCardActionFeedbackByContext(this, normalized, text, kind);
  }

  async sendCardActionFeedback(data, text, kind = "info") {
    await sendCardActionFeedback(this, data, text, kind);
  }

  async switchWorkspaceByPath(normalized, workspaceRoot, { replyToMessageId } = {}) {
    await workspaceRuntime.switchWorkspaceByPath(
      this,
      normalized,
      workspaceRoot,
      { replyToMessageId }
    );
  }

  async removeWorkspaceByPath(normalized, workspaceRoot, { replyToMessageId } = {}) {
    await workspaceRuntime.removeWorkspaceByPath(
      this,
      normalized,
      workspaceRoot,
      { replyToMessageId }
    );
  }

  async upsertAssistantReplyCard({ threadId, turnId, chatId, text, state, deferFlush = false }) {
    await upsertAssistantReplyCard(this, { threadId, turnId, chatId, text, state, deferFlush });
  }

  async addPendingReaction(bindingKey, messageId) {
    await addPendingReaction(this, bindingKey, messageId);
  }

  movePendingReactionToThread(bindingKey, threadId) {
    movePendingReactionToThread(this, bindingKey, threadId);
  }

  async clearPendingReactionForBinding(bindingKey) {
    await clearPendingReactionForBinding(this, bindingKey);
  }

  async clearPendingReactionForThread(threadId) {
    await clearPendingReactionForThread(this, threadId);
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

  disposeReplyRunState(runKey, threadId) {
    disposeReplyRunState(this, runKey, threadId);
  }

  cleanupThreadRuntimeState(threadId) {
    runtimeState.cleanupThreadRuntimeState(this, threadId);
  }

  pruneRuntimeMapSizes() {
    runtimeState.pruneRuntimeMapSizes(this);
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
