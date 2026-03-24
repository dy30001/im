function extractBindPath(text) {
  return extractCommandArgument(text, "/codex bind ") || extractNaturalBindPath(text);
}

function extractSwitchThreadId(text) {
  return extractCommandArgument(text, "/codex switch ") || extractNaturalSwitchThreadId(text);
}

function extractRemoveWorkspacePath(text) {
  return extractCommandArgument(text, "/codex remove ");
}

function extractSendPath(text) {
  return extractCommandArgument(text, "/codex send ");
}

function extractModelValue(text) {
  return extractCommandArgument(text, "/codex model ");
}

function extractEffortValue(text) {
  return extractCommandArgument(text, "/codex effort ");
}

function extractCommandArgument(text, prefix) {
  const trimmed = String(text || "").trim();
  const normalizedPrefix = String(prefix || "").toLowerCase();
  if (trimmed.toLowerCase().startsWith(normalizedPrefix)) {
    return trimmed.slice(normalizedPrefix.length).trim();
  }
  return "";
}

function detectNaturalCommand(text) {
  const normalized = normalizeNaturalText(text);
  if (!normalized) {
    return "";
  }

  if (extractNaturalBindPath(text) && hasAnyHint(normalized, NATURAL_BIND_HINTS)) {
    return "bind";
  }

  if (extractNaturalSwitchThreadId(text) && hasAnyHint(normalized, NATURAL_SWITCH_HINTS)) {
    return "switch";
  }

  if (NATURAL_WHERE_PHRASES.has(normalized)) {
    return "where";
  }

  if (NATURAL_NEW_PHRASES.has(normalized)) {
    return "new";
  }

  if (NATURAL_STOP_PHRASES.has(normalized)) {
    return "stop";
  }

  return "";
}

function extractNaturalBindPath(text) {
  const normalized = normalizeNaturalText(text);
  if (!normalized || !hasAnyHint(normalized, NATURAL_BIND_HINTS)) {
    return "";
  }
  return extractAbsolutePath(text);
}

function extractNaturalSwitchThreadId(text) {
  const normalized = normalizeNaturalText(text);
  if (!normalized || !hasAnyHint(normalized, NATURAL_SWITCH_HINTS)) {
    return "";
  }
  return extractThreadId(text);
}

function normalizeNaturalText(text) {
  let normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.replace(/[。！？!?，,；;]+$/gu, "");
  normalized = normalized.replace(/^(?:请帮我|帮我|麻烦你|麻烦|请先|请|先|可以|能不能|能否)\s*/u, "");
  return normalized.trim();
}

function extractAbsolutePath(text) {
  const candidates = [];
  const rawText = String(text || "");
  const backtickMatches = rawText.matchAll(/`([^`\n]+)`/g);
  for (const match of backtickMatches) {
    if (match?.[1]) {
      candidates.push(match[1]);
    }
  }

  const unixMatches = rawText.matchAll(/\/[\w.\-~/:@%+\u4e00-\u9fa5/]+/gu);
  for (const match of unixMatches) {
    if (match?.[0]) {
      candidates.push(match[0]);
    }
  }

  const windowsMatches = rawText.matchAll(/[A-Za-z]:\\[\w.\- @%+\u4e00-\u9fa5\\]+/gu);
  for (const match of windowsMatches) {
    if (match?.[0]) {
      candidates.push(match[0]);
    }
  }

  for (const candidate of candidates) {
    const cleaned = cleanPathCandidate(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function cleanPathCandidate(candidate) {
  return String(candidate || "")
    .trim()
    .replace(/[`"'，。！？!?；;]+$/gu, "")
    .replace(/[)\]}]+$/g, "");
}

function extractThreadId(text) {
  const match = String(text || "").match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
  );
  return match?.[0] || "";
}

function hasAnyHint(text, hints) {
  return hints.some((hint) => text.includes(hint));
}

const NATURAL_BIND_HINTS = [
  "绑定",
  "bind",
  "切到项目",
  "切换到项目",
  "切到目录",
  "切换到目录",
];

const NATURAL_SWITCH_HINTS = [
  "切到线程",
  "切换到线程",
  "切线程",
  "切到会话",
  "切换到会话",
  "switch to thread",
  "switch thread",
];

const NATURAL_WHERE_PHRASES = new Set([
  "当前状态",
  "看看当前状态",
  "看下当前状态",
  "查看当前状态",
  "当前在哪",
  "现在在哪",
  "当前在哪个项目",
  "现在在哪个项目",
  "我现在在哪个项目",
  "当前绑的是哪个目录",
  "现在绑的是哪个目录",
]);

const NATURAL_NEW_PHRASES = new Set([
  "开个新线程",
  "新开线程",
  "新建线程",
  "创建新线程",
  "开个新的线程",
  "开个新会话",
  "新建会话",
  "创建新会话",
  "开个新的会话",
]);

const NATURAL_STOP_PHRASES = new Set([
  "停一下",
  "停止一下",
  "停止当前任务",
  "停止当前运行",
  "停止运行",
]);

module.exports = {
  detectNaturalCommand,
  extractBindPath,
  extractEffortValue,
  extractModelValue,
  extractRemoveWorkspacePath,
  extractSendPath,
  extractSwitchThreadId,
};
