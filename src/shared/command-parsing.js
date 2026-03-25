const COMMAND_ROOTS = ["/codex"];

function extractBindPath(text) {
  return extractCommandArgument(text, "bind") || extractNaturalBindPath(text);
}

function extractSwitchThreadId(text) {
  return extractCommandArgument(text, "switch") || extractNaturalSwitchThreadId(text);
}

function extractRemoveWorkspacePath(text) {
  return extractCommandArgument(text, "remove") || extractNaturalRemoveWorkspacePath(text);
}

function extractSendPath(text) {
  return extractCommandArgument(text, "send");
}

function extractModelValue(text) {
  return extractCommandArgument(text, "model") || extractNaturalModelValue(text);
}

function extractEffortValue(text) {
  return extractCommandArgument(text, "effort") || extractNaturalEffortValue(text);
}

function extractNaturalThreadSelectionIndex(text) {
  return extractNaturalOrdinalIndex(text, NATURAL_THREAD_SELECTION_HINTS);
}

function extractNaturalWorkspaceSelectionIndex(text) {
  return extractNaturalOrdinalIndex(text, NATURAL_WORKSPACE_SELECTION_HINTS);
}

function extractNaturalBrowseSelectionIndex(text) {
  return extractNaturalOrdinalIndex(text);
}

function extractNaturalThreadListCommand(text, { allowBare = false } = {}) {
  const normalized = normalizeNaturalText(text).replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }

  if (allowBare) {
    if (matchesNaturalPhrase(normalized, NATURAL_THREAD_LIST_PREV_BARE_PHRASES)) {
      return "prev_page";
    }
    if (matchesNaturalPhrase(normalized, NATURAL_THREAD_LIST_NEXT_BARE_PHRASES)) {
      return "next_page";
    }
    if (matchesNaturalPhrase(normalized, NATURAL_THREAD_LIST_REFRESH_BARE_PHRASES)) {
      return "refresh_threads";
    }
  }

  if (matchesNaturalPhrase(normalized, NATURAL_THREAD_LIST_PREV_PHRASES)) {
    return "prev_page";
  }
  if (matchesNaturalPhrase(normalized, NATURAL_THREAD_LIST_NEXT_PHRASES)) {
    return "next_page";
  }
  if (matchesNaturalPhrase(normalized, NATURAL_THREAD_LIST_REFRESH_PHRASES)) {
    return "refresh_threads";
  }

  return "";
}

function isBareNaturalSelectionText(text) {
  const normalized = normalizeNaturalText(text).replace(/\s+/g, "");
  if (!normalized) {
    return false;
  }

  if (extractNaturalOrdinalIndex(text) <= 0) {
    return false;
  }

  return !hasAnyHint(normalized, NATURAL_SELECTION_CONTEXT_NOUN_HINTS);
}

function isNaturalSelectionTextCompatibleWithCommand(text, command) {
  const normalized = normalizeNaturalText(text).replace(/\s+/g, "");
  const normalizedCommand = String(command || "").trim().toLowerCase();
  if (!normalized || extractNaturalOrdinalIndex(text) <= 0) {
    return false;
  }

  if (normalizedCommand === "threads") {
    return !hasAnyHint(normalized, NATURAL_WORKSPACE_SELECTION_CONTEXT_NOUN_HINTS)
      && !hasAnyHint(normalized, NATURAL_BROWSE_SELECTION_CONTEXT_NOUN_HINTS);
  }

  if (normalizedCommand === "workspace") {
    return !hasAnyHint(normalized, NATURAL_THREAD_SELECTION_CONTEXT_NOUN_HINTS)
      && !hasAnyHint(normalized, NATURAL_BROWSE_SELECTION_CONTEXT_NOUN_HINTS);
  }

  if (normalizedCommand === "browse") {
    return !hasAnyHint(normalized, NATURAL_THREAD_SELECTION_CONTEXT_NOUN_HINTS)
      && !hasAnyHint(normalized, NATURAL_WORKSPACE_SELECTION_CONTEXT_NOUN_HINTS);
  }

  return false;
}

function extractCommandArgument(text, command) {
  const trimmed = String(text || "").trim();
  const normalizedText = trimmed.toLowerCase();
  const normalizedCommand = String(command || "").trim().toLowerCase();
  if (!normalizedCommand) {
    return "";
  }

  for (const root of COMMAND_ROOTS) {
    const prefix = `${root} ${normalizedCommand} `;
    if (normalizedText.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
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

  if (matchesNaturalPhrase(normalized, NATURAL_BROWSE_PHRASES)) {
    return "browse";
  }

  if (matchesNaturalPhrase(normalized, NATURAL_THREADS_PHRASES)) {
    return "threads";
  }

  if (matchesNaturalPhrase(normalized, NATURAL_WORKSPACE_PHRASES)) {
    return "workspace";
  }

  const threadListCommand = extractNaturalThreadListCommand(text, { allowBare: false });
  if (threadListCommand) {
    return threadListCommand;
  }

  if (extractNaturalThreadSelectionIndex(text) > 0 && hasAnyHint(normalized, NATURAL_SELECTION_ACTION_HINTS)) {
    return "switch";
  }

  if (extractNaturalWorkspaceSelectionIndex(text) > 0 && hasAnyHint(normalized, NATURAL_SELECTION_ACTION_HINTS)) {
    return "workspace";
  }

  if (extractNaturalBrowseSelectionIndex(text) > 0 && hasAnyHint(normalized, NATURAL_SELECTION_ACTION_HINTS)) {
    return "browse";
  }

  if (matchesNaturalPhrase(normalized, NATURAL_MESSAGE_PHRASES)) {
    return "inspect_message";
  }

  if (matchesNaturalPhrase(normalized, NATURAL_HELP_PHRASES)) {
    return "help";
  }

  if (matchesNaturalPhrase(normalized, NATURAL_STATUS_PHRASES)) {
    return "status";
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

  if (NATURAL_APPROVE_PHRASES.has(normalized)) {
    return "approve";
  }

  if (NATURAL_REJECT_PHRASES.has(normalized)) {
    return "reject";
  }

  if (extractNaturalRemoveWorkspacePath(text) && hasAnyHint(normalized, NATURAL_REMOVE_HINTS)) {
    return "remove";
  }

  if (extractNaturalModelValue(text)) {
    return "model";
  }

  if (extractNaturalEffortValue(text)) {
    return "effort";
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

function extractNaturalRemoveWorkspacePath(text) {
  const normalized = normalizeNaturalText(text);
  if (!normalized || !hasAnyHint(normalized, NATURAL_REMOVE_HINTS)) {
    return "";
  }
  return extractAbsolutePath(text);
}

function extractNaturalModelValue(text) {
  const normalized = normalizeNaturalText(text);
  if (!normalized) {
    return "";
  }
  if (hasAnyHint(normalized, NATURAL_MODEL_REFRESH_HINTS)) {
    return "update";
  }
  return extractNaturalValue(normalized, NATURAL_MODEL_VALUE_PATTERNS);
}

function extractNaturalEffortValue(text) {
  const normalized = normalizeNaturalText(text);
  if (!normalized) {
    return "";
  }
  return extractNaturalValue(normalized, NATURAL_EFFORT_VALUE_PATTERNS);
}

function extractNaturalOrdinalIndex(text, nounHints = []) {
  const normalized = normalizeNaturalText(text).replace(/\s+/g, "");
  if (!normalized) {
    return 0;
  }

  if (Array.isArray(nounHints) && nounHints.length && !hasAnyHint(normalized, nounHints)) {
    return 0;
  }

  const match = normalized.match(/第([0-9]+|[一二三四五六七八九十两]+)/u);
  if (!match?.[1]) {
    return 0;
  }

  return parseNaturalOrdinalNumber(match[1]);
}

function normalizeNaturalText(text) {
  let normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/\s+/g, " ");
  normalized = stripNaturalCommandRoot(normalized);
  normalized = stripNaturalCommandPrefixes(normalized);
  normalized = normalized.replace(/^[：:，,。！？!?；;]+/gu, "");
  normalized = normalized.replace(/[。！？!?，,；;]+$/gu, "");
  return normalized.trim();
}

function stripNaturalCommandRoot(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }

  for (const root of COMMAND_ROOTS) {
    if (!normalized.startsWith(root)) {
      continue;
    }

    const remainder = normalized.slice(root.length);
    if (!remainder) {
      return normalized;
    }
    if (/^[\s：:，,。！？!?；;]+/u.test(remainder)) {
      return remainder.replace(/^[\s：:，,。！？!?；;]+/u, "").trim();
    }
  }

  return normalized;
}

function stripNaturalCommandPrefixes(text) {
  let normalized = String(text || "").trim();
  if (!normalized) {
    return "";
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of NATURAL_COMMAND_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length).trim();
        normalized = normalized.replace(/^[：:，,。！？!?；;]+/gu, "").trim();
        changed = true;
        break;
      }
    }
  }

  return normalized;
}

function extractNaturalValue(text, patterns) {
  if (!text || !Array.isArray(patterns)) {
    return "";
  }

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanNaturalValueCandidate(match[1]);
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return "";
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

function cleanNaturalValueCandidate(candidate) {
  return String(candidate || "")
    .trim()
    .replace(/^[`"'“”‘’：:，。！？!?；;]+/gu, "")
    .replace(/[`"'“”‘’，。！？!?；;]+$/gu, "")
    .trim();
}

function parseNaturalOrdinalNumber(rawValue) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) {
    return 0;
  }

  if (/^\d+$/.test(normalized)) {
    const value = Number(normalized);
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  const digitMap = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (normalized === "十") {
    return 10;
  }

  if (normalized.includes("十")) {
    const [tensPart = "", onesPart = ""] = normalized.split("十");
    const tens = tensPart ? digitMap[tensPart] || 0 : 1;
    const ones = onesPart ? digitMap[onesPart] || 0 : 0;
    return tens > 0 ? tens * 10 + ones : 0;
  }

  return digitMap[normalized] || 0;
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

function matchesNaturalPhrase(text, phrases) {
  return Array.from(phrases || []).some((phrase) => text === phrase);
}

const NATURAL_BIND_HINTS = [
  "绑定",
  "绑定到",
  "绑定这个",
  "绑定此",
  "绑定当前",
  "绑定目录",
  "绑定项目",
  "绑定工作区",
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
  "切到这个线程",
  "切换到这个线程",
  "切到当前线程",
  "切换当前线程",
  "切到这个会话",
  "切换到这个会话",
  "switch to thread",
  "switch thread",
];

const NATURAL_BROWSE_PHRASES = new Set([
  "浏览目录",
  "浏览一下目录",
  "浏览下目录",
  "浏览项目目录",
  "浏览当前目录",
  "看一下目录",
  "查看一下目录",
  "查看目录",
  "查看项目目录",
  "打开目录",
  "打开目录浏览",
  "打开项目目录",
  "打开当前目录",
  "打开工程目录",
  "看目录",
  "看看目录",
  "看下目录",
  "看一下项目目录",
  "看项目目录",
  "看工程目录",
  "看一下工程目录",
  "看下工程目录",
  "浏览工程目录",
  "查看工程目录",
  "查看一下工程目录",
]);

const NATURAL_THREADS_PHRASES = new Set([
  "线程列表",
  "查看线程列表",
  "查看一下线程列表",
  "看一下线程列表",
  "看看线程列表",
  "看线程列表",
  "看下线程列表",
  "现在有哪几个线程",
  "现在有哪些线程",
  "现在有几个线程",
  "当前有哪几个线程",
  "当前有哪些线程",
  "当前有几个线程",
  "有哪些线程",
  "列出线程列表",
  "查看会话列表",
  "看会话列表",
  "打开会话列表",
  "打开线程列表",
  "查看线程",
  "看线程",
  "打开线程",
  "会话列表",
]);

const NATURAL_THREAD_LIST_PREV_BARE_PHRASES = new Set([
  "上一页",
  "上页",
  "前一页",
]);

const NATURAL_THREAD_LIST_NEXT_BARE_PHRASES = new Set([
  "下一页",
  "下页",
  "后一页",
]);

const NATURAL_THREAD_LIST_REFRESH_BARE_PHRASES = new Set([
  "刷新",
  "刷新一下",
  "重新刷新",
  "重新刷新一下",
  "重刷",
  "重刷一下",
  "重新加载",
  "重新加载一下",
]);

const NATURAL_THREAD_LIST_PREV_PHRASES = new Set([
  "上一页线程",
  "上一页会话",
  "上一页线程列表",
  "上一页会话列表",
  "前一页线程",
  "前一页会话",
  "前一页线程列表",
  "前一页会话列表",
]);

const NATURAL_THREAD_LIST_NEXT_PHRASES = new Set([
  "下一页线程",
  "下一页会话",
  "下一页线程列表",
  "下一页会话列表",
  "后一页线程",
  "后一页会话",
  "后一页线程列表",
  "后一页会话列表",
]);

const NATURAL_THREAD_LIST_REFRESH_PHRASES = new Set([
  "刷新线程列表",
  "刷新会话列表",
  "刷新当前线程列表",
  "刷新当前会话列表",
  "重新加载线程列表",
  "重新加载会话列表",
  "重新刷新线程列表",
  "重新刷新会话列表",
  "重刷线程列表",
  "重刷会话列表",
]);

const NATURAL_WORKSPACE_PHRASES = new Set([
  "查看会话项目",
  "查看一下会话项目",
  "看一下会话项目",
  "看下会话项目",
  "查看绑定项目",
  "查看会话绑定项目",
  "查看已绑定项目",
  "查看当前会话项目",
  "看绑定项目",
  "看下绑定项目",
  "会话项目",
  "看看会话项目",
  "会话项目列表",
  "绑定项目列表",
  "列出会话项目",
  "查看当前绑定目录",
  "查看当前绑定项目",
  "查看已绑定目录",
  "查看已绑定项目",
  "列出绑定目录",
  "列出绑定项目",
  "现在有哪几个绑定",
  "现在有哪些绑定",
  "当前有哪几个绑定",
  "当前有哪些绑定",
  "有哪些绑定",
  "现在有哪几个项目",
  "现在有哪些项目",
  "当前有哪几个项目",
  "当前有哪些项目",
  "有哪些项目",
  "绑定列表",
  "查看绑定列表",
  "看绑定列表",
  "工程目录列表",
  "查看工程目录列表",
  "看工程目录列表",
  "切换工程目录",
  "已绑定目录",
  "已绑定项目",
]);

const NATURAL_MESSAGE_PHRASES = new Set([
  "消息",
  "最近消息",
  "查看最近消息",
  "查看一下最近消息",
  "看一下最近消息",
  "看看最近消息",
  "看最近消息",
  "看下最近消息",
  "查看消息",
  "看消息",
  "消息记录",
  "对话记录",
  "对话列表",
  "消息列表",
  "聊天记录",
  "最近对话",
  "最近聊天",
  "会话消息",
]);

const NATURAL_HELP_PHRASES = new Set([
  "帮助",
  "查看帮助",
  "查看一下帮助",
  "看一下帮助",
  "看看帮助",
  "命令教程",
  "查看命令教程",
  "使用说明",
  "怎么用",
  "如何使用",
  "用法",
  "命令列表",
  "使用方法",
  "查看说明",
]);

const NATURAL_STATUS_PHRASES = new Set([
  "状态",
  "查看状态",
  "查看一下状态",
  "看一下状态",
  "看看状态",
  "看状态",
  "看下状态",
  "状态面板",
  "查看状态面板",
  "查看当前状态",
  "看当前状态",
  "看看当前状态",
  "当前状态",
]);

const NATURAL_SELECTION_ACTION_HINTS = [
  "切换",
  "切到",
  "打开",
  "进入",
  "选择",
  "选",
  "跳到",
  "跳转到",
];

const NATURAL_SELECTION_CONTEXT_NOUN_HINTS = [
  "线程",
  "会话",
  "绑定",
  "项目",
  "工作区",
  "目录",
  "工程目录",
  "文件夹",
  "列表",
  "消息",
  "状态",
];

const NATURAL_THREAD_SELECTION_CONTEXT_NOUN_HINTS = [
  "线程",
  "会话",
];

const NATURAL_WORKSPACE_SELECTION_CONTEXT_NOUN_HINTS = [
  "绑定",
  "项目",
  "工作区",
];

const NATURAL_BROWSE_SELECTION_CONTEXT_NOUN_HINTS = [
  "目录",
  "工程目录",
  "文件夹",
];

const NATURAL_THREAD_SELECTION_HINTS = [
  "线程",
  "会话",
];

const NATURAL_WORKSPACE_SELECTION_HINTS = [
  "绑定",
  "项目",
  "工程目录",
  "工作区",
];

const NATURAL_REMOVE_HINTS = [
  "移除",
  "删除",
  "取消绑定",
  "解除绑定",
  "解绑",
  "移除项目",
  "删除项目",
  "移除当前",
  "删除当前",
  "解绑当前",
  "取消当前绑定",
];

const NATURAL_MODEL_REFRESH_HINTS = [
  "刷新模型列表",
  "更新模型列表",
  "刷新可用模型",
  "更新可用模型",
  "查看可用模型",
  "查看模型列表",
  "列出模型",
  "拉取模型列表",
];

const NATURAL_MODEL_VALUE_PATTERNS = [
  /(?:设置模型(?:为|成|到)?|切换模型(?:为|成|到)?|模型(?:改成|改为|设置为|设为|设成|调成|切成|切换到|切换为|换成)|把模型(?:改成|改为|设置为|设为|设成|调成|切成|切换到|切换为|换成))\s*(.+)$/u,
  /(?:切换到|使用|改用|换成|改成|改为|调成|设成|设为|切成)\s*(.+?)\s*模型$/u,
];

const NATURAL_EFFORT_VALUE_PATTERNS = [
  /(?:设置推理强度(?:为|成|到)?|切换推理强度(?:为|成|到)?|推理强度(?:改成|改为|设置为|设为|设成|调成|切成|切换到|切换为|换成)|把推理强度(?:改成|改为|设置为|设为|设成|调成|切成|切换到|切换为|换成))\s*(.+)$/u,
  /(?:切换到|使用|改用|换成|改成|改为|调成|设成|设为|切成)\s*(.+?)\s*推理强度$/u,
];

const NATURAL_WHERE_PHRASES = new Set([
  "当前状态",
  "看看当前状态",
  "看下当前状态",
  "查看当前状态",
  "查看当前项目",
  "查看一下当前项目",
  "查看下当前项目",
  "查看当前目录",
  "看当前项目",
  "看一下当前项目",
  "看下当前项目",
  "看看当前项目",
  "看当前目录",
  "看一下当前目录",
  "看下当前目录",
  "看看当前目录",
  "当前在哪",
  "现在在哪",
  "当前在哪个项目",
  "现在在哪个项目",
  "我现在在哪个项目",
  "我现在在哪个目录",
  "我在哪个目录",
  "当前绑的是哪个目录",
  "现在绑的是哪个目录",
  "当前目录",
  "当前工作目录",
  "当前工作区",
  "当前工程",
  "查看当前工作区",
  "看当前工作区",
  "查看当前工作目录",
  "看当前工作目录",
  "查看当前工程",
  "看当前工程",
]);

const NATURAL_NEW_PHRASES = new Set([
  "开个新线程",
  "新开线程",
  "新建线程",
  "创建新线程",
  "开新线程",
  "开一个新线程",
  "新开一个线程",
  "开个新的线程",
  "开个新会话",
  "开新会话",
  "开一个新会话",
  "新开一个会话",
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
  "停下",
  "暂停",
  "中止",
  "终止",
  "停止生成",
  "停掉",
  "停止回答",
]);

const NATURAL_APPROVE_PHRASES = new Set([
  "同意",
  "批准",
  "允许",
  "接受",
  "通过",
  "同意工作区",
  "批准工作区",
  "允许工作区",
  "接受工作区",
  "通过工作区",
  "同意当前工作区",
  "批准当前工作区",
  "允许当前工作区",
  "接受当前工作区",
  "通过当前工作区",
]);

const NATURAL_REJECT_PHRASES = new Set([
  "拒绝",
  "驳回",
  "否决",
  "不批准",
  "不允许",
  "不通过",
  "拒绝工作区",
  "驳回工作区",
  "否决工作区",
  "不批准工作区",
  "不允许工作区",
  "不通过工作区",
  "拒绝当前工作区",
  "驳回当前工作区",
  "否决当前工作区",
  "不批准当前工作区",
  "不允许当前工作区",
  "不通过当前工作区",
]);

const NATURAL_COMMAND_PREFIXES = [
  "请问帮我",
  "请帮我",
  "麻烦你帮我",
  "麻烦帮我",
  "我想要",
  "我想",
  "我需要",
  "帮我",
  "帮忙",
  "请问",
  "麻烦你",
  "麻烦",
  "请先",
  "能不能帮我",
  "能否帮我",
  "能不能",
  "能否",
  "可以帮我",
  "可以",
  "先",
  "请",
];

module.exports = {
  COMMAND_ROOTS,
  detectNaturalCommand,
  extractBindPath,
  extractEffortValue,
  extractModelValue,
  extractRemoveWorkspacePath,
  extractSendPath,
  extractNaturalBrowseSelectionIndex,
  extractNaturalThreadListCommand,
  extractNaturalThreadSelectionIndex,
  extractNaturalWorkspaceSelectionIndex,
  isBareNaturalSelectionText,
  isNaturalSelectionTextCompatibleWithCommand,
  extractSwitchThreadId,
};
