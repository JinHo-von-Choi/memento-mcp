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

import http              from "http";

/** 설정 */
import { PORT, ACCESS_KEY, SESSION_TTL_MS, LOG_DIR } from "./lib/config.js";

/** 메트릭 */
import {
  register as metricsRegister,
  recordHttpRequest,
  updateSessionCounts
} from "./lib/metrics.js";

/** 유틸리티 */
import { validateOrigin, readJsonBody, sseWrite } from "./lib/utils.js";
import { sendJSON } from "./lib/compression.js";

/** 세션 관리 */
import {
  streamableSessions,
  legacySseSessions,
  createStreamableSession,
  validateStreamableSession,
  closeStreamableSession,
  createLegacySseSession,
  validateLegacySseSession,
  closeLegacySseSession,
  cleanupExpiredSessions
} from "./lib/sessions.js";

/** 인증 */
import { isInitializeRequest, requireAuthentication } from "./lib/auth.js";

/** OAuth 2.0 */
import {
  getAuthServerMetadata,
  getResourceMetadata,
  handleAuthorize,
  handleToken,
  validateAccessToken,
  cleanupExpiredOAuthData
} from "./lib/oauth.js";

/** JSON-RPC */
import { jsonRpcError, dispatchJsonRpc } from "./lib/jsonrpc.js";

/** 도구 (통계 저장용) */
import { saveAccessStats } from "./lib/tools/index.js";
import { shutdownPool, getPoolStats, getPrimaryPool } from "./lib/tools/db.js";
import { redisClient } from "./lib/redis.js";
import { getMemoryEvaluator } from "./lib/memory/MemoryEvaluator.js";

/**
 * HTTP 서버
 */
const server               = http.createServer(async (req, res) => {
  const startTime          = process.hrtime.bigint();

  if (!validateOrigin(req, res)) {
    return;
  }

  const url                  = new URL(req.url || "/", "http://localhost");

  /* ========================================
   * Health Check: GET /health
   * ======================================== */
  if (req.method === "GET" && url.pathname === "/health") {
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      pid: process.pid,
      workerId: process.env.WORKER_ID || "single",
      memory: process.memoryUsage(),
      checks: {}
    };

    // Redis 연결 확인
    try {
      if (redisClient && redisClient.status === "ready") {
        health.checks.redis = { status: "up" };
      } else {
        health.checks.redis = { status: "down", error: "Not connected" };
        health.status = "degraded";
      }
    } catch (err) {
      health.checks.redis = { status: "down", error: err.message };
      health.status = "degraded";
    }

    // DB 연결 확인 (실제 쿼리로 검증)
    try {
      const pool = getPrimaryPool();
      await pool.query("SELECT 1");
      const poolStats = getPoolStats();
      health.checks.database = { status: "up", pool: poolStats };
    } catch (err) {
      health.checks.database = { status: "down", error: err.message };
      health.status = "degraded";
    }

    // 세션 상태
    health.checks.sessions = {
      streamable: streamableSessions.size,
      legacy: legacySseSessions.size,
      total: streamableSessions.size + legacySseSessions.size
    };

    const statusCode = health.status === "healthy" ? 200 : 503;
    await sendJSON(res, statusCode, health, req);

    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordHttpRequest(req.method, url.pathname, statusCode, duration);
    return;
  }

  /* ========================================
   * Prometheus Metrics: GET /metrics
   * ======================================== */
  if (req.method === "GET" && url.pathname === "/metrics") {
    try {
      res.statusCode       = 200;
      res.setHeader("Content-Type", metricsRegister.contentType);
      res.end(await metricsRegister.metrics());

      // 메트릭 기록
      const duration       = Number(process.hrtime.bigint() - startTime) / 1e9;
      recordHttpRequest(req.method, url.pathname, 200, duration);
    } catch (err) {
      console.error("[Metrics] Error generating metrics:", err);
      res.statusCode       = 500;
      res.end("Internal Server Error");
    }
    return;
  }

  /* ========================================
   * Streamable HTTP: POST /mcp
   * ======================================== */
  if (req.method === "POST" && url.pathname === "/mcp") {
    /** CORS 응답 헤더 (브라우저 기반 MCP 클라이언트 호환) */
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

    let sessionId          = req.headers["mcp-session-id"] || url.searchParams.get("sessionId") || url.searchParams.get("mcp-session-id");
    let msg;

    try {
      msg                  = await readJsonBody(req);
    } catch {
      await sendJSON(res, 400, jsonRpcError(null, -32700, "Parse error"), req);
      return;
    }

    if (sessionId) {
      const validation       = await validateStreamableSession(sessionId);

      if (!validation.valid) {
        await sendJSON(res, 400, jsonRpcError(null, -32000, validation.reason), req);
        return;
      }

      const session          = validation.session;

      if (!session.authenticated) {
        if (!await requireAuthentication(req, res, msg, null)) {
          return;
        }

        session.authenticated = true;
      }
    }

    if (!sessionId && isInitializeRequest(msg)) {
      if (!await requireAuthentication(req, res, msg, msg.id ?? null)) {
        return;
      }

      sessionId            = await createStreamableSession(true);
      console.log(`[Streamable] Authenticated session created: ${sessionId}`);
    }

    if (!sessionId) {
      await sendJSON(res, 400, jsonRpcError(
        msg?.id ?? null,
        -32000,
        "Session required. Send an 'initialize' request first to create a session, " +
        "then include the returned MCP-Session-Id header in subsequent requests."
      ), req);
      return;
    }

    /** tools/call 요청에 _sessionId 주입 (SessionActivityTracker용) */
    if (msg.method === "tools/call" && msg.params?.arguments) {
      msg.params.arguments._sessionId = sessionId;
    }

    const { kind, response }  = await dispatchJsonRpc(msg);

    if (kind === "accepted") {
      res.statusCode       = 202;
      res.setHeader("MCP-Session-Id", sessionId);
      res.end();
      return;
    }

    res.setHeader("MCP-Session-Id", sessionId);
    await sendJSON(res, 200, response, req);

    // 메트릭 기록
    const duration         = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordHttpRequest(req.method, url.pathname, 200, duration);
    return;
  }

  /* ========================================
   * Streamable HTTP: GET /mcp
   * ======================================== */
  if (req.method === "GET" && url.pathname === "/mcp") {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

    const sessionId          = req.headers["mcp-session-id"] || url.searchParams.get("sessionId") || url.searchParams.get("mcp-session-id");

    if (!sessionId) {
      res.statusCode       = 400;
      res.end("Missing session ID");
      return;
    }

    const validation         = await validateStreamableSession(sessionId);

    if (!validation.valid) {
      res.statusCode       = 400;
      res.end(validation.reason);
      return;
    }

    const session            = validation.session;

    if (!session.authenticated) {
      res.statusCode       = 401;
      res.end("Unauthorized");
      return;
    }

    res.statusCode         = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("MCP-Session-Id", sessionId);

    session.setSseResponse(res);

    req.on("close", () => {
      console.log(`[Streamable] SSE closed for session: ${sessionId}`);
      session.setSseResponse(null);
    });

    return;
  }

  /* ========================================
   * Streamable HTTP: DELETE /mcp
   * ======================================== */
  if (req.method === "DELETE" && url.pathname === "/mcp") {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

    const sessionId          = req.headers["mcp-session-id"] || url.searchParams.get("sessionId") || url.searchParams.get("mcp-session-id");

    if (!sessionId) {
      res.statusCode       = 400;
      res.end("Missing session ID");
      return;
    }

    const validation         = await validateStreamableSession(sessionId);

    if (!validation.valid) {
      res.statusCode       = 400;
      res.end(validation.reason);
      return;
    }

    await closeStreamableSession(sessionId);
    console.log(`[Streamable] Session deleted: ${sessionId}`);

    res.statusCode         = 200;
    res.end();
    return;
  }

  /* ========================================
   * Legacy SSE: GET /sse
   * ======================================== */
  if (req.method === "GET" && url.pathname === "/sse") {
    const rawKey             = url.searchParams.get("accessKey") || "";
    /** URL 파라미터로 전달된 키는 이중 인코딩될 수 있으므로 디코딩 후 비교 */
    let accessKey          = rawKey;
    try { accessKey        = decodeURIComponent(rawKey); } catch { /* 디코딩 실패 시 원본 사용 */ }
    const isAuthenticated    = !ACCESS_KEY || (accessKey === ACCESS_KEY);

    if (!isAuthenticated) {
      res.statusCode       = 401;
      res.end("Unauthorized");
      return;
    }

    res.statusCode         = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const sessionId          = createLegacySseSession(res);
    const session            = legacySseSessions.get(sessionId);
    session.authenticated  = isAuthenticated;

    console.log(`[Legacy SSE] Session created: ${sessionId}`);

    sseWrite(res, "endpoint", `/message?sessionId=${encodeURIComponent(sessionId)}`);

    req.on("close", () => {
      console.log(`[Legacy SSE] Session closed: ${sessionId}`);
      closeLegacySseSession(sessionId);
    });

    return;
  }

  /* ========================================
   * Legacy SSE: POST /message
   * ======================================== */
  if (req.method === "POST" && url.pathname === "/message") {
    const sessionId          = url.searchParams.get("sessionId");

    if (!sessionId) {
      res.statusCode       = 400;
      res.end("Missing session ID");
      return;
    }

    const validation         = validateLegacySseSession(sessionId);

    if (!validation.valid) {
      res.statusCode       = 404;
      res.end(validation.reason);
      return;
    }

    const session            = validation.session;

    if (!session.authenticated) {
      res.statusCode       = 401;
      res.end("Unauthorized");
      return;
    }

    let msg;
    try {
      msg                  = await readJsonBody(req);
    } catch {
      res.statusCode       = 400;
      res.end("Invalid JSON");
      return;
    }

    /** tools/call 요청에 _sessionId 주입 (SessionActivityTracker용) */
    if (msg.method === "tools/call" && msg.params?.arguments) {
      msg.params.arguments._sessionId = sessionId;
    }

    const { kind, response }  = await dispatchJsonRpc(msg);

    if (kind === "ok" || kind === "error") {
      sseWrite(session.res, "message", response);
    }

    res.statusCode         = 202;
    res.end();
    return;
  }

  /* ========================================
   * OAuth 2.0: Authorization Server Metadata
   * ======================================== */
  if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
    const baseUrl            = `https://${req.headers.host || "pmcp.nerdvana.kr"}`;
    const metadata           = getAuthServerMetadata(baseUrl);

    res.setHeader("Access-Control-Allow-Origin", "*");
    await sendJSON(res, 200, metadata, req);
    return;
  }

  /* ========================================
   * OAuth 2.0: Protected Resource Metadata
   * ======================================== */
  if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
    const baseUrl            = `https://${req.headers.host || "pmcp.nerdvana.kr"}`;
    const metadata           = getResourceMetadata(baseUrl);

    res.setHeader("Access-Control-Allow-Origin", "*");
    await sendJSON(res, 200, metadata, req);
    return;
  }

  /* ========================================
   * OAuth 2.0: Authorization Endpoint
   * ======================================== */
  if (req.method === "GET" && url.pathname === "/authorize") {
    const params             = {
      response_type        : url.searchParams.get("response_type"),
      client_id            : url.searchParams.get("client_id"),
      redirect_uri         : url.searchParams.get("redirect_uri"),
      code_challenge       : url.searchParams.get("code_challenge"),
      code_challenge_method: url.searchParams.get("code_challenge_method"),
      state                : url.searchParams.get("state"),
      scope                : url.searchParams.get("scope")
    };

    const result             = await handleAuthorize(params);

    if (result.error) {
      const redirectUri      = params.redirect_uri;
      if (redirectUri) {
        const errorUrl       = new URL(redirectUri);
        errorUrl.searchParams.set("error", result.error);
        errorUrl.searchParams.set("error_description", result.error_description);
        if (params.state) {
          errorUrl.searchParams.set("state", params.state);
        }
        res.statusCode     = 302;
        res.setHeader("Location", errorUrl.toString());
        res.end();
      } else {
        await sendJSON(res, 400, result, req);
      }
      return;
    }

    if (result.redirect) {
      res.statusCode       = 302;
      res.setHeader("Location", result.redirect);
      res.end();
      return;
    }

    res.statusCode         = 500;
    res.end("Internal error");
    return;
  }

  /* ========================================
   * OAuth 2.0: Token Endpoint
   * ======================================== */
  if (req.method === "POST" && url.pathname === "/token") {
    let body;
    try {
      const rawBody          = await new Promise((resolve, reject) => {
        const chunks         = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString()));
        req.on("error", reject);
      });

      /** application/x-www-form-urlencoded 또는 JSON 파싱 */
      const contentType      = req.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        body               = JSON.parse(rawBody);
      } else {
        body               = Object.fromEntries(new URLSearchParams(rawBody));
      }
    } catch {
      await sendJSON(res, 400, { error: "invalid_request", error_description: "Failed to parse request body" }, req);
      return;
    }

    const result             = await handleToken(body);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    await sendJSON(res, result.error ? 400 : 200, result, req);
    return;
  }

  /* ========================================
   * CORS Preflight
   * ======================================== */
  if (req.method === "OPTIONS") {
    res.statusCode         = 204;
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Session-Id, memento-access-key");
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.end();
    return;
  }

  res.statusCode           = 404;
  res.end("Not Found");

  // 404 메트릭 기록
  const duration           = Number(process.hrtime.bigint() - startTime) / 1e9;
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

  setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
  setInterval(cleanupExpiredOAuthData, 5 * 60 * 1000);
  console.log("Session cleanup: Running every 5 minutes");

  // 세션 수 메트릭 업데이트 (1분마다)
  setInterval(() => {
    updateSessionCounts(streamableSessions.size, legacySseSessions.size);
  }, 60 * 1000);
  console.log("Metrics: Session counts updated every minute");

  setInterval(() => saveAccessStats(LOG_DIR), 10 * 60 * 1000);
  console.log("Access stats: Saving every 10 minutes");

  /** Phase 2: 비동기 지식 품질 평가 워커 시작 */
  getMemoryEvaluator().start().catch(err => {
    console.error("[Startup] Failed to start MemoryEvaluator:", err.message);
  });

  /** NLI 모델 사전 로드 (cold start 방지, 비차단) */
  import("./lib/memory/NLIClassifier.js")
    .then(m => m.preloadNLI())
    .catch(err => {
      console.warn("[Startup] NLI preload skipped:", err.message);
    });
});

/**
 * Graceful Shutdown
 */
async function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}, starting graceful shutdown...`);

  // HTTP 서버 종료 (새 요청 거부, 기존 요청은 완료 대기)
  server.close(() => {
    console.log("[Shutdown] HTTP server closed");
  });

  // 세션 정리 (autoReflect 포함)
  console.log("[Shutdown] Closing all sessions (with auto-reflect)...");
  for (const sessionId of streamableSessions.keys()) {
    await closeStreamableSession(sessionId);
  }
  for (const sessionId of legacySseSessions.keys()) {
    await closeLegacySseSession(sessionId);
  }

  // Phase 2: 워커 중지
  getMemoryEvaluator().stop();

  // DB 연결 풀 종료
  await shutdownPool();

  // 최종 통계 저장
  await saveAccessStats(LOG_DIR);
  console.log("[Shutdown] Final stats saved");

  console.log("[Shutdown] Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
