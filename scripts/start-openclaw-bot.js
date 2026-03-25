#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const dotenv = require("dotenv");

const APP_ROOT = path.resolve(__dirname, "..");
loadSupervisorEnv();
const LOCK_DIR = path.join(os.homedir(), ".codex-im", "openclaw-bot.lock");
const SUPERVISOR_PID_FILE = path.join(LOCK_DIR, "pid");
const CHILD_PID_FILE = path.join(LOCK_DIR, "child-pid");
const HEARTBEAT_FILE = process.env.CODEX_IM_OPENCLAW_HEARTBEAT_FILE || path.join(LOCK_DIR, "heartbeat.json");
const LOG_FILE = process.env.CODEX_IM_OPENCLAW_LOG_FILE || "/tmp/codex-im-openclaw.log";
const ENTRYPOINT = process.env.CODEX_IM_OPENCLAW_ENTRYPOINT || path.join(APP_ROOT, "bin", "codex-im.js");
const ENTRY_MODE = process.env.CODEX_IM_OPENCLAW_ENTRY_MODE || "openclaw-bot";
const SUPERVISOR_DAEMONIZED = process.env.CODEX_IM_OPENCLAW_SUPERVISOR_DAEMONIZED === "1";
const RESTART_DELAY_MS = parseRestartDelay(process.env.CODEX_IM_OPENCLAW_RESTART_DELAY_MS, 2_000);
const HEARTBEAT_TIMEOUT_MS = parseRestartDelay(
  process.env.CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS,
  3 * 60 * 60 * 1_000
);
const HEARTBEAT_CHECK_INTERVAL_MS = parseRestartDelay(
  process.env.CODEX_IM_OPENCLAW_HEARTBEAT_CHECK_INTERVAL_MS,
  5 * 60 * 1_000
);

let currentChild = null;
let currentChildStartedAt = 0;
let restartTimer = null;
let heartbeatTimer = null;
let shuttingDown = false;

main().catch((error) => {
  console.error(`[codex-im] openclaw supervisor failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (!SUPERVISOR_DAEMONIZED) {
    const activePid = detectActiveSupervisorPid();
    if (activePid) {
      console.log(`[codex-im] openclaw-bot already running (pid=${activePid}), skip duplicate start`);
      console.log(`[codex-im] log file: ${LOG_FILE}`);
      return;
    }

    daemonizeSupervisor();
    return;
  }

  const acquisition = acquireSupervisorLock();
  if (!acquisition.acquired) {
    console.log(`[codex-im] openclaw-bot already running (pid=${acquisition.pid}), skip duplicate start`);
    console.log(`[codex-im] log file: ${LOG_FILE}`);
    return;
  }

  installShutdownHooks();
  startHeartbeatWatchdog();
  console.log(`[codex-im] openclaw-bot supervisor ready pid=${process.pid}`);
  console.log(`[codex-im] log file: ${LOG_FILE}`);
  startChild();
}

function daemonizeSupervisor() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const logFd = fs.openSync(LOG_FILE, "a");
  try {
    const child = spawn(process.execPath, [__filename], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        CODEX_IM_OPENCLAW_SUPERVISOR_DAEMONIZED: "1",
      },
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    child.unref();
    console.log(`[codex-im] openclaw supervisor daemonized pid=${child.pid}`);
    console.log(`[codex-im] log file: ${LOG_FILE}`);
  } finally {
    fs.closeSync(logFd);
  }
}

function detectActiveSupervisorPid() {
  const existingPid = readPidFile(SUPERVISOR_PID_FILE);
  if (existingPid && existingPid !== String(process.pid) && isPidAlive(existingPid)) {
    return existingPid;
  }

  const runningSupervisorPid = findRunningSupervisorPid();
  if (runningSupervisorPid && runningSupervisorPid !== String(process.pid) && isPidAlive(runningSupervisorPid)) {
    return runningSupervisorPid;
  }

  return "";
}

function acquireSupervisorLock() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

  while (true) {
    const existingPid = readPidFile(SUPERVISOR_PID_FILE);
    if (existingPid === String(process.pid)) {
      fs.mkdirSync(LOCK_DIR, { recursive: true });
      writePidFile(SUPERVISOR_PID_FILE, process.pid);
      fs.rmSync(CHILD_PID_FILE, { force: true });
      return { acquired: true };
    }
    if (existingPid && existingPid !== String(process.pid) && isPidAlive(existingPid)) {
      return { acquired: false, pid: existingPid };
    }

    const runningSupervisorPid = findRunningSupervisorPid();
    if (runningSupervisorPid && runningSupervisorPid !== String(process.pid) && isPidAlive(runningSupervisorPid)) {
      return { acquired: false, pid: runningSupervisorPid };
    }

    const runningChildPid = findRunningChildPid();
    if (runningChildPid && runningChildPid !== String(process.pid) && isPidAlive(runningChildPid)) {
      console.warn(`[codex-im] found orphan openclaw child pid=${runningChildPid}, stopping it before restart`);
      killPid(runningChildPid);
    }

    try {
      fs.mkdirSync(LOCK_DIR);
      writePidFile(SUPERVISOR_PID_FILE, process.pid);
      fs.rmSync(CHILD_PID_FILE, { force: true });
      return { acquired: true };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    }
  }
}

function startChild() {
  if (shuttingDown) {
    return;
  }

  clearRestartTimer();
  clearHeartbeatFile();
  console.log(`[codex-im] openclaw child starting entrypoint=${ENTRYPOINT}`);
  const child = spawn(process.execPath, [ENTRYPOINT, ENTRY_MODE], {
    cwd: APP_ROOT,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  currentChild = child;
  currentChildStartedAt = Date.now();
  writePidFile(CHILD_PID_FILE, child.pid);
  console.log(`[codex-im] openclaw child started pid=${child.pid}`);

  child.once("exit", (code, signal) => {
    if (currentChild && currentChild.pid === child.pid) {
      currentChild = null;
      currentChildStartedAt = 0;
    }
    if (shuttingDown) {
      return;
    }

    console.warn(
      `[codex-im] openclaw child exited code=${code} signal=${signal || "-"}; restarting in ${RESTART_DELAY_MS}ms`
    );
    scheduleRestart();
  });

  child.once("error", (error) => {
    if (currentChild && currentChild.pid === child.pid) {
      currentChild = null;
      currentChildStartedAt = 0;
    }
    if (shuttingDown) {
      return;
    }

    console.error(`[codex-im] openclaw child failed to start: ${error.message}`);
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (restartTimer || shuttingDown) {
    return;
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (shuttingDown) {
      return;
    }
    startChild();
  }, RESTART_DELAY_MS);
}

function clearRestartTimer() {
  if (!restartTimer) {
    return;
  }
  clearTimeout(restartTimer);
  restartTimer = null;
}

function startHeartbeatWatchdog() {
  clearHeartbeatWatchdog();
  heartbeatTimer = setInterval(() => {
    if (shuttingDown || !currentChild || !currentChild.pid || !isPidAlive(currentChild.pid)) {
      return;
    }

    const staleState = getStaleHeartbeatState();
    if (!staleState.isStale) {
      return;
    }

    console.warn(
      `[codex-im] openclaw heartbeat stale age=${staleState.ageMs}ms timeout=${HEARTBEAT_TIMEOUT_MS}ms reason=${staleState.reason}; restarting child pid=${currentChild.pid}`
    );
    killPid(currentChild.pid);
  }, HEARTBEAT_CHECK_INTERVAL_MS);

  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }
}

function clearHeartbeatWatchdog() {
  if (!heartbeatTimer) {
    return;
  }
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function installShutdownHooks() {
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearRestartTimer();
  clearHeartbeatWatchdog();

  const child = currentChild;
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await waitForChildExit(child, 5_000).catch(() => {
      if (child.pid && isPidAlive(child.pid)) {
        child.kill("SIGKILL");
      }
    });
  }

  cleanupLockFiles();
  console.log(`[codex-im] openclaw supervisor stopped for ${signal}`);
  process.exit(0);
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("child exit timeout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      child.off("exit", onExit);
    }

    function onExit() {
      cleanup();
      resolve();
    }

    child.once("exit", onExit);
  });
}

function cleanupLockFiles() {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

function clearHeartbeatFile() {
  fs.rmSync(HEARTBEAT_FILE, { force: true });
}

function getStaleHeartbeatState() {
  const heartbeat = readHeartbeatFile();
  const referenceTime = heartbeat.updatedAt || currentChildStartedAt || 0;
  const ageMs = referenceTime > 0 ? Math.max(0, Date.now() - referenceTime) : Number.POSITIVE_INFINITY;
  return {
    isStale: ageMs >= HEARTBEAT_TIMEOUT_MS,
    ageMs: Number.isFinite(ageMs) ? ageMs : HEARTBEAT_TIMEOUT_MS,
    reason: heartbeat.reason || (heartbeat.updatedAt ? "unknown" : "missing"),
  };
}

function readHeartbeatFile() {
  try {
    const raw = fs.readFileSync(HEARTBEAT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const updatedAt = Number(parsed?.updatedAt || 0);
    const reason = String(parsed?.reason || "").trim();
    return {
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
      reason,
    };
  } catch {
    return {
      updatedAt: 0,
      reason: "",
    };
  }
}

function findRunningSupervisorPid() {
  const result = spawnSync("ps", ["aux"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return "";
  }

  const lines = result.stdout.split("\n");
  for (const line of lines) {
    if (!/start-openclaw-bot\.js/.test(line)) {
      continue;
    }

    const parts = line.trim().split(/\s+/);
    const pid = String(parts[1] || "").trim();
    if (!/^\d+$/.test(pid) || pid === String(process.pid)) {
      continue;
    }
    return pid;
  }

  return "";
}

function findRunningChildPid() {
  const result = spawnSync("ps", ["aux"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return "";
  }

  const lines = result.stdout.split("\n");
  for (const line of lines) {
    if (!/codex-im\.js openclaw-bot/.test(line)) {
      continue;
    }

    const parts = line.trim().split(/\s+/);
    const pid = String(parts[1] || "").trim();
    if (!/^\d+$/.test(pid) || pid === String(process.pid)) {
      continue;
    }
    return pid;
  }

  return "";
}

function readPidFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const pid = String(raw || "").trim();
    return /^\d+$/.test(pid) ? pid : "";
  } catch {
    return "";
  }
}

function writePidFile(filePath, pid) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${String(pid).trim()}\n`, { encoding: "utf8" });
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

function killPid(pid) {
  if (!isPidAlive(pid)) {
    return;
  }

  try {
    process.kill(Number(pid), "SIGTERM");
  } catch {
    return;
  }

  spawnSync(
    "/bin/sh",
    [
      "-lc",
      `target=${Number(pid)}; i=0; while [ "$i" -lt 50 ]; do kill -0 "$target" 2>/dev/null || exit 0; sleep 0.1; i=$((i + 1)); done; kill -KILL "$target" 2>/dev/null || true`,
    ],
    { stdio: "ignore" }
  );
}

function parseRestartDelay(rawValue, defaultValue) {
  const parsed = Number.parseInt(String(rawValue || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function loadSupervisorEnv() {
  const envPaths = [
    path.join(APP_ROOT, ".env"),
    path.join(os.homedir(), ".codex-im", ".env"),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    dotenv.config({ path: envPath, override: false });
  }
}
