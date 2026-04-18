#!/usr/bin/env node
/**
 * migration-007-flexible-embedding-dims.js
 *
 * 작성자: 최진호
 * 작성일: 2026-03-08
 * 수정일: 2026-04-18
 *
 * EMBEDDING_DIMENSIONS 환경변수에 따라 fragments + morpheme_dict 테이블의
 * embedding 컬럼 타입을 동시에 조정한다.
 * - ≤2000차원: vector(N)  + HNSW 인덱스
 * - >2000차원: halfvec(N) + HNSW 인덱스 (pgvector ≥0.7.0 필요)
 *
 * 실행: EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL node scripts/migration-007-flexible-embedding-dims.js
 *
 * 주의: 컬럼 타입 변경 시 기존 임베딩 데이터가 NULL로 초기화된다.
 *       실행 후 backfill-embeddings.js로 재임베딩이 필요하다.
 */

import { getPrimaryPool } from "../lib/tools/db.js";
import { EMBEDDING_DIMENSIONS } from "../lib/config.js";

const SCHEMA = "agent_memory";

/** fragments + morpheme_dict 둘 다 갱신 */
const TABLES = [
  { table: "fragments",     indexName: "idx_frag_embedding",          whereClause: "WHERE embedding IS NOT NULL" },
  { table: "morpheme_dict", indexName: "idx_morpheme_dict_embedding",  whereClause: ""                            }
];

async function migrateTable(pool, { table, indexName, whereClause }, colType, opsType, targetUdt) {
  /** 1. 현재 컬럼 타입 조회 */
  const { rows } = await pool.query(
    `SELECT udt_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = 'embedding'`,
    [SCHEMA, table]
  );

  if (rows.length === 0) {
    console.log(`migration-007: ${table} — embedding 컬럼 없음, 스킵`);
    return;
  }

  const currentType = rows[0].udt_name;
  console.log(`migration-007: ${table} — 현재 타입: ${currentType}`);

  if (currentType === targetUdt) {
    console.log(`migration-007: ${table} — 이미 ${colType}, 스킵`);
    return;
  }

  /** 2. 기존 HNSW 인덱스 삭제 (ALTER COLUMN 전 필수) */
  console.log(`migration-007: ${table} — 인덱스 ${indexName} 삭제 중...`);
  await pool.query(`DROP INDEX IF EXISTS ${SCHEMA}.${indexName}`);

  /** 3. 컬럼 타입 변환 — 기존 임베딩 NULL로 초기화 */
  console.log(`migration-007: ${table} — 컬럼 타입 변환 중: ${currentType} → ${colType} (임베딩 데이터 NULL 초기화)`);
  await pool.query(
    `ALTER TABLE ${SCHEMA}.${table}
     ALTER COLUMN embedding TYPE ${colType} USING NULL`
  );

  /** 4. HNSW 인덱스 재생성 */
  console.log(`migration-007: ${table} — HNSW 인덱스 재생성 중...`);
  const whereExpr = whereClause ? `\n       ${whereClause}` : "";
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${indexName}
     ON ${SCHEMA}.${table}
     USING hnsw (embedding ${opsType})
     WITH (m = 16, ef_construction = 64)${whereExpr}`
  );

  console.log(`migration-007: ${table} → ${colType} 완료`);
}

async function main() {
  const dims       = EMBEDDING_DIMENSIONS;
  const useHalfvec = dims > 2000;
  const colType    = useHalfvec ? `halfvec(${dims})` : `vector(${dims})`;
  const opsType    = useHalfvec ? "halfvec_cosine_ops" : "vector_cosine_ops";
  const targetUdt  = useHalfvec ? "halfvec" : "vector";

  console.log(`EMBEDDING_DIMENSIONS = ${dims}`);
  console.log(`컬럼 타입 → ${colType} (${useHalfvec ? "halfvec — pgvector ≥0.7.0 필요" : "vector"})`);

  const pool = getPrimaryPool();

  try {
    for (const tableSpec of TABLES) {
      await migrateTable(pool, tableSpec, colType, opsType, targetUdt);
    }

    console.log("\n마이그레이션 완료 (fragments + morpheme_dict).");
    console.log("임베딩 데이터가 초기화되었습니다. backfill-embeddings.js를 실행하여 재임베딩하세요.");
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
