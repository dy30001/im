#!/usr/bin/env node

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const repoRoot = path.resolve(__dirname, "..");
const bindingKey = "binding-1";
const workspaceRoot = "/repo";
const normalized = {
  chatId: "chat-1",
  messageId: "msg-1",
  text: "继续聊天",
};

const currentThreadRuntime = require(path.join(repoRoot, "src/domain/thread/thread-service.js"));
const headThreadRuntime = loadHeadThreadService();

const scenarios = [
  {
    name: "refresh:cold",
    iterations: 300,
    rounds: 5,
    run: (runtimeImpl) => runtimeImpl.refreshWorkspaceThreads(
      createRefreshRuntime(),
      bindingKey,
      workspaceRoot,
      normalized
    ),
    verify: (result) => {
      assert.equal(Array.isArray(result), true);
      assert.equal(result[0]?.id, "thread-1");
    },
  },
  {
    name: "refresh:cache-hit",
    iterations: 2_000,
    rounds: 5,
    run: (runtimeImpl) => runtimeImpl.refreshWorkspaceThreads(
      createCachedRefreshRuntime(),
      bindingKey,
      workspaceRoot,
      normalized
    ),
    verify: (result) => {
      assert.equal(Array.isArray(result), true);
      assert.equal(result[0]?.id, "thread-cached");
    },
  },
  {
    name: "select:skip-claimed",
    iterations: 400,
    rounds: 5,
    run: (runtimeImpl) => runtimeImpl.resolveWorkspaceThreadState(
      createSelectionRuntime(),
      {
        bindingKey: "binding-2",
        workspaceRoot,
        normalized,
        autoSelectThread: true,
        allowClaimedThreadReuse: false,
      }
    ),
    verify: (result) => {
      assert.equal(result?.threadId, "thread-2");
    },
  },
  {
    name: "send:recreate-stale",
    iterations: 500,
    rounds: 5,
    run: (runtimeImpl) => runtimeImpl.ensureThreadAndSendMessage(
      createStaleSendRuntime(),
      {
        bindingKey,
        workspaceRoot,
        normalized,
        threadId: "thread-stale",
      }
    ),
    verify: (result) => {
      assert.equal(result, "thread-new");
    },
  },
];

async function main() {
  console.log("Benchmark: current thread refactor vs HEAD baseline");
  console.log(`Repo: ${repoRoot}`);
  console.log("");

  const results = [];
  for (const scenario of scenarios) {
    const baselineResult = await withMutedConsole(() => scenario.run(headThreadRuntime));
    scenario.verify(baselineResult);

    const currentResult = await withMutedConsole(() => scenario.run(currentThreadRuntime));
    scenario.verify(currentResult);

    const baselineStats = await benchmarkScenario(headThreadRuntime, scenario);
    const currentStats = await benchmarkScenario(currentThreadRuntime, scenario);
    results.push({
      name: scenario.name,
      baseline: baselineStats,
      current: currentStats,
      deltaPct: percentDelta(currentStats.meanMs, baselineStats.meanMs),
    });
  }

  for (const result of results) {
    console.log([
      padRight(result.name, 20),
      `HEAD ${formatLatency(result.baseline.meanMs)}`,
      `current ${formatLatency(result.current.meanMs)}`,
      `delta ${formatPercent(result.deltaPct)}`,
    ].join(" | "));
  }

  const averageDeltaPct = results.reduce((sum, result) => sum + result.deltaPct, 0) / results.length;
  console.log("");
  console.log(`Average delta: ${formatPercent(averageDeltaPct)}`);
  console.log("Interpretation: negative is faster, positive is slower.");
}

function loadHeadThreadService() {
  const source = execFileSync(
    "git",
    ["show", "HEAD:src/domain/thread/thread-service.js"],
    { cwd: repoRoot, encoding: "utf8" }
  );
  const filename = path.join(repoRoot, "src/domain/thread/__bench_head_thread_service__.js");
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);
  return mod.exports;
}

async function benchmarkScenario(runtimeImpl, scenario) {
  return withMutedConsole(async () => {
    for (let i = 0; i < 25; i += 1) {
      await scenario.run(runtimeImpl);
    }

    const perIterationSamples = [];
    for (let round = 0; round < scenario.rounds; round += 1) {
      const startedAt = performance.now();
      for (let iteration = 0; iteration < scenario.iterations; iteration += 1) {
        await scenario.run(runtimeImpl);
      }
      const endedAt = performance.now();
      perIterationSamples.push((endedAt - startedAt) / scenario.iterations);
    }

    const meanMs = perIterationSamples.reduce((sum, sample) => sum + sample, 0) / perIterationSamples.length;
    return {
      meanMs,
      minMs: Math.min(...perIterationSamples),
      maxMs: Math.max(...perIterationSamples),
    };
  });
}

function createRefreshRuntime() {
  return {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    workspaceThreadRefreshPromiseByKey: new Map(),
    resumedThreadIds: new Set(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      listThreads: async () => ({
        result: {
          data: [
            {
              id: "thread-1",
              cwd: workspaceRoot,
              sourceKind: "cli",
              updatedAt: 1,
              title: "Thread 1",
            },
          ],
          nextCursor: "",
        },
      }),
    },
  };
}

function createCachedRefreshRuntime() {
  const cacheKey = `${bindingKey}::${workspaceRoot}`;
  const updatedAt = new Date().toISOString();
  const threads = [
    {
      id: "thread-cached",
      cwd: workspaceRoot,
      sourceKind: "cli",
      updatedAt: 1,
      title: "Cached",
    },
  ];

  return {
    workspaceThreadListCacheByKey: new Map([
      [cacheKey, { threads, updatedAt }],
    ]),
    workspaceThreadSharedCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    workspaceThreadRefreshPromiseByKey: new Map(),
    resumedThreadIds: new Set(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      listThreads: async () => {
        throw new Error("cache-hit scenario should not fetch threads");
      },
    },
  };
}

function createSelectionRuntime() {
  return {
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    workspaceThreadRefreshStateByKey: new Map(),
    workspaceThreadRefreshPromiseByKey: new Map(),
    resumedThreadIds: new Set(),
    pendingApprovalByThreadId: new Set(),
    activeTurnIdByThreadId: new Map(),
    bindingKeyByThreadId: new Map(),
    inFlightThreadDispatchClaimsById: new Map(),
    sessionStore: {
      getThreadIdForWorkspace: () => "",
      setThreadIdForWorkspace: () => {},
      clearThreadIdForWorkspace: () => {},
      listBindings: () => ([
        {
          bindingKey,
          binding: {
            threadIdByWorkspaceRoot: {
              [workspaceRoot]: "thread-1",
            },
          },
        },
      ]),
    },
    codex: {
      listThreads: async () => ({
        result: {
          data: [
            {
              id: "thread-1",
              cwd: workspaceRoot,
              sourceKind: "cli",
              updatedAt: 2,
            },
            {
              id: "thread-2",
              cwd: workspaceRoot,
              sourceKind: "cli",
              updatedAt: 1,
            },
          ],
          nextCursor: "",
        },
      }),
    },
    resolveThreadIdForBinding: () => "",
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };
}

function createStaleSendRuntime() {
  return {
    config: {
      defaultCodexAccessMode: "default",
    },
    workspaceThreadListCacheByKey: new Map(),
    workspaceThreadSharedCacheByKey: new Map(),
    resumedThreadIds: new Set(),
    pendingChatContextByThreadId: new Map(),
    getCodexParamsForWorkspace: () => ({
      model: "gpt-5.3-codex",
      effort: "medium",
    }),
    sessionStore: {
      setThreadIdForWorkspace: () => {},
      clearThreadIdForWorkspace: () => {},
    },
    codex: {
      resumeThread: async () => ({}),
      startThread: async () => ({
        result: {
          thread: {
            id: "thread-new",
          },
        },
      }),
      sendUserMessage: async ({ threadId }) => {
        if (threadId === "thread-stale") {
          throw new Error("thread not found");
        }
        return {};
      },
    },
    setPendingThreadContext: () => {},
    setThreadBindingKey: () => {},
    setThreadWorkspaceRoot: () => {},
    rememberSelectedThreadForSync: () => {},
  };
}

async function withMutedConsole(task) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await task();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function percentDelta(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) {
    return 0;
  }
  return ((current - baseline) / baseline) * 100;
}

function formatLatency(ms) {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(1)}us/op`;
  }
  return `${ms.toFixed(3)}ms/op`;
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function padRight(value, length) {
  const text = String(value);
  if (text.length >= length) {
    return text;
  }
  return `${text}${" ".repeat(length - text.length)}`;
}

main().catch((error) => {
  console.error(`[bench-thread-refactor] ${error.stack || error.message}`);
  process.exitCode = 1;
});
