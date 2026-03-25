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
  assert.equal(typeof scripts["openclaw-bot:stop"], "string");
  assert.equal(typeof scripts["openclaw-bot:restart"], "string");
  assert.equal(typeof scripts["openclaw-bot:quick"], "string");
  assert.equal(typeof scripts["openclaw-bot:daemon"], "string");
  assert.equal(typeof scripts["openclaw-bot:launchd"], "string");
  assert.match(scripts["openclaw-bot:daemon"], /start-openclaw-bot\.sh/);
  assert.match(scripts["openclaw-bot:launchd"], /install-openclaw-launch-agent\.sh/);
  assert.match(scripts["openclaw-bot:diagnose:bg"], /start-openclaw-diagnose\.sh/);
  assert.match(scripts["openclaw-bot:status"], /check-openclaw-status\.sh/);
  assert.match(scripts["openclaw-bot:doctor"], /openclaw-doctor\.sh/);
  assert.match(scripts["openclaw-bot:rescan"], /openclaw-rescan\.sh/);
  assert.match(scripts["openclaw-bot:stop"], /stop-openclaw-bot\.sh/);
  assert.match(scripts["openclaw-bot:restart"], /restart-openclaw-bot\.sh/);
  assert.match(scripts["openclaw-bot:quick"], /openclaw-quick\.sh/);
  assert.match(scripts["openclaw-bot:diagnose"], /CODEX_IM_VERBOSE_LOGS=true/);
  assert.equal(scripts.test, "node --test test/*.test.js");
  const packageJsonText = fs.readFileSync(packageJsonPath, "utf8");
  assert.match(packageJsonText, /openclaw-bot:launchd/);
});

test("daemon launcher daemonizes the OpenClaw supervisor", () => {
  const launcherPath = path.join(__dirname, "..", "scripts", "start-openclaw-bot.sh");
  const supervisorPath = path.join(__dirname, "..", "scripts", "start-openclaw-bot.js");
  const launcher = fs.readFileSync(launcherPath, "utf8");
  const supervisor = fs.readFileSync(supervisorPath, "utf8");

  assert.match(launcher, /start-openclaw-bot\.js/);
  assert.match(launcher, /exec "\$NODE_BIN" "\$APP_ROOT\/scripts\/start-openclaw-bot\.js"/);
  assert.match(supervisor, /CODEX_IM_OPENCLAW_SUPERVISOR_DAEMONIZED/);
  assert.match(supervisor, /openclaw supervisor daemonized pid=/);
  assert.match(supervisor, /child-pid/);
  assert.match(supervisor, /child\.once\("exit"/);
  assert.match(supervisor, /scheduleRestart\(\)/);
  assert.match(supervisor, /openclaw-bot supervisor ready pid=/);
});

test("launchd installer renders a persistent macOS LaunchAgent", () => {
  const installerPath = path.join(__dirname, "..", "scripts", "install-openclaw-launch-agent.sh");
  const bootstrapPath = path.join(__dirname, "..", "scripts", "bootstrap-openclaw.sh");
  const stopPath = path.join(__dirname, "..", "scripts", "stop-openclaw-bot.sh");
  const plistPath = path.join(__dirname, "..", "deploy", "macos", "com.dy3000.codex-im.openclaw.plist");
  const installer = fs.readFileSync(installerPath, "utf8");
  const bootstrap = fs.readFileSync(bootstrapPath, "utf8");
  const stop = fs.readFileSync(stopPath, "utf8");
  const plist = fs.readFileSync(plistPath, "utf8");

  assert.match(bootstrap, /openclaw-bot:launchd/);
  assert.match(stop, /launchctl bootout/);
  assert.match(installer, /launchctl bootout/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(installer, /launchctl kickstart -k/);
  assert.match(installer, /command -v node/);
  assert.match(installer, /start-openclaw-bot\.js/);
  assert.match(plist, /CODEX_IM_OPENCLAW_SUPERVISOR_DAEMONIZED/);
  assert.match(plist, /__NODE_BIN__/);
  assert.match(plist, /KeepAlive/);
});

test("status script reports supervisor and child pids", () => {
  const statusScriptPath = path.join(__dirname, "..", "scripts", "check-openclaw-status.sh");
  const statusScript = fs.readFileSync(statusScriptPath, "utf8");

  assert.match(statusScript, /child-pid/);
  assert.match(statusScript, /start-openclaw-bot/);
  assert.match(statusScript, /codex-im\.js openclaw-bot/);
  assert.match(statusScript, /launchd_status=/);
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
