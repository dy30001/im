const assert = require("node:assert/strict");
const test = require("node:test");

const { applyApprovalDecision } = require("../src/domain/approval/approval-service");
const { shouldAutoApproveRequest } = require("../src/domain/approval/approval-policy");
const { isWorkspaceApprovalCommand } = require("../src/infra/codex/message-utils");

test("applyApprovalDecision remembers the command prefix for workspace approvals", async () => {
  const rememberedApprovals = [];
  const sentResponses = [];
  const runtime = createApprovalRuntime({
    rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens) {
      rememberedApprovals.push({ workspaceRoot, commandTokens });
    },
    codex: {
      async sendResponse(requestId, payload) {
        sentResponses.push({ requestId, payload });
      },
    },
  });
  const approval = {
    requestId: "request-1",
    method: "commandExecutionRequestApproval",
    commandTokens: ["npm", "test"],
  };

  const outcome = await applyApprovalDecision(runtime, {
    threadId: "thread-1",
    approval,
    command: "approve",
    workspaceRoot: "/repo",
    scope: "workspace",
  });

  assert.equal(outcome.error, null);
  assert.equal(outcome.decision, "accept");
  assert.equal(outcome.scope, "workspace");
  assert.deepEqual(rememberedApprovals, [
    {
      workspaceRoot: "/repo",
      commandTokens: ["npm", "test"],
    },
  ]);
  assert.deepEqual(sentResponses, [
    {
      requestId: "request-1",
      payload: { decision: "accept" },
    },
  ]);
});

test("applyApprovalDecision does not persist prefixes for one-off approvals", async () => {
  const rememberedApprovals = [];
  const runtime = createApprovalRuntime({
    rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens) {
      rememberedApprovals.push({ workspaceRoot, commandTokens });
    },
  });
  const approval = {
    requestId: "request-2",
    method: "commandExecutionRequestApproval",
    commandTokens: ["npm", "test"],
  };

  const outcome = await applyApprovalDecision(runtime, {
    threadId: "thread-1",
    approval,
    command: "approve",
    workspaceRoot: "/repo",
    scope: "once",
  });

  assert.equal(outcome.error, null);
  assert.deepEqual(rememberedApprovals, []);
});

test("shouldAutoApproveRequest matches persisted command prefixes per workspace", () => {
  const runtime = {
    sessionStore: {
      getApprovalCommandAllowlistForWorkspace(workspaceRoot) {
        if (workspaceRoot === "/repo") {
          return [["npm", "test"]];
        }
        return [];
      },
    },
  };

  assert.equal(shouldAutoApproveRequest(runtime, "/repo", {
    commandTokens: ["npm", "test", "--watch"],
  }), true);
  assert.equal(shouldAutoApproveRequest(runtime, "/repo", {
    commandTokens: ["npm", "run", "build"],
  }), false);
});

test("isWorkspaceApprovalCommand recognizes natural-language workspace approvals", () => {
  assert.equal(isWorkspaceApprovalCommand("/codex approve workspace"), true);
  assert.equal(isWorkspaceApprovalCommand("请同意工作区"), true);
  assert.equal(isWorkspaceApprovalCommand("同意当前工程"), true);
  assert.equal(isWorkspaceApprovalCommand("总是同意"), true);
  assert.equal(isWorkspaceApprovalCommand("拒绝当前工作区"), true);
  assert.equal(isWorkspaceApprovalCommand("拒绝当前项目"), true);
  assert.equal(isWorkspaceApprovalCommand("同意"), false);
});

function createApprovalRuntime(overrides = {}) {
  return {
    inFlightApprovalRequestKeys: new Set(),
    pendingApprovalByThreadId: new Map(),
    codex: {
      async sendResponse() {},
    },
    rememberApprovalPrefixForWorkspace() {},
    resolveWorkspaceRootForThread() {
      return "/repo";
    },
    ...overrides,
  };
}
