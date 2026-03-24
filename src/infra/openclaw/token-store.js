const fs = require("node:fs");
const path = require("node:path");

function loadOpenClawCredentials(filePath) {
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath) {
    return null;
  }

  try {
    const raw = fs.readFileSync(normalizedPath, "utf8");
    const parsed = JSON.parse(raw);
    const token = normalizeText(parsed?.token);
    if (!token) {
      return null;
    }
    return {
      token,
      baseUrl: normalizeText(parsed?.baseUrl),
      accountId: normalizeText(parsed?.accountId),
      userId: normalizeText(parsed?.userId),
      savedAt: normalizeText(parsed?.savedAt),
    };
  } catch {
    return null;
  }
}

function saveOpenClawCredentials(filePath, { token, baseUrl = "", accountId = "", userId = "" } = {}) {
  const normalizedPath = normalizePath(filePath);
  const normalizedToken = normalizeText(token);
  if (!normalizedPath || !normalizedToken) {
    throw new Error("OpenClaw credentials file path and token are required");
  }

  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });
  const payload = {
    token: normalizedToken,
    baseUrl: normalizeText(baseUrl),
    accountId: normalizeText(accountId),
    userId: normalizeText(userId),
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(normalizedPath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return payload;
}

function normalizePath(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  loadOpenClawCredentials,
  saveOpenClawCredentials,
};
