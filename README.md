# codex-im

`codex-im` 是一个用于 **Codex 连接微信（OpenClaw 协议）** 的本地桥接插件。  
消息链路：

`微信 -> OpenClaw HTTP API -> 本机 codex app-server -> 微信回复`

仓库地址：`https://github.com/dy30001/im`

## 一键安装 + 启动（推荐）

```bash
git clone https://github.com/dy30001/im.git codex-im
cd codex-im
bash ./scripts/bootstrap-openclaw.sh
```

这个脚本会自动做这些事：

1. 检查 Node.js（要求 18+）
2. 自动生成 `.env`（如果不存在）
3. 自动安装 npm 依赖
4. 在 macOS 上自动安装并加载 LaunchAgent，后台常驻、自动恢复
5. 如果 `.env` 里 `CODEX_IM_OPENCLAW_TOKEN` 为空，会自动触发微信二维码登录，并尝试自动打开浏览器

## 依赖要求

- Node.js 18+
- npm
- 已可用的 Codex CLI / Codex app-server 环境

默认启动不需要额外的语音环境；语音消息会直接使用平台返回的 `voice_item.text`，后面和普通文本走同一条链路。

## 让 Codex 直接按 README 自动部署

你可以直接把下面这句话发给 Codex：

```text
请在仓库根目录执行：bash ./scripts/bootstrap-openclaw.sh
```

脚本会自动安装依赖、拉起后台常驻且自动恢复的服务；首次未配置 token 时，会自动进入扫码登录流程。

## 首次配置（最少配置）

脚本首次运行会从 `.env.example` 生成 `.env`。  
至少确认以下变量存在（默认模板已给出）：

```env
CODEX_IM_DEFAULT_CODEX_MODEL=gpt-5.4
CODEX_IM_DEFAULT_CODEX_EFFORT=xhigh
CODEX_IM_DEFAULT_CODEX_ACCESS_MODE=full-access

CODEX_IM_OPENCLAW_BASE_URL=https://ilinkai.weixin.qq.com
CODEX_IM_OPENCLAW_TOKEN=
```

说明：
- `CODEX_IM_OPENCLAW_TOKEN` 为空时，启动后自动扫码登录。
- 登录成功后，token 会写入本地凭据文件，后续一般无需重复扫码。
- 语音消息不需要单独安装语音转文字依赖。

## 手动启动方式

```bash
npm run openclaw-bot
```

后台常驻启动：

```bash
npm run openclaw-bot:launchd
```

这个模式会把 `openclaw-bot` 安装成 macOS LaunchAgent，child 进程意外退出时会自动重启，不需要你手动再起服务。
另外，supervisor 会持续检查心跳；默认连续 3 小时没有新的轮询/发送心跳时，会判定服务卡住并自动重启。可通过 `.env` 里的 `CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS` 和 `CODEX_IM_OPENCLAW_HEARTBEAT_CHECK_INTERVAL_MS` 调整。

查看运行状态（进程、锁文件、日志尾部）：

```bash
npm run openclaw-bot:status
```

快速检查（状态 + 关键错误日志）：

```bash
npm run openclaw-bot:quick
```

一键健康检查（进程、锁、凭据、日志、错误提示）：

```bash
npm run openclaw-bot:doctor
```

诊断模式（推荐排查连接、收发或授权问题）：

```bash
npm run openclaw-bot:diagnose
```

后台诊断模式（不占用当前终端，日志固定到 `/tmp/codex-im-openclaw.log`）：

```bash
npm run openclaw-bot:diagnose:bg
```

一键重置扫码（停服务、备份旧凭据、重新进入扫码登录）：

```bash
npm run openclaw-bot:rescan
```

停止服务：

```bash
npm run openclaw-bot:stop
```

重启服务（先停再起并打印状态）：

```bash
npm run openclaw-bot:restart
```

等价于开启：
- `CODEX_IM_VERBOSE_LOGS=true`

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

3. 语音没有按预期回复  
当前版本直接使用平台提供的 `voice_item.text`；如果这段文本为空，先确认 OpenClaw 返回的 payload 是否已经变化。

4. 发了语音但机器人无响应  
重点看消息是否进入入口，以及 `voice_item.text` 是否存在。

在电脑执行：

```bash
cd /Users/dy3000/Documents/test/私人事务/codex-im
npm run openclaw-bot:diagnose:bg
```

再开一个终端执行：

```bash
tail -f /tmp/codex-im-openclaw.log
```

如果你是通过 `nohup` 启动，可用：

```bash
CODEX_IM_VERBOSE_LOGS=true nohup node ./bin/codex-im.js openclaw-bot > /tmp/codex-im-openclaw.log 2>&1 &
```

常驻模式下，优先查看状态和日志：

```bash
npm run openclaw-bot:status
tail -f /tmp/codex-im-openclaw.log
```

你发语音后，重点看这几段日志是否出现：
- `openclaw normalized command=...`
- `sendMessage`
- `thread/resume ok`

如果 `voice_item.text` 为空，则先回看 OpenClaw 的消息结构是否变了。

## 安全说明

- 不要把 `.env`、token、密钥提交到 Git。
- 默认日志不会打印敏感凭据。
