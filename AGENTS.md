# Repo Instructions

- In the `11/22/33` flow, `11` means planning only, and `22` means execute strictly from `11`'s plan and run the required tests before handoff.
- Keep changes minimal and focused on `codex-im` stability and clarity.
- Prefer async, non-blocking IO on hot paths.
- Use `npm run check` for syntax validation and `npm test` for unit tests.
- Any code change must be validated before handoff. `22` is responsible for running the relevant checks and carrying the results into the `build` summary instead of deferring all testing to `33`.
- When running Google Test-style validation or browser smoke checks, prefer quiet/non-interactive output so failures are visible without noisy logs.
- Avoid logging full JSON payloads unless `CODEX_IM_VERBOSE_LOGS=true`.
- Preserve Feishu and Codex credentials out of logs and source control.

## Working Memory

- Default to `CODEX_IM_FEISHU_STREAMING_OUTPUT=false` when the goal is stability or lower UI churn.
- Keep `CODEX_IM_VERBOSE_LOGS=false` unless transport debugging is actively needed.
- Treat `SessionStore.flush()` as the durable checkpoint before shutdown or verification.
- Shutdown should go through `runtime.stop()` so Feishu, Codex, and session state are closed in order.
