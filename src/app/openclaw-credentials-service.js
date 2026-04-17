const {
  isOpenClawCredentialError,
} = require("../infra/openclaw/client-adapter");
const { loginWithQr, openQrInBrowser } = require("../infra/openclaw/qr-login");
const {
  loadOpenClawCredentials,
  saveOpenClawCredentials,
} = require("../infra/openclaw/token-store");

const QR_RECOVERY_COOLDOWN_MS = 5 * 60 * 1_000;

function applyOpenClawCredentials(runtime, { token, baseUrl, accountId, userId } = {}) {
  const resolvedToken = String(token || "").trim();
  const resolvedBaseUrl = String(baseUrl || runtime.config.openclaw.baseUrl || "").trim();
  const resolvedAccountId = String(accountId || runtime.config.openclaw.accountId || "").trim();
  const resolvedUserId = String(userId || runtime.config.openclaw.userId || "").trim();
  const resolvedWechatUin = buildWechatUin({
    accountId: resolvedAccountId,
    userId: resolvedUserId,
    token: resolvedToken,
  });
  runtime.config.openclaw.token = resolvedToken;
  runtime.config.openclaw.baseUrl = resolvedBaseUrl;
  runtime.config.openclaw.accountId = resolvedAccountId;
  runtime.config.openclaw.userId = resolvedUserId;
  runtime.config.openclaw.wechatUin = resolvedWechatUin;
  runtime.openclawAdapter.setCredentials({
    token: resolvedToken,
    baseUrl: resolvedBaseUrl,
    wechatUin: resolvedWechatUin,
  });
}

async function ensureOpenClawCredentials(runtime, { forceRefresh = false } = {}) {
  const storedCredentials = loadOpenClawCredentials(runtime.config.openclaw.credentialsFile);
  const resolvedToken = forceRefresh
    ? ""
    : String(runtime.config.openclaw.token || "").trim() || storedCredentials?.token || "";
  const resolvedBaseUrl = runtime.config.openclaw.baseUrlExplicit
    ? String(runtime.config.openclaw.baseUrl || "").trim()
    : (storedCredentials?.baseUrl || String(runtime.config.openclaw.baseUrl || "").trim());
  const resolvedAccountId = String(storedCredentials?.accountId || runtime.config.openclaw.accountId || "").trim();
  const resolvedUserId = String(storedCredentials?.userId || runtime.config.openclaw.userId || "").trim();

  if (resolvedToken) {
    applyOpenClawCredentials(runtime, {
      token: resolvedToken,
      baseUrl: resolvedBaseUrl,
      accountId: resolvedAccountId,
      userId: resolvedUserId,
    });
    return;
  }

  console.log(forceRefresh
    ? "[codex-im] OpenClaw credentials expired, starting Weixin QR re-login"
    : "[codex-im] no OpenClaw token found, starting Weixin QR login");
  await markOpenClawCredentialHeartbeat(runtime, forceRefresh ? "qr-relogin-start" : "qr-login-start");
  let lastStatus = "";
  const loginResult = await loginWithQr({
    baseUrl: resolvedBaseUrl,
    onQrCode: async ({ qrcodeUrl, refreshCount }) => {
      await markOpenClawCredentialHeartbeat(runtime, refreshCount > 0 ? "qr-login-refresh" : "qr-login-ready");
      const actionText = refreshCount > 0 ? "二维码已刷新" : "二维码已就绪";
      console.log(`[codex-im] ${actionText}，请使用微信扫码`);
      await maybeOpenQrInBrowser(qrcodeUrl, { refreshCount });
      console.log(`[codex-im] QR URL: ${qrcodeUrl}`);
    },
    onStatus: async (status) => {
      await markOpenClawCredentialHeartbeat(runtime, `qr-login-${String(status || "wait").trim() || "wait"}`);
      if (!status || status === lastStatus) {
        return;
      }
      lastStatus = status;
      if (status === "scaned") {
        console.log("[codex-im] QR scanned, confirm the login in Weixin");
      } else if (status === "confirmed") {
        console.log("[codex-im] QR login confirmed");
      } else if (status === "expired") {
        console.log("[codex-im] QR expired, refreshing");
      }
    },
  });

  saveOpenClawCredentials(runtime.config.openclaw.credentialsFile, {
    token: loginResult.token,
    baseUrl: loginResult.baseUrl,
    accountId: loginResult.accountId,
    userId: loginResult.userId,
  });
  applyOpenClawCredentials(runtime, {
    token: loginResult.token,
    baseUrl: loginResult.baseUrl,
    accountId: loginResult.accountId,
    userId: loginResult.userId,
  });
}

function reloadOpenClawCredentialsFromStore(runtime) {
  const storedCredentials = loadOpenClawCredentials(runtime.config.openclaw.credentialsFile);
  const storedToken = String(storedCredentials?.token || "").trim();
  const storedBaseUrl = String(storedCredentials?.baseUrl || runtime.config.openclaw.baseUrl || "").trim();
  const storedAccountId = String(storedCredentials?.accountId || "").trim();
  const storedUserId = String(storedCredentials?.userId || "").trim();
  if (!storedToken) {
    return false;
  }

  const currentToken = String(runtime.config.openclaw.token || "").trim();
  const currentBaseUrl = String(runtime.config.openclaw.baseUrl || "").trim();
  const currentAccountId = String(runtime.config.openclaw.accountId || "").trim();
  const currentUserId = String(runtime.config.openclaw.userId || "").trim();
  const comparisonAccountId = storedAccountId || currentAccountId;
  const comparisonUserId = storedUserId || currentUserId;
  if (
    storedToken === currentToken
    && storedBaseUrl === currentBaseUrl
    && comparisonAccountId === currentAccountId
    && comparisonUserId === currentUserId
  ) {
    return false;
  }

  runtime.syncCursor = "";
  applyOpenClawCredentials(runtime, {
    token: storedToken,
    baseUrl: storedBaseUrl,
    accountId: storedAccountId,
    userId: storedUserId,
  });
  console.warn("[codex-im] reloaded OpenClaw credentials from the local credentials file");
  return true;
}

async function tryRecoverFromPollError(runtime, error) {
  if (!isOpenClawCredentialError(error)) {
    return false;
  }

  return withOpenClawCredentialRecovery(runtime, async () => {
    if (reloadOpenClawCredentialsFromStore(runtime)) {
      return true;
    }

    if (hasExplicitOpenClawEnvToken()) {
      console.error(
        "[codex-im] OpenClaw credentials may have expired, but CODEX_IM_OPENCLAW_TOKEN is set explicitly. "
        + "Update or clear that env value before retrying."
      );
      return false;
    }

    if (isOpenClawQrRecoveryCoolingDown(runtime)) {
      logOpenClawQrRecoveryCooldown(runtime);
      return false;
    }

    runtime._openclawLastQrRecoveryAttemptAt = Date.now();
    try {
      await runtime.ensureOpenClawCredentials({ forceRefresh: true });
      runtime.syncCursor = "";
      runtime._openclawLastQrRecoveryAttemptAt = 0;
      console.warn("[codex-im] refreshed OpenClaw credentials via Weixin QR login");
      return true;
    } catch (loginError) {
      console.error(`[codex-im] failed to refresh OpenClaw credentials via Weixin QR login: ${loginError.message}`);
      return false;
    }
  });
}

module.exports = {
  applyOpenClawCredentials,
  ensureOpenClawCredentials,
  markOpenClawCredentialHeartbeat,
  maybeOpenQrInBrowser,
  reloadOpenClawCredentialsFromStore,
  tryRecoverFromPollError,
};

function buildWechatUin({ accountId = "", userId = "", token = "" } = {}) {
  const seed = String(accountId || userId || token || "").trim();
  if (!seed) {
    return "";
  }
  return Buffer.from(seed, "utf8").toString("base64");
}

async function withOpenClawCredentialRecovery(runtime, action) {
  if (runtime?._openclawCredentialRecoveryPromise) {
    return runtime._openclawCredentialRecoveryPromise;
  }

  const recoveryPromise = (async () => action())();
  runtime._openclawCredentialRecoveryPromise = recoveryPromise;
  try {
    return await recoveryPromise;
  } finally {
    if (runtime._openclawCredentialRecoveryPromise === recoveryPromise) {
      runtime._openclawCredentialRecoveryPromise = null;
    }
  }
}

function hasExplicitOpenClawEnvToken() {
  return Boolean(String(process.env.CODEX_IM_OPENCLAW_TOKEN || "").trim());
}

function isOpenClawQrRecoveryCoolingDown(runtime) {
  const lastAttemptAt = Number(runtime?._openclawLastQrRecoveryAttemptAt || 0);
  if (!Number.isFinite(lastAttemptAt) || lastAttemptAt <= 0) {
    return false;
  }
  return (Date.now() - lastAttemptAt) < QR_RECOVERY_COOLDOWN_MS;
}

function logOpenClawQrRecoveryCooldown(runtime) {
  const now = Date.now();
  const lastLoggedAt = Number(runtime?._openclawLastQrRecoveryCooldownLogAt || 0);
  if (Number.isFinite(lastLoggedAt) && lastLoggedAt > 0 && (now - lastLoggedAt) < QR_RECOVERY_COOLDOWN_MS) {
    return;
  }
  runtime._openclawLastQrRecoveryCooldownLogAt = now;
  console.error(
    "[codex-im] OpenClaw credentials may have expired. QR re-login was attempted recently; "
    + "skipping another automatic retry for now."
  );
}

async function maybeOpenQrInBrowser(qrcodeUrl, {
  refreshCount = 0,
  openBrowser = openQrInBrowser,
  logger = console,
} = {}) {
  if (Number(refreshCount) > 0) {
    logger.log("[codex-im] QR refreshed; keeping the new link in logs without reopening Weixin automatically");
    return false;
  }

  const opened = await openBrowser(qrcodeUrl);
  if (opened) {
    logger.log("[codex-im] QR link opened in the default browser");
  }
  return opened;
}

async function markOpenClawCredentialHeartbeat(runtime, reason = "qr-login") {
  if (typeof runtime?.markHeartbeat !== "function") {
    return;
  }

  try {
    await runtime.markHeartbeat(reason);
  } catch {
    // Heartbeat writes are best-effort during credential recovery.
  }
}
