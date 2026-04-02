const assert = require("node:assert/strict");
const test = require("node:test");

const settingsService = require("../src/domain/workspace/settings-service");

test("validateDefaultCodexParamsConfig resolves model and effort from the available catalog", () => {
  const result = settingsService.validateDefaultCodexParamsConfig({
    config: {
      defaultCodexModel: "gpt-5.3-codex",
      defaultCodexEffort: "medium",
    },
  }, [
    {
      model: "gpt-5.3-codex",
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "medium",
    },
  ]);

  assert.deepEqual(result, {
    model: "gpt-5.3-codex",
    effort: "medium",
  });
});

test("applyDefaultCodexParamsOnBind only seeds defaults when the workspace has no saved params", () => {
  const writes = [];
  const runtime = {
    config: {
      defaultCodexModel: "gpt-5.3-codex",
      defaultCodexEffort: "high",
    },
    sessionStore: {
      getCodexParamsForWorkspace() {
        return { model: "", effort: "" };
      },
      getAvailableModelCatalog() {
        return {
          models: [
            {
              model: "gpt-5.3-codex",
              supportedReasoningEfforts: ["medium", "high"],
            },
          ],
        };
      },
      setCodexParamsForWorkspace(bindingKey, workspaceRoot, params) {
        writes.push({ bindingKey, workspaceRoot, params });
      },
    },
  };

  settingsService.applyDefaultCodexParamsOnBind(runtime, "binding-1", "/repo");

  assert.deepEqual(writes, [
    {
      bindingKey: "binding-1",
      workspaceRoot: "/repo",
      params: {
        model: "gpt-5.3-codex",
        effort: "high",
      },
    },
  ]);
});

test("loadAvailableModels reuses a fresh cached catalog without calling Codex again", async () => {
  let listCalls = 0;
  const runtime = {
    codex: {
      listModels: async () => {
        listCalls += 1;
        return {
          result: {
            data: [
              {
                model: "live-model",
                supportedReasoningEfforts: ["low"],
              },
            ],
          },
        };
      },
    },
    sessionStore: {
      getAvailableModelCatalog() {
        return {
          models: [
            {
              model: "cached-model",
              supportedReasoningEfforts: ["medium"],
            },
          ],
          updatedAt: new Date().toISOString(),
        };
      },
      setAvailableModelCatalog() {
        throw new Error("should not persist fresh cache");
      },
    },
  };

  const result = await settingsService.loadAvailableModels(runtime);

  assert.equal(listCalls, 0);
  assert.equal(result.source, "cache");
  assert.deepEqual(result.models.map((model) => model.model), ["cached-model"]);
});

test("loadAvailableModels refreshes a stale cached catalog and persists the new data", async () => {
  let listCalls = 0;
  const persisted = [];
  const runtime = {
    codex: {
      listModels: async () => {
        listCalls += 1;
        return {
          result: {
            data: [
              {
                model: "refreshed-model",
                supportedReasoningEfforts: ["low", "medium"],
              },
            ],
          },
        };
      },
    },
    sessionStore: {
      getAvailableModelCatalog() {
        return {
          models: [
            {
              model: "stale-model",
              supportedReasoningEfforts: ["high"],
            },
          ],
          updatedAt: "1970-01-01T00:00:00.000Z",
        };
      },
      setAvailableModelCatalog(models) {
        persisted.push(models);
        return {
          models,
          updatedAt: "2026-04-02T00:00:00.000Z",
        };
      },
    },
  };

  const result = await settingsService.loadAvailableModels(runtime);

  assert.equal(listCalls, 1);
  assert.equal(result.source, "live");
  assert.deepEqual(result.models.map((model) => model.model), ["refreshed-model"]);
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].map((model) => model.model), ["refreshed-model"]);
});
