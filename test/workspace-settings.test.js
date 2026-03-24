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
