/**
 * SearchParamAdaptor 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-07
 */

import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

/** db.js, logger.js, config mock 등록 (SearchParamAdaptor import 전에 실행) */
const mockQuery = mock.fn();
const mockPool  = { query: mockQuery };

mock.module("../../lib/tools/db.js", {
  namedExports: { getPrimaryPool: () => mockPool }
});
mock.module("../../lib/logger.js", {
  namedExports: { logWarn: mock.fn() }
});
mock.module("../../config/memory.js", {
  namedExports: {
    MEMORY_CONFIG: { semanticSearch: { minSimilarity: 0.35 } }
  }
});

const { SearchParamAdaptor, _resetForTesting } = await import(
  "../../lib/memory/SearchParamAdaptor.js"
);

describe("SearchParamAdaptor", () => {
  beforeEach(() => {
    mockQuery.mock.resetCalls();
    _resetForTesting();
  });

  test("sample < MIN_SAMPLE(50)이면 default 0.35 반환", async () => {
    mockQuery.mock.mockImplementationOnce(() =>
      Promise.resolve({
        rows: [{ min_similarity: 0.40, sample_count: 10, total_result_count: 30 }]
      })
    );

    const adaptor = new SearchParamAdaptor();
    const result  = await adaptor.getMinSimilarity(null, "text", 10);

    assert.strictEqual(result, 0.35);
    // null -> -1 변환 확인
    assert.strictEqual(mockQuery.mock.calls[0].arguments[1][0], -1);
  });

  test("sample >= MIN_SAMPLE이면 학습된 값 반환", async () => {
    mockQuery.mock.mockImplementationOnce(() =>
      Promise.resolve({
        rows: [{ min_similarity: 0.28, sample_count: 60, total_result_count: 180 }]
      })
    );

    const adaptor = new SearchParamAdaptor();
    const result  = await adaptor.getMinSimilarity(42, "text", 14);

    assert.ok(
      Math.abs(result - 0.28) < 0.001,
      `expected ~0.28, got ${result}`
    );
  });

  test("DB 조회 실패 시 default 0.35 반환", async () => {
    mockQuery.mock.mockImplementationOnce(() =>
      Promise.reject(new Error("connection refused"))
    );

    const adaptor = new SearchParamAdaptor();
    const result  = await adaptor.getMinSimilarity(null, "keywords", 8);

    assert.strictEqual(result, 0.35);
  });

  test("recordOutcome: 단일 원자적 UPSERT 호출", async () => {
    mockQuery.mock.mockImplementationOnce(() =>
      Promise.resolve({ rowCount: 1 })
    );

    const adaptor = new SearchParamAdaptor();
    await adaptor.recordOutcome(null, "text", 10, 3);

    assert.strictEqual(mockQuery.mock.callCount(), 1);
    const [sql, params] = mockQuery.mock.calls[0].arguments;

    // 단일 UPSERT 패턴 확인 (SELECT 없음)
    assert.match(sql, /INSERT.*ON CONFLICT.*DO UPDATE/is);
    // key_id: null -> -1 변환
    assert.strictEqual(params[0], -1);
    assert.deepStrictEqual(params, [-1, "text", 10, 0.35, 3]);
  });

  test("recordOutcome: DB 오류 시 예외 전파 없음", async () => {
    mockQuery.mock.mockImplementationOnce(() =>
      Promise.reject(new Error("disk full"))
    );

    const adaptor = new SearchParamAdaptor();
    // 예외가 전파되지 않아야 한다
    await adaptor.recordOutcome(42, "keywords", 15, 5);
  });
});
