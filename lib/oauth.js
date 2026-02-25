/**
 * OAuth 2.0 + PKCE 인증 모듈
 *
 * 작성자: 최진호
 * 작성일: 2026-01-30
 * 수정일: 2026-02-13 (Redis 통합)
 *
 * MCP 프로토콜 사양에 따른 OAuth 2.1 구현
 * - RFC8414: Authorization Server Metadata
 * - RFC9728: Protected Resource Metadata
 * - PKCE (RFC7636)
 */

import crypto from "crypto";
import { ACCESS_KEY, REDIS_ENABLED } from "./config.js";
import {
  saveOAuthCode,
  consumeOAuthCode,
  saveOAuthToken,
  getOAuthToken,
  deleteOAuthToken
} from "./redis.js";

/** 인증 코드 저장소 (메모리 - fallback) */
const authCodes         = new Map();

/** 액세스 토큰 저장소 (메모리 - fallback) */
const accessTokens      = new Map();

/** 코드/토큰 만료 시간 */
const CODE_TTL_MS       = 10 * 60 * 1000;
const CODE_TTL_SECONDS  = 600;
const TOKEN_TTL_MS      = 60 * 60 * 1000;
const TOKEN_TTL_SECONDS = 3600;
const REFRESH_TTL_SECONDS = 86400;

/**
 * Base64URL 인코딩
 */
function base64UrlEncode(buffer) {
  return buffer.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Base64URL 디코딩
 */
function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  return Buffer.from(str, "base64");
}

/**
 * PKCE code_challenge 검증 (S256)
 */
function verifyCodeChallenge(codeVerifier, codeChallenge) {
  const hash     = crypto.createHash("sha256").update(codeVerifier).digest();
  const computed = base64UrlEncode(hash);
  return computed === codeChallenge;
}

/**
 * 랜덤 문자열 생성
 */
function generateRandomString(length = 32) {
  return base64UrlEncode(crypto.randomBytes(length));
}

/**
 * Authorization Server Metadata (RFC8414)
 */
export function getAuthServerMetadata(baseUrl) {
  return {
    issuer                                    : baseUrl,
    authorization_endpoint                    : `${baseUrl}/authorize`,
    token_endpoint                            : `${baseUrl}/token`,
    response_types_supported                  : ["code"],
    grant_types_supported                     : ["authorization_code", "refresh_token"],
    code_challenge_methods_supported          : ["S256"],
    token_endpoint_auth_methods_supported     : ["none", "client_secret_post"],
    scopes_supported                          : ["claudeai", "mcp"],
    service_documentation                     : `${baseUrl}/docs`
  };
}

/**
 * Protected Resource Metadata (RFC9728)
 */
export function getResourceMetadata(baseUrl) {
  return {
    resource              : baseUrl,
    authorization_servers : [baseUrl],
    scopes_supported      : ["claudeai", "mcp"],
    bearer_methods_supported: ["header", "query"]
  };
}

/**
 * 인증 요청 처리 (GET /authorize)
 */
export async function handleAuthorize(params) {
  const {
    response_type,
    client_id,
    redirect_uri,
    code_challenge,
    code_challenge_method,
    state,
    scope
  } = params;

  /** 필수 파라미터 검증 */
  if (response_type !== "code") {
    return { success: false, error: "unsupported_response_type", error_description: "Only 'code' response type is supported" };
  }

  if (!redirect_uri) {
    return { success: false, error: "invalid_request", error_description: "redirect_uri is required" };
  }

  if (!code_challenge) {
    return { success: false, error: "invalid_request", error_description: "code_challenge is required (PKCE)" };
  }

  if (code_challenge_method !== "S256") {
    return { success: false, error: "invalid_request", error_description: "Only S256 code_challenge_method is supported" };
  }

  /** ACCESS_KEY 검증 (client_id로 전달된 경우) */
  if (ACCESS_KEY && client_id !== ACCESS_KEY) {
    console.log(`[OAuth] Invalid client_id: ${client_id?.substring(0, 10)}...`);
  }

  /** 인증 코드 생성 */
  const code = generateRandomString(32);

  const codeData = {
    client_id,
    redirect_uri,
    code_challenge,
    scope       : scope || "mcp",
    state,
    created_at  : Date.now(),
    expires_at  : Date.now() + CODE_TTL_MS
  };

  /** 코드 저장 (Redis 또는 메모리) */
  if (REDIS_ENABLED) {
    await saveOAuthCode(code, codeData, CODE_TTL_SECONDS);
  } else {
    authCodes.set(code, codeData);
  }

  console.log(`[OAuth] Authorization code issued for client: ${client_id?.substring(0, 20)}...`);

  /** 리다이렉트 URL 구성 */
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return {
    success    : true,
    code,
    redirectUri: redirect_uri,
    redirect   : redirectUrl.toString()
  };
}

/**
 * 토큰 요청 처리 (POST /token)
 */
export async function handleToken(params) {
  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    code_verifier,
    refresh_token
  } = params;

  /** Refresh Token 처리 */
  if (grant_type === "refresh_token") {
    if (!refresh_token) {
      return { success: false, error: "invalid_request", error_description: "refresh_token is required" };
    }

    let tokenData;
    if (REDIS_ENABLED) {
      tokenData = await getOAuthToken(refresh_token);
    } else {
      tokenData = accessTokens.get(refresh_token);
    }

    if (!tokenData || tokenData.type !== "refresh") {
      return { success: false, error: "invalid_grant", error_description: "Invalid refresh token" };
    }

    if (Date.now() > tokenData.expires_at) {
      if (REDIS_ENABLED) {
        await deleteOAuthToken(refresh_token);
      } else {
        accessTokens.delete(refresh_token);
      }
      return { success: false, error: "invalid_grant", error_description: "Refresh token expired" };
    }

    /** 새 액세스 토큰 발급 */
    const newAccessToken  = generateRandomString(32);
    const newRefreshToken = generateRandomString(32);

    const newAccessData = {
      type       : "access",
      client_id  : tokenData.client_id,
      scope      : tokenData.scope,
      created_at : Date.now(),
      expires_at : Date.now() + TOKEN_TTL_MS
    };

    const newRefreshData = {
      type       : "refresh",
      client_id  : tokenData.client_id,
      scope      : tokenData.scope,
      created_at : Date.now(),
      expires_at : Date.now() + TOKEN_TTL_MS * 24
    };

    if (REDIS_ENABLED) {
      await saveOAuthToken(newAccessToken, newAccessData, TOKEN_TTL_SECONDS);
      await saveOAuthToken(newRefreshToken, newRefreshData, REFRESH_TTL_SECONDS);
      await deleteOAuthToken(refresh_token);
    } else {
      accessTokens.set(newAccessToken, newAccessData);
      accessTokens.set(newRefreshToken, newRefreshData);
      accessTokens.delete(refresh_token);
    }

    return {
      success      : true,
      access_token : newAccessToken,
      token_type   : "Bearer",
      expires_in   : Math.floor(TOKEN_TTL_MS / 1000),
      refresh_token: newRefreshToken,
      scope        : tokenData.scope
    };
  }

  /** Authorization Code 처리 */
  if (grant_type !== "authorization_code") {
    return { success: false, error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported" };
  }

  if (!code) {
    return { success: false, error: "invalid_request", error_description: "code is required" };
  }

  if (!code_verifier) {
    return { success: false, error: "invalid_request", error_description: "code_verifier is required (PKCE)" };
  }

  /** 인증 코드 검증 및 소비 (일회용) */
  let codeData;
  if (REDIS_ENABLED) {
    codeData = await consumeOAuthCode(code);
  } else {
    codeData = authCodes.get(code);
    if (codeData) {
      authCodes.delete(code);
    }
  }

  if (!codeData) {
    return { success: false, error: "invalid_grant", error_description: "Invalid authorization code" };
  }

  /** 만료 확인 */
  if (Date.now() > codeData.expires_at) {
    return { success: false, error: "invalid_grant", error_description: "Authorization code expired" };
  }

  /** redirect_uri 검증 */
  if (codeData.redirect_uri !== redirect_uri) {
    return { success: false, error: "invalid_grant", error_description: "redirect_uri mismatch" };
  }

  /** PKCE 검증 */
  if (!verifyCodeChallenge(code_verifier, codeData.code_challenge)) {
    return { success: false, error: "invalid_grant", error_description: "code_verifier validation failed" };
  }

  /** 액세스 토큰 생성 */
  const accessToken  = generateRandomString(32);
  const refreshToken = generateRandomString(32);

  const accessData = {
    type       : "access",
    client_id  : codeData.client_id,
    scope      : codeData.scope,
    created_at : Date.now(),
    expires_at : Date.now() + TOKEN_TTL_MS
  };

  const refreshData = {
    type       : "refresh",
    client_id  : codeData.client_id,
    scope      : codeData.scope,
    created_at : Date.now(),
    expires_at : Date.now() + TOKEN_TTL_MS * 24
  };

  if (REDIS_ENABLED) {
    await saveOAuthToken(accessToken, accessData, TOKEN_TTL_SECONDS);
    await saveOAuthToken(refreshToken, refreshData, REFRESH_TTL_SECONDS);
  } else {
    accessTokens.set(accessToken, accessData);
    accessTokens.set(refreshToken, refreshData);
  }

  console.log(`[OAuth] Access token issued for client: ${codeData.client_id?.substring(0, 20)}...`);

  return {
    success      : true,
    access_token : accessToken,
    token_type   : "Bearer",
    expires_in   : Math.floor(TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope        : codeData.scope
  };
}

/**
 * 액세스 토큰 검증
 */
export async function validateAccessToken(token) {
  if (!token) {
    return { valid: false, reason: "No token provided" };
  }

  let tokenData;
  if (REDIS_ENABLED) {
    tokenData = await getOAuthToken(token);
  } else {
    tokenData = accessTokens.get(token);
  }

  if (!tokenData || tokenData.type !== "access") {
    return { valid: false, reason: "Invalid token" };
  }

  if (Date.now() > tokenData.expires_at) {
    if (REDIS_ENABLED) {
      await deleteOAuthToken(token);
    } else {
      accessTokens.delete(token);
    }
    return { valid: false, reason: "Token expired" };
  }

  return { valid: true, client_id: tokenData.client_id, scope: tokenData.scope };
}

/**
 * 만료된 코드/토큰 정리
 */
export function cleanupExpiredOAuthData() {
  const now = Date.now();
  let cleanedCodes  = 0;
  let cleanedTokens = 0;

  for (const [code, data] of authCodes) {
    if (now > data.expires_at) {
      authCodes.delete(code);
      cleanedCodes++;
    }
  }

  for (const [token, data] of accessTokens) {
    if (now > data.expires_at) {
      accessTokens.delete(token);
      cleanedTokens++;
    }
  }

  if (cleanedCodes > 0 || cleanedTokens > 0) {
    console.log(`[OAuth] Cleaned up ${cleanedCodes} codes, ${cleanedTokens} tokens`);
  }
}
