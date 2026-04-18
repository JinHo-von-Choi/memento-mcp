/**
 * check-embedding-consistency.js
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 *
 * 임베딩 차원 일관성 startup 검증.
 *
 * EMBEDDING_DIMENSIONS 설정값과 DB의 실제 벡터 차원이 일치하는지 확인한다.
 * 불일치 시 server.js 기동 전에 명확한 가이드를 출력하고 false를 반환한다.
 */

import { getPrimaryPool }                                     from "../lib/tools/db.js";
import { EMBEDDING_DIMENSIONS, EMBEDDING_PROVIDER, EMBEDDING_MODEL } from "../lib/config.js";

const TABLES = ["fragments", "morpheme_dict"];

export async function checkEmbeddingConsistency() {
  const pool      = getPrimaryPool();
  const mismatches = [];

  for (const table of TABLES) {
    try {
      const { rows } = await pool.query(`
        SELECT vector_dims(embedding) AS dim
        FROM agent_memory.${table}
        WHERE embedding IS NOT NULL
        LIMIT 1
      `);
      if (rows.length > 0 && rows[0].dim !== EMBEDDING_DIMENSIONS) {
        mismatches.push({ table, dbDim: rows[0].dim, configDim: EMBEDDING_DIMENSIONS });
      }
    } catch {
      /** 테이블 미존재 또는 halfvec 타입 → vector_dims 에러는 무시 */
    }
  }

  if (mismatches.length > 0) {
    console.error("\n[embedding-consistency] 차원 불일치 발견:");
    for (const m of mismatches) {
      console.error(`  - ${m.table}: DB=${m.dbDim}d, config=${m.configDim}d`);
    }
    console.error(`\nconfig: provider=${EMBEDDING_PROVIDER}, model=${EMBEDDING_MODEL}, dims=${EMBEDDING_DIMENSIONS}`);
    console.error("\n해결 방법:");
    console.error("  1. 이전 provider로 복구");
    console.error("  2. EMBEDDING_DIMENSIONS=N npm run migrate-007 실행 + node scripts/backfill-embeddings.js");
    console.error("\n데이터 혼합 방지를 위해 기동을 중단합니다.\n");
    return false;
  }

  return true;
}
