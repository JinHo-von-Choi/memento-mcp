/**
 * decay.js 단위 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-03
 */

import { test, describe } from "node:test";
import assert             from "node:assert/strict";
import { computeDecayedImportance, HALF_LIFE_DAYS } from "../../lib/memory/decay.js";

describe("computeDecayedImportance", () => {
    test("Δt=0이면 초기값 유지", () => {
        assert.strictEqual(computeDecayedImportance(0.8, 0, "fact"), 0.8);
    });

    test("halfLife 경과 후 importance가 절반", () => {
        const hl     = HALF_LIFE_DAYS["fact"] * 86400_000;
        const result = computeDecayedImportance(0.8, hl, "fact");
        assert.ok(Math.abs(result - 0.4) < 0.001);
    });

    test("최소값 0.05 미만으로 내려가지 않음", () => {
        const result = computeDecayedImportance(0.5, 10 * 365 * 86400_000, "fact");
        assert.ok(result >= 0.05);
    });

    test("isAnchor=true면 감쇠 없음", () => {
        const result = computeDecayedImportance(0.8, 365 * 86400_000, "fact", true);
        assert.strictEqual(result, 0.8);
    });
});
