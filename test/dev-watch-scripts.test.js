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
  assert.equal(typeof scripts["openclaw-bot:diagnose"], "string");
  assert.equal(typeof scripts["openclaw-bot:diagnose:bg"], "string");
  assert.equal(typeof scripts["openclaw-bot:status"], "string");
  assert.equal(typeof scripts["openclaw-bot:doctor"], "string");
  assert.equal(typeof scripts["openclaw-bot:rescan"], "string");
  assert.equal(typeof scripts["openclaw-bot:daemon"], "string");
  assert.match(scripts["openclaw-bot:daemon"], /start-openclaw-bot\.sh/);
  assert.match(scripts["openclaw-bot:diagnose:bg"], /start-openclaw-diagnose\.sh/);
  assert.match(scripts["openclaw-bot:status"], /check-openclaw-status\.sh/);
  assert.match(scripts["openclaw-bot:doctor"], /openclaw-doctor\.sh/);
  assert.match(scripts["openclaw-bot:rescan"], /openclaw-rescan\.sh/);
  assert.match(scripts["openclaw-bot:diagnose"], /CODEX_IM_VERBOSE_LOGS=true/);
  assert.equal(scripts.test, "node --test test/*.test.js");
});

test("daemon launcher runs the OpenClaw bot detached", () => {
  const launcherPath = path.join(__dirname, "..", "scripts", "start-openclaw-bot.js");
  const launcher = fs.readFileSync(launcherPath, "utf8");

  assert.match(launcher, /detached:\s*true/);
  assert.match(launcher, /openclaw-bot/);
  assert.match(launcher, /child\.unref\(\)/);
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
    "src/shared/error-text.js",
    "src/shared/model-catalog.js",
  ];

  for (const requiredPath of requiredPaths) {
    assert.match(checkScript, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
