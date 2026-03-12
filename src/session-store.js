const fs = require("fs");

class SessionStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = {
      bindings: {},
    };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.bindings) {
        this.state = parsed;
      }
    } catch {
      this.state = { bindings: {} };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getBinding(bindingKey) {
    return this.state.bindings[bindingKey] || null;
  }

  setBinding(bindingKey, value) {
    this.state.bindings[bindingKey] = {
      ...value,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.bindings[bindingKey];
  }

  getActiveWorkspaceRoot(bindingKey) {
    return this.state.bindings[bindingKey]?.activeWorkspaceRoot || "";
  }

  setActiveWorkspaceRoot(bindingKey, workspaceRoot) {
    const current = this.state.bindings[bindingKey] || {
      threadIdByWorkspaceRoot: {},
    };
    const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
    const threadIdByWorkspaceRoot = {
      ...(current.threadIdByWorkspaceRoot || {}),
    };
    if (normalizedWorkspaceRoot && !(normalizedWorkspaceRoot in threadIdByWorkspaceRoot)) {
      threadIdByWorkspaceRoot[normalizedWorkspaceRoot] = "";
    }

    this.state.bindings[bindingKey] = {
      ...current,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRoot,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.bindings[bindingKey];
  }

  getThreadIdForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    return this.state.bindings[bindingKey]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot] || "";
  }

  listWorkspaces(bindingKey) {
    const binding = this.state.bindings[bindingKey] || {};
    const activeWorkspaceRoot = binding.activeWorkspaceRoot || "";
    const threadIdByWorkspaceRoot = binding.threadIdByWorkspaceRoot || {};
    const workspaceRoots = new Set(Object.keys(threadIdByWorkspaceRoot));
    if (activeWorkspaceRoot) {
      workspaceRoots.add(activeWorkspaceRoot);
    }

    return [...workspaceRoots]
      .sort((left, right) => left.localeCompare(right))
      .map((workspaceRoot) => {
        const currentThreadId = threadIdByWorkspaceRoot[workspaceRoot] || "";

        return {
          workspaceRoot,
          threadId: currentThreadId,
          currentThreadId,
          isActive: workspaceRoot === activeWorkspaceRoot,
        };
      });
  }

  setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, extra = {}) {
    const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.state.bindings[bindingKey] || {};
    const threadIdByWorkspaceRoot = {
      ...(current.threadIdByWorkspaceRoot || {}),
      [normalizedWorkspaceRoot]: threadId,
    };

    this.state.bindings[bindingKey] = {
      ...current,
      ...extra,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRoot,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.bindings[bindingKey];
  }

  clearThreadIdForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.state.bindings[bindingKey] || {};
    const threadIdByWorkspaceRoot = {
      ...(current.threadIdByWorkspaceRoot || {}),
      [normalizedWorkspaceRoot]: "",
    };

    this.state.bindings[bindingKey] = {
      ...current,
      threadIdByWorkspaceRoot,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.bindings[bindingKey];
  }

  buildBindingKey({ workspaceId, chatId, threadKey, senderId, messageId }) {
    const normalizedThreadKey = typeof threadKey === "string" ? threadKey.trim() : "";
    const normalizedMessageId = typeof messageId === "string" ? messageId.trim() : "";
    const hasStableThreadKey = normalizedThreadKey && normalizedThreadKey !== normalizedMessageId;

    if (hasStableThreadKey) {
      return `${workspaceId}:${chatId}:thread:${normalizedThreadKey}`;
    }
    return `${workspaceId}:${chatId}:sender:${senderId}`;
  }
}

module.exports = { SessionStore };
