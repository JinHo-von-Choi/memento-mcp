/**
 * 도구: 데이터베이스 조회
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 * 수정일: 2026-02-13 (Phase 2: 연결 풀 최적화, Redis 캐싱)
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
  DB_QUERY_TIMEOUT,
  CACHE_ENABLED,
  CACHE_DB_TTL,
  DB_REPLICA_ENABLED,
  DB_REPLICA_HOST,
  DB_REPLICA_PORT,
  DB_READONLY_USER,
  DB_READONLY_PASSWORD
} from "../config.js";

import { getCachedDocument, cacheDocument } from "../redis.js";

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

/** Replica DB 설정 (Phase 3) */
const DB_CONFIG_REPLICA = {
  host                   : DB_REPLICA_HOST,
  port                   : DB_REPLICA_PORT,
  database               : DB_NAME,
  user                   : DB_USER,
  password               : DB_PASSWORD,
  max                    : DB_MAX_CONNECTIONS,
  idleTimeoutMillis      : DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONN_TIMEOUT_MS
};

/** Read-Only DB 설정 (별도 자격증명, 미설정 시 Primary로 fallback) */
const DB_CONFIG_READONLY = {
  host                   : DB_HOST,
  port                   : DB_PORT,
  database               : DB_NAME,
  user                   : DB_READONLY_USER,
  password               : DB_READONLY_PASSWORD,
  max                    : DB_MAX_CONNECTIONS,
  idleTimeoutMillis      : DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: DB_CONN_TIMEOUT_MS
};

const DEFAULT_LIMIT = 100;
const MAX_LIMIT     = 1000;

/** 연결 풀 - Primary */
let poolPrimary  = null;

/** 연결 풀 - Replica */
let poolReplica  = null;

/** 연결 풀 - Read-Only */
let poolReadonly = null;

function getPoolPrimary() {
  if (!poolPrimary) {
    poolPrimary = new Pool(DB_CONFIG_PRIMARY);

    poolPrimary.on("error", (err) => {
      console.error("[DB Pool Primary] Unexpected error:", err.message);
    });

    poolPrimary.on("connect", (client) => {
      console.log(`[DB Pool Primary] Client connected (total: ${poolPrimary.totalCount}, idle: ${poolPrimary.idleCount})`);
    });

    console.log(`[DB Pool Primary] Initialized with max ${DB_MAX_CONNECTIONS} connections`);
  }
  return poolPrimary;
}

/**
 * 외부 모듈에서 Primary 풀에 접근할 수 있도록 export
 */
export function getPrimaryPool() {
  return getPoolPrimary();
}

function getPoolReplica() {
  if (!poolReplica && DB_REPLICA_ENABLED) {
    poolReplica = new Pool(DB_CONFIG_REPLICA);

    poolReplica.on("error", (err) => {
      console.error("[DB Pool Replica] Unexpected error:", err.message);
      console.log("[DB Pool Replica] Falling back to Primary");
    });

    poolReplica.on("connect", (client) => {
      console.log(`[DB Pool Replica] Client connected (total: ${poolReplica.totalCount}, idle: ${poolReplica.idleCount})`);
    });

    console.log(`[DB Pool Replica] Initialized with max ${DB_MAX_CONNECTIONS} connections`);
  }
  return poolReplica;
}

function getPoolReadonly() {
  if (!poolReadonly) {
    poolReadonly = new Pool(DB_CONFIG_READONLY);

    poolReadonly.on("error", (err) => {
      console.error("[DB Pool Readonly] Unexpected error:", err.message);
    });

    poolReadonly.on("connect", (client) => {
      console.log(`[DB Pool Readonly] Client connected (total: ${poolReadonly.totalCount}, idle: ${poolReadonly.idleCount})`);
    });

    console.log(`[DB Pool Readonly] Initialized with max ${DB_MAX_CONNECTIONS} connections`);
  }
  return poolReadonly;
}

/**
 * 쿼리 타입에 따라 적절한 풀 선택
 * - read + DB_READONLY_USER 설정: Read-Only 풀 사용
 * - read + DB_REPLICA_ENABLED: Replica 풀 사용
 * - 기타 또는 fallback: Primary 풀 사용
 */
function getPool(queryType = "read") {
  if (queryType === "read") {
    if (DB_READONLY_USER) {
      return getPoolReadonly();
    }
    if (DB_REPLICA_ENABLED) {
      const replica = getPoolReplica();
      if (replica) {
        return replica;
      }
    }
  }
  return getPoolPrimary();
}

/**
 * Graceful shutdown - 모든 연결 종료
 */
export async function shutdownPool() {
  if (poolPrimary) {
    console.log("[DB Pool Primary] Closing all connections...");
    await poolPrimary.end();
    poolPrimary = null;
    console.log("[DB Pool Primary] All connections closed");
  }

  if (poolReplica) {
    console.log("[DB Pool Replica] Closing all connections...");
    await poolReplica.end();
    poolReplica = null;
    console.log("[DB Pool Replica] All connections closed");
  }

  if (poolReadonly) {
    console.log("[DB Pool Readonly] Closing all connections...");
    await poolReadonly.end();
    poolReadonly = null;
    console.log("[DB Pool Readonly] All connections closed");
  }
}

/**
 * 연결 풀 상태 조회
 */
export function getPoolStats() {
  const stats = {
    primary : { totalCount: 0, idleCount: 0, waitingCount: 0 },
    replica : { totalCount: 0, idleCount: 0, waitingCount: 0 },
    readonly: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    totalCount: 0
  };

  if (poolPrimary) {
    stats.primary = {
      totalCount  : poolPrimary.totalCount,
      idleCount   : poolPrimary.idleCount,
      waitingCount: poolPrimary.waitingCount
    };
    stats.totalCount += poolPrimary.totalCount;
  }

  if (poolReplica) {
    stats.replica = {
      totalCount  : poolReplica.totalCount,
      idleCount   : poolReplica.idleCount,
      waitingCount: poolReplica.waitingCount
    };
    stats.totalCount += poolReplica.totalCount;
  }

  if (poolReadonly) {
    stats.readonly = {
      totalCount  : poolReadonly.totalCount,
      idleCount   : poolReadonly.idleCount,
      waitingCount: poolReadonly.waitingCount
    };
    stats.totalCount += poolReadonly.totalCount;
  }

  return stats;
}

/**
 * 테이블명 검증 (SQL Injection 방지)
 */
function validateTableName(name) {
  if (!name || typeof name !== "string") {
    return { isValid: false, error: "테이블명이 필요합니다" };
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return { isValid: false, error: "유효하지 않은 테이블명입니다" };
  }
  return { isValid: true };
}

/**
 * SELECT 쿼리 검증
 */
function validateQuery(sql) {
  if (!sql || typeof sql !== "string") {
    return { isValid: false, error: "SQL 쿼리가 필요합니다" };
  }

  const normalized = sql.trim().toLowerCase();

  if (!normalized.startsWith("select")) {
    return { isValid: false, error: "SELECT 쿼리만 허용됩니다" };
  }

  const forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate", "grant", "revoke"];
  for (const keyword of forbidden) {
    if (normalized.includes(keyword)) {
      return { isValid: false, error: `'${keyword}' 키워드는 허용되지 않습니다` };
    }
  }

  return { isValid: true };
}

/**
 * PostgreSQL OID를 타입명으로 변환
 */
function getDataTypeName(oid) {
  const typeMap = {
    16  : "boolean",
    20  : "bigint",
    21  : "smallint",
    23  : "integer",
    25  : "text",
    700 : "real",
    701 : "double precision",
    1043: "varchar",
    1082: "date",
    1114: "timestamp",
    1184: "timestamptz",
    2950: "uuid",
    3802: "jsonb",
    114 : "json"
  };
  return typeMap[oid] || `unknown(${oid})`;
}

/**
 * 도구: SELECT 쿼리 실행 (Redis 캐싱 지원, Replica 분산)
 */
export async function tool_dbQuery(args) {
  if (!args || typeof args.sql !== "string") {
    throw new Error("sql is required");
  }

  const validation = validateQuery(args.sql);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const limit         = Math.min(Math.max(1, args.limit || DEFAULT_LIMIT), MAX_LIMIT);
  let sql           = args.sql.trim();

  if (!sql.toLowerCase().includes("limit")) {
    sql             = `${sql} LIMIT ${limit}`;
  }

  // 캐시 키 생성 (SQL 쿼리 기반)
  const cacheKey    = `db:query:${Buffer.from(sql).toString("base64")}`;

  // 캐시 조회
  if (CACHE_ENABLED) {
    const cached    = await getCachedDocument(cacheKey);
    if (cached) {
      console.log(`[DB Cache] Hit: ${sql.substring(0, 50)}...`);
      return JSON.parse(cached);
    }
    console.log(`[DB Cache] Miss: ${sql.substring(0, 50)}...`);
  }

  // Phase 3: READ 쿼리는 Replica로 분산
  const client        = await getPool("read").connect();
  try {
    await client.query(`SET statement_timeout = ${DB_QUERY_TIMEOUT}`);
    const result      = await client.query(sql);

    const fields      = result.fields.map(f => ({
      name    : f.name,
      dataType: getDataTypeName(f.dataTypeID)
    }));

    const response  = {
      rows    : result.rows,
      rowCount: result.rowCount || 0,
      fields
    };

    // 캐시 저장
    if (CACHE_ENABLED) {
      await cacheDocument(cacheKey, JSON.stringify(response), CACHE_DB_TTL);
      console.log(`[DB Cache] Stored: ${sql.substring(0, 50)}...`);
    }

    return response;
  } finally {
    client.release();
  }
}

/**
 * 도구: 테이블 목록 조회
 */
export async function tool_dbTables(_args) {
  const sql = `
    SELECT
      table_name as "tableName",
      table_type as "tableType"
    FROM information_schema.tables
    WHERE table_schema = current_schema()
    ORDER BY table_name
  `;

  const client        = await getPool().connect();
  try {
    const result      = await client.query(sql);
    return {
      tables: result.rows.map(row => ({
        tableName: row.tableName,
        tableType: row.tableType
      })),
      count: result.rowCount
    };
  } finally {
    client.release();
  }
}

/**
 * 도구: 테이블 스키마 조회
 */
export async function tool_dbSchema(args) {
  if (!args || typeof args.tableName !== "string") {
    throw new Error("tableName is required");
  }

  const validation = validateTableName(args.tableName);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const sql = `
    SELECT
      column_name as "columnName",
      data_type as "dataType",
      is_nullable = 'YES' as "isNullable",
      column_default as "columnDefault",
      character_maximum_length as "maxLength"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    ORDER BY ordinal_position
  `;

  const client        = await getPool().connect();
  try {
    const result      = await client.query(sql, [args.tableName]);

    if (result.rows.length === 0) {
      throw new Error(`테이블 '${args.tableName}'을 찾을 수 없습니다`);
    }

    return {
      tableName: args.tableName,
      columns  : result.rows,
      count    : result.rowCount
    };
  } finally {
    client.release();
  }
}

/**
 * 도구 정의: db_query
 */
export const dbQueryDefinition = {
  name       : "db_query",
  title      : "DB Query",
  description: "PostgreSQL SELECT 쿼리 실행 (bee_db). INSERT/UPDATE/DELETE 불가. 최대 1000행.",
  inputSchema: {
    type                : "object",
    properties          : {
      sql: {
        type       : "string",
        description: "SELECT SQL query (e.g. 'SELECT * FROM users')"
      },
      limit: {
        type       : "number",
        description: "Maximum rows to return (default: 100, max: 1000)"
      }
    },
    required            : ["sql"],
    additionalProperties: false
  }
};

/**
 * 도구 정의: db_tables
 */
export const dbTablesDefinition = {
  name       : "db_tables",
  title      : "DB Tables",
  description: "데이터베이스의 모든 테이블 목록 조회 (public 스키마)",
  inputSchema: {
    type                : "object",
    properties          : {},
    required            : [],
    additionalProperties: false
  }
};

/**
 * 도구 정의: db_schema
 */
export const dbSchemaDefinition = {
  name       : "db_schema",
  title      : "DB Schema",
  description: "특정 테이블의 스키마(컬럼 정보) 조회",
  inputSchema: {
    type                : "object",
    properties          : {
      tableName: {
        type       : "string",
        description: "Table name (e.g. 'users', 'orders')"
      }
    },
    required            : ["tableName"],
    additionalProperties: false
  }
};

/**
 * 도구: 테이블 행 개수 조회
 */
export async function tool_dbCount(args) {
  if (!args || typeof args.tableName !== "string") {
    throw new Error("tableName is required");
  }

  const validation = validateTableName(args.tableName);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const sql = `SELECT COUNT(*) as count FROM "${args.tableName}"`;

  const client        = await getPool().connect();
  try {
    const result      = await client.query(sql);
    return {
      tableName: args.tableName,
      count    : parseInt(result.rows[0].count, 10)
    };
  } finally {
    client.release();
  }
}

/**
 * 도구: 날짜 기반 쿼리
 */
export async function tool_dbQueryByDate(args) {
  if (!args || typeof args.tableName !== "string") {
    throw new Error("tableName is required");
  }
  if (typeof args.dateColumn !== "string") {
    throw new Error("dateColumn is required");
  }

  const validation = validateTableName(args.tableName);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  /** 컬럼명 검증 */
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(args.dateColumn)) {
    throw new Error("유효하지 않은 컬럼명입니다");
  }

  const conditions = [];
  const params     = [];
  let paramIndex = 1;

  if (args.startDate) {
    conditions.push(`"${args.dateColumn}" >= $${paramIndex}`);
    params.push(args.startDate);
    paramIndex++;
  }

  if (args.endDate) {
    conditions.push(`"${args.dateColumn}" <= $${paramIndex}`);
    params.push(args.endDate);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit       = Math.min(Math.max(1, args.limit || DEFAULT_LIMIT), MAX_LIMIT);

  const sql = `SELECT * FROM "${args.tableName}" ${whereClause} ORDER BY "${args.dateColumn}" DESC LIMIT ${limit}`;

  const client        = await getPool().connect();
  try {
    await client.query(`SET statement_timeout = ${DB_QUERY_TIMEOUT}`);
    const result      = await client.query(sql, params);

    const fields      = result.fields.map(f => ({
      name    : f.name,
      dataType: getDataTypeName(f.dataTypeID)
    }));

    return {
      rows    : result.rows,
      rowCount: result.rowCount || 0,
      fields,
      query   : { tableName: args.tableName, dateColumn: args.dateColumn, startDate: args.startDate, endDate: args.endDate }
    };
  } finally {
    client.release();
  }
}

/**
 * 도구 정의: db_count
 */
export const dbCountDefinition = {
  name       : "db_count",
  title      : "DB Count",
  description: "테이블의 전체 행 개수 조회",
  inputSchema: {
    type                : "object",
    properties          : {
      tableName: {
        type       : "string",
        description: "Table name (e.g. 'users', 'orders')"
      }
    },
    required            : ["tableName"],
    additionalProperties: false
  }
};

/**
 * 도구 정의: db_query_by_date
 */
export const dbQueryByDateDefinition = {
  name       : "db_query_by_date",
  title      : "DB Query By Date",
  description: "날짜 컬럼 기준으로 데이터 조회. 시작일/종료일 범위 지정 가능. 최신순 정렬.",
  inputSchema: {
    type                : "object",
    properties          : {
      tableName: {
        type       : "string",
        description: "Table name (e.g. 'logs', 'events')"
      },
      dateColumn: {
        type       : "string",
        description: "Date/timestamp column name (e.g. 'created_at', 'updated_at')"
      },
      startDate: {
        type       : "string",
        description: "Start date (ISO 8601 format, e.g. '2026-01-01')"
      },
      endDate: {
        type       : "string",
        description: "End date (ISO 8601 format, e.g. '2026-01-31')"
      },
      limit: {
        type       : "number",
        description: "Maximum rows to return (default: 100, max: 1000)"
      }
    },
    required            : ["tableName", "dateColumn"],
    additionalProperties: false
  }
};
