const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  hydrateDesktopSession,
  listDesktopSessionsForWorkspace,
  resolveDesktopSessionById,
} = require("../src/infra/acpx/session-bridge");

function writeSessionFixtures(tempDir) {
  const sessionsDir = path.join(tempDir, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, "index.json"), JSON.stringify({
    entries: [
      {
        file: "session-1.json",
        acpxRecordId: "record-1",
        acpSessionId: "session-1",
        cwd: "/repo",
        name: "Desktop Session",
        lastUsedAt: "2026-03-24T14:10:00.000Z",
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(sessionsDir, "session-1.json"), JSON.stringify({
    acpx_record_id: "record-1",
    acp_session_id: "session-1",
    cwd: "/repo",
    name: "Desktop Session",
    updated_at: "2026-03-24T14:10:00.000Z",
    messages: [
      { User: { content: [{ Text: "desktop says hi" }] } },
      { Agent: { content: [{ Text: "codex replies" }] } },
    ],
  }, null, 2));
  return sessionsDir;
}

test("listDesktopSessionsForWorkspace returns desktop-visible sessions", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-acpx-bridge-"));
  const sessionsDir = writeSessionFixtures(tempDir);
  const runtime = {
    config: {
      openclaw: {
        acpxSessionIndexFile: path.join(sessionsDir, "index.json"),
      },
    },
  };

  const sessions = await listDesktopSessionsForWorkspace(runtime, "/repo");

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "session-1");
  assert.equal(resolveDesktopSessionById(runtime, "/repo", "record-1")?.id, "session-1");
});

test("hydrateDesktopSession marks desktop sessions writable when acp_session_id resumes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-acpx-hydrate-"));
  const sessionsDir = writeSessionFixtures(tempDir);
  const runtime = {
    config: {
      openclaw: {
        acpxSessionsDir: sessionsDir,
      },
    },
    codex: {
      resumeThread: async ({ threadId }) => ({ result: { thread: { id: threadId, turns: [] } } }),
    },
  };

  const hydrated = await hydrateDesktopSession(runtime, {
    id: "session-1",
    file: "session-1.json",
    acpSessionId: "session-1",
    acpxRecordId: "record-1",
    cwd: "/repo",
    title: "Desktop Session",
    updatedAt: 0,
  });

  assert.equal(hydrated.writable, true);
  assert.deepEqual(hydrated.recentMessages, [
    { role: "user", text: "desktop says hi" },
    { role: "assistant", text: "codex replies" },
  ]);
});

test("hydrateDesktopSession degrades to read-only when acp_session_id cannot resume", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-acpx-readonly-"));
  const sessionsDir = writeSessionFixtures(tempDir);
  const runtime = {
    config: {
      openclaw: {
        acpxSessionsDir: sessionsDir,
      },
    },
    codex: {
      resumeThread: async () => {
        throw new Error("no rollout found for thread id session-1");
      },
    },
  };

  const hydrated = await hydrateDesktopSession(runtime, {
    id: "session-1",
    file: "session-1.json",
    acpSessionId: "session-1",
    acpxRecordId: "record-1",
    cwd: "/repo",
    title: "Desktop Session",
    updatedAt: 0,
  });

  assert.equal(hydrated.writable, false);
  assert.match(hydrated.bridgeError, /no rollout found/);
});
