/**
 * 유틸리티 함수
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 */

import fs                from "fs";
import { promises as fsp } from "fs";
import path              from "path";
import { DOCS_ROOT, LOG_DIR, ALLOWED_ORIGINS } from "./config.js";
import { validateAndNormalizePath, validateFileExtension, validateFileName } from "./path-validator.js";

/**
 * 안전한 경로 확인 (Path Traversal 방지)
 * 내부적으로 validateAndNormalizePath를 사용
 */
export function resolveSafePath(relativePath) {
  return validateAndNormalizePath(relativePath);
}

export { validateAndNormalizePath, validateFileExtension, validateFileName };

/**
 * 마크다운 파일 목록 조회 (재귀)
 */
export async function listMarkdownFiles(dir, base = "") {
  let results            = [];
  const entries            = await fsp.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath        = path.join(dir, entry.name);
    const relativePath     = path.join(base, entry.name);

    if (entry.isDirectory()) {
      const subResults     = await listMarkdownFiles(entryPath, relativePath);
      results            = results.concat(subResults);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      const stat           = await fsp.stat(entryPath);

      results.push({
        path : relativePath,
        size : stat.size,
        mtime: stat.mtime.toISOString()
      });
    }
  }

  return results;
}

/**
 * SSE 메시지 작성
 */
export function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

/**
 * JSON Body 읽기
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body               = "";
    req.on("data", (chunk) => {
      body                += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "null"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
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

/**
 * 감사 로그 기록 (기억 도구 상태 변경 작업 추적)
 * 형식: timestamp | operation | topic | type | fragmentId | success | details
 */
export async function logAudit(operation, { topic, type, fragmentId, success, details } = {}) {
  const timestamp          = new Date().toISOString();
  const logEntry           = `${[
    timestamp,
    operation,
    topic      || "-",
    type       || "-",
    fragmentId || "-",
    success    === false ? "FAIL" : "OK",
    details    || ""
  ].join(" | ")  }\n`;

  try {
    await fsp.mkdir(LOG_DIR, { recursive: true });
    const logFile          = path.join(LOG_DIR, `audit-${new Date().toISOString().split("T")[0]}.log`);
    await fsp.appendFile(logFile, logEntry);
  } catch (err) {
    console.error("[Audit] Failed to write audit log:", err);
  }
}

/**
 * 액세스 로그 기록
 */
export async function logAccess(method, reqPath, sessionId, statusCode, responseTime) {
  const timestamp          = new Date().toISOString();
  const logEntry           = `${timestamp} | ${method} | ${reqPath} | ${sessionId || "N/A"} | ${statusCode} | ${responseTime}ms\n`;

  try {
    await fsp.mkdir(LOG_DIR, { recursive: true });
    const logFile          = path.join(LOG_DIR, `access-${new Date().toISOString().split("T")[0]}.log`);
    await fsp.appendFile(logFile, logEntry);
  } catch (err) {
    console.error("[Log] Failed to write access log:", err);
  }
}
