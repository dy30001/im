const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("package.json exposes dev watch scripts for both runtimes", () => {
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const scripts = packageJson.scripts || {};

  assert.equal(typeof scripts["watch:feishu-bot"], "string");
  assert.equal(typeof scripts["watch:openclaw-bot"], "string");
  assert.match(scripts["watch:feishu-bot"], /node --watch/);
  assert.match(scripts["watch:openclaw-bot"], /node --watch/);
  assert.match(scripts["watch:openclaw-bot"], /openclaw-bot/);
});

test("package.json check script covers newly added runtime and workspace modules", () => {
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const checkScript = String(packageJson.scripts?.check || "");

  const requiredPaths = [
    "src/app/openclaw-bot-runtime.js",
    "src/app/runtime-base.js",
    "src/domain/workspace/browser-service.js",
    "src/domain/workspace/settings-service.js",
    "src/infra/acpx/session-bridge.js",
    "src/infra/openclaw/client-adapter.js",
    "src/infra/openclaw/media-adapter.js",
    "src/infra/stt/transcription-client.js",
    "src/shared/error-text.js",
    "src/shared/model-catalog.js",
  ];

  for (const requiredPath of requiredPaths) {
    assert.match(checkScript, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
