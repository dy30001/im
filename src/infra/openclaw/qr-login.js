const { spawn } = require("node:child_process");

const DEFAULT_ILINK_BOT_TYPE = "3";
const DEFAULT_QR_LOGIN_TIMEOUT_MS = 8 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_QR_REFRESH_COUNT = 3;

async function loginWithQr({
  baseUrl,
  botType = DEFAULT_ILINK_BOT_TYPE,
  timeoutMs = DEFAULT_QR_LOGIN_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  onQrCode = () => {},
  onStatus = () => {},
  maxRefreshCount = MAX_QR_REFRESH_COUNT,
} = {}) {
  const normalizedBaseUrl = ensureTrailingSlash(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("OpenClaw QR login requires a base URL");
  }

  let refreshCount = 0;
  let qrPayload = await fetchQrCode({ baseUrl: normalizedBaseUrl, botType, fetchImpl });
  await onQrCode({ ...qrPayload, refreshCount });

  const deadline = Date.now() + Math.max(Number(timeoutMs) || 0, 1_000);
  while (Date.now() < deadline) {
    const status = await pollQrStatus({
      baseUrl: normalizedBaseUrl,
      qrcode: qrPayload.qrcode,
      fetchImpl,
    });
    await onStatus(status.status || "wait");

    if (status.status === "confirmed" && status.botToken) {
      return {
        token: status.botToken,
        accountId: status.accountId,
        userId: status.userId,
        baseUrl: ensureTrailingSlash(status.baseUrl) || normalizedBaseUrl,
      };
    }

    if (status.status === "expired") {
      refreshCount += 1;
      if (refreshCount > maxRefreshCount) {
        throw new Error("二维码已多次过期，请重新启动登录流程");
      }
      qrPayload = await fetchQrCode({ baseUrl: normalizedBaseUrl, botType, fetchImpl });
      await onQrCode({ ...qrPayload, refreshCount });
    }
  }

  throw new Error("扫码登录超时，请重试");
}

async function fetchQrCode({ baseUrl, botType = DEFAULT_ILINK_BOT_TYPE, fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(String(botType || DEFAULT_ILINK_BOT_TYPE))}`,
    ensureTrailingSlash(baseUrl)
  );
  const response = await fetchImpl(url.toString());
  if (!response?.ok) {
    throw new Error(`Failed to fetch QR code: ${response?.status || "unknown"}`);
  }

  const payload = await response.json();
  const qrcode = normalizeText(payload?.qrcode);
  const qrcodeUrl = normalizeText(payload?.qrcode_img_content);
  if (!qrcode || !qrcodeUrl) {
    throw new Error("QR code response is missing qrcode or qrcode_img_content");
  }
  return { qrcode, qrcodeUrl };
}

async function pollQrStatus({ baseUrl, qrcode, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const url = new URL(
      `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(String(qrcode || "").trim())}`,
      ensureTrailingSlash(baseUrl)
    );
    const response = await fetchImpl(url.toString(), {
      headers: {
        "iLink-App-ClientVersion": "1",
      },
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new Error(`Failed to poll QR status: ${response?.status || "unknown"}`);
    }

    const payload = await response.json();
    return {
      status: normalizeStatus(payload?.status),
      botToken: normalizeText(payload?.bot_token),
      accountId: normalizeText(payload?.ilink_bot_id),
      userId: normalizeText(payload?.ilink_user_id),
      baseUrl: normalizeText(payload?.baseurl),
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { status: "wait", botToken: "", accountId: "", userId: "", baseUrl: "" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function openQrInBrowser(qrcodeUrl, { platform = process.platform, spawnImpl = spawn } = {}) {
  const normalizedUrl = normalizeText(qrcodeUrl);
  if (!normalizedUrl) {
    return false;
  }

  const { command, args } = resolveBrowserOpenCommand(platform, normalizedUrl);
  if (!command) {
    return false;
  }

  try {
    const child = spawnImpl(command, args, {
      detached: platform !== "win32",
      stdio: "ignore",
    });
    if (typeof child?.unref === "function") {
      child.unref();
    }
    return true;
  } catch {
    return false;
  }
}

function resolveBrowserOpenCommand(platform, qrcodeUrl) {
  if (platform === "darwin") {
    return { command: "open", args: [qrcodeUrl] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", qrcodeUrl] };
  }
  if (platform === "linux") {
    return { command: "xdg-open", args: [qrcodeUrl] };
  }
  return { command: "", args: [] };
}

function ensureTrailingSlash(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value) {
  const normalized = normalizeText(value);
  return normalized || "wait";
}

module.exports = {
  DEFAULT_ILINK_BOT_TYPE,
  DEFAULT_QR_LOGIN_TIMEOUT_MS,
  fetchQrCode,
  loginWithQr,
  openQrInBrowser,
  pollQrStatus,
};
