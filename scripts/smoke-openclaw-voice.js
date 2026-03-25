#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const appDispatcher = require("../src/app/dispatcher");

async function main() {
  await runVoiceMessageSmoke();
  await runTextPrioritySmoke();
  console.log("[voice-smoke] PASS");
}

async function runVoiceMessageSmoke() {
  let seenCommand = "";
  let seenText = "";

  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext() {},
    async dispatchTextCommand(normalized) {
      seenCommand = normalized?.command || "";
      seenText = normalized?.text || "";
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-smoke",
    message_id: 9001,
    message_type: 3,
    item_list: [
      {
        type: 4,
        voice_item: {
          text: "当前在哪个项目",
        },
      },
    ],
  });

  assert.equal(seenCommand, "where");
  assert.equal(seenText, "当前在哪个项目");
}

async function runTextPrioritySmoke() {
  let seenCommand = "";
  let seenText = "";

  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext() {},
    async dispatchTextCommand(normalized) {
      seenCommand = normalized?.command || "";
      seenText = normalized?.text || "";
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-smoke",
    message_id: 9002,
    message_type: 1,
    item_list: [
      {
        type: 1,
        text_item: {
          text: "/codex where",
        },
      },
      {
        type: 4,
        voice_item: {
          text: "当前在哪个项目",
        },
      },
    ],
  });

  assert.equal(seenCommand, "where");
  assert.equal(seenText, "/codex where");
}

main().catch((error) => {
  console.error(`[voice-smoke] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
