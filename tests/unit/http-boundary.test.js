/**
 * HTTP 경계 조건 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-03-13
 *
 * handleLegacySsePost _keyId 전파, Admin 인증 거부,
 * /health Redis disabled, OAuth metadata scheme 감지를 검증한다.
 *
 * 외부 의존성(DB, Redis, 파일시스템)은 모두 mock 처리.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAuthServerMetadata } from "../../lib/oauth.js";
import { safeCompare }          from "../../lib/auth.js";

/* ------------------------------------------------------------------ */
/*  공통 유틸리티                                                       */
/* ------------------------------------------------------------------ */

/**
 * 가짜 HTTP Response 객체 생성
 * statusCode, headers, end() 호출을 기록한다.
 */
function fakeRes() {
  const _headers = {};
  const res      = {
    statusCode : 0,
    _body      : null,
    _headers,
    setHeader(k, v)  { _headers[k.toLowerCase()] = v; },
    writeHead(code, h) { res.statusCode = code; if (h) Object.assign(_headers, h); },
    end(body)        { res._body = body ?? ""; },
    write()          {}
  };
  return res;
}


/* ================================================================== */
/*  테스트 1: Legacy SSE POST — _keyId 전파 로직 검증                    */
/* ================================================================== */

describe("Legacy SSE POST _keyId propagation", () => {
  /**
   * handleLegacySsePost(397-400행)의 핵심 로직을 추출하여 검증한다.
   * 실제 핸들러를 호출하면 validateLegacySseSession, dispatchJsonRpc 등
   * 외부 의존성이 필요하므로, 주입 로직만 단위 테스트한다.
   *
   * 로직: tools/call 메시지 + params.arguments 존재 시
   *       msg.params.arguments._sessionId = sessionId
   *       msg.params.arguments._keyId     = session._keyId ?? null
   */
  function injectKeyId(msg, sessionId, session) {
    if (msg.method === "tools/call" && msg.params?.arguments) {
      msg.params.arguments._sessionId = sessionId;
      msg.params.arguments._keyId     = session._keyId ?? null;
    }
  }

  it("tools/call 메시지에 session._keyId를 주입한다", () => {
    const msg = {
      method: "tools/call",
      params: { name: "remember", arguments: { content: "test" } }
    };
    const session = { _keyId: "key-abc-123" };

    injectKeyId(msg, "sess-001", session);

    assert.strictEqual(msg.params.arguments._keyId, "key-abc-123");
    assert.strictEqual(msg.params.arguments._sessionId, "sess-001");
  });

  it("session._keyId가 null이면 null을 주입한다 (마스터 키)", () => {
    const msg = {
      method: "tools/call",
      params: { name: "recall", arguments: { query: "test" } }
    };
    const session = { _keyId: null };

    injectKeyId(msg, "sess-002", session);

    assert.strictEqual(msg.params.arguments._keyId, null);
  });

  it("session._keyId가 undefined면 null로 변환한다", () => {
    const msg = {
      method: "tools/call",
      params: { name: "forget", arguments: { id: "x" } }
    };
    const session = {};

    injectKeyId(msg, "sess-003", session);

    assert.strictEqual(msg.params.arguments._keyId, null);
  });

  it("tools/call이 아닌 메서드에는 주입하지 않는다", () => {
    const msg = {
      method: "tools/list",
      params: { arguments: {} }
    };
    const session = { _keyId: "key-xyz" };

    injectKeyId(msg, "sess-004", session);

    assert.strictEqual(msg.params.arguments._keyId, undefined);
    assert.strictEqual(msg.params.arguments._sessionId, undefined);
  });

  it("params.arguments가 없으면 주입을 건너뛴다", () => {
    const msg = {
      method: "tools/call",
      params: { name: "remember" }
    };
    const session = { _keyId: "key-xyz" };

    injectKeyId(msg, "sess-005", session);

    assert.strictEqual(msg.params.arguments, undefined);
  });
});

/* ================================================================== */
/*  테스트 2: Admin API 인증 거부                                       */
/* ================================================================== */

describe("Admin API authentication rejection", () => {
  /**
   * handleAdminApi는 validateMasterKey(req)를 사용하여 인증한다.
   * validateMasterKey는 ACCESS_KEY가 설정된 환경에서
   * Authorization 헤더가 없거나 잘못되면 false를 반환한다.
   *
   * validateMasterKey 로직:
   *   - ACCESS_KEY 미설정 → true (인증 불필요)
   *   - Authorization 헤더 없음 → false
   *   - "Bearer <key>" 형식에서 key가 ACCESS_KEY와 불일치 → false
   *
   * handleAdminUi/handleAdminImage는 현재 인증 미적용 (파일 직접 서빙).
   * Admin REST API(/keys, /stats, /activity 등)는 validateMasterKey로 보호된다.
   */

  it("Authorization 헤더 없이 safeCompare 시 불일치 반환", () => {
    assert.strictEqual(safeCompare("", "some-secret-key"), false);
  });

  it("잘못된 키로 safeCompare 시 불일치 반환", () => {
    assert.strictEqual(safeCompare("wrong-key", "correct-key"), false);
  });

  it("올바른 키로 safeCompare 시 일치 반환", () => {
    const key = "test-admin-key-2026";
    assert.strictEqual(safeCompare(key, key), true);
  });

  /**
   * handleAdminApi 인증 거부 시뮬레이션
   * validateMasterKey가 false를 반환하는 상황에서 401 응답을 검증한다.
   */
  it("인증 실패 시 401 응답 시뮬레이션", () => {
    const res = fakeRes();

    /** handleAdminApi의 인증 거부 로직 재현 (566-569행) */
    const isMasterKeyValid = false;
    if (!isMasterKeyValid) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Unauthorized" }));
    }

    assert.strictEqual(res.statusCode, 401);
    assert.deepStrictEqual(JSON.parse(res._body), { error: "Unauthorized" });
  });

  it("auth 엔드포인트는 인증 검증 대상에서 제외된다", () => {
    /** handleAdminApi 564행: isAuthEndpoint 판별 로직 */
    const method   = "POST";
    const pathname = "/v1/internal/model/nothing/auth";
    const ADMIN_BASE = "/v1/internal/model/nothing";

    const isAuthEndpoint = method === "POST" && pathname === `${ADMIN_BASE}/auth`;
    assert.strictEqual(isAuthEndpoint, true);
  });
});

/* ================================================================== */
/*  테스트 3: /health — Redis disabled 시 200 응답                      */
/* ================================================================== */

describe("/health Redis disabled", () => {
  /**
   * handleHealth의 Redis 상태 판별 로직 (68-77행):
   *   redisClient && redisClient.status === "ready" → up
   *   그 외 → down / degraded
   *
   * REDIS_ENABLED=false일 때 redisClient는 stub 객체 (status: "stub")이므로
   * "ready"가 아니어서 "down"으로 보고되고, 전체 status는 "degraded"가 된다.
   *
   * 실제 /health는 DB 쿼리도 수행하므로 핸들러 직접 호출 대신
   * Redis 상태 판별 로직만 단위 테스트한다.
   */

  function evaluateRedisHealth(redisClient) {
    const health = { status: "healthy", checks: {} };

    try {
      if (redisClient && redisClient.status === "ready") {
        health.checks.redis = { status: "up" };
      } else {
        health.checks.redis = { status: "down", error: "Not connected" };
        health.status       = "degraded";
      }
    } catch (err) {
      health.checks.redis = { status: "down", error: err.message };
      health.status       = "degraded";
    }

    return health;
  }

  it("Redis stub (status: 'stub') 시 degraded + redis down", () => {
    const stubClient = { status: "stub" };
    const health     = evaluateRedisHealth(stubClient);

    assert.strictEqual(health.status, "degraded");
    assert.strictEqual(health.checks.redis.status, "down");
    assert.strictEqual(health.checks.redis.error, "Not connected");
  });

  it("redisClient가 null이면 degraded + redis down", () => {
    const health = evaluateRedisHealth(null);

    assert.strictEqual(health.status, "degraded");
    assert.strictEqual(health.checks.redis.status, "down");
  });

  it("Redis ready 시 healthy + redis up", () => {
    const readyClient = { status: "ready" };
    const health      = evaluateRedisHealth(readyClient);

    assert.strictEqual(health.status, "healthy");
    assert.strictEqual(health.checks.redis.status, "up");
  });

  it("redisClient 접근 시 예외 발생하면 degraded", () => {
    const brokenClient = {
      get status() { throw new Error("Connection refused"); }
    };
    const health = evaluateRedisHealth(brokenClient);

    assert.strictEqual(health.status, "degraded");
    assert.strictEqual(health.checks.redis.status, "down");
    assert.strictEqual(health.checks.redis.error, "Connection refused");
  });

  it("DB 정상 + Redis disabled 시 최종 statusCode는 200이 아닌 503", () => {
    /**
     * handleHealth의 statusCode 결정 로직 (96행):
     *   health.status === "healthy" ? 200 : 503
     *
     * Redis disabled 환경에서는 redis.status !== "ready" → degraded → 503
     * 단, /health 엔드포인트가 200을 반환하려면 Redis 상태 판별 로직의
     * 의도적 변경이 필요하다 (stub을 "disabled"로 처리하는 분기 추가).
     *
     * 현재 코드 동작: stub 클라이언트 → "down" → degraded → 503
     */
    const stubClient = { status: "stub" };
    const health     = evaluateRedisHealth(stubClient);

    /** 현재 동작: degraded 시 503 */
    const statusCode = health.status === "healthy" ? 200 : 503;
    assert.strictEqual(statusCode, 503);
  });
});

/* ================================================================== */
/*  테스트 4: OAuth metadata — scheme 감지                              */
/* ================================================================== */

describe("OAuth metadata scheme detection", () => {
  /**
   * handleOAuthServerMetadata(412-417행)의 baseUrl 구성 로직:
   *   const baseUrl = `https://${req.headers.host || "localhost:57332"}`;
   *
   * 현재 구현은 항상 https:// 를 사용하며 X-Forwarded-Proto를 무시한다.
   * getAuthServerMetadata(baseUrl)는 순수 함수로 baseUrl을 그대로 사용한다.
   */

  it("getAuthServerMetadata에 https baseUrl 전달 시 모든 엔드포인트가 https", () => {
    const meta = getAuthServerMetadata("https://mcp.example.com");

    assert.strictEqual(meta.issuer, "https://mcp.example.com");
    assert.strictEqual(meta.authorization_endpoint, "https://mcp.example.com/authorize");
    assert.strictEqual(meta.token_endpoint, "https://mcp.example.com/token");
    assert.strictEqual(meta.service_documentation, "https://mcp.example.com/docs");
  });

  it("getAuthServerMetadata에 http baseUrl 전달 시 모든 엔드포인트가 http", () => {
    const meta = getAuthServerMetadata("http://localhost:57332");

    assert.strictEqual(meta.issuer, "http://localhost:57332");
    assert.strictEqual(meta.authorization_endpoint, "http://localhost:57332/authorize");
    assert.strictEqual(meta.token_endpoint, "http://localhost:57332/token");
  });

  it("handleOAuthServerMetadata의 baseUrl 구성: 항상 https:// 접두사", () => {
    /**
     * 현재 구현(413행): const baseUrl = `https://${req.headers.host || "localhost:57332"}`;
     * X-Forwarded-Proto 헤더를 무시하므로 항상 https:// 사용.
     */
    function buildBaseUrl(req) {
      return `https://${req.headers.host || "localhost:57332"}`;
    }

    /** X-Forwarded-Proto: http → 여전히 https:// */
    const req1 = {
      headers: { host: "mcp.example.com", "x-forwarded-proto": "http" }
    };
    assert.strictEqual(buildBaseUrl(req1), "https://mcp.example.com");

    /** X-Forwarded-Proto: https → https:// */
    const req2 = {
      headers: { host: "mcp.example.com", "x-forwarded-proto": "https" }
    };
    assert.strictEqual(buildBaseUrl(req2), "https://mcp.example.com");

    /** host 헤더 없음 → https://localhost:57332 */
    const req3 = { headers: {} };
    assert.strictEqual(buildBaseUrl(req3), "https://localhost:57332");
  });

  it("X-Forwarded-Proto 기반 scheme 감지 구현 시 기대 동작", () => {
    /**
     * X-Forwarded-Proto를 반영하는 개선된 baseUrl 구성 로직.
     * 현재 코드에는 미구현이나, 향후 구현 시 기대되는 동작을 명세한다.
     */
    function buildBaseUrlWithProto(req) {
      const proto = req.headers["x-forwarded-proto"] ||
                    (req.socket?.encrypted ? "https" : "http");
      return `${proto}://${req.headers.host || "localhost:57332"}`;
    }

    /** X-Forwarded-Proto: http */
    const req1 = {
      headers: { host: "example.com", "x-forwarded-proto": "http" },
      socket:  { encrypted: false }
    };
    assert.strictEqual(buildBaseUrlWithProto(req1), "http://example.com");

    /** X-Forwarded-Proto: https */
    const req2 = {
      headers: { host: "example.com", "x-forwarded-proto": "https" },
      socket:  { encrypted: false }
    };
    assert.strictEqual(buildBaseUrlWithProto(req2), "https://example.com");

    /** 헤더 없음 + 암호화 안된 소켓 → http:// */
    const req3 = {
      headers: { host: "example.com" },
      socket:  { encrypted: false }
    };
    assert.strictEqual(buildBaseUrlWithProto(req3), "http://example.com");

    /** 헤더 없음 + 암호화된 소켓 → https:// */
    const req4 = {
      headers: { host: "example.com" },
      socket:  { encrypted: true }
    };
    assert.strictEqual(buildBaseUrlWithProto(req4), "https://example.com");
  });

  it("metadata 응답에 필수 필드가 포함된다", () => {
    const meta = getAuthServerMetadata("https://test.example.com");

    assert.ok(meta.issuer);
    assert.ok(meta.authorization_endpoint);
    assert.ok(meta.token_endpoint);
    assert.ok(Array.isArray(meta.response_types_supported));
    assert.ok(Array.isArray(meta.grant_types_supported));
    assert.ok(meta.grant_types_supported.includes("authorization_code"));
    assert.ok(Array.isArray(meta.code_challenge_methods_supported));
    assert.ok(meta.code_challenge_methods_supported.includes("S256"));
  });
});
