# 语音输入备份记录（2026-03-25 11:27:05）

## 目的
在继续排查/改造语音输入前，先冻结当前关键代码与配置，便于随时回滚和对比。

## 备份目录
`backups/voice-input/20260325-112705`

## 已备份文件（关键链路）
- `.env`
- `.env.example`
- `README.md`
- `package.json`
- `scripts/bootstrap-openclaw.sh`
- `scripts/local-faster-whisper-transcribe.py`
- `src/app/openclaw-bot-runtime.js`
- `src/app/openclaw-voice-service.js`
- `src/app/dispatcher.js`
- `src/infra/config/config.js`
- `src/infra/openclaw/client-adapter.js`
- `src/infra/openclaw/media-adapter.js`
- `src/infra/stt/transcription-client.js`
- `test/openclaw-voice-flow.test.js`（备份文件名：`openclaw-voice-flow.test.js.bak`，避免被 `node --test` 自动发现）

## 校验摘要（SHA256）
- `.env` `87add77c7a4a3cba3681eedfbeaa9980d6a1c68844534e17b9b8874608215f84`
- `.env.example` `65fb256cc8d248b8a8a63725f69ccb327febe364a26ad95b4fdcd3522d28dc65`
- `README.md` `0d143be00867b68b0a5dba19984922f51375280dec7e193e05978a15206bb8bc`
- `bootstrap-openclaw.sh` `02a90397cf398e4d0b83cbc4bf2f47855aa5b08d3ddb80c8f87dc0c5566382da`
- `client-adapter.js` `f80692357eeae24fd475004d1dc80c60ead58ae791e000c29c7900b0a5a9b903`
- `config.js` `06705ea5fd14342f6d966a703c62cddbe76ad5cb1fa5d78711d105001adfd352`
- `dispatcher.js` `59db02c2969756df1b56040234e17537db0997aff871588795ffbc954d76da62`
- `local-faster-whisper-transcribe.py` `3d6f6a368c0f04f4fddc6e86901dd89ca3c948513e3c37e640974ee4de64f69c`
- `media-adapter.js` `b3dd02caf1336af5e5a12cb12544119edfa4ee91695bc30d62a40fc5bd17f9b9`
- `openclaw-bot-runtime.js` `a30006aa5e727bc11d77146a2660072d3dc0cb9991985ab53110ea37eec44340`
- `openclaw-voice-flow.test.js.bak` `44d9016f9174e1db31dbfde3207075486077f30c0e1605b64bfbbb300b9e5cf1`
- `openclaw-voice-service.js` `fbf9e70c08001178d6b32b06b3e1dd714b4f222888f859c5f2059be883982478`
- `package.json` `01f25ebe4be3001be182b760b6ea022de6b20f4cffa539e6dae25ba83d177d63`
- `transcription-client.js` `6fa67e47dc9778e0e341b470ff0508f91208510bec476961c6f1a4af32a12cb5`

## 当前项目 .env 语音相关配置快照（已脱敏）
- `CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER=true`
- `CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_MODEL=base`
- `CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_PYTHON=/Users/dy3000/.codex-im/venvs/faster-whisper/bin/python`
- `CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_SCRIPT=/Users/dy3000/Documents/test/私人事务/codex-im/scripts/local-faster-whisper-transcribe.py`
- `CODEX_IM_OPENCLAW_TRANSCRIPTION_LOCAL_FASTER_WHISPER_CACHE_DIR=/Users/dy3000/Documents/test/私人事务/codex-im/.hf_cache`
- `CODEX_IM_DEFAULT_CODEX_MODEL=gpt-5.3-codex`
- `CODEX_IM_DEFAULT_CODEX_EFFORT=medium`
- `CODEX_IM_DEFAULT_CODEX_ACCESS_MODE=default`

以下键在项目根 `.env` 中未显式设置（可能来自默认值或 `~/.codex-im/.env`）：
- `CODEX_IM_OPENCLAW_BASE_URL`
- `CODEX_IM_OPENCLAW_TOKEN`
- `CODEX_IM_OPENCLAW_THREAD_SOURCE`
- `CODEX_IM_OPENCLAW_VOICE_INPUT_ENABLED`
- `CODEX_IM_OPENCLAW_LONG_POLL_TIMEOUT_MS`
- `CODEX_IM_OPENCLAW_STREAMING_OUTPUT`
- `CODEX_IM_OPENCLAW_TRANSCRIPTION_LANGUAGE`
- `CODEX_IM_OPENCLAW_TRANSCRIPTION_MAX_BYTES`

## 从备份恢复（示例）
```bash
cp backups/voice-input/20260325-112705/openclaw-bot-runtime.js src/app/openclaw-bot-runtime.js
cp backups/voice-input/20260325-112705/transcription-client.js src/infra/stt/transcription-client.js
cp backups/voice-input/20260325-112705/.env .env
```
