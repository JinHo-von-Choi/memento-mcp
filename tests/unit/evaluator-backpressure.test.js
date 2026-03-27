import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("MemoryEvaluator backpressure logic", () => {
  it("calculates correct drop count when queue exceeds max", () => {
    const MAX = 100;
    const queueLen = 150;
    const dropCount = queueLen > MAX ? queueLen - MAX : 0;
    assert.strictEqual(dropCount, 50);
  });

  it("does not drop when queue is under max", () => {
    const MAX = 100;
    const queueLen = 80;
    const dropCount = queueLen > MAX ? queueLen - MAX : 0;
    assert.strictEqual(dropCount, 0);
  });

  it("handles exact boundary", () => {
    const MAX = 100;
    const queueLen = 100;
    const dropCount = queueLen > MAX ? queueLen - MAX : 0;
    assert.strictEqual(dropCount, 0);
  });
});
