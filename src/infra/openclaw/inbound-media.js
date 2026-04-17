const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_INBOUND_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const MIME_TO_EXTENSION = {
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/octet-stream": ".bin",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/plain": ".txt",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
};

async function prepareOpenClawInboundMessage(runtime, normalized, workspaceRoot) {
  const attachments = Array.isArray(normalized?.attachments) ? normalized.attachments : [];
  if (!attachments.length) {
    return normalized;
  }

  const preparedAttachments = [];
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    try {
      const saved = await downloadInboundAttachment(runtime, attachment, {
        workspaceRoot,
        messageId: normalized?.messageId,
        index,
      });
      preparedAttachments.push({
        ...attachment,
        localPath: saved.localPath,
        mimeType: attachment.mimeType || saved.mimeType,
        originalFilename: attachment.originalFilename || saved.originalFilename,
        downloadError: "",
      });
    } catch (error) {
      preparedAttachments.push({
        ...attachment,
        localPath: "",
        downloadError: error?.message || "附件下载失败",
      });
    }
  }

  return {
    ...normalized,
    text: buildInboundAttachmentPrompt({
      bodyText: normalized?.text || "",
      attachments: preparedAttachments,
    }),
    attachments: preparedAttachments,
  };
}

function buildInboundAttachmentPrompt({ bodyText = "", attachments = [] } = {}) {
  const normalizedBodyText = String(bodyText || "").trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  if (!normalizedAttachments.length) {
    return normalizedBodyText;
  }

  const lines = normalizedAttachments.map((attachment, index) => {
    const label = attachmentLabel(attachment?.kind, index);
    const originalFilename = String(attachment?.originalFilename || "").trim();
    const localPath = String(attachment?.localPath || "").trim();
    const downloadError = String(attachment?.downloadError || "").trim();
    if (localPath) {
      return originalFilename
        ? `${label} ${localPath} (原文件名: ${originalFilename})`
        : `${label} ${localPath}`;
    }
    if (downloadError) {
      return `${label} 下载失败: ${downloadError}`;
    }
    return `${label} 未能解析附件内容。`;
  });

  const header = normalizedBodyText
    ? "用户还发送了以下附件，请先查看这些本地文件再继续处理："
    : "用户发送了以下附件，请先查看这些本地文件再继续处理：";

  return [normalizedBodyText, header, ...lines].filter(Boolean).join("\n\n");
}

async function downloadInboundAttachment(runtime, attachment, { workspaceRoot = "", messageId = "", index = 0 } = {}) {
  const downloadUrl = String(attachment?.downloadUrl || "").trim();
  if (!downloadUrl) {
    throw new Error("附件缺少可用下载地址");
  }

  const downloaded = await downloadInboundAttachmentBuffer(runtime, downloadUrl);
  const contentType = normalizeContentType(downloaded.contentType);
  const encryptedBuffer = Buffer.from(downloaded.buffer);
  if (encryptedBuffer.length > MAX_INBOUND_ATTACHMENT_BYTES) {
    throw new Error("附件超过 100MB 限制");
  }

  const decryptedBuffer = maybeDecryptAttachment(encryptedBuffer, attachment);
  const saveDir = await ensureInboundAttachmentDirectory(workspaceRoot);
  const fileName = resolveAttachmentFileName(attachment, {
    contentType,
    messageId,
    index,
  });
  const localPath = path.join(saveDir, fileName);
  await fs.promises.writeFile(localPath, decryptedBuffer);

  return {
    localPath,
    mimeType: resolveAttachmentMimeType(attachment, contentType, fileName),
    originalFilename: String(attachment?.originalFilename || "").trim(),
  };
}

async function downloadInboundAttachmentBuffer(runtime, downloadUrl) {
  if (typeof runtime?.openclawAdapter?.downloadMedia === "function") {
    return runtime.openclawAdapter.downloadMedia({
      url: downloadUrl,
      signal: runtime?.pollAbortController?.signal,
    });
  }

  const fetchImpl = runtime?.openclawAdapter?.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("OpenClaw fetch implementation is unavailable");
  }

  const response = await fetchImpl(downloadUrl, {
    signal: runtime?.pollAbortController?.signal,
  });
  if (!response?.ok) {
    throw new Error(`附件下载失败: ${response?.status || "unknown"}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response?.headers?.get?.("content-type") || "",
  };
}

function maybeDecryptAttachment(buffer, attachment) {
  const key = parseAttachmentAesKey(attachment?.aesKey);
  if (!key) {
    return buffer;
  }

  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

function parseAttachmentAesKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  if (/^[0-9a-fA-F]{32}$/.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
    return Buffer.from(decoded.toString("ascii"), "hex");
  }
  throw new Error("附件密钥格式无效");
}

async function ensureInboundAttachmentDirectory(workspaceRoot) {
  const normalizedWorkspaceRoot = String(workspaceRoot || "").trim();
  const directory = normalizedWorkspaceRoot
    ? path.join(normalizedWorkspaceRoot, ".codex-im", "inbound")
    : path.join(os.homedir(), ".codex-im", "inbound");
  await fs.promises.mkdir(directory, { recursive: true });
  return directory;
}

function resolveAttachmentFileName(attachment, { contentType = "", messageId = "", index = 0 } = {}) {
  const originalFilename = sanitizeFileName(attachment?.originalFilename);
  const originalExt = path.extname(originalFilename);
  const fallbackExt = resolveAttachmentExtension(attachment, contentType);
  const prefix = `msg-${sanitizeFileSegment(messageId || Date.now())}-${index + 1}`;
  if (originalFilename) {
    return `${prefix}-${originalFilename}`;
  }
  return `${prefix}${originalExt || fallbackExt}`;
}

function resolveAttachmentExtension(attachment, contentType) {
  const filename = sanitizeFileName(attachment?.originalFilename);
  const filenameExt = path.extname(filename);
  if (filenameExt) {
    return filenameExt;
  }

  const mimeExt = MIME_TO_EXTENSION[normalizeContentType(attachment?.mimeType || contentType)];
  if (mimeExt) {
    return mimeExt;
  }

  const urlExt = safeUrlExtension(attachment?.downloadUrl);
  if (urlExt) {
    return urlExt;
  }

  return attachment?.kind === "image" ? ".jpg" : ".bin";
}

function resolveAttachmentMimeType(attachment, contentType, fileName) {
  const explicitMime = normalizeContentType(attachment?.mimeType);
  if (explicitMime) {
    return explicitMime;
  }

  const normalizedContentType = normalizeContentType(contentType);
  if (normalizedContentType) {
    return normalizedContentType;
  }

  const extension = path.extname(String(fileName || "")).toLowerCase();
  const match = Object.entries(MIME_TO_EXTENSION).find(([, ext]) => ext === extension);
  return match?.[0] || "application/octet-stream";
}

function normalizeContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function safeUrlExtension(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    const extension = path.extname(parsed.pathname || "").toLowerCase();
    return extension || "";
  } catch {
    return "";
  }
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[\/\\]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function sanitizeFileSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^0-9A-Za-z._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "attachment";
}

function attachmentLabel(kind, index) {
  if (kind === "image") {
    return `[图片 ${index + 1}]`;
  }
  if (kind === "file") {
    return `[文件 ${index + 1}]`;
  }
  return `[附件 ${index + 1}]`;
}

module.exports = {
  buildInboundAttachmentPrompt,
  prepareOpenClawInboundMessage,
};
