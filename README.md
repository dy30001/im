# codex-im

本项目完全通过Vibe Coding实现，主要特点：手机聊的电脑能继续聊，电脑聊的手机也能继续聊。在手机上可以使用命令或飞书的卡片来进行交互，快速切换项目和线程

`codex-im` 是一个本地运行的 IM 桥接层：

`飞书消息 -> 本机 codex app-server -> 飞书回复`

也支持通过 OpenClaw 微信协议接入：

`微信消息 -> OpenClaw/微信 HTTP API -> 本机 codex app-server -> 微信文本回复`

Codex 操作都留在 本地，飞书只负责消息交互。

## 特性

- 飞书长连接机器人
- OpenClaw / 微信 文本轮询接入（text-only MVP）
- 普通对话回复
- 卡片回复与流式更新
- 先加表情、后输出正文
- 回复到触发它的原消息
- `/codex bind` 绑定项目
- `/codex where` 查看当前项目/线程
- `/codex workspace` 查看当前会话已记录项目和线程
- `/codex remove /绝对路径` 移除会话绑定项目
- `/codex send <相对文件路径>` 发送当前绑定项目内的文件
- `/codex switch <threadId>` 切换线程
- `/codex message` 查看最近几轮消息
- `/codex new` 新建线程
- `/codex stop` 停止当前运行
- `/codex model` / `/codex model update` / `/codex model <modelId>` 查看可用模型、刷新可用模型以及推理强度、设置模型
- `/codex effort` / `/codex effort <low|medium|high|xhigh>` 设置推理强度
- `/codex approve` / `/codex reject` 审批卡片

## 安装

npm安装和执行：

```sh
npm install -g @vdug/codex-im
codex-im feishu-bot
codex-im openclaw-bot
```

开发态运行：

```sh
npm install
npm run feishu-bot
npm run openclaw-bot
```

开发态自动重启：

```sh
npm run watch:feishu-bot
npm run watch:openclaw-bot
```

### 执行脚本示例

```bash
#!/usr/bin/env bash
set -euo pipefail
npm install -g @vdug/codex-im
codex-im feishu-bot
```

## 配置

有两个配置文件：.env 和 sessions.json

 `.env`。

程序会按这个顺序加载配置：

1. 当前目录下的 `.env`
2. `~/.codex-im/.env`
3. 当前 shell 环境变量


以下是默认读取 session 文件位置，也可以通过 .env 的配置指定

```text
~/.codex-im/sessions.json
```

通用必填环境变量：

- `CODEX_IM_DEFAULT_CODEX_MODEL` 新绑定项目时默认写入的模型（启动时会基于 Codex 可用模型列表校验，不合法则启动失败）
- `CODEX_IM_DEFAULT_CODEX_EFFORT` 新绑定项目时默认写入的推理强度（启动时会基于对应模型可用推理强度校验，不合法则启动失败）
- `CODEX_IM_DEFAULT_CODEX_ACCESS_MODE` 默认访问模式（必填：`default` / `full-access`）

`feishu-bot` 模式额外必填：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

`openclaw-bot` 模式额外必填：

- 无。若未提供 `CODEX_IM_OPENCLAW_TOKEN`，启动时会自动拉起微信扫码登录。

可选环境变量：

- `CODEX_IM_DEFAULT_WORKSPACE_ID` 在session中读取当前绑定信息的key，更换key后，原来的信息虽然在session中，但是不会再读取
- `CODEX_IM_FEISHU_STREAMING_OUTPUT`（默认 `true`，设为 `false` 则等 Codex 完成后一次性输出）
- `CODEX_IM_OPENCLAW_BASE_URL`（默认 `https://ilinkai.weixin.qq.com`）
- `CODEX_IM_OPENCLAW_TOKEN`（可选；为空时首次启动自动扫码，并写入本地凭据文件）
- `CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS`（默认 `35000`）
- `CODEX_IM_OPENCLAW_STREAMING_OUTPUT`（默认 `false`，微信 text-only 模式建议保持关闭）
- `CODEX_IM_OPENCLAW_CREDENTIALS_FILE`（默认 `~/.codex-im/openclaw-credentials.json`）
- `CODEX_IM_VERBOSE_LOGS`（默认 `false`，设为 `true` 才打印较详细的 Codex 传输日志）
- `CODEX_IM_WORKSPACE_ALLOWLIST`允许绑定的项目白名单
- `CODEX_IM_CODEX_ENDPOINT` 用来指定 Codex 的远程 WebSocket RPC 地址，默认是启动本地服务
- `CODEX_IM_SESSIONS_FILE` session文件路径




## 使用

```sh
npm run feishu-bot
npm run openclaw-bot
```

## 开发热重启

- `npm run watch:feishu-bot`
- `npm run watch:openclaw-bot`
- 当前实现是“文件变更后自动重启进程”，不是运行中模块热替换
- 默认监听 `src/`、`bin/` 和当前项目目录下的 `.env`
- 普通源码改动会自动重启；正在运行的旧进程会收到 `SIGTERM`，由当前 shutdown 逻辑负责回收
- `sessions.json`、`openclaw-credentials.json` 这类运行时状态文件不会触发自动重启，避免轮询过程被状态写盘反复打断
- 如果你主要依赖 `~/.codex-im/.env` 而不是当前目录 `.env`，这版 watch 不会自动感知那份文件，修改后请手动重启

常用命令：

- `/codex bind /绝对路径`
- `/codex where`
- `/codex workspace`
- `/codex remove /绝对路径`
- `/codex send <相对文件路径>`
- `/codex switch <threadId>`
- `/codex message`
- `/codex new`
- `/codex stop`
- `/codex model`
- `/codex model update`
- `/codex effort`
- `/codex approve`
- `/codex approve session`
- `/codex reject`
- `/codex help`

## OpenClaw / 微信模式说明

- 当前是 text-only MVP：普通消息、`/codex bind`、`/codex where`、`/codex new`、`/codex stop`、`/codex message` 可用
- 卡片、reaction、文件发送会自动降级为纯文本提示
- 若未设置 `CODEX_IM_OPENCLAW_TOKEN`，`codex-im openclaw-bot` 启动时会自动请求二维码，并尝试在默认浏览器中打开二维码链接
- 扫码成功后会把 `bot_token` 和 `baseurl` 写入本地凭据文件，后续启动默认直接复用，无需重复扫码
- 当前实现对齐的是 `@tencent-weixin/openclaw-weixin` 2.0.x 暴露的 HTTP JSON 协议
- 如果你是在仓库源码目录里直接跑，而不是全局安装 npm 包，请用 `npm run openclaw-bot` 或 `node ./bin/codex-im.js openclaw-bot`
- 已有 `~/.codex-im/openclaw-credentials.json` 时，重启会优先复用本地 token，不需要每次重新扫码
- 轮询遇到 `session timeout / errcode=-14` 一类凭证问题时，会先尝试重新加载本地凭据；如果本地没有更新过的 token，日志会明确提示需要重新扫码

## macOS 开机自启

仓库内提供了两个文件：

- `scripts/start-openclaw-bot.sh`
- `deploy/macos/com.dy3000.codex-im.openclaw.plist`

安装后，`launchd` 会在你登录 macOS 后自动拉起微信桥接服务，并在异常退出时自动重启。日志默认写到：

- `~/Library/Logs/codex-im/openclaw-bot.out.log`
- `~/Library/Logs/codex-im/openclaw-bot.err.log`

常用命令：

```sh
launchctl print gui/$(id -u)/com.dy3000.codex-im.openclaw
tail -f ~/Library/Logs/codex-im/openclaw-bot.out.log
tail -f ~/Library/Logs/codex-im/openclaw-bot.err.log
```

## 项目与线程模型

- 一个飞书会话可以记住多个项目
- 每个项目对应一个当前选中的 Codex 线程
- 历史线程列表以 Codex `thread/list` 为准
- 切换项目或线程后，后续普通消息继续发到当前线程

## 工作方式

- 收到用户消息后，先用表情标记正在处理
- Codex 返回内容后，飞书中以卡片形式持续更新
- 命令回执和普通对话都会优先回复到触发它的原消息
- 审批请求会显示为交互卡片

## 开发

- `src/index.js`: 启动入口
- `src/feishu-bot.js`: 飞书机器人主逻辑
- `src/codex-rpc-client.js`: Codex JSON-RPC 传输层
- `src/session-store.js`: 会话绑定持久化
- `src/config.js`: 环境变量配置

## 稳定建议

- 如果你更在意稳定和少刷屏，优先把 `CODEX_IM_FEISHU_STREAMING_OUTPUT=false`
- 如果你只想看关键错误，把 `CODEX_IM_VERBOSE_LOGS=false`
- 退出时建议正常 `Ctrl+C`，这样会先刷新 session 再结束进程


# 飞书配置

1. 在飞书平台创建机器人

2. 事件权限配置

| 名称 | 标识 |
| --- | --- |
| 消息被 reaction | `im.message.reaction.created_v1` |
| 消息被取消 reaction | `im.message.reaction.deleted_v1` |
| 接收消息 | `im.message.receive_v1` |

3. 回调配置

| 名称 | 标识 |
| --- | --- |
| 卡片回传交互 | `card.action.trigger` |

4. 应用权限

| 名称 | 标识 |
| --- | --- |
| 获取卡片信息 | `cardkit:card:read` |
| 创建与更新卡片 | `cardkit:card:write` |
| 获取与更新用户基本信息 | `contact:user.base:readonly` |
| 读取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` |
| 以应用身份发消息 | `im:message:send_as_bot` |
| 发送删除表情回复 | `im:message.reactions:write_only` |
| 获取与上传图片或文件资源 | `im:resource` |



# 参考项目
https://github.com/larksuite/openclaw-lark

https://github.com/Emanuele-web04/remodex

https://github.com/Dimillian/CodexMonitor
