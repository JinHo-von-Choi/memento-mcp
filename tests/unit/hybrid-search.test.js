/**
 * RRF 하이브리드 검색 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-03
 */

import { test, describe } from "node:test";
import assert             from "node:assert/strict";
import { mergeRRF }       from "../../lib/memory/FragmentSearch.js";

const l1Ids     = ["b"];
const l2Results = [
  { id: "a", content: "foo", importance: 0.8 },
  { id: "b", content: "bar", importance: 0.6 }
];
const l3Results = [
  { id: "b", content: "bar", similarity: 0.9 },
  { id: "c", content: "baz", similarity: 0.7 }
];

describe("mergeRRF", () => {
  test("L1, L2, L3 결과가 모두 병합되어야 한다", () => {
    const merged = mergeRRF(l1Ids, l2Results, l3Results);
    const ids    = merged.map(f => f.id);
    assert.ok(ids.includes("a"));
    assert.ok(ids.includes("b"));
    assert.ok(ids.includes("c"));
  });

  test("L1에 있는 파편(b)이 가장 높은 점수여야 한다", () => {
    const merged = mergeRRF(l1Ids, l2Results, l3Results);
    assert.strictEqual(merged[0].id, "b");
  });

  test("중복 파편이 없어야 한다", () => {
    const merged = mergeRRF(l1Ids, l2Results, l3Results);
    const ids    = merged.map(f => f.id);
    assert.strictEqual(ids.length, new Set(ids).size);
  });

  test("빈 L1으로도 동작해야 한다", () => {
    assert.doesNotThrow(() => mergeRRF([], l2Results, l3Results));
  });
});
