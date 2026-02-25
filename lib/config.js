/**
 * 설정 상수
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 */

export const DOCS_ROOT          = process.env.DOCS_ROOT || "/home/nirna/job/mcp/docs";
export const PORT               = Number(process.env.PORT || 56332);

/**
 * 지원하는 MCP 프로토콜 버전 목록 (최신순)
 * - 2024-11-05: 초기 릴리스 (인증 모델 미포함)
 * - 2025-03-26: OAuth 2.1 인증, Streamable HTTP 도입
 * - 2025-06-18: 구조화된 도구 출력, 서버 주도 상호작용
 * - 2025-11-25: Tasks 추상화, 장기 실행 작업 지원
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05"
];

export const DEFAULT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const ACCESS_KEY         = process.env.MEMENTO_ACCESS_KEY || "";
export const SESSION_TTL_MS     = Number(process.env.SESSION_TTL_MINUTES || 60) * 60 * 1000;
export const LOG_DIR            = process.env.LOG_DIR || "/var/log/mcp";

export const ALLOWED_ORIGINS    = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

/** Redis 설정 */
export const REDIS_ENABLED      = process.env.REDIS_ENABLED === "true" || false;
export const REDIS_SENTINEL_ENABLED = process.env.REDIS_SENTINEL_ENABLED === "true" || false;
export const REDIS_HOST         = process.env.REDIS_HOST || "localhost";
export const REDIS_PORT         = Number(process.env.REDIS_PORT || 6379);
export const REDIS_PASSWORD     = process.env.REDIS_PASSWORD || undefined;
export const REDIS_DB           = Number(process.env.REDIS_DB || 0);

/** Redis Sentinel 설정 */
export const REDIS_MASTER_NAME  = process.env.REDIS_MASTER_NAME || "mymaster";
export const REDIS_SENTINELS    = process.env.REDIS_SENTINELS
  ? process.env.REDIS_SENTINELS.split(",").map(s => {
    const [host, port] = s.trim().split(":");
    return { host, port: Number(port || 26379) };
  })
  : [
    { host: "localhost", port: 26379 },
    { host: "localhost", port: 26380 },
    { host: "localhost", port: 26381 }
  ];

/** 캐싱 설정 */
export const CACHE_ENABLED      = process.env.CACHE_ENABLED === "true" || REDIS_ENABLED;
export const CACHE_DOC_TTL      = Number(process.env.CACHE_DOC_TTL || 3600);      // 1시간
export const CACHE_DB_TTL       = Number(process.env.CACHE_DB_TTL || 300);        // 5분
export const CACHE_SESSION_TTL  = Number(process.env.CACHE_SESSION_TTL || SESSION_TTL_MS / 1000); // 세션과 동일

/** OpenAI API 설정 */
export const OPENAI_API_KEY     = process.env.OPENAI_API_KEY || "";
export const EMBEDDING_MODEL    = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = Number(process.env.EMBEDDING_DIMENSIONS || 1536);

/** 데이터베이스 설정 (PostgreSQL) - POSTGRES_* 우선, DB_* 호환 */
export const DB_HOST            = process.env.POSTGRES_HOST || process.env.DB_HOST || "";
export const DB_PORT            = Number(process.env.POSTGRES_PORT || process.env.DB_PORT || 5432);
export const DB_NAME            = process.env.POSTGRES_DB || process.env.DB_NAME || "";
export const DB_USER            = process.env.POSTGRES_USER || process.env.DB_USER || "";
export const DB_PASSWORD        = process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || "";
export const DB_MAX_CONNECTIONS = Number(process.env.DB_MAX_CONNECTIONS || 20);
export const DB_IDLE_TIMEOUT_MS = Number(process.env.DB_IDLE_TIMEOUT_MS || 30000);
export const DB_CONN_TIMEOUT_MS = Number(process.env.DB_CONN_TIMEOUT_MS || 10000);
export const DB_QUERY_TIMEOUT   = Number(process.env.DB_QUERY_TIMEOUT || 30000);

/** PostgreSQL Read Replica 설정 */
export const DB_REPLICA_ENABLED = process.env.DB_REPLICA_ENABLED === "true" || false;
export const DB_REPLICA_HOST    = process.env.DB_REPLICA_HOST || "";
export const DB_REPLICA_PORT    = Number(process.env.DB_REPLICA_PORT || 5433);

/** DB Read-Only 사용자 설정 (미설정 시 Primary로 fallback) */
export const DB_READONLY_USER     = process.env.DB_READONLY_USER || "";
export const DB_READONLY_PASSWORD = process.env.DB_READONLY_PASSWORD || "";
