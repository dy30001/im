const { normalizeWorkspacePath } = require("../../shared/workspace-paths");
const {
  extractNaturalBrowseSelectionIndex,
  extractNaturalWorkspaceSelectionIndex,
  isNaturalSelectionTextCompatibleWithCommand,
} = require("../../shared/command-parsing");

async function handleWorkspacesCommand(runtime, normalized, { replyToMessageId } = {}) {
  const bindingKey = runtime.sessionStore.buildBindingKey(normalized);
  const binding = runtime.sessionStore.getBinding(bindingKey) || {};
  const items = runtime.listBoundWorkspaces(binding);
  const replyTarget = runtime.resolveReplyToMessageId(normalized, replyToMessageId);
  if (!items.length) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "当前会话还没有已绑定项目。先发送 `/codex bind /绝对路径`。",
    });
    return;
  }

  const selectionContext = typeof runtime.resolveSelectionContext === "function"
    ? runtime.resolveSelectionContext(normalized)
    : null;
  const workspaceIndex = extractNaturalWorkspaceSelectionIndex(normalized.text);
  const genericWorkspaceIndex = selectionContext?.command === "workspace"
    && isNaturalSelectionTextCompatibleWithCommand(normalized.text, "workspace")
    ? extractNaturalBrowseSelectionIndex(normalized.text)
    : 0;
  const resolvedWorkspaceIndex = workspaceIndex > 0 ? workspaceIndex : genericWorkspaceIndex;
  if (resolvedWorkspaceIndex > 0) {
    const selectedWorkspace = items[resolvedWorkspaceIndex - 1] || null;
    if (!selectedWorkspace) {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: replyTarget,
        text: `当前只有 ${items.length} 个已绑定项目，无法选择第 ${resolvedWorkspaceIndex} 个。`,
      });
      return;
    }

    await runtime.switchWorkspaceByPath(normalized, selectedWorkspace.workspaceRoot, {
      replyToMessageId: replyTarget,
    });
    return;
  }

  await runtime.sendInteractiveCard({
    chatId: normalized.chatId,
    replyToMessageId: replyTarget,
    card: runtime.buildWorkspaceBindingsCard(items),
    selectionContext: {
      bindingKey,
      command: "workspace",
    },
  });
}

async function switchWorkspaceByPath(runtime, normalized, workspaceRoot, { replyToMessageId } = {}) {
  const targetWorkspaceRoot = normalizeWorkspacePath(workspaceRoot);
  if (!targetWorkspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyToMessageId || normalized.messageId,
      text: "目标项目无效，请刷新后重试。",
    });
    return;
  }

  const bindingKey = runtime.sessionStore.buildBindingKey(normalized);
  const currentWorkspaceRoot = runtime.resolveWorkspaceRootForBinding(bindingKey);
  if (currentWorkspaceRoot && currentWorkspaceRoot === targetWorkspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyToMessageId || normalized.messageId,
      text: "已经是当前项目，无需切换。",
    });
    return;
  }

  const binding = runtime.sessionStore.getBinding(bindingKey) || {};
  const items = runtime.listBoundWorkspaces(binding);
  if (!items.some((item) => item.workspaceRoot === targetWorkspaceRoot)) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyToMessageId || normalized.messageId,
      text: "该项目未绑定到当前会话，请先执行 `/codex bind /绝对路径`。",
    });
    return;
  }

  runtime.sessionStore.setActiveWorkspaceRoot(bindingKey, targetWorkspaceRoot);
  if (
    currentWorkspaceRoot
    && currentWorkspaceRoot !== targetWorkspaceRoot
    && typeof runtime.clearQueuedMessagesForBinding === "function"
  ) {
    runtime.clearQueuedMessagesForBinding(bindingKey, currentWorkspaceRoot);
  }
  if (typeof runtime.disposeInactiveReplyRunsForBinding === "function") {
    runtime.disposeInactiveReplyRunsForBinding(bindingKey, targetWorkspaceRoot);
  }
  await runtime.resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot: targetWorkspaceRoot,
    normalized,
    autoSelectThread: true,
    allowClaimedThreadReuse: false,
  });

  await handleWorkspacesCommand(runtime, normalized, {
    replyToMessageId: replyToMessageId || normalized.messageId,
  });
}

async function removeWorkspaceByPath(runtime, normalized, workspaceRoot, { replyToMessageId } = {}) {
  const targetWorkspaceRoot = normalizeWorkspacePath(workspaceRoot);
  if (!targetWorkspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyToMessageId || normalized.messageId,
      text: "目标项目无效，请刷新后重试。",
    });
    return;
  }

  const bindingKey = runtime.sessionStore.buildBindingKey(normalized);
  const currentWorkspaceRoot = runtime.resolveWorkspaceRootForBinding(bindingKey);
  if (currentWorkspaceRoot && currentWorkspaceRoot === targetWorkspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyToMessageId || normalized.messageId,
      text: "当前项目不支持移除，请先切换到其他项目。",
    });
    return;
  }

  const binding = runtime.sessionStore.getBinding(bindingKey) || {};
  const items = runtime.listBoundWorkspaces(binding);
  if (!items.some((item) => item.workspaceRoot === targetWorkspaceRoot)) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyToMessageId || normalized.messageId,
      text: "该项目未绑定到当前会话，无需移除。",
    });
    return;
  }

  runtime.sessionStore.removeWorkspace(bindingKey, targetWorkspaceRoot);
  await handleWorkspacesCommand(runtime, normalized, {
    replyToMessageId: replyToMessageId || normalized.messageId,
  });
}

module.exports = {
  handleWorkspacesCommand,
  removeWorkspaceByPath,
  switchWorkspaceByPath,
};
