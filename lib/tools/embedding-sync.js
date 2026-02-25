/**
 * MCP 서버 사이드 임베딩 동기화
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 설명: 문서 create/update/delete/move 시 임베딩을 실시간 갱신
 *       fire-and-forget 패턴으로 도구 응답을 블로킹하지 않음
 */

import {
  computeContentHash,
  prepareTextForEmbedding,
  generateEmbedding,
  extractDocumentMetadata,
  vectorToSql,
  OPENAI_API_KEY
} from "./embedding.js";

import {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_CONN_TIMEOUT_MS
} from "../config.js";

import pg from "pg";
const { Pool } = pg;

/**
 * MCP 서버 전용 임베딩 DB 풀 (최소 커넥션)
 * 메인 DB 풀과 분리하여 임베딩 작업이 일반 쿼리에 영향을 주지 않도록 함
 */
let embeddingPool = null;

function getEmbeddingPool() {
  if (!embeddingPool) {
    if (!DB_HOST || !DB_NAME || !DB_USER) return null;

    embeddingPool = new Pool({
      host                   : DB_HOST,
      port                   : DB_PORT,
      database               : DB_NAME,
      user                   : DB_USER,
      password               : DB_PASSWORD,
      max                    : 2,
      idleTimeoutMillis      : 30000,
      connectionTimeoutMillis: DB_CONN_TIMEOUT_MS
    });

    embeddingPool.on("error", (err) => {
      console.error(`[EmbeddingSync] Pool error: ${err.message}`);
    });

    embeddingPool.on("connect", (client) => {
      client.query("SET search_path TO doc_mgmt, nerdvana, public");
    });
  }
  return embeddingPool;
}

/**
 * 임베딩 동기화 가능 여부 확인
 */
function isEmbeddingEnabled() {
  return Boolean(OPENAI_API_KEY) && Boolean(DB_HOST);
}

/**
 * 문서 생성/수정 시 임베딩 갱신
 * fire-and-forget: 호출자를 블로킹하지 않음
 *
 * @param {string} docPath - 문서 상대 경로
 * @param {string} content - 문서 내용
 */
export function syncDocEmbedding(docPath, content) {
  if (!isEmbeddingEnabled()) return;

  syncDocEmbeddingAsync(docPath, content).catch(err => {
    console.error(`[EmbeddingSync] Failed for ${docPath}: ${err.message}`);
  });
}

/**
 * 문서 삭제 시 임베딩 제거
 * fire-and-forget
 *
 * @param {string} docPath - 문서 상대 경로
 */
export function removeDocEmbedding(docPath) {
  if (!isEmbeddingEnabled()) return;

  removeDocEmbeddingAsync(docPath).catch(err => {
    console.error(`[EmbeddingSync] Remove failed for ${docPath}: ${err.message}`);
  });
}

/**
 * 문서 이동 시 임베딩 경로 업데이트
 * fire-and-forget
 *
 * @param {string} fromPath - 이전 경로
 * @param {string} toPath   - 새 경로
 */
export function moveDocEmbedding(fromPath, toPath) {
  if (!isEmbeddingEnabled()) return;

  moveDocEmbeddingAsync(fromPath, toPath).catch(err => {
    console.error(`[EmbeddingSync] Move failed ${fromPath} -> ${toPath}: ${err.message}`);
  });
}

/**
 * 내부: 임베딩 갱신 (비동기)
 */
async function syncDocEmbeddingAsync(docPath, content) {
  const pool = getEmbeddingPool();
  if (!pool) return;

  const contentHash = computeContentHash(content);

  /** 해시가 동일하면 스킵 */
  const existing = await pool.query(
    "SELECT content_hash FROM doc_mgmt.doc_embeddings WHERE doc_path = $1",
    [docPath]
  );

  if (existing.rows.length > 0 && existing.rows[0].content_hash === contentHash) {
    return;
  }

  /** 임베딩 생성 */
  const text      = prepareTextForEmbedding(content);
  const embedding = await generateEmbedding(text);
  const vectorStr = vectorToSql(embedding);
  const metadata  = extractDocumentMetadata(content, docPath);

  await pool.query(
    `INSERT INTO doc_mgmt.doc_embeddings
           (doc_path, content_hash, embedding, title, category, word_count, file_size, h1_titles)
         VALUES ($1, $2, $3::vector, $4, $5, $6, $7, $8)
         ON CONFLICT (doc_path) DO UPDATE SET
           content_hash = EXCLUDED.content_hash,
           embedding    = EXCLUDED.embedding,
           title        = EXCLUDED.title,
           category     = EXCLUDED.category,
           word_count   = EXCLUDED.word_count,
           file_size    = EXCLUDED.file_size,
           h1_titles    = EXCLUDED.h1_titles,
           updated_at   = NOW()`,
    [
      docPath,
      contentHash,
      vectorStr,
      metadata.title || null,
      metadata.category || null,
      metadata.wordCount || 0,
      metadata.fileSize || 0,
      metadata.h1Titles || []
    ]
  );

  console.log(`[EmbeddingSync] ${existing.rows.length > 0 ? "Updated" : "Inserted"}: ${docPath}`);
}

/**
 * 내부: 임베딩 제거 (비동기)
 */
async function removeDocEmbeddingAsync(docPath) {
  const pool = getEmbeddingPool();
  if (!pool) return;

  const result = await pool.query(
    "DELETE FROM doc_mgmt.doc_embeddings WHERE doc_path = $1",
    [docPath]
  );

  if (result.rowCount > 0) {
    console.log(`[EmbeddingSync] Removed: ${docPath}`);
  }

  /** 관련 유사도 리포트도 정리 */
  await pool.query(
    `DELETE FROM doc_mgmt.similarity_reports
         WHERE doc_path_a = $1 OR doc_path_b = $1`,
    [docPath]
  );
}

/**
 * 내부: 임베딩 경로 이동 (비동기)
 */
async function moveDocEmbeddingAsync(fromPath, toPath) {
  const pool = getEmbeddingPool();
  if (!pool) return;

  /** 경로만 업데이트, 임베딩은 그대로 유지 (내용 안 변했으므로) */
  const result = await pool.query(
    `UPDATE doc_mgmt.doc_embeddings
         SET doc_path = $2, category = $3, updated_at = NOW()
         WHERE doc_path = $1`,
    [fromPath, toPath, toPath.split("/")[0] || "root"]
  );

  if (result.rowCount > 0) {
    console.log(`[EmbeddingSync] Moved: ${fromPath} -> ${toPath}`);
  }

  /** 유사도 리포트 경로도 업데이트 */
  await pool.query(
    "UPDATE doc_mgmt.similarity_reports SET doc_path_a = $2 WHERE doc_path_a = $1",
    [fromPath, toPath]
  );
  await pool.query(
    "UPDATE doc_mgmt.similarity_reports SET doc_path_b = $2 WHERE doc_path_b = $1",
    [fromPath, toPath]
  );
}

/**
 * Graceful shutdown
 */
export async function shutdownEmbeddingPool() {
  if (embeddingPool) {
    await embeddingPool.end();
    embeddingPool = null;
    console.log("[EmbeddingSync] Pool closed");
  }
}
