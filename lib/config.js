/**
 * 설정 상수
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 */

import "dotenv/config";

export const PORT               = Number(process.env.PORT || 57332);

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

/**
 * 빈 ACCESS_KEY의 fail-closed 동작을 우회하는 명시적 opt-in 플래그.
 * MEMENTO_AUTH_DISABLED=true 로만 활성화 가능.
 * 활성화 시 서버는 모든 요청을 master 권한으로 처리한다 (개발/테스트 전용).
 */
export const AUTH_DISABLED      = process.env.MEMENTO_AUTH_DISABLED === "true";
export const SESSION_TTL_MS            = Number(process.env.SESSION_TTL_MINUTES || 43200) * 60 * 1000;
export const OAUTH_TOKEN_TTL_SECONDS   = Number(process.env.SESSION_TTL_MINUTES || 43200) * 60;
export const OAUTH_REFRESH_TTL_SECONDS = OAUTH_TOKEN_TTL_SECONDS * 2;
export const LOG_DIR            = process.env.LOG_DIR || "./logs";

export const ALLOWED_ORIGINS    = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

export const ADMIN_ALLOWED_ORIGINS = new Set(
  String(process.env.ADMIN_ALLOWED_ORIGINS || "")
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
export const CACHE_DB_TTL       = Number(process.env.CACHE_DB_TTL || 300);        // 5분
export const CACHE_SESSION_TTL  = Number(process.env.CACHE_SESSION_TTL || SESSION_TTL_MS / 1000); // 세션과 동일

/** 임베딩 Provider 설정
 *
 * EMBEDDING_PROVIDER 지원값:
 *   openai      — OpenAI API (기본값). OPENAI_API_KEY 또는 EMBEDDING_API_KEY 필요.
 *   gemini      — Google Gemini. GEMINI_API_KEY 또는 EMBEDDING_API_KEY 필요.
 *                 OpenAI 호환 엔드포인트 사용 (별도 SDK 불필요).
 *   ollama      — 로컬 Ollama 서버. API 키 불필요.
 *   localai     — 로컬 LocalAI 서버. API 키 불필요.
 *   cloudflare  — Cloudflare Workers AI. CF_ACCOUNT_ID + CF_API_TOKEN 필요.
 *                 OpenAI 호환 엔드포인트 사용 (별도 SDK 불필요).
 *   custom      — EMBEDDING_BASE_URL, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS 직접 지정.
 */
export const EMBEDDING_PROVIDER   = (process.env.EMBEDDING_PROVIDER || "openai").toLowerCase();

/** Cloudflare Workers AI 계정 설정 (cloudflare provider 전용) */
const _CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";

/** Provider별 기본값 */
const _PROVIDER_DEFAULTS = {
  openai:     { model: "text-embedding-3-small",    dims: 1536, baseUrl: "",                                                        supportsDimensionsParam: true  },
  gemini:     { model: "gemini-embedding-001",       dims: 3072, baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", supportsDimensionsParam: false },
  ollama:     { model: "nomic-embed-text",            dims: 768,  baseUrl: "http://localhost:11434/v1",                               supportsDimensionsParam: false },
  localai:    { model: "text-embedding-ada-002",     dims: 1536, baseUrl: "http://localhost:8080/v1",                                supportsDimensionsParam: false },
  cloudflare: { model: "@cf/baai/bge-small-en-v1.5", dims: 384,  baseUrl: _CF_ACCOUNT_ID ? `https://api.cloudflare.com/client/v4/accounts/${_CF_ACCOUNT_ID}/ai/v1` : "", supportsDimensionsParam: false },
  custom:     { model: "",                            dims: 1536, baseUrl: "",                                                        supportsDimensionsParam: false },
};
const _defaults = _PROVIDER_DEFAULTS[EMBEDDING_PROVIDER] ?? _PROVIDER_DEFAULTS.custom;

/** 임베딩 API 키 (EMBEDDING_API_KEY 우선, GEMINI_API_KEY, CF_API_TOKEN, OPENAI_API_KEY 순 폴백) */
export const OPENAI_API_KEY              = process.env.OPENAI_API_KEY || "";
export const EMBEDDING_API_KEY           = process.env.EMBEDDING_API_KEY
                                        || process.env.GEMINI_API_KEY
                                        || process.env.CF_API_TOKEN
                                        || process.env.CLOUDFLARE_API_TOKEN
                                        || process.env.OPENAI_API_KEY
                                        || "";

/** Cloudflare Workers AI 계정 ID / API 토큰 */
export const CF_ACCOUNT_ID               = _CF_ACCOUNT_ID;
export const CF_API_TOKEN                = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";
/** OpenAI 호환 엔드포인트 URL (미설정 시 provider 기본값 사용) */
export const EMBEDDING_BASE_URL          = process.env.EMBEDDING_BASE_URL  || _defaults.baseUrl;
/** 임베딩 모델명 (미설정 시 provider 기본값 사용) */
export const EMBEDDING_MODEL             = process.env.EMBEDDING_MODEL     || _defaults.model;
/** 임베딩 벡터 차원 수 (미설정 시 provider 기본값 사용) */
export const EMBEDDING_DIMENSIONS        = Number(process.env.EMBEDDING_DIMENSIONS || _defaults.dims);
/** dimensions 파라미터 지원 여부 (provider 자동 결정, EMBEDDING_SUPPORTS_DIMS_PARAM=true/false로 override) */
export const EMBEDDING_SUPPORTS_DIMS_PARAM = process.env.EMBEDDING_SUPPORTS_DIMS_PARAM !== undefined
  ? process.env.EMBEDDING_SUPPORTS_DIMS_PARAM === "true"
  : _defaults.supportsDimensionsParam;
/** 임베딩 기능 활성화 여부 */
export const EMBEDDING_ENABLED           = !!(EMBEDDING_API_KEY || EMBEDDING_BASE_URL);

/** NLI 서비스 설정 (미설정 시 in-process ONNX 모델 로드) */
export const NLI_SERVICE_URL    = process.env.NLI_SERVICE_URL || "";
export const NLI_TIMEOUT_MS     = Number(process.env.NLI_TIMEOUT_MS || 5000);

/** Reranker 서비스 설정 (미설정 시 in-process ONNX cross-encoder 로드)
 *
 * RERANKER_MODEL 지원값:
 *   minilm  — Xenova/ms-marco-MiniLM-L-6-v2 (기본값, ~80MB, 영어 전용)
 *   bge-m3  — onnx-community/bge-reranker-v2-m3-ONNX (q4, ~280MB, 다국어)
 */
export const RERANKER_URL        = process.env.RERANKER_URL || "";
export const RERANKER_TIMEOUT_MS = Number(process.env.RERANKER_TIMEOUT_MS || 5000);
export const RERANKER_MODEL      = (process.env.RERANKER_MODEL || "minilm").toLowerCase();

/** Fragment 쿼터 기본값 */
export const FRAGMENT_DEFAULT_LIMIT = process.env.FRAGMENT_DEFAULT_LIMIT
  ? Number(process.env.FRAGMENT_DEFAULT_LIMIT)
  : 5000;

/** API 키 생성 기본값 */
export const DEFAULT_DAILY_LIMIT    = Number(process.env.DEFAULT_DAILY_LIMIT || 10000);
export const DEFAULT_FRAGMENT_LIMIT = process.env.DEFAULT_FRAGMENT_LIMIT
  ? Number(process.env.DEFAULT_FRAGMENT_LIMIT) : null;
export const DEFAULT_PERMISSIONS    = (process.env.DEFAULT_PERMISSIONS || "read,write")
  .split(",").map(s => s.trim()).filter(Boolean);

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

/** pgvector 익스텐션이 설치된 스키마 (public이 아닌 경우 지정, 미설정 시 서버 시작 시 자동 감지) */
export let PGVECTOR_SCHEMA      = process.env.PGVECTOR_SCHEMA || "";

/**
 * SET search_path 문자열 생성
 * @param {string} schema - 주 스키마 (예: "agent_memory")
 * @returns {string} "SET search_path TO agent_memory, <pgvector_schema>, public"
 */
export function buildSearchPath(schema) {
  const parts = [schema];
  if (PGVECTOR_SCHEMA) parts.push(PGVECTOR_SCHEMA);
  parts.push("public");
  return `SET search_path TO ${parts.join(", ")}`;
}

/**
 * pgvector 익스텐션 스키마 자동 감지
 *
 * PGVECTOR_SCHEMA 환경변수가 미설정이고 pgvector가 public이 아닌 스키마에 설치된 경우,
 * pg_extension 카탈로그에서 실제 스키마를 감지하여 PGVECTOR_SCHEMA를 갱신한다.
 * 서버 시작 시 1회 호출.
 *
 * @param {import("pg").Pool} pool - PostgreSQL 연결 풀
 */
export async function detectPgvectorSchema(pool) {
  if (PGVECTOR_SCHEMA) return;   // 명시 설정 있으면 스킵

  try {
    const result = await pool.query(
      `SELECT n.nspname
       FROM pg_extension e
       JOIN pg_namespace n ON e.extnamespace = n.oid
       WHERE e.extname = 'vector'`
    );
    if (result.rows.length > 0) {
      const detected = result.rows[0].nspname;
      if (detected && detected !== "public") {
        PGVECTOR_SCHEMA = detected;
      }
    }
  } catch {
    // pgvector 미설치 또는 쿼리 실패 시 무시 — 빈 문자열 유지
  }
}

/** Rate Limiting */
export const RATE_LIMIT_WINDOW_MS    = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120);
export const RATE_LIMIT_PER_IP       = Number(process.env.RATE_LIMIT_PER_IP  || 30);
export const RATE_LIMIT_PER_KEY      = Number(process.env.RATE_LIMIT_PER_KEY || 100);

const DEFAULT_TRUSTED_ORIGINS = [
  "https://claude.ai",
  "https://chatgpt.com",
  "https://platform.openai.com",
  "https://copilot.microsoft.com",
  "https://gemini.google.com",
];

export const OAUTH_TRUSTED_ORIGINS = [
  ...DEFAULT_TRUSTED_ORIGINS,
  ...String(process.env.OAUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean)
];

/** 하위 호환: 정확한 URI 허용 목록 (기존 환경변수 지원) */
export const OAUTH_ALLOWED_REDIRECT_URIS = String(process.env.OAUTH_ALLOWED_REDIRECT_URIS || "")
  .split(",")
  .map(v => v.trim())
  .filter(Boolean);

/** 업데이트 체크 설정 */
export const UPDATE_CHECK_DISABLED       = process.env.UPDATE_CHECK_DISABLED === "true";
export const UPDATE_CHECK_INTERVAL_HOURS = Number(process.env.UPDATE_CHECK_INTERVAL_HOURS || 24);

/** OpenAPI 스펙 엔드포인트 활성화 (GET /openapi.json) */
export const ENABLE_OPENAPI = process.env.ENABLE_OPENAPI === "true";


