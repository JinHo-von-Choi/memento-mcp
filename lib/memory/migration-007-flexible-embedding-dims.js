#!/usr/bin/env node
/**
 * migration-007-flexible-embedding-dims.js
 *
 * 작성자: 최진호
 * 작성일: 2026-03-08
 *
 * EMBEDDING_DIMENSIONS 환경변수에 따라 fragments.embedding 컬럼 타입을 조정한다.
 * - ≤2000차원: vector(N)  + HNSW 인덱스
 * - >2000차원: halfvec(N) + HNSW 인덱스 (pgvector ≥0.7.0 필요)
 *
 * 실행: EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL node lib/memory/migration-007-flexible-embedding-dims.js
 *
 * 주의: 컬럼 타입 변경 시 기존 임베딩 데이터가 NULL로 초기화된다.
 *       실행 후 backfill-embeddings.js로 재임베딩이 필요하다.
 */

import { getPrimaryPool } from "../tools/db.js";
import { EMBEDDING_DIMENSIONS } from "../config.js";

const SCHEMA     = "agent_memory";
const TABLE      = "fragments";
const INDEX_NAME = "idx_frag_embedding";

async function main() {
  const dims       = EMBEDDING_DIMENSIONS;
  const useHalfvec = dims > 2000;
  const colType    = useHalfvec ? `halfvec(${dims})` : `vector(${dims})`;

  console.log(`EMBEDDING_DIMENSIONS = ${dims}`);
  console.log(`컬럼 타입 → ${colType} (${useHalfvec ? "halfvec — pgvector ≥0.7.0 필요" : "vector"})`);

  const pool = getPrimaryPool();

  try {
    /** 1. 현재 컬럼 타입 조회 */
    const { rows } = await pool.query(
      `SELECT udt_name
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'embedding'`,
      [SCHEMA, TABLE]
    );

    if (rows.length === 0) {
      console.error(`컬럼 ${SCHEMA}.${TABLE}.embedding 을 찾을 수 없습니다.`);
      process.exit(1);
    }

    const currentType = rows[0].udt_name;
    console.log(`현재 컬럼 타입: ${currentType}`);

    const targetUdt = useHalfvec ? "halfvec" : "vector";
    if (currentType === targetUdt) {
      console.log("컬럼 타입이 이미 목표 타입과 일치합니다. 스킵.");
      return;
    }

    /** 2. 기존 HNSW 인덱스 삭제 (ALTER COLUMN 전 필수) */
    console.log(`인덱스 ${INDEX_NAME} 삭제 중...`);
    await pool.query(`DROP INDEX IF EXISTS ${SCHEMA}.${INDEX_NAME}`);

    /** 3. 컬럼 타입 변환 — 기존 임베딩 NULL로 초기화 */
    console.log(`컬럼 타입 변환 중: ${currentType} → ${colType} (임베딩 데이터 NULL 초기화)`);
    await pool.query(
      `ALTER TABLE ${SCHEMA}.${TABLE}
       ALTER COLUMN embedding TYPE ${colType} USING NULL`
    );

    /** 4. HNSW 인덱스 재생성 */
    console.log("HNSW 인덱스 재생성 중...");
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${INDEX_NAME}
       ON ${SCHEMA}.${TABLE}
       USING hnsw (embedding vector_cosine_ops)
       WITH (m = 16, ef_construction = 64)
       WHERE embedding IS NOT NULL`
    );

    console.log("마이그레이션 완료.");
    console.log("임베딩 데이터가 초기화되었습니다. backfill-embeddings.js를 실행하여 재임베딩하세요.");
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
