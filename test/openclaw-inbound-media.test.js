const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildInboundAttachmentPrompt,
  prepareOpenClawInboundMessage,
} = require("../src/infra/openclaw/inbound-media");

test("buildInboundAttachmentPrompt appends local attachment paths to the user body", () => {
  const prompt = buildInboundAttachmentPrompt({
    bodyText: "请帮我看一下",
    attachments: [
      {
        kind: "image",
        localPath: "/repo/.codex-im/inbound/msg-1-1.jpg",
        originalFilename: "",
      },
      {
        kind: "file",
        localPath: "/repo/.codex-im/inbound/msg-1-2-report.pdf",
        originalFilename: "report.pdf",
      },
    ],
  });

  assert.match(prompt, /请帮我看一下/);
  assert.match(prompt, /\[图片 1\] \/repo\/.codex-im\/inbound\/msg-1-1\.jpg/);
  assert.match(prompt, /\[文件 2\] \/repo\/.codex-im\/inbound\/msg-1-2-report\.pdf \(原文件名: report\.pdf\)/);
});

test("prepareOpenClawInboundMessage downloads plain image attachments into the workspace", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-image-"));
  const imageBuffer = Buffer.from("plain-image");
  const downloadCalls = [];
  const runtime = {
    openclawAdapter: {
      downloadMedia: async ({ url }) => {
        downloadCalls.push(url);
        return {
          buffer: imageBuffer,
          contentType: "image/png",
        };
      },
    },
  };

  const normalized = await prepareOpenClawInboundMessage(runtime, {
    messageId: "1001",
    text: "",
    attachments: [
      {
        kind: "image",
        downloadUrl: "https://cdn.example.com/raw-image",
        aesKey: "",
        mimeType: "image/png",
        originalFilename: "",
      },
    ],
  }, workspaceRoot);

  const savedPath = normalized.attachments[0].localPath;
  assert.ok(savedPath.startsWith(path.join(workspaceRoot, ".codex-im", "inbound")));
  assert.deepEqual(fs.readFileSync(savedPath), imageBuffer);
  assert.deepEqual(downloadCalls, ["https://cdn.example.com/raw-image"]);
  assert.match(normalized.text, /\[图片 1\]/);
  assert.match(normalized.text, new RegExp(savedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("prepareOpenClawInboundMessage decrypts encrypted file attachments before saving", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-im-openclaw-file-"));
  const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const plaintext = Buffer.from("hello pdf");
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const runtime = {
    openclawAdapter: {
      fetchImpl: async () => ({
        ok: true,
        headers: {
          get(name) {
            return name === "content-type" ? "application/pdf" : "";
          },
        },
        async arrayBuffer() {
          return encrypted;
        },
      }),
    },
  };

  const normalized = await prepareOpenClawInboundMessage(runtime, {
    messageId: "1002",
    text: "帮我读一下这个文件",
    attachments: [
      {
        kind: "file",
        downloadUrl: "https://cdn.example.com/report",
        aesKey: Buffer.from("00112233445566778899aabbccddeeff", "utf8").toString("base64"),
        mimeType: "application/pdf",
        originalFilename: "report.pdf",
      },
    ],
  }, workspaceRoot);

  const savedPath = normalized.attachments[0].localPath;
  assert.ok(savedPath.endsWith(".pdf"));
  assert.deepEqual(fs.readFileSync(savedPath), plaintext);
  assert.match(normalized.text, /帮我读一下这个文件/);
  assert.match(normalized.text, /原文件名: report\.pdf/);
});
