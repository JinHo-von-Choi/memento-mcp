/**
 * Redis 클라이언트 설정
 *
 * 작성자: 최진호
 * 작성일: 2026-02-13
 * 수정일: 2026-02-13 (Phase 3: Redis Sentinel 지원 추가)
 *
 * 기능:
 * - 세션 저장소
 * - OAuth 토큰 저장소
 * - 캐싱 레이어
 * - TTL 관리
 * - Redis Sentinel 고가용성 (Phase 3)
 */

import Redis from "ioredis";
import { logInfo, logWarn, logError } from "./logger.js";
import {
  REDIS_SENTINEL_ENABLED,
  REDIS_HOST,
  REDIS_PORT,
  REDIS_PASSWORD,
  REDIS_DB,
  REDIS_MASTER_NAME,
  REDIS_SENTINELS
} from "./config.js";

/**
 * Redis 클라이언트 생성
 * - Sentinel 활성화 시: Sentinel 연결
 * - 단일 모드: 직접 연결
 */
function createRedisClient() {
  const commonOptions = {
    password       : REDIS_PASSWORD,
    db             : REDIS_DB,
    retryStrategy  : (times) => {
      const delay    = Math.min(times * 50, 2000);
      logWarn(`Redis reconnecting (attempt ${times}), delay ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck    : true,
    lazyConnect         : false
  };

  if (REDIS_SENTINEL_ENABLED) {
    // Redis Sentinel 모드
    logInfo("Initializing Redis with Sentinel", {
      masterName: REDIS_MASTER_NAME,
      sentinels : REDIS_SENTINELS
    });

    return new Redis({
      sentinels: REDIS_SENTINELS,
      name     : REDIS_MASTER_NAME,
      ...commonOptions
    });
  } else {
    // 단일 Redis 모드
    logInfo("Initializing Redis in standalone mode", {
      host: REDIS_HOST,
      port: REDIS_PORT
    });

    return new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      ...commonOptions
    });
  }
}

/** Redis 클라이언트 */
export const redisClient = createRedisClient();

/** 이벤트 핸들러 */
redisClient.on("connect", () => {
  logInfo("Redis client connected", {
    host: REDIS_HOST,
    port: REDIS_PORT,
    db  : REDIS_DB
  });
});

redisClient.on("ready", () => {
  logInfo("Redis client ready");
});

redisClient.on("error", (err) => {
  logError("Redis client error", err, {
    host: REDIS_HOST,
    port: REDIS_PORT
  });
});

redisClient.on("close", () => {
  logWarn("Redis client connection closed");
});

redisClient.on("reconnecting", () => {
  logInfo("Redis client reconnecting...");
});

/**
 * Redis 헬스 체크
 */
export async function checkRedisHealth() {
  try {
    await redisClient.ping();
    return { healthy: true, message: "Redis is healthy" };
  } catch (err) {
    logError("Redis health check failed", err);
    return { healthy: false, message: err.message };
  }
}

/**
 * 세션 키 생성
 */
export function getSessionKey(sessionId) {
  return `session:${sessionId}`;
}

/**
 * OAuth 코드 키 생성
 */
export function getOAuthCodeKey(code) {
  return `oauth:code:${code}`;
}

/**
 * OAuth 토큰 키 생성
 */
export function getOAuthTokenKey(token) {
  return `oauth:token:${token}`;
}

/**
 * 문서 캐시 키 생성
 */
export function getDocCacheKey(path) {
  return `cache:doc:${path}`;
}

/**
 * DB 쿼리 캐시 키 생성
 */
export function getDbCacheKey(sql, params = []) {
  const hash = Buffer.from(`${sql}:${JSON.stringify(params)}`).toString("base64");
  return `cache:db:${hash}`;
}

/**
 * 세션 저장 (TTL 포함)
 */
export async function saveSession(sessionId, sessionData, ttlSeconds) {
  try {
    const key      = getSessionKey(sessionId);
    const value    = JSON.stringify(sessionData);

    await redisClient.setex(key, ttlSeconds, value);

    logInfo("Session saved to Redis", {
      sessionId: sessionId.substring(0, 8),
      ttl      : ttlSeconds
    });

    return true;
  } catch (err) {
    logError("Failed to save session to Redis", err, { sessionId });
    return false;
  }
}

/**
 * 세션 조회
 */
export async function getSession(sessionId) {
  try {
    const key      = getSessionKey(sessionId);
    const value    = await redisClient.get(key);

    if (!value) {
      return null;
    }

    return JSON.parse(value);
  } catch (err) {
    logError("Failed to get session from Redis", err, { sessionId });
    return null;
  }
}

/**
 * 세션 삭제
 */
export async function deleteSession(sessionId) {
  try {
    const key      = getSessionKey(sessionId);
    await redisClient.del(key);

    logInfo("Session deleted from Redis", {
      sessionId: sessionId.substring(0, 8)
    });

    return true;
  } catch (err) {
    logError("Failed to delete session from Redis", err, { sessionId });
    return false;
  }
}

/**
 * 세션 TTL 연장
 */
export async function extendSessionTTL(sessionId, ttlSeconds) {
  try {
    const key      = getSessionKey(sessionId);
    await redisClient.expire(key, ttlSeconds);

    return true;
  } catch (err) {
    logError("Failed to extend session TTL", err, { sessionId });
    return false;
  }
}

/**
 * OAuth 코드 저장
 */
export async function saveOAuthCode(code, codeData, ttlSeconds = 600) {
  try {
    const key      = getOAuthCodeKey(code);
    const value    = JSON.stringify(codeData);

    await redisClient.setex(key, ttlSeconds, value);

    return true;
  } catch (err) {
    logError("Failed to save OAuth code to Redis", err);
    return false;
  }
}

/**
 * OAuth 코드 조회 및 삭제 (일회성)
 */
export async function consumeOAuthCode(code) {
  try {
    const key      = getOAuthCodeKey(code);
    const value    = await redisClient.get(key);

    if (!value) {
      return null;
    }

    // 사용 즉시 삭제 (일회성)
    await redisClient.del(key);

    return JSON.parse(value);
  } catch (err) {
    logError("Failed to consume OAuth code from Redis", err);
    return null;
  }
}

/**
 * OAuth 액세스 토큰 저장
 */
export async function saveOAuthToken(token, tokenData, ttlSeconds = 3600) {
  try {
    const key      = getOAuthTokenKey(token);
    const value    = JSON.stringify(tokenData);

    await redisClient.setex(key, ttlSeconds, value);

    return true;
  } catch (err) {
    logError("Failed to save OAuth token to Redis", err);
    return false;
  }
}

/**
 * OAuth 액세스 토큰 조회
 */
export async function getOAuthToken(token) {
  try {
    const key      = getOAuthTokenKey(token);
    const value    = await redisClient.get(key);

    if (!value) {
      return null;
    }

    return JSON.parse(value);
  } catch (err) {
    logError("Failed to get OAuth token from Redis", err);
    return null;
  }
}

/**
 * OAuth 액세스 토큰 삭제
 */
export async function deleteOAuthToken(token) {
  try {
    const key      = getOAuthTokenKey(token);
    await redisClient.del(key);

    return true;
  } catch (err) {
    logError("Failed to delete OAuth token from Redis", err);
    return false;
  }
}

/**
 * 문서 캐시 저장
 */
export async function cacheDocument(path, content, ttlSeconds = 3600) {
  try {
    const key      = getDocCacheKey(path);
    const value    = JSON.stringify({ content, cachedAt: Date.now() });

    await redisClient.setex(key, ttlSeconds, value);

    return true;
  } catch (err) {
    logError("Failed to cache document", err, { path });
    return false;
  }
}

/**
 * 문서 캐시 조회
 */
export async function getCachedDocument(path) {
  try {
    const key      = getDocCacheKey(path);
    const value    = await redisClient.get(key);

    if (!value) {
      return null;
    }

    const data     = JSON.parse(value);

    return data.content;
  } catch (err) {
    logError("Failed to get cached document", err, { path });
    return null;
  }
}

/**
 * 문서 캐시 무효화
 */
export async function invalidateDocumentCache(path) {
  try {
    const key      = getDocCacheKey(path);
    await redisClient.del(key);

    logInfo("Document cache invalidated", { path });

    return true;
  } catch (err) {
    logError("Failed to invalidate document cache", err, { path });
    return false;
  }
}

/**
 * DB 쿼리 결과 캐시
 */
export async function cacheDbQuery(sql, params, result, ttlSeconds = 300) {
  try {
    const key      = getDbCacheKey(sql, params);
    const value    = JSON.stringify({ result, cachedAt: Date.now() });

    await redisClient.setex(key, ttlSeconds, value);

    return true;
  } catch (err) {
    logError("Failed to cache DB query", err);
    return false;
  }
}

/**
 * DB 쿼리 캐시 조회
 */
export async function getCachedDbQuery(sql, params) {
  try {
    const key      = getDbCacheKey(sql, params);
    const value    = await redisClient.get(key);

    if (!value) {
      return null;
    }

    const data     = JSON.parse(value);

    return data.result;
  } catch (err) {
    logError("Failed to get cached DB query", err);
    return null;
  }
}

/**
 * 전체 캐시 무효화 (패턴 기반)
 */
export async function invalidateCacheByPattern(pattern) {
  try {
    const keys     = await redisClient.keys(pattern);

    if (keys.length > 0) {
      await redisClient.del(...keys);
      logInfo(`Cache invalidated: ${keys.length} keys deleted`, { pattern });
    }

    return keys.length;
  } catch (err) {
    logError("Failed to invalidate cache by pattern", err, { pattern });
    return 0;
  }
}

/**
 * Redis 연결 종료
 */
export async function closeRedis() {
  try {
    await redisClient.quit();
    logInfo("Redis connection closed");
  } catch (err) {
    logError("Failed to close Redis connection", err);
  }
}

/**
 * Redis 연결 초기화 (모듈 로드 시 자동 연결되므로 ready 상태 확인만 수행)
 */
export async function connectRedis() {
  /** ioredis는 생성 즉시 연결을 시도하므로 별도 connect() 호출 불필요 */
}

/**
 * Redis 연결 종료 (closeRedis 별칭)
 */
export const disconnectRedis = closeRedis;

export default redisClient;
