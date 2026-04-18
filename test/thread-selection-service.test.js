const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isThreadAssignedToDifferentBinding,
  isThreadUnavailableForBinding,
  selectAutoThreadForBinding,
} = require("../src/domain/thread/thread-selection-service");

test("isThreadAssignedToDifferentBinding matches bindings from the same workspace", () => {
  const runtime = {
    sessionStore: {
      listBindings: () => ([
        {
          bindingKey: "binding-1",
          binding: {
            threadIdByWorkspaceRoot: {
              "/repo": "thread-1",
            },
          },
        },
        {
          bindingKey: "binding-2",
          binding: {
            threadIdByWorkspaceRoot: {
              "/repo": "thread-2",
            },
          },
        },
      ]),
    },
  };

  assert.equal(isThreadAssignedToDifferentBinding(runtime, "binding-2", "/repo", "thread-1"), true);
  assert.equal(isThreadAssignedToDifferentBinding(runtime, "binding-2", "/repo", "thread-2"), false);
});

test("selectAutoThreadForBinding skips threads assigned to another binding when shared reuse is disabled", () => {
  const runtime = {
    sessionStore: {
      listBindings: () => ([
        {
          bindingKey: "binding-1",
          binding: {
            threadIdByWorkspaceRoot: {
              "/repo": "thread-1",
            },
          },
        },
      ]),
    },
    pendingApprovalByThreadId: new Set(),
    activeTurnIdByThreadId: new Map(),
    bindingKeyByThreadId: new Map(),
    inFlightThreadDispatchClaimsById: new Map(),
  };

  const selectedThreadId = selectAutoThreadForBinding(runtime, "binding-2", "/repo", [
    { id: "thread-1" },
    { id: "thread-2" },
  ], {
    allowClaimedThreadReuse: false,
  });

  assert.equal(selectedThreadId, "thread-2");
});

test("isThreadUnavailableForBinding blocks running threads owned by another binding", () => {
  const runtime = {
    sessionStore: {
      listBindings: () => ([]),
    },
    pendingApprovalByThreadId: new Set(),
    activeTurnIdByThreadId: new Map([["thread-1", "turn-1"]]),
    bindingKeyByThreadId: new Map([["thread-1", "binding-1"]]),
    inFlightThreadDispatchClaimsById: new Map(),
  };

  assert.equal(
    isThreadUnavailableForBinding(runtime, "binding-2", "/repo", "thread-1"),
    true
  );
  assert.equal(
    isThreadUnavailableForBinding(runtime, "binding-1", "/repo", "thread-1"),
    false
  );
});
