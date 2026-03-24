const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  loadOpenClawCredentials,
  saveOpenClawCredentials,
} = require("../src/infra/openclaw/token-store");

test("saveOpenClawCredentials persists token metadata and loadOpenClawCredentials restores it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-token-store-"));
  const filePath = path.join(tempDir, "openclaw-credentials.json");

  saveOpenClawCredentials(filePath, {
    token: "bot-token",
    baseUrl: "https://ilinkai.weixin.qq.com",
    accountId: "account-1",
    userId: "user-1",
  });

  const restored = loadOpenClawCredentials(filePath);
  assert.equal(restored.token, "bot-token");
  assert.equal(restored.baseUrl, "https://ilinkai.weixin.qq.com");
  assert.equal(restored.accountId, "account-1");
  assert.equal(restored.userId, "user-1");
  assert.ok(restored.savedAt);
});

test("loadOpenClawCredentials returns null when the file is missing or malformed", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-token-missing-"));
  const missingFile = path.join(tempDir, "missing.json");
  assert.equal(loadOpenClawCredentials(missingFile), null);

  const malformedFile = path.join(tempDir, "bad.json");
  fs.writeFileSync(malformedFile, "{bad json", "utf8");
  assert.equal(loadOpenClawCredentials(malformedFile), null);
});
