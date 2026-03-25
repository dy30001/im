const {
  isOpenClawCredentialError,
} = require("../infra/openclaw/client-adapter");
const { loginWithQr, openQrInBrowser } = require("../infra/openclaw/qr-login");
const {
  loadOpenClawCredentials,
  saveOpenClawCredentials,
} = require("../infra/openclaw/token-store");

function applyOpenClawCredentials(runtime, { token, baseUrl }) {
  const resolvedToken = String(token || "").trim();
  const resolvedBaseUrl = String(baseUrl || runtime.config.openclaw.baseUrl || "").trim();
  runtime.config.openclaw.token = resolvedToken;
  runtime.config.openclaw.baseUrl = resolvedBaseUrl;
  runtime.openclawAdapter.setCredentials({
    token: resolvedToken,
    baseUrl: resolvedBaseUrl,
  });
}

async function ensureOpenClawCredentials(runtime) {
  const storedCredentials = loadOpenClawCredentials(runtime.config.openclaw.credentialsFile);
  const resolvedToken = String(runtime.config.openclaw.token || "").trim() || storedCredentials?.token || "";
  const resolvedBaseUrl = runtime.config.openclaw.baseUrlExplicit
    ? String(runtime.config.openclaw.baseUrl || "").trim()
    : (storedCredentials?.baseUrl || String(runtime.config.openclaw.baseUrl || "").trim());

  if (resolvedToken) {
    applyOpenClawCredentials(runtime, {
      token: resolvedToken,
      baseUrl: resolvedBaseUrl,
    });
    return;
  }

  console.log("[codex-im] no OpenClaw token found, starting Weixin QR login");
  let lastStatus = "";
  const loginResult = await loginWithQr({
    baseUrl: resolvedBaseUrl,
    onQrCode: async ({ qrcodeUrl, refreshCount }) => {
      const actionText = refreshCount > 0 ? "二维码已刷新" : "二维码已就绪";
      console.log(`[codex-im] ${actionText}，请使用微信扫码`);
      const opened = await openQrInBrowser(qrcodeUrl);
      if (opened) {
        console.log("[codex-im] QR link opened in the default browser");
      }
      console.log(`[codex-im] QR URL: ${qrcodeUrl}`);
    },
    onStatus: (status) => {
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
  });
}

function reloadOpenClawCredentialsFromStore(runtime) {
  const storedCredentials = loadOpenClawCredentials(runtime.config.openclaw.credentialsFile);
  const storedToken = String(storedCredentials?.token || "").trim();
  const storedBaseUrl = String(storedCredentials?.baseUrl || runtime.config.openclaw.baseUrl || "").trim();
  if (!storedToken) {
    return false;
  }

  const currentToken = String(runtime.config.openclaw.token || "").trim();
  const currentBaseUrl = String(runtime.config.openclaw.baseUrl || "").trim();
  if (storedToken === currentToken && storedBaseUrl === currentBaseUrl) {
    return false;
  }

  runtime.syncCursor = "";
  applyOpenClawCredentials(runtime, {
    token: storedToken,
    baseUrl: storedBaseUrl,
  });
  console.warn("[codex-im] reloaded OpenClaw credentials from the local credentials file");
  return true;
}

async function tryRecoverFromPollError(runtime, error) {
  if (!isOpenClawCredentialError(error)) {
    return false;
  }

  if (reloadOpenClawCredentialsFromStore(runtime)) {
    return true;
  }

  console.error(
    "[codex-im] OpenClaw credentials may have expired. Run `codex-im openclaw-bot` and complete Weixin QR login again."
  );
  return false;
}

module.exports = {
  applyOpenClawCredentials,
  ensureOpenClawCredentials,
  reloadOpenClawCredentialsFromStore,
  tryRecoverFromPollError,
};
