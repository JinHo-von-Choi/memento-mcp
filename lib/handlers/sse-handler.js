/**
 * GET /sse + POST /message 핸들러 (Legacy SSE)
 *
 * 작성자: 최진호
 * 작성일: 2026-04-04
 */

import { ACCESS_KEY } from "../config.js";
import { readJsonBody, sseWrite } from "../utils.js";
import {
  createLegacySseSession,
  validateLegacySseSession,
  closeLegacySseSession,
  getLegacySession
} from "../sessions.js";
import { validateAuthentication, safeCompare } from "../auth.js";
import { logInfo, logWarn } from "../logger.js";
import { jsonRpcError, dispatchJsonRpc } from "../jsonrpc.js";

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
  session.authenticated     = isAuthenticated;
  session._keyId            = keyId;
  session._groupKeyIds      = groupKeyIds;
  session._permissions      = permissions;
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
