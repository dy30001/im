const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findWritableDesktopSession,
  hydrateSelectedDesktopSession,
} = require("../src/domain/thread/thread-desktop-service");

test("hydrateSelectedDesktopSession falls back to the raw session when no hydrate hook exists", async () => {
  const session = {
    id: "session-1",
    writable: true,
    acpSessionId: "acp-1",
  };
  const runtime = {
    resolveDesktopSessionById: (_workspaceRoot, sessionId) => (
      sessionId === session.id ? session : null
    ),
  };

  const hydrated = await hydrateSelectedDesktopSession(runtime, "/repo", "session-1");

  assert.equal(hydrated, session);
});

test("findWritableDesktopSession skips excluded and read-only sessions", async () => {
  const sessionsById = new Map([
    ["session-1", { id: "session-1", writable: true, acpSessionId: "acp-1" }],
    ["session-2", { id: "session-2", writable: false, acpSessionId: "acp-2" }],
    ["session-3", { id: "session-3", writable: true, acpSessionId: "acp-3" }],
  ]);
  const runtime = {
    resolveDesktopSessionById: (_workspaceRoot, sessionId) => sessionsById.get(sessionId) || null,
    sessionStore: {
      listBindings: () => ([]),
    },
    pendingApprovalByThreadId: new Set(),
    activeTurnIdByThreadId: new Map(),
    bindingKeyByThreadId: new Map(),
    inFlightThreadDispatchClaimsById: new Map(),
  };

  const selected = await findWritableDesktopSession(runtime, "/repo", [
    { id: "session-1" },
    { id: "session-2" },
    { id: "session-3" },
  ], {
    excludedSessionId: "session-1",
    bindingKey: "binding-1",
    allowClaimedThreadReuse: false,
  });

  assert.deepEqual(selected, sessionsById.get("session-3"));
});
