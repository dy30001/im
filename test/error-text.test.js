const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildFirstUseWorkspaceGuideText,
  buildMissingWorkspaceGuideText,
} = require("../src/shared/error-text");

test("buildMissingWorkspaceGuideText includes bind and browse guidance", () => {
  const text = buildMissingWorkspaceGuideText();
  assert.match(text, /当前会话还未绑定项目/);
  assert.match(text, /\/codex bind \/绝对路径/);
  assert.match(text, /\/codex browse/);
  assert.match(text, /打开工程目录/);
});

test("buildFirstUseWorkspaceGuideText includes first-use steps", () => {
  const text = buildFirstUseWorkspaceGuideText();
  assert.match(text, /欢迎使用 Codex IM/);
  assert.match(text, /1\. .*\/codex browse/);
  assert.match(text, /2\. .*\/codex bind \/绝对路径/);
  assert.match(text, /切换工程目录/);
});
