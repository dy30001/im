// Feishu SDK adapter and compatibility helpers
class FeishuClientAdapter {
  constructor(client) {
    this.client = client;
  }

  async sendFileMessage({ chatId, fileName, fileBuffer, replyToMessageId = "", replyInThread = false }) {
    const fileKey = await this.uploadFile({
      fileName,
      fileBuffer,
    });
    if (!fileKey) {
      throw new Error("Feishu file upload did not return a file_key");
    }

    const content = JSON.stringify({ file_key: fileKey });
    if (replyToMessageId) {
      const replyMessage = resolveReplyMessageMethod(this.client);
      return replyMessage.call(this.client.im?.v1?.message || this.client.im?.message || this.client, {
        path: {
          message_id: normalizeMessageId(replyToMessageId),
        },
        data: {
          msg_type: "file",
          content,
          reply_in_thread: replyInThread,
        },
      });
    }

    const createMessage = resolveCreateMessageMethod(this.client);
    return createMessage.call(this.client.im?.v1?.message || this.client.im?.message || this.client, {
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        msg_type: "file",
        content,
      },
    });
  }

  async sendInteractiveCard({ chatId, card, replyToMessageId = "", replyInThread = false }) {
    if (replyToMessageId) {
      const replyMessage = resolveReplyMessageMethod(this.client);
      return replyMessage.call(this.client.im?.v1?.message || this.client.im?.message || this.client, {
        path: {
          message_id: normalizeMessageId(replyToMessageId),
        },
        data: {
          msg_type: "interactive",
          content: JSON.stringify(card),
          reply_in_thread: replyInThread,
        },
      });
    }

    const createMessage = resolveCreateMessageMethod(this.client);
    return createMessage.call(this.client.im?.v1?.message || this.client.im?.message || this.client, {
      params: {
        receive_id_type: "chat_id",
      },
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
  }

  async patchInteractiveCard({ messageId, card }) {
    const patchMessage = resolvePatchMessageMethod(this.client);
    return patchMessage.call(this.client.im?.v1?.message || this.client.im?.message || this.client, {
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify(card),
      },
    });
  }

  async createReaction({ messageId, emojiType }) {
    const createReaction = resolveCreateReactionMethod(this.client);
    return createReaction.call(
      this.client.im?.v1?.messageReaction || this.client.im?.messageReaction || this.client,
      {
        path: {
          message_id: messageId,
        },
        data: {
          reaction_type: {
            emoji_type: emojiType,
          },
        },
      }
    );
  }

  async deleteReaction({ messageId, reactionId }) {
    const deleteReaction = resolveDeleteReactionMethod(this.client);
    return deleteReaction.call(
      this.client.im?.v1?.messageReaction || this.client.im?.messageReaction || this.client,
      {
        path: {
          message_id: messageId,
          reaction_id: reactionId,
        },
      }
    );
  }

  async uploadFile({ fileName, fileBuffer }) {
    const createFile = resolveCreateFileMethod(this.client);
    const response = await createFile.call(this.client.im?.v1?.file || this.client.im?.file || this.client, {
      data: {
        file_type: "stream",
        file_name: normalizeFileName(fileName),
        file: fileBuffer,
      },
    });
    return normalizeIdentifier(response?.file_key || response?.data?.file_key);
  }
}

function resolveCreateMessageMethod(client) {
  const fn = client?.im?.v1?.message?.create || client?.im?.message?.create;
  if (typeof fn !== "function") {
    throw new Error("Unsupported Feishu SDK shape: missing message.create");
  }
  return fn;
}

function resolveReplyMessageMethod(client) {
  const fn = client?.im?.v1?.message?.reply || client?.im?.message?.reply;
  if (typeof fn !== "function") {
    throw new Error("Unsupported Feishu SDK shape: missing message.reply");
  }
  return fn;
}

function resolvePatchMessageMethod(client) {
  const fn = client?.im?.v1?.message?.patch || client?.im?.message?.patch;
  if (typeof fn !== "function") {
    throw new Error("Unsupported Feishu SDK shape: missing message.patch");
  }
  return fn;
}

function resolveCreateFileMethod(client) {
  const fn = client?.im?.v1?.file?.create || client?.im?.file?.create;
  if (typeof fn !== "function") {
    throw new Error("Unsupported Feishu SDK shape: missing file.create");
  }
  return fn;
}

function normalizeMessageId(messageId) {
  const normalized = typeof messageId === "string" ? messageId.trim() : "";
  if (!normalized) {
    return "";
  }
  return normalized.split(":")[0];
}

function resolveCreateReactionMethod(client) {
  const fn = client?.im?.v1?.messageReaction?.create || client?.im?.messageReaction?.create;
  if (typeof fn !== "function") {
    throw new Error("Unsupported Feishu SDK shape: missing messageReaction.create");
  }
  return fn;
}

function resolveDeleteReactionMethod(client) {
  const fn = client?.im?.v1?.messageReaction?.delete || client?.im?.messageReaction?.delete;
  if (typeof fn !== "function") {
    throw new Error("Unsupported Feishu SDK shape: missing messageReaction.delete");
  }
  return fn;
}

function extractCardChatId(data) {
  return normalizeIdentifier(data?.context?.open_chat_id);
}

function patchWsClientForCardCallbacks(wsClient) {
  if (!wsClient || typeof wsClient.handleEventData !== "function") {
    return;
  }

  const originalHandleEventData = wsClient.handleEventData.bind(wsClient);
  wsClient.handleEventData = (data) => {
    const headers = Array.isArray(data?.headers) ? data.headers : [];
    const messageType = headers.find((header) => header?.key === "type")?.value;
    if (messageType === "card") {
      const patchedData = {
        ...data,
        headers: headers.map((header) => (
          header?.key === "type" ? { ...header, value: "event" } : header
        )),
      };
      return originalHandleEventData(patchedData);
    }
    return originalHandleEventData(data);
  };
}

function normalizeIdentifier(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeFileName(fileName) {
  return typeof fileName === "string" && fileName.trim() ? fileName.trim() : "file";
}

module.exports = {
  FeishuClientAdapter,
  extractCardChatId,
  patchWsClientForCardCallbacks,
};
