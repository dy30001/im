const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SessionStore } = require("../src/infra/storage/session-store");

test("SessionStore.flush persists the latest in-memory state", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-session-"));
  const filePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore({ filePath });

  store.setActiveWorkspaceRoot("binding:1", "/repo");
  store.setThreadIdForWorkspace("binding:1", "/repo", "thread-1");
  store.setCodexParamsForWorkspace("binding:1", "/repo", {
    model: "gpt-5.3-codex",
    effort: "medium",
  });
  store.rememberApprovalCommandPrefixForWorkspace("/repo", ["codex", "send"]);

  await store.flush();

  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(saved.bindings["binding:1"].activeWorkspaceRoot, "/repo");
  assert.equal(saved.bindings["binding:1"].threadIdByWorkspaceRoot["/repo"], "thread-1");
  assert.equal(saved.bindings["binding:1"].codexParamsByWorkspaceRoot["/repo"].model, "gpt-5.3-codex");
  assert.deepEqual(saved.approvalCommandAllowlistByWorkspaceRoot["/repo"], [["codex", "send"]]);
});

test("SessionStore.listBindings returns a stable snapshot for thread sync polling", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-session-list-"));
  const filePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore({ filePath });

  store.setActiveWorkspaceRoot("binding:1", "/repo");
  store.setThreadIdForWorkspace("binding:1", "/repo", "thread-1", {
    chatId: "chat-1",
    workspaceId: "default",
  });
  store.setCodexParamsForWorkspace("binding:1", "/repo", {
    model: "gpt-5.3-codex",
    effort: "medium",
  });

  const bindings = store.listBindings();

  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].binding.activeWorkspaceRoot, "/repo");
  assert.equal(bindings[0].binding.threadIdByWorkspaceRoot["/repo"], "thread-1");
  bindings[0].binding.threadIdByWorkspaceRoot["/repo"] = "changed";
  assert.equal(store.getThreadIdForWorkspace("binding:1", "/repo"), "thread-1");
});

test("SessionStore.flush writes the session file with user-only permissions", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-session-mode-"));
  const filePath = path.join(tempDir, "sessions.json");
  const store = new SessionStore({ filePath });

  store.setActiveWorkspaceRoot("binding:1", "/repo");
  await store.flush();

  if (process.platform === "win32") {
    assert.ok(fs.existsSync(filePath));
    return;
  }

  const fileMode = fs.statSync(filePath).mode & 0o777;
  assert.equal(fileMode, 0o600);
});
