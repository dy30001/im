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
  assert.equal(typeof scripts["openclaw-bot:fix"], "string");
  assert.equal(typeof scripts["openclaw-bot:stop"], "string");
  assert.equal(typeof scripts["openclaw-bot:restart"], "string");
  assert.equal(typeof scripts["openclaw-bot:quick"], "string");
  assert.equal(typeof scripts["openclaw-bot:connect"], "string");
  assert.equal(typeof scripts["openclaw-bot:daemon"], "string");
  assert.equal(typeof scripts["openclaw-bot:launchd"], "string");
  assert.match(scripts["openclaw-bot:connect"], /openclaw-connect\.sh/);
  assert.match(scripts["openclaw-bot:daemon"], /start-openclaw-bot\.sh/);
  assert.match(scripts["openclaw-bot:launchd"], /install-openclaw-launch-agent\.sh/);
  assert.match(scripts["openclaw-bot:diagnose:bg"], /start-openclaw-diagnose\.sh/);
  assert.match(scripts["openclaw-bot:status"], /check-openclaw-status\.sh/);
  assert.match(scripts["openclaw-bot:doctor"], /openclaw-doctor\.sh/);
  assert.match(scripts["openclaw-bot:fix"], /openclaw-fix\.sh/);
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
  const helperPath = path.join(__dirname, "..", "scripts", "lib", "openclaw-instance.sh");
  const launcher = fs.readFileSync(launcherPath, "utf8");
  const supervisor = fs.readFileSync(supervisorPath, "utf8");
  const helper = fs.readFileSync(helperPath, "utf8");

  assert.match(launcher, /start-openclaw-bot\.js/);
  assert.match(launcher, /exec "\$NODE_BIN" "\$APP_ROOT\/scripts\/start-openclaw-bot\.js"/);
  assert.match(launcher, /OPENCLAW_INSTANCE_ARG/);
  assert.match(helper, /CODEX_IM_OPENCLAW_INSTANCE_ID/);
  assert.match(helper, /openclaw-sessions\.\$\{OPENCLAW_INSTANCE_ID\}\.json/);
  assert.match(helper, /resolve_openclaw_node_bin/);
  assert.match(helper, /run_openclaw_node/);
  assert.match(helper, /run_openclaw_cli_command/);
  assert.match(helper, /collect_openclaw_log_window/);
  assert.match(helper, /print_openclaw_next_action/);
  assert.match(helper, /launchd_status/);
  assert.match(helper, /openclaw-bot:launchd/);
  assert.match(supervisor, /CODEX_IM_OPENCLAW_SUPERVISOR_DAEMONIZED/);
  assert.match(supervisor, /CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS/);
  assert.match(supervisor, /CODEX_IM_OPENCLAW_STARTUP_HEARTBEAT_TIMEOUT_MS/);
  assert.match(supervisor, /CODEX_IM_OPENCLAW_LAUNCHD_REPAIR_INTERVAL_MS/);
  assert.match(supervisor, /resolveOpenClawLaunchdLabel/);
  assert.match(supervisor, /CODEX_IM_OPENCLAW_MAX_RESTART_DELAY_MS/);
  assert.match(supervisor, /CODEX_IM_OPENCLAW_STABLE_RUN_RESET_MS/);
  assert.match(supervisor, /heartbeat stale age=/);
  assert.match(supervisor, /HEARTBEAT_FILE/);
  assert.match(supervisor, /heartbeat\.updatedAt > 0 \? HEARTBEAT_TIMEOUT_MS : STARTUP_HEARTBEAT_TIMEOUT_MS/);
  assert.match(supervisor, /resolveOpenClawDefaultHeartbeatFile/);
  assert.match(supervisor, /dotenv\.config/);
  assert.doesNotMatch(supervisor, /heartbeatTimer\.unref\(\)/);
  assert.match(supervisor, /openclaw supervisor daemonized pid=/);
  assert.match(supervisor, /supervisor-state\.json/);
  assert.match(supervisor, /child-pid/);
  assert.match(supervisor, /--instance=/);
  assert.match(supervisor, /openclaw launchd guard watching existing supervisor pid=/);
  assert.match(supervisor, /launchd target missing, reloading/);
  assert.match(supervisor, /restored launchd keepalive target=/);
  assert.match(supervisor, /supervisorLockOwned/);
  assert.match(supervisor, /child\.once\("exit"/);
  assert.match(supervisor, /restartAttempt/);
  assert.match(supervisor, /writeSupervisorState/);
  assert.match(supervisor, /computeRestartDelayMs/);
  assert.match(supervisor, /scheduleRestart\(/);
  assert.match(supervisor, /openclaw-bot supervisor ready pid=/);
});

test("launchd installer renders a persistent macOS LaunchAgent", () => {
  const installerPath = path.join(__dirname, "..", "scripts", "install-openclaw-launch-agent.sh");
  const connectPath = path.join(__dirname, "..", "scripts", "openclaw-connect.sh");
  const bootstrapPath = path.join(__dirname, "..", "scripts", "bootstrap-openclaw.sh");
  const stopPath = path.join(__dirname, "..", "scripts", "stop-openclaw-bot.sh");
  const plistPath = path.join(__dirname, "..", "deploy", "macos", "com.dy3000.codex-im.openclaw.plist");
  const installer = fs.readFileSync(installerPath, "utf8");
  const connect = fs.readFileSync(connectPath, "utf8");
  const bootstrap = fs.readFileSync(bootstrapPath, "utf8");
  const stop = fs.readFileSync(stopPath, "utf8");
  const plist = fs.readFileSync(plistPath, "utf8");

  assert.match(bootstrap, /openclaw-connect\.sh/);
  assert.match(connect, /install-openclaw-launch-agent\.sh/);
  assert.match(connect, /waiting for WeChat QR scan/);
  assert.match(connect, /runtime-ready/);
  assert.match(connect, /openclaw-bot:doctor/);
  assert.match(connect, /created \.env from \.env\.example/);
  assert.match(connect, /installing npm dependencies/);
  assert.match(connect, /OpenClaw connected successfully/);
  assert.match(stop, /launchctl bootout/);
  assert.match(installer, /launchctl bootout/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(installer, /launchctl kickstart -k/);
  assert.match(installer, /resolve_openclaw_node_bin/);
  assert.match(installer, /start-openclaw-bot\.js/);
  assert.match(installer, /INSTANCE_ID=/);
  assert.match(installer, /__INSTANCE_ARG_XML__/);
  assert.match(plist, /__LABEL__/);
  assert.match(plist, /CODEX_IM_OPENCLAW_SUPERVISOR_DAEMONIZED/);
  assert.match(plist, /CODEX_IM_OPENCLAW_INSTANCE_ID/);
  assert.match(plist, /__NODE_BIN__/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test("status script reports supervisor and child pids", () => {
  const statusScriptPath = path.join(__dirname, "..", "scripts", "check-openclaw-status.sh");
  const statusScript = fs.readFileSync(statusScriptPath, "utf8");

  assert.match(statusScript, /CHILD_PID_FILE/);
  assert.match(statusScript, /heartbeat_file=/);
  assert.match(statusScript, /heartbeat_age_ms=/);
  assert.match(statusScript, /heartbeat_timeout_ms=/);
  assert.match(statusScript, /supervisor_state_file=/);
  assert.match(statusScript, /supervisor_status=/);
  assert.match(statusScript, /supervisor_restart_attempt=/);
  assert.match(statusScript, /service_state=/);
  assert.match(statusScript, /instance_id=/);
  assert.match(statusScript, /list_openclaw_process_lines/);
  assert.match(statusScript, /current log window/);
  assert.match(statusScript, /collect_openclaw_log_window/);
  assert.match(statusScript, /print_openclaw_next_action/);
  assert.match(statusScript, /service_state=/);
  assert.match(statusScript, /launchd_status=/);
});

test("quick and doctor scripts focus on the current run log window", () => {
  const quickScriptPath = path.join(__dirname, "..", "scripts", "openclaw-quick.sh");
  const doctorScriptPath = path.join(__dirname, "..", "scripts", "openclaw-doctor.sh");
  const fixScriptPath = path.join(__dirname, "..", "scripts", "openclaw-fix.sh");
  const quickScript = fs.readFileSync(quickScriptPath, "utf8");
  const doctorScript = fs.readFileSync(doctorScriptPath, "utf8");
  const fixScript = fs.readFileSync(fixScriptPath, "utf8");

  assert.match(quickScript, /key errors \(current run\)/);
  assert.match(quickScript, /collect_openclaw_log_window/);
  assert.match(doctorScript, /current log window/);
  assert.match(doctorScript, /collect_openclaw_log_window/);
  assert.match(doctorScript, /current_log_window/);
  assert.match(doctorScript, /print_openclaw_next_action/);
  assert.match(doctorScript, /service_state=/);
  assert.match(fixScript, /check-openclaw-status\.sh/);
  assert.match(fixScript, /run_openclaw_cli_command/);
  assert.match(fixScript, /openclaw-bot:connect/);
  assert.match(fixScript, /openclaw-bot:doctor/);
  assert.match(fixScript, /waiting for WeChat QR scan/);
});

test("package.json check script covers newly added runtime and workspace modules", () => {
  const packageJsonPath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const checkScript = String(packageJson.scripts?.check || "");

  const requiredPaths = [
    "src/app/openclaw-bot-runtime.js",
    "src/app/runtime-base.js",
    "src/domain/thread/thread-desktop-service.js",
    "src/domain/thread/thread-list-service.js",
    "src/domain/thread/thread-selection-service.js",
    "src/domain/thread/thread-send-service.js",
    "src/domain/workspace/browser-service.js",
    "src/domain/workspace/settings-service.js",
    "src/domain/workspace/workspace-binding-service.js",
    "src/domain/workspace/workspace-settings-command-service.js",
    "src/infra/acpx/session-bridge.js",
    "src/infra/openclaw/client-adapter.js",
    "src/shared/abortable-delay.js",
    "src/shared/error-text.js",
    "src/shared/model-catalog.js",
    "src/shared/thread-dispatch-claims.js",
  ];

  for (const requiredPath of requiredPaths) {
    assert.match(checkScript, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
