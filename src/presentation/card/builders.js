
// UI card builders extracted from feishu-bot runtime
function buildApprovalCard(approval) {
  const requestType = approval?.method && approval.method.includes("command") ? "命令执行" : "敏感操作";
  const commandLine = formatApprovalCommandInline(approval?.command);
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      enable_forward: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: "**Codex 授权请求**",
          text_size: "notation",
        },
        {
          tag: "markdown",
          content: [
            `请求类型：${requestType}`,
            approval.reason ? `原因：${escapeLarkMd(approval.reason)}` : "",
            commandLine ? `命令：\`${commandLine}\`` : "",
            "请选择处理方式：",
          ].filter(Boolean).join("\n"),
          text_size: "normal",
        },
        {
          tag: "column_set",
          flex_mode: "none",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "本次允许" },
                  type: "primary",
                  value: {
                    kind: "approval",
                    decision: "approve",
                    scope: "once",
                    requestId: approval.requestId,
                    threadId: approval.threadId,
                  },
                },
              ],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "工作区允许" },
                  value: {
                    kind: "approval",
                    decision: "approve",
                    scope: "workspace",
                    requestId: approval.requestId,
                    threadId: approval.threadId,
                  },
                },
              ],
            },
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              elements: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "拒绝" },
                  type: "danger",
                  value: {
                    kind: "approval",
                    decision: "reject",
                    scope: "once",
                    requestId: approval.requestId,
                    threadId: approval.threadId,
                  },
                },
              ],
            },
          ],
        },
        {
          tag: "markdown",
          content: "`工作区允许` 对当前工作区生效，重启后仍保留。",
          text_size: "notation",
        },
      ],
    },
  };
}

function buildAssistantReplyCard({ text, state }) {
  const normalizedState = state || "streaming";
  const stateLabel = normalizedState === "failed"
    ? " · 🔴 执行失败"
    : normalizedState === "completed"
      ? ""
      : " · 🟡 处理中";
  const content = typeof text === "string" && text.trim()
    ? text.trim()
    : normalizedState === "failed"
      ? "执行失败"
      : normalizedState === "completed"
        ? "执行完成"
      : "思考中";

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `**🤖 Codex**${stateLabel}`,
          text_size: "notation",
        },
        { tag: "hr" },
        {
          tag: "markdown",
          content: escapeCardMarkdown(content),
          text_size: "normal",
        },
      ],
    },
  };
}

function buildInfoCard(text, { kind = "info" } = {}) {
  const normalizedText = String(text || "").trim();
  const title = kind === "progress"
    ? "⏳ 处理中"
    : kind === "success"
      ? "✅ 已完成"
      : kind === "error"
        ? "❌ 处理失败"
        : "💬 提示";
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `**${title}**\n\n${normalizedText}`,
          text_size: "normal",
        },
      ],
    },
  };
}

function buildThreadRow({ thread, isCurrent, currentThreadStatusText = "" }) {
  return {
    tag: "column_set",
    flex_mode: "none",
    columns: [
      {
        tag: "column",
        width: "weighted",
        weight: 5,
        vertical_align: "top",
        elements: [
          {
            tag: "markdown",
            content: [
              `${isCurrent ? "🟢 当前" : "⚪ 历史"} · **${formatThreadLabel(thread)}**${isCurrent && currentThreadStatusText ? ` · ${currentThreadStatusText}` : ""}`,
              formatThreadIdLine(thread),
              summarizeThreadPreview(thread),
            ].filter(Boolean).join("\n"),
            text_size: "notation",
          },
        ],
      },
      {
        tag: "column",
        width: "auto",
        vertical_align: "center",
        elements: isCurrent
          ? [
            {
              tag: "column_set",
              flex_mode: "none",
              columns: [
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      text: { tag: "plain_text", content: "最近消息" },
                      type: "primary",
                      value: buildThreadActionValue("messages", thread.id),
                    },
                  ],
                },
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      text: { tag: "plain_text", content: "当前" },
                      type: "default",
                      disabled: true,
                    },
                  ],
                },
              ],
            },
          ]
          : [
            {
              tag: "button",
              text: { tag: "plain_text", content: "切换" },
              type: "primary",
              value: buildThreadActionValue("switch", thread.id),
            },
          ],
      },
    ],
  };
}

function buildStatusPanelCard({
  workspaceRoot,
  threadId,
  currentThread,
  recentThreads,
  totalThreadCount,
  status,
  noticeText = "",
}) {
  const isRunning = status?.code === "running";
  const currentThreadStatusText = status?.code === "running"
    ? "🟡 运行中"
    : status?.code === "approval"
      ? "🟠 等待授权"
      : "";
  const shouldShowAllThreadsButton = Number(totalThreadCount || 0) > 3;
  const threadRows = [];
  const current = threadId ? (currentThread || { id: threadId }) : null;
  if (current) {
    threadRows.push({
      isCurrent: true,
      thread: current,
    });
  }
  for (const thread of (recentThreads || [])) {
    threadRows.push({
      isCurrent: false,
      thread,
    });
  }

  const elements = [];
  if (typeof noticeText === "string" && noticeText.trim()) {
    elements.push({
      tag: "markdown",
      content: `✅ ${escapeCardMarkdown(noticeText.trim())}`,
      text_size: "notation",
    });
  }

  elements.push({
      tag: "column_set",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 5,
          vertical_align: "top",
          elements: [
            {
              tag: "markdown",
              content: [
                `**当前项目**：\`${escapeCardMarkdown(workspaceRoot)}\``,
              ].join(""),
            },
          ],
        },
        {
          tag: "column",
          width: "auto",
          vertical_align: "top",
          elements: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "新建" },
              value: buildPanelActionValue("new_thread"),
            },
          ],
        },
      ],
    }
  );
  elements.push({ tag: "hr" });

  if (threadRows.length) {
    elements.push({
      tag: "markdown",
      content: `**线程列表**（${threadRows.length}）`,
      text_size: "notation",
    });
    threadRows.forEach((row, index) => {
      if (index > 0) {
        elements.push({ tag: "hr" });
      }
      elements.push(buildThreadRow({
        thread: row.thread,
        isCurrent: row.isCurrent,
        currentThreadStatusText,
      }));
    });
  } else {
    elements.push({
      tag: "markdown",
      content: "**线程列表**\n暂无历史线程",
      text_size: "notation",
    });
  }

  const footerColumns = [];
  if (shouldShowAllThreadsButton) {
    footerColumns.push({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "全部线程" },
          value: buildPanelActionValue("open_threads"),
        },
      ],
    });
  }
  if (isRunning) {
    footerColumns.push({
      tag: "column",
      width: "weighted",
      weight: 1,
      elements: [
        {
          tag: "button",
          text: { tag: "plain_text", content: "停止" },
          type: "danger",
          value: buildPanelActionValue("stop"),
        },
      ],
    });
  }
  if (footerColumns.length) {
    elements.push(
      { tag: "hr" },
      {
        tag: "column_set",
        flex_mode: "none",
        columns: footerColumns,
      }
    );
  }

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements,
    },
  };
}

function buildThreadPickerCard({ workspaceRoot, threads, currentThreadId }) {
  const elements = [
    {
      tag: "markdown",
      content: `**当前项目**：\`${escapeCardMarkdown(workspaceRoot)}\``,
    },
    { tag: "hr" },
    {
      tag: "markdown",
      content: `**线程列表**（${Math.min(threads.length, 8)}）`,
      text_size: "notation",
    },
  ];

  threads.slice(0, 8).forEach((thread, index) => {
    if (index > 0) {
      elements.push({ tag: "hr" });
    }
    const isCurrent = thread.id === currentThreadId;
    elements.push(buildThreadRow({
      thread,
      isCurrent,
      currentThreadStatusText: "",
    }));
  });

  elements.push(
    { tag: "hr" },
    {
      tag: "button",
      text: { tag: "plain_text", content: "新建线程" },
      value: buildPanelActionValue("new_thread"),
    }
  );

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements,
    },
  };
}

function buildHelpCardText() {
  const sections = [
    [
      "**直接对话**",
      "绑定项目后，直接发普通消息即可继续当前线程。",
    ],
    [
      "**绑定项目**",
      "`/codex bind /绝对路径`",
      "把当前飞书会话绑定到一个本地项目。",
    ],
    [
      "**查看当前状态**",
      "`/codex where`",
      "查看当前绑定的项目和正在使用的线程。",
    ],
    [
      "**查看最近消息**",
      "`/codex message`",
      "查看当前线程最近几轮对话。",
    ],
    [
      "**查看可用历史线程**",
      "`/codex workspace`",
      "查看当前项目下 Codex runtime 可见的历史线程。",
    ],
    [
      "**移除会话项目绑定**",
      "`/codex remove /绝对路径`",
      "从当前飞书会话中移除指定项目（不能移除当前项目）。",
    ],
    [
      "**切换到指定线程**",
      "`/codex switch <threadId>`",
      "按线程 ID 切换到指定线程。",
    ],
    [
      "**新建线程**",
      "`/codex new`",
      "在当前项目下创建一条新线程并切换过去。",
    ],
    [
      "**中断运行**",
      "`/codex stop`",
      "停止当前线程里正在执行的任务。",
    ],
    [
      "**审批命令**",
      "`/codex approve`\n`/codex approve workspace`\n`/codex reject`",
      "用于处理 Codex 发起的审批请求。",
    ],
  ];

  return [
    "**Codex IM 使用说明**",
    sections.map((section) => section.join("\n")).join("\n\n"),
  ].join("\n\n");
}

function listBoundWorkspaces(binding) {
  const activeWorkspaceRoot = String(binding?.activeWorkspaceRoot || "").trim();
  const threadIdByWorkspaceRoot = binding?.threadIdByWorkspaceRoot
    && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
  const workspaceRoots = new Set(Object.keys(threadIdByWorkspaceRoot));
  if (activeWorkspaceRoot) {
    workspaceRoots.add(activeWorkspaceRoot);
  }

  return [...workspaceRoots]
    .map((workspaceRoot) => String(workspaceRoot || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((workspaceRoot) => ({
      workspaceRoot,
      isActive: workspaceRoot === activeWorkspaceRoot,
      threadId: String(threadIdByWorkspaceRoot[workspaceRoot] || "").trim(),
    }));
}

function buildWorkspaceBindingsCard(items) {
  const elements = [
    {
      tag: "markdown",
      content: `**会话绑定项目**（${items.length}）`,
      text_size: "normal",
    },
  ];

  items.forEach((item, index) => {
    if (index > 0) {
      elements.push({ tag: "hr" });
    }
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 5,
          vertical_align: "top",
          elements: [
            {
              tag: "markdown",
              content: [
                `${item.isActive ? "🟢 当前项目" : "⚪ 已绑定项目"}`,
                `\`${escapeCardMarkdown(item.workspaceRoot)}\``,
                item.threadId ? "" : "线程：未关联",
              ].filter(Boolean).join("\n"),
              text_size: "notation",
            },
          ],
        },
        {
          tag: "column",
          width: "auto",
          vertical_align: "center",
          elements: item.isActive
            ? [
              {
                tag: "column_set",
                flex_mode: "none",
                columns: [
                  {
                    tag: "column",
                    width: "auto",
                    elements: [
                      {
                        tag: "button",
                        text: { tag: "plain_text", content: "线程列表" },
                        type: "primary",
                        value: buildWorkspaceActionValue("status", item.workspaceRoot),
                      },
                    ],
                  },
                  {
                    tag: "column",
                    width: "auto",
                    elements: [
                      {
                        tag: "button",
                        text: { tag: "plain_text", content: "当前" },
                        type: "default",
                        disabled: true,
                      },
                    ],
                  },
                ],
              },
            ]
            : [
              {
                tag: "column_set",
                flex_mode: "none",
                columns: [
                  {
                    tag: "column",
                    width: "auto",
                    elements: [
                      {
                        tag: "button",
                        text: { tag: "plain_text", content: "移除" },
                        type: "default",
                        value: buildWorkspaceActionValue("remove", item.workspaceRoot),
                      },
                    ],
                  },
                  {
                    tag: "column",
                    width: "auto",
                    elements: [
                      {
                        tag: "button",
                        text: { tag: "plain_text", content: "切换" },
                        type: "primary",
                        value: buildWorkspaceActionValue("switch", item.workspaceRoot),
                      },
                    ],
                  },
                ],
              },
            ],
        },
      ],
    });
  });

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements,
    },
  };
}

function buildThreadMessagesSummary({ workspaceRoot, thread, recentMessages }) {
  const sections = [
    `项目：\`${workspaceRoot}\``,
    `当前线程：${formatThreadLabel(thread)}`,
    "***",
    "**对话记录**",
  ];

  if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
    sections.push("空");
    return sections.join("\n\n");
  }

  const normalizedTranscript = recentMessages.map((message) => (
    message.role === "user"
      ? `😄 **你**\n> ${escapeCardMarkdown(message.text).replace(/\n/g, "\n> ")}`
      : `🤖 <font color='blue'>**Codex**</font>\n> ${escapeCardMarkdown(message.text).replace(/\n/g, "\n> ")}`
  ));
  sections.push(normalizedTranscript.join("\n\n---\n\n"));
  return sections.join("\n\n");
}

function mergeReplyText(previousText, nextText) {
  if (!previousText) {
    return nextText;
  }
  if (!nextText) {
    return previousText;
  }
  if (nextText.startsWith(previousText)) {
    return nextText;
  }
  if (previousText.startsWith(nextText)) {
    return previousText;
  }
  return nextText;
}


function buildApprovalResolvedCard(approval) {
  const resolutionLabel = approval.resolution === "approved" ? "已批准" : "已拒绝";
  const colorText = approval.resolution === "approved" ? "green" : "red";
  const commandLine = formatApprovalCommandInline(approval?.command);
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      enable_forward: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `**Codex 授权请求 <font color='${colorText}'>${resolutionLabel}</font>**`,
          text_size: "notation",
        },
        {
          tag: "markdown",
          content: [
            approval.reason ? `原因：${escapeLarkMd(approval.reason)}` : "",
            commandLine ? `命令：\`${commandLine}\`` : "",
          ].filter(Boolean).join("\n"),
          text_size: "normal",
        },
      ],
    },
  };
}

function formatApprovalCommandInline(command) {
  const normalized = typeof command === "string" ? command.trim() : "";
  if (!normalized) {
    return "";
  }
  return normalized.replace(/`/g, "\\`");
}

function formatThreadLabel(thread) {
  if (!thread) {
    return "";
  }

  const title = typeof thread.title === "string" ? thread.title.trim() : "";
  if (!title) {
    return "未命名线程";
  }
  return truncateDisplayText(title, 50);
}

function formatThreadIdLine(thread) {
  const threadId = normalizeIdentifier(thread?.id);
  if (!threadId) {
    return "";
  }
  return `线程ID：\`${escapeCardMarkdown(threadId)}\``;
}

function truncateDisplayText(text, maxLength) {
  const input = String(text || "");
  const chars = Array.from(input);
  if (!Number.isFinite(maxLength) || maxLength <= 0 || chars.length <= maxLength) {
    return input;
  }
  return `${chars.slice(0, maxLength).join("")}...`;
}

function buildPanelActionValue(action) {
  return {
    kind: "panel",
    action,
  };
}

function buildThreadActionValue(action, threadId) {
  return {
    kind: "thread",
    action,
    threadId,
  };
}

function buildWorkspaceActionValue(action, workspaceRoot) {
  return {
    kind: "workspace",
    action,
    workspaceRoot,
  };
}

function summarizeThreadPreview(thread) {
  const updated = formatRelativeTimestamp(thread?.updatedAt);
  return updated ? `更新时间：${updated}` : "更新时间：未知";
}

function formatRelativeTimestamp(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) {
    return `${seconds} 秒前`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} 分钟前`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} 小时前`;
  }
  return `${Math.floor(seconds / 86400)} 天前`;
}

function buildCardToast(text) {
  return buildCardResponse({ toast: text });
}

function buildCardResponse({ toast, card }) {
  const response = {};
  if (toast) {
    response.toast = {
      type: "info",
      content: toast,
    };
  }
  if (card) {
    response.card = {
      type: "raw",
      data: card,
    };
  }
  return response;
}

function escapeCardMarkdown(text) {
  return escapeLarkMd(text);
}

function escapeLarkMd(text) {
  const input = String(text || "");
  return input
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]()#+.!|>~])/g, "\\$1");
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  buildApprovalCard,
  buildApprovalResolvedCard,
  buildAssistantReplyCard,
  buildCardResponse,
  buildCardToast,
  buildHelpCardText,
  buildInfoCard,
  buildStatusPanelCard,
  buildThreadMessagesSummary,
  buildThreadPickerCard,
  buildWorkspaceBindingsCard,
  listBoundWorkspaces,
  mergeReplyText,
};
