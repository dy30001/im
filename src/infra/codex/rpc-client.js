const { spawn } = require("child_process");
const os = require("os");
const WebSocket = require("ws");

const PLATFORM = os.platform();
const IS_WINDOWS = PLATFORM === "win32";
const IS_MACOS = PLATFORM === "darwin";
const DEFAULT_CODEX_COMMAND = "codex";
const WINDOWS_EXECUTABLE_SUFFIX_RE = /\.(cmd|exe|bat)$/i;
const MACOS_CODEX_APP_CANDIDATES = [
  "/Applications/Codex.app/Contents/Resources/codex",
  `${os.homedir()}/Applications/Codex.app/Contents/Resources/codex`,
];
const CODEX_CLIENT_INFO = {
  name: "codex_im_agent",
  title: "Codex IM Agent",
  version: "0.2.0",
};

class CodexRpcClient {
  constructor({
    endpoint = "",
    env = process.env,
    codexCommand = "",
    spawnImpl = spawn,
    webSocketImpl = WebSocket,
    verboseLogs = false,
  }) {
    this.endpoint = endpoint;
    this.env = env;
    this.codexCommand = normalizeNonEmptyString(codexCommand) || normalizeNonEmptyString(env.CODEX_IM_CODEX_COMMAND);
    this.spawnImpl = spawnImpl;
    this.webSocketImpl = webSocketImpl;
    this.verboseLogs = verboseLogs;
    this.mode = endpoint ? "websocket" : "spawn";
    this.socket = null;
    this.child = null;
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.isReady = false;
    this.messageListeners = new Set();
    this.isClosing = false;
    this.hasReportedTransportFailure = false;
  }

  async connect() {
    if (this.mode === "websocket") {
      await this.connectWebSocket();
      return;
    }

    await this.connectSpawn();
  }

  async connectSpawn() {
    const commandCandidates = buildCodexCommandCandidates(this.codexCommand);
    let child = null;
    let lastError = null;
    let selectedCommand = "";

    for (const command of commandCandidates) {
      try {
        const spawnSpec = buildSpawnSpec(command);
        child = await spawnCodexProcess(this.spawnImpl, spawnSpec, this.env);
        selectedCommand = command;
        this.hasReportedTransportFailure = false;
        console.log(`[codex-im] spawned Codex app-server via ${spawnSpec.command} ${spawnSpec.args.join(" ")}`);
        break;
      } catch (error) {
        lastError = error;
        if (!isSpawnCandidateError(error)) {
          throw error;
        }
      }
    }

    if (!child) {
      const attempted = commandCandidates.join(", ");
      const detail = lastError?.message ? `: ${lastError.message}` : "";
      throw new Error(`Unable to spawn Codex app-server. Tried ${attempted}${detail}. You can override with CODEX_IM_CODEX_COMMAND.`);
    }

    this.child = child;

    child.on("error", (error) => {
      if (this.isClosing) {
        return;
      }
      this.isReady = false;
      this.reportTransportFailure(
        error,
        `[codex-im] failed to spawn Codex app-server via ${selectedCommand || this.codexCommand || DEFAULT_CODEX_COMMAND}: ${error.message}`
      );
    });

    child.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        this.handleIncoming(trimmed);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) {
        console.error(`[codex-im] codex stderr: ${text}`);
      }
    });

    child.on("close", (code, signal) => {
      if (this.isClosing) {
        return;
      }
      this.isReady = false;
      this.child = null;
      const suffix = signal ? ` signal ${signal}` : "";
      this.reportTransportFailure(
        new Error(`codex app-server exited with code ${code}${suffix}`),
        `[codex-im] codex app-server exited with code ${code}${suffix}`
      );
    });
  }

  async connectWebSocket() {
    await new Promise((resolve, reject) => {
      const socket = new this.webSocketImpl(this.endpoint);
      this.socket = socket;

      socket.on("open", () => {
        this.hasReportedTransportFailure = false;
        resolve();
      });
      socket.on("error", (error) => {
        if (!this.isClosing) {
          this.reportTransportFailure(error, `[codex-im] failed to open Codex websocket: ${error.message}`);
        }
        reject(error);
      });
      socket.on("message", (chunk) => {
        const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (message.trim()) {
          this.handleIncoming(message);
        }
      });
      socket.on("close", () => {
        this.isReady = false;
        this.socket = null;
        if (!this.isClosing) {
          this.rejectAllPending(new Error("Codex websocket closed"));
        }
      });
    });
  }

  onMessage(listener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async initialize() {
    if (this.isReady) {
      return;
    }

    await this.sendRequest("initialize", {
      clientInfo: CODEX_CLIENT_INFO,
      capabilities: {
        experimentalApi: true,
      },
    });
    await this.sendNotification("initialized", null);
    this.isReady = true;
  }

  async sendUserMessage({
    threadId,
    text,
    model = null,
    effort = null,
    accessMode = null,
    workspaceRoot = "",
  }) {
    const input = buildTurnInputPayload(text);
    return threadId
      ? this.sendRequest(
        "turn/start",
        buildTurnStartParams({
          threadId,
          input,
          model,
          effort,
          accessMode,
          workspaceRoot,
        })
      )
      : this.sendRequest("thread/start", { input });
  }

  async startThread({ cwd }) {
    return this.sendRequest("thread/start", buildStartThreadParams(cwd));
  }

  async resumeThread({ threadId }) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("thread/resume requires a non-empty threadId");
    }
    return this.sendRequest("thread/resume", { threadId: normalizedThreadId });
  }

  async listThreads({ cursor = null, limit = 100, sortKey = "updated_at" } = {}) {
    return this.sendRequest("thread/list", buildListThreadsParams({
      cursor,
      limit,
      sortKey,
    }));
  }

  async listModels() {
    return this.sendRequest("model/list", {});
  }

  async sendRequest(method, params) {
    const id = createRequestId();
    const payload = JSON.stringify({ id, method, params });
    let rejectPending = null;

    const responsePromise = new Promise((resolve, reject) => {
      rejectPending = reject;
      this.pending.set(id, { resolve, reject });
    });

    logCodexOutboundMessage(this.verboseLogs, `request:${method}`, payload);
    try {
      await this.sendRaw(payload);
    } catch (error) {
      this.pending.delete(id);
      if (rejectPending) {
        rejectPending(error);
      }
      throw error;
    }
    return responsePromise;
  }

  async sendNotification(method, params) {
    const payload = JSON.stringify({ method, params });
    logCodexOutboundMessage(this.verboseLogs, `notification:${method}`, payload);
    await this.sendRaw(payload);
  }

  async sendResponse(id, result) {
    const payload = JSON.stringify({ id, result });
    logCodexOutboundMessage(this.verboseLogs, "response", payload);
    await this.sendRaw(payload);
  }

  async sendRaw(payload) {
    if (this.mode === "websocket") {
      if (!this.socket || this.socket.readyState !== this.webSocketImpl.OPEN) {
        throw new Error("Codex websocket is not connected");
      }
      this.socket.send(payload);
      return;
    }

    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Codex process stdin is not writable");
    }
    await writePayloadToWritable(this.child.stdin, `${payload}\n`);
  }

  handleIncoming(rawMessage) {
    if (this.isClosing) {
      return;
    }
    const parsed = tryParseJson(rawMessage);
    if (!parsed) {
      logCodexParseFailure(this.verboseLogs, rawMessage);
      return;
    }
    logCodexInboundMessage(this.verboseLogs, parsed);

    if (parsed && parsed.id != null && this.pending.has(String(parsed.id))) {
      const { resolve, reject } = this.pending.get(String(parsed.id));
      this.pending.delete(String(parsed.id));
      if (parsed.error) {
        reject(new Error(parsed.error.message || "Codex RPC request failed"));
        return;
      }
      resolve(parsed);
      return;
    }

    for (const listener of this.messageListeners) {
      listener(parsed);
    }
  }

  async close() {
    this.isClosing = true;
    this.isReady = false;
    this.stdoutBuffer = "";

    if (this.socket) {
      try {
        this.socket.removeAllListeners?.();
        this.socket.close?.();
      } catch {
        // best effort
      }
      this.socket = null;
    }

    if (this.child) {
      try {
        this.child.removeAllListeners?.();
        if (!this.child.killed) {
          this.child.kill?.();
        }
      } catch {
        // best effort
      }
      this.child = null;
    }

    this.rejectAllPending(new Error("Codex client closed"));
  }

  rejectAllPending(error) {
    if (!this.pending.size) {
      return;
    }
    const pendingEntries = Array.from(this.pending.values());
    this.pending.clear();
    for (const { reject } of pendingEntries) {
      reject(error);
    }
  }

  reportTransportFailure(error, message) {
    if (this.hasReportedTransportFailure) {
      this.rejectAllPending(error);
      return;
    }
    this.hasReportedTransportFailure = true;
    console.error(message);
    this.rejectAllPending(error);
  }
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tryParseJson(rawMessage) {
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

function logCodexOutboundMessage(enabled, operation, payload) {
  if (!enabled) {
    return;
  }
  try {
    console.log(`[codex-im] codex=> op=${operation} ${payload}`);
  } catch {
    console.log(`[codex-im] codex=> op=${operation} <unserializable payload>`);
  }
}

function logCodexInboundMessage(enabled, message) {
  if (!enabled) {
    return;
  }
  try {
    console.log(`[codex-im] codex<= ${JSON.stringify(message)}`);
  } catch {
    console.log("[codex-im] codex<= <unserializable message>");
  }
}

function logCodexParseFailure(enabled, rawMessage) {
  if (!enabled) {
    return;
  }
  const sample = String(rawMessage || "").slice(0, 300);
  console.warn(`[codex-im] codex<= [parse_failed] raw=${JSON.stringify(sample)}`);
}

function buildCodexCommandCandidates(configuredCommand) {
  return buildCodexCommandCandidatesWithPlatform(configuredCommand, {
    isWindows: IS_WINDOWS,
    isMacos: IS_MACOS,
  });
}

function buildCodexCommandCandidatesWithPlatform(
  configuredCommand,
  {
    isWindows = IS_WINDOWS,
    isMacos = IS_MACOS,
    macosAppCandidates = MACOS_CODEX_APP_CANDIDATES,
  } = {}
) {
  const explicit = normalizeNonEmptyString(configuredCommand);
  if (explicit) {
    if (!isWindows) {
      return [explicit];
    }

    const candidates = [explicit];
    if (!WINDOWS_EXECUTABLE_SUFFIX_RE.test(explicit)) {
      candidates.push(`${explicit}.cmd`, `${explicit}.exe`, `${explicit}.bat`);
    }
    return [...new Set(candidates)];
  }

  if (isWindows) {
    return [DEFAULT_CODEX_COMMAND, `${DEFAULT_CODEX_COMMAND}.cmd`, `${DEFAULT_CODEX_COMMAND}.exe`, `${DEFAULT_CODEX_COMMAND}.bat`];
  }

  if (isMacos) {
    return [DEFAULT_CODEX_COMMAND, ...macosAppCandidates];
  }

  return [DEFAULT_CODEX_COMMAND];
}

function buildSpawnSpec(command) {
  return buildSpawnSpecWithPlatform(command, { isWindows: IS_WINDOWS });
}

function buildSpawnSpecWithPlatform(command, { isWindows = IS_WINDOWS } = {}) {
  if (isWindows) {
    return {
      command: "cmd.exe",
      args: ["/c", command, "app-server"],
    };
  }

  return {
    command,
    args: ["app-server"],
  };
}

function isSpawnCandidateError(error) {
  return error?.code === "ENOENT" || error?.code === "EINVAL";
}

function spawnCodexProcess(spawnImpl, spawnSpec, env) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(spawnSpec.command, spawnSpec.args, {
        env: { ...env },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const cleanup = () => {
      child?.removeListener("spawn", handleSpawn);
      child?.removeListener("error", handleError);
    };

    const handleSpawn = () => {
      cleanup();
      resolve(child);
    };

    const handleError = (error) => {
      cleanup();
      reject(error);
    };

    child.once("spawn", handleSpawn);
    child.once("error", handleError);
  });
}

function writePayloadToWritable(writable, payload) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onDrain = () => {
      cleanup();
      resolve();
    };

    const cleanup = () => {
      writable?.removeListener("error", onError);
      writable?.removeListener("drain", onDrain);
    };

    writable.once("error", onError);

    let canContinue = false;
    try {
      canContinue = writable.write(payload, (error) => {
        if (error) {
          cleanup();
          reject(error);
        }
      });
    } catch (error) {
      cleanup();
      reject(error);
      return;
    }

    if (canContinue) {
      cleanup();
      resolve();
      return;
    }

    writable.once("drain", onDrain);
  });
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildStartThreadParams(cwd) {
  const normalizedCwd = normalizeNonEmptyString(cwd);
  return normalizedCwd ? { cwd: normalizedCwd } : {};
}

function buildListThreadsParams({ cursor, limit, sortKey }) {
  const params = { limit, sortKey };
  const normalizedCursor = normalizeNonEmptyString(cursor);

  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  } else if (cursor != null) {
    params.cursor = cursor;
  }

  return params;
}

function buildTurnInputPayload(text) {
  const normalizedText = normalizeNonEmptyString(text);
  const items = [];

  if (normalizedText) {
    items.push({
      type: "text",
      text: normalizedText,
    });
  }

  return items;
}

function buildTurnStartParams({ threadId, input, model, effort, accessMode, workspaceRoot }) {
  const params = { threadId, input };
  const normalizedModel = normalizeNonEmptyString(model);
  const normalizedEffort = normalizeNonEmptyString(effort);
  const normalizedAccessMode = normalizeAccessMode(accessMode);
  const executionPolicies = buildExecutionPolicies(normalizedAccessMode, workspaceRoot);
  if (normalizedModel) {
    params.model = normalizedModel;
  }
  if (normalizedEffort) {
    params.effort = normalizedEffort;
  }
  if (normalizedAccessMode) {
    params.accessMode = normalizedAccessMode;
  }
  params.approvalPolicy = executionPolicies.approvalPolicy;
  params.sandboxPolicy = executionPolicies.sandboxPolicy;
  return params;
}

function normalizeAccessMode(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "default") {
    return "current";
  }
  return normalized === "full-access" ? normalized : "";
}

function buildExecutionPolicies(accessMode, workspaceRoot) {
  if (accessMode === "full-access") {
    return {
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  const normalizedWorkspaceRoot = normalizeNonEmptyString(workspaceRoot);
  const sandboxPolicy = normalizedWorkspaceRoot
    ? {
      type: "workspaceWrite",
      writableRoots: [normalizedWorkspaceRoot],
      networkAccess: true,
    }
    : {
      type: "workspaceWrite",
      networkAccess: true,
    };
  return {
    approvalPolicy: "on-request",
    sandboxPolicy,
  };
}

module.exports = {
  CodexRpcClient,
  buildCodexCommandCandidates,
  buildCodexCommandCandidatesWithPlatform,
  buildSpawnSpec,
  buildSpawnSpecWithPlatform,
  isSpawnCandidateError,
  spawnCodexProcess,
  writePayloadToWritable,
};
