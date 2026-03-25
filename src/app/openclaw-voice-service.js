function reportVoiceTranscriptionStatus(config) {
  const openclaw = config.openclaw || {};
  if (openclaw.voiceInputEnabled === false) {
    console.warn("[codex-im] voice input frontend disabled: set CODEX_IM_OPENCLAW_VOICE_INPUT_ENABLED=1 to re-enable voice messages");
    return;
  }

  const transcription = openclaw.transcription || {};
  if (!transcription.localFasterWhisperEnabled) {
    console.warn("[codex-im] voice transcription disabled: set CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER=1 and install faster-whisper + ffmpeg");
    return;
  }
  if (typeof fetch !== "function") {
    console.warn("[codex-im] voice transcription unavailable: current runtime lacks fetch support for voice downloads");
  }
}

async function transcribeOpenClawVoiceMessage(runtime, normalized) {
  if (shouldLogVoiceDiagnostics(runtime)) {
    console.log(
      `[codex-im][voice] media-download-start ${JSON.stringify({ traceId: normalized?.traceId || "", messageId: normalized?.messageId || "" })}`
    );
  }
  const media = await runtime.openclawMediaAdapter.downloadVoiceAttachment(normalized?.voiceAttachment, {
    signal: runtime.pollAbortController?.signal,
  });
  if (shouldLogVoiceDiagnostics(runtime)) {
    console.log(
      "[codex-im][voice] media-download-success "
      + JSON.stringify({
        messageId: normalized?.messageId || "",
        traceId: normalized?.traceId || "",
        bytes: Buffer.isBuffer(media?.buffer) ? media.buffer.length : 0,
        mimeType: media?.mimeType || "",
        fileName: media?.fileName || "",
      })
    );
  }
  const result = await runtime.transcriptionClient.transcribeAudio({
    ...media,
    signal: runtime.pollAbortController?.signal,
  });
  if (shouldLogVoiceDiagnostics(runtime)) {
    console.log(
      `[codex-im][voice] stt-success ${JSON.stringify({ traceId: normalized?.traceId || "", messageId: normalized?.messageId || "", textLength: String(result?.text || "").length })}`
    );
  }
  return result.text;
}

function shouldLogVoiceDiagnostics(runtime) {
  return Boolean(runtime?.config?.verboseCodexLogs || runtime?.config?.openclaw?.voiceDiagnosticsEnabled);
}

module.exports = {
  reportVoiceTranscriptionStatus,
  transcribeOpenClawVoiceMessage,
};
