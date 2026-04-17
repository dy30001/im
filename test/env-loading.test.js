const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadEnvFromPaths } = require("../src/index");
const { buildOpenClawEnvLoadPaths } = require("../src/infra/config/config");

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

test("loadEnvFromPaths lets later env files override earlier values when override=true", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-env-override-"));
  const commonEnvPath = path.join(tempDir, ".env.common");
  const instanceEnvPath = path.join(tempDir, ".env.instance");

  fs.writeFileSync(commonEnvPath, [
    "SHARED_VALUE=common",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(instanceEnvPath, [
    "SHARED_VALUE=instance",
    "",
  ].join("\n"), "utf8");

  const previousEnv = {
    SHARED_VALUE: process.env.SHARED_VALUE,
  };
  delete process.env.SHARED_VALUE;

  try {
    loadEnvFromPaths([commonEnvPath]);
    loadEnvFromPaths([instanceEnvPath], { override: true });
    assert.equal(process.env.SHARED_VALUE, "instance");
  } finally {
    restoreEnv(previousEnv);
  }
});

test("buildOpenClawEnvLoadPaths appends the instance env file after common env files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-env-instance-"));
  const previousEnv = {
    CODEX_IM_OPENCLAW_INSTANCE_ID: process.env.CODEX_IM_OPENCLAW_INSTANCE_ID,
    CODEX_IM_OPENCLAW_ENV_FILE: process.env.CODEX_IM_OPENCLAW_ENV_FILE,
  };

  process.env.CODEX_IM_OPENCLAW_INSTANCE_ID = "wx2";
  delete process.env.CODEX_IM_OPENCLAW_ENV_FILE;

  try {
    const envPaths = buildOpenClawEnvLoadPaths({
      cwd: tempDir,
      homeDir: tempDir,
    });
    assert.deepEqual(envPaths, [
      path.join(tempDir, ".env"),
      path.join(tempDir, ".codex-im", ".env"),
      path.join(tempDir, ".codex-im", "openclaw-wx2.env"),
    ]);
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
