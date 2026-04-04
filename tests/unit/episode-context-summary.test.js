import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ReflectProcessor } from "../../lib/memory/ReflectProcessor.js";

/** _buildEpisodeContext는 ReflectProcessor의 private 메서드이므로 인스턴스를 통해 접근 */
function createProcessor() {
  return new ReflectProcessor({
    store        : { insert: mock.fn(async () => "id-1") },
    index        : { index: mock.fn(async () => {}), clearWorkingMemory: mock.fn(async () => {}) },
    factory      : { create: mock.fn(() => ({})), splitAndCreate: mock.fn(() => []) },
    sessionLinker: { consolidateSessionFragments: mock.fn(async () => null), autoLinkSessionFragments: mock.fn(async () => {}) },
    remember     : mock.fn(async () => ({})),
  });
}

describe("_buildEpisodeContext", () => {
  it("summarizes fragment types and keywords", () => {
    const rp        = createProcessor();
    const fragments = [
      { type: "fact",     keywords: ["HNSW", "튜닝"] },
      { type: "fact",     keywords: ["L1",   "캐시"] },
      { type: "decision", keywords: ["HNSW", "ef_search"] },
    ];
    const ctx = rp._buildEpisodeContext({}, fragments);
    assert.ok(ctx.includes("fact 2건"));
    assert.ok(ctx.includes("decision 1건"));
    assert.ok(ctx.includes("3건 저장"));
  });

  it("handles empty fragments", () => {
    const rp  = createProcessor();
    const ctx = rp._buildEpisodeContext({}, []);
    assert.ok(ctx.includes("0건 저장"));
  });

  it("limits keywords to 5", () => {
    const rp        = createProcessor();
    const fragments = [
      { type: "fact", keywords: ["a", "b", "c", "d", "e", "f", "g"] },
    ];
    const ctx   = rp._buildEpisodeContext({}, fragments);
    const match = ctx.match(/주요 키워드: (.+)\./);
    assert.ok(match);
    const kws = match[1].split(", ");
    assert.ok(kws.length <= 5);
  });
});
