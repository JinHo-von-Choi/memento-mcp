/**
 * 인증 로직
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 */

import { timingSafeEqual, createHash } from "node:crypto";
import { ACCESS_KEY } from "./config.js";
import { validateAccessToken } from "./oauth.js";
import {
  validateApiKeyFromDB,
  incrementUsage
} from "./admin/ApiKeyStore.js";

/**
 * 타이밍 안전 문자열 비교 (Timing Attack 방지)
 * SHA-256 해시 후 timingSafeEqual 비교 (length early-return 없음)
 */
export function safeCompare(a, b) {
  const hashA = createHash("sha256").update(String(a)).digest();
  const hashB = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * JSON-RPC 에러 응답 생성 (인증용)
 */
function authJsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error : { code, message }
  };
}

/**
 * initialize 요청 여부 확인
 */
export function isInitializeRequest(msg) {
  return msg && typeof msg === "object" && msg.method === "initialize";
}

/**
 * 인증 검증
 * 우선순위:
 * 1. MEMENTO_ACCESS_KEY 헤더
 * 2. Authorization: Bearer <key> 헤더 (ACCESS_KEY 또는 OAuth 토큰)
 * 3. initialize 요청의 params.accessKey
 */
export async function validateAuthentication(req, msg) {
  if (!ACCESS_KEY) {
    return { valid: true };
  }

  /** 1. MEMENTO_ACCESS_KEY 헤더 체크 */
  const nerdvanaKey        = req.headers["memento-access-key"];

  if (nerdvanaKey && safeCompare(nerdvanaKey, ACCESS_KEY)) {
    return { valid: true };
  }

  /** 2. Authorization 헤더 체크 */
  const authHeader         = req.headers.authorization;

  if (authHeader) {
    const match            = authHeader.match(/^Bearer\s+(.+)$/i);

    if (match) {
      const token          = match[1];

      /** ACCESS_KEY 직접 비교 */
      if (safeCompare(token, ACCESS_KEY)) {
        return { valid: true };
      }

      /** OAuth 토큰 검증 */
      const oauthResult    = await validateAccessToken(token);
      if (oauthResult.valid) {
        return { valid: true, oauth: true, client_id: oauthResult.client_id };
      }

      /** DB API 키 검증 (fallback — 마스터 키/OAuth 모두 실패 시) */
      try {
        const dbResult     = await validateApiKeyFromDB(token);
        if (dbResult.valid) {
          incrementUsage(dbResult.keyId);
          return { valid: true, keyId: dbResult.keyId, permissions: dbResult.permissions };
        }
      } catch (dbErr) {
        console.warn("[Auth] DB key check error:", dbErr.message);
      }
    }
  }

  /** 3. initialize 요청의 params.accessKey 체크 */
  if (msg && isInitializeRequest(msg)) {
    const accessKey        = msg.params?.accessKey;

    if (accessKey && safeCompare(accessKey, ACCESS_KEY)) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    error: "Invalid or missing access key"
  };
}

/**
 * 마스터 키 전용 동기 검증 (admin 라우트용)
 * DB API 키는 포함하지 않음 — 환경변수 ACCESS_KEY만 허용
 *
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function validateMasterKey(req) {
  if (!ACCESS_KEY) return true;

  const auth           = req.headers.authorization;
  if (!auth) return false;

  const match          = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  return safeCompare(match[1], ACCESS_KEY);
}

/**
 * 인증 필수 검증 (통합 헬퍼)
 * 인증 실패 시 응답 전송 및 false 반환
 */
export async function requireAuthentication(req, res, msg = null, msgId = null) {
  const authCheck          = await validateAuthentication(req, msg);

  if (!authCheck.valid) {
    res.statusCode       = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(authJsonRpcError(msgId, -32000, authCheck.error)));
    return false;
  }

  return true;
}
