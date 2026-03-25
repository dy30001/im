const fs = require("fs");
const path = require("path");
const {
  isAbsoluteWorkspacePath,
  isWorkspaceAllowed,
  normalizeWorkspacePath,
  pathMatchesWorkspaceRoot,
} = require("../../shared/workspace-paths");
const {
  extractBindPath,
  extractEffortValue,
  extractModelValue,
  extractRemoveWorkspacePath,
  extractSendPath,
  extractNaturalBrowseSelectionIndex,
  extractNaturalWorkspaceSelectionIndex,
  isNaturalSelectionTextCompatibleWithCommand,
} = require("../../shared/command-parsing");
const {
  resolveEffectiveModelForEffort,
} = require("../../shared/model-catalog");
const codexMessageUtils = require("../../infra/codex/message-utils");
const { formatFailureText } = require("../../shared/error-text");
const browserRuntime = require("./browser-service");
const settingsRuntime = require("./settings-service");

const MAX_FEISHU_UPLOAD_FILE_BYTES = 30 * 1024 * 1024;

async function resolveWorkspaceContext(
  runtime,
  normalized,
  {
    replyToMessageId = "",
    missingWorkspaceText = "当前会话还没有绑定项目。",
  } = {}
) {
  const replyTarget = runtime.resolveReplyToMessageId(normalized, replyToMessageId);
  const { bindingKey, workspaceRoot } = runtime.getBindingContext(normalized);
  if (!workspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: missingWorkspaceText,
    });
    return null;
  }

  return { bindingKey, workspaceRoot, replyTarget };
}

async function handleBindCommand(runtime, normalized) {
  const rawWorkspaceRoot = extractBindPath(normalized.text);
  if (!rawWorkspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "用法: `/codex bind /绝对路径`",
    });
    return;
  }

  await bindWorkspaceByPath(runtime, normalized, rawWorkspaceRoot, {
    replyToMessageId: normalized.messageId,
  });
}

async function handleBrowseCommand(
  runtime,
  normalized,
  {
    replyToMessageId = "",
    browsePath = "",
    bindPath = "",
  } = {}
) {
  const replyTarget = runtime.resolveReplyToMessageId(normalized, replyToMessageId || normalized.messageId);
  const browseRoots = browserRuntime.resolveBrowseRoots(runtime);
  if (!browseRoots.length) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "当前没有可浏览的目录范围。",
    });
    return;
  }

  if (bindPath) {
    const targetBindPath = normalizeWorkspacePath(bindPath);
    if (!isAbsoluteWorkspacePath(targetBindPath) || !isWorkspaceAllowed(targetBindPath, browseRoots)) {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: replyTarget,
        text: "该目录不在允许浏览的范围内。",
      });
      return;
    }
    await bindWorkspaceByPath(runtime, normalized, targetBindPath, {
      replyToMessageId: replyTarget,
    });
    return;
  }

  const { workspaceRoot: currentWorkspaceRoot } = runtime.getBindingContext(normalized);
  const requestedBrowsePath = normalizeWorkspacePath(browsePath);
  if (requestedBrowsePath) {
    if (!isAbsoluteWorkspacePath(requestedBrowsePath) || !isWorkspaceAllowed(requestedBrowsePath, browseRoots)) {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: replyTarget,
        text: "该目录不在允许浏览的范围内。",
      });
      return;
    }
  }
  const preferredPath = requestedBrowsePath || normalizeWorkspacePath(currentWorkspaceRoot);
  const requestedPath = preferredPath && isWorkspaceAllowed(preferredPath, browseRoots) ? preferredPath : "";
  const browserState = await browserRuntime.resolveWorkspaceBrowserState(runtime, {
    browseRoots,
    requestedPath,
  });
  if (browserState.errorText) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: browserState.errorText,
    });
    return;
  }

  const browseSelectionIndex = browsePath ? 0 : extractNaturalBrowseSelectionIndex(normalized.text);
  if (browseSelectionIndex > 0) {
    const entries = Array.isArray(browserState.entries) ? browserState.entries : [];
    const selectedEntry = entries[browseSelectionIndex - 1] || null;
    if (!selectedEntry) {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: replyTarget,
        text: entries.length
          ? `当前只有 ${entries.length} 个目录项，无法选择第 ${browseSelectionIndex} 个。`
          : "当前没有可选目录项。先发送 `/codex browse` 查看目录列表。",
      });
      return;
    }

    if (selectedEntry.kind !== "directory") {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: replyTarget,
        text: `当前第 ${browseSelectionIndex} 个不是目录，无法进入。`,
      });
      return;
    }

    const selectedBrowserState = await browserRuntime.resolveWorkspaceBrowserState(runtime, {
      browseRoots,
      requestedPath: selectedEntry.path,
    });
    if (selectedBrowserState.errorText) {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: replyTarget,
        text: selectedBrowserState.errorText,
      });
      return;
    }

    await runtime.sendInteractiveCard({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      card: runtime.buildWorkspaceBrowserCard(selectedBrowserState),
      selectionContext: {
        bindingKey: runtime.sessionStore.buildBindingKey(normalized),
        command: "browse",
      },
    });
    return;
  }

  await runtime.sendInteractiveCard({
    chatId: normalized.chatId,
    replyToMessageId: replyTarget,
    card: runtime.buildWorkspaceBrowserCard(browserState),
    selectionContext: {
      bindingKey: runtime.sessionStore.buildBindingKey(normalized),
      command: "browse",
    },
  });
}

async function bindWorkspaceByPath(runtime, normalized, rawWorkspaceRoot, { replyToMessageId } = {}) {
  const bindingKey = runtime.sessionStore.buildBindingKey(normalized);
  const replyTarget = runtime.resolveReplyToMessageId(normalized, replyToMessageId || normalized.messageId);
  const workspaceRoot = normalizeWorkspacePath(rawWorkspaceRoot);
  const bindRoots = browserRuntime.resolveBrowseRoots(runtime);
  if (!isAbsoluteWorkspacePath(workspaceRoot)) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "只支持绝对路径绑定。Windows 例如 `C:\\code\\repo`，macOS/Linux 例如 `/Users/name/repo`。",
    });
    return;
  }

  // Keep direct `/codex bind` aligned with the browser boundary so users
  // cannot bypass the allowed directory scope by typing an absolute path.
  if (!bindRoots.length || !isWorkspaceAllowed(workspaceRoot, bindRoots)) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "该项目不在允许绑定的范围内。",
    });
    return;
  }

  const workspaceStats = await runtime.resolveWorkspaceStats(workspaceRoot);
  if (!workspaceStats.exists) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: `项目不存在: ${workspaceRoot}`,
    });
    return;
  }

  if (!workspaceStats.isDirectory) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: `路径非法: ${workspaceRoot}`,
    });
    return;
  }

  settingsRuntime.applyDefaultCodexParamsOnBind(runtime, bindingKey, workspaceRoot);
  runtime.sessionStore.setActiveWorkspaceRoot(bindingKey, workspaceRoot);
  await runtime.refreshWorkspaceThreads(bindingKey, workspaceRoot, normalized);
  const existingThreadId = runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot);
  await showStatusPanel(runtime, normalized, {
    replyToMessageId: replyTarget,
    noticeText: existingThreadId
      ? "已切换到项目，并恢复原会话上下文。"
      : "已绑定项目。",
  });
}

async function handleWhereCommand(runtime, normalized) {
  await showStatusPanel(runtime, normalized);
}

async function showStatusPanel(runtime, normalized, { replyToMessageId, noticeText = "" } = {}) {
  const workspaceContext = await resolveWorkspaceContext(runtime, normalized, { replyToMessageId });
  if (!workspaceContext) {
    return;
  }
  const { bindingKey, workspaceRoot, replyTarget } = workspaceContext;

  const { threads, threadId } = await runtime.resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
  });
  const currentThread = threads.find((thread) => thread.id === threadId) || null;
  const recentThreads = currentThread
    ? threads.filter((thread) => thread.id !== threadId).slice(0, 2)
    : threads.slice(0, 3);
  const status = runtime.describeWorkspaceStatus(threadId);
  const codexParams = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  const availableCatalog = runtime.sessionStore.getAvailableModelCatalog();
  const availableModels = Array.isArray(availableCatalog?.models) ? availableCatalog.models : [];
  const modelOptions = settingsRuntime.buildModelSelectOptions(availableModels);
  const effortOptions = settingsRuntime.buildEffortSelectOptions(availableModels, codexParams?.model || "");
  await runtime.sendInteractiveCard({
    chatId: normalized.chatId,
    replyToMessageId: replyTarget,
    card: runtime.buildStatusPanelCard({
      workspaceRoot,
      codexParams,
      modelOptions,
      effortOptions,
      threadId,
      currentThread,
      recentThreads,
      totalThreadCount: threads.length,
      status,
      noticeText,
    }),
  });
}

async function handleMessageCommand(runtime, normalized) {
  const workspaceContext = await resolveWorkspaceContext(runtime, normalized, {
    replyToMessageId: normalized.messageId,
  });
  if (!workspaceContext) {
    return;
  }
  const { bindingKey, workspaceRoot } = workspaceContext;

  const { threads, threadId } = await runtime.resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot,
    normalized,
    autoSelectThread: true,
  });

  if (!threadId) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: usesDesktopSessionSource(runtime)
        ? `当前项目：\`${workspaceRoot}\`\n\n该项目在桌面 App 里还没有可查看的会话消息。`
        : `当前项目：\`${workspaceRoot}\`\n\n该项目还没有可查看的线程消息。`,
    });
    return;
  }

  const currentThread = threads.find((thread) => thread.id === threadId) || { id: threadId };
  let recentMessages = [];
  if (usesDesktopSessionSource(runtime) && currentThread?.sourceKind === "desktopSession") {
    const hydrated = typeof runtime.hydrateDesktopSession === "function"
      ? await runtime.hydrateDesktopSession(currentThread)
      : currentThread;
    recentMessages = Array.isArray(hydrated?.recentMessages) ? hydrated.recentMessages : [];
  } else {
    runtime.resumedThreadIds.delete(threadId);
    const resumeResponse = await runtime.ensureThreadResumed(threadId);
    recentMessages = codexMessageUtils.extractRecentConversationFromResumeResponse(resumeResponse);
  }

  await runtime.sendInfoCardMessage({
    chatId: normalized.chatId,
    replyToMessageId: normalized.messageId,
    text: runtime.buildThreadMessagesSummary({
      workspaceRoot,
      thread: currentThread,
      recentMessages,
    }),
  });
}

async function handleHelpCommand(runtime, normalized) {
  await runtime.sendInfoCardMessage({
    chatId: normalized.chatId,
    replyToMessageId: normalized.messageId,
    text: runtime.buildHelpCardText(),
  });
}

async function handleUnknownCommand(runtime, normalized) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "无效的 Codex 命令。\n\n可使用 `/codex help` 查看命令教程。",
    });
}

async function handleSendCommand(runtime, normalized) {
  const workspaceContext = await resolveWorkspaceContext(runtime, normalized, {
    replyToMessageId: normalized.messageId,
  });
  if (!workspaceContext) {
    return;
  }
  const { workspaceRoot } = workspaceContext;

  const requestedPath = extractSendPath(normalized.text);
  if (!requestedPath) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "用法: `/codex send <当前项目下的相对文件路径>`",
    });
    return;
  }

  const resolvedTarget = resolveWorkspaceSendTarget(workspaceRoot, requestedPath);
  if (resolvedTarget.errorText) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: resolvedTarget.errorText,
    });
    return;
  }

  let fileStats;
  try {
    fileStats = await fs.promises.stat(resolvedTarget.filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      await runtime.sendInfoCardMessage({
        chatId: normalized.chatId,
        replyToMessageId: normalized.messageId,
        text: `文件不存在: ${resolvedTarget.displayPath}`,
      });
      return;
    }
    throw error;
  }

  if (!fileStats.isFile()) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: `只支持发送文件，不支持目录: ${resolvedTarget.displayPath}`,
    });
    return;
  }

  if (fileStats.size <= 0) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: `文件为空，无法发送: ${resolvedTarget.displayPath}`,
    });
    return;
  }

  if (!runtime.supportsFileMessages()) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "当前通道暂不支持文件发送。",
    });
    return;
  }

  if (fileStats.size > MAX_FEISHU_UPLOAD_FILE_BYTES) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: `文件过大，飞书当前只支持发送 30MB 以内文件: ${resolvedTarget.displayPath}`,
    });
    return;
  }

  try {
    const fileBuffer = await fs.promises.readFile(resolvedTarget.filePath);
    await runtime.sendFileMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      fileName: path.basename(resolvedTarget.filePath),
      fileBuffer,
    });
    console.log(`[codex-im] file/send ok workspace=${workspaceRoot} path=${resolvedTarget.displayPath}`);
  } catch (error) {
    console.warn(
      `[codex-im] file/send failed workspace=${workspaceRoot} path=${resolvedTarget.displayPath}: ${error.message}`
    );
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: formatFailureText("发送文件失败", error),
    });
  }
}

async function handleModelCommand(runtime, normalized) {
  const workspaceContext = await resolveCodexSettingWorkspaceContext(runtime, normalized);
  if (!workspaceContext) {
    return;
  }
  const { bindingKey, workspaceRoot } = workspaceContext;

  const rawModel = extractModelValue(normalized.text);
  if (!rawModel) {
    const current = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
    const availableModelsResult = await settingsRuntime.loadAvailableModels(runtime, {
      forceRefresh: false,
    });
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: runtime.buildModelInfoText(workspaceRoot, current, availableModelsResult),
    });
    return;
  }

  const modelUpdateDirective = parseUpdateDirective(rawModel);
  if (modelUpdateDirective) {
    const availableModelsResult = await settingsRuntime.loadAvailableModels(runtime, {
      forceRefresh: true,
    });
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: runtime.buildModelListText(workspaceRoot, availableModelsResult, {
        refreshed: true,
      }),
    });
    return;
  }

  const availableModelsResult = await settingsRuntime.loadAvailableModelsForSetting(runtime, normalized, {
    settingType: "model",
  });
  if (!availableModelsResult) {
    return;
  }

  const resolvedModel = settingsRuntime.resolveRequestedModel(availableModelsResult.models, rawModel);
  if (!resolvedModel) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: runtime.buildModelValidationErrorText(workspaceRoot, rawModel, availableModelsResult.models),
    });
    return;
  }

  const current = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  runtime.sessionStore.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
    model: resolvedModel,
    effort: current.effort || "",
  });
  await runtime.showStatusPanel(normalized, {
    replyToMessageId: normalized.messageId,
    noticeText: `已设置模型：${resolvedModel}`,
  });
}

async function handleEffortCommand(runtime, normalized) {
  const workspaceContext = await resolveCodexSettingWorkspaceContext(runtime, normalized);
  if (!workspaceContext) {
    return;
  }
  const { bindingKey, workspaceRoot } = workspaceContext;

  const rawEffort = extractEffortValue(normalized.text);
  if (!rawEffort) {
    const current = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
    const availableModelsResult = await settingsRuntime.loadAvailableModels(runtime, {
      forceRefresh: false,
    });
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: runtime.buildEffortInfoText(workspaceRoot, current, availableModelsResult),
    });
    return;
  }

  const availableModelsResult = await settingsRuntime.loadAvailableModelsForSetting(runtime, normalized, {
    settingType: "effort",
  });
  if (!availableModelsResult) {
    return;
  }

  const current = runtime.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  const effectiveModel = resolveEffectiveModelForEffort(availableModelsResult.models, current.model);
  if (!effectiveModel) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "当前无法确定模型，请先执行 `/codex model` 并设置模型后再设置推理强度。",
    });
    return;
  }

  const resolvedEffort = settingsRuntime.resolveRequestedEffort(effectiveModel, rawEffort);
  if (!resolvedEffort) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: runtime.buildEffortValidationErrorText(workspaceRoot, effectiveModel, rawEffort),
    });
    return;
  }

  runtime.sessionStore.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
    model: current.model || "",
    effort: resolvedEffort,
  });
  await runtime.showStatusPanel(normalized, {
    replyToMessageId: normalized.messageId,
    noticeText: `已设置推理强度：${resolvedEffort}`,
  });
}

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

async function handleThreadsCommand(runtime, normalized) {
  const selectionContext = typeof runtime.resolveSelectionContext === "function"
    ? runtime.resolveSelectionContext(normalized)
    : null;
  const hasThreadListContext = String(selectionContext?.command || "").trim() === "threads";

  if (normalized.command !== "threads" && !hasThreadListContext) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "请先发送 `/codex threads` 打开线程列表，然后再说 `上一页`、`下一页` 或 `刷新`。",
    });
    return;
  }

  const currentPage = normalizeThreadPickerPage(selectionContext?.page);
  let page = 0;
  if (normalized.command === "prev_page") {
    page = Math.max(currentPage - 1, 0);
  } else if (normalized.command === "next_page") {
    page = currentPage + 1;
  } else if (normalized.command === "refresh_threads") {
    page = currentPage;
  }

  await showThreadPicker(runtime, normalized, {
    replyToMessageId: normalized.messageId,
    page,
  });
}

async function showThreadPicker(runtime, normalized, { replyToMessageId, page = 0 } = {}) {
  const replyTarget = runtime.resolveReplyToMessageId(normalized, replyToMessageId);
  const { bindingKey, workspaceRoot } = runtime.getBindingContext(normalized);
  if (!workspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: "当前会话还未绑定项目。先发送 `/codex bind /绝对路径`。",
    });
    return;
  }

  const threads = await runtime.refreshWorkspaceThreads(bindingKey, workspaceRoot, normalized);
  const safePage = normalizeThreadPickerPage(page, threads.length);
  const refreshState = typeof runtime.getWorkspaceThreadRefreshState === "function"
    ? runtime.getWorkspaceThreadRefreshState(bindingKey, workspaceRoot)
    : { ok: true, fromCache: false, error: "" };
  const currentThreadId = runtime.resolveThreadIdForBinding(bindingKey, workspaceRoot) || threads[0]?.id || "";
  if (!threads.length) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: refreshState.ok === false
        ? `当前项目：\`${workspaceRoot}\`\n\n线程列表刷新失败：${refreshState.error || "请稍后重试。"}`
        : usesDesktopSessionSource(runtime)
        ? `当前项目：\`${workspaceRoot}\`\n\n桌面 App 里还没有这个项目的可见会话。请先在电脑端打开该项目并创建/恢复会话。`
          : `当前项目：\`${workspaceRoot}\`\n\n还没有可切换的历史线程。`,
    });
    return;
  }

  if (typeof runtime.supportsInteractiveCards === "function" && !runtime.supportsInteractiveCards()) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: replyTarget,
      text: runtime.buildThreadPickerText({
        workspaceRoot,
        threads,
        currentThreadId,
        page: safePage,
        noticeText: refreshState.fromCache
          ? "线程列表刷新失败，当前展示最近一次成功结果。"
          : "",
      }),
      selectionContext: {
        bindingKey,
        command: "threads",
        page: safePage,
      },
    });
    return;
  }

  await runtime.sendInteractiveCard({
    chatId: normalized.chatId,
    replyToMessageId: replyTarget,
    card: runtime.buildThreadPickerCard({
      workspaceRoot,
      threads,
      currentThreadId,
      page: safePage,
      noticeText: refreshState.fromCache
        ? "线程列表刷新失败，当前展示最近一次成功结果。"
        : "",
    }),
    selectionContext: {
      bindingKey,
      command: "threads",
      page: safePage,
    },
  });
}

function normalizeThreadPickerPage(page, totalCount = 0, pageSize = 8) {
  const normalizedPageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 8;
  const totalPages = Math.max(1, Math.ceil(Math.max(Number(totalCount) || 0, 0) / normalizedPageSize));
  const numericPage = Number(page);
  const safePage = Number.isFinite(numericPage) ? Math.floor(numericPage) : 0;
  return Math.min(Math.max(safePage, 0), totalPages - 1);
}

async function handleRemoveCommand(runtime, normalized) {
  const workspaceRoot = extractRemoveWorkspacePath(normalized.text);
  if (!workspaceRoot) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "用法: `/codex remove /绝对路径`",
    });
    return;
  }

  if (!isAbsoluteWorkspacePath(workspaceRoot)) {
    await runtime.sendInfoCardMessage({
      chatId: normalized.chatId,
      replyToMessageId: normalized.messageId,
      text: "路径必须是绝对路径。",
    });
    return;
  }

  await removeWorkspaceByPath(runtime, normalized, workspaceRoot, {
    replyToMessageId: normalized.messageId,
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
  await runtime.resolveWorkspaceThreadState({
    bindingKey,
    workspaceRoot: targetWorkspaceRoot,
    normalized,
    autoSelectThread: true,
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
  handleBindCommand,
  handleBrowseCommand,
  handleEffortCommand,
  handleHelpCommand,
  handleMessageCommand,
  handleModelCommand,
  handleRemoveCommand,
  handleSendCommand,
  handleThreadsCommand,
  handleUnknownCommand,
  handleWhereCommand,
  handleWorkspacesCommand,
  removeWorkspaceByPath,
  resolveWorkspaceContext,
  showStatusPanel,
  showThreadPicker,
  switchWorkspaceByPath,
  validateDefaultCodexParamsConfig: settingsRuntime.validateDefaultCodexParamsConfig,
};

function usesDesktopSessionSource(runtime) {
  return typeof runtime.usesDesktopSessionSource === "function" && runtime.usesDesktopSessionSource();
}

function resolveWorkspaceSendTarget(workspaceRoot, requestedPath) {
  const normalizedInput = normalizeWorkspacePath(requestedPath);
  if (!normalizedInput) {
    return { errorText: "用法: `/codex send <当前项目下的相对文件路径>`" };
  }
  if (isAbsoluteWorkspacePath(normalizedInput)) {
    return { errorText: "只支持当前项目下的相对路径，不支持绝对路径。" };
  }

  const filePath = path.resolve(workspaceRoot, requestedPath);
  const normalizedResolvedPath = normalizeWorkspacePath(filePath);
  if (!pathMatchesWorkspaceRoot(normalizedResolvedPath, workspaceRoot)) {
    return { errorText: "文件路径超出了当前项目根目录。" };
  }

  return {
    filePath,
    displayPath: normalizeWorkspacePath(path.relative(workspaceRoot, filePath)) || path.basename(filePath),
  };
}

function parseUpdateDirective(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "update") {
    return { forceRefresh: true };
  }
  return null;
}

async function resolveCodexSettingWorkspaceContext(runtime, normalized) {
  return resolveWorkspaceContext(runtime, normalized, {
    replyToMessageId: normalized.messageId,
    missingWorkspaceText: "当前会话还未绑定项目。先发送 `/codex bind /绝对路径`。",
  });
}
