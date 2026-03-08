/**
 * HTTP 스트림 / 요청 헬퍼
 *
 * 작성자: 최진호
 * 작성일: 2026-03-09
 */

import { ALLOWED_ORIGINS } from "../config.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * SSE 메시지 작성
 */
export function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

/**
 * JSON Body 읽기 (2MB 상한)
 */
export function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size               = 0;
    let rejected           = false;
    const chunks           = [];

    req.on("data", (chunk) => {
      if (rejected) return;
      size                += chunk.length;
      if (size > maxBytes) {
        rejected           = true;
        req.removeAllListeners("data");
        req.resume();
        const err          = new Error("Payload too large");
        err.statusCode     = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        const body         = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(body || "null"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (err) => {
      if (!rejected) reject(err);
    });
  });
}

/**
 * Origin 검증
 * ALLOWED_ORIGINS 미설정(빈 Set) 시 모든 Origin 허용
 * 설정된 경우 화이트리스트 방식으로 검증
 */
export function validateOrigin(req, res) {
  const origin              = req.headers.origin;

  if (!origin) {
    return true;
  }

  /** ALLOWED_ORIGINS 미설정 시 모든 Origin 허용 (MCP 클라이언트 호환성) */
  if (ALLOWED_ORIGINS.size === 0) {
    return true;
  }

  if (!ALLOWED_ORIGINS.has(String(origin))) {
    res.statusCode         = 403;
    res.end("Forbidden (Origin not allowed)");
    return false;
  }

  return true;
}
