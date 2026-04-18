const DEFAULT_THREAD_DISPATCH_CLAIM_TTL_MS = 90_000;

function getThreadDispatchClaimMap(runtime) {
  if (!(runtime?.inFlightThreadDispatchClaimsById instanceof Map)) {
    runtime.inFlightThreadDispatchClaimsById = new Map();
  }
  return runtime.inFlightThreadDispatchClaimsById;
}

function resolveThreadDispatchKeys(runtime, workspaceRoot, target) {
  const ids = new Set();
  collectThreadDispatchKeys(ids, target);

  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  const normalizedTargetId = normalizeThreadDispatchKey(target);
  if (
    normalizedWorkspaceRoot
    && normalizedTargetId
    && typeof runtime?.resolveDesktopSessionById === "function"
  ) {
    const session = runtime.resolveDesktopSessionById(normalizedWorkspaceRoot, normalizedTargetId);
    if (session) {
      collectThreadDispatchKeys(ids, session);
    }
  }

  return Array.from(ids);
}

function acquireThreadDispatchClaim(runtime, {
  bindingKey,
  workspaceRoot,
  target,
  now = Date.now(),
} = {}) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  const keys = resolveThreadDispatchKeys(runtime, normalizedWorkspaceRoot, target);
  if (!normalizedBindingKey || !normalizedWorkspaceRoot || keys.length === 0) {
    return null;
  }

  const map = getThreadDispatchClaimMap(runtime);
  const existingClaim = getActiveThreadDispatchClaim(runtime, normalizedWorkspaceRoot, keys, now);
  if (existingClaim) {
    if (
      existingClaim.bindingKey === normalizedBindingKey
      && existingClaim.workspaceRoot === normalizedWorkspaceRoot
    ) {
      return existingClaim;
    }
    return null;
  }

  const claim = {
    bindingKey: normalizedBindingKey,
    workspaceRoot: normalizedWorkspaceRoot,
    claimedAt: now,
    keys,
  };
  for (const key of keys) {
    map.set(key, claim);
  }
  return claim;
}

function releaseThreadDispatchClaim(runtime, {
  workspaceRoot,
  target,
  claim = null,
} = {}) {
  const map = getThreadDispatchClaimMap(runtime);
  const resolvedClaim = claim || getActiveThreadDispatchClaim(runtime, workspaceRoot, target);
  if (!resolvedClaim) {
    return false;
  }
  return deleteThreadDispatchClaim(map, resolvedClaim);
}

function isThreadDispatchClaimedByDifferentBinding(runtime, {
  bindingKey,
  workspaceRoot,
  target,
  now = Date.now(),
} = {}) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  const claim = getActiveThreadDispatchClaim(runtime, normalizedWorkspaceRoot, target, now);
  if (!claim) {
    return false;
  }
  return (
    claim.bindingKey !== normalizedBindingKey
    || claim.workspaceRoot !== normalizedWorkspaceRoot
  );
}

function getActiveThreadDispatchClaim(runtime, workspaceRoot, target, now = Date.now()) {
  const map = getThreadDispatchClaimMap(runtime);
  const keys = Array.isArray(target)
    ? target.map((entry) => normalizeThreadDispatchKey(entry)).filter(Boolean)
    : resolveThreadDispatchKeys(runtime, workspaceRoot, target);

  for (const key of keys) {
    const claim = map.get(key) || null;
    if (!claim) {
      continue;
    }
    if (isThreadDispatchClaimStale(claim, now)) {
      deleteThreadDispatchClaim(map, claim);
      continue;
    }
    return claim;
  }
  return null;
}

function isThreadDispatchClaimStale(claim, now = Date.now()) {
  const claimedAt = Number(claim?.claimedAt || 0);
  if (!Number.isFinite(claimedAt) || claimedAt <= 0) {
    return true;
  }
  return (now - claimedAt) > DEFAULT_THREAD_DISPATCH_CLAIM_TTL_MS;
}

function deleteThreadDispatchClaim(map, claim) {
  if (!(map instanceof Map) || !claim) {
    return false;
  }
  const keys = Array.isArray(claim.keys) ? claim.keys : [];
  let removed = false;
  for (const key of keys) {
    if (map.get(key) === claim) {
      map.delete(key);
      removed = true;
    }
  }
  return removed;
}

function collectThreadDispatchKeys(ids, target) {
  const normalizedTarget = normalizeThreadDispatchKey(target);
  if (normalizedTarget) {
    ids.add(normalizedTarget);
  }
  if (!target || typeof target !== "object") {
    return;
  }
  addNormalizedThreadDispatchKey(ids, target.id);
  addNormalizedThreadDispatchKey(ids, target.acpSessionId);
  addNormalizedThreadDispatchKey(ids, target.acpxRecordId);
}

function addNormalizedThreadDispatchKey(ids, value) {
  const normalized = normalizeThreadDispatchKey(value);
  if (normalized) {
    ids.add(normalized);
  }
}

function normalizeThreadDispatchKey(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "object") {
    return "";
  }
  return String(value).trim();
}

module.exports = {
  acquireThreadDispatchClaim,
  getActiveThreadDispatchClaim,
  getThreadDispatchClaimMap,
  isThreadDispatchClaimedByDifferentBinding,
  releaseThreadDispatchClaim,
  resolveThreadDispatchKeys,
};
