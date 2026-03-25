const assert = require("node:assert/strict");
const test = require("node:test");

const { dispatchTextCommand } = require("../src/app/command-dispatcher");

test("dispatchTextCommand routes bare ordinal replies using the remembered threads context", async () => {
  const calls = [];
  const runtime = {
    resolveSelectionContext: () => ({ command: "threads" }),
    handleSwitchCommand: async (normalized) => {
      calls.push({ handler: "switch", command: normalized.command, text: normalized.text });
    },
    handleBrowseCommand: async () => {
      throw new Error("unexpected browse handler");
    },
    handleWorkspacesCommand: async () => {
      throw new Error("unexpected workspace handler");
    },
  };

  const handled = await dispatchTextCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "第二个",
    command: "message",
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    {
      handler: "switch",
      command: "switch",
      text: "第二个",
    },
  ]);
});

test("dispatchTextCommand routes bare ordinal replies using the remembered workspace context", async () => {
  const calls = [];
  const runtime = {
    resolveSelectionContext: () => ({ command: "workspace" }),
    handleSwitchCommand: async () => {
      throw new Error("unexpected switch handler");
    },
    handleBrowseCommand: async () => {
      throw new Error("unexpected browse handler");
    },
    handleWorkspacesCommand: async (normalized) => {
      calls.push({ handler: "workspace", command: normalized.command, text: normalized.text });
    },
  };

  const handled = await dispatchTextCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "第二个",
    command: "message",
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    {
      handler: "workspace",
      command: "workspace",
      text: "第二个",
    },
  ]);
});

test("dispatchTextCommand routes bare thread pagination replies using the remembered threads context", async () => {
  const calls = [];
  const runtime = {
    resolveSelectionContext: () => ({ command: "threads", page: 2 }),
    handleThreadsCommand: async (normalized) => {
      calls.push({ command: normalized.command, text: normalized.text });
    },
    handleSwitchCommand: async () => {
      throw new Error("unexpected switch handler");
    },
    handleBrowseCommand: async () => {
      throw new Error("unexpected browse handler");
    },
    handleWorkspacesCommand: async () => {
      throw new Error("unexpected workspace handler");
    },
  };

  const handled = await dispatchTextCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "下一页",
    command: "message",
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    {
      command: "next_page",
      text: "下一页",
    },
  ]);
});

test("dispatchTextCommand routes bare refresh replies using the remembered threads context", async () => {
  const calls = [];
  const runtime = {
    resolveSelectionContext: () => ({ command: "threads", page: 2 }),
    handleThreadsCommand: async (normalized) => {
      calls.push({ command: normalized.command, text: normalized.text });
    },
    handleSwitchCommand: async () => {
      throw new Error("unexpected switch handler");
    },
    handleBrowseCommand: async () => {
      throw new Error("unexpected browse handler");
    },
    handleWorkspacesCommand: async () => {
      throw new Error("unexpected workspace handler");
    },
  };

  const handled = await dispatchTextCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "刷新",
    command: "message",
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    {
      command: "refresh_threads",
      text: "刷新",
    },
  ]);
});

test("dispatchTextCommand routes /codex refresh replies using the remembered threads context", async () => {
  const calls = [];
  const runtime = {
    resolveSelectionContext: () => ({ command: "threads", page: 2 }),
    handleThreadsCommand: async (normalized) => {
      calls.push({ command: normalized.command, text: normalized.text });
    },
    handleSwitchCommand: async () => {
      throw new Error("unexpected switch handler");
    },
    handleBrowseCommand: async () => {
      throw new Error("unexpected browse handler");
    },
    handleWorkspacesCommand: async () => {
      throw new Error("unexpected workspace handler");
    },
  };

  const handled = await dispatchTextCommand(runtime, {
    chatId: "chat-1",
    messageId: "msg-1",
    text: "/codex 刷新",
    command: "unknown_command",
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, [
    {
      command: "refresh_threads",
      text: "/codex 刷新",
    },
  ]);
});
