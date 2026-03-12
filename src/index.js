const path = require("path");
const os = require("os");
const fs = require("fs");
const dotenv = require("dotenv");

const { readConfig } = require("./config");
const { FeishuBotRuntime } = require("./feishu-bot");

function loadEnv() {
  const cwdEnvPath = path.join(process.cwd(), ".env");
  const userEnvPath = path.join(os.homedir(), ".codex-im", ".env");

  if (fs.existsSync(cwdEnvPath)) {
    dotenv.config({ path: cwdEnvPath });
    return;
  }

  if (fs.existsSync(userEnvPath)) {
    dotenv.config({ path: userEnvPath });
    return;
  }

  dotenv.config();
}

async function main() {
  loadEnv();
  const config = readConfig();

  if (!config.mode || config.mode === "feishu-bot") {
    const runtime = new FeishuBotRuntime(config);
    await runtime.start();
    return;
  }

  console.error("Usage: codex-im [feishu-bot]");
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[codex-im] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
