import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("remember supersedes parameter", () => {
  test("MemoryManager.remember이 supersedes 파라미터를 받는다", async () => {
    const { MemoryManager } = await import("../../lib/memory/MemoryManager.js");
    const mm = new MemoryManager();
    const src = mm.remember.toString();
    assert.ok(src.includes("supersedes"), "remember에 supersedes 처리 로직 필수");
  });

  test("MemoryManager._supersede 헬퍼가 존재한다", async () => {
    const { MemoryManager } = await import("../../lib/memory/MemoryManager.js");
    const mm = new MemoryManager();
    assert.strictEqual(typeof mm._supersede, "function", "_supersede 메서드 필수");
  });

  test("_supersede가 superseded_by 링크와 valid_to 갱신을 수행한다", async () => {
    const { MemoryManager } = await import("../../lib/memory/MemoryManager.js");
    const mm = new MemoryManager();
    const src = mm._supersede.toString();
    assert.ok(src.includes("superseded_by"), "superseded_by 링크 생성 필수");
    assert.ok(src.includes("valid_to"), "valid_to 갱신 필수");
    assert.ok(src.includes("GREATEST(0.05"), "importance 하한 0.05 필수");
  });

  test("rememberDefinition inputSchema에 supersedes가 정의되어 있다", async () => {
    const { rememberDefinition } = await import("../../lib/tools/memory.js");
    const props = rememberDefinition.inputSchema.properties;
    assert.ok(props.supersedes, "supersedes 속성 필수");
    assert.strictEqual(props.supersedes.type, "array", "supersedes는 array 타입");
    assert.strictEqual(props.supersedes.items.type, "string", "items는 string 타입");
  });
});
