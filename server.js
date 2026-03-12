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
import { PORT, ACCESS_KEY, SESSION_TTL_MS, LOG_DIR, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from "./lib/config.js";

/** Rate Limiting */
import { RateLimiter } from "./lib/rate-limiter.js";

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
import { shutdownPool } from "./lib/tools/db.js";
import { getMemoryEvaluator } from "./lib/memory/MemoryEvaluator.js";

/** 메트릭 */
import { recordHttpRequest } from "./lib/metrics.js";

/** 스케줄러 */
import { startSchedulers } from "./lib/scheduler.js";

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
  handleAdminUi,
  handleAdminImage,
  handleAdminApi
} from "./lib/http-handlers.js";

/** Rate Limiter 인스턴스 */
const rateLimiter = new RateLimiter({
  windowMs:    RATE_LIMIT_WINDOW_MS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS
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
  if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
    await handleOAuthServerMetadata(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
    await handleOAuthResourceMetadata(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/authorize") {
    await handleOAuthAuthorize(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/token") {
    await handleOAuthToken(req, res);
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

  /* Admin API */
  if (url.pathname.startsWith(`${ADMIN_BASE}/`)) {
    await handleAdminApi(req, res);
    return;
  }

  /* CORS Preflight */
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
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
  console.log(`Memento MCP HTTP server listening on port ${PORT}`);
  console.log("Streamable HTTP endpoints: POST/GET/DELETE /mcp");
  console.log("Legacy SSE endpoints: GET /sse, POST /message");

  if (ACCESS_KEY) {
    console.log("Authentication: ENABLED");
  } else {
    console.log("Authentication: DISABLED (set MEMENTO_ACCESS_KEY to enable)");
  }

  console.log(`Session TTL: ${SESSION_TTL_MS / 60000} minutes`);

  const embeddingWorkerRef = { current: null };
  startSchedulers({ globalEmbeddingWorkerRef: embeddingWorkerRef });
  globalEmbeddingWorker = embeddingWorkerRef.current;
});

/**
 * Graceful Shutdown
 */
async function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}, starting graceful shutdown...`);

  server.close(() => {
    console.log("[Shutdown] HTTP server closed");
  });

  console.log("[Shutdown] Closing all sessions (with auto-reflect)...");
  const { streamableIds, legacyIds } = getAllSessionIds();
  for (const sessionId of streamableIds) {
    await closeStreamableSession(sessionId);
  }
  for (const sessionId of legacyIds) {
    await closeLegacySseSession(sessionId);
  }

  getMemoryEvaluator().stop();
  if (globalEmbeddingWorker) globalEmbeddingWorker.stop();

  await shutdownPool();

  await saveAccessStats(LOG_DIR);
  console.log("[Shutdown] Final stats saved");

  console.log("[Shutdown] Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
