const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  isAbsoluteWorkspacePath,
  isWorkspaceAllowed,
  normalizeWorkspacePath,
} = require("../../shared/workspace-paths");
const { formatFailureText } = require("../../shared/error-text");

const MAX_WORKSPACE_BROWSER_ENTRIES = 20;

// Browsing and direct bind must share the same root calculation so users
// cannot widen access by switching from card actions to text commands.
function resolveBrowseRoots(runtime) {
  const allowlist = Array.isArray(runtime.config.workspaceAllowlist)
    ? runtime.config.workspaceAllowlist
      .map((workspaceRoot) => normalizeWorkspacePath(workspaceRoot))
      .filter((workspaceRoot) => isAbsoluteWorkspacePath(workspaceRoot))
    : [];
  if (allowlist.length) {
    return [...new Set(allowlist)].sort((left, right) => left.localeCompare(right));
  }
  const homeDirectory = normalizeWorkspacePath(os.homedir());
  return homeDirectory ? [homeDirectory] : [];
}

async function resolveWorkspaceBrowserState(runtime, { browseRoots, requestedPath }) {
  if (!requestedPath) {
    if (browseRoots.length === 1) {
      return readWorkspaceDirectory(runtime, browseRoots[0], browseRoots);
    }
    return {
      currentPath: "",
      entries: browseRoots.map((workspaceRoot) => ({
        kind: "directory",
        name: workspaceRoot,
        path: workspaceRoot,
      })),
      canGoUp: false,
      parentPath: "",
      scopeText: `浏览范围：以下 ${browseRoots.length} 个目录根允许绑定。`,
      emptyText: "当前没有可选的目录根。",
      truncated: false,
    };
  }

  const normalizedPath = normalizeWorkspacePath(requestedPath);
  if (!isAbsoluteWorkspacePath(normalizedPath)) {
    return { errorText: "目标目录无效，请刷新后重试。" };
  }
  if (!isWorkspaceAllowed(normalizedPath, browseRoots)) {
    return { errorText: "该目录不在允许浏览的范围内。" };
  }
  return readWorkspaceDirectory(runtime, normalizedPath, browseRoots);
}

async function readWorkspaceDirectory(runtime, currentPath, browseRoots) {
  const stats = await runtime.resolveWorkspaceStats(currentPath);
  if (!stats.exists) {
    return { errorText: `目录不存在: ${currentPath}` };
  }
  if (!stats.isDirectory) {
    return { errorText: `路径非法: ${currentPath}` };
  }

  let dirents;
  try {
    dirents = await fs.promises.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    return { errorText: formatFailureText("读取目录失败", error) };
  }

  const parentPath = resolveWorkspaceBrowserParentPath(currentPath, browseRoots);
  const entries = dirents
    .map((dirent) => buildWorkspaceBrowserEntry(currentPath, dirent))
    .filter(Boolean)
    .sort(compareWorkspaceBrowserEntries)
    .slice(0, MAX_WORKSPACE_BROWSER_ENTRIES);

  return {
    currentPath,
    entries,
    canGoUp: !!parentPath,
    parentPath,
    scopeText: buildWorkspaceBrowserScopeText(browseRoots),
    emptyText: "当前目录为空。",
    truncated: dirents.length > MAX_WORKSPACE_BROWSER_ENTRIES,
  };
}

function resolveWorkspaceBrowserParentPath(currentPath, browseRoots) {
  const parentPath = normalizeWorkspacePath(path.dirname(currentPath));
  if (!parentPath || parentPath === currentPath) {
    return "";
  }
  return isWorkspaceAllowed(parentPath, browseRoots) ? parentPath : "";
}

function buildWorkspaceBrowserEntry(currentPath, dirent) {
  const name = String(dirent?.name || "").trim();
  if (!name || name === "." || name === "..") {
    return null;
  }
  return {
    kind: dirent.isDirectory() ? "directory" : "file",
    name,
    path: normalizeWorkspacePath(path.join(currentPath, name)),
  };
}

function compareWorkspaceBrowserEntries(left, right) {
  const leftRank = left.kind === "directory" ? 0 : 1;
  const rightRank = right.kind === "directory" ? 0 : 1;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return left.name.localeCompare(right.name);
}

function buildWorkspaceBrowserScopeText(browseRoots) {
  if (!Array.isArray(browseRoots) || !browseRoots.length) {
    return "";
  }
  if (browseRoots.length === 1) {
    return `浏览范围：${browseRoots[0]}`;
  }
  return `浏览范围：共 ${browseRoots.length} 个允许目录根。`;
}

module.exports = {
  resolveBrowseRoots,
  resolveWorkspaceBrowserState,
};
