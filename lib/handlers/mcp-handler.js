/**
 * POST /mcp + GET /mcp + DELETE /mcp 핸들러 (Streamable HTTP)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-04
 */

import { ACCESS_KEY, PORT, RATE_LIMIT_WINDOW_MS } from "../config.js";
import { recordHttpRequest } from "../metrics.js";
import { readJsonBody } from "../utils.js";
import { sendJSON } from "../compression.js";
import {
  createStreamableSession,
  validateStreamableSession,
  closeStreamableSession
} from "../sessions.js";
import { isInitializeRequest, requireAuthentication, validateAuthentication } from "../auth.js";
import { logInfo } from "../logger.js";
import { jsonRpcError, dispatchJsonRpc } from "../jsonrpc.js";
import { getAllowedOrigin } from "./_common.js";

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
      const baseUrl = `${proto}://${req.headers.host || `localhost:${PORT}`}`;
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
  const sessionKeyId   = validation.session.keyId ?? null;
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
