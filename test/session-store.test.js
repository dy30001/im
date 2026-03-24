const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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

test("SessionStore loads legacy state from fallback files when the primary file is missing", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-session-fallback-"));
  const filePath = path.join(tempDir, "feishu-sessions.json");
  const legacyFilePath = path.join(tempDir, "sessions.json");
  fs.writeFileSync(legacyFilePath, JSON.stringify({
    bindings: {
      "binding:1": {
        activeWorkspaceRoot: "/repo",
        threadIdByWorkspaceRoot: {
          "/repo": "thread-1",
        },
      },
    },
  }, null, 2));

  const store = new SessionStore({
    filePath,
    fallbackFilePaths: [legacyFilePath],
  });

  assert.equal(store.getActiveWorkspaceRoot("binding:1"), "/repo");
  assert.equal(store.getThreadIdForWorkspace("binding:1", "/repo"), "thread-1");

  store.setCodexParamsForWorkspace("binding:1", "/repo", {
    model: "gpt-5.3-codex",
    effort: "medium",
  });
  await store.flush();

  assert.ok(fs.existsSync(filePath));
  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.equal(saved.bindings["binding:1"].activeWorkspaceRoot, "/repo");
  assert.equal(saved.bindings["binding:1"].codexParamsByWorkspaceRoot["/repo"].model, "gpt-5.3-codex");
});

test("SessionStore prevents concurrent writers from using the same state file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-session-lock-"));
  const filePath = path.join(tempDir, "sessions.json");
  const firstStore = new SessionStore({ filePath });
  const childResult = spawnSync(process.execPath, [
    "-e",
    [
      `const { SessionStore } = require(${JSON.stringify(path.join(__dirname, "../src/infra/storage/session-store"))});`,
      `new SessionStore({ filePath: ${JSON.stringify(filePath)} });`,
    ].join("\n"),
  ], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });

  assert.equal(childResult.status, 1);
  assert.match(String(childResult.stderr || childResult.stdout), /already in use/i);

  await firstStore.close();

  const secondStore = new SessionStore({ filePath });
  await secondStore.close();
});
