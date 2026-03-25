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
  const media = await runtime.openclawMediaAdapter.downloadVoiceAttachment(normalized?.voiceAttachment, {
    signal: runtime.pollAbortController?.signal,
  });
  const result = await runtime.transcriptionClient.transcribeAudio({
    ...media,
    signal: runtime.pollAbortController?.signal,
  });
  return result.text;
}

module.exports = {
  reportVoiceTranscriptionStatus,
  transcribeOpenClawVoiceMessage,
};
