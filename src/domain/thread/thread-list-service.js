const { filterThreadsByWorkspaceRoot } = require("../../shared/workspace-paths");
const codexMessageUtils = require("../../infra/codex/message-utils");

const THREAD_SOURCE_KINDS = new Set([
  "app",
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
]);
const DEFAULT_WORKSPACE_THREAD_LIST_CACHE_TTL_MS = 5_000;
const DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT = 50;

async function refreshWorkspaceThreads(
  runtime,
  bindingKey,
  workspaceRoot,
  normalized,
  { forceRefresh = false, previewOnly = false, allowStaleCache = false, previewLimit = DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT } = {}
) {
  const cacheKey = buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot);
  const cachedResult = readWorkspaceThreadListCache(runtime, cacheKey);
  if (!forceRefresh && cachedResult && (
    isFreshWorkspaceThreadListCache(cachedResult)
    || (previewOnly && allowStaleCache)
  )) {
    setWorkspaceThreadRefreshState(runtime, cacheKey, {
      ok: true,
      fromCache: true,
      error: "",
      updatedAt: cachedResult.updatedAt,
    });
    return cachedResult.threads;
  }

  const sharedCacheKey = buildWorkspaceThreadSharedCacheKey(runtime, workspaceRoot, {
    previewOnly,
    previewLimit,
  });
  const sharedFallbackCacheKey = previewOnly
    ? buildWorkspaceThreadSharedCacheKey(runtime, workspaceRoot, { previewOnly: false })
    : "";
  const sharedCachedResult = !forceRefresh
    ? (
      readWorkspaceThreadSharedCache(runtime, sharedCacheKey)
      || (sharedFallbackCacheKey
        ? readWorkspaceThreadSharedCache(runtime, sharedFallbackCacheKey)
        : null)
    )
    : null;
  if (!forceRefresh && sharedCachedResult && (
    isFreshWorkspaceThreadListCache(sharedCachedResult)
    || (previewOnly && allowStaleCache)
  )) {
    if (!previewOnly) {
      persistWorkspaceThreadListCache(runtime, cacheKey, sharedCachedResult.threads, {
        updatedAt: sharedCachedResult.updatedAt,
      });
    }
    setWorkspaceThreadRefreshState(runtime, cacheKey, {
      ok: true,
      fromCache: true,
      error: "",
      updatedAt: sharedCachedResult.updatedAt,
    });
    return sharedCachedResult.threads;
  }

  try {
    const { threads, updatedAt } = await runWorkspaceThreadRefresh(runtime, sharedCacheKey, async () => {
      const fetchedThreads = shouldUseDesktopSessions(runtime)
        ? await runtime.listDesktopSessionsForWorkspace(workspaceRoot)
        : (
          previewOnly
            ? await listCodexThreadsPreviewForWorkspace(runtime, workspaceRoot, previewLimit)
            : await listCodexThreadsForWorkspace(runtime, workspaceRoot)
        );
      return {
        threads: fetchedThreads,
        updatedAt: new Date().toISOString(),
      };
    });
    persistWorkspaceThreadSharedCache(runtime, sharedCacheKey, threads, { updatedAt });
    if (!previewOnly) {
      persistWorkspaceThreadListCache(runtime, cacheKey, threads, { updatedAt });
    }
    setWorkspaceThreadRefreshState(runtime, cacheKey, {
      ok: true,
      fromCache: false,
      error: "",
      updatedAt,
    });
    if (!previewOnly && !shouldUseDesktopSessions(runtime)) {
      const currentThreadId = runtime.sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      const shouldKeepCurrentThread = currentThreadId && runtime.resumedThreadIds.has(currentThreadId);
      if (currentThreadId && !shouldKeepCurrentThread && !threads.some((thread) => thread.id === currentThreadId)) {
        runtime.sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      }
    }
    return threads;
  } catch (error) {
    const errorLabel = shouldUseDesktopSessions(runtime) ? "desktop session refresh" : "thread/list";
    console.warn(`[codex-im] ${errorLabel} failed for workspace=${workspaceRoot}: ${error.message}`);
    setWorkspaceThreadRefreshState(runtime, cacheKey, {
      ok: false,
      fromCache: false,
      error: error.message,
      updatedAt: new Date().toISOString(),
    });
    const fallbackCachedResult = cachedResult || sharedCachedResult;
    if (fallbackCachedResult) {
      setWorkspaceThreadRefreshState(runtime, cacheKey, {
        ok: true,
        fromCache: true,
        error: "",
        updatedAt: fallbackCachedResult.updatedAt,
      });
      return fallbackCachedResult.threads;
    }
    return [];
  }
}

function getWorkspaceThreadRefreshState(runtime, bindingKey, workspaceRoot) {
  const cacheKey = buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot);
  const state = runtime.workspaceThreadRefreshStateByKey?.get(cacheKey) || null;
  if (!state || typeof state !== "object") {
    return {
      ok: true,
      fromCache: false,
      error: "",
      updatedAt: "",
    };
  }
  return {
    ok: state.ok !== false,
    fromCache: state.fromCache === true,
    error: typeof state.error === "string" ? state.error : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function invalidateWorkspaceThreadListCache(runtime, bindingKey, workspaceRoot) {
  const cacheKey = buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot);
  if (!cacheKey || !(runtime.workspaceThreadListCacheByKey instanceof Map)) {
    return;
  }
  runtime.workspaceThreadListCacheByKey.delete(cacheKey);
  invalidateWorkspaceThreadSharedCaches(runtime, workspaceRoot);
}

async function listCodexThreadsForWorkspace(runtime, workspaceRoot) {
  const allThreads = await listCodexThreadsPaginated(runtime);
  const sourceFiltered = allThreads.filter((thread) => isSupportedThreadSourceKind(thread?.sourceKind));
  return filterThreadsByWorkspaceRoot(sourceFiltered, workspaceRoot);
}

async function listCodexThreadsPreviewForWorkspace(runtime, workspaceRoot, previewLimit = DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT) {
  const normalizedLimit = Number.isInteger(previewLimit) && previewLimit > 0
    ? Math.min(previewLimit, 200)
    : DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT;
  const response = await runtime.codex.listThreads({
    cursor: null,
    limit: normalizedLimit,
    sortKey: "updated_at",
  });
  const pageThreads = codexMessageUtils.extractThreadsFromListResponse(response);
  const sourceFiltered = pageThreads.filter((thread) => isSupportedThreadSourceKind(thread?.sourceKind));
  return filterThreadsByWorkspaceRoot(sourceFiltered, workspaceRoot);
}

async function listCodexThreadsPaginated(runtime) {
  const allThreads = [];
  const seenThreadIds = new Set();
  let cursor = null;

  for (let page = 0; page < 10; page += 1) {
    const response = await runtime.codex.listThreads({
      cursor,
      limit: 200,
      sortKey: "updated_at",
    });
    const pageThreads = codexMessageUtils.extractThreadsFromListResponse(response);
    for (const thread of pageThreads) {
      if (seenThreadIds.has(thread.id)) {
        continue;
      }
      seenThreadIds.add(thread.id);
      allThreads.push(thread);
    }

    const nextCursor = codexMessageUtils.extractThreadListCursor(response);
    if (!nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
    if (pageThreads.length === 0) {
      break;
    }
  }

  return allThreads;
}

function readWorkspaceThreadListCache(runtime, cacheKey) {
  return readThreadListCache(runtime?.workspaceThreadListCacheByKey, cacheKey);
}

function readWorkspaceThreadSharedCache(runtime, cacheKey) {
  return readThreadListCache(runtime?.workspaceThreadSharedCacheByKey, cacheKey);
}

function readThreadListCache(cache, cacheKey) {
  if (!(cache instanceof Map) || !cacheKey) {
    return null;
  }

  const cached = cache.get(cacheKey);
  if (!cached || !Array.isArray(cached.threads)) {
    return null;
  }

  return {
    threads: cached.threads,
    updatedAt: typeof cached.updatedAt === "string" ? cached.updatedAt : "",
  };
}

function isFreshWorkspaceThreadListCache(cachedResult) {
  const updatedAt = Date.parse(String(cachedResult?.updatedAt || "").trim());
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  return (Date.now() - updatedAt) <= DEFAULT_WORKSPACE_THREAD_LIST_CACHE_TTL_MS;
}

function persistWorkspaceThreadListCache(runtime, cacheKey, threads, { updatedAt = new Date().toISOString() } = {}) {
  if (!(runtime.workspaceThreadListCacheByKey instanceof Map)) {
    runtime.workspaceThreadListCacheByKey = new Map();
  }
  return persistThreadListCache(runtime.workspaceThreadListCacheByKey, cacheKey, threads, { updatedAt });
}

function persistWorkspaceThreadSharedCache(runtime, cacheKey, threads, { updatedAt = new Date().toISOString() } = {}) {
  if (!(runtime.workspaceThreadSharedCacheByKey instanceof Map)) {
    runtime.workspaceThreadSharedCacheByKey = new Map();
  }
  return persistThreadListCache(runtime.workspaceThreadSharedCacheByKey, cacheKey, threads, { updatedAt });
}

function persistThreadListCache(cache, cacheKey, threads, { updatedAt = new Date().toISOString() } = {}) {
  if (!(cache instanceof Map) || !cacheKey) {
    return null;
  }
  const normalizedThreads = Array.isArray(threads)
    ? threads.map((thread) => ({ ...(thread || {}) }))
    : [];

  const cachedResult = {
    threads: normalizedThreads,
    updatedAt,
  };
  cache.set(cacheKey, cachedResult);
  return cachedResult;
}

function invalidateWorkspaceThreadSharedCaches(runtime, workspaceRoot) {
  const cache = runtime?.workspaceThreadSharedCacheByKey;
  if (!(cache instanceof Map)) {
    return;
  }
  const prefix = buildWorkspaceThreadSharedCachePrefix(runtime, workspaceRoot);
  if (!prefix) {
    return;
  }
  for (const key of cache.keys()) {
    if (typeof key === "string" && key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

function setWorkspaceThreadRefreshState(runtime, cacheKey, state) {
  if (!runtime.workspaceThreadRefreshStateByKey) {
    runtime.workspaceThreadRefreshStateByKey = new Map();
  }
  runtime.workspaceThreadRefreshStateByKey.set(cacheKey, {
    ok: state.ok !== false,
    fromCache: state.fromCache === true,
    error: typeof state.error === "string" ? state.error : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  });
}

function buildWorkspaceThreadCacheKey(bindingKey, workspaceRoot) {
  return `${String(bindingKey || "")}::${String(workspaceRoot || "")}`;
}

function buildWorkspaceThreadSharedCacheKey(runtime, workspaceRoot, {
  previewOnly = false,
  previewLimit = DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT,
} = {}) {
  const prefix = buildWorkspaceThreadSharedCachePrefix(runtime, workspaceRoot);
  if (!prefix) {
    return "";
  }
  if (!previewOnly || shouldUseDesktopSessions(runtime)) {
    return `${prefix}::full`;
  }
  const normalizedPreviewLimit = Number.isInteger(previewLimit) && previewLimit > 0
    ? Math.min(previewLimit, 200)
    : DEFAULT_WORKSPACE_THREAD_PREVIEW_LIMIT;
  return `${prefix}::preview:${normalizedPreviewLimit}`;
}

function buildWorkspaceThreadSharedCachePrefix(runtime, workspaceRoot) {
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (!normalizedWorkspaceRoot) {
    return "";
  }
  return `${shouldUseDesktopSessions(runtime) ? "desktop" : "codex"}::${normalizedWorkspaceRoot}`;
}

function runWorkspaceThreadRefresh(runtime, requestKey, task) {
  if (!requestKey) {
    return Promise.resolve().then(task);
  }
  if (!(runtime.workspaceThreadRefreshPromiseByKey instanceof Map)) {
    runtime.workspaceThreadRefreshPromiseByKey = new Map();
  }

  const inFlight = runtime.workspaceThreadRefreshPromiseByKey.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = Promise.resolve()
    .then(task)
    .finally(() => {
      if (runtime.workspaceThreadRefreshPromiseByKey.get(requestKey) === promise) {
        runtime.workspaceThreadRefreshPromiseByKey.delete(requestKey);
      }
    });
  runtime.workspaceThreadRefreshPromiseByKey.set(requestKey, promise);
  return promise;
}

function isSupportedThreadSourceKind(sourceKind) {
  const normalized = typeof sourceKind === "string" && sourceKind.trim() ? sourceKind.trim() : "unknown";
  return THREAD_SOURCE_KINDS.has(normalized);
}

function shouldUseDesktopSessions(runtime) {
  return typeof runtime.usesDesktopSessionSource === "function" && runtime.usesDesktopSessionSource();
}

module.exports = {
  getWorkspaceThreadRefreshState,
  invalidateWorkspaceThreadListCache,
  refreshWorkspaceThreads,
};
