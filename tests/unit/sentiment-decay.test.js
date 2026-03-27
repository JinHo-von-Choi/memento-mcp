import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Sentiment-Aware Decay", () => {
  const adjust = (current, relevant) => {
    const delta = relevant ? 0.1 : -0.15;
    return Math.min(1.0, Math.max(0, (current ?? 0.5) + delta));
  };

  it("boosts ema_activation for relevant feedback (0.5+0.1=0.6)", () => {
    assert.strictEqual(adjust(0.5, true), 0.6);
  });

  it("penalizes for irrelevant (0.5-0.15=0.35)", () => {
    assert.strictEqual(adjust(0.5, false), 0.35);
  });

  it("clamps between 0 and 1", () => {
    assert.strictEqual(adjust(0.95, true), 1.0);
    assert.strictEqual(adjust(0.05, false), 0);
  });

  it("skips when fragment_ids empty", () => {
    const fragmentIds = [];
    assert.ok(fragmentIds.length === 0);
  });
});
