const fs = require("fs");
const path = require("path");
const { normalizeModelCatalog } = require("../../shared/model-catalog");

const DEFAULT_SAVE_DEBOUNCE_MS = 100;
const RESTRICTED_STATE_FILE_MODE = 0o600;
const ACTIVE_SESSION_STORE_PATHS = new Set();

class SessionStore {
  constructor({ filePath, fallbackFilePaths = [] }) {
    this.filePath = path.resolve(filePath);
    this.lockFilePath = `${this.filePath}.lock`;
    this.fallbackFilePaths = normalizePathList(fallbackFilePaths).filter((candidate) => candidate !== this.filePath);
    this.state = createEmptyState();
    this.saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS;
    this.saveTimer = null;
    this.saveInFlight = false;
    this.pendingSave = false;
    this.savePromise = Promise.resolve();
    this.closed = false;
    this.hasFileLock = false;
    this.ensureParentDirectory();
    try {
      this.acquireFileLock();
      this.load();
    } catch (error) {
      this.releaseFileLock();
      throw error;
    }
  }

  acquireFileLock() {
    if (ACTIVE_SESSION_STORE_PATHS.has(this.filePath)) {
      throw new Error(`Session store ${this.filePath} is already in use`);
    }

    while (true) {
      let descriptor = null;
      try {
        descriptor = fs.openSync(this.lockFilePath, "wx", RESTRICTED_STATE_FILE_MODE);
        fs.writeFileSync(descriptor, JSON.stringify({
          pid: process.pid,
          filePath: this.filePath,
          createdAt: new Date().toISOString(),
        }, null, 2), "utf8");
        ACTIVE_SESSION_STORE_PATHS.add(this.filePath);
        this.hasFileLock = true;
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw error;
        }
        if (!clearStaleSessionStoreLock(this.lockFilePath)) {
          throw new Error(`Session store ${this.filePath} is already in use`);
        }
      } finally {
        if (descriptor !== null) {
          try {
            fs.closeSync(descriptor);
          } catch {}
        }
      }
    }
  }

  releaseFileLock() {
    if (!this.hasFileLock) {
      return;
    }

    ACTIVE_SESSION_STORE_PATHS.delete(this.filePath);
    this.hasFileLock = false;
    try {
      fs.unlinkSync(this.lockFilePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  ensureParentDirectory() {
    const parentDirectory = path.dirname(this.filePath);
    fs.mkdirSync(parentDirectory, { recursive: true });
  }

  load() {
    const candidatePaths = [this.filePath, ...this.fallbackFilePaths];
    for (const candidatePath of candidatePaths) {
      try {
        const raw = fs.readFileSync(candidatePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.bindings) {
          this.state = {
            ...createEmptyState(),
            ...parsed,
            bindings: parsed.bindings || {},
            approvalCommandAllowlistByWorkspaceRoot: parsed.approvalCommandAllowlistByWorkspaceRoot || {},
            availableModelCatalog: parsed.availableModelCatalog || {
              models: [],
              updatedAt: "",
            },
          };
          return;
        }
      } catch {
        continue;
      }
    }
    this.state = createEmptyState();
  }

  save() {
    this.requestSave();
  }

  requestSave() {
    this.pendingSave = true;
    if (this.saveTimer || this.saveInFlight) {
      return;
    }

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch((error) => {
        console.error(`[codex-im] failed to persist session store: ${error.message}`);
      });
    }, this.saveDebounceMs);

    if (typeof this.saveTimer.unref === "function") {
      this.saveTimer.unref();
    }
  }

  async flush() {
    this.pendingSave = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.saveInFlight) {
      return this.savePromise;
    }

    this.saveInFlight = true;
    this.savePromise = (async () => {
      try {
        while (this.pendingSave) {
          this.pendingSave = false;
          await writeStateAtomically(this.filePath, JSON.stringify(this.state, null, 2));
        }
      } catch (error) {
        this.pendingSave = true;
        throw error;
      } finally {
        this.saveInFlight = false;
        if (this.pendingSave && !this.saveTimer) {
          this.requestSave();
        }
      }
    })();

    return this.savePromise;
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.flush();
    } finally {
      this.releaseFileLock();
    }
  }

  getBinding(bindingKey) {
    return this.state.bindings[bindingKey] || null;
  }

  listBindings({ clone = true } = {}) {
    return Object.entries(this.state.bindings || {}).map(([bindingKey, binding]) => ({
      bindingKey,
      binding: clone
        ? {
          ...(binding || {}),
          threadIdByWorkspaceRoot: getThreadMap(binding),
          codexParamsByWorkspaceRoot: getCodexParamsMap(binding),
        }
        : (binding || {}),
    }));
  }

  getActiveWorkspaceRoot(bindingKey) {
    return this.state.bindings[bindingKey]?.activeWorkspaceRoot || "";
  }

  setActiveWorkspaceRoot(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const current = this.getBinding(bindingKey) || { threadIdByWorkspaceRoot: {} };
    const threadIdByWorkspaceRoot = getThreadMap(current);
    if (normalizedWorkspaceRoot && !(normalizedWorkspaceRoot in threadIdByWorkspaceRoot)) {
      threadIdByWorkspaceRoot[normalizedWorkspaceRoot] = "";
    }

    return this.updateBinding(bindingKey, {
      ...current,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRoot,
    });
  }

  getThreadIdForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    return this.state.bindings[bindingKey]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot] || "";
  }

  setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, extra = {}) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.getBinding(bindingKey) || {};
    const threadIdByWorkspaceRoot = {
      ...getThreadMap(current),
      [normalizedWorkspaceRoot]: threadId,
    };

    return this.updateBinding(bindingKey, {
      ...current,
      ...extra,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRoot,
    });
  }

  clearThreadIdForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.getBinding(bindingKey) || {};
    const threadIdByWorkspaceRoot = {
      ...getThreadMap(current),
      [normalizedWorkspaceRoot]: "",
    };

    return this.updateBinding(bindingKey, {
      ...current,
      threadIdByWorkspaceRoot,
    });
  }

  getCodexParamsForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return { model: "", effort: "" };
    }
    const raw = this.state.bindings[bindingKey]?.codexParamsByWorkspaceRoot?.[normalizedWorkspaceRoot];
    if (!raw || typeof raw !== "object") {
      return { model: "", effort: "" };
    }
    return {
      model: normalizeValue(raw.model),
      effort: normalizeValue(raw.effort),
    };
  }

  setCodexParamsForWorkspace(bindingKey, workspaceRoot, { model, effort }) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.getBinding(bindingKey) || {};
    const codexParamsByWorkspaceRoot = {
      ...getCodexParamsMap(current),
      [normalizedWorkspaceRoot]: {
        model: normalizeValue(model),
        effort: normalizeValue(effort),
      },
    };

    return this.updateBinding(bindingKey, {
      ...current,
      codexParamsByWorkspaceRoot,
    });
  }

  getApprovalCommandAllowlistForWorkspace(workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return [];
    }
    const allowlist = this.state.approvalCommandAllowlistByWorkspaceRoot?.[normalizedWorkspaceRoot];
    if (!Array.isArray(allowlist)) {
      return [];
    }
    return normalizeCommandAllowlist(allowlist);
  }

  getAvailableModelCatalog() {
    const raw = this.state.availableModelCatalog;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const models = normalizeModelCatalog(raw.models);
    if (!models.length) {
      return null;
    }
    const updatedAt = normalizeValue(raw.updatedAt);
    return {
      models,
      updatedAt,
    };
  }

  setAvailableModelCatalog(models) {
    const normalizedModels = normalizeModelCatalog(models);
    if (!normalizedModels.length) {
      return null;
    }

    this.state.availableModelCatalog = {
      models: normalizedModels,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.availableModelCatalog;
  }

  rememberApprovalCommandPrefixForWorkspace(workspaceRoot, commandTokens) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedTokens = normalizeCommandTokens(commandTokens);
    if (!normalizedWorkspaceRoot || !normalizedTokens.length) {
      return null;
    }

    const currentAllowlist = this.getApprovalCommandAllowlistForWorkspace(normalizedWorkspaceRoot);
    const exists = currentAllowlist.some((prefix) => (
      prefix.length === normalizedTokens.length
      && prefix.every((token, index) => token === normalizedTokens[index])
    ));
    if (exists) {
      return currentAllowlist;
    }

    this.state.approvalCommandAllowlistByWorkspaceRoot = {
      ...(this.state.approvalCommandAllowlistByWorkspaceRoot || {}),
      [normalizedWorkspaceRoot]: [...currentAllowlist, normalizedTokens],
    };
    this.save();
    return this.state.approvalCommandAllowlistByWorkspaceRoot[normalizedWorkspaceRoot];
  }

  removeWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.getBinding(bindingKey) || {};
    const threadIdByWorkspaceRoot = getThreadMap(current);
    const codexParamsByWorkspaceRoot = getCodexParamsMap(current);
    const hasWorkspaceEntry = Object.prototype.hasOwnProperty.call(
      threadIdByWorkspaceRoot,
      normalizedWorkspaceRoot
    );
    const activeWorkspaceRoot = normalizeValue(current.activeWorkspaceRoot);
    if (!hasWorkspaceEntry && activeWorkspaceRoot !== normalizedWorkspaceRoot) {
      return current;
    }

    delete threadIdByWorkspaceRoot[normalizedWorkspaceRoot];
    delete codexParamsByWorkspaceRoot[normalizedWorkspaceRoot];

    const nextActiveWorkspaceRoot = activeWorkspaceRoot === normalizedWorkspaceRoot
      ? (Object.keys(threadIdByWorkspaceRoot).sort((left, right) => left.localeCompare(right))[0] || "")
      : activeWorkspaceRoot;

    return this.updateBinding(bindingKey, {
      ...current,
      activeWorkspaceRoot: nextActiveWorkspaceRoot,
      codexParamsByWorkspaceRoot,
      threadIdByWorkspaceRoot,
    });
  }

  updateBinding(bindingKey, nextBinding) {
    this.state.bindings[bindingKey] = {
      ...nextBinding,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.bindings[bindingKey];
  }

  buildBindingKey({ workspaceId, chatId, threadKey, senderId, messageId }) {
    const normalizedThreadKey = normalizeValue(threadKey);
    const normalizedMessageId = normalizeValue(messageId);
    const hasStableThreadKey = normalizedThreadKey && normalizedThreadKey !== normalizedMessageId;

    if (hasStableThreadKey) {
      return `${workspaceId}:${chatId}:thread:${normalizedThreadKey}`;
    }
    return `${workspaceId}:${chatId}:sender:${senderId}`;
  }

}

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createEmptyState() {
  return {
    bindings: {},
    approvalCommandAllowlistByWorkspaceRoot: {},
    availableModelCatalog: {
      models: [],
      updatedAt: "",
    },
  };
}

function getThreadMap(binding) {
  return { ...(binding?.threadIdByWorkspaceRoot || {}) };
}

function getCodexParamsMap(binding) {
  return { ...(binding?.codexParamsByWorkspaceRoot || {}) };
}

function normalizeCommandTokens(tokens) {
  if (!Array.isArray(tokens)) {
    return [];
  }
  return tokens
    .map((token) => (typeof token === "string" ? token.trim() : ""))
    .filter(Boolean);
}

function normalizeCommandAllowlist(allowlist) {
  if (!Array.isArray(allowlist)) {
    return [];
  }
  return allowlist
    .map((tokens) => normalizeCommandTokens(tokens))
    .filter((tokens) => tokens.length > 0);
}

function normalizePathList(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }
  return paths
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .map((item) => path.resolve(item))
    .filter(Boolean);
}

function clearStaleSessionStoreLock(lockFilePath) {
  const lockInfo = readSessionStoreLock(lockFilePath);
  const lockPid = Number(lockInfo?.pid);
  if (Number.isInteger(lockPid) && lockPid > 0 && isSessionStoreProcessAlive(lockPid)) {
    return false;
  }

  try {
    fs.unlinkSync(lockFilePath);
    return true;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

function readSessionStoreLock(lockFilePath) {
  try {
    return JSON.parse(fs.readFileSync(lockFilePath, "utf8"));
  } catch {
    return null;
  }
}

function isSessionStoreProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function writeStateAtomically(filePath, serializedState) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    // Session state includes local workspace metadata and approval prefixes,
    // so keep the on-disk file readable by the current user only.
    await fs.promises.writeFile(tempPath, serializedState, {
      encoding: "utf8",
      mode: RESTRICTED_STATE_FILE_MODE,
    });
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

module.exports = { SessionStore };
