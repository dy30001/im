const { spawn } = require("child_process");
const WebSocket = require("ws");

class CodexRpcClient {
  constructor({ endpoint = "", env = process.env }) {
    this.endpoint = endpoint;
    this.env = env;
    this.mode = endpoint ? "websocket" : "spawn";
    this.socket = null;
    this.child = null;
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.isReady = false;
    this.messageListeners = new Set();
  }

  async connect() {
    if (this.mode === "websocket") {
      await this.connectWebSocket();
      return;
    }

    await this.connectSpawn();
  }

  async connectSpawn() {
    const child = spawn("codex", ["app-server"], {
      env: { ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

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

    child.on("close", (code) => {
      this.isReady = false;
      console.error(`[codex-im] codex app-server exited with code ${code}`);
    });
  }

  async connectWebSocket() {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.endpoint);
      this.socket = socket;

      socket.on("open", () => resolve());
      socket.on("error", (error) => reject(error));
      socket.on("message", (chunk) => {
        const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (message.trim()) {
          this.handleIncoming(message);
        }
      });
      socket.on("close", () => {
        this.isReady = false;
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
      clientInfo: {
        name: "codex_im_mac_agent",
        title: "Codex IM Mac Agent",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await this.sendNotification("initialized", null);
    this.isReady = true;
  }

  async sendUserMessage({ threadId, text }) {
    const input = buildTurnInputPayload(text);

    if (!threadId) {
      return this.sendRequest("thread/start", {
        input,
      });
    }

    return this.sendRequest("turn/start", {
      threadId,
      input,
    });
  }

  async startThread({ cwd }) {
    const params = {};
    if (typeof cwd === "string" && cwd.trim()) {
      params.cwd = cwd.trim();
    }
    return this.sendRequest("thread/start", params);
  }

  async resumeThread({ threadId }) {
    const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
    if (!normalizedThreadId) {
      throw new Error("thread/resume requires a non-empty threadId");
    }
    return this.sendRequest("thread/resume", {
      threadId: normalizedThreadId,
    });
  }

  async listThreads({ cursor = null, limit = 100, sortKey = "updated_at" } = {}) {
    return this.sendRequest("thread/list", {
      cursor,
      limit,
      sortKey,
      sourceKinds: [
        "cli",
        "vscode",
        "appServer",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "unknown",
      ],
    });
  }

  async sendRequest(method, params) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({ id, method, params });

    const responsePromise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.sendRaw(payload);
    return responsePromise;
  }

  async sendNotification(method, params) {
    this.sendRaw(JSON.stringify({ method, params }));
  }

  async sendResponse(id, result) {
    this.sendRaw(JSON.stringify({ id, result }));
  }

  async sendErrorResponse(id, code, message, data) {
    this.sendRaw(JSON.stringify({
      id,
      error: {
        code,
        message,
        data,
      },
    }));
  }

  sendRaw(payload) {
    if (this.mode === "websocket") {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error("Codex websocket is not connected");
      }
      this.socket.send(payload);
      return;
    }

    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Codex process stdin is not writable");
    }
    this.child.stdin.write(`${payload}\n`);
  }

  handleIncoming(rawMessage) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return;
    }

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
}

function buildTurnInputPayload(text) {
  const normalizedText = typeof text === "string" ? text.trim() : "";
  const items = [];

  if (normalizedText) {
    items.push({
      type: "text",
      text: normalizedText,
    });
  }

  return items;
}

module.exports = { CodexRpcClient };
