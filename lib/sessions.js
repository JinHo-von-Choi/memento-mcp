/**
 * 세션 관리
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 * 수정일: 2026-02-26 (Redis 세션 expiresAt 동기화 버그 수정)
 */

import crypto            from "crypto";
import { SESSION_TTL_MS, REDIS_ENABLED, CACHE_SESSION_TTL } from "./config.js";
import {
  saveSession as saveSessionToRedis,
  getSession as getSessionFromRedis,
  deleteSession as deleteSessionFromRedis
} from "./redis.js";
import { autoReflect } from "./memory/AutoReflect.js";

/** Streamable HTTP 세션 저장소 */
export const streamableSessions = new Map();

/** Legacy SSE 세션 저장소 */
export const legacySseSessions  = new Map();

/**
 * Streamable HTTP 세션 생성
 */
export async function createStreamableSession(authenticated = false) {
  const sessionId           = crypto.randomUUID();
  let sseResponse         = null;
  let heartbeat           = null;
  const now                 = Date.now();

  const sessionData       = {
    sessionId,
    authenticated,
    createdAt       : now,
    expiresAt       : now + SESSION_TTL_MS,
    lastAccessedAt  : now
  };

  const session = {
    ...sessionData,
    getSseResponse  : () => sseResponse,
    setSseResponse  : (res) => {
      sseResponse         = res;

      if (res) {
        heartbeat         = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch {
            // noop
          }
        }, 25000);
      }
    },
    close: async () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat         = null;
      }

      if (sseResponse) {
        try {
          sseResponse.end();
        } catch {
          // noop
        }
        sseResponse       = null;
      }

      streamableSessions.delete(sessionId);

      // Redis에서도 삭제
      if (REDIS_ENABLED) {
        await deleteSessionFromRedis(sessionId);
      }
    }
  };

  streamableSessions.set(sessionId, session);

  // Redis에 저장 (SSE 연결 정보는 제외)
  if (REDIS_ENABLED) {
    await saveSessionToRedis(sessionId, sessionData, CACHE_SESSION_TTL);
  }

  return sessionId;
}

/**
 * Streamable HTTP 세션 검증 (TTL 체크)
 */
export async function validateStreamableSession(sessionId) {
  let session             = streamableSessions.get(sessionId);

  // 메모리에 없으면 Redis에서 조회 시도
  if (!session && REDIS_ENABLED) {
    const redisSession    = await getSessionFromRedis(sessionId);

    if (redisSession) {
      // Redis에서 복원 (SSE 연결 정보는 없음)
      session             = {
        ...redisSession,
        getSseResponse    : () => null,
        setSseResponse    : () => {},
        close             : async () => {
          streamableSessions.delete(sessionId);
          if (REDIS_ENABLED) {
            await deleteSessionFromRedis(sessionId);
          }
        }
      };

      streamableSessions.set(sessionId, session);
    }
  }

  if (!session) {
    return { valid: false, reason: "Session not found" };
  }

  const now                 = Date.now();

  if (now > session.expiresAt) {
    await closeStreamableSession(sessionId);
    return { valid: false, reason: "Session expired" };
  }

  session.lastAccessedAt  = now;
  session.expiresAt       = now + SESSION_TTL_MS;

  // Redis에 갱신된 expiresAt/lastAccessedAt 저장 (TTL 연장 + JSON 값 동기화)
  if (REDIS_ENABLED) {
    const { getSseResponse, setSseResponse, close, ...persistableData } = session;
    await saveSessionToRedis(sessionId, persistableData, CACHE_SESSION_TTL);
  }

  return { valid: true, session };
}

/**
 * Streamable HTTP 세션 종료
 */
export async function closeStreamableSession(sessionId) {
  const session             = streamableSessions.get(sessionId);

  if (session) {
    /** 세션 종료 전 자동 reflect (비차단: 실패해도 세션은 닫힘) */
    try { await autoReflect(sessionId); } catch { /* noop */ }
    await session.close();
  }
}

/**
 * Legacy SSE 세션 생성
 */
export function createLegacySseSession(res) {
  const sessionId           = crypto.randomUUID();
  const now                 = Date.now();
  const heartbeat           = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // noop
    }
  }, 25000);

  legacySseSessions.set(sessionId, {
    res,
    heartbeat,
    authenticated : false,
    createdAt     : now,
    expiresAt     : now + SESSION_TTL_MS,
    lastAccessedAt: now
  });
  return sessionId;
}

/**
 * Legacy SSE 세션 검증 (TTL 체크)
 */
export function validateLegacySseSession(sessionId) {
  const session             = legacySseSessions.get(sessionId);

  if (!session) {
    return { valid: false, reason: "Session not found" };
  }

  const now                 = Date.now();

  if (now > session.expiresAt) {
    closeLegacySseSession(sessionId);
    return { valid: false, reason: "Session expired" };
  }

  session.lastAccessedAt  = now;
  return { valid: true, session };
}

/**
 * Legacy SSE 세션 정리
 */
export async function closeLegacySseSession(sessionId) {
  const session             = legacySseSessions.get(sessionId);

  if (!session) {
    return;
  }

  /** 세션 종료 전 자동 reflect */
  try { await autoReflect(sessionId); } catch { /* noop */ }

  clearInterval(session.heartbeat);
  legacySseSessions.delete(sessionId);

  try {
    session.res.end();
  } catch {
    // noop
  }
}

/**
 * 만료된 세션 정리 (주기적 실행)
 */
export async function cleanupExpiredSessions() {
  const now                 = Date.now();
  let streamableExpired   = 0;
  let legacyExpired       = 0;

  for (const [sessionId, session] of streamableSessions.entries()) {
    if (now > session.expiresAt) {
      await closeStreamableSession(sessionId);
      streamableExpired++;
    }
  }

  for (const [sessionId, session] of legacySseSessions.entries()) {
    if (now > session.expiresAt) {
      await closeLegacySseSession(sessionId);
      legacyExpired++;
    }
  }

  if (streamableExpired > 0 || legacyExpired > 0) {
    console.log(`[Session Cleanup] Expired sessions removed - Streamable: ${streamableExpired}, Legacy: ${legacyExpired}`);
  }
}
