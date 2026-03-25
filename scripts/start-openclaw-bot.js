#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const APP_ROOT = path.resolve(__dirname, "..");
const HOME_DIR = os.homedir();
const LOCK_DIR = path.join(HOME_DIR, ".codex-im", "openclaw-bot.lock");
const PID_FILE = path.join(LOCK_DIR, "pid");
const LOG_FILE = process.env.CODEX_IM_OPENCLAW_LOG_FILE || "/tmp/codex-im-openclaw.log";

main();

function main() {
  const existingPid = readExistingPid();
  if (existingPid && isPidAlive(existingPid)) {
    reportAlreadyRunning(existingPid);
    return;
  }

  const runningPid = findRunningPid();
  if (runningPid && isPidAlive(runningPid)) {
    writePidFile(runningPid);
    reportAlreadyRunning(runningPid);
    return;
  }

  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

  const logFd = fs.openSync(LOG_FILE, "a");
  let child;
  try {
    child = spawn(process.execPath, [path.join(APP_ROOT, "bin", "codex-im.js"), "openclaw-bot"], {
      cwd: APP_ROOT,
      detached: true,
      env: process.env,
      stdio: ["ignore", logFd, logFd],
    });

    child.unref();
    fs.writeFileSync(PID_FILE, `${child.pid}\n`, { encoding: "utf8" });
  } finally {
    fs.closeSync(logFd);
  }

  console.log(`[codex-im] openclaw-bot started in background pid=${child.pid}`);
  console.log(`[codex-im] log file: ${LOG_FILE}`);
  console.log("[codex-im] status: npm run openclaw-bot:status");
}

function readExistingPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8");
    return normalizePid(raw);
  } catch {
    return "";
  }
}

function findRunningPid() {
  const result = spawnSync("ps", ["aux"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return "";
  }

  const match = result.stdout
    .split("\n")
    .find((line) => /codex-im\.js openclaw-bot|node \.\/bin\/codex-im\.js openclaw-bot/.test(line));
  if (!match) {
    return "";
  }

  const parts = match.trim().split(/\s+/);
  return normalizePid(parts[1]);
}

function isPidAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function reportAlreadyRunning(pid) {
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  writePidFile(pid);
  console.log(`[codex-im] openclaw-bot already running (pid=${pid}), skip duplicate start`);
  console.log(`[codex-im] log file: ${LOG_FILE}`);
}

function writePidFile(pid) {
  fs.writeFileSync(PID_FILE, `${pid}\n`, { encoding: "utf8" });
}

function normalizePid(value) {
  const pid = String(value || "").trim();
  return /^\d+$/.test(pid) ? pid : "";
}
