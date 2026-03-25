function extractErrorMessage(error, fallback = "未知错误") {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function formatFailureText(prefix, error, fallback = "未知错误") {
  return `${prefix}：${extractErrorMessage(error, fallback)}`;
}

function buildMissingWorkspaceGuideText() {
  return [
    "当前会话还未绑定项目。",
    "你可以先执行：",
    "`/codex bind /绝对路径`",
    "或先执行：",
    "`/codex browse`",
    "也可以直接说：`打开工程目录`",
  ].join("\n");
}

function buildFirstUseWorkspaceGuideText() {
  return [
    "欢迎使用 Codex IM。",
    "当前会话还未绑定项目，请先完成这一步：",
    "1. `/codex browse` 选择工程目录",
    "2. 或 `/codex bind /绝对路径` 直接绑定",
    "3. 也可以直接说：`打开工程目录`",
    "",
    "绑定后常用：`当前在哪个项目`、`切换工程目录`、`查看线程列表`",
  ].join("\n");
}

module.exports = {
  buildFirstUseWorkspaceGuideText,
  buildMissingWorkspaceGuideText,
  extractErrorMessage,
  formatFailureText,
};
