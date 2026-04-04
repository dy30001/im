const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CodexRpcClient,
  buildCodexCommandCandidatesWithPlatform,
  buildCodexNetworkProxyArgs,
  buildSpawnSpec,
  buildSpawnSpecWithPlatform,
  resolveCodexHome,
  resolveCodexSpawnCwd,
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

test("buildSpawnSpecWithPlatform forwards an explicit workspace cwd", () => {
  assert.deepEqual(
    buildSpawnSpecWithPlatform("codex", {
      isWindows: false,
      cwd: "/tmp/codex-im-workspaces/workspace-abc123",
    }),
    {
      command: "codex",
      args: ["--cd", "/tmp/codex-im-workspaces/workspace-abc123", "app-server"],
    }
  );
});

test("buildCodexNetworkProxyArgs prefers explicit proxy env values", () => {
  assert.deepEqual(
    buildCodexNetworkProxyArgs({
      HTTPS_PROXY: "http://127.0.0.1:7897",
    }),
    ["-c", "network.proxy_url=http://127.0.0.1:7897"]
  );
  assert.deepEqual(
    buildCodexNetworkProxyArgs({
      ALL_PROXY: "socks5://127.0.0.1:7897",
    }),
    ["-c", "network.socks_url=socks5://127.0.0.1:7897"]
  );
});

test("buildCodexNetworkProxyArgs falls back to macOS system proxy settings", () => {
  const scutilProxyOutput = `
<dictionary> {
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
  HTTPSEnable : 1
  HTTPSProxy : 127.0.0.1
  HTTPSPort : 7897
  SOCKSEnable : 1
  SOCKSProxy : 127.0.0.1
  SOCKSPort : 7897
}
`;

  assert.deepEqual(
    buildCodexNetworkProxyArgs(
      {},
      {
        isMacos: true,
        execFileSyncImpl: () => scutilProxyOutput,
      }
    ),
    ["-c", "network.proxy_url=http://127.0.0.1:7897"]
  );
});

test("buildSpawnSpec injects Codex proxy config before the app-server subcommand", () => {
  assert.deepEqual(
    buildSpawnSpec("codex", "/tmp/codex-im-workspaces/workspace-abc123", {
      HTTP_PROXY: "http://127.0.0.1:7897",
    }),
    {
      command: "codex",
      args: [
        "-c",
        "network.proxy_url=http://127.0.0.1:7897",
        "--cd",
        "/tmp/codex-im-workspaces/workspace-abc123",
        "app-server",
      ],
    }
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

test("resolveCodexSpawnCwd creates an ASCII workspace mirror for non-ASCII workspaces", () => {
  const tempAliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-alias-"));
  const unicodeWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-工作区-"));
  const sourceFile = path.join(unicodeWorkspaceRoot, "marker.txt");
  fs.writeFileSync(sourceFile, "hello world");

  const resolved = resolveCodexSpawnCwd(unicodeWorkspaceRoot, tempAliasRoot);

  assert.notEqual(resolved, unicodeWorkspaceRoot);
  assert.match(resolved, /^[\x00-\x7F]+$/);
  assert.equal(fs.lstatSync(resolved).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(resolved, "marker.txt"), "utf8"), "hello world");
  assert.equal(
    fs.statSync(path.join(resolved, "marker.txt")).ino,
    fs.statSync(sourceFile).ino
  );
});

test("resolveCodexHome copies auth and config into an isolated Codex home", () => {
  const previousHome = process.env.HOME;
  const tempSourceHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-source-home-"));
  const tempHomeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-child-home-"));
  const sourceCodexHome = path.join(tempSourceHome, ".codex");

  fs.mkdirSync(sourceCodexHome, { recursive: true });
  fs.writeFileSync(path.join(sourceCodexHome, "auth.json"), '{"auth_mode":"api_key"}');
  fs.writeFileSync(path.join(sourceCodexHome, "config.toml"), 'model = "gpt-5.4-mini"\n');
  fs.writeFileSync(path.join(sourceCodexHome, "ymcodex-login-state.json"), '{"isLoggedIn":true}');
  fs.writeFileSync(path.join(sourceCodexHome, ".codex-global-state.json"), '{"active-workspace-roots":[]}' );

  process.env.HOME = tempSourceHome;
  try {
    const resolved = resolveCodexHome("/Users/dy3000/Documents/test/私人事务/codex-im", tempHomeRoot);
    assert.match(resolved, /^[\x00-\x7F]+$/);
    assert.equal(
      fs.readFileSync(path.join(resolved, ".codex", "auth.json"), "utf8"),
      '{"auth_mode":"api_key"}'
    );
    assert.equal(
      fs.readFileSync(path.join(resolved, ".codex", "config.toml"), "utf8"),
      'model = "gpt-5.4-mini"\n'
    );
    assert.equal(
      fs.readFileSync(path.join(resolved, ".codex", "ymcodex-login-state.json"), "utf8"),
      '{"isLoggedIn":true}'
    );
    assert.equal(
      fs.readFileSync(path.join(resolved, ".codex", ".codex-global-state.json"), "utf8"),
      '{"active-workspace-roots":[]}'
    );
  } finally {
    process.env.HOME = previousHome;
  }
});

test("CodexRpcClient uses an ASCII workspace mirror for turn requests and maps list results back", async () => {
  const tempAliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-alias-"));
  const unicodeWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-工作区-"));
  const client = new CodexRpcClient({
    endpoint: "",
    env: {},
    codexCommand: "codex",
    spawnImpl: () => {
      throw new Error("spawn should not be used in this test");
    },
    webSocketImpl: class FakeWebSocket {},
    workspaceCwd: unicodeWorkspaceRoot,
    workspaceAliasRoot: tempAliasRoot,
    codexHomeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-home-")),
  });

  const aliasWorkspaceRoot = client.resolveCodexSpawnWorkspaceRoot();
  const requests = [];
  client.sendRequest = async (method, params) => {
    requests.push({ method, params });
    if (method === "thread/list") {
      return {
        result: {
          data: [
            {
              id: "thread-1",
              cwd: aliasWorkspaceRoot,
              name: "Thread 1",
              updatedAt: 123,
            },
          ],
        },
      };
    }
    return {
      result: {
        thread: {
          id: "thread-1",
        },
      },
    };
  };

  await client.sendUserMessage({
    threadId: "thread-1",
    text: "hello",
    workspaceRoot: unicodeWorkspaceRoot,
  });

  const turnRequest = requests.find((request) => request.method === "turn/start");
  assert.ok(turnRequest);
  assert.equal(turnRequest.params.sandboxPolicy.writableRoots[0], aliasWorkspaceRoot);

  const listResponse = await client.listThreads();
  const mappedThreads = listResponse.result.data;
  assert.equal(mappedThreads[0].cwd, unicodeWorkspaceRoot);
});

test("CodexRpcClient keeps workspace aliases isolated per workspace root", () => {
  const tempAliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-alias-"));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-仓库-"));
  const projectARoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-项目A-"));
  const projectBRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-项目B-"));
  const client = new CodexRpcClient({
    endpoint: "",
    env: {},
    codexCommand: "codex",
    spawnImpl: () => {
      throw new Error("spawn should not be used in this test");
    },
    webSocketImpl: class FakeWebSocket {},
    workspaceCwd: repoRoot,
    workspaceAliasRoot: tempAliasRoot,
    codexHomeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-home-")),
  });

  const repoAlias = client.resolveCodexSpawnWorkspaceRoot();
  const aliasA = client.resolveCodexSpawnWorkspaceRoot(projectARoot);
  const aliasB = client.resolveCodexSpawnWorkspaceRoot(projectBRoot);

  assert.match(repoAlias, /^[\x00-\x7F]+$/);
  assert.match(aliasA, /^[\x00-\x7F]+$/);
  assert.match(aliasB, /^[\x00-\x7F]+$/);
  assert.notEqual(aliasA, aliasB);
  assert.notEqual(aliasA, repoAlias);
  assert.notEqual(aliasB, repoAlias);
  assert.equal(client.restoreWorkspacePath(aliasA), projectARoot);
  assert.equal(client.restoreWorkspacePath(`${aliasA}/subdir`), `${projectARoot}/subdir`);
  assert.equal(client.restoreWorkspacePath(aliasB), projectBRoot);

  const rewritten = client.rewriteThreadListResponse({
    result: {
      data: [
        { id: "thread-a", cwd: aliasA, name: "A" },
        { id: "thread-b", cwd: `${aliasB}/nested`, name: "B" },
      ],
    },
  });

  assert.equal(rewritten.result.data[0].cwd, projectARoot);
  assert.equal(rewritten.result.data[1].cwd, `${projectBRoot}/nested`);
});

test("spawnCodexProcess forwards the cwd through both spawn options and environment", async () => {
  let capturedOptions = null;
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdin = {
      writable: true,
      write: () => true,
    };
    setImmediate(() => {
      child.emit("spawn");
    });
    return child;
  };

  const spawnPromise = spawnCodexProcess(
    (...args) => {
      capturedOptions = args[2];
      return fakeSpawn();
    },
    { command: "codex", args: ["app-server"] },
    {
      INIT_CWD: "/Users/dy3000/Documents/test/私人事务/codex-im",
      HOME: "/Users/dy3000",
      PWD: "/Users/dy3000/Documents/test/私人事务/codex-im",
      TEST_ENV: "1",
      CODEX_HOME: "/Users/dy3000/.codex",
      npm_config_local_prefix: "/Users/dy3000/Documents/test/私人事务/codex-im",
      npm_package_json: "/Users/dy3000/Documents/test/私人事务/codex-im/package.json",
    },
    {
      cwd: "/tmp/codex-im-workspaces/workspace-abc123",
      home: "/tmp/codex-im-homes/home-abc123",
    }
  );

  await spawnPromise;

  assert.equal(capturedOptions?.cwd, "/tmp/codex-im-workspaces/workspace-abc123");
  assert.equal(capturedOptions?.env?.PWD, "/tmp/codex-im-workspaces/workspace-abc123");
  assert.equal(capturedOptions?.env?.INIT_CWD, "/tmp/codex-im-workspaces/workspace-abc123");
  assert.equal(capturedOptions?.env?.HOME, "/tmp/codex-im-homes/home-abc123");
  assert.equal(capturedOptions?.env?.CODEX_HOME, "/tmp/codex-im-homes/home-abc123/.codex");
  assert.equal(capturedOptions?.env?.TEST_ENV, "1");
  assert.equal(capturedOptions?.env?.npm_config_local_prefix, undefined);
  assert.equal(capturedOptions?.env?.npm_package_json, undefined);
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
