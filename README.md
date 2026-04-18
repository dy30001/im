# codex-im

`codex-im` 是一个运行在本地机器上的桥接程序，用来把 **Codex** 接到 **微信 / OpenClaw**。

它的目标很简单：

- 微信里发消息，Codex 在本机处理
- Codex 的回复再回到微信里
- 你可以把它当成一个“本地代理层”，而不是云端机器人

> 仓库公开方式说明：**git 本身不能禁止别人 clone / fork 你的代码**。  
> 如果你要的是“别人能公开看到，但不能直接改你的主分支”，需要在 GitHub / GitLab 这类托管平台里做权限控制和分支保护。  
> 本 README 默认按“公开只读”场景来写：别人可以看、可以拉取、可以 fork，但不能直接往你的主分支推送。

## 它是怎么工作的

```text
微信消息
  -> OpenClaw HTTP API
  -> codex-im 本地进程
  -> Codex app-server
  -> 微信回复
```

语音消息也走同一条路线：

```text
voice_item.text
  -> 普通文本链路
  -> Codex 处理
  -> 微信回复
```

也就是说，现在语音不再依赖单独的本地语音转文字环境；如果平台已经给出 `voice_item.text`，它就直接当普通文本处理。

## 主要特点

- 本地运行，消息桥接和会话状态都在你的电脑上处理
- 支持微信 / OpenClaw 的文本消息
- 支持语音消息直接按 `voice_item.text` 进入文本链路
- 支持 workspace bind / browse / switch / threads 等 Codex 操作
- 支持 macOS LaunchAgent 常驻
- 提供状态检查、诊断、重启和健康检查脚本

## 一键安装 + 启动

```bash
git clone https://github.com/dy30001/im.git codex-im
cd codex-im
bash ./scripts/bootstrap-openclaw.sh
```

这个脚本会自动做这些事：

1. 检查 Node.js（要求 18+）
2. 自动生成 `.env`（如果不存在）
3. 自动安装 npm 依赖
4. 在 macOS 上自动安装并加载 LaunchAgent，让服务后台常驻并自动恢复
5. 如果 `.env` 里 `CODEX_IM_OPENCLAW_TOKEN` 为空，会自动触发微信二维码登录，并尝试打开浏览器

## 默认配置

首次运行时，脚本会从 `.env.example` 生成 `.env`。  
默认模板里的关键值如下：

```env
CODEX_IM_DEFAULT_CODEX_MODEL=gpt-5.4
CODEX_IM_DEFAULT_CODEX_EFFORT=xhigh
CODEX_IM_DEFAULT_CODEX_ACCESS_MODE=full-access

CODEX_IM_OPENCLAW_BASE_URL=https://ilinkai.weixin.qq.com
CODEX_IM_OPENCLAW_TOKEN=
```

说明：

- `CODEX_IM_DEFAULT_CODEX_MODEL` 和 `CODEX_IM_DEFAULT_CODEX_EFFORT` 是默认给 Codex 的参数。
- `CODEX_IM_DEFAULT_CODEX_ACCESS_MODE=full-access` 表示默认按完全访问模式运行。
- `CODEX_IM_OPENCLAW_TOKEN` 为空时，启动后会自动走扫码登录流程。
- 语音消息不需要单独安装语音转文字依赖。

## 让 Codex 自动部署

如果你想把这件事交给 Codex，可以直接发这句话：

```text
请在仓库根目录执行：bash ./scripts/bootstrap-openclaw.sh
```

脚本会自动安装依赖、拉起后台常驻服务；首次未配置 token 时，会自动进入扫码登录流程。

## 手动启动

```bash
npm run openclaw-bot
```

后台常驻启动：

```bash
npm run openclaw-bot:connect
```

这是推荐入口。它会自动补齐 `.env`、按需安装依赖、拉起后台常驻服务，并在 token 为空时等待微信扫码直到服务就绪。

如果你只想单独安装后台常驻：

```bash
npm run openclaw-bot:launchd
```

这个模式会把 `openclaw-bot` 安装成 macOS LaunchAgent。  
supervisor 或 child 进程退出时都会自动重启，不需要你手动再起服务。  
supervisor 也会持续检查心跳；默认连续 10 分钟没有新的轮询 / 发送心跳时，会判定服务卡住并自动重启。  
如果子进程启动后连续 3 分钟都没有建立首次心跳，也会按启动卡死处理并拉起。  
运行中的活跃任务默认超过 30 分钟没有新进展，也会自动重启子进程。  
可通过 `.env` 里的 `CODEX_IM_OPENCLAW_HEARTBEAT_TIMEOUT_MS`、`CODEX_IM_OPENCLAW_STARTUP_HEARTBEAT_TIMEOUT_MS`、`CODEX_IM_OPENCLAW_HEARTBEAT_CHECK_INTERVAL_MS`、`CODEX_IM_OPENCLAW_TURN_STALL_TIMEOUT_MS` 和 `CODEX_IM_OPENCLAW_TURN_STALL_CHECK_INTERVAL_MS` 调整。

查看运行状态：

```bash
npm run openclaw-bot:status
```

快速检查：

```bash
npm run openclaw-bot:quick
```

一键健康检查：

```bash
npm run openclaw-bot:doctor
```

诊断模式：

```bash
npm run openclaw-bot:diagnose
```

后台诊断模式：

```bash
npm run openclaw-bot:diagnose:bg
```

停止服务：

```bash
npm run openclaw-bot:stop
```

重启服务：

```bash
npm run openclaw-bot:restart
```

开发态自动重启：

```bash
npm run watch:openclaw-bot
```

## 两个微信实例

支持按实例 ID 跑多个彼此独立的 OpenClaw 实例。推荐做法是给每个微信号一个实例 ID，例如 `wx1` 和 `wx2`。

实例化后，这些文件会自动隔离：

- `~/.codex-im/openclaw-credentials.<instance>.json`
- `~/.codex-im/openclaw-sessions.<instance>.json`
- `~/.codex-im/openclaw-bot.<instance>.lock/`
- `/tmp/codex-im-openclaw-<instance>.log`
- `com.dy3000.codex-im.openclaw.<instance>`

安装 `wx1`：

```bash
npm run openclaw-bot:launchd -- wx1
```

安装 `wx2`：

```bash
npm run openclaw-bot:launchd -- wx2
```

查看某个实例状态：

```bash
npm run openclaw-bot:status -- wx1
npm run openclaw-bot:status -- wx2
```

如果你想给某个实例写单独配置，可创建：

- `~/.codex-im/openclaw-wx1.env`
- `~/.codex-im/openclaw-wx2.env`

脚本会先加载公共 `.env`，再加载对应实例 env 文件。

## 微信里常用命令

- `/codex bind /绝对路径`
- `/codex where`
- `/codex workspace`
- `/codex switch <threadId|sessionId>`
- `/codex message`
- `/codex new`
- `/codex stop`
- `/codex help`

## 公开只读怎么做

如果你的目标是“**公开可见，但不让别人直接修改主分支**”，建议这样设置：

1. 在 GitHub / GitLab 把仓库设为 **Public**
2. 只保留你自己或维护者的写权限
3. 对 `main` / `master` 开启分支保护：
   - 需要 Pull Request
   - 禁止 force push
   - 必要时要求至少 1 个 review
4. 如果你不想接收外部修改，可以明确说明“以 issue 为主，不接受直接推送”

补充说明：

- 这属于托管平台权限控制，不是 `git` 命令本身能完成的。
- 即使公开只读，别人仍然可以 clone / fork；你能控制的是“主仓库能不能被直接写入”。

## 故障排查

1. 启动后没有弹二维码  
检查 `.env` 里的 `CODEX_IM_OPENCLAW_TOKEN` 是否非空；如果有旧 token，可以先清空再重启。

2. 扫码后仍未连接  
重启一次进程，确认本地凭据文件已生成：`~/.codex-im/openclaw-credentials.json`。  
如果你跑的是多实例模式，则对应文件会变成 `~/.codex-im/openclaw-credentials.<instance>.json`。

3. 发消息后没有回复  
先看服务是否在跑，再看 `openclaw-bot:status` 和日志尾部。

4. 语音没有按预期回复  
当前实现里，语音会优先读取 `voice_item.text` 并直接进入普通文本链路；如果这段文本为空，就先确认 OpenClaw 返回的 payload 是否变化。

5. 需要看更详细日志  
在电脑上运行：

```bash
cd /Users/dy3000/Documents/test/私人事务/codex-im
npm run openclaw-bot:diagnose:bg
```

然后在另一个终端里执行：

```bash
tail -f /tmp/codex-im-openclaw.log
```

## 安全说明

- 不要把 `.env`、token、密钥提交到 Git。
- 默认日志不会打印敏感凭据。
- 如果你打算公开仓库，请确保本地凭据文件和日志文件没有被提交进版本库。
