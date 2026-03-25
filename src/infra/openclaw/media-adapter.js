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
      let downloaded = null;
      try {
        downloaded = await this.clientAdapter.downloadMedia({
          downloadUrl: attachment.downloadUrl,
          signal,
        });
      } catch (error) {
        if (!attachment.mediaId || !this.clientAdapter || typeof this.clientAdapter.downloadMediaById !== "function") {
          throw error;
        }
        downloaded = await this.clientAdapter.downloadMediaById({
          mediaId: attachment.mediaId,
          signal,
        });
      }
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
    {
      kind: "voice",
      payload: pickFirstObject(
        item.voice_item,
        item.voiceItem,
        item.record_item,
        item.recordItem,
        item.voice,
        item.record
      ),
    },
    {
      kind: "audio",
      payload: pickFirstObject(item.audio_item, item.audioItem, item.audio),
    },
    {
      kind: "media",
      payload: pickFirstObject(item.media_item, item.mediaItem, item.media),
    },
    {
      kind: "file",
      payload: pickFirstObject(item.file_item, item.fileItem, item.file),
    },
  ];

  for (const candidate of containers) {
    const normalized = normalizeVoiceAttachment(item, candidate.kind, candidate.payload);
    if (normalized) {
      return normalized;
    }
  }

  const fallback = normalizeVoiceAttachment(item, inferFallbackKind(item), item);
  if (fallback) {
    return fallback;
  }

  return null;
}

function normalizeVoiceAttachment(item, kind, payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const nestedMediaPayload = pickFirstObject(
    payload.media,
    payload.mediaItem,
    payload.media_item
  );
  const sourcePayload = nestedMediaPayload || payload;

  const downloadUrl = normalizeText(
    sourcePayload.download_url
      || sourcePayload.downloadUrl
      || sourcePayload.downloadurl
      || sourcePayload.file_download_url
      || sourcePayload.fileDownloadUrl
      || sourcePayload.media_url
      || sourcePayload.mediaUrl
      || sourcePayload.voice_url
      || sourcePayload.voiceUrl
      || sourcePayload.file_url
      || sourcePayload.fileUrl
      || sourcePayload.cdn_url
      || sourcePayload.cdnUrl
      || sourcePayload.oss_url
      || sourcePayload.ossUrl
      || sourcePayload.url
      || payload.download_url
      || payload.downloadUrl
      || payload.downloadurl
      || payload.file_download_url
      || payload.fileDownloadUrl
      || payload.media_url
      || payload.mediaUrl
      || payload.voice_url
      || payload.voiceUrl
      || payload.file_url
      || payload.fileUrl
      || payload.cdn_url
      || payload.cdnUrl
      || payload.oss_url
      || payload.ossUrl
      || payload.url
      || item.download_url
      || item.downloadUrl
      || item.voice_url
      || item.voiceUrl
      || item.file_url
      || item.fileUrl
      || item.url
  );
  const dataUrl = normalizeText(
    sourcePayload.data_url
      || sourcePayload.dataUrl
      || sourcePayload.dataurl
      || payload.data_url
      || payload.dataUrl
      || payload.dataurl
      || item.data_url
      || item.dataUrl
  );
  const base64Data = normalizeText(
    sourcePayload.base64
      || sourcePayload.base64_data
      || sourcePayload.base64Data
      || sourcePayload.data
      || payload.base64
      || payload.base64_data
      || payload.base64Data
      || payload.data
      || item.base64
      || item.base64_data
      || item.base64Data
      || ""
  );
  const fileName = normalizeText(
    sourcePayload.file_name
      || sourcePayload.fileName
      || payload.file_name
      || payload.fileName
      || item.file_name
      || item.fileName
  ) || inferDefaultFileName(
    sourcePayload.mime_type
      || sourcePayload.mimeType
      || payload.mime_type
      || payload.mimeType
      || item.mime_type
      || item.mimeType
  );
  const mimeType = normalizeText(
    sourcePayload.mime_type
      || sourcePayload.mimeType
      || payload.mime_type
      || payload.mimeType
      || item.mime_type
      || item.mimeType
  ) || inferMimeTypeFromFileName(fileName);
  const mediaId = normalizeText(
    sourcePayload.media_id
      || sourcePayload.mediaId
      || sourcePayload.mediaid
      || sourcePayload.file_id
      || sourcePayload.fileId
      || sourcePayload.fileid
      || sourcePayload.voice_id
      || sourcePayload.voiceId
      || sourcePayload.attach_id
      || sourcePayload.attachId
      || payload.media_id
      || payload.mediaId
      || payload.mediaid
      || payload.file_id
      || payload.fileId
      || payload.fileid
      || payload.voice_id
      || payload.voiceId
      || payload.attach_id
      || payload.attachId
      || item.media_id
      || item.mediaId
      || item.file_id
      || item.fileId
      || item.attach_id
      || item.attachId
  );
  const durationMs = normalizePositiveNumber(
    sourcePayload.duration_ms
      ?? sourcePayload.durationMs
      ?? payload.duration_ms
      ?? payload.durationMs
      ?? item.duration_ms
      ?? item.durationMs
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
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function pickFirstObject(...candidates) {
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      return candidate;
    }
  }
  return null;
}

function inferFallbackKind(item) {
  const itemType = Number(item?.type);
  if (itemType === 3 || itemType === 4) {
    return "voice";
  }
  if (itemType === 6) {
    return "audio";
  }
  if (itemType === 5) {
    return "file";
  }
  return "media";
}

module.exports = {
  OpenClawMediaAdapter,
  extractVoiceAttachmentFromItemList,
};
