import { beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

const mockQueryWithAgentVector = mock.fn();

mock.module("../../lib/tools/db.js", {
  namedExports: {
    getPrimaryPool: () => ({
      query: () => {
        throw new Error("search_traces must use queryWithAgentVector to preserve RLS");
      }
    }),
    queryWithAgentVector: (...args) => mockQueryWithAgentVector(...args)
  }
});

mock.module("../../lib/utils.js", {
  namedExports: {
    logAudit: mock.fn(async () => {})
  }
});

mock.module("../../lib/memory/MemoryManager.js", {
  namedExports: {
    MemoryManager: class {
      static getInstance() {
        return new this();
      }
      async reconstructHistory() {
        throw new Error("reconstructHistory should not be called in search_traces test");
      }
    }
  }
});

const { tool_searchTraces } = await import("../../lib/tools/reconstruct.js");

describe("search_traces RLS regression", () => {
  beforeEach(() => {
    mockQueryWithAgentVector.mock.resetCalls();
  });

  test("uses queryWithAgentVector with default agent context", async () => {
    mockQueryWithAgentVector.mock.mockImplementationOnce(async () => ({
      rows: [
        {
          id: "frag-default-visible",
          content: "visible fragment",
          type: "fact",
          topic: "session_reflect",
          case_id: null,
          session_id: null,
          resolution_status: null,
          importance: 0.2,
          created_at: "2026-04-20T00:00:00Z",
          source: "fragment"
        }
      ]
    }));

    const result = await tool_searchTraces({
      entity_key: "session_reflect",
      keyword: "visible",
      limit: 20
    });

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.equal(result.traces[0].id, "frag-default-visible");
    assert.equal(mockQueryWithAgentVector.mock.callCount(), 1);

    const [agentId, sql, params] = mockQueryWithAgentVector.mock.calls[0].arguments;
    assert.equal(agentId, "default");
    assert.match(sql, /FROM agent_memory\.fragments f/i);
    assert.match(sql, /AND f\.valid_to IS NULL/i);
    assert.equal(params[2], "%visible%");
    assert.equal(params[3], "%session\\_reflect%");
  });

  test("forwards explicit agentId when provided", async () => {
    mockQueryWithAgentVector.mock.mockImplementationOnce(async () => ({ rows: [] }));

    const result = await tool_searchTraces({
      agentId: "project-agentdesk",
      entity_key: "session_reflect"
    });

    assert.equal(result.success, true);
    const [agentId] = mockQueryWithAgentVector.mock.calls[0].arguments;
    assert.equal(agentId, "project-agentdesk");
  });
});
