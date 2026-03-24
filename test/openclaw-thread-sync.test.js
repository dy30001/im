const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { OpenClawBotRuntime } = require("../src/app/openclaw-bot-runtime");

function createRuntime() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-sync-"));
  return new OpenClawBotRuntime({
    mode: "openclaw-bot",
    workspaceAllowlist: [],
    codexEndpoint: "",
    codexCommand: "codex",
    defaultCodexModel: "gpt-5.3-codex",
    defaultCodexEffort: "medium",
    defaultCodexAccessMode: "default",
    verboseCodexLogs: false,
    openclaw: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      token: "token",
      threadSource: "codex",
      longPollTimeoutMs: 35000,
    },
    defaultWorkspaceId: "default",
    openclawStreamingOutput: false,
    sessionsFile: path.join(tempDir, "sessions.json"),
  });
}

function buildResumeResponse(userText, assistantText) {
  return {
    result: {
      thread: {
        turns: [
          {
            items: [
              {
                type: "userMessage",
                content: [{ type: "text", text: userText }],
              },
              {
                type: "agentMessage",
                text: assistantText,
              },
            ],
          },
        ],
      },
    },
  };
}

test("OpenClaw selected thread sync sends one summary when the desktop thread changes", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let currentUpdatedAt = 100;
  let currentResumeResponse = buildResumeResponse("桌面提问 1", "桌面回答 1");

  runtime.sessionStore = {
    listBindings: () => [{
      bindingKey: "binding-1",
      binding: {
        workspaceId: "default",
        chatId: "chat-1",
        activeWorkspaceRoot: "/repo",
        threadIdByWorkspaceRoot: {
          "/repo": "thread-1",
        },
      },
    }],
  };
  runtime.refreshWorkspaceThreads = async () => [{
    id: "thread-1",
    cwd: "/repo",
    title: "Desktop Thread",
    updatedAt: currentUpdatedAt,
  }];
  runtime.codex = {
    resumeThread: async () => currentResumeResponse,
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  runtime.rememberSelectedThreadForSync("binding-1", "/repo", "thread-1");

  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(sentMessages.length, 0);

  currentUpdatedAt = 200;
  currentResumeResponse = buildResumeResponse("桌面提问 2", "桌面回答 2");

  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].chatId, "chat-1");
  assert.match(sentMessages[0].text, /检测到电脑端更新/);
  assert.match(sentMessages[0].text, /Desktop Thread/);
  assert.match(sentMessages[0].text, /桌面回答 2/);
});

test("OpenClaw selected thread sync skips the next update after local activity", async () => {
  const runtime = createRuntime();
  const sentMessages = [];
  let currentUpdatedAt = 100;
  let currentResumeResponse = buildResumeResponse("微信提问 1", "微信回答 1");

  runtime.sessionStore = {
    listBindings: () => [{
      bindingKey: "binding-1",
      binding: {
        workspaceId: "default",
        chatId: "chat-1",
        activeWorkspaceRoot: "/repo",
        threadIdByWorkspaceRoot: {
          "/repo": "thread-1",
        },
      },
    }],
  };
  runtime.refreshWorkspaceThreads = async () => [{
    id: "thread-1",
    cwd: "/repo",
    title: "Desktop Thread",
    updatedAt: currentUpdatedAt,
  }];
  runtime.codex = {
    resumeThread: async () => currentResumeResponse,
  };
  runtime.sendTextMessage = async (payload) => {
    sentMessages.push(payload);
  };

  runtime.rememberSelectedThreadForSync("binding-1", "/repo", "thread-1");

  await runtime.syncSelectedThreads({ aborted: false });
  runtime.markThreadSyncLocalActivity("thread-1");

  currentUpdatedAt = 200;
  currentResumeResponse = buildResumeResponse("微信提问 2", "微信回答 2");
  await runtime.syncSelectedThreads({ aborted: false });
  assert.equal(sentMessages.length, 0);

  currentUpdatedAt = 300;
  currentResumeResponse = buildResumeResponse("桌面提问 3", "桌面回答 3");
  await runtime.syncSelectedThreads({ aborted: false });

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /桌面回答 3/);
});
