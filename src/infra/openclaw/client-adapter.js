const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const CHANNEL_VERSION = readChannelVersion();

class OpenClawClientAdapter {
  constructor({
    baseUrl,
    token = "",
    wechatUin = "",
    fetchImpl = globalThis.fetch,
    verboseLogs = false,
  } = {}) {
    this.baseUrl = ensureTrailingSlash(String(baseUrl || "").trim());
    this.token = String(token || "").trim();
    this.wechatUin = String(wechatUin || "").trim();
    this.fetchImpl = fetchImpl;
    this.verboseLogs = Boolean(verboseLogs);
  }

  setCredentials({ baseUrl = this.baseUrl, token = this.token, wechatUin = this.wechatUin } = {}) {
    this.baseUrl = ensureTrailingSlash(String(baseUrl || "").trim());
    this.token = String(token || "").trim();
    this.wechatUin = String(wechatUin || "").trim();
  }

  async getUpdates({ cursor = "", timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS, signal } = {}) {
    return postJson({
      baseUrl: this.baseUrl,
      endpoint: "ilink/bot/getupdates",
      token: this.token,
      wechatUin: this.wechatUin,
      timeoutMs,
      fetchImpl: this.fetchImpl,
      signal,
      verboseLogs: this.verboseLogs,
      body: {
        get_updates_buf: cursor,
        base_info: buildBaseInfo(),
      },
      label: "getUpdates",
      swallowAbort: true,
      fallbackValue: {
        ret: 0,
        msgs: [],
        get_updates_buf: cursor,
      },
    });
  }

  async sendTextMessage({
    toUserId,
    fromUserId = "",
    text,
    contextToken = "",
    timeoutMs = 15_000,
    signal,
  } = {}) {
    const normalizedText = String(text || "").trim();
    const normalizedToUserId = String(toUserId || "").trim();
    const normalizedFromUserId = String(fromUserId || "").trim();
    const normalizedContextToken = String(contextToken || "").trim();
    if (!String(toUserId || "").trim() || !normalizedText) {
      return null;
    }

    return postJson({
      baseUrl: this.baseUrl,
      endpoint: "ilink/bot/sendmessage",
      token: this.token,
      wechatUin: this.wechatUin,
      timeoutMs,
      fetchImpl: this.fetchImpl,
      signal,
      verboseLogs: this.verboseLogs,
      body: {
        msg: {
          from_user_id: normalizedFromUserId,
          to_user_id: normalizedToUserId,
          client_id: buildClientId(),
          message_type: 2,
          message_state: 2,
          context_token: normalizedContextToken || undefined,
          item_list: [
            {
              type: 1,
              text_item: {
                text: normalizedText,
              },
            },
          ],
        },
        base_info: buildBaseInfo(),
      },
      label: "sendMessage",
    });
  }

}

function buildBaseInfo() {
  return {
    channel_version: CHANNEL_VERSION,
  };
}

async function postJson({
  baseUrl,
  endpoint,
  token,
  wechatUin,
  timeoutMs,
  fetchImpl,
  signal,
  body,
  label,
  verboseLogs = false,
  swallowAbort = false,
  fallbackValue = null,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("OpenClaw fetch implementation is unavailable");
  }
  if (!baseUrl) {
    throw new Error("OpenClaw base URL is required");
  }

  const url = new URL(endpoint, baseUrl);
  const bodyText = JSON.stringify(body);
  const controller = new AbortController();
  const abortHandler = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (verboseLogs) {
      console.log(
        `[codex-im] openclaw=> ${label} ${url.pathname} ${summarizeRequestBody(body)}`
      );
    }
    const response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: buildHeaders({ token, wechatUin, bodyText }),
      body: bodyText,
      signal: controller.signal,
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`${label} ${response.status}: ${rawText}`);
    }
    const parsed = rawText && rawText.trim() ? JSON.parse(rawText) : null;
    const apiError = buildApiError(parsed, label);
    if (apiError) {
      throw apiError;
    }
    if (verboseLogs) {
      console.log(`[codex-im] openclaw<= ${label} ${summarizeResponseBody(parsed)}`);
    }
    return parsed;
  } catch (error) {
    if (swallowAbort && error?.name === "AbortError") {
      return fallbackValue;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

function buildHeaders({ token, wechatUin, bodyText }) {
  const headers = {
    ...buildAuthHeaders({ token, wechatUin }),
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(bodyText, "utf8")),
  };
  return headers;
}

function buildAuthHeaders({ token, wechatUin }) {
  const headers = {
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": buildWechatUin({ token, wechatUin }),
  };
  if (String(token || "").trim()) {
    headers.Authorization = `Bearer ${String(token).trim()}`;
  }
  return headers;
}

function buildClientId() {
  return `openclaw-weixin:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function readChannelVersion() {
  try {
    const packagePath = path.resolve(__dirname, "../../../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return typeof packageJson?.version === "string" && packageJson.version.trim()
      ? packageJson.version.trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

function buildApiError(payload, label) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const retCode = Number(payload.ret);
  const errCode = Number(payload.errcode);
  const resolvedCode = Number.isFinite(errCode)
    ? errCode
    : (Number.isFinite(retCode) ? retCode : null);
  if (resolvedCode == null || resolvedCode === 0) {
    return null;
  }

  const errmsg = typeof payload.errmsg === "string" && payload.errmsg.trim()
    ? payload.errmsg.trim()
    : "unknown error";
  return new Error(`${label} errcode=${resolvedCode}: ${errmsg}`);
}

function isOpenClawCredentialError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message) {
    return false;
  }
  return (
    message.includes("errcode=-14")
    || message.includes("session timeout")
    || message.includes("invalid token")
    || message.includes("unauthorized")
    || message.includes("token expired")
  );
}

function summarizeRequestBody(body) {
  if (!body || typeof body !== "object") {
    return "<empty>";
  }

  if (typeof body.get_updates_buf === "string") {
    return `cursor=${maskValue(body.get_updates_buf)}`;
  }

  const msg = body.msg;
  if (msg && typeof msg === "object") {
    const itemCount = Array.isArray(msg.item_list) ? msg.item_list.length : 0;
    return `to=${maskValue(msg.to_user_id)} context=${maskValue(msg.context_token)} items=${itemCount}`;
  }

  return "<object>";
}

function summarizeResponseBody(body) {
  if (!body || typeof body !== "object") {
    return "<empty>";
  }

  if (Array.isArray(body.msgs)) {
    return `msgs=${body.msgs.length} cursor=${maskValue(body.get_updates_buf || body.sync_buf || "")}`;
  }

  if (Number.isFinite(body.ret) || body.errmsg) {
    return `ret=${body.ret ?? "-"} errcode=${body.errcode ?? "-"} errmsg=${body.errmsg || "-"}`;
  }

  return "<object>";
}

function maskValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= 10) {
    return normalized;
  }
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function buildWechatUin({ token, wechatUin } = {}) {
  const normalizedWechatUin = String(wechatUin || "").trim();
  if (normalizedWechatUin) {
    return normalizedWechatUin;
  }

  const normalizedToken = String(token || "").trim() || "codex-im";
  return Buffer.from(normalizedToken, "utf8").toString("base64");
}

function ensureTrailingSlash(value) {
  if (!value) {
    return "";
  }
  return value.endsWith("/") ? value : `${value}/`;
}

module.exports = {
  DEFAULT_LONG_POLL_TIMEOUT_MS,
  OpenClawClientAdapter,
  isOpenClawCredentialError,
};
