// tests/evaluation-metrics.test.js
import { computePrecisionAt } from "../lib/memory/EvaluationMetrics.js";

describe("computePrecisionAt", () => {
    it("relevant 3개 / 전체 5개 = 0.6", () => {
        const result = computePrecisionAt([
            { relevant: true  },
            { relevant: false },
            { relevant: true  },
            { relevant: false },
            { relevant: true  }
        ], 5);
        expect(result).toBeCloseTo(0.6, 2);
    });

    it("전체가 k보다 적으면 실제 수로 나눈다", () => {
        const result = computePrecisionAt([
            { relevant: true },
            { relevant: true }
        ], 5);
        expect(result).toBeCloseTo(1.0, 2);
    });

    it("빈 배열이면 null 반환", () => {
        expect(computePrecisionAt([], 5)).toBeNull();
    });

    it("relevant 0개면 0.0", () => {
        const result = computePrecisionAt([
            { relevant: false },
            { relevant: false }
        ], 5);
        expect(result).toBe(0.0);
    });
});
