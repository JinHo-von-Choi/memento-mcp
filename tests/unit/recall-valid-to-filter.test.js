/**
 * recall valid_to IS NULL 기본 필터 + includeSuperseded 옵션 검증
 *
 * 작성자: 최진호
 * 작성일: 2026-03-08
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FragmentStore } from "../../lib/memory/FragmentStore.js";

describe("recall valid_to filter", () => {
  it("searchByKeywords 메서드에 valid_to 필터가 포함되어 있다", () => {
    const src = FragmentStore.prototype.searchByKeywords.toString();
    assert.ok(src.includes("valid_to"), "searchByKeywords should reference valid_to");
  });

  it("searchBySemantic 메서드에 valid_to 필터가 포함되어 있다", () => {
    const src = FragmentStore.prototype.searchBySemantic.toString();
    assert.ok(src.includes("valid_to"), "searchBySemantic should reference valid_to");
  });

  it("searchBySemantic 시그니처에 includeSuperseded 파라미터가 있다", () => {
    const src = FragmentStore.prototype.searchBySemantic.toString();
    assert.ok(src.includes("includeSuperseded"), "searchBySemantic should accept includeSuperseded parameter");
  });

  it("searchByKeywords는 includeSuperseded 옵션을 지원한다", () => {
    const src = FragmentStore.prototype.searchByKeywords.toString();
    assert.ok(src.includes("includeSuperseded"), "searchByKeywords should check options.includeSuperseded");
  });
});
