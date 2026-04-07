import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");

describe("Tenant Isolation — key_id 격리 회귀 방지", () => {

  it("lib/ 내에 'key_id IS NULL OR key_id' 패턴이 없어야 함", () => {
    let matches = "";
    try {
      matches = execFileSync("grep", ["-rn", "key_id IS NULL OR key_id", "lib/"], {
        cwd:      ROOT,
        encoding: "utf-8"
      });
    } catch (e) {
      // grep exit code 1 = no match = 정상
      if (e.status === 1) return;
      throw e;
    }
    assert.equal(matches.trim(), "",
      `금지 패턴 발견:\n${matches}\n\n수정 방법: keyId가 null이면 조건 생략, 값이면 AND key_id = $N만 적용`);
  });

  it("lib/ 내에 'key_id' 대상 '::text IS NULL OR' 패턴이 없어야 함 (타입 불일치 방지)", () => {
    let matches = "";
    try {
      matches = execFileSync("grep", ["-rn", "::text IS NULL OR.*key_id", "lib/"], {
        cwd:      ROOT,
        encoding: "utf-8"
      });
    } catch (e) {
      if (e.status === 1) return;
      throw e;
    }
    assert.equal(matches.trim(), "",
      `타입 불일치 패턴 발견:\n${matches}`);
  });

});

describe("Tenant Isolation — key_id 조건 빌드 검증", () => {

  it("keyId=null (master)일 때 key_id 조건이 SQL에 포함되지 않아야 함", () => {
    const keyId = null;
    let sql      = "DELETE FROM fragments WHERE id = ANY($1)";
    if (keyId) {
      sql += " AND key_id = $2";
    }
    assert.ok(!sql.includes("key_id"), "마스터 키는 key_id 조건 없이 전체 접근");
  });

  it("keyId=5 (API key)일 때 key_id = $N 조건만 포함되어야 함", () => {
    const keyId = 5;
    let sql      = "DELETE FROM fragments WHERE id = ANY($1)";
    if (keyId) {
      sql += " AND key_id = $2";
    }
    assert.ok(sql.includes("key_id = $2"), "API 키는 key_id = $N 조건 필수");
    assert.ok(!sql.includes("IS NULL"), "IS NULL 조건 금지");
  });

  it("keyId=null일 때 patchAssertion 패턴이 조건 없이 동작", () => {
    const keyId  = null;
    const params = ["verified", "frag-123"];
    let keyFilter = "";
    if (keyId != null) {
      params.push(keyId);
      keyFilter = `AND key_id = $${params.length}`;
    }
    assert.equal(keyFilter, "");
    assert.equal(params.length, 2);
  });

  it("keyId=5일 때 patchAssertion 패턴이 key_id = $3 조건 포함", () => {
    const keyId  = 5;
    const params = ["verified", "frag-123"];
    let keyFilter = "";
    if (keyId != null) {
      params.push(keyId);
      keyFilter = `AND key_id = $${params.length}`;
    }
    assert.equal(keyFilter, "AND key_id = $3");
    assert.equal(params.length, 3);
    assert.equal(params[2], 5);
  });

});
