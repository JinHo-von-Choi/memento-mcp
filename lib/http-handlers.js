/**
 * HTTP 요청 핸들러 — 각 엔드포인트별 처리 로직
 *
 * 작성자: 최진호
 * 작성일: 2026-03-12
 */

import { ACCESS_KEY, ALLOWED_ORIGINS, RATE_LIMIT_WINDOW_MS, REDIS_ENABLED } from "./config.js";
import {
  register as metricsRegister,
  recordHttpRequest
} from "./metrics.js";
import { readJsonBody, sseWrite } from "./utils.js";
import { sendJSON } from "./compression.js";
import {
  createStreamableSession,
  validateStreamableSession,
  closeStreamableSession,
  createLegacySseSession,
  validateLegacySseSession,
  closeLegacySseSession,
  getSessionCounts,
  getLegacySession
} from "./sessions.js";
import { isInitializeRequest, requireAuthentication, validateAuthentication, validateMasterKey, safeCompare } from "./auth.js";
import { logInfo, logWarn, logError } from "./logger.js";
import {
  getAuthServerMetadata,
  getResourceMetadata,
  handleAuthorize,
  handleToken,
  buildConsentHtml
} from "./oauth.js";
import { registerClient } from "./admin/OAuthClientStore.js";
import { jsonRpcError, dispatchJsonRpc } from "./jsonrpc.js";
import { getPrimaryPool, getPoolStats } from "./tools/db.js";
import { redisClient } from "./redis.js";
import { getMemoryEvaluator } from "./memory/MemoryEvaluator.js";

export { handleAdminUi, handleAdminImage, handleAdminStatic, handleAdminApi } from "./admin/admin-routes.js";

/**
 * 워커 참조 저장소 — server.js에서 setWorkerRefs()로 주입
 *
 * embeddingWorkerRef는 { current: EmbeddingWorker|null } 형태의 참조 객체를 받아
 * 비동기 초기화 후에도 최신 인스턴스에 접근할 수 있도록 한다.
 */
const workerRefs = {
  embeddingWorkerRef: null,
  lastConsolidateRun: null
};

/**
 * 외부에서 워커 참조를 주입하는 setter
 * @param {object} refs
 * @param {object|null} refs.embeddingWorkerRef - { current: EmbeddingWorker|null } 참조 객체
 */
export function setWorkerRefs(refs) {
  if (refs.embeddingWorkerRef !== undefined) workerRefs.embeddingWorkerRef = refs.embeddingWorkerRef;
}

/**
 * Consolidator 마지막 실행 시각을 기록 — scheduler.js에서 호출
 */
export function recordConsolidateRun() {
  workerRefs.lastConsolidateRun = new Date().toISOString();
}

/**
 * CORS Origin 검증 — ALLOWED_ORIGINS 화이트리스트 기반
 * 화이트리스트 미설정(빈 Set) 시 모든 Origin 허용 (하위 호환)
 * 화이트리스트 설정 시 미등록 Origin에 "null" 반환
 */
export function getAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return "*";
  if (ALLOWED_ORIGINS.size === 0) return origin;
  return ALLOWED_ORIGINS.has(origin) ? origin : "null";
}

/**
 * GET /health
 * 비인증 요청 시 상태만 반환, 인증 시 상세 정보 포함
 *
 * 응답 구조 (인증 시):
 * - status: "healthy" | "degraded" | "unhealthy"
 * - services.database: DB 연결 + 응답 시간
 * - services.redis: Redis PING 또는 disabled
 * - services.pgvector: pg_extension 조회
 * - workers: embedding, evaluator, consolidator 상태
 */
export async function handleHealth(req, res, startTime) {
  const isAuthenticated = !ACCESS_KEY || validateMasterKey(req);

  /** DB 상태 확인 + 응답 시간 측정 */
  let dbHealthy    = true;
  let dbLatencyMs  = 0;
  let poolStats    = null;
  try {
    const pool  = getPrimaryPool();
    const t0    = Date.now();
    await pool.query("SELECT 1");
    dbLatencyMs = Date.now() - t0;
    if (isAuthenticated) poolStats = getPoolStats();
  } catch {
    dbHealthy = false;
  }

  /** Redis 상태 확인 + 응답 시간 측정 */
  let redisStatus    = "disabled";
  let redisLatencyMs = null;
  let redisError     = null;
  if (REDIS_ENABLED) {
    try {
      if (redisClient && redisClient.status !== "stub") {
        const t0 = Date.now();
        await redisClient.ping();
        redisLatencyMs = Date.now() - t0;
        redisStatus    = "up";
      } else {
        redisStatus = "down";
        redisError  = "Not connected";
      }
    } catch (err) {
      redisStatus = "down";
      redisError  = err.message;
    }
  }

  /** pgvector 확인 */
  let pgvectorStatus  = "unknown";
  let pgvectorVersion = null;
  if (dbHealthy) {
    try {
      const pool   = getPrimaryPool();
      const result = await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
      if (result.rows.length > 0) {
        pgvectorStatus  = "up";
        pgvectorVersion = result.rows[0].extversion;
      } else {
        pgvectorStatus = "not_installed";
      }
    } catch {
      pgvectorStatus = "unknown";
    }
  }

  /** 전체 상태 판정 */
  let status;
  if (!dbHealthy)              status = "unhealthy";
  else if (redisStatus === "down") status = "degraded";
  else                         status = "healthy";

  const statusCode = status === "unhealthy" ? 503 : 200;

  /** 비인증 — 최소 응답 */
  if (!isAuthenticated) {
    await sendJSON(res, statusCode, { status, timestamp: new Date().toISOString() }, req);
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordHttpRequest(req.method, "/health", statusCode, duration);
    return;
  }

  /** 워커 상태 수집 */
  let embeddingRunning  = "unknown";
  let evaluatorRunning  = "unknown";

  try {
    const ew = workerRefs.embeddingWorkerRef?.current;
    if (ew) embeddingRunning = !!ew.running;
  } catch { /* 접근 불가 시 unknown 유지 */ }

  try {
    const ev = getMemoryEvaluator();
    if (ev) evaluatorRunning = !!ev.running;
  } catch { /* 접근 불가 시 unknown 유지 */ }

  /** 인증된 요청 — 상세 정보 포함 */
  const health = {
    status,
    timestamp: new Date().toISOString(),
    uptime:    process.uptime(),
    pid:       process.pid,
    workerId:  process.env.WORKER_ID || "single",
    memory:    process.memoryUsage(),
    services:  {
      database: dbHealthy
        ? { status: "up", latency_ms: dbLatencyMs, pool: poolStats }
        : { status: "down", error: "Connection failed" },
      redis: redisStatus === "disabled"
        ? { status: "disabled" }
        : redisStatus === "up"
          ? { status: "up", latency_ms: redisLatencyMs }
          : { status: "down", error: redisError },
      pgvector: pgvectorVersion
        ? { status: pgvectorStatus, version: pgvectorVersion }
        : { status: pgvectorStatus }
    },
    workers: {
      embedding:    { running: embeddingRunning },
      evaluator:    { running: evaluatorRunning },
      consolidator: { last_run: workerRefs.lastConsolidateRun || null }
    },
    checks: {}
  };

  /** 하위 호환: checks 필드 유지 */
  health.checks.database = health.services.database;
  health.checks.redis    = health.services.redis;

  if (redisStatus === "down") {
    health.warnings = health.warnings || [];
    health.warnings.push("Redis unavailable — L1 cache and working memory disabled");
  }

  const _sc = getSessionCounts();
  health.checks.sessions = {
    streamable: _sc.streamable,
    legacy:     _sc.legacy,
    total:      _sc.total
  };

  await sendJSON(res, statusCode, health, req);

  const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
  recordHttpRequest(req.method, "/health", statusCode, duration);
}

/**
 * GET /metrics
 * ACCESS_KEY 설정 시 마스터 키 인증 필수
 */
export async function handleMetrics(req, res, startTime) {
  if (ACCESS_KEY && !validateMasterKey(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Unauthorized" }));
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordHttpRequest(req.method, "/metrics", 401, duration);
    return;
  }

  try {
    res.statusCode = 200;
    res.setHeader("Content-Type", metricsRegister.contentType);
    res.end(await metricsRegister.metrics());

    const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
    recordHttpRequest(req.method, "/metrics", 200, duration);
  } catch (err) {
    logError("[Metrics] Error generating metrics:", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
}

/**
 * POST /mcp (Streamable HTTP)
 */
export async function handleMcpPost(req, res, startTime, rateLimiter) {
  res.setHeader("Access-Control-Allow-Origin", getAllowedOrigin(req));
  res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
                || req.socket.remoteAddress
                || "unknown";

  let sessionId             = req.headers["mcp-session-id"] || new URL(req.url || "/", "http://localhost").searchParams.get("sessionId") || new URL(req.url || "/", "http://localhost").searchParams.get("mcp-session-id");
  let sessionKeyId          = null;
  let sessionGroupKeyIds    = null;
  let sessionPermissions    = null;
  let sessionDefaultWorkspace = null;
  let msg;

  try {
    msg = await readJsonBody(req);
  } catch (err) {
    if (err.statusCode === 413) {
      await sendJSON(res, 413, jsonRpcError(null, -32000, "Payload too large"), req);
      return;
    }
    await sendJSON(res, 400, jsonRpcError(null, -32700, "Parse error"), req);
    return;
  }

  if (sessionId) {
    const validation = await validateStreamableSession(sessionId);

    if (!validation.valid) {
      /** Session not found / expired 시 인증 유효 여부 확인 후 자동 복구 */
      const isRecoverable = validation.reason === "Session not found"
                         || validation.reason === "Session expired";
      if (isRecoverable) {
        const authResult = await validateAuthentication(req, msg);
        if (authResult.valid) {
          sessionKeyId          = authResult.keyId ?? null;
          sessionGroupKeyIds    = authResult.groupKeyIds ?? null;
          sessionPermissions    = authResult.permissions ?? null;
          sessionDefaultWorkspace = authResult.defaultWorkspace ?? null;
          sessionId             = await createStreamableSession(
            true,
            sessionKeyId,
            sessionGroupKeyIds,
            sessionPermissions,
            sessionDefaultWorkspace
          );
          logInfo(`[Streamable] Session auto-recovered (${validation.reason}): ${sessionId} (keyId: ${authResult.keyId ?? "master"})`);
        } else {
          await sendJSON(res, 400, jsonRpcError(null, -32000, validation.reason), req);
          return;
        }
      } else {
        await sendJSON(res, 400, jsonRpcError(null, -32000, validation.reason), req);
        return;
      }
    } else {
      const session  = validation.session;
      sessionKeyId          = session.keyId ?? null;
      sessionGroupKeyIds    = session.groupKeyIds ?? null;
      sessionPermissions    = session.permissions ?? null;
      sessionDefaultWorkspace = session.defaultWorkspace ?? null;

      if (!session.authenticated) {
        if (!await requireAuthentication(req, res, msg, null)) {
          return;
        }
        session.authenticated = true;
      }
    }
  }

  if (!sessionId && isInitializeRequest(msg)) {
    const authCheck = await validateAuthentication(req, msg);

    if (!authCheck.valid) {
      const proto   = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
      const baseUrl = `${proto}://${req.headers.host || "localhost:57332"}`;
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("WWW-Authenticate",
        `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`);
      res.end(JSON.stringify(jsonRpcError(msg.id ?? null, -32000, authCheck.error)));
      return;
    }

    sessionKeyId          = authCheck.keyId ?? null;
    sessionGroupKeyIds    = authCheck.groupKeyIds ?? null;
    sessionPermissions    = authCheck.permissions ?? null;
    sessionDefaultWorkspace = authCheck.defaultWorkspace ?? null;
    sessionId             = await createStreamableSession(true, sessionKeyId, sessionGroupKeyIds, sessionPermissions, sessionDefaultWorkspace);
    logInfo(`[Streamable] Authenticated session created: ${sessionId}${sessionKeyId ? ` (keyId: ${sessionKeyId})` : " (master)"}`);
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

  /** Rate Limit: keyId 있으면 키 기반, 없으면 IP 기반 */
  if (!rateLimiter.allow(clientIp, sessionKeyId)) {
    res.writeHead(429, { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
    res.end(JSON.stringify(jsonRpcError(null, -32000, "Too many requests")));
    return;
  }

  if (msg.method === "tools/call" && msg.params?.arguments) {
    msg.params.arguments._sessionId         = sessionId;
    msg.params.arguments._keyId             = sessionKeyId;
    msg.params.arguments._groupKeyIds       = sessionGroupKeyIds;
    msg.params.arguments._permissions       = sessionPermissions;
    msg.params.arguments._defaultWorkspace  = sessionDefaultWorkspace;
  }

  if (msg.method === "resources/read" && msg.params) {
    msg.params._keyId       = sessionKeyId;
    msg.params._groupKeyIds = sessionGroupKeyIds;
  }

  const { kind, response } = await dispatchJsonRpc(msg, { keyId: sessionKeyId });

  if (kind === "accepted") {
    res.statusCode = 202;
    res.setHeader("MCP-Session-Id", sessionId);
    res.end();
    return;
  }

  res.setHeader("MCP-Session-Id", sessionId);
  await sendJSON(res, 200, response, req);

  const duration = Number(process.hrtime.bigint() - startTime) / 1e9;
  recordHttpRequest(req.method, "/mcp", 200, duration);
}

/**
 * GET /mcp (Streamable HTTP SSE)
 */
export async function handleMcpGet(req, res) {
  res.setHeader("Access-Control-Allow-Origin", getAllowedOrigin(req));
  res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

  const url       = new URL(req.url || "/", "http://localhost");
  const sessionId = req.headers["mcp-session-id"] || url.searchParams.get("sessionId") || url.searchParams.get("mcp-session-id");

  if (!sessionId) {
    res.statusCode = 400;
    res.end("Missing session ID");
    return;
  }

  const validation = await validateStreamableSession(sessionId);

  if (!validation.valid) {
    res.statusCode = 400;
    res.end(validation.reason);
    return;
  }

  const session = validation.session;

  if (!session.authenticated) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("MCP-Session-Id", sessionId);

  session.setSseResponse(res);

  req.on("close", () => {
    /** SSE 연결 종료 — 세션은 유지, SSE 응답 및 heartbeat만 해제 */
    session.setSseResponse(null);
    logInfo(`[Streamable] SSE closed, session preserved: ${sessionId?.slice(0, 8)}...`);
  });
}

/**
 * DELETE /mcp (Streamable HTTP)
 */
export async function handleMcpDelete(req, res) {
  res.setHeader("Access-Control-Allow-Origin", getAllowedOrigin(req));
  res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

  const url       = new URL(req.url || "/", "http://localhost");
  const sessionId = req.headers["mcp-session-id"] || url.searchParams.get("sessionId") || url.searchParams.get("mcp-session-id");

  if (!sessionId) {
    res.statusCode = 400;
    res.end("Missing session ID");
    return;
  }

  const validation = await validateStreamableSession(sessionId);

  if (!validation.valid) {
    res.statusCode = 400;
    res.end(validation.reason);
    return;
  }

  /** 인증 검사 — 미인증 요청 차단 */
  const authResult = await validateAuthentication(req, null);
  if (!authResult.valid) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  /** keyId 비교 — master key(keyId=null)는 모든 세션 종료 허용 */
  const sessionKeyId  = validation.session.keyId ?? null;
  const requesterKeyId = authResult.keyId ?? null;
  if (requesterKeyId !== null && requesterKeyId !== sessionKeyId) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  await closeStreamableSession(sessionId);
  logInfo(`[Streamable] Session deleted: ${sessionId}`);

  res.statusCode = 200;
  res.end();
}

/**
 * GET /sse (Legacy SSE)
 * Bearer 헤더 우선, 쿼리스트링 fallback (safeCompare 적용)
 */
export async function handleLegacySseGet(req, res) {
  const url = new URL(req.url || "/", "http://localhost");

  let isAuthenticated  = false;
  let keyId            = null;
  let groupKeyIds      = null;
  let permissions      = null;
  let defaultWorkspace = null;

  if (!ACCESS_KEY) {
    isAuthenticated = true;
  } else {
    /** 1. Authorization Bearer 헤더 우선 */
    const authResult = await validateAuthentication(req, null);
    if (authResult.valid) {
      isAuthenticated  = true;
      keyId            = authResult.keyId || null;
      groupKeyIds      = authResult.groupKeyIds ?? null;
      permissions      = authResult.permissions ?? null;
      defaultWorkspace = authResult.defaultWorkspace ?? null;
    } else {
      /** 2. 쿼리스트링 fallback (하위 호환) — safeCompare 적용 */
      const rawKey    = url.searchParams.get("accessKey") || "";
      let accessKey   = rawKey;
      try { accessKey = decodeURIComponent(rawKey); } catch { /* 디코딩 실패 시 원본 사용 */ }

      if (accessKey && safeCompare(accessKey, ACCESS_KEY)) {
        isAuthenticated = true;
        logWarn("[Legacy SSE] Query string authentication used. Prefer Authorization header.");
      }
    }
  }

  if (!isAuthenticated) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const sessionId = createLegacySseSession(res);
  const session   = getLegacySession(sessionId);
  session.authenticated    = isAuthenticated;
  session._keyId           = keyId;
  session._groupKeyIds     = groupKeyIds;
  session._permissions     = permissions;
  session._defaultWorkspace = defaultWorkspace;

  logInfo(`[Legacy SSE] Session created: ${sessionId}`);

  sseWrite(res, "endpoint", `/message?sessionId=${encodeURIComponent(sessionId)}`);

  req.on("close", () => {
    logInfo(`[Legacy SSE] Session closed: ${sessionId}`);
    closeLegacySseSession(sessionId);
  });
}

/**
 * POST /message (Legacy SSE)
 */
export async function handleLegacySsePost(req, res) {
  const url       = new URL(req.url || "/", "http://localhost");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    res.statusCode = 400;
    res.end("Missing session ID");
    return;
  }

  const validation = validateLegacySseSession(sessionId);

  if (!validation.valid) {
    res.statusCode = 404;
    res.end(validation.reason);
    return;
  }

  const session = validation.session;

  if (!session.authenticated) {
    res.statusCode = 401;
    res.end("Unauthorized");
    return;
  }

  let msg;
  try {
    msg = await readJsonBody(req);
  } catch (err) {
    if (err.statusCode === 413) {
      res.statusCode = 413;
      res.end("Payload too large");
      return;
    }
    res.statusCode = 400;
    res.end("Invalid JSON");
    return;
  }

  if (msg.method === "tools/call" && msg.params?.arguments) {
    msg.params.arguments._sessionId         = sessionId;
    msg.params.arguments._keyId             = session._keyId ?? null;
    msg.params.arguments._groupKeyIds       = session._groupKeyIds ?? null;
    msg.params.arguments._permissions       = session._permissions ?? null;
    msg.params.arguments._defaultWorkspace  = session._defaultWorkspace ?? null;
  }

  const { kind, response } = await dispatchJsonRpc(msg, { keyId: session._keyId ?? null });

  if (kind === "ok" || kind === "error") {
    sseWrite(session.res, "message", response);
  }

  res.statusCode = 202;
  res.end();
}

/**
 * GET /.well-known/oauth-authorization-server
 */
export async function handleOAuthServerMetadata(req, res) {
  const proto      = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const baseUrl    = `${proto}://${req.headers.host || "localhost:57332"}`;
  const metadata   = getAuthServerMetadata(baseUrl);
  res.setHeader("Access-Control-Allow-Origin", "*");
  await sendJSON(res, 200, metadata, req);
}

/**
 * GET /.well-known/oauth-protected-resource
 */
export async function handleOAuthResourceMetadata(req, res) {
  const proto      = req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http");
  const baseUrl    = `${proto}://${req.headers.host || "localhost:57332"}`;
  const metadata   = getResourceMetadata(baseUrl);
  res.setHeader("Access-Control-Allow-Origin", "*");
  await sendJSON(res, 200, metadata, req);
}

/**
 * POST /register (RFC 7591 Dynamic Client Registration)
 */
export async function handleOAuthRegister(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  let body;
  try {
    const rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
    body = JSON.parse(rawBody);
  } catch {
    await sendJSON(res, 400, { error: "invalid_client_metadata", error_description: "Invalid JSON body" }, req);
    return;
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || !redirectUris.length) {
    await sendJSON(res, 400, { error: "invalid_client_metadata", error_description: "redirect_uris is required" }, req);
    return;
  }

  try {
    const client = await registerClient({
      client_name  : body.client_name || null,
      redirect_uris: redirectUris,
      scope        : body.scope || "mcp",
      client_uri   : body.client_uri || null,
      logo_uri     : body.logo_uri || null,
    });

    await sendJSON(res, 201, {
      client_id                 : client.client_id,
      client_name               : client.client_name,
      redirect_uris             : client.redirect_uris,
      grant_types               : client.grant_types,
      response_types            : client.response_types,
      scope                     : client.scope,
      token_endpoint_auth_method: "none",
    }, req);
  } catch (err) {
    logError("[OAuth] register error:", err);
    await sendJSON(res, 500, { error: "server_error" }, req);
  }
}

/**
 * GET /authorize (OAuth 2.0) — 동의 화면 표시
 * POST /authorize (OAuth 2.0) — 동의 결과 처리
 */
export async function handleOAuthAuthorize(req, res) {
  if (req.method === "POST") {
    /** POST: 동의 화면 폼 제출 처리 */
    const rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
    const formData = new URLSearchParams(rawBody);
    const params = {
      response_type        : formData.get("response_type"),
      client_id            : formData.get("client_id"),
      redirect_uri         : formData.get("redirect_uri"),
      code_challenge       : formData.get("code_challenge"),
      code_challenge_method: formData.get("code_challenge_method"),
      state                : formData.get("state"),
      scope                : formData.get("scope"),
    };

    const decision = formData.get("decision");
    if (decision === "deny") {
      const errorUrl = new URL(params.redirect_uri);
      errorUrl.searchParams.set("error", "access_denied");
      errorUrl.searchParams.set("error_description", "User denied access");
      if (params.state) errorUrl.searchParams.set("state", params.state);
      res.statusCode = 302;
      res.setHeader("Location", errorUrl.toString());
      res.end();
      return;
    }

    /** decision === "allow": 인증 코드 발급 */
    const result = await handleAuthorize(params);

    if (result.error) {
      if (params.redirect_uri) {
        const errorUrl = new URL(params.redirect_uri);
        errorUrl.searchParams.set("error", result.error);
        errorUrl.searchParams.set("error_description", result.error_description);
        if (params.state) errorUrl.searchParams.set("state", params.state);
        res.statusCode = 302;
        res.setHeader("Location", errorUrl.toString());
        res.end();
      } else {
        await sendJSON(res, 400, result, req);
      }
      return;
    }

    res.statusCode = 302;
    res.setHeader("Location", result.redirect);
    res.end();
    return;
  }

  /** GET: 동의 화면 표시 */
  const url    = new URL(req.url || "/", "http://localhost");
  const params = {
    response_type        : url.searchParams.get("response_type"),
    client_id            : url.searchParams.get("client_id"),
    redirect_uri         : url.searchParams.get("redirect_uri"),
    code_challenge       : url.searchParams.get("code_challenge"),
    code_challenge_method: url.searchParams.get("code_challenge_method"),
    state                : url.searchParams.get("state"),
    scope                : url.searchParams.get("scope")
  };

  const clientId    = params.client_id;
  let   clientName  = "An application";
  const { getClient: getOAuthClient } = await import("./admin/OAuthClientStore.js");
  const isAccessKey = ACCESS_KEY && safeCompare(clientId || "", ACCESS_KEY);

  if (!isAccessKey) {
    let client = await getOAuthClient(clientId);
    if (!client && params.redirect_uri) {
      /** 미등록 client_id → redirect_uri가 허용 목록에 있으면 자동 등록 */
      const { registerClient } = await import("./admin/OAuthClientStore.js");
      const { isAllowedRedirectUri } = await import("./oauth.js");
      if (isAllowedRedirectUri(params.redirect_uri)) {
        try {
          const { logInfo } = await import("./logger.js");
          logInfo(`[OAuth] Auto-registering client: ${clientId} with redirect_uri: ${params.redirect_uri}`);
          await registerClient({
            client_id:     clientId,
            client_name:   clientId,
            redirect_uris: [params.redirect_uri],
            scope:         params.scope || "mcp",
          });
          client = { client_name: clientId, redirect_uris: [params.redirect_uri] };
        } catch (regErr) {
          const { logError: logErr } = await import("./logger.js");
          logErr("[OAuth] Auto-register failed:", regErr);
        }
      }
    }
    if (!client) {
      if (params.redirect_uri) {
        const errorUrl = new URL(params.redirect_uri);
        errorUrl.searchParams.set("error", "invalid_client");
        errorUrl.searchParams.set("error_description", "Invalid client_id");
        if (params.state) errorUrl.searchParams.set("state", params.state);
        res.statusCode = 302;
        res.setHeader("Location", errorUrl.toString());
        res.end();
      } else {
        await sendJSON(res, 400, { error: "invalid_client", error_description: "Invalid client_id" }, req);
      }
      return;
    }
    clientName = client.client_name || clientId;
  } else {
    clientName = "Master Key Client";
  }

  /** redirect_uri가 허용 목록에 있으면 자동 승인 (신뢰된 클라이언트) */
  const { isAllowedRedirectUri: isAllowed } = await import("./oauth.js");
  if (isAllowed(params.redirect_uri)) {
    const result = await handleAuthorize(params);
    if (result.redirect) {
      res.statusCode = 302;
      res.setHeader("Location", result.redirect);
      res.end();
      return;
    }
  }

  const html = buildConsentHtml(params, clientName);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

/**
 * POST /token (OAuth 2.0)
 */
export async function handleOAuthToken(req, res) {
  let body;
  try {
    const rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });

    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/json")) {
      body = JSON.parse(rawBody);
    } else {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    }
  } catch {
    await sendJSON(res, 400, { error: "invalid_request", error_description: "Failed to parse request body" }, req);
    return;
  }

  const result = await handleToken(body);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { success, ...tokenResponse } = result;
  await sendJSON(res, result.error ? 400 : 200, tokenResponse, req);
}

