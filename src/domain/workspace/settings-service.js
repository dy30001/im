const {
  extractModelCatalogFromListResponse,
  findModelByQuery,
  normalizeText,
  resolveEffectiveModelForEffort,
} = require("../../shared/model-catalog");

function applyDefaultCodexParamsOnBind(runtime, bindingKey, workspaceRoot) {
  const current = runtime.sessionStore.getCodexParamsForWorkspace(bindingKey, workspaceRoot);
  if (current.model || current.effort) {
    return;
  }

  const defaultModel = normalizeText(runtime.config.defaultCodexModel);
  const defaultEffort = normalizeEffort(runtime.config.defaultCodexEffort);
  if (!defaultModel && !defaultEffort) {
    return;
  }

  runtime.sessionStore.setCodexParamsForWorkspace(bindingKey, workspaceRoot, {
    model: defaultModel,
    effort: defaultEffort,
  });
}

function validateDefaultCodexParamsConfig(runtime, modelsInput) {
  const models = Array.isArray(modelsInput) ? modelsInput : [];
  const rawModel = normalizeText(runtime.config.defaultCodexModel);
  const rawEffort = normalizeEffort(runtime.config.defaultCodexEffort);
  const result = { model: "", effort: "" };
  if (!rawModel && !rawEffort) {
    return result;
  }
  if (!models.length) {
    return result;
  }

  if (rawModel) {
    result.model = resolveRequestedModel(models, rawModel);
  }

  if (rawEffort) {
    const effectiveModel = resolveEffectiveModelForEffort(models, result.model || rawModel);
    if (effectiveModel) {
      result.effort = resolveRequestedEffort(effectiveModel, rawEffort);
    }
  }

  return result;
}

async function loadAvailableModelsForSetting(runtime, normalized, { settingType }) {
  const availableModelsResult = await loadAvailableModels(runtime, {
    forceRefresh: false,
  });
  if (!availableModelsResult.error) {
    return availableModelsResult;
  }
  const isEffort = settingType === "effort";
  const actionLabel = isEffort ? "推理强度" : "模型";
  const listCommand = isEffort ? "/codex effort" : "/codex model";
  await runtime.sendInfoCardMessage({
    chatId: normalized.chatId,
    replyToMessageId: normalized.messageId,
    text: [
      `无法设置${actionLabel}：${availableModelsResult.error}`,
      "",
      `请先执行 \`${listCommand}\`，确认可用${actionLabel}后重试。`,
    ].join("\n"),
  });
  return null;
}

async function loadAvailableModels(runtime, { forceRefresh = false } = {}) {
  try {
    const response = await runtime.codex.listModels();
    const models = extractModelCatalogFromListResponse(response);
    if (!models.length) {
      return {
        models: [],
        error: "Codex 未返回可用模型列表。",
        source: forceRefresh ? "refresh" : "live",
        updatedAt: "",
      };
    }
    return {
      models,
      error: "",
      source: forceRefresh ? "refresh" : "live",
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      models: [],
      error: error?.message || "获取模型列表失败。",
      source: forceRefresh ? "refresh" : "live",
      updatedAt: "",
    };
  }
}

function resolveRequestedModel(models, rawInput) {
  const matched = findModelByQuery(models, rawInput);
  return matched?.model || matched?.id || "";
}

function resolveRequestedEffort(modelEntry, rawEffort) {
  if (!modelEntry) {
    return "";
  }
  const query = normalizeEffort(rawEffort);
  if (!query) {
    return "";
  }
  const availableEfforts = listModelEfforts(modelEntry, { withDefaultFallback: true });
  for (const effort of availableEfforts) {
    if (normalizeEffort(effort) === query) {
      return effort;
    }
  }
  return "";
}

function buildModelSelectOptions(models) {
  if (!Array.isArray(models) || !models.length) {
    return [];
  }
  return models
    .map((item) => normalizeText(item?.model))
    .filter(Boolean)
    .slice(0, 100)
    .map((model) => ({
      label: model,
      value: model,
    }));
}

function buildEffortSelectOptions(models, currentModel) {
  const effectiveModel = resolveEffectiveModelForEffort(models, currentModel);
  if (!effectiveModel) {
    return [];
  }
  const supported = listModelEfforts(effectiveModel, { withDefaultFallback: true });
  const options = [];
  const seen = new Set();
  for (const effort of supported) {
    const normalized = normalizeText(effort);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push({
      label: normalized,
      value: normalized,
    });
  }
  return options.slice(0, 20);
}

function listModelEfforts(modelEntry, { withDefaultFallback = false } = {}) {
  const supported = Array.isArray(modelEntry?.supportedReasoningEfforts)
    ? modelEntry.supportedReasoningEfforts
    : [];
  if (supported.length) {
    return supported;
  }
  if (!withDefaultFallback) {
    return [];
  }
  const defaultEffort = normalizeText(modelEntry?.defaultReasoningEffort);
  return defaultEffort ? [defaultEffort] : [];
}

function normalizeEffort(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = {
  applyDefaultCodexParamsOnBind,
  buildEffortSelectOptions,
  buildModelSelectOptions,
  loadAvailableModels,
  loadAvailableModelsForSetting,
  resolveRequestedEffort,
  resolveRequestedModel,
  validateDefaultCodexParamsConfig,
};
