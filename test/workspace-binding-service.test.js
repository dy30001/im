const assert = require("node:assert/strict");
const test = require("node:test");

const {
  handleWorkspacesCommand,
  switchWorkspaceByPath,
} = require("../src/domain/workspace/workspace-binding-service");

test("handleWorkspacesCommand tags the workspace list with selection context", async () => {
  const cards = [];
  const runtime = {
    sessionStore: {
      buildBindingKey: () => "binding-1",
      getBinding: () => ({
        workspaceRootByName: {},
      }),
    },
    listBoundWorkspaces: () => ([
      { workspaceRoot: "/repo/alpha" },
      { workspaceRoot: "/repo/beta" },
    ]),
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    buildWorkspaceBindingsCard: (items) => ({ items }),
    sendInteractiveCard: async (payload) => {
      cards.push(payload);
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
  };

  await handleWorkspacesCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "/codex workspaces",
  });

  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].selectionContext, {
    bindingKey: "binding-1",
    command: "workspace",
  });
});

test("switchWorkspaceByPath clears previous workspace runs and refreshes the workspace list", async () => {
  const activeRoots = [];
  const clearedQueues = [];
  const disposedRuns = [];
  const resolvedStates = [];
  const cards = [];
  const runtime = {
    sessionStore: {
      buildBindingKey: () => "binding-1",
      getBinding: () => ({
        workspaceRootByName: {},
      }),
      setActiveWorkspaceRoot: (_bindingKey, workspaceRoot) => {
        activeRoots.push(workspaceRoot);
      },
    },
    resolveWorkspaceRootForBinding: () => "/repo/alpha",
    listBoundWorkspaces: () => ([
      { workspaceRoot: "/repo/alpha" },
      { workspaceRoot: "/repo/beta" },
    ]),
    clearQueuedMessagesForBinding: (bindingKey, workspaceRoot) => {
      clearedQueues.push([bindingKey, workspaceRoot]);
    },
    disposeInactiveReplyRunsForBinding: (bindingKey, workspaceRoot) => {
      disposedRuns.push([bindingKey, workspaceRoot]);
    },
    resolveWorkspaceThreadState: async (payload) => {
      resolvedStates.push(payload);
    },
    resolveReplyToMessageId: (_normalized, replyToMessageId = "") => replyToMessageId || "reply-1",
    buildWorkspaceBindingsCard: (items) => ({ items }),
    sendInteractiveCard: async (payload) => {
      cards.push(payload);
    },
    sendInfoCardMessage: async () => {
      throw new Error("unexpected info card");
    },
  };

  await switchWorkspaceByPath(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "/codex switch /repo/beta",
  }, "/repo/beta", {
    replyToMessageId: "reply-9",
  });

  assert.deepEqual(activeRoots, ["/repo/beta"]);
  assert.deepEqual(clearedQueues, [["binding-1", "/repo/alpha"]]);
  assert.deepEqual(disposedRuns, [["binding-1", "/repo/beta"]]);
  assert.deepEqual(resolvedStates, [{
    bindingKey: "binding-1",
    workspaceRoot: "/repo/beta",
    normalized: {
      chatId: "chat-1",
      messageId: "msg-1",
      text: "/codex switch /repo/beta",
    },
    autoSelectThread: true,
    allowClaimedThreadReuse: false,
  }]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].replyToMessageId, "reply-9");
});
