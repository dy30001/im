const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathMatchesWorkspaceRoot, normalizeWorkspacePath } = require("../../shared/workspace-paths");

const DEFAULT_ACPX_SESSIONS_DIR = path.join(os.homedir(), ".acpx", "sessions");
const DEFAULT_ACPX_SESSION_INDEX_FILE = path.join(DEFAULT_ACPX_SESSIONS_DIR, "index.json");

function readAcpxSessionIndex({ indexFile = DEFAULT_ACPX_SESSION_INDEX_FILE } = {}) {
  try {
    const raw = fs.readFileSync(indexFile, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.map(normalizeAcpxIndexEntry).filter(Boolean);
  } catch {
    return [];
  }
}

function listAcpxSessionsForWorkspace(workspaceRoot, { indexFile = DEFAULT_ACPX_SESSION_INDEX_FILE } = {}) {
  const normalizedWorkspaceRoot = normalizeWorkspacePath(workspaceRoot);
  const entries = readAcpxSessionIndex({ indexFile });
  if (!normalizedWorkspaceRoot) {
    return entries;
  }
  return entries.filter((entry) => pathMatchesWorkspaceRoot(entry.cwd, normalizedWorkspaceRoot));
}

function readAcpxSessionRecord(record, { sessionsDir = DEFAULT_ACPX_SESSIONS_DIR } = {}) {
  const fileName = typeof record === "string" ? record.trim() : String(record?.file || "").trim();
  if (!fileName) {
    return null;
  }

  try {
    const filePath = path.join(sessionsDir, fileName);
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeAcpxSessionRecord(parsed, filePath);
  } catch {
    return null;
  }
}

function extractRecentConversationFromAcpxSession(sessionRecord, limit = 6) {
  const messages = Array.isArray(sessionRecord?.messages) ? sessionRecord.messages : [];
  const normalized = [];
  for (const message of messages) {
    const item = normalizeAcpxMessage(message);
    if (item) {
      normalized.push(item);
    }
  }
  return normalized.slice(-Math.max(1, limit));
}

function normalizeAcpxIndexEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const acpxRecordId = normalizeText(entry.acpxRecordId);
  const acpSessionId = normalizeText(entry.acpSessionId);
  const file = normalizeText(entry.file);
  if (!acpxRecordId || !file) {
    return null;
  }

  return {
    file,
    acpxRecordId,
    acpSessionId,
    cwd: normalizeWorkspacePath(entry.cwd),
    title: normalizeText(entry.name),
    closed: entry.closed === true,
    lastUsedAt: normalizeIsoDate(entry.lastUsedAt),
    createdAt: normalizeIsoDate(entry.createdAt),
  };
}

function normalizeAcpxSessionRecord(record, filePath) {
  if (!record || typeof record !== "object") {
    return null;
  }

  return {
    filePath,
    acpxRecordId: normalizeText(record.acpx_record_id),
    acpSessionId: normalizeText(record.acp_session_id),
    cwd: normalizeWorkspacePath(record.cwd),
    title: normalizeText(record.name) || normalizeText(record.title),
    closed: record.closed === true,
    updatedAt: normalizeIsoDate(record.updated_at || record.last_used_at),
    createdAt: normalizeIsoDate(record.created_at),
    lastUsedAt: normalizeIsoDate(record.last_used_at || record.updated_at),
    messages: Array.isArray(record.messages) ? record.messages : [],
  };
}

function normalizeAcpxMessage(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (message.User) {
    const text = extractAcpxContentText(message.User.content);
    return text ? { role: "user", text } : null;
  }
  if (message.Agent) {
    const text = extractAcpxContentText(message.Agent.content);
    return text ? { role: "assistant", text } : null;
  }
  return null;
}

function extractAcpxContentText(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  const parts = [];
  for (const item of content) {
    if (item?.Text && typeof item.Text === "string" && item.Text.trim()) {
      parts.push(item.Text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoDate(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

module.exports = {
  DEFAULT_ACPX_SESSION_INDEX_FILE,
  DEFAULT_ACPX_SESSIONS_DIR,
  extractRecentConversationFromAcpxSession,
  listAcpxSessionsForWorkspace,
  readAcpxSessionIndex,
  readAcpxSessionRecord,
};
