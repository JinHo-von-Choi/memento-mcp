/**
 * Integration Test - Point-in-time 쿼리 (Temporal Schema)
 *
 * 작성자: 최진호
 * 작성일: 2026-03-03
 *
 * valid_from / valid_to 컬럼을 이용한 특정 시점 기억 조회 검증.
 * node:test 내장 모듈 사용, ES Modules.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});
const S = "agent_memory";

describe("Point-in-time 쿼리", () => {
  before(async () => {
    /** RLS: default 에이전트 컨텍스트 설정 */
    await pool.query(`SET app.current_agent_id = 'default'`);

    /** 테스트 픽스처 삽입
     *  v1: 2026-01-01 ~ 2026-02-01 유효
     *  v2: 2026-02-01 ~      유효 (현재)
     */
    await pool.query(`
      INSERT INTO ${S}.fragments
          (id, content, topic, type, importance, content_hash,
           valid_from, valid_to, agent_id)
      VALUES
          ('test-pt-v1', 'v1 content', 'test', 'fact', 0.7, 'hash-pt-v1',
           '2026-01-01'::timestamptz, '2026-02-01'::timestamptz, 'default'),
          ('test-pt-v2', 'v2 content', 'test', 'fact', 0.7, 'hash-pt-v2',
           '2026-02-01'::timestamptz, NULL, 'default')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  test("2026-01-15 시점에는 v1만 반환", async () => {
    await pool.query(`SET app.current_agent_id = 'default'`);
    const { rows } = await pool.query(`
      SELECT id FROM ${S}.fragments
      WHERE  agent_id = 'default'
        AND  valid_from <= '2026-01-15'::timestamptz
        AND  (valid_to IS NULL OR valid_to > '2026-01-15'::timestamptz)
        AND  id IN ('test-pt-v1','test-pt-v2')
    `);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, "test-pt-v1");
  });

  test("2026-02-15 시점에는 v2만 반환", async () => {
    await pool.query(`SET app.current_agent_id = 'default'`);
    const { rows } = await pool.query(`
      SELECT id FROM ${S}.fragments
      WHERE  agent_id = 'default'
        AND  valid_from <= '2026-02-15'::timestamptz
        AND  (valid_to IS NULL OR valid_to > '2026-02-15'::timestamptz)
        AND  id IN ('test-pt-v1','test-pt-v2')
    `);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, "test-pt-v2");
  });

  test("현재 시점: valid_to IS NULL만 반환", async () => {
    await pool.query(`SET app.current_agent_id = 'default'`);
    const { rows } = await pool.query(`
      SELECT id FROM ${S}.fragments
      WHERE  agent_id = 'default' AND valid_to IS NULL
        AND  id IN ('test-pt-v1','test-pt-v2')
    `);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, "test-pt-v2");
  });

  test("searchAsOf: v1 시점 조회 결과에 v1 포함, v2 미포함", async () => {
    await pool.query(`SET app.current_agent_id = 'default'`);
    const ts = "2026-01-15T00:00:00Z";
    const { rows } = await pool.query(`
      SELECT id, content, topic, type, importance,
             valid_from, valid_to, created_at
      FROM   ${S}.fragments
      WHERE  agent_id   = 'default'
        AND  valid_from <= $1::timestamptz
        AND  (valid_to IS NULL OR valid_to > $1::timestamptz)
        AND  id IN ('test-pt-v1','test-pt-v2')
      ORDER  BY importance DESC
    `, [ts]);
    const ids = rows.map(r => r.id);
    assert.ok(ids.includes("test-pt-v1"), "v1 포함 필요");
    assert.ok(!ids.includes("test-pt-v2"), "v2 제외 필요");
  });

  test("valid_from = valid_to 경계값: 정확히 만료된 시점은 반환하지 않음", async () => {
    await pool.query(`SET app.current_agent_id = 'default'`);
    /** v1의 valid_to = '2026-02-01'. 경계 시점 조회 시 v1은 만료됨 (valid_to > ts 조건 불충족) */
    const { rows } = await pool.query(`
      SELECT id FROM ${S}.fragments
      WHERE  agent_id = 'default'
        AND  valid_from <= '2026-02-01'::timestamptz
        AND  (valid_to IS NULL OR valid_to > '2026-02-01'::timestamptz)
        AND  id IN ('test-pt-v1','test-pt-v2')
    `);
    const ids = rows.map(r => r.id);
    assert.ok(!ids.includes("test-pt-v1"), "경계 시점에서 v1은 만료됨");
    assert.ok(ids.includes("test-pt-v2"), "v2는 해당 시점부터 유효");
  });

  after(async () => {
    await pool.query(`SET app.current_agent_id = 'default'`);
    await pool.query(`
      DELETE FROM ${S}.fragments
      WHERE id IN ('test-pt-v1','test-pt-v2')
    `);
    await pool.end();
  });
});
