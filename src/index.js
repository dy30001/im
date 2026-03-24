const path = require("path");
const os = require("os");
const fs = require("fs");
const dotenv = require("dotenv");

const { readConfig } = require("./infra/config/config");
const { FeishuBotRuntime } = require("./app/feishu-bot-runtime");
const { OpenClawBotRuntime } = require("./app/openclaw-bot-runtime");

let shutdownHooksInstalled = false;

function loadEnv() {
  ensureDefaultConfigDirectory();

  const envCandidates = [
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".codex-im", ".env"),
  ];

  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    dotenv.config({ path: envPath });
    return;
  }

  dotenv.config();
}

function ensureDefaultConfigDirectory() {
  const defaultConfigDir = path.join(os.homedir(), ".codex-im");
  fs.mkdirSync(defaultConfigDir, { recursive: true });
}

async function main() {
  loadEnv();
  const config = readConfig();

  if (!config.mode || config.mode === "feishu-bot") {
    const runtime = new FeishuBotRuntime(config);
    installShutdownHooks(runtime);
    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop().catch((stopError) => {
        console.error(`[codex-im] failed to stop runtime after startup error: ${stopError.message}`);
      });
      throw error;
    }
    return;
  }

  if (config.mode === "openclaw-bot") {
    const runtime = new OpenClawBotRuntime(config);
    installShutdownHooks(runtime);
    try {
      await runtime.start();
    } catch (error) {
      await runtime.stop().catch((stopError) => {
        console.error(`[codex-im] failed to stop runtime after startup error: ${stopError.message}`);
      });
      throw error;
    }
    return;
  }

  console.error("Usage: codex-im [feishu-bot|openclaw-bot]");
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[codex-im] ${error.message}`);
    process.exit(1);
  });
}

function installShutdownHooks(runtime) {
  if (shutdownHooksInstalled) {
    return;
  }

  shutdownHooksInstalled = true;
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await runtime.stop();
    } catch (error) {
      console.error(`[codex-im] shutdown failed for ${signal}: ${error.message}`);
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

module.exports = { main };
