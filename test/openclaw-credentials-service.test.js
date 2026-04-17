const assert = require("node:assert/strict");
const test = require("node:test");

const {
  markOpenClawCredentialHeartbeat,
  maybeOpenQrInBrowser,
} = require("../src/app/openclaw-credentials-service");

test("maybeOpenQrInBrowser opens the first QR link in the browser", async () => {
  const calls = [];
  const logs = [];

  const opened = await maybeOpenQrInBrowser("https://example.com/qr-1", {
    refreshCount: 0,
    openBrowser: async (url) => {
      calls.push(url);
      return true;
    },
    logger: {
      log: (message) => logs.push(message),
    },
  });

  assert.equal(opened, true);
  assert.deepEqual(calls, ["https://example.com/qr-1"]);
  assert.deepEqual(logs, [
    "[codex-im] QR link opened in the default browser",
  ]);
});

test("maybeOpenQrInBrowser skips reopening the browser after a QR refresh", async () => {
  const calls = [];
  const logs = [];

  const opened = await maybeOpenQrInBrowser("https://example.com/qr-2", {
    refreshCount: 1,
    openBrowser: async (url) => {
      calls.push(url);
      return true;
    },
    logger: {
      log: (message) => logs.push(message),
    },
  });

  assert.equal(opened, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(logs, [
    "[codex-im] QR refreshed; keeping the new link in logs without reopening Weixin automatically",
  ]);
});

test("markOpenClawCredentialHeartbeat forwards heartbeat writes when runtime supports it", async () => {
  const reasons = [];

  await markOpenClawCredentialHeartbeat({
    async markHeartbeat(reason) {
      reasons.push(reason);
    },
  }, "qr-login-wait");

  assert.deepEqual(reasons, ["qr-login-wait"]);
});

test("markOpenClawCredentialHeartbeat ignores runtimes without heartbeat support", async () => {
  await markOpenClawCredentialHeartbeat({}, "qr-login-wait");
  await markOpenClawCredentialHeartbeat(null, "qr-login-wait");
});
