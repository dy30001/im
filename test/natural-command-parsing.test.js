const assert = require("node:assert/strict");
const test = require("node:test");

const {
  detectNaturalCommand,
  extractBindPath,
  extractEffortValue,
  extractModelValue,
  extractRemoveWorkspacePath,
  extractSwitchThreadId,
  extractNaturalBrowseSelectionIndex,
  extractNaturalThreadSelectionIndex,
  extractNaturalWorkspaceSelectionIndex,
  isBareNaturalSelectionText,
  isNaturalSelectionTextCompatibleWithCommand,
} = require("../src/shared/command-parsing");

test("detectNaturalCommand recognizes conservative natural-language control commands", () => {
  assert.equal(detectNaturalCommand("当前在哪个项目"), "where");
  assert.equal(detectNaturalCommand("查看当前项目"), "where");
  assert.equal(detectNaturalCommand("查看当前目录"), "where");
  assert.equal(detectNaturalCommand("查看当前工作区"), "where");
  assert.equal(detectNaturalCommand("帮我开个新线程"), "new");
  assert.equal(detectNaturalCommand("我想新开一个会话"), "new");
  assert.equal(detectNaturalCommand("先停一下"), "stop");
  assert.equal(detectNaturalCommand("暂停"), "stop");
  assert.equal(detectNaturalCommand("帮我打开目录"), "browse");
  assert.equal(detectNaturalCommand("帮忙打开当前目录"), "browse");
  assert.equal(detectNaturalCommand("打开工程目录"), "browse");
  assert.equal(detectNaturalCommand("打开第二个"), "browse");
  assert.equal(detectNaturalCommand("打开第二个目录"), "browse");
  assert.equal(detectNaturalCommand("查看线程列表"), "threads");
  assert.equal(detectNaturalCommand("现在有哪几个线程"), "threads");
  assert.equal(detectNaturalCommand("切换第二个线程"), "switch");
  assert.equal(detectNaturalCommand("打开第二个线程"), "switch");
  assert.equal(detectNaturalCommand("/codex：查看线程列表"), "threads");
  assert.equal(detectNaturalCommand("查看会话列表"), "threads");
  assert.equal(detectNaturalCommand("查看会话项目"), "workspace");
  assert.equal(detectNaturalCommand("现在有哪几个绑定"), "workspace");
  assert.equal(detectNaturalCommand("切换工程目录"), "workspace");
  assert.equal(detectNaturalCommand("选择第二绑定"), "workspace");
  assert.equal(detectNaturalCommand("状态"), "status");
  assert.equal(detectNaturalCommand("查看最近消息"), "inspect_message");
  assert.equal(detectNaturalCommand("请问怎么用"), "help");
  assert.equal(detectNaturalCommand("命令列表"), "help");
  assert.equal(detectNaturalCommand("同意"), "approve");
  assert.equal(detectNaturalCommand("请同意工作区"), "approve");
  assert.equal(detectNaturalCommand("拒绝"), "reject");
  assert.equal(detectNaturalCommand("请拒绝当前工作区"), "reject");
});

test("extractBindPath supports both explicit and natural-language bind requests", () => {
  assert.equal(
    extractBindPath("/codex bind /Users/dy3000/Documents/test/私人事务/codex-im"),
    "/Users/dy3000/Documents/test/私人事务/codex-im"
  );
  assert.equal(
    extractBindPath("帮我绑定到 /Users/dy3000/Documents/test/私人事务/codex-im"),
    "/Users/dy3000/Documents/test/私人事务/codex-im"
  );
});

test("extractSwitchThreadId supports both explicit and natural-language switch requests", () => {
  const threadId = "019d1ffa-ee21-7ee1-a3c7-bf5cf9fbeffd";
  assert.equal(extractSwitchThreadId(`/codex switch ${threadId}`), threadId);
  assert.equal(extractSwitchThreadId(`切到线程 ${threadId}`), threadId);
});

test("extract natural selection indexes from ordinal phrases", () => {
  assert.equal(extractNaturalThreadSelectionIndex("切换第二个线程"), 2);
  assert.equal(extractNaturalThreadSelectionIndex("打开第 3 个会话"), 3);
  assert.equal(extractNaturalThreadSelectionIndex("现在有哪几个线程"), 0);
  assert.equal(extractNaturalBrowseSelectionIndex("打开第二个"), 2);
  assert.equal(extractNaturalBrowseSelectionIndex("打开第二个目录"), 2);
  assert.equal(extractNaturalWorkspaceSelectionIndex("选择第二绑定"), 2);
  assert.equal(extractNaturalWorkspaceSelectionIndex("切换工程目录 选择 第三个"), 3);
  assert.equal(isBareNaturalSelectionText("第二个"), true);
  assert.equal(isBareNaturalSelectionText("打开第二个"), true);
  assert.equal(isBareNaturalSelectionText("打开第二个目录"), false);
  assert.equal(isBareNaturalSelectionText("选择第二绑定"), false);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个", "threads"), true);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个线程", "threads"), true);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个项目", "workspace"), true);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个绑定", "workspace"), true);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个目录", "browse"), true);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个目录", "threads"), false);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个线程", "workspace"), false);
  assert.equal(isNaturalSelectionTextCompatibleWithCommand("第二个绑定", "browse"), false);
});

test("extractModelValue and extractEffortValue support natural-language settings requests", () => {
  assert.equal(extractModelValue("/codex 刷新模型列表"), "update");
  assert.equal(extractModelValue("帮我设置模型为 gpt-4o"), "gpt-4o");
  assert.equal(extractModelValue("切换到 gpt-4o 模型"), "gpt-4o");
  assert.equal(extractModelValue("把模型调成 gpt-4o"), "gpt-4o");
  assert.equal(extractEffortValue("帮我把推理强度改成 high"), "high");
  assert.equal(extractEffortValue("把推理强度切换到 medium"), "medium");
  assert.equal(extractEffortValue("把推理强度调成 medium"), "medium");
  assert.equal(
    extractRemoveWorkspacePath("帮我解除绑定 /Users/dy3000/Documents/test/私人事务/codex-im"),
    "/Users/dy3000/Documents/test/私人事务/codex-im"
  );
});

test("detectNaturalCommand avoids treating ordinary questions as control commands", () => {
  assert.equal(detectNaturalCommand("帮我看一下这个项目结构"), "");
  assert.equal(detectNaturalCommand("解释一下 openclaw-bot 的启动入口"), "");
  assert.equal(detectNaturalCommand("同意吗"), "");
});
