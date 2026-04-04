/**
 * BatchRememberProcessor 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-05
 *
 * store, index, factory를 mock하여 BatchRememberProcessor.process()의
 * Phase A(검증), Phase B(INSERT), Phase C(후처리)를 검증한다.
 * setPool()로 DB pool을 주입하여 실제 DB 없이 동작을 검증한다.
 */

import { describe, it, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { BatchRememberProcessor } from "../../lib/memory/BatchRememberProcessor.js";
import { disconnectRedis }        from "../../lib/redis.js";

after(async () => { await disconnectRedis().catch(() => {}); });

/* ── 헬퍼: factory mock ── */

function makeMockFactory() {
  let seq = 0;
  return {
    create(item) {
      seq++;
      const id = `frag-${seq}`;
      return {
        id,
        content           : item.content,
        topic             : item.topic,
        type              : item.type,
        keywords          : item.keywords || [],
        importance        : item.importance ?? 0.5,
        content_hash      : `hash-${seq}`,
        source            : item.source || null,
        linked_to         : item.linked_to || [],
        ttl_tier          : "warm",
        estimated_tokens  : 10,
        valid_from        : new Date().toISOString(),
        is_anchor         : false,
        context_summary   : null,
        session_id        : null,
        workspace         : null,
        case_id           : null,
        goal              : null,
        outcome           : null,
        phase             : null,
        resolution_status : null,
        assertion_status  : "observed",
      };
    }
  };
}

function makeMockIndex() {
  return { index: mock.fn(async () => {}) };
}

function makeMockStore() {
  return {};
}

/**
 * INSERT 성공하는 DB client mock 생성.
 * opts.insertFn으로 개별 INSERT 동작을 커스터마이즈할 수 있다.
 */
function makeMockClient(opts = {}) {
  const insertFn = opts.insertFn || ((sql, params) => ({ rows: [{ id: params[0] }] }));
  return {
    query: mock.fn(async (sql, params) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (typeof sql === "string" && sql.startsWith("SET LOCAL")) return { rows: [] };
      if (typeof sql === "string" && sql.includes("INSERT INTO")) return insertFn(sql, params);
      return { rows: [] };
    }),
    release: mock.fn()
  };
}

function makeMockPool(client) {
  return { connect: mock.fn(async () => client) };
}

/* ── 파편 샘플 ── */

function validItem(i = 0) {
  return {
    content: `This is a valid test fragment number ${i} with enough words`,
    topic  : "test-topic",
    type   : "fact",
  };
}

/* ── 테스트 ── */

describe("BatchRememberProcessor", () => {

  let processor;
  let mockIndex;
  let mockClient;

  beforeEach(() => {
    mockIndex  = makeMockIndex();
    mockClient = makeMockClient();

    processor = new BatchRememberProcessor({
      store  : makeMockStore(),
      index  : mockIndex,
      factory: makeMockFactory(),
    });
    processor.setPool(makeMockPool(mockClient));
  });

  it("빈 배열 거부: fragments가 비어 있으면 에러", async () => {
    await assert.rejects(
      () => processor.process({ fragments: [] }),
      (err) => err.message.includes("must not be empty")
    );
  });

  it("빈 배열 거부: fragments가 배열이 아니면 에러", async () => {
    await assert.rejects(
      () => processor.process({ fragments: "not-array" }),
      (err) => err.message.includes("must not be empty")
    );
  });

  it("MAX_BATCH 초과 거부: 201개 파편", async () => {
    const fragments = Array.from({ length: 201 }, (_, i) => validItem(i));
    await assert.rejects(
      () => processor.process({ fragments }),
      (err) => err.message.includes("exceeds maximum 200")
    );
  });

  it("유효한 파편 배치 INSERT 성공", async () => {
    const fragments = [validItem(0), validItem(1), validItem(2)];
    const result    = await processor.process({ fragments });

    assert.equal(result.inserted, 3);
    assert.equal(result.skipped, 0);
    assert.equal(result.results.length, 3);
    for (const r of result.results) {
      assert.equal(r.success, true);
      assert.ok(r.id);
    }
  });

  it("Phase A 유효성 검증: content가 너무 짧으면 skip", async () => {
    const fragments = [
      { content: "ab", topic: "t", type: "fact" },
      validItem(1),
    ];
    const result = await processor.process({ fragments });

    assert.equal(result.inserted, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.results[0].success, false);
    assert.ok(result.results[0].error);
    assert.equal(result.results[1].success, true);
  });

  it("전체 파편이 유효성 검증 실패 시 inserted=0", async () => {
    const fragments = [
      { content: "ab", topic: "t", type: "fact" },
      { content: "cd", topic: "t", type: "fact" },
    ];
    const result = await processor.process({ fragments });

    assert.equal(result.inserted, 0);
    assert.equal(result.skipped, 2);
  });

  it("부분 INSERT 실패 시 결과 집계", async () => {
    let callCount = 0;
    const failClient = makeMockClient({
      insertFn: (_sql, params) => {
        callCount++;
        if (callCount === 2) throw new Error("duplicate key");
        return { rows: [{ id: params[0] }] };
      }
    });

    processor = new BatchRememberProcessor({
      store  : makeMockStore(),
      index  : makeMockIndex(),
      factory: makeMockFactory(),
    });
    processor.setPool(makeMockPool(failClient));

    const fragments = [validItem(0), validItem(1), validItem(2)];
    const result    = await processor.process({ fragments });

    assert.equal(result.inserted, 2);
    assert.equal(result.skipped, 1);

    const failed = result.results.find(r => !r.success);
    assert.ok(failed);
    assert.equal(failed.error, "duplicate key");
  });

  it("keyId 없이 master key 모드: 할당량 검사 없이 INSERT", async () => {
    const fragments = [validItem(0)];
    const result    = await processor.process({ fragments, _keyId: null });

    assert.equal(result.inserted, 1);
  });

  it("Phase C 후처리: index.index가 성공 파편마다 호출됨", async () => {
    const idx = makeMockIndex();
    processor = new BatchRememberProcessor({
      store  : makeMockStore(),
      index  : idx,
      factory: makeMockFactory(),
    });
    processor.setPool(makeMockPool(makeMockClient()));

    const fragments = [validItem(0), validItem(1)];
    await processor.process({ fragments });

    assert.equal(idx.index.mock.callCount(), 2);
  });

  it("pool이 null이면 Database pool unavailable 에러", async () => {
    processor.setPool(null);

    const fragments = [validItem(0)];
    await assert.rejects(
      () => processor.process({ fragments }),
      (err) => err.message.includes("Database pool unavailable")
    );
  });

  it("agentId 기본값은 'default'", async () => {
    const fragments = [validItem(0)];
    await processor.process({ fragments });

    const setCalls = mockClient.query.mock.calls
      .map(c => c.arguments[0])
      .filter(sql => typeof sql === "string" && sql.includes("current_agent_id"));
    assert.ok(setCalls.some(sql => sql.includes("default")));
  });

  it("workspace가 params에서 fragment 레벨로 전파", async () => {
    const factory = makeMockFactory();
    const created = [];
    const origCreate = factory.create.bind(factory);
    factory.create = (item) => {
      const f = origCreate(item);
      created.push(f);
      return f;
    };

    processor = new BatchRememberProcessor({
      store  : makeMockStore(),
      index  : makeMockIndex(),
      factory,
    });
    processor.setPool(makeMockPool(makeMockClient()));

    const fragments = [validItem(0)];
    await processor.process({ fragments, workspace: "ws-1" });

    assert.equal(created[0].workspace, "ws-1");
  });
});
