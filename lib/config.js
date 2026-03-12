/**
 * 설정 상수
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 */

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
export const SESSION_TTL_MS     = Number(process.env.SESSION_TTL_MINUTES || 60) * 60 * 1000;
export const LOG_DIR            = process.env.LOG_DIR || "./logs";

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
export const CACHE_DB_TTL       = Number(process.env.CACHE_DB_TTL || 300);        // 5분
export const CACHE_SESSION_TTL  = Number(process.env.CACHE_SESSION_TTL || SESSION_TTL_MS / 1000); // 세션과 동일

/** 임베딩 Provider 설정
 *
 * EMBEDDING_PROVIDER 지원값:
 *   openai   — OpenAI API (기본값). OPENAI_API_KEY 또는 EMBEDDING_API_KEY 필요.
 *   gemini   — Google Gemini. GEMINI_API_KEY 또는 EMBEDDING_API_KEY 필요.
 *              OpenAI 호환 엔드포인트 사용 (별도 SDK 불필요).
 *   ollama   — 로컬 Ollama 서버. API 키 불필요.
 *   localai  — 로컬 LocalAI 서버. API 키 불필요.
 *   custom   — EMBEDDING_BASE_URL, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS 직접 지정.
 */
export const EMBEDDING_PROVIDER   = (process.env.EMBEDDING_PROVIDER || "openai").toLowerCase();

/** Provider별 기본값 */
const _PROVIDER_DEFAULTS = {
  openai:  { model: "text-embedding-3-small", dims: 1536,  baseUrl: "",                                                        supportsDimensionsParam: true  },
  gemini:  { model: "gemini-embedding-001",   dims: 3072,  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", supportsDimensionsParam: false },
  ollama:  { model: "nomic-embed-text",        dims: 768,   baseUrl: "http://localhost:11434/v1",                               supportsDimensionsParam: false },
  localai: { model: "text-embedding-ada-002", dims: 1536,  baseUrl: "http://localhost:8080/v1",                                supportsDimensionsParam: false },
  custom:  { model: "",                        dims: 1536,  baseUrl: "",                                                        supportsDimensionsParam: false },
};
const _defaults = _PROVIDER_DEFAULTS[EMBEDDING_PROVIDER] ?? _PROVIDER_DEFAULTS.custom;

/** 임베딩 API 키 (EMBEDDING_API_KEY 우선, GEMINI_API_KEY, OPENAI_API_KEY 순 폴백) */
export const OPENAI_API_KEY              = process.env.OPENAI_API_KEY || "";
export const EMBEDDING_API_KEY           = process.env.EMBEDDING_API_KEY
                                        || process.env.GEMINI_API_KEY
                                        || process.env.OPENAI_API_KEY
                                        || "";
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

/** Rate Limiting */
export const RATE_LIMIT_WINDOW_MS    = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120);

