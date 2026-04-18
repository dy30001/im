const {
  isThreadDispatchClaimedByDifferentBinding,
  resolveThreadDispatchKeys,
} = require("../../shared/thread-dispatch-claims");

function selectAutoThreadForBinding(runtime, bindingKey, workspaceRoot, threads, {
  allowClaimedThreadReuse = true,
} = {}) {
  const candidates = Array.isArray(threads) ? threads : [];
  return selectFirstAvailableThreadForBinding(runtime, bindingKey, workspaceRoot, candidates, {
    allowClaimedThreadReuse,
  });
}

function isThreadAssignedToDifferentBinding(runtime, bindingKey, workspaceRoot, threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  const normalizedBindingKey = String(bindingKey || "").trim();
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  if (
    !normalizedThreadId
    || !normalizedBindingKey
    || !normalizedWorkspaceRoot
    || typeof runtime?.sessionStore?.listBindings !== "function"
  ) {
    return false;
  }

  return runtime.sessionStore.listBindings({ clone: false }).some((entry) => {
    if (String(entry?.bindingKey || "").trim() === normalizedBindingKey) {
      return false;
    }
    return String(entry?.binding?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot] || "").trim() === normalizedThreadId;
  });
}

function selectFirstAvailableThreadForBinding(runtime, bindingKey, workspaceRoot, threads, {
  allowClaimedThreadReuse = true,
} = {}) {
  for (const thread of threads) {
    const threadId = String(thread?.id || "").trim();
    if (!threadId) {
      continue;
    }
    if (isThreadUnavailableForBinding(runtime, bindingKey, workspaceRoot, thread, { allowClaimedThreadReuse })) {
      continue;
    }
    return threadId;
  }
  return "";
}

function isThreadUnavailableForBinding(runtime, bindingKey, workspaceRoot, threadOrId, {
  allowClaimedThreadReuse = true,
} = {}) {
  const threadId = String(threadOrId?.id || threadOrId || "").trim();
  if (!threadId) {
    return false;
  }
  if (
    !allowClaimedThreadReuse
    && isThreadAssignedToDifferentBinding(runtime, bindingKey, workspaceRoot, threadId)
  ) {
    return true;
  }
  if (isThreadDispatchClaimedByDifferentBinding(runtime, {
    bindingKey,
    workspaceRoot,
    target: threadOrId,
  })) {
    return true;
  }
  return isThreadBusyForDifferentBinding(runtime, bindingKey, workspaceRoot, threadOrId);
}

function isThreadBusyForDifferentBinding(runtime, bindingKey, workspaceRoot, threadOrId) {
  const normalizedBindingKey = String(bindingKey || "").trim();
  const threadIds = resolveThreadDispatchKeys(runtime, workspaceRoot, threadOrId);
  for (const threadId of threadIds) {
    if (
      !runtime.pendingApprovalByThreadId?.has(threadId)
      && !runtime.activeTurnIdByThreadId?.has(threadId)
    ) {
      continue;
    }
    const ownerBindingKey = String(runtime.bindingKeyByThreadId?.get(threadId) || "").trim();
    if (ownerBindingKey && ownerBindingKey !== normalizedBindingKey) {
      return true;
    }
  }
  return false;
}

module.exports = {
  isThreadAssignedToDifferentBinding,
  isThreadUnavailableForBinding,
  selectAutoThreadForBinding,
};
