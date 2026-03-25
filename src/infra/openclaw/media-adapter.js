const path = require("node:path");

class OpenClawMediaAdapter {
  constructor({ clientAdapter } = {}) {
    this.clientAdapter = clientAdapter;
  }

  async downloadVoiceAttachment(attachment, { signal } = {}) {
    if (!attachment || typeof attachment !== "object") {
      throw new Error("收到语音消息，但缺少媒体描述。");
    }

    if (attachment.dataUrl) {
      return decodeDataUrlAttachment(attachment);
    }
    if (attachment.base64Data) {
      return decodeBase64Attachment(attachment);
    }
    if (attachment.downloadUrl) {
      if (!this.clientAdapter || typeof this.clientAdapter.downloadMedia !== "function") {
        throw new Error("语音媒体下载器不可用。");
      }
      const downloaded = await this.clientAdapter.downloadMedia({
        downloadUrl: attachment.downloadUrl,
        signal,
      });
      return {
        ...downloaded,
        fileName: attachment.fileName || downloaded.fileName || inferDefaultFileName(attachment.mimeType),
        mimeType: downloaded.mimeType || attachment.mimeType || "application/octet-stream",
      };
    }
    if (attachment.mediaId) {
      if (!this.clientAdapter || typeof this.clientAdapter.downloadMediaById !== "function") {
        throw new Error("收到语音消息，但只有 media_id/file_id，当前适配器不支持按 media_id 下载。");
      }
      const downloaded = await this.clientAdapter.downloadMediaById({
        mediaId: attachment.mediaId,
        signal,
      });
      return {
        ...downloaded,
        fileName: attachment.fileName || downloaded.fileName || inferDefaultFileName(attachment.mimeType),
        mimeType: downloaded.mimeType || attachment.mimeType || "application/octet-stream",
      };
    }

    throw new Error("收到语音消息，但当前 payload 没有可下载的媒体地址。");
  }
}

function extractVoiceAttachmentFromItemList(itemList) {
  if (!Array.isArray(itemList)) {
    return null;
  }

  for (const item of itemList) {
    const attachment = extractVoiceAttachmentFromItem(item);
    if (attachment) {
      return attachment;
    }
  }
  return null;
}

function extractVoiceAttachmentFromItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const containers = [
    { kind: "voice", payload: item.voice_item },
    { kind: "audio", payload: item.audio_item },
    { kind: "media", payload: item.media_item },
    { kind: "file", payload: item.file_item },
  ];

  for (const candidate of containers) {
    const normalized = normalizeVoiceAttachment(item, candidate.kind, candidate.payload);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeVoiceAttachment(item, kind, payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const downloadUrl = normalizeText(
    payload.download_url || payload.downloadUrl || payload.url || item.download_url || item.url
  );
  const dataUrl = normalizeText(
    payload.data_url || payload.dataUrl || item.data_url || item.dataUrl
  );
  const base64Data = normalizeText(payload.base64 || payload.data || item.base64 || "");
  const fileName = normalizeText(
    payload.file_name || payload.fileName || item.file_name || item.fileName
  ) || inferDefaultFileName(payload.mime_type || payload.mimeType || item.mime_type || item.mimeType);
  const mimeType = normalizeText(
    payload.mime_type || payload.mimeType || item.mime_type || item.mimeType
  ) || inferMimeTypeFromFileName(fileName);
  const mediaId = normalizeText(
    payload.media_id || payload.mediaId || payload.file_id || payload.fileId || item.media_id || item.file_id
  );
  const durationMs = normalizePositiveNumber(
    payload.duration_ms ?? payload.durationMs ?? item.duration_ms ?? item.durationMs
  );

  const looksAudio = looksLikeAudio(kind, mimeType, fileName);
  if (!looksAudio) {
    return null;
  }

  if (!downloadUrl && !dataUrl && !base64Data && !mediaId) {
    return null;
  }

  return {
    kind,
    itemType: normalizeItemType(item?.type),
    downloadUrl,
    dataUrl,
    base64Data,
    mimeType,
    fileName,
    mediaId,
    durationMs,
  };
}

function decodeDataUrlAttachment(attachment) {
  const match = String(attachment.dataUrl || "").match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) {
    throw new Error("语音数据 URL 不是有效的 base64 编码。");
  }

  const mimeType = normalizeText(match[1]) || attachment.mimeType || "application/octet-stream";
  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType,
    fileName: attachment.fileName || inferDefaultFileName(mimeType),
  };
}

function decodeBase64Attachment(attachment) {
  return {
    buffer: Buffer.from(String(attachment.base64Data || ""), "base64"),
    mimeType: attachment.mimeType || "application/octet-stream",
    fileName: attachment.fileName || inferDefaultFileName(attachment.mimeType),
  };
}

function looksLikeAudio(kind, mimeType, fileName) {
  if (kind === "voice" || kind === "audio") {
    return true;
  }
  if (String(mimeType || "").toLowerCase().startsWith("audio/")) {
    return true;
  }
  return /\.(mp3|m4a|wav|ogg|aac|amr|opus)$/i.test(String(fileName || ""));
}

function inferDefaultFileName(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("ogg")) {
    return "voice-message.ogg";
  }
  if (normalized.includes("wav")) {
    return "voice-message.wav";
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "voice-message.m4a";
  }
  return "voice-message.mp3";
}

function inferMimeTypeFromFileName(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  switch (extension) {
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
      return "";
  }
}

function normalizePositiveNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

function normalizeItemType(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  OpenClawMediaAdapter,
  extractVoiceAttachmentFromItemList,
};
