/**
 * Memento MCP Server (HTTP) - Context7 Compatible with Authentication
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 *
 * 인증 방식:
 * 1. 세션 초기화(initialize) 시 MEMENTO_ACCESS_KEY 검증
 * 2. 또는 모든 요청에 Authorization: Bearer <key> 헤더 포함
 * 3. 인증 성공 시 README.md를 환영 메시지로 반환
 */

import http from "http";

/** 설정 */
import { PORT, ACCESS_KEY, AUTH_DISABLED, SESSION_TTL_MS, LOG_DIR, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_PER_IP, RATE_LIMIT_PER_KEY, detectPgvectorSchema, PGVECTOR_SCHEMA, ENABLE_OPENAPI } from "./lib/config.js";
import { MEMORY_CONFIG }          from "./config/memory.js";
import { validateMemoryConfig }   from "./config/validate-memory-config.js";

/** Rate Limiting */
import { DualRateLimiter } from "./lib/rate-limiter.js";

/** 유틸리티 */
import { validateOrigin } from "./lib/utils.js";

/** 세션 관리 */
import {
  closeStreamableSession,
  closeLegacySseSession,
  getAllSessionIds
} from "./lib/sessions.js";

/** 도구 (통계 저장용) */
import { saveAccessStats } from "./lib/tools/index.js";
import { shutdownPool, getPrimaryPool } from "./lib/tools/db.js";
import { getMemoryEvaluator } from "./lib/memory/MemoryEvaluator.js";

/** 메트릭 */
import { recordHttpRequest } from "./lib/metrics.js";

/** 스케줄러 */
import { startSchedulers } from "./lib/scheduler.js";

/** Reranker 사전 로드 */
import { preloadReranker } from "./lib/memory/Reranker.js";

/** OpenAPI */
import { validateAuthentication } from "./lib/auth.js";
import { buildSpec }              from "./lib/openapi.js";

/** HTTP 핸들러 */
import {
  handleHealth,
  handleMetrics,
  handleMcpPost,
  handleMcpGet,
  handleMcpDelete,
  handleLegacySseGet,
  handleLegacySsePost,
  handleOAuthServerMetadata,
  handleOAuthResourceMetadata,
  handleOAuthAuthorize,
  handleOAuthToken,
  handleOAuthRegister,
  handleAdminUi,
  handleAdminImage,
  handleAdminStatic,
  handleAdminApi,
  getAllowedOrigin,
  setWorkerRefs
} from "./lib/http-handlers.js";

/** Rate Limiter 인스턴스 (IP/API 키 이중 제한) */
const rateLimiter = new DualRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  perIp:    RATE_LIMIT_PER_IP,
  perKey:   RATE_LIMIT_PER_KEY
});
setInterval(() => rateLimiter.cleanup(), 5 * 60_000).unref();

/** EmbeddingWorker 인스턴스 (서버 시작 후 초기화) */
let globalEmbeddingWorker = null;

const ADMIN_BASE = "/v1/internal/model/nothing";

/**
 * HTTP 서버
 */
const server = http.createServer(async (req, res) => {
  const startTime = process.hrtime.bigint();

  if (!validateOrigin(req, res)) {
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");

  /* GET /health */
  if (req.method === "GET" && url.pathname === "/health") {
    await handleHealth(req, res, startTime);
    return;
  }

  /* GET /openapi.json */
  if (req.method === "GET" && url.pathname === "/openapi.json") {
    if (!ENABLE_OPENAPI) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    const auth = await validateAuthentication(req, null);
    if (!auth.valid) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: auth.error || "Unauthorized" }));
      return;
    }
    const isMaster = auth.keyId == null;
    const spec     = buildSpec(isMaster, isMaster ? null : (auth.permissions ?? []));
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(JSON.stringify(spec));
    return;
  }

  /* GET /metrics */
  if (req.method === "GET" && url.pathname === "/metrics") {
    await handleMetrics(req, res, startTime);
    return;
  }

  /* POST /mcp */
  if (req.method === "POST" && url.pathname === "/mcp") {
    await handleMcpPost(req, res, startTime, rateLimiter);
    return;
  }

  /* GET /mcp */
  if (req.method === "GET" && url.pathname === "/mcp") {
    await handleMcpGet(req, res);
    return;
  }

  /* DELETE /mcp */
  if (req.method === "DELETE" && url.pathname === "/mcp") {
    await handleMcpDelete(req, res);
    return;
  }

  /* GET /sse */
  if (req.method === "GET" && url.pathname === "/sse") {
    handleLegacySseGet(req, res);
    return;
  }

  /* POST /message */
  if (req.method === "POST" && url.pathname === "/message") {
    await handleLegacySsePost(req, res);
    return;
  }

  /* OAuth 2.0 */
  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/.well-known/oauth-authorization-server")) {
    await handleOAuthServerMetadata(req, res);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    await handleOAuthResourceMetadata(req, res);
    return;
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/authorize") {
    if (req.method === "POST") {
      const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      if (!rateLimiter.allow(clientIp)) {
        res.writeHead(429, { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
        res.end(JSON.stringify({ error: "too_many_requests" }));
        return;
      }
    }
    await handleOAuthAuthorize(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/token") {
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (!rateLimiter.allow(clientIp)) {
      res.writeHead(429, { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
      res.end(JSON.stringify({ error: "too_many_requests" }));
      return;
    }
    await handleOAuthToken(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/register") {
    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    if (!rateLimiter.allow(clientIp)) {
      res.writeHead(429, { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
      res.end(JSON.stringify({ error: "too_many_requests" }));
      return;
    }
    await handleOAuthRegister(req, res);
    return;
  }

  /* Admin UI */
  if (req.method === "GET" && (url.pathname === ADMIN_BASE || url.pathname === `${ADMIN_BASE}/`)) {
    handleAdminUi(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith(`${ADMIN_BASE}/images/`)) {
    handleAdminImage(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith(`${ADMIN_BASE}/assets/`)) {
    handleAdminStatic(req, res);
    return;
  }

  /* Admin API (auth 포함 주요 POST 경로에 rate limit 적용) */
  if (url.pathname.startsWith(`${ADMIN_BASE}/`)) {
    const isRateLimitedAdminPath =
      (req.method === "POST" && url.pathname === `${ADMIN_BASE}/auth`) ||
      (req.method === "POST" && url.pathname === `${ADMIN_BASE}/keys`) ||
      (req.method === "POST" && url.pathname === `${ADMIN_BASE}/import`);

    if (isRateLimitedAdminPath) {
      const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      if (!rateLimiter.allow(clientIp)) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
        res.end(JSON.stringify({ error: "Too Many Requests" }));
        return;
      }
    }
    await handleAdminApi(req, res);
    return;
  }

  /* CORS Preflight */
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", getAllowedOrigin(req));
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Session-Id, memento-access-key");
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end("Not Found");

  const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
  recordHttpRequest(req.method, url.pathname, 404, duration);
});

server.listen(PORT, () => {
  validateMemoryConfig(MEMORY_CONFIG);
  console.log(`Memento MCP HTTP server listening on port ${PORT}`);
  console.log("Streamable HTTP endpoints: POST/GET/DELETE /mcp");
  console.log("Legacy SSE endpoints: GET /sse, POST /message");

  if (ACCESS_KEY) {
    console.log("Authentication: ENABLED");
  } else {
    console.log("Authentication: DISABLED (set MEMENTO_ACCESS_KEY to enable)");
  }

  console.log(`Session TTL: ${SESSION_TTL_MS / 60000} minutes`);

  /** pgvector 스키마 자동 감지 (PGVECTOR_SCHEMA 미설정 시) */
  const pool = getPrimaryPool();
  if (pool) {
    detectPgvectorSchema(pool).then(() => {
      if (PGVECTOR_SCHEMA) {
        console.log(`pgvector schema auto-detected: ${PGVECTOR_SCHEMA}`);
      }
    }).catch(() => {});
  }

  const embeddingWorkerRef = { current: null };
  startSchedulers({ globalEmbeddingWorkerRef: embeddingWorkerRef });
  setWorkerRefs({ embeddingWorkerRef });
  globalEmbeddingWorker = embeddingWorkerRef.current;

  /** Reranker 사전 로드 (비차단 — 실패해도 서버 시작 중단 없음) */
  preloadReranker().catch(() => {});
});

/**
 * Graceful Shutdown
 */
async function gracefulShutdown(signal) {
  const DRAIN_TIMEOUT_MS = 30_000;
  console.log(`\n[Shutdown] Received ${signal}, starting graceful shutdown...`);

  /** 1. 새 요청 수신 중단 */
  server.close(() => {
    console.log("[Shutdown] HTTP server closed");
  });

  /** 2. 진행 중 워커 완료 대기 (최대 30초) */
  const drainPromises = [];

  const evaluatorDrain = getMemoryEvaluator().stop();
  if (evaluatorDrain) drainPromises.push(evaluatorDrain);

  if (globalEmbeddingWorker) {
    const embeddingDrain = globalEmbeddingWorker.stop();
    if (embeddingDrain) drainPromises.push(embeddingDrain);
  }

  if (drainPromises.length > 0) {
    console.log(`[Shutdown] Waiting for ${drainPromises.length} worker(s) to drain (timeout: ${DRAIN_TIMEOUT_MS}ms)...`);
    const timeout = new Promise(resolve =>
      setTimeout(() => {
        console.log("[Shutdown] Worker drain timeout reached, proceeding with shutdown");
        resolve();
      }, DRAIN_TIMEOUT_MS)
    );
    await Promise.race([
      Promise.allSettled(drainPromises),
      timeout,
    ]);
    console.log("[Shutdown] Workers drained");
  }

  /** 3. 활성 세션 auto-reflect (Redis 세션은 유지 — 재시작 후 복원 가능) */
  console.log("[Shutdown] Closing all sessions (with auto-reflect, preserving Redis)...");
  const { streamableIds, legacyIds } = getAllSessionIds();
  for (const sessionId of streamableIds) {
    await closeStreamableSession(sessionId, { preserveRedis: true });
  }
  for (const sessionId of legacyIds) {
    await closeLegacySseSession(sessionId, { preserveRedis: true });
  }

  /** 4. DB/Redis 연결 종료 */
  await shutdownPool();

  await saveAccessStats(LOG_DIR);
  console.log("[Shutdown] Final stats saved");

  console.log("[Shutdown] Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
