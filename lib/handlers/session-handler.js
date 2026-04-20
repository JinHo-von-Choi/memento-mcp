/**
 * 세션 관리 HTTP 핸들러
 * - POST /session/rotate
 *
 * 작성자: 최진호
 * 작성일: 2026-04-20
 */

import { sendJSON }              from "../compression.js";
import { validateAuthentication } from "../auth.js";
import { rotateSession }          from "../sessions.js";
import { readJsonBody }           from "../utils.js";
import { logInfo, logError }      from "../logger.js";
import { isOriginAllowed }        from "./_common.js";

/**
 * POST /session/rotate
 *
 * 현재 세션을 종료하고 동일한 인증 컨텍스트를 이어받은 신규 세션을 발급한다.
 * 세션 고정 공격(Session Fixation) 방지 목적의 명시적 교체 엔드포인트.
 *
 * 요청:
 *   Authorization: Bearer <token>
 *   Mcp-Session-Id: <sessionId>
 *   Content-Type: application/json
 *   Body: { "reason"?: string }  (optional)
 *
 * 응답 200:
 *   { "oldSessionId": string, "newSessionId": string, "expiresAt": number, "reason": string }
 *
 * 오류:
 *   401 — 인증 실패 또는 세션 만료
 *   403 — Origin 차단 (MCP_STRICT_ORIGIN=true 시)
 *   404 — 세션을 찾을 수 없음
 *   500 — 서버 내부 오류
 */
export async function handleSessionRotate(req, res) {
  /** Origin 검증 (MCP_STRICT_ORIGIN=true 시 적용, 기본 비활성) */
  if (!isOriginAllowed(req)) {
    const originVal = req.headers.origin || "unknown";
    logInfo(`[Session/Rotate] Origin rejected: ${originVal}`);
    await sendJSON(res, 403, { error: "forbidden", error_description: "Origin not allowed" }, req);
    return;
  }

  /** 인증 검증 */
  const auth = await validateAuthentication(req, null);
  if (!auth.valid) {
    await sendJSON(res, 401, { error: "unauthorized", error_description: "Valid Bearer token required" }, req);
    return;
  }

  /** 세션 ID 추출 */
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId) {
    await sendJSON(res, 400, { error: "bad_request", error_description: "Mcp-Session-Id header is required" }, req);
    return;
  }

  /** 요청 본문 파싱 (reason 옵션) */
  let reason = "explicit_rotate";
  try {
    const body = await readJsonBody(req);
    if (body && typeof body.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 128);
    }
  } catch {
    /** 본문 없거나 파싱 실패 시 기본값 유지 */
  }

  logInfo(`[Session/Rotate] sessionId=${sessionId.slice(0, 8)}... keyId=${auth.keyId ?? "master"} reason=${reason}`);

  try {
    const result = await rotateSession(sessionId, { reason });
    await sendJSON(res, 200, {
      oldSessionId: result.oldSessionId,
      newSessionId: result.newSessionId,
      expiresAt:    result.expiresAt,
      reason
    }, req);
  } catch (err) {
    const statusCode = err.statusCode ?? 500;

    if (statusCode === 404) {
      await sendJSON(res, 404, { error: "not_found", error_description: "Session not found" }, req);
      return;
    }

    if (statusCode === 401) {
      await sendJSON(res, 401, { error: "session_expired", error_description: "Session has expired" }, req);
      return;
    }

    logError("[Session/Rotate] Unexpected error:", err);
    await sendJSON(res, 500, { error: "server_error", error_description: "Failed to rotate session" }, req);
  }
}
