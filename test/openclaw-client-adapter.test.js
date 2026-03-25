const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OpenClawClientAdapter,
  isOpenClawCredentialError,
} = require("../src/infra/openclaw/client-adapter");

test("OpenClawClientAdapter.getUpdates throws when API returns a session timeout", async () => {
  const adapter = new OpenClawClientAdapter({
    baseUrl: "https://ilinkai.weixin.qq.com",
    token: "token-1",
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          errcode: -14,
          errmsg: "session timeout",
        });
      },
    }),
  });

  await assert.rejects(
    adapter.getUpdates({ cursor: "" }),
    /getUpdates errcode=-14: session timeout/
  );
});

test("OpenClawClientAdapter.getUpdates still throws when API returns a non-timeout error", async () => {
  const adapter = new OpenClawClientAdapter({
    baseUrl: "https://ilinkai.weixin.qq.com",
    token: "token-1",
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          errcode: -2,
          errmsg: "temporary network error",
        });
      },
    }),
  });

  await assert.rejects(
    adapter.getUpdates({ cursor: "" }),
    /getUpdates errcode=-2: temporary network error/
  );
});

test("OpenClawClientAdapter.sendTextMessage aligns the payload with the Weixin plugin shape", async () => {
  let capturedBody = null;
  const adapter = new OpenClawClientAdapter({
    baseUrl: "https://ilinkai.weixin.qq.com",
    token: "token-1",
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(String(options?.body || "{}"));
      return {
        ok: true,
        async text() {
          return "{}";
        },
      };
    },
  });

  await adapter.sendTextMessage({
    toUserId: "wx-user-1",
    text: "hello",
    contextToken: "ctx-1",
  });

  assert.equal(capturedBody?.msg?.from_user_id, "");
  assert.equal(capturedBody?.msg?.to_user_id, "wx-user-1");
  assert.equal(typeof capturedBody?.msg?.client_id, "string");
  assert.match(capturedBody?.msg?.client_id, /^openclaw-weixin:\d+-[0-9a-f]{8}$/);
  assert.equal(capturedBody?.msg?.message_type, 2);
  assert.equal(capturedBody?.msg?.message_state, 2);
  assert.equal(capturedBody?.msg?.context_token, "ctx-1");
  assert.equal(typeof capturedBody?.base_info?.channel_version, "string");
  assert.notEqual(capturedBody?.base_info?.channel_version, "");
  assert.deepEqual(capturedBody?.msg?.item_list, [
    {
      type: 1,
      text_item: {
        text: "hello",
      },
    },
  ]);
});

test("isOpenClawCredentialError recognizes session timeout style failures", () => {
  assert.equal(isOpenClawCredentialError(new Error("getUpdates errcode=-14: session timeout")), true);
  assert.equal(isOpenClawCredentialError(new Error("sendMessage invalid token")), true);
  assert.equal(isOpenClawCredentialError(new Error("authorization failed: unauthorized")), true);
  assert.equal(isOpenClawCredentialError(new Error("getUpdates errcode=-2: temporary network error")), false);
});
