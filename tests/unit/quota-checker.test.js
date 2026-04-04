import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

describe("QuotaChecker", () => {
  it("keyId가 null이면 검사를 건너뛴다", async () => {
    const { QuotaChecker } = await import("../../lib/memory/QuotaChecker.js");
    const checker = new QuotaChecker();
    await assert.doesNotReject(() => checker.check(null));
  });

  it("할당량 미초과 시 정상 통과", async () => {
    const { QuotaChecker } = await import("../../lib/memory/QuotaChecker.js");
    const checker = new QuotaChecker();
    const mockClient = {
      query: mock.fn(async (sql) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql.startsWith("SET LOCAL")) return { rows: [] };
        if (sql.includes("fragment_limit")) return { rows: [{ fragment_limit: 100 }] };
        if (sql.includes("COUNT")) return { rows: [{ count: 50 }] };
        return { rows: [] };
      }),
      release: mock.fn()
    };
    checker.setPool({ connect: mock.fn(async () => mockClient) });
    await assert.doesNotReject(() => checker.check("key-123"));
  });

  it("할당량 초과 시 fragment_limit_exceeded 에러", async () => {
    const { QuotaChecker } = await import("../../lib/memory/QuotaChecker.js");
    const checker = new QuotaChecker();
    const mockClient = {
      query: mock.fn(async (sql) => {
        if (sql === "BEGIN" || sql === "ROLLBACK" || sql.startsWith("SET LOCAL")) return { rows: [] };
        if (sql.includes("fragment_limit")) return { rows: [{ fragment_limit: 10 }] };
        if (sql.includes("COUNT")) return { rows: [{ count: 10 }] };
        return { rows: [] };
      }),
      release: mock.fn()
    };
    checker.setPool({ connect: mock.fn(async () => mockClient) });
    await assert.rejects(
      () => checker.check("key-123"),
      (err) => err.code === "fragment_limit_exceeded"
    );
  });

  it("fragment_limit가 null이면 무제한 — 통과", async () => {
    const { QuotaChecker } = await import("../../lib/memory/QuotaChecker.js");
    const checker = new QuotaChecker();
    const mockClient = {
      query: mock.fn(async (sql) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql.startsWith("SET LOCAL")) return { rows: [] };
        if (sql.includes("fragment_limit")) return { rows: [{ fragment_limit: null }] };
        return { rows: [] };
      }),
      release: mock.fn()
    };
    checker.setPool({ connect: mock.fn(async () => mockClient) });
    await assert.doesNotReject(() => checker.check("key-123"));
  });
});
