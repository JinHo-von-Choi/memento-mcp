/**
 * 기존 임베딩 벡터 일괄 L2 정규화 마이그레이션
 * 일회성 실행 스크립트: node lib/memory/normalize-vectors.js
 *
 * 작성자: 최진호 / 2026-03-03
 */

import pg from "pg";
import { normalizeL2 } from "../tools/embedding.js";

const pool   = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const SCHEMA = "agent_memory";
const BATCH  = 100;

async function run() {
    let offset  = 0;
    let updated = 0;

    console.log("기존 임베딩 벡터 L2 정규화 시작...");

    /** pgvector 확장이 nerdvana 스키마에 설치되어 있으므로 search_path 설정 */
    await pool.query("SET search_path TO agent_memory, nerdvana, public");

    while (true) {
        const { rows } = await pool.query(
            `SELECT id, embedding FROM ${SCHEMA}.fragments
             WHERE  embedding IS NOT NULL
             ORDER  BY id
             LIMIT  $1 OFFSET $2`,
            [BATCH, offset]
        );

        if (rows.length === 0) break;

        for (const row of rows) {
            /** pg 드라이버는 vector 컬럼을 '[0.1,0.2,...]' 또는 '{0.1,0.2,...}' 문자열로 반환 */
            let vec;
            if (typeof row.embedding === "string") {
                const cleaned = row.embedding.startsWith("{")
                    ? `[${row.embedding.slice(1, -1)}]`
                    : row.embedding;
                vec = JSON.parse(cleaned);
            } else {
                vec = row.embedding;
            }
            const normalized = normalizeL2(vec);
            await pool.query(
                `UPDATE ${SCHEMA}.fragments SET embedding = $1::vector WHERE id = $2`,
                [`[${normalized.join(",")}]`, row.id]
            );
            updated++;
        }

        console.log(`  처리: ${updated}개`);
        offset += BATCH;
    }

    console.log(`완료: 총 ${updated}개 벡터 정규화됨`);
}

run()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => pool.end());
