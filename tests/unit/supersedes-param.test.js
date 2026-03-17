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

  test("_supersede가 ConflictResolver.supersede로 위임한다", async () => {
    const { MemoryManager } = await import("../../lib/memory/MemoryManager.js");
    const mm = new MemoryManager();
    /** _supersede는 ConflictResolver.supersede 위임 래퍼 — 소스에 위임 호출이 있어야 한다 */
    const src = mm._supersede.toString();
    assert.ok(
      src.includes("conflictResolver") && src.includes("supersede"),
      "_supersede는 conflictResolver.supersede 위임 필수"
    );
  });

  test("rememberDefinition inputSchema에 supersedes가 정의되어 있다", async () => {
    const { rememberDefinition } = await import("../../lib/tools/memory.js");
    const props = rememberDefinition.inputSchema.properties;
    assert.ok(props.supersedes, "supersedes 속성 필수");
    assert.strictEqual(props.supersedes.type, "array", "supersedes는 array 타입");
    assert.strictEqual(props.supersedes.items.type, "string", "items는 string 타입");
  });
});
