import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeL2 } from "../../lib/tools/embedding.js";

describe("normalizeL2", () => {
    test("단위 벡터는 정규화 후 동일해야 한다", () => {
        const result = normalizeL2([1, 0, 0]);
        assert.deepStrictEqual(result.map(v => Math.round(v * 1000) / 1000), [1, 0, 0]);
    });

    test("정규화된 벡터의 L2 norm은 1이어야 한다", () => {
        const result = normalizeL2([3, 4]);
        const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
        assert.ok(Math.abs(norm - 1.0) < 1e-10, `norm should be ~1, got ${norm}`);
    });

    test("영벡터는 그대로 반환한다 (zero division 방지)", () => {
        assert.deepStrictEqual(normalizeL2([0, 0, 0]), [0, 0, 0]);
    });

    test("일반 벡터 정규화 검증", () => {
        const result = normalizeL2([1, 2, 3]);
        const norm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
        assert.ok(Math.abs(norm - 1.0) < 1e-10);
    });
});
