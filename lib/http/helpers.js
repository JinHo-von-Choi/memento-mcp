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
 * Raw Body 읽기 (2MB 상한) — JSON 파싱 없이 문자열 반환
 */
export function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
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
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!rejected) reject(err);
    });
  });
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
 * Origin 검증 (fail-closed)
 * Origin 헤더가 없으면 비브라우저 클라이언트(curl, 네이티브 HTTP)로 간주하여 허용.
 * Origin 헤더가 존재하는 경우:
 *   - ALLOWED_ORIGINS 설정 시: 화이트리스트 일치 여부 확인
 *   - ALLOWED_ORIGINS 미설정(빈 Set) 시: same-origin(host 헤더 일치)만 허용
 */
export function validateOrigin(req, res) {
  const origin              = req.headers.origin;

  if (!origin) {
    return true;
  }

  if (ALLOWED_ORIGINS.size > 0) {
    if (!ALLOWED_ORIGINS.has(String(origin))) {
      res.statusCode       = 403;
      res.end("Forbidden (Origin not allowed)");
      return false;
    }
    return true;
  }

  /** ALLOWED_ORIGINS 미설정 시 same-origin(host 헤더 일치)만 허용 */
  const host                = req.headers.host;
  const originHost          = (() => {
    try { return new URL(String(origin)).host; } catch { return null; }
  })();

  if (!host || !originHost || originHost !== host) {
    res.statusCode           = 403;
    res.end("Forbidden (Origin not allowed)");
    return false;
  }

  return true;
}
