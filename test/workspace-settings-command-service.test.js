const assert = require("node:assert/strict");
const test = require("node:test");

const {
  handleEffortCommand,
  handleModelCommand,
} = require("../src/domain/workspace/workspace-settings-command-service");

function buildCachedCatalog(models) {
  return {
    models,
    updatedAt: new Date().toISOString(),
  };
}

function createNormalizedEvent(text) {
  return {
    chatId: "chat-1",
    messageId: "msg-1",
    text,
  };
}

test("handleModelCommand refreshes the model list on update", async () => {
  const infoCards = [];
  const persistedCatalogs = [];
  const runtime = {
    resolveWorkspaceContext: async () => ({
      bindingKey: "binding-1",
      workspaceRoot: "/repo",
    }),
    sessionStore: {
      getAvailableModelCatalog: () => null,
      setAvailableModelCatalog: (models) => {
        persistedCatalogs.push(models);
      },
    },
    codex: {
      listModels: async () => ({
        result: {
          data: [
            {
              id: "gpt-5.4",
              model: "gpt-5.4",
              supportedReasoningEfforts: ["low", "medium", "high"],
              isDefault: true,
            },
          ],
        },
      }),
    },
    buildModelListText: (_workspaceRoot, availableModelsResult, options) => {
      assert.equal(availableModelsResult.source, "refresh");
      assert.equal(options.refreshed, true);
      return "model list";
    },
    sendInfoCardMessage: async (payload) => {
      infoCards.push(payload);
    },
  };

  await handleModelCommand(runtime, createNormalizedEvent("/codex model update"));

  assert.equal(infoCards.length, 1);
  assert.equal(infoCards[0].text, "model list");
  assert.equal(persistedCatalogs.length, 1);
});

test("handleModelCommand stores the resolved model and preserves the current effort", async () => {
  const storedParams = [];
  const statusPanels = [];
  const models = [
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      supportedReasoningEfforts: ["low", "medium", "high"],
      isDefault: true,
    },
  ];
  const runtime = {
    resolveWorkspaceContext: async () => ({
      bindingKey: "binding-1",
      workspaceRoot: "/repo",
    }),
    getCodexParamsForWorkspace: () => ({
      model: "",
      effort: "high",
    }),
    sessionStore: {
      getAvailableModelCatalog: () => buildCachedCatalog(models),
      setCodexParamsForWorkspace: (bindingKey, workspaceRoot, params) => {
        storedParams.push([bindingKey, workspaceRoot, params]);
      },
    },
    showStatusPanel: async (normalized, options) => {
      statusPanels.push({ normalized, options });
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
    buildModelValidationErrorText: () => "invalid",
  };

  await handleModelCommand(runtime, createNormalizedEvent("/codex model gpt-5.4"));

  assert.deepEqual(storedParams, [[
    "binding-1",
    "/repo",
    {
      model: "gpt-5.4",
      effort: "high",
    },
  ]]);
  assert.equal(statusPanels.length, 1);
  assert.equal(statusPanels[0].options.noticeText, "已设置模型：gpt-5.4");
});

test("handleEffortCommand shows current effort info when no value is provided", async () => {
  const infoCards = [];
  const models = [
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      supportedReasoningEfforts: ["low", "medium", "high"],
      isDefault: true,
    },
  ];
  const runtime = {
    resolveWorkspaceContext: async () => ({
      bindingKey: "binding-1",
      workspaceRoot: "/repo",
    }),
    getCodexParamsForWorkspace: () => ({
      model: "gpt-5.4",
      effort: "medium",
    }),
    sessionStore: {
      getAvailableModelCatalog: () => buildCachedCatalog(models),
    },
    buildEffortInfoText: (workspaceRoot, current, availableModelsResult) => {
      assert.equal(workspaceRoot, "/repo");
      assert.equal(current.effort, "medium");
      assert.equal(availableModelsResult.source, "cache");
      return "effort info";
    },
    sendInfoCardMessage: async (payload) => {
      infoCards.push(payload);
    },
  };

  await handleEffortCommand(runtime, createNormalizedEvent("/codex effort"));

  assert.equal(infoCards.length, 1);
  assert.equal(infoCards[0].text, "effort info");
});

test("handleEffortCommand stores the resolved effort for the current model", async () => {
  const storedParams = [];
  const statusPanels = [];
  const models = [
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      supportedReasoningEfforts: ["low", "medium", "high"],
      isDefault: true,
    },
  ];
  const runtime = {
    resolveWorkspaceContext: async () => ({
      bindingKey: "binding-1",
      workspaceRoot: "/repo",
    }),
    getCodexParamsForWorkspace: () => ({
      model: "gpt-5.4",
      effort: "",
    }),
    sessionStore: {
      getAvailableModelCatalog: () => buildCachedCatalog(models),
      setCodexParamsForWorkspace: (bindingKey, workspaceRoot, params) => {
        storedParams.push([bindingKey, workspaceRoot, params]);
      },
    },
    showStatusPanel: async (normalized, options) => {
      statusPanels.push({ normalized, options });
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
    buildEffortValidationErrorText: () => "invalid",
  };

  await handleEffortCommand(runtime, createNormalizedEvent("/codex effort high"));

  assert.deepEqual(storedParams, [[
    "binding-1",
    "/repo",
    {
      model: "gpt-5.4",
      effort: "high",
    },
  ]]);
  assert.equal(statusPanels.length, 1);
  assert.equal(statusPanels[0].options.noticeText, "已设置推理强度：high");
});
