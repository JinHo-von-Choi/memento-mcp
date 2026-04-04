/**
 * QuotaChecker — API 키별 파편 할당량 검사
 *
 * 작성자: 최진호
 * 작성일: 2026-04-04
 *
 * MemoryManager.remember()에서 인라인으로 처리하던 할당량 검사 트랜잭션을 추출.
 * keyId가 null(마스터 키)이면 검사를 건너뛴다.
 */

import { getPrimaryPool } from "../tools/db.js";

export class QuotaChecker {
  #pool = null;

  /** 테스트용 pool 주입 */
  setPool(pool) { this.#pool = pool; }

  /**
   * API 키의 파편 할당량을 검사한다.
   * 초과 시 code="fragment_limit_exceeded" Error를 throw한다.
   * keyId가 null(마스터 키)이면 검사를 건너뛴다.
   *
   * @param {string|null} keyId
   */
  async check(keyId) {
    if (!keyId) return;

    const pool = this.#pool || getPrimaryPool();
    if (!pool) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.current_agent_id = 'system'");

      const { rows: [keyRow] } = await client.query(
        `SELECT fragment_limit FROM agent_memory.api_keys WHERE id = $1 FOR UPDATE`,
        [keyId]
      );

      if (keyRow && keyRow.fragment_limit !== null) {
        const { rows: [countRow] } = await client.query(
          `SELECT COUNT(*)::int AS count FROM agent_memory.fragments
           WHERE key_id = $1 AND valid_to IS NULL`,
          [keyId]
        );

        if (countRow.count >= keyRow.fragment_limit) {
          await client.query("ROLLBACK");
          const err    = new Error(
            `Fragment limit reached (${countRow.count}/${keyRow.fragment_limit}). Delete unused fragments or request a higher limit.`
          );
          err.code     = "fragment_limit_exceeded";
          err.current  = countRow.count;
          err.limit    = keyRow.fragment_limit;
          throw err;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
