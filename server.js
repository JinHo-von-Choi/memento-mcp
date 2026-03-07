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
import fs               from "node:fs";
import path             from "node:path";
import os               from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/** 설정 */
import { PORT, ACCESS_KEY, SESSION_TTL_MS, LOG_DIR, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from "./lib/config.js";

/** Rate Limiting */
import { RateLimiter } from "./lib/rate-limiter.js";

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
import { isInitializeRequest, requireAuthentication, validateMasterKey, validateAuthentication } from "./lib/auth.js";
import {
  listApiKeys,
  createApiKey,
  updateApiKeyStatus,
  deleteApiKey
} from "./lib/admin/ApiKeyStore.js";

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

/** Rate Limiter 인스턴스 */
const rateLimiter          = new RateLimiter({
  windowMs:    RATE_LIMIT_WINDOW_MS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS
});
setInterval(() => rateLimiter.cleanup(), 5 * 60_000).unref();

/** EmbeddingWorker 인스턴스 (서버 시작 후 초기화) */
let globalEmbeddingWorker  = null;

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

    const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                  || req.socket.remoteAddress
                  || "unknown";

    if (!rateLimiter.allow(clientIp)) {
      res.writeHead(429, { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
      res.end(JSON.stringify(jsonRpcError(null, -32000, "Too many requests")));
      return;
    }

    let sessionId          = req.headers["mcp-session-id"] || url.searchParams.get("sessionId") || url.searchParams.get("mcp-session-id");
    let sessionKeyId       = null;
    let msg;

    try {
      msg                  = await readJsonBody(req);
    } catch (err) {
      if (err.statusCode === 413) {
        await sendJSON(res, 413, jsonRpcError(null, -32000, "Payload too large"), req);
        return;
      }
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
      sessionKeyId           = session.keyId ?? null;

      if (!session.authenticated) {
        if (!await requireAuthentication(req, res, msg, null)) {
          return;
        }

        session.authenticated = true;
      }
    }

    if (!sessionId && isInitializeRequest(msg)) {
      const authCheck        = await validateAuthentication(req, msg);

      if (!authCheck.valid) {
        res.statusCode       = 401;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(jsonRpcError(msg.id ?? null, -32000, authCheck.error)));
        return;
      }

      sessionKeyId           = authCheck.keyId ?? null;
      sessionId              = await createStreamableSession(true, sessionKeyId);
      console.log(`[Streamable] Authenticated session created: ${sessionId}${sessionKeyId ? ` (keyId: ${sessionKeyId})` : " (master)"}`);
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

    /** tools/call 요청에 _sessionId, _keyId 주입 */
    if (msg.method === "tools/call" && msg.params?.arguments) {
      msg.params.arguments._sessionId = sessionId;
      msg.params.arguments._keyId     = sessionKeyId;
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
    } catch (err) {
      if (err.statusCode === 413) {
        res.statusCode     = 413;
        res.end("Payload too large");
        return;
      }
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
   * Admin: Static UI
   * GET /v1/internal/model/nothing  → assets/admin/index.html
   * GET /v1/internal/model/nothing/images/:file → assets/images/:file
   * ======================================== */
  const ADMIN_BASE = "/v1/internal/model/nothing";

  if (req.method === "GET" && (url.pathname === ADMIN_BASE || url.pathname === `${ADMIN_BASE}/`)) {
    const htmlPath = path.join(__dirname, "assets", "admin", "index.html");
    fs.readFile(htmlPath, (err, data) => {
      if (err) { res.statusCode = 404; res.end("Admin UI not found"); return; }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end(data);
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith(`${ADMIN_BASE}/images/`)) {
    /** path.basename 으로 path traversal 차단 */
    const filename = path.basename(url.pathname);
    const imgPath  = path.join(__dirname, "assets", "images", filename);
    fs.readFile(imgPath, (err, data) => {
      if (err) { res.statusCode = 404; res.end("Image not found"); return; }
      const ext = path.extname(filename).toLowerCase();
      const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
      res.statusCode = 200;
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.end(data);
    });
    return;
  }

  /* ========================================
   * Admin: REST API  (마스터 키 필수)
   * POST   /v1/internal/model/nothing/auth          → 마스터 키 검증
   * GET    /v1/internal/model/nothing/stats         → 대시보드 통계
   * GET    /v1/internal/model/nothing/activity      → 최근 활동 (파편)
   * GET    /v1/internal/model/nothing/keys          → 키 목록
   * POST   /v1/internal/model/nothing/keys          → 키 생성
   * PUT    /v1/internal/model/nothing/keys/:id      → 상태 변경 { status }
   * DELETE /v1/internal/model/nothing/keys/:id      → 키 삭제
   * ======================================== */
  if (url.pathname.startsWith(`${ADMIN_BASE}/`)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    /** 마스터 키 인증 (POST /auth 는 검증 자체가 목적이므로 통과 후 처리) */
    const isAuthEndpoint = req.method === "POST" && url.pathname === `${ADMIN_BASE}/auth`;
    if (!isAuthEndpoint && !validateMasterKey(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    /** POST /auth */
    if (req.method === "POST" && url.pathname === `${ADMIN_BASE}/auth`) {
      if (validateMasterKey(req)) {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Invalid admin key" }));
      }
      return;
    }

    /** GET /stats */
    if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/stats`) {
      try {
        const pool = getPrimaryPool();

        const [fragR, callR, keyR] = await Promise.all([
          pool.query("SELECT COUNT(*) AS total FROM agent_memory.fragments"),
          pool.query(`SELECT COALESCE(SUM(call_count),0) AS total
                        FROM agent_memory.api_key_usage
                       WHERE usage_date = CURRENT_DATE`),
          pool.query("SELECT COUNT(*) AS total FROM agent_memory.api_keys WHERE status='active'"),
        ]);

        const cpus    = os.cpus();
        const cpuPct  = Math.min(100, Math.round((os.loadavg()[0] / cpus.length) * 100));
        const memPct  = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);

        let diskPct = 0;
        try {
          const d = fs.statfsSync("/");
          diskPct = Math.round(((d.blocks - d.bfree) / d.blocks) * 100);
        } catch (_) { /* non-posix */ }

        let dbSizeBytes = 0;
        try {
          const { rows: [sr] } = await pool.query(
            "SELECT pg_database_size(current_database()) AS bytes"
          );
          dbSizeBytes = parseInt(sr.bytes);
        } catch (_) { /* ignore */ }

        const redisStat = (redisClient && redisClient.status === "ready")
          ? "connected" : "disconnected";

        res.statusCode = 200;
        res.end(JSON.stringify({
          fragments:     parseInt(fragR.rows[0].total),
          sessions:      streamableSessions.size + legacySseSessions.size,
          apiCallsToday: parseInt(callR.rows[0].total),
          activeKeys:    parseInt(keyR.rows[0].total),
          uptime:        Math.floor(process.uptime()),
          nodeVersion:   process.version,
          system:        { cpu: cpuPct, memory: memPct, disk: diskPct, dbSizeBytes },
          db:            "connected",
          redis:         redisStat,
        }));
      } catch (err) {
        console.error("[Admin] /stats error:", err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    /** GET /activity */
    if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/activity`) {
      try {
        const pool = getPrimaryPool();
        const { rows } = await pool.query(`
          SELECT f.id, f.topic, f.type, f.agent_id, f.key_id, f.created_at,
                 LEFT(f.content, 80) AS preview,
                 k.name              AS key_name,
                 k.key_prefix
          FROM  agent_memory.fragments f
          LEFT JOIN agent_memory.api_keys k ON k.id = f.key_id
          ORDER BY f.created_at DESC
          LIMIT 10
        `);
        res.statusCode = 200;
        res.end(JSON.stringify(rows));
      } catch (err) {
        console.error("[Admin] /activity error:", err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    /** GET /keys */
    if (req.method === "GET" && url.pathname === `${ADMIN_BASE}/keys`) {
      try {
        const keys = await listApiKeys();
        res.statusCode = 200;
        res.end(JSON.stringify(keys));
      } catch (err) {
        console.error("[Admin] listApiKeys error:", err.message);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    /** POST /keys */
    if (req.method === "POST" && url.pathname === `${ADMIN_BASE}/keys`) {
      try {
        const body = await readJsonBody(req);
        if (!body.name || typeof body.name !== "string") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "name is required" }));
          return;
        }
        const key = await createApiKey({
          name:        body.name.trim(),
          permissions: Array.isArray(body.permissions) ? body.permissions : ["read"],
          daily_limit: Number(body.daily_limit) || 10000
        });
        res.statusCode = 201;
        res.end(JSON.stringify(key));
      } catch (err) {
        if (err.statusCode === 413) {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: "Payload too large" }));
          return;
        }
        console.error("[Admin] createApiKey error:", err.message);
        res.statusCode = err.message.includes("unique") ? 409 : 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    /** PUT /keys/:id */
    const putMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/keys\/([^/]+)$/);
    if (req.method === "PUT" && putMatch) {
      try {
        const body   = await readJsonBody(req);
        const result = await updateApiKeyStatus(putMatch[1], body.status);
        res.statusCode = 200;
        res.end(JSON.stringify(result));
      } catch (err) {
        if (err.statusCode === 413) {
          res.statusCode = 413;
          res.end(JSON.stringify({ error: "Payload too large" }));
          return;
        }
        console.error("[Admin] updateApiKeyStatus error:", err.message);
        res.statusCode = err.message === "Key not found" ? 404 : 400;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    /** DELETE /keys/:id */
    const delMatch = url.pathname.match(/^\/v1\/internal\/model\/nothing\/keys\/([^/]+)$/);
    if (req.method === "DELETE" && delMatch) {
      try {
        await deleteApiKey(delMatch[1]);
        res.statusCode = 204;
        res.end();
      } catch (err) {
        console.error("[Admin] deleteApiKey error:", err.message);
        res.statusCode = err.message === "Key not found" ? 404 : 500;
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
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

  /** 임베딩 비동기 워커 시작 */
  import("./lib/memory/EmbeddingWorker.js")
    .then(({ EmbeddingWorker }) => {
      globalEmbeddingWorker = new EmbeddingWorker();
      return globalEmbeddingWorker.start();
    })
    .then(async () => {
      /** GraphLinker: 임베딩 완료 시 자동 관계 생성 */
      const { GraphLinker } = await import("./lib/memory/GraphLinker.js");
      const graphLinker     = new GraphLinker();

      globalEmbeddingWorker.on("embedding_ready", async ({ fragmentId }) => {
        try {
          const count = await graphLinker.linkFragment(fragmentId, "system");
          if (count > 0) console.debug(`[GraphLinker] Linked ${count} for ${fragmentId}`);
        } catch (err) {
          console.warn(`[GraphLinker] Error: ${err.message}`);
        }
      });
    })
    .catch(err => {
      console.error("[Startup] Failed to start EmbeddingWorker:", err.message);
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
  if (globalEmbeddingWorker) globalEmbeddingWorker.stop();

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
