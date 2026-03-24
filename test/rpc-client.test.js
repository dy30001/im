const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  CodexRpcClient,
  buildCodexCommandCandidatesWithPlatform,
  spawnCodexProcess,
  writePayloadToWritable,
} = require("../src/infra/codex/rpc-client");

test("buildCodexCommandCandidatesWithPlatform keeps Windows fallbacks", () => {
  assert.deepEqual(
    buildCodexCommandCandidatesWithPlatform("codex", { isWindows: true }),
    ["codex", "codex.cmd", "codex.exe", "codex.bat"]
  );
});

test("buildCodexCommandCandidatesWithPlatform includes Codex.app fallback paths on macOS", () => {
  assert.deepEqual(
    buildCodexCommandCandidatesWithPlatform("", {
      isWindows: false,
      isMacos: true,
      macosAppCandidates: ["/Applications/Codex.app/Contents/Resources/codex"],
    }),
    ["codex", "/Applications/Codex.app/Contents/Resources/codex"]
  );
});

test("CodexRpcClient keeps codexCommand empty when no override is configured", () => {
  const client = new CodexRpcClient({
    endpoint: "",
    env: {},
    codexCommand: "",
    spawnImpl: () => {
      throw new Error("spawn should not be used in this test");
    },
    webSocketImpl: class FakeWebSocket {},
  });

  assert.equal(client.codexCommand, "");
});

test("writePayloadToWritable waits for drain when the stream back-pressures", async () => {
  class FakeWritable extends EventEmitter {
    constructor() {
      super();
      this.chunks = [];
      this.calls = 0;
    }

    write(chunk, callback) {
      this.calls += 1;
      this.chunks.push(chunk);
      if (typeof callback === "function") {
        callback(null);
      }
      if (this.calls === 1) {
        setImmediate(() => {
          this.emit("drain");
        });
        return false;
      }
      return true;
    }
  }

  const writable = new FakeWritable();
  const writePromise = writePayloadToWritable(writable, "payload\n");
  let settled = false;
  writePromise.then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);

  await writePromise;
  assert.equal(settled, true);
  assert.deepEqual(writable.chunks, ["payload\n"]);
});

test("spawnCodexProcess rejects when the child process emits an error", async () => {
  const child = new EventEmitter();
  const fakeSpawn = () => {
    setImmediate(() => {
      const error = new Error("spawn failed");
      error.code = "ENOENT";
      child.emit("error", error);
    });
    return child;
  };

  await assert.rejects(
    spawnCodexProcess(fakeSpawn, { command: "codex", args: ["app-server"] }, {}),
    /spawn failed/
  );
});

test("CodexRpcClient.close rejects pending requests and closes transports", async () => {
  const client = new CodexRpcClient({
    endpoint: "",
    spawnImpl: () => {
      throw new Error("spawn should not be used in this test");
    },
    webSocketImpl: class FakeWebSocket {},
  });

  const child = new EventEmitter();
  child.stdin = {
    writable: true,
    write: () => true,
  };
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  client.child = child;

  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.closeCalled = false;
  socket.close = () => {
    socket.closeCalled = true;
  };
  client.socket = socket;

  const pendingPromise = new Promise((resolve, reject) => {
    client.pending.set("req-1", { resolve, reject });
  });
  const rejectionAssertion = assert.rejects(pendingPromise, /Codex client closed/);

  await client.close();
  await rejectionAssertion;

  assert.equal(child.killed, true);
  assert.equal(socket.closeCalled, true);
});
