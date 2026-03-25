# codex-im

`codex-im` 是一个用于 **Codex 连接微信（OpenClaw 协议）** 的本地桥接插件。  
消息链路：

`微信 -> OpenClaw HTTP API -> 本机 codex app-server -> 微信回复`

仓库地址：`https://github.com/dy30001/im`

## 一键安装 + 启动（推荐）

```bash
git clone https://github.com/dy30001/im.git
cd codex-im
bash ./scripts/bootstrap-openclaw.sh
```

这个脚本会自动做这些事：

1. 检查 Node.js（要求 18+）
2. 自动生成 `.env`（如果不存在）
3. 自动安装 npm 依赖
4. 自动安装本地语音依赖（`faster-whisper`、`ffmpeg-python`，可选）
5. 拉起 `openclaw-bot`
6. 如果 `.env` 里 `CODEX_IM_OPENCLAW_TOKEN` 为空，会自动触发微信二维码登录，并尝试自动打开浏览器

## 依赖要求

- Node.js 18+
- npm
- 已可用的 Codex CLI / Codex app-server 环境
- （语音可选）Python3 + `ffmpeg`

如果只先跑文本模式，不装语音也可以使用。

## 让 Codex 直接按 README 自动部署

你可以直接把下面这句话发给 Codex：

```text
请在仓库根目录执行：bash ./scripts/bootstrap-openclaw.sh
```

脚本会自动安装并启动。首次未配置 token 时，会自动进入扫码登录流程。

## 首次配置（最少配置）

脚本首次运行会从 `.env.example` 生成 `.env`。  
至少确认以下变量存在（默认模板已给出）：

```env
CODEX_IM_DEFAULT_CODEX_MODEL=gpt-5.3-codex
CODEX_IM_DEFAULT_CODEX_EFFORT=medium
CODEX_IM_DEFAULT_CODEX_ACCESS_MODE=default

CODEX_IM_OPENCLAW_BASE_URL=https://ilinkai.weixin.qq.com
CODEX_IM_OPENCLAW_TOKEN=
```

说明：
- `CODEX_IM_OPENCLAW_TOKEN` 为空时，启动后自动扫码登录。
- 登录成功后，token 会写入本地凭据文件，后续一般无需重复扫码。

## 手动启动方式

```bash
npm run openclaw-bot
```

开发态自动重启：

```bash
npm run watch:openclaw-bot
```

## 常用命令（微信里发）

- `/codex bind /绝对路径`
- `/codex where`
- `/codex workspace`
- `/codex switch <threadId|sessionId>`
- `/codex message`
- `/codex new`
- `/codex stop`
- `/codex help`

## 故障排查

1. 启动后没有弹二维码  
检查 `.env` 中 `CODEX_IM_OPENCLAW_TOKEN` 是否非空；若有旧 token，可先清空再重启。

2. 扫码后仍未连接  
重启一次进程，确认本地凭据文件已生成：`~/.codex-im/openclaw-credentials.json`。

3. 语音不可用  
先确认系统有 `ffmpeg`，再确认 `python3 -m pip show faster-whisper` 可用。

## 安全说明

- 不要把 `.env`、token、密钥提交到 Git。
- 默认日志不会打印敏感凭据。
