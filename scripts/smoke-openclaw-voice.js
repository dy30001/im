#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
loadEnvFromFiles();
const appDispatcher = require("../src/app/dispatcher");
const {
  LocalFasterWhisperTranscriptionClient,
} = require("../src/infra/stt/transcription-client");

async function main() {
  const warnings = [];

  await runVoiceMessageSmoke();
  await runTextPrioritySmoke();
  if (isTruthyEnv("CODEX_IM_VOICE_SMOKE_REAL_STT")) {
    await runRealTranscriptionProbe({
      warnings,
    });
  }

  console.log("[voice-smoke] PASS");
  for (const warning of warnings) {
    console.log(`[voice-smoke] WARN ${warning}`);
  }
}

async function runVoiceMessageSmoke() {
  let transcribeCalled = false;
  let seenCommand = "";
  let seenText = "";

  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext() {},
    async transcribeOpenClawVoiceMessage(normalized) {
      if (!normalized || normalized.inputKind !== "voice") {
        throw new Error("voice event was not normalized as inputKind=voice");
      }
      transcribeCalled = true;
      return "当前在哪个项目";
    },
    async dispatchTextCommand(normalized) {
      seenCommand = normalized?.command || "";
      seenText = normalized?.text || "";
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-smoke",
    message_id: 9001,
    message_type: 3,
    item_list: [
      {
        type: 4,
        voice_item: {
          download_url: "https://ilinkai.weixin.qq.com/media/voice-smoke-1",
          mime_type: "audio/ogg",
          file_name: "voice-smoke-1.ogg",
        },
      },
    ],
  });

  assert(transcribeCalled, "voice smoke did not call transcribeOpenClawVoiceMessage");
  assert(seenCommand === "where", `voice smoke expected command=where, got ${JSON.stringify(seenCommand)}`);
  assert(seenText === "当前在哪个项目", "voice smoke did not propagate transcribed text");
}

async function runTextPrioritySmoke() {
  let transcribeCalled = false;
  let seenCommand = "";
  let seenText = "";

  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext() {},
    async transcribeOpenClawVoiceMessage() {
      transcribeCalled = true;
      return "当前在哪个项目";
    },
    async dispatchTextCommand(normalized) {
      seenCommand = normalized?.command || "";
      seenText = normalized?.text || "";
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-smoke",
    message_id: 9002,
    message_type: 1,
    item_list: [
      {
        type: 1,
        text_item: {
          text: "/codex where",
        },
      },
      {
        type: 4,
        voice_item: {
          download_url: "https://ilinkai.weixin.qq.com/media/voice-smoke-2",
          mime_type: "audio/ogg",
          file_name: "voice-smoke-2.ogg",
        },
      },
    ],
  });

  assert(transcribeCalled === false, "text+voice smoke should prefer text and skip transcription");
  assert(seenCommand === "where", `text+voice smoke expected command=where, got ${JSON.stringify(seenCommand)}`);
  assert(seenText === "/codex where", "text+voice smoke did not keep original text");
}

async function runRealTranscriptionProbe({ warnings }) {
  const localModeEnabled = isTruthyEnv("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER")
    || isTruthyEnv("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER");
  if (!localModeEnabled) {
    warnings.push("real STT probe skipped: set CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER=1 or true");
    return;
  }
  const audioFile = String(process.env.CODEX_IM_VOICE_SMOKE_AUDIO_FILE || "").trim();
  if (!audioFile) {
    warnings.push("real STT probe skipped: set CODEX_IM_VOICE_SMOKE_AUDIO_FILE=/absolute/path/to/audio");
    return;
  }
  if (!path.isAbsolute(audioFile)) {
    throw new Error("CODEX_IM_VOICE_SMOKE_AUDIO_FILE must be an absolute path");
  }
  if (!fs.existsSync(audioFile)) {
    throw new Error(`voice smoke audio file not found: ${audioFile}`);
  }

  const buffer = fs.readFileSync(audioFile);
  const start = Date.now();
  const client = new LocalFasterWhisperTranscriptionClient({
    localFasterWhisperEnabled: true,
    localFasterWhisperModel: String(process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_MODEL || process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_MODEL || "").trim() || undefined,
    localFasterWhisperPythonBin: String(process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_PYTHON || process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_PYTHON || "").trim() || undefined,
    localFasterWhisperScriptPath: String(process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_SCRIPT || process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_SCRIPT || "").trim() || undefined,
    localFasterWhisperCacheDir: String(process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_CACHE_DIR || process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_CACHE_DIR || "").trim() || undefined,
    language: String(process.env.CODEX_IM_OPENCLAW_TRANSCRIPTION_LANGUAGE || "").trim() || undefined,
  });

  const result = await client.transcribeAudio({
    buffer,
    fileName: path.basename(audioFile),
  });
  const elapsedMs = Date.now() - start;
  console.log(
    `[voice-smoke] real_stt_response text_length=${String(result?.text || "").length} elapsed_ms=${elapsedMs}`
  );
  if (!String(result?.text || "").trim()) {
    throw new Error("real STT probe returned empty text");
  }
}

function inferMimeType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  switch (ext) {
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".amr":
      return "audio/amr";
    case ".mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

function loadEnvFromFiles() {
  const dotenv = require("dotenv");
  const projectRoot = path.resolve(__dirname, "..");
  const candidateFiles = [
    path.join(projectRoot, ".env"),
    path.join(projectRoot, ".env.local"),
    path.join(projectRoot, ".env.development"),
    path.join(projectRoot, ".env.production"),
    path.join(os.homedir(), ".zshrc"),
    path.join(os.homedir(), ".zprofile"),
    path.join(os.homedir(), ".profile"),
  ];

  for (const filePath of candidateFiles) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    if (path.basename(filePath).startsWith(".env")) {
      dotenv.config({ path: filePath });
      continue;
    }
    hydrateKeyFromShellFile(filePath);
  }
}

function hydrateKeyFromShellFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_MODEL", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_MODEL", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_PYTHON", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_PYTHON", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_SCRIPT", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_SCRIPT", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_CACHE_DIR", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_WHISPER_CACHE_DIR", line);
    assignIfMissing("CODEX_IM_OPENCLAW_TRANSCRIPTION_LANGUAGE", line);
  }
}

function assignIfMissing(name, shellLine) {
  if (String(process.env[name] || "").trim()) {
    return;
  }
  const match = String(shellLine || "").match(
    new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(["']?)([^"']+)\\1\\s*$`)
  );
  if (!match) {
    return;
  }
  const value = String(match[2] || "").trim();
  if (value) {
    process.env[name] = value;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTruthyEnv(name) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

main().catch((error) => {
  console.error(`[voice-smoke] FAIL ${error.message}`);
  process.exitCode = 1;
});
