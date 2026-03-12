/**
 * 도구: 데이터베이스 조회
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 * 수정일: 2026-02-13 (Phase 2: 연결 풀 최적화, Redis 캐싱)
 * 수정일: 2026-03-09 (DB 도구 핸들러/정의를 db-tools.js로 분리)
 */

import pg from "pg";
const { Pool } = pg;

import {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_MAX_CONNECTIONS,
  DB_IDLE_TIMEOUT_MS,
  DB_CONN_TIMEOUT_MS,
  DB_QUERY_TIMEOUT
} from "../config.js";

import { logInfo, logError } from "../logger.js";

/** Primary DB 설정 */
const DB_CONFIG_PRIMARY = {
  host                   : DB_HOST,
  port                   : DB_PORT,
  database               : DB_NAME,
  user                   : DB_USER,
  password               : DB_PASSWORD,
  max                    : DB_MAX_CONNECTIONS,
  idleTimeoutMillis      : DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONN_TIMEOUT_MS
};

/** 연결 풀 - Primary */
let poolPrimary = null;

function getPoolPrimary() {
  if (!poolPrimary) {
    poolPrimary = new Pool(DB_CONFIG_PRIMARY);

    poolPrimary.on("error", (err) => {
      logError("[DB Pool Primary] Unexpected error: " + err.message, err);
    });

    poolPrimary.on("connect", (client) => {
      logInfo(`[DB Pool Primary] Client connected (total: ${poolPrimary.totalCount}, idle: ${poolPrimary.idleCount})`);
    });

    logInfo(`[DB Pool Primary] Initialized with max ${DB_MAX_CONNECTIONS} connections`);
  }
  return poolPrimary;
}

/**
 * 외부 모듈에서 Primary 풀에 접근할 수 있도록 export
 */
export function getPrimaryPool() {
  return getPoolPrimary();
}

function getPool() {
  return getPoolPrimary();
}

/**
 * Graceful shutdown - 모든 연결 종료
 */
export async function shutdownPool() {
  if (poolPrimary) {
    logInfo("[DB Pool Primary] Closing all connections...");
    await poolPrimary.end();
    poolPrimary = null;
    logInfo("[DB Pool Primary] All connections closed");
  }
}

/**
 * 연결 풀 상태 조회
 */
export function getPoolStats() {
  const stats = {
    primary   : { totalCount: 0, idleCount: 0, waitingCount: 0 },
    totalCount: 0
  };

  if (poolPrimary) {
    stats.primary = {
      totalCount  : poolPrimary.totalCount,
      idleCount   : poolPrimary.idleCount,
      waitingCount: poolPrimary.waitingCount
    };
    stats.totalCount = poolPrimary.totalCount;
  }

  return stats;
}

/** @deprecated queryWithAgentVector 사용 권장. 내부 호환용 alias. */
export async function queryWithAgent(agentId, sql, params = []) {
  return queryWithAgentVector(agentId, sql, params);
}

/**
 * 에이전트 컨텍스트 + 벡터 타입 지원 쿼리 (agent_memory 전용)
 *
 * NOTE: SET LOCAL은 PostgreSQL에서 파라미터 바인딩($1)을 지원하지 않는다.
 * SET 명령은 GUC(Grand Unified Configuration) 시스템의 일부로,
 * prepared statement의 파라미터 바인딩 프로토콜과 별개로 동작한다.
 * safeAgent는 [^a-zA-Z0-9_\-] 패턴으로 정제하여 injection을 방지한다.
 */
export async function queryWithAgentVector(agentId, sql, params = []) {
  const pool      = getPool();
  const client    = await pool.connect();
  const safeAgent = String(agentId || "default").replace(/[^a-zA-Z0-9_-]/g, "");
  try {
    const SCHEMA  = "agent_memory";
    await client.query(`SET search_path TO ${SCHEMA}, nerdvana, public`);
    await client.query(`SET LOCAL app.current_agent_id = '${safeAgent}'`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/** 하위 호환 re-export — 신규 코드는 lib/tools/db-tools.js 직접 import 권장 */
export {
  tool_dbQuery, tool_dbTables, tool_dbSchema, tool_dbCount, tool_dbQueryByDate,
  dbQueryDefinition, dbTablesDefinition, dbSchemaDefinition,
  dbCountDefinition, dbQueryByDateDefinition
} from "./db-tools.js";
