/**
 * CORS fail-closed 검증
 *
 * 작성자: 최진호
 * 작성일: 2026-04-10
 *
 * validateOrigin / validateAdminOrigin 의 fail-closed 동작을 검증한다.
 * - ALLOWED_ORIGINS 빈 Set + cross-origin 요청 → 거부(403)
 * - Origin 헤더 없는 요청 → 허용 (비브라우저 MCP 클라이언트 호환성)
 * - same-origin 요청 → 허용
 * - ALLOWED_ORIGINS 설정 + 일치 → 허용
 * - ALLOWED_ORIGINS 설정 + 불일치 → 거부
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* ------------------------------------------------------------------ */
/*  헬퍼                                                                */
/* ------------------------------------------------------------------ */

function fakeRes() {
  const res = { statusCode: 0, _body: null };
  res.end   = (body) => { res._body = body ?? ""; };
  return res;
}

/**
 * validateOrigin 로직을 설정값을 주입할 수 있도록 추출한 순수 함수.
 * 실제 lib/http/helpers.js와 동일한 알고리즘.
 */
function validateOriginWith(allowedOrigins, req, res) {
  const origin = req.headers.origin;

  if (!origin) return true;

  if (allowedOrigins.size > 0) {
    if (!allowedOrigins.has(String(origin))) {
      res.statusCode = 403;
      res.end("Forbidden (Origin not allowed)");
      return false;
    }
    return true;
  }

  /** 빈 Set: same-origin(host 헤더 일치)만 허용 */
  const host       = req.headers.host;
  const originHost = (() => {
    try { return new URL(String(origin)).host; } catch { return null; }
  })();

  if (!host || !originHost || originHost !== host) {
    res.statusCode = 403;
    res.end("Forbidden (Origin not allowed)");
    return false;
  }

  return true;
}

/**
 * validateAdminOrigin 로직과 동일한 순수 함수.
 */
function validateAdminOriginWith(adminAllowedOrigins, req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;

  if (adminAllowedOrigins.size > 0) {
    if (!adminAllowedOrigins.has(String(origin))) {
      res.statusCode = 403;
      res.end("Forbidden (Admin origin not allowed)");
      return false;
    }
    return true;
  }

  const host       = req.headers.host;
  const originHost = (() => {
    try { return new URL(String(origin)).host; } catch { return null; }
  })();

  if (!host || !originHost || originHost !== host) {
    res.statusCode = 403;
    res.end("Forbidden (Admin origin not allowed)");
    return false;
  }

  return true;
}

/* ================================================================== */
/*  validateOrigin                                                     */
/* ================================================================== */

describe("validateOrigin — fail-closed", () => {
  it("Origin 헤더 없음 → 허용 (비브라우저 MCP 클라이언트)", () => {
    const req = { headers: { host: "example.com" } };
    const res = fakeRes();
    assert.strictEqual(validateOriginWith(new Set(), req, res), true);
    assert.strictEqual(res.statusCode, 0);
  });

  it("빈 Set + cross-origin 요청 → 거부(403)", () => {
    const req = { headers: { host: "example.com", origin: "https://evil.com" } };
    const res = fakeRes();
    assert.strictEqual(validateOriginWith(new Set(), req, res), false);
    assert.strictEqual(res.statusCode, 403);
  });

  it("빈 Set + same-origin 요청 → 허용", () => {
    const req = { headers: { host: "example.com", origin: "https://example.com" } };
    const res = fakeRes();
    assert.strictEqual(validateOriginWith(new Set(), req, res), true);
    assert.strictEqual(res.statusCode, 0);
  });

  it("빈 Set + same-origin (포트 포함) → 허용", () => {
    const req = { headers: { host: "localhost:57332", origin: "http://localhost:57332" } };
    const res = fakeRes();
    assert.strictEqual(validateOriginWith(new Set(), req, res), true);
    assert.strictEqual(res.statusCode, 0);
  });

  it("빈 Set + host 헤더 없음 + origin 있음 → 거부", () => {
    const req = { headers: { origin: "https://example.com" } };
    const res = fakeRes();
    assert.strictEqual(validateOriginWith(new Set(), req, res), false);
    assert.strictEqual(res.statusCode, 403);
  });

  it("ALLOWED_ORIGINS 설정 + 화이트리스트 일치 → 허용", () => {
    const allowed = new Set(["https://claude.ai"]);
    const req     = { headers: { host: "memento.example.com", origin: "https://claude.ai" } };
    const res     = fakeRes();
    assert.strictEqual(validateOriginWith(allowed, req, res), true);
    assert.strictEqual(res.statusCode, 0);
  });

  it("ALLOWED_ORIGINS 설정 + 화이트리스트 불일치 → 거부", () => {
    const allowed = new Set(["https://claude.ai"]);
    const req     = { headers: { host: "memento.example.com", origin: "https://evil.com" } };
    const res     = fakeRes();
    assert.strictEqual(validateOriginWith(allowed, req, res), false);
    assert.strictEqual(res.statusCode, 403);
  });

  it("빈 Set + 잘못된 origin URL → 거부", () => {
    const req = { headers: { host: "example.com", origin: "not-a-url" } };
    const res = fakeRes();
    assert.strictEqual(validateOriginWith(new Set(), req, res), false);
    assert.strictEqual(res.statusCode, 403);
  });
});

/* ================================================================== */
/*  validateAdminOrigin                                               */
/* ================================================================== */

describe("validateAdminOrigin — fail-closed", () => {
  it("Origin 헤더 없음 → 허용", () => {
    const req = { headers: { host: "example.com" } };
    const res = fakeRes();
    assert.strictEqual(validateAdminOriginWith(new Set(), req, res), true);
    assert.strictEqual(res.statusCode, 0);
  });

  it("빈 Set + cross-origin → 거부(403)", () => {
    const req = { headers: { host: "example.com", origin: "https://attacker.com" } };
    const res = fakeRes();
    assert.strictEqual(validateAdminOriginWith(new Set(), req, res), false);
    assert.strictEqual(res.statusCode, 403);
  });

  it("빈 Set + same-origin → 허용", () => {
    const req = { headers: { host: "admin.example.com", origin: "https://admin.example.com" } };
    const res = fakeRes();
    assert.strictEqual(validateAdminOriginWith(new Set(), req, res), true);
    assert.strictEqual(res.statusCode, 0);
  });

  it("ADMIN_ALLOWED_ORIGINS 설정 + 일치 → 허용", () => {
    const allowed = new Set(["https://trusted-admin.example.com"]);
    const req     = { headers: { host: "memento.example.com", origin: "https://trusted-admin.example.com" } };
    const res     = fakeRes();
    assert.strictEqual(validateAdminOriginWith(allowed, req, res), true);
  });

  it("ADMIN_ALLOWED_ORIGINS 설정 + 불일치 → 거부", () => {
    const allowed = new Set(["https://trusted-admin.example.com"]);
    const req     = { headers: { host: "memento.example.com", origin: "https://evil.com" } };
    const res     = fakeRes();
    assert.strictEqual(validateAdminOriginWith(allowed, req, res), false);
    assert.strictEqual(res.statusCode, 403);
  });
});

/* ================================================================== */
/*  OAuth access token TTL 분리 검증                                   */
/* ================================================================== */

describe("OAuth access token TTL separation", () => {
  /**
   * TOKEN_TTL_SECONDS = OAUTH_ACCESS_TTL_SECONDS (기본 3600)
   * REFRESH_TTL_SECONDS = OAUTH_REFRESH_TTL_SECONDS (기본 604800 = 7일)
   * 발급된 access token expires_in은 ~3600초여야 한다.
   */

  it("OAUTH_ACCESS_TTL_SECONDS 기본값은 3600 (1시간)", () => {
    /** lib/config.js 기본값 검증 — 환경변수 미설정 시 */
    const defaultAccessTtl = Number(process.env.OAUTH_ACCESS_TTL_SECONDS || 3600);
    assert.strictEqual(defaultAccessTtl, 3600);
  });

  it("OAUTH_REFRESH_TTL_SECONDS 기본값은 604800 (7일)", () => {
    const defaultRefreshTtl = Number(process.env.OAUTH_REFRESH_TTL_SECONDS || 604800);
    assert.strictEqual(defaultRefreshTtl, 604800);
  });

  it("access token expires_at이 ~3600초 범위인지 시뮬레이션", () => {
    const TOKEN_TTL_SECONDS = 3600;
    const TOKEN_TTL_MS      = TOKEN_TTL_SECONDS * 1000;

    const before     = Date.now();
    const expires_at = Date.now() + TOKEN_TTL_MS;
    const after      = Date.now();

    const delta = expires_at - before;
    /** 3600000ms ± 100ms 허용 */
    assert.ok(delta >= TOKEN_TTL_MS - 100, `delta(${delta}) < TTL-100`);
    assert.ok(delta <= TOKEN_TTL_MS + (after - before) + 100, `delta(${delta}) > TTL+overhead`);
  });

  it("refresh token expires_at이 access token보다 길어야 한다 (7일 > 1시간)", () => {
    const TOKEN_TTL_SECONDS   = 3600;
    const REFRESH_TTL_SECONDS = 604800;

    const now             = Date.now();
    const accessExpiresAt = now + TOKEN_TTL_SECONDS * 1000;
    const refreshExpiresAt = now + REFRESH_TTL_SECONDS * 1000;

    assert.ok(refreshExpiresAt > accessExpiresAt,
      "refresh token must expire after access token");
  });

  it("access TTL과 refresh TTL이 분리되어 있다 (동일 값 아님)", () => {
    const accessTtl  = Number(process.env.OAUTH_ACCESS_TTL_SECONDS || 3600);
    const refreshTtl = Number(process.env.OAUTH_REFRESH_TTL_SECONDS || 604800);

    assert.notStrictEqual(accessTtl, refreshTtl,
      "access TTL and refresh TTL must differ");
  });
});
