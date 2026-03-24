const assert = require("node:assert/strict");
const test = require("node:test");

const {
  loginWithQr,
  openQrInBrowser,
} = require("../src/infra/openclaw/qr-login");

test("loginWithQr returns credentials after QR confirmation", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("get_bot_qrcode")) {
      return createResponse({
        qrcode: "qr-1",
        qrcode_img_content: "https://example.com/qr-1",
      });
    }
    return createResponse({
      status: calls.filter((item) => item.includes("get_qrcode_status")).length > 1 ? "confirmed" : "wait",
      bot_token: "bot-token",
      ilink_bot_id: "account-1",
      ilink_user_id: "user-1",
      baseurl: "https://ilinkai.weixin.qq.com",
    });
  };

  const qrs = [];
  const statuses = [];
  const result = await loginWithQr({
    baseUrl: "https://ilinkai.weixin.qq.com",
    fetchImpl,
    onQrCode: (payload) => qrs.push(payload),
    onStatus: (status) => statuses.push(status),
    timeoutMs: 1_000,
  });

  assert.equal(result.token, "bot-token");
  assert.equal(result.accountId, "account-1");
  assert.equal(result.userId, "user-1");
  assert.equal(result.baseUrl, "https://ilinkai.weixin.qq.com/");
  assert.equal(qrs.length, 1);
  assert.equal(qrs[0].qrcodeUrl, "https://example.com/qr-1");
  assert.ok(statuses.includes("wait"));
  assert.ok(statuses.includes("confirmed"));
});

test("loginWithQr refreshes the QR code when it expires", async () => {
  let qrCounter = 0;
  let statusCounter = 0;
  const fetchImpl = async (url) => {
    if (url.includes("get_bot_qrcode")) {
      qrCounter += 1;
      return createResponse({
        qrcode: `qr-${qrCounter}`,
        qrcode_img_content: `https://example.com/qr-${qrCounter}`,
      });
    }

    statusCounter += 1;
    if (statusCounter === 1) {
      return createResponse({ status: "expired" });
    }
    return createResponse({
      status: "confirmed",
      bot_token: "bot-token",
      ilink_bot_id: "account-2",
      baseurl: "https://ilinkai.weixin.qq.com",
    });
  };

  const qrs = [];
  const result = await loginWithQr({
    baseUrl: "https://ilinkai.weixin.qq.com",
    fetchImpl,
    onQrCode: (payload) => qrs.push(payload),
    timeoutMs: 1_000,
  });

  assert.equal(result.accountId, "account-2");
  assert.equal(qrCounter, 2);
  assert.deepEqual(
    qrs.map((item) => item.qrcodeUrl),
    ["https://example.com/qr-1", "https://example.com/qr-2"]
  );
});

test("openQrInBrowser selects the platform-specific launcher", async () => {
  const invocations = [];
  const spawnImpl = (command, args) => {
    invocations.push([command, args]);
    return {
      unref() {},
      on() {},
    };
  };

  assert.equal(await openQrInBrowser("https://example.com/qr", { platform: "darwin", spawnImpl }), true);
  assert.equal(await openQrInBrowser("https://example.com/qr", { platform: "linux", spawnImpl }), true);
  assert.equal(await openQrInBrowser("https://example.com/qr", { platform: "win32", spawnImpl }), true);
  assert.deepEqual(invocations, [
    ["open", ["https://example.com/qr"]],
    ["xdg-open", ["https://example.com/qr"]],
    ["cmd", ["/c", "start", "", "https://example.com/qr"]],
  ]);
});

function createResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
