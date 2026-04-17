const {
  DEFAULT_ACPX_SESSION_INDEX_FILE,
  extractRecentConversationFromAcpxSession,
  listAcpxSessionsForWorkspace,
  readAcpxSessionRecord,
} = require("./session-index");

async function listDesktopSessionsForWorkspace(runtime, workspaceRoot) {
  return listNormalizedDesktopSessions(runtime, workspaceRoot);
}

async function hydrateDesktopSession(runtime, session, { includeBridgeStatus = true } = {}) {
  if (!session) {
    return null;
  }

  const record = readAcpxSessionRecord({ file: session.file }, {
    sessionsDir: runtime.config.openclaw?.acpxSessionsDir,
  });
  if (!record) {
    return null;
  }

  const recentMessages = extractRecentConversationFromAcpxSession(record, 6);
  let writable = session?.writable === true;
  let bridgeError = typeof session?.bridgeError === "string" ? session.bridgeError : "";

  if (!includeBridgeStatus) {
    bridgeError = "";
  } else if (record.acpSessionId) {
    try {
      await runtime.codex.resumeThread({ threadId: record.acpSessionId });
      writable = true;
    } catch (error) {
      bridgeError = error.message;
    }
  } else {
    bridgeError = "desktop session does not expose an acp_session_id";
  }

  return {
    ...session,
    acpSessionId: record.acpSessionId || session.acpSessionId,
    title: record.title || session.title,
    updatedAt: toEpochSeconds(record.lastUsedAt || record.updatedAt) || session.updatedAt,
    writable,
    bridgeError,
    recentMessages,
  };
}

function resolveDesktopSessionById(runtime, workspaceRoot, sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return null;
  }
  const sessions = listNormalizedDesktopSessions(runtime, workspaceRoot);
  return sessions.find((session) => (
    session.id === normalizedSessionId
    || session.acpSessionId === normalizedSessionId
    || session.acpxRecordId === normalizedSessionId
  )) || null;
}

function listNormalizedDesktopSessions(runtime, workspaceRoot) {
  const indexFile = runtime.config.openclaw?.acpxSessionIndexFile || DEFAULT_ACPX_SESSION_INDEX_FILE;
  const entries = listAcpxSessionsForWorkspace(workspaceRoot, { indexFile });
  return entries.map((entry) => normalizeDesktopSession(entry)).filter(Boolean);
}

function normalizeDesktopSession(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const acpSessionId = String(entry.acpSessionId || "").trim();
  const acpxRecordId = String(entry.acpxRecordId || "").trim();
  const id = acpSessionId || acpxRecordId;
  if (!id) {
    return null;
  }

  return {
    id,
    file: entry.file,
    acpxRecordId,
    acpSessionId,
    cwd: entry.cwd || "",
    title: entry.title || "未命名桌面会话",
    updatedAt: toEpochSeconds(entry.lastUsedAt || entry.createdAt),
    sourceKind: "desktopSession",
    desktopVisible: true,
    closed: entry.closed === true,
    writable: false,
    bridgeError: "",
    recentMessages: [],
  };
}

function toEpochSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return 0;
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    return 0;
  }
  return Math.floor(parsed.getTime() / 1000);
}

module.exports = {
  hydrateDesktopSession,
  listDesktopSessionsForWorkspace,
  resolveDesktopSessionById,
};
