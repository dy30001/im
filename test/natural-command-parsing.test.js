const assert = require("node:assert/strict");
const test = require("node:test");

const {
  detectNaturalCommand,
  extractBindPath,
  extractSwitchThreadId,
} = require("../src/shared/command-parsing");

test("detectNaturalCommand recognizes conservative natural-language control commands", () => {
  assert.equal(detectNaturalCommand("当前在哪个项目"), "where");
  assert.equal(detectNaturalCommand("帮我开个新线程"), "new");
  assert.equal(detectNaturalCommand("先停一下"), "stop");
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

test("detectNaturalCommand avoids treating ordinary questions as control commands", () => {
  assert.equal(detectNaturalCommand("帮我看一下这个项目结构"), "");
  assert.equal(detectNaturalCommand("解释一下 openclaw-bot 的启动入口"), "");
});
