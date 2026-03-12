/**
 * Legacy SSE 인증 보안 테스트
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeCompare } from "../../lib/auth.js";

describe("safeCompare", () => {
  it("동일 문자열 비교 시 true", () => {
    assert.strictEqual(safeCompare("test-key-123", "test-key-123"), true);
  });

  it("다른 문자열 비교 시 false", () => {
    assert.strictEqual(safeCompare("test-key-123", "wrong-key"), false);
  });

  it("빈 문자열 처리", () => {
    assert.strictEqual(safeCompare("", ""), true);
    assert.strictEqual(safeCompare("", "x"), false);
  });
});
