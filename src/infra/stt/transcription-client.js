const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const DEFAULT_LOCAL_FASTER_WHISPER_MODEL = "base";
const DEFAULT_LOCAL_FASTER_WHISPER_PYTHON_BIN = "python3";
const DEFAULT_LOCAL_FASTER_WHISPER_SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../scripts/local-faster-whisper-transcribe.py"
);
const DEFAULT_LOCAL_FASTER_WHISPER_CACHE_DIR = path.join(os.tmpdir(), "codex-im-hf-cache");

class LocalFasterWhisperTranscriptionClient {
  constructor({
    localFasterWhisperEnabled = false,
    localFasterWhisperModel = DEFAULT_LOCAL_FASTER_WHISPER_MODEL,
    localFasterWhisperPythonBin = DEFAULT_LOCAL_FASTER_WHISPER_PYTHON_BIN,
    localFasterWhisperScriptPath = DEFAULT_LOCAL_FASTER_WHISPER_SCRIPT_PATH,
    localFasterWhisperCacheDir = DEFAULT_LOCAL_FASTER_WHISPER_CACHE_DIR,
    language = "",
    maxBytes = DEFAULT_MAX_AUDIO_BYTES,
    localFasterWhisperRunner = runLocalFasterWhisperTranscription,
  } = {}) {
    this.localFasterWhisperEnabled = Boolean(localFasterWhisperEnabled);
    this.localFasterWhisperModel = String(localFasterWhisperModel || "").trim() || DEFAULT_LOCAL_FASTER_WHISPER_MODEL;
    this.localFasterWhisperPythonBin = String(localFasterWhisperPythonBin || "").trim() || DEFAULT_LOCAL_FASTER_WHISPER_PYTHON_BIN;
    this.localFasterWhisperScriptPath = String(localFasterWhisperScriptPath || "").trim() || DEFAULT_LOCAL_FASTER_WHISPER_SCRIPT_PATH;
    this.localFasterWhisperCacheDir = String(localFasterWhisperCacheDir || "").trim() || DEFAULT_LOCAL_FASTER_WHISPER_CACHE_DIR;
    this.language = String(language || "").trim();
    this.maxBytes = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0
      ? Number(maxBytes)
      : DEFAULT_MAX_AUDIO_BYTES;
    this.localFasterWhisperRunner = localFasterWhisperRunner;
  }

  async transcribeAudio({ buffer, fileName = "voice-message.mp3", signal } = {}) {
    const audioBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    if (!audioBuffer.length) {
      throw new Error("收到的语音内容为空。");
    }
    if (audioBuffer.length > this.maxBytes) {
      throw new Error(`语音文件超过大小限制（${this.maxBytes} bytes）。`);
    }
    if (!this.usesLocalFasterWhisperMode()) {
      throw new Error(
        "当前仅支持本地faster-whisper转写。请设置 CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER=1，并安装 faster-whisper 与 ffmpeg。"
      );
    }

    return this.transcribeAudioWithLocalFasterWhisper({ audioBuffer, fileName, signal });
  }

  usesLocalFasterWhisperMode() {
    return this.localFasterWhisperEnabled;
  }

  async transcribeAudioWithLocalFasterWhisper({ audioBuffer, fileName = "", signal } = {}) {
    if (typeof this.localFasterWhisperRunner !== "function") {
      throw new Error("本地faster-whisper转写器不可用。");
    }
    return this.localFasterWhisperRunner({
      audioBuffer,
      fileName,
      language: this.language,
      model: this.localFasterWhisperModel,
      pythonBin: this.localFasterWhisperPythonBin,
      scriptPath: this.localFasterWhisperScriptPath,
      cacheDir: this.localFasterWhisperCacheDir,
      signal,
    });
  }
}

function summarizeErrorText(rawText) {
  const normalized = String(rawText || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 300);
}

async function runLocalFasterWhisperTranscription({
  audioBuffer,
  fileName = "",
  language = "",
  model = DEFAULT_LOCAL_FASTER_WHISPER_MODEL,
  pythonBin = DEFAULT_LOCAL_FASTER_WHISPER_PYTHON_BIN,
  scriptPath = DEFAULT_LOCAL_FASTER_WHISPER_SCRIPT_PATH,
  cacheDir = DEFAULT_LOCAL_FASTER_WHISPER_CACHE_DIR,
  signal,
} = {}) {
  const extension = resolveAudioFileExtension(fileName);
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codex-im-faster-whisper-"));
  const audioPath = path.join(tempDir, `audio${extension}`);

  try {
    await ensureLocalFasterWhisperScriptReadable(scriptPath);
    await fs.promises.writeFile(audioPath, audioBuffer);
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const args = [
      scriptPath,
      "--audio",
      audioPath,
      "--model",
      model,
    ];
    if (language) {
      args.push("--language", language);
    }
    const rawStdout = await runProcess({
      command: pythonBin,
      args,
      env: {
        HF_HOME: cacheDir,
        XDG_CACHE_HOME: cacheDir,
      },
      signal,
    });
    let parsed = {};
    try {
      parsed = JSON.parse(rawStdout);
    } catch {
      throw new Error("本地faster-whisper返回了无法解析的JSON。");
    }
    const text = String(parsed?.text || "").trim();
    if (!text) {
      throw new Error("本地faster-whisper返回结果为空。");
    }
    return {
      text,
      raw: parsed,
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ensureLocalFasterWhisperScriptReadable(scriptPath) {
  try {
    await fs.promises.access(scriptPath, fs.constants.R_OK);
  } catch {
    throw new Error(
      `本地faster-whisper脚本不可读：${scriptPath}。请确认文件存在且可读。`
    );
  }
}

function resolveAudioFileExtension(fileName) {
  const ext = path.extname(String(fileName || "").trim());
  return ext || ".mp3";
}

function runProcess({ command, args, env = {}, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";

    const abortHandler = () => {
      child.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
      } else {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (error?.code === "ENOENT") {
        reject(
          new Error(
            `本地faster-whisper执行失败：找不到命令 ${command}。请检查 CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_PYTHON_BIN 配置，并确认 python3 与 ffmpeg 可用。`
          )
        );
        return;
      }
      reject(error);
    });
    child.once("close", (code) => {
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
      if (code !== 0) {
        reject(new Error(`本地faster-whisper执行失败：${summarizeErrorText(stderr) || `exit ${code}`}`));
        return;
      }
      resolve(stdout);
    });
  });
}

module.exports = {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_LOCAL_FASTER_WHISPER_MODEL,
  DEFAULT_LOCAL_FASTER_WHISPER_PYTHON_BIN,
  DEFAULT_LOCAL_FASTER_WHISPER_SCRIPT_PATH,
  DEFAULT_LOCAL_FASTER_WHISPER_CACHE_DIR,
  LocalFasterWhisperTranscriptionClient,
};
