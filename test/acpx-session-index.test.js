const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  extractRecentConversationFromAcpxSession,
  listAcpxSessionsForWorkspace,
  readAcpxSessionIndex,
  readAcpxSessionRecord,
} = require("../src/infra/acpx/session-index");

test("readAcpxSessionIndex parses desktop-visible sessions from index.json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-acpx-index-"));
  const indexFile = path.join(tempDir, "index.json");
  fs.writeFileSync(indexFile, JSON.stringify({
    entries: [
      {
        file: "session-1.json",
        acpxRecordId: "record-1",
        acpSessionId: "session-1",
        cwd: "/repo",
        name: "Desktop Session",
        closed: false,
        lastUsedAt: "2026-03-24T14:00:00.000Z",
      },
    ],
  }, null, 2));

  const entries = readAcpxSessionIndex({ indexFile });

  assert.deepEqual(entries, [
    {
      file: "session-1.json",
      acpxRecordId: "record-1",
      acpSessionId: "session-1",
      cwd: "/repo",
      title: "Desktop Session",
      closed: false,
      lastUsedAt: "2026-03-24T14:00:00.000Z",
      createdAt: "",
    },
  ]);
});

test("listAcpxSessionsForWorkspace filters sessions by workspace root", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-acpx-filter-"));
  const indexFile = path.join(tempDir, "index.json");
  fs.writeFileSync(indexFile, JSON.stringify({
    entries: [
      {
        file: "session-1.json",
        acpxRecordId: "record-1",
        acpSessionId: "session-1",
        cwd: "/repo",
        name: "Repo Session",
      },
      {
        file: "session-2.json",
        acpxRecordId: "record-2",
        acpSessionId: "session-2",
        cwd: "/other",
        name: "Other Session",
      },
    ],
  }, null, 2));

  const entries = listAcpxSessionsForWorkspace("/repo", { indexFile });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Repo Session");
});

test("readAcpxSessionRecord and extractRecentConversationFromAcpxSession normalize desktop session messages", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-acpx-record-"));
  const fileName = "session-1.json";
  fs.writeFileSync(path.join(tempDir, fileName), JSON.stringify({
    acpx_record_id: "record-1",
    acp_session_id: "session-1",
    cwd: "/repo",
    name: "Desktop Session",
    updated_at: "2026-03-24T14:05:00.000Z",
    messages: [
      { User: { content: [{ Text: "hello from desktop" }] } },
      { Agent: { content: [{ Text: "hello from codex" }] } },
    ],
  }, null, 2));

  const sessionRecord = readAcpxSessionRecord({ file: fileName }, { sessionsDir: tempDir });
  const recentMessages = extractRecentConversationFromAcpxSession(sessionRecord);

  assert.equal(sessionRecord.acpSessionId, "session-1");
  assert.equal(sessionRecord.title, "Desktop Session");
  assert.deepEqual(recentMessages, [
    { role: "user", text: "hello from desktop" },
    { role: "assistant", text: "hello from codex" },
  ]);
});
