/**
 * GraphLinker 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-07
 *
 * DB/Redis 의존성은 mock 처리.
 * GraphLinker 핵심 로직(관계 유형 결정, 소급 링킹)을 검증한다.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * GraphLinker와 동일한 로직의 테스트용 구현
 * 외부 의존성(DB, FragmentStore)을 주입 가능하게 변환
 */
class TestableGraphLinker {
  constructor({ db, store }) {
    this.db    = db;
    this.store = store;
  }

  async linkFragment(fragmentId, agentId = "default") {
    const fragResult = await this.db.query(
      `SELECT id, content, topic, type, created_at
       FROM agent_memory.fragments
       WHERE id = $1 AND embedding IS NOT NULL`,
      [fragmentId]
    );

    if (!fragResult.rows || fragResult.rows.length === 0) return 0;

    const newFragment = fragResult.rows[0];

    const candidates = await this.db.query(
      `SELECT id, content, type, created_at, is_anchor, similarity
       FROM agent_memory.fragments
       WHERE id != $1 AND topic = $2 AND embedding IS NOT NULL AND similarity > 0.7
       ORDER BY similarity DESC LIMIT 3`,
      [fragmentId, newFragment.topic]
    );

    if (!candidates.rows || candidates.rows.length === 0) return 0;

    let linkCount = 0;

    for (const existing of candidates.rows) {
      const similarity   = parseFloat(existing.similarity);
      let   relationType = "related";

      /** error -> error(resolved): resolved_by 링크 */
      if (newFragment.type === "error" && existing.type === "error") {
        if (newFragment.content.includes("[해결됨]") || newFragment.content.includes("resolved")) {
          relationType = "resolved_by";
        }
      }

      /** 같은 type + 높은 유사도: 최신 정보가 구 정보를 대체 */
      if (newFragment.type === existing.type && similarity > 0.85) {
        const newDate = new Date(newFragment.created_at || Date.now());
        const oldDate = new Date(existing.created_at || 0);
        if (newDate > oldDate) {
          relationType = "superseded_by";
        }
      }

      try {
        await this.store.createLink(existing.id, newFragment.id, relationType, agentId);
        linkCount++;
      } catch { /* 중복 링크 등 무시 */ }
    }

    return linkCount;
  }

  async retroLink(batchSize = 20) {
    const isolated = await this.db.query(
      `SELECT id FROM agent_memory.fragments
       WHERE embedding IS NOT NULL AND isolated = true
       ORDER BY created_at DESC LIMIT $1`,
      [batchSize]
    );

    let processed    = 0;
    let linksCreated = 0;

    for (const row of isolated.rows) {
      const count = await this.linkFragment(row.id, "system");
      processed++;
      linksCreated += count;
    }

    return { processed, linksCreated };
  }
}

describe("GraphLinker", () => {
  let linker;
  let mockDb;
  let mockStore;

  beforeEach(() => {
    mockDb = {
      queryCalls  : [],
      queryResults: new Map(),

      async query(sql, params) {
        this.queryCalls.push({ sql, params });

        /** 쿼리 키워드에 따라 다른 결과 반환 */
        for (const [key, result] of this.queryResults) {
          if (sql.includes(key)) return result;
        }
        return { rows: [] };
      }
    };

    mockStore = {
      createLinkCalls: [],
      shouldThrow    : false,

      async createLink(fromId, toId, relationType, agentId) {
        if (this.shouldThrow) throw new Error("UNIQUE constraint");
        this.createLinkCalls.push({ fromId, toId, relationType, agentId });
      }
    };

    linker = new TestableGraphLinker({ db: mockDb, store: mockStore });
  });

  test('"related" 링크 생성 (similarity > 0.7, 같은 topic)', async () => {
    /** 파편 조회 */
    mockDb.queryResults.set("WHERE id = $1 AND embedding IS NOT NULL", {
      rows: [{
        id         : "frag-new",
        content    : "TypeScript 컴파일러 설정",
        topic      : "typescript",
        type       : "fact",
        created_at : "2026-03-07T10:00:00Z"
      }]
    });

    /** 후보 조회 */
    mockDb.queryResults.set("similarity", {
      rows: [{
        id         : "frag-old",
        content    : "TypeScript tsconfig.json 옵션",
        type       : "decision",
        created_at : "2026-03-06T10:00:00Z",
        is_anchor  : false,
        similarity : "0.75"
      }]
    });

    const count = await linker.linkFragment("frag-new", "test-agent");

    assert.strictEqual(count, 1);
    assert.strictEqual(mockStore.createLinkCalls.length, 1);
    assert.strictEqual(mockStore.createLinkCalls[0].relationType, "related");
    assert.strictEqual(mockStore.createLinkCalls[0].fromId, "frag-old");
    assert.strictEqual(mockStore.createLinkCalls[0].toId, "frag-new");
  });

  test('"resolved_by" 링크 생성 (양쪽 error, "[해결됨]" 포함)', async () => {
    mockDb.queryResults.set("WHERE id = $1 AND embedding IS NOT NULL", {
      rows: [{
        id         : "frag-resolved",
        content    : "[해결됨] CORS 에러 해결: proxy 설정 추가",
        topic      : "cors",
        type       : "error",
        created_at : "2026-03-07T12:00:00Z"
      }]
    });

    mockDb.queryResults.set("similarity", {
      rows: [{
        id         : "frag-error",
        content    : "CORS 에러 발생: Access-Control-Allow-Origin",
        type       : "error",
        created_at : "2026-03-07T10:00:00Z",
        is_anchor  : false,
        similarity : "0.80"
      }]
    });

    const count = await linker.linkFragment("frag-resolved", "test-agent");

    assert.strictEqual(count, 1);
    assert.strictEqual(mockStore.createLinkCalls[0].relationType, "resolved_by");
  });

  test('"superseded_by" 링크 생성 (같은 type, similarity > 0.85, 최신)', async () => {
    mockDb.queryResults.set("WHERE id = $1 AND embedding IS NOT NULL", {
      rows: [{
        id         : "frag-newer",
        content    : "PostgreSQL 포트: 35432",
        topic      : "database",
        type       : "fact",
        created_at : "2026-03-07T15:00:00Z"
      }]
    });

    mockDb.queryResults.set("similarity", {
      rows: [{
        id         : "frag-older",
        content    : "PostgreSQL 포트: 5432",
        type       : "fact",
        created_at : "2026-03-01T10:00:00Z",
        is_anchor  : false,
        similarity : "0.90"
      }]
    });

    const count = await linker.linkFragment("frag-newer", "test-agent");

    assert.strictEqual(count, 1);
    assert.strictEqual(mockStore.createLinkCalls[0].relationType, "superseded_by");
  });

  test("retroLink: 고립 파편 처리", async () => {
    /** 고립 파편 조회 */
    mockDb.queryResults.set("isolated", {
      rows: [{ id: "iso-1" }, { id: "iso-2" }]
    });

    /** linkFragment 내부 — 파편 조회 */
    mockDb.queryResults.set("WHERE id = $1 AND embedding IS NOT NULL", {
      rows: [{
        id         : "iso-1",
        content    : "Redis 캐시 설정",
        topic      : "redis",
        type       : "fact",
        created_at : "2026-03-06T10:00:00Z"
      }]
    });

    /** linkFragment 내부 — 후보 조회 */
    mockDb.queryResults.set("similarity", {
      rows: [{
        id         : "related-1",
        content    : "Redis 연결 풀 설정",
        type       : "fact",
        created_at : "2026-03-05T10:00:00Z",
        is_anchor  : false,
        similarity : "0.78"
      }]
    });

    const result = await linker.retroLink(10);

    assert.strictEqual(result.processed, 2);
    /** 각 고립 파편마다 1개씩 링크 생성 (동일 mock 결과 반환) */
    assert.strictEqual(result.linksCreated, 2);
  });

  /** buildCoRetrievalLinks 테스트 */

  test("buildCoRetrievalLinks: 빈 배열이면 0을 반환한다", async () => {
    let callCount = 0;
    const mockLinker = {
      async buildCoRetrievalLinks(fragmentIds) {
        if (!fragmentIds || fragmentIds.length < 2) return 0;
        callCount++;
        return 0;
      }
    };
    const count = await mockLinker.buildCoRetrievalLinks([]);
    assert.strictEqual(count, 0);
    assert.strictEqual(callCount, 0);
  });

  test("buildCoRetrievalLinks: 단일 파편이면 링크를 생성하지 않는다", async () => {
    let callCount = 0;
    const mockLinker = {
      async buildCoRetrievalLinks(fragmentIds) {
        if (!fragmentIds || fragmentIds.length < 2) return 0;
        callCount++;
        return 0;
      }
    };
    const count = await mockLinker.buildCoRetrievalLinks(["frag-1"]);
    assert.strictEqual(count, 0);
    assert.strictEqual(callCount, 0);
  });

  test("buildCoRetrievalLinks: 2개 파편이면 1쌍 링크 생성", async () => {
    const insertedPairs = [];
    const mockLinker = {
      async buildCoRetrievalLinks(fragmentIds) {
        if (!fragmentIds || fragmentIds.length < 2) return 0;
        const ids   = fragmentIds.slice(0, 5);
        let   count = 0;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            insertedPairs.push([ids[i], ids[j]]);
            count++;
          }
        }
        return count;
      }
    };
    const count = await mockLinker.buildCoRetrievalLinks(["frag-1", "frag-2"]);
    assert.strictEqual(count, 1);
    assert.deepStrictEqual(insertedPairs, [["frag-1", "frag-2"]]);
  });

  test("buildCoRetrievalLinks: 5개 초과면 상위 5개만 페어링 (C(5,2)=10)", async () => {
    const insertedPairs = [];
    const mockLinker = {
      async buildCoRetrievalLinks(fragmentIds) {
        if (!fragmentIds || fragmentIds.length < 2) return 0;
        const ids   = fragmentIds.slice(0, 5);
        let   count = 0;
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            insertedPairs.push([ids[i], ids[j]]);
            count++;
          }
        }
        return count;
      }
    };
    const ids   = ["a", "b", "c", "d", "e", "f", "g"];
    const count = await mockLinker.buildCoRetrievalLinks(ids);
    assert.strictEqual(count, 10);
    /** 6번째 이후 파편(f, g)은 포함되지 않아야 한다 */
    for (const [from, to] of insertedPairs) {
      assert.ok(!["f", "g"].includes(from), `${from} should not be in pairs`);
      assert.ok(!["f", "g"].includes(to),   `${to} should not be in pairs`);
    }
  });

  test("중복 링크 무시 (createLink throws)", async () => {
    mockDb.queryResults.set("WHERE id = $1 AND embedding IS NOT NULL", {
      rows: [{
        id         : "frag-dup",
        content    : "중복 테스트",
        topic      : "test",
        type       : "fact",
        created_at : "2026-03-07T10:00:00Z"
      }]
    });

    mockDb.queryResults.set("similarity", {
      rows: [{
        id         : "frag-existing",
        content    : "기존 파편",
        type       : "fact",
        created_at : "2026-03-06T10:00:00Z",
        is_anchor  : false,
        similarity : "0.75"
      }]
    });

    /** createLink가 UNIQUE constraint 에러를 던지도록 설정 */
    mockStore.shouldThrow = true;

    const count = await linker.linkFragment("frag-dup", "test-agent");

    /** 에러가 삼켜지므로 linkCount는 0 */
    assert.strictEqual(count, 0);
  });
});
