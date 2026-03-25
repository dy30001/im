const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const appDispatcher = require("../src/app/dispatcher");
const {
  LocalFasterWhisperTranscriptionClient,
} = require("../src/infra/stt/transcription-client");
const {
  OpenClawMediaAdapter,
  extractVoiceAttachmentFromItemList,
} = require("../src/infra/openclaw/media-adapter");

test("extractVoiceAttachmentFromItemList recognizes audio items with inline data", () => {
  const attachment = extractVoiceAttachmentFromItemList([
    {
      type: 4,
      voice_item: {
        data_url: "data:audio/mpeg;base64,aGVsbG8=",
        file_name: "voice.mp3",
      },
    },
  ]);

  assert.deepEqual(attachment, {
    kind: "voice",
    itemType: 4,
    downloadUrl: "",
    dataUrl: "data:audio/mpeg;base64,aGVsbG8=",
    base64Data: "",
    mimeType: "audio/mpeg",
    fileName: "voice.mp3",
    mediaId: "",
    durationMs: 0,
  });
});

test("extractVoiceAttachmentFromItemList normalizes numeric media_id values", () => {
  const attachment = extractVoiceAttachmentFromItemList([
    {
      type: 4,
      voice_item: {
        media_id: 778899,
        mime_type: "audio/ogg",
      },
    },
  ]);

  assert.equal(attachment?.mediaId, "778899");
  assert.equal(attachment?.mimeType, "audio/ogg");
});

test("OpenClawMediaAdapter decodes inline voice data without downloading", async () => {
  const adapter = new OpenClawMediaAdapter({
    clientAdapter: {
      async downloadMedia() {
        throw new Error("should not download");
      },
    },
  });

  const media = await adapter.downloadVoiceAttachment({
    kind: "voice",
    itemType: 4,
    downloadUrl: "",
    dataUrl: "data:audio/mpeg;base64,aGVsbG8=",
    base64Data: "",
    mimeType: "audio/mpeg",
    fileName: "voice.mp3",
    mediaId: "",
    durationMs: 0,
  });

  assert.equal(media.fileName, "voice.mp3");
  assert.equal(media.mimeType, "audio/mpeg");
  assert.equal(media.buffer.toString("utf8"), "hello");
});

test("OpenClawMediaAdapter downloads voice by media_id when download_url is absent", async () => {
  const adapter = new OpenClawMediaAdapter({
    clientAdapter: {
      async downloadMediaById({ mediaId }) {
        assert.equal(mediaId, "voice-media-1");
        return {
          buffer: Buffer.from("media-by-id"),
          mimeType: "audio/ogg",
          fileName: "",
        };
      },
    },
  });

  const media = await adapter.downloadVoiceAttachment({
    kind: "voice",
    itemType: 4,
    downloadUrl: "",
    dataUrl: "",
    base64Data: "",
    mimeType: "audio/ogg",
    fileName: "voice-1.ogg",
    mediaId: "voice-media-1",
    durationMs: 0,
  });

  assert.equal(media.fileName, "voice-1.ogg");
  assert.equal(media.mimeType, "audio/ogg");
  assert.equal(media.buffer.toString("utf8"), "media-by-id");
});

test("OpenClawMediaAdapter falls back to media_id when download_url fails", async () => {
  const adapter = new OpenClawMediaAdapter({
    clientAdapter: {
      async downloadMedia() {
        throw new Error("downloadMedia 404");
      },
      async downloadMediaById({ mediaId }) {
        assert.equal(mediaId, "voice-media-fallback");
        return {
          buffer: Buffer.from("fallback-by-id"),
          mimeType: "audio/ogg",
          fileName: "",
        };
      },
    },
  });

  const media = await adapter.downloadVoiceAttachment({
    kind: "voice",
    itemType: 4,
    downloadUrl: "https://ilinkai.weixin.qq.com/media/voice-fallback",
    dataUrl: "",
    base64Data: "",
    mimeType: "audio/ogg",
    fileName: "voice-fallback.ogg",
    mediaId: "voice-media-fallback",
    durationMs: 0,
  });

  assert.equal(media.fileName, "voice-fallback.ogg");
  assert.equal(media.mimeType, "audio/ogg");
  assert.equal(media.buffer.toString("utf8"), "fallback-by-id");
});

test("LocalFasterWhisperTranscriptionClient requires local mode to be enabled", async () => {
  const client = new LocalFasterWhisperTranscriptionClient();

  await assert.rejects(
    () => client.transcribeAudio({
      buffer: Buffer.from("voice-bytes"),
      fileName: "voice.mp3",
    }),
    (error) => {
      assert.match(
        error.message,
        /CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER=1/
      );
      return true;
    }
  );
});

test("LocalFasterWhisperTranscriptionClient uses local faster-whisper mode when enabled", async () => {
  const calls = [];
  const client = new LocalFasterWhisperTranscriptionClient({
    localFasterWhisperEnabled: true,
    localFasterWhisperModel: "base",
    localFasterWhisperPythonBin: "python3",
    localFasterWhisperScriptPath: "/tmp/local-faster-whisper-transcribe.py",
    localFasterWhisperCacheDir: "/tmp/local-faster-whisper-cache",
    language: "zh",
    localFasterWhisperRunner: async (options) => {
      calls.push(options);
      return {
        text: "本地离线识别结果",
        raw: { text: "本地离线识别结果" },
      };
    },
  });

  const result = await client.transcribeAudio({
    buffer: Buffer.from("voice-bytes"),
    fileName: "voice.wav",
  });

  assert.equal(result.text, "本地离线识别结果");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "base");
  assert.equal(calls[0].pythonBin, "python3");
  assert.equal(calls[0].scriptPath, "/tmp/local-faster-whisper-transcribe.py");
  assert.equal(calls[0].cacheDir, "/tmp/local-faster-whisper-cache");
  assert.equal(calls[0].language, "zh");
  assert.equal(calls[0].fileName, "voice.wav");
});

test("LocalFasterWhisperTranscriptionClient reports unreadable script path", async () => {
  const client = new LocalFasterWhisperTranscriptionClient({
    localFasterWhisperEnabled: true,
    localFasterWhisperScriptPath: "/tmp/codex-im-missing-local-whisper.py",
  });

  await assert.rejects(
    () => client.transcribeAudio({
      buffer: Buffer.from("voice-bytes"),
      fileName: "voice.mp3",
    }),
    /本地faster-whisper脚本不可读/
  );
});

test("LocalFasterWhisperTranscriptionClient reports missing python command clearly", async () => {
  const client = new LocalFasterWhisperTranscriptionClient({
    localFasterWhisperEnabled: true,
    localFasterWhisperScriptPath: path.resolve(__dirname, "../scripts/local-faster-whisper-transcribe.py"),
    localFasterWhisperPythonBin: "python3-command-not-found",
  });

  await assert.rejects(
    () => client.transcribeAudio({
      buffer: Buffer.from("voice-bytes"),
      fileName: "voice.mp3",
    }),
    /找不到命令 python3-command-not-found/
  );
});

test("onOpenClawTextEvent transcribes voice input and reuses command parsing", async () => {
  const seen = {
    remembered: 0,
    forgotten: 0,
    command: "",
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext(normalized) {
      seen.remembered += 1;
      seen.messageId = normalized.messageId;
    },
    forgetInboundContext() {
      seen.forgotten += 1;
    },
    async transcribeOpenClawVoiceMessage(normalized) {
      assert.equal(normalized.inputKind, "voice");
      return "当前在哪个项目";
    },
    async dispatchTextCommand(normalized) {
      seen.command = normalized.command;
      seen.text = normalized.text;
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 7,
    message_type: 3,
    item_list: [
      {
        type: 4,
        voice_item: {
          download_url: "https://ilinkai.weixin.qq.com/media/voice-7",
          mime_type: "audio/ogg",
          file_name: "voice-7.ogg",
        },
      },
    ],
  });

  assert.equal(seen.remembered, 1);
  assert.equal(seen.forgotten, 0);
  assert.equal(seen.messageId, "7");
  assert.equal(seen.command, "where");
  assert.equal(seen.text, "当前在哪个项目");
});

test("onOpenClawTextEvent skips voice transcription when voice input is disabled", async () => {
  const seen = {
    remembered: 0,
    forgotten: 0,
    transcribed: false,
    dispatched: false,
  };
  const sentMessages = [];
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
      openclaw: {
        voiceInputEnabled: false,
      },
    },
    rememberInboundContext() {
      seen.remembered += 1;
    },
    forgetInboundContext() {
      seen.forgotten += 1;
    },
    async transcribeOpenClawVoiceMessage() {
      seen.transcribed = true;
      throw new Error("should not transcribe");
    },
    async dispatchTextCommand() {
      seen.dispatched = true;
      return true;
    },
    async sendInfoCardMessage(payload) {
      sentMessages.push(payload);
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 8,
    message_type: 3,
    item_list: [
      {
        type: 4,
        voice_item: {
          download_url: "https://ilinkai.weixin.qq.com/media/voice-8",
          mime_type: "audio/ogg",
          file_name: "voice-8.ogg",
        },
      },
    ],
  });

  assert.equal(seen.remembered, 0);
  assert.equal(seen.forgotten, 0);
  assert.equal(seen.transcribed, false);
  assert.equal(seen.dispatched, false);
  assert.deepEqual(sentMessages, []);
});

test("onOpenClawTextEvent keeps plain text working when voice input is disabled", async () => {
  const seen = {
    remembered: 0,
    forgotten: 0,
    transcribed: false,
    dispatched: false,
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
      openclaw: {
        voiceInputEnabled: false,
      },
    },
    rememberInboundContext() {
      seen.remembered += 1;
    },
    forgetInboundContext() {
      seen.forgotten += 1;
    },
    async transcribeOpenClawVoiceMessage() {
      seen.transcribed = true;
      throw new Error("should not transcribe");
    },
    async dispatchTextCommand(normalized) {
      seen.dispatched = true;
      assert.equal(normalized.inputKind, "text");
      assert.equal(normalized.text, "你好");
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 9,
    message_type: 1,
    item_list: [
      {
        type: 1,
        text_item: {
          text: "你好",
        },
      },
    ],
  });

  assert.equal(seen.remembered, 1);
  assert.equal(seen.forgotten, 0);
  assert.equal(seen.transcribed, false);
  assert.equal(seen.dispatched, true);
});

test("onOpenClawTextEvent reports a transcription failure back to the user", async () => {
  const seen = {
    remembered: 0,
    forgotten: 0,
  };
  const sentMessages = [];
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext() {
      seen.remembered += 1;
    },
    forgetInboundContext() {
      seen.forgotten += 1;
    },
    async transcribeOpenClawVoiceMessage() {
      throw new Error("收到语音消息，但当前 payload 没有可下载的媒体地址。");
    },
    async sendInfoCardMessage(payload) {
      sentMessages.push(payload);
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 8,
    message_type: 3,
    context_token: "ctx-8",
    item_list: [
      {
        type: 4,
        voice_item: {
          media_id: "voice-8",
        },
      },
    ],
  });

  assert.deepEqual(sentMessages, [
    {
      chatId: "wx-user-1",
      replyToMessageId: "8",
      contextToken: "ctx-8",
      text: "语音转写失败：收到语音消息，但当前 payload 没有可下载的媒体地址。",
    },
  ]);
  assert.equal(seen.remembered, 0);
  assert.equal(seen.forgotten, 0);
});

test("onOpenClawTextEvent keeps text command when a message also includes voice", async () => {
  const seen = {
    transcribed: false,
    command: "",
    text: "",
    remembered: 0,
    forgotten: 0,
  };
  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
    },
    rememberInboundContext() {
      seen.remembered += 1;
    },
    forgetInboundContext() {
      seen.forgotten += 1;
    },
    async transcribeOpenClawVoiceMessage() {
      seen.transcribed = true;
      return "当前在哪个项目";
    },
    async dispatchTextCommand(normalized) {
      seen.command = normalized.command;
      seen.text = normalized.text;
      return true;
    },
  };

  await appDispatcher.onOpenClawTextEvent(runtime, {
    from_user_id: "wx-user-1",
    message_id: 11,
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
          download_url: "https://ilinkai.weixin.qq.com/media/voice-11",
          mime_type: "audio/ogg",
          file_name: "voice-11.ogg",
        },
      },
    ],
  });

  assert.equal(seen.transcribed, false);
  assert.equal(seen.remembered, 1);
  assert.equal(seen.forgotten, 0);
  assert.equal(seen.command, "where");
  assert.equal(seen.text, "/codex where");
});

test("onOpenClawTextEvent verbose logs avoid dumping transcribed text", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: true,
    },
    rememberInboundContext() {},
    forgetInboundContext() {},
    async transcribeOpenClawVoiceMessage() {
      return "用户敏感语音内容";
    },
    async dispatchTextCommand() {
      return true;
    },
  };

  try {
    await appDispatcher.onOpenClawTextEvent(runtime, {
      from_user_id: "wx-user-1",
      message_id: 12,
      message_type: 3,
      item_list: [
        {
          type: 4,
          voice_item: {
            download_url: "https://ilinkai.weixin.qq.com/media/voice-12",
            mime_type: "audio/ogg",
            file_name: "voice-12.ogg",
          },
        },
      ],
    });
  } finally {
    console.log = originalLog;
  }

  const verboseLine = logs.find((line) => line.includes("openclaw transcribed voice"));
  assert.ok(verboseLine);
  assert.match(verboseLine, /text_length=\d+/);
  assert.equal(verboseLine.includes("用户敏感语音内容"), false);
});

test("onOpenClawTextEvent logs voice diagnostics when voice-like payload is dropped before normalization", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(" "));
  };

  const runtime = {
    isStopping: false,
    config: {
      defaultWorkspaceId: "default",
      verboseCodexLogs: false,
      openclaw: {
        voiceDiagnosticsEnabled: true,
      },
    },
    async dispatchTextCommand() {
      return true;
    },
  };

  try {
    await appDispatcher.onOpenClawTextEvent(runtime, {
      from_user_id: "wx-user-1",
      message_id: 13,
      message_type: 3,
      item_list: [
        {
          type: 4,
          voice_item: {},
        },
      ],
    });
  } finally {
    console.log = originalLog;
  }

  const ingress = logs.find((line) => line.includes("[codex-im][voice] ingress"));
  const drop = logs.find((line) => line.includes("[codex-im][voice] drop"));
  assert.ok(ingress);
  assert.ok(drop);
  assert.match(drop, /normalize-returned-null/);
});
