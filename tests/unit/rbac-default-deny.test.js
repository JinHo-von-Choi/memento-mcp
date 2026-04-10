/**
 * RBAC default-deny 및 전체 도구 맵핑 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-10
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkPermission, TOOL_PERMISSIONS } from "../../lib/rbac.js";

describe("RBAC default-deny + complete tool map", () => {

  /** 1. unknown_tool은 권한과 무관하게 항상 deny */
  it("denies unknown tool for read-only permissions", () => {
    const r = checkPermission(["read"], "unknown_tool");
    assert.ok(!r.allowed);
    assert.strictEqual(r.reason, "unknown_tool");
  });

  it("denies unknown tool for write permissions", () => {
    const r = checkPermission(["read", "write"], "new_unknown_tool");
    assert.ok(!r.allowed);
    assert.strictEqual(r.reason, "unknown_tool");
  });

  /** 2. master key(null)는 unknown_tool도 deny */
  it("denies unknown tool even for master key (null)", () => {
    const r = checkPermission(null, "completely_unknown");
    assert.ok(!r.allowed);
    assert.strictEqual(r.reason, "unknown_tool");
  });

  /** 3. 신규 추가 도구: batch_remember */
  it("allows batch_remember with write permission", () => {
    assert.ok(checkPermission(["write"], "batch_remember").allowed);
  });

  it("denies batch_remember with read-only permission", () => {
    const r = checkPermission(["read"], "batch_remember");
    assert.ok(!r.allowed);
    assert.strictEqual(r.required, "write");
  });

  /** 4. 신규 추가 도구: reconstruct_history */
  it("allows reconstruct_history with read permission", () => {
    assert.ok(checkPermission(["read"], "reconstruct_history").allowed);
  });

  it("denies reconstruct_history with no read permission", () => {
    const r = checkPermission(["write"], "reconstruct_history");
    assert.ok(!r.allowed);
    assert.strictEqual(r.required, "read");
  });

  /** 5. 신규 추가 도구: search_traces */
  it("allows search_traces with read permission", () => {
    assert.ok(checkPermission(["read"], "search_traces").allowed);
  });

  /** 6. 신규 추가 도구: get_skill_guide */
  it("allows get_skill_guide with read permission", () => {
    assert.ok(checkPermission(["read"], "get_skill_guide").allowed);
  });

  /** 7. admin 권한은 모든 알려진 도구를 허용 */
  it("admin permission allows all known tools", () => {
    for (const toolName of Object.keys(TOOL_PERMISSIONS)) {
      const r = checkPermission(["admin"], toolName);
      assert.ok(r.allowed, `admin should allow tool: ${toolName}`);
    }
  });

  /** 8. 권한 조합: read+write는 admin 전용 도구를 허용하지 않음 */
  it("read+write cannot access admin-only tool memory_consolidate", () => {
    const r = checkPermission(["read", "write"], "memory_consolidate");
    assert.ok(!r.allowed);
    assert.strictEqual(r.required, "admin");
  });

});
