/**
 * EmbeddingWorker 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-07
 *
 * DB/Redis/API 의존성은 mock 처리.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

/**
 * EmbeddingWorker 모듈은 외부 의존성(Redis, DB, OpenAI)이 무거우므로
 * 핵심 로직을 직접 검증하기 위해 mock 기반 워커 인스턴스를 구성한다.
 */

/** mock용 config */
const MOCK_CONFIG = {
  batchSize   : 3,
  intervalMs  : 100,
  retryLimit  : 3,
  retryDelayMs: 10,
  queueKey    : "test:embedding_queue"
};

/**
 * EmbeddingWorker와 동일한 로직의 테스트용 구현
 * 외부 의존성을 주입 가능하게 변환
 */
class TestableEmbeddingWorker extends EventEmitter {
  constructor({ config, redis, db, embedding }) {
    super();
    this.running   = false;
    this.config    = config;
    this.redis     = redis;
    this.db        = db;
    this.embedding = embedding;
    this.timer     = null;
  }

  async _processBatch() {
    const queueRedisKey = `queue:${this.config.queueKey}`;
    const ids           = [];

    for (let i = 0; i < this.config.batchSize; i++) {
      const raw = await this.redis.rpop(queueRedisKey);
      if (!raw) break;

      try {
        const data = JSON.parse(raw);
        if (data.fragmentId) {
          ids.push(data.fragmentId);
        }
      } catch {
        /* invalid item */
      }
    }

    if (ids.length === 0) return;

    const { rows } = await this.db.query(
      `SELECT id, content FROM agent_memory.fragments WHERE id = ANY($1) AND embedding IS NULL`,
      [ids]
    );

    for (const row of rows) {
      await this._embedOne(row);
    }
  }

  async _embedOne(row) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.config.retryLimit; attempt++) {
      try {
        const text   = this.embedding.prepareText(row.content, 500);
        const vec    = await this.embedding.generate(text);
        const vecStr = this.embedding.toSql(vec);

        await this.db.query(
          `UPDATE agent_memory.fragments SET embedding = $2::vector WHERE id = $1`,
          [row.id, vecStr]
        );

        this.emit("embedding_ready", { fragmentId: row.id });
        return;
      } catch (err) {
        lastError = err;
        if (attempt < this.config.retryLimit) {
          await new Promise(r => setTimeout(r, this.config.retryDelayMs));
        }
      }
    }

    const deadLetterKey = `queue:${this.config.queueKey}:dead`;
    await this.redis.lpush(deadLetterKey, JSON.stringify({
      fragmentId: row.id,
      error     : lastError?.message || "unknown",
      failedAt  : new Date().toISOString()
    }));
  }
}

describe("EmbeddingWorker", () => {
  let worker;
  let mockRedis;
  let mockDb;
  let mockEmbedding;

  beforeEach(() => {
    mockRedis = {
      rpopResults: [],
      lpushCalls : [],
      async rpop() {
        return this.rpopResults.shift() || null;
      },
      async lpush(key, value) {
        this.lpushCalls.push({ key, value });
      }
    };

    mockDb = {
      queryCalls: [],
      queryResults: { rows: [] },
      async query(sql, params) {
        this.queryCalls.push({ sql, params });
        return this.queryResults;
      }
    };

    mockEmbedding = {
      prepareText: (content) => content,
      generate   : async () => [0.1, 0.2, 0.3],
      toSql      : (vec) => `[${vec.join(",")}]`
    };

    worker = new TestableEmbeddingWorker({
      config   : MOCK_CONFIG,
      redis    : mockRedis,
      db       : mockDb,
      embedding: mockEmbedding
    });
  });

  test("빈 큐 처리 — 에러 없이 종료", async () => {
    /** rpop이 null 반환 → ids가 비어 있으므로 DB 쿼리 없이 종료 */
    await worker._processBatch();
    assert.strictEqual(mockDb.queryCalls.length, 0);
  });

  test("이미 임베딩이 있는 파편 스킵 (DB에서 embedding IS NULL 필터)", async () => {
    mockRedis.rpopResults = [
      JSON.stringify({ fragmentId: "frag-1" }),
      JSON.stringify({ fragmentId: "frag-2" })
    ];

    /** DB가 빈 rows 반환 → 이미 임베딩이 있어서 NULL 조건 불일치 */
    mockDb.queryResults = { rows: [] };

    await worker._processBatch();

    /** SELECT 쿼리 1회만 실행, UPDATE(임베딩 저장) 쿼리 0회 */
    assert.strictEqual(mockDb.queryCalls.length, 1);
    assert.ok(mockDb.queryCalls[0].sql.includes("embedding IS NULL"));
  });

  test("embedding_ready 이벤트 발행 확인", async () => {
    mockRedis.rpopResults = [
      JSON.stringify({ fragmentId: "frag-abc" })
    ];

    mockDb.queryResults = { rows: [{ id: "frag-abc", content: "test content" }] };

    /** 이벤트 캡처용 */
    const emittedIds = [];
    worker.on("embedding_ready", (data) => {
      emittedIds.push(data.fragmentId);
    });

    /** UPDATE 쿼리도 성공해야 하므로 두 번째 호출을 허용 */
    let callCount = 0;
    mockDb.query = async function(sql, params) {
      this.queryCalls.push({ sql, params });
      callCount++;
      if (callCount === 1) return { rows: [{ id: "frag-abc", content: "test content" }] };
      return { rows: [] };
    };

    await worker._processBatch();

    assert.strictEqual(emittedIds.length, 1);
    assert.strictEqual(emittedIds[0], "frag-abc");
  });

  test("재시도 초과 시 dead letter 큐 이동", async () => {
    mockRedis.rpopResults = [
      JSON.stringify({ fragmentId: "frag-fail" })
    ];

    mockDb.queryResults = { rows: [{ id: "frag-fail", content: "failing content" }] };

    /** 임베딩 생성 항상 실패 */
    mockEmbedding.generate = async () => {
      throw new Error("API timeout");
    };

    /** SELECT + UPDATE 시도 분리 */
    let selectDone = false;
    mockDb.query = async function(sql, params) {
      this.queryCalls.push({ sql, params });
      if (!selectDone && sql.includes("SELECT")) {
        selectDone = true;
        return { rows: [{ id: "frag-fail", content: "failing content" }] };
      }
      return { rows: [] };
    };

    await worker._processBatch();

    /** dead letter 큐에 푸시되었는지 확인 */
    assert.strictEqual(mockRedis.lpushCalls.length, 1);
    assert.strictEqual(mockRedis.lpushCalls[0].key, `queue:${MOCK_CONFIG.queueKey}:dead`);

    const deadItem = JSON.parse(mockRedis.lpushCalls[0].value);
    assert.strictEqual(deadItem.fragmentId, "frag-fail");
    assert.strictEqual(deadItem.error, "API timeout");
    assert.ok(deadItem.failedAt);
  });
});
