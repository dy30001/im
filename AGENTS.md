# Repo Instructions

- Keep changes minimal and focused on `codex-im` stability and clarity.
- Prefer async, non-blocking IO on hot paths.
- Use `npm run check` for syntax validation and `npm test` for unit tests.
- Avoid logging full JSON payloads unless `CODEX_IM_VERBOSE_LOGS=true`.
- Preserve Feishu and Codex credentials out of logs and source control.

## Working Memory

- Default to `CODEX_IM_FEISHU_STREAMING_OUTPUT=false` when the goal is stability or lower UI churn.
- Keep `CODEX_IM_VERBOSE_LOGS=false` unless transport debugging is actively needed.
- Treat `SessionStore.flush()` as the durable checkpoint before shutdown or verification.
- Shutdown should go through `runtime.stop()` so Feishu, Codex, and session state are closed in order.
