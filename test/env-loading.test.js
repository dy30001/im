const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadEnvFromPaths } = require("../src/index");

test("loadEnvFromPaths loads both local and home env files in order", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-env-"));
  const localEnvPath = path.join(tempDir, ".env.local");
  const homeEnvPath = path.join(tempDir, ".env.home");

  fs.writeFileSync(localEnvPath, [
    "LOCAL_ONLY=local",
    "SHARED_VALUE=local",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(homeEnvPath, [
    "HOME_ONLY=home",
    "SHARED_VALUE=home",
    "",
  ].join("\n"), "utf8");

  const previousEnv = {
    LOCAL_ONLY: process.env.LOCAL_ONLY,
    HOME_ONLY: process.env.HOME_ONLY,
    SHARED_VALUE: process.env.SHARED_VALUE,
  };
  delete process.env.LOCAL_ONLY;
  delete process.env.HOME_ONLY;
  delete process.env.SHARED_VALUE;

  try {
    loadEnvFromPaths([localEnvPath, homeEnvPath]);

    assert.equal(process.env.LOCAL_ONLY, "local");
    assert.equal(process.env.HOME_ONLY, "home");
    assert.equal(process.env.SHARED_VALUE, "local");
  } finally {
    restoreEnv(previousEnv);
  }
});

function restoreEnv(previousEnv) {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (typeof value === "string") {
      process.env[name] = value;
    } else {
      delete process.env[name];
    }
  }
}
