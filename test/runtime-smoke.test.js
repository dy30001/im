const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { FeishuBotRuntime } = require("../src/app/feishu-bot-runtime");

test("FeishuBotRuntime.stop flushes state and closes transports once", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-runtime-"));
  const runtime = new FeishuBotRuntime({
    mode: "feishu-bot",
    workspaceAllowlist: [],
    codexEndpoint: "",
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.3-codex",
    defaultCodexEffort: "medium",
    defaultCodexAccessMode: "default",
    verboseCodexLogs: false,
    feishu: {
      appId: "cli_test",
      appSecret: "secret",
    },
    defaultWorkspaceId: "default",
    feishuStreamingOutput: true,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });

  const calls = [];
  runtime.wsClient = {
    close: () => {
      calls.push("ws");
    },
  };
  runtime.codex = {
    close: async () => {
      calls.push("codex");
    },
  };
  runtime.sessionStore = {
    flush: async () => {
      calls.push("flush");
    },
  };

  await runtime.stop();
  await runtime.stop();

  assert.equal(runtime.isStopping, true);
  assert.deepEqual(calls, ["ws", "codex", "flush"]);
});
