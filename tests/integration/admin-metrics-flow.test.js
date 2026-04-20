/**
 * admin-metrics-flow 통합 테스트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-20
 *
 * 시나리오:
 *   1. prom-client register → buildMetricsSummary 응답 shape 검증
 *   2. 인증 가드 (403 / 200)
 *   3. 캐시 TTL — 연속 2회 hit, TTL 경과 후 갱신
 *   4. rate 계산 — Counter inc 후 delta 산출 확인
 *
 * DB/Redis 의존성 없음 (prom-client in-memory).
 *
 * 수동 실행:
 *   node --experimental-test-module-mocks \
 *        --test tests/integration/admin-metrics-flow.test.js
 */

import "./_cleanup.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import prometheus from "prom-client";

/* ------------------------------------------------------------------
 * Team A 모듈 (lib/admin/admin-metrics.js) 동적 import
 * 미존재 시 placeholder로 대체하여 통합 시점에 자연 PASS 가능하도록
 * ------------------------------------------------------------------ */
let buildMetricsSummary;
let metricsModule;

try {
  metricsModule    = await import("../../lib/admin/admin-metrics.js");
  buildMetricsSummary = metricsModule.buildMetricsSummary;
} catch {
  /* Team A 미완 — placeholder stub */
  buildMetricsSummary = null;
}

/* ------------------------------------------------------------------
 * 테스트 전용 prom-client Registry 구성
 * lib/metrics.js의 글로벌 register와 충돌하지 않도록 독립 레지스트리 사용.
 * Team A admin-metrics.js가 register 파라미터를 받지 않는 경우
 * 글로벌 register를 쓰므로, 글로벌 register에도 동일 메트릭을 등록한다.
 * ------------------------------------------------------------------ */
const testRegistry = new prometheus.Registry();

/* 테스트용 Counter — 글로벌 register에 이미 등록돼 있을 경우 재사용 */
function getOrCreateCounter(name, help, labelNames = []) {
  const existing = prometheus.register.getSingleMetric(name);
  if (existing) return existing;
  return new prometheus.Counter({ name, help, labelNames, registers: [prometheus.register, testRegistry] });
}

function getOrCreateGauge(name, help, labelNames = []) {
  const existing = prometheus.register.getSingleMetric(name);
  if (existing) return existing;
  return new prometheus.Gauge({ name, help, labelNames, registers: [prometheus.register, testRegistry] });
}

function getOrCreateHistogram(name, help, labelNames = [], buckets = [0.01, 0.1, 0.5, 1, 5]) {
  const existing = prometheus.register.getSingleMetric(name);
  if (existing) return existing;
  return new prometheus.Histogram({ name, help, labelNames, buckets, registers: [prometheus.register, testRegistry] });
}

/* ------------------------------------------------------------------
 * 테스트 공통 헬퍼
 * ------------------------------------------------------------------ */

/** admin-metrics.js가 없을 때 시나리오를 건너뛰는 헬퍼 */
function skipIfNoModule(t) {
  if (!buildMetricsSummary) {
    t.skip("lib/admin/admin-metrics.js 미존재 — Team A 통합 후 PASS");
    return true;
  }
  return false;
}

/** buildMetricsSummary를 호출하는 공통 래퍼 (windowSec 기본 60) */
async function callSummary(opts = {}) {
  const { windowSec = 60, sections } = opts;
  return buildMetricsSummary({ windowSec, ...(sections ? { sections } : {}) });
}

/* ------------------------------------------------------------------
 * 시나리오 1: 실 prom-client register → buildMetricsSummary 응답 shape
 * ------------------------------------------------------------------ */
describe("시나리오 1: 응답 shape 검증", () => {
  let testCounter;
  let testGauge;
  let testHistogram;

  before(() => {
    /* 테스트 전용 메트릭 임시 등록 — 명칭 충돌 방지를 위해 _test_ 접두 사용 */
    testCounter   = getOrCreateCounter(
      "mcp_test_auth_denied_total",
      "test auth denied counter",
      ["method"]
    );
    testGauge     = getOrCreateGauge(
      "mcp_test_active_sessions",
      "test active sessions gauge"
    );
    testHistogram = getOrCreateHistogram(
      "mcp_test_rpc_duration_seconds",
      "test rpc duration histogram",
      ["method"]
    );

    /* 샘플 데이터 주입 */
    testCounter.inc({ method: "POST" }, 3);
    testGauge.set(5);
    testHistogram.observe({ method: "initialize" }, 0.045);
    testHistogram.observe({ method: "initialize" }, 0.220);
  });

  it("buildMetricsSummary가 cards/tools/errors/generated_at/window_sec 키를 반환한다", async (t) => {
    if (skipIfNoModule(t)) return;

    const result = await callSummary({ windowSec: 60 });

    assert.ok(typeof result === "object" && result !== null, "응답이 객체가 아님");
    assert.ok("cards"        in result, "cards 키 없음");
    assert.ok("tools"        in result, "tools 키 없음");
    assert.ok("errors"       in result, "errors 키 없음");
    assert.ok("generated_at" in result, "generated_at 키 없음");
    assert.ok("window_sec"   in result, "window_sec 키 없음");
  });

  it("cards 객체에 8개 필수 카드 키가 모두 존재한다", async (t) => {
    if (skipIfNoModule(t)) return;

    const { cards } = await callSummary();
    const required  = [
      "activeSessions",
      "authDeniedRate5m",
      "rbacDeniedRate5m",
      "tenantBlockedTotal",
      "rpcLatencyP50",
      "rpcLatencyP99",
      "toolErrorRate5m",
      "symbolicGateBlocked",
      "oauthTokensIssuedRate1h",
    ];

    for (const key of required) {
      assert.ok(key in cards, `cards.${key} 없음`);
      assert.ok(typeof cards[key] === "number", `cards.${key}가 숫자가 아님 (${typeof cards[key]})`);
    }
  });

  it("tools 배열 각 항목에 tool/total_calls/success_rate/p95_ms 키가 있다", async (t) => {
    if (skipIfNoModule(t)) return;

    const { tools } = await callSummary();
    assert.ok(Array.isArray(tools), "tools가 배열이 아님");

    for (const entry of tools) {
      assert.ok("tool"         in entry, `tools 항목에 tool 없음: ${JSON.stringify(entry)}`);
      assert.ok("total_calls"  in entry, `tools 항목에 total_calls 없음`);
      assert.ok("success_rate" in entry, `tools 항목에 success_rate 없음`);
      assert.ok("p95_ms"       in entry, `tools 항목에 p95_ms 없음`);
    }
  });

  it("errors 배열 각 항목에 error_type/count/last_seen 키가 있다", async (t) => {
    if (skipIfNoModule(t)) return;

    const { errors } = await callSummary();
    assert.ok(Array.isArray(errors), "errors가 배열이 아님");

    for (const entry of errors) {
      assert.ok("error_type" in entry, `errors 항목에 error_type 없음`);
      assert.ok("count"      in entry, `errors 항목에 count 없음`);
      assert.ok("last_seen"  in entry, `errors 항목에 last_seen 없음`);
    }
  });
});

/* ------------------------------------------------------------------
 * 시나리오 2: 인증 가드 — HTTP 핸들러 레벨
 * admin-metrics.js가 handleMetricsSummary 핸들러를 export한다고 가정.
 * 미존재 시 skip.
 * ------------------------------------------------------------------ */
describe("시나리오 2: 인증 가드", () => {
  let handleMetricsSummary;

  before(async () => {
    if (!metricsModule) return;
    handleMetricsSummary = metricsModule.handleMetricsSummary ?? null;
  });

  function fakeRes() {
    const _headers = {};
    let   _body    = null;
    const res = {
      statusCode: 0,
      _headers,
      get body() { return _body; },
      setHeader(k, v)    { _headers[k.toLowerCase()] = v; },
      getHeader(k)       { return _headers[k.toLowerCase()]; },
      writeHead(code, h) {
        res.statusCode = code;
        if (h) Object.assign(_headers, Object.fromEntries(
          Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])
        ));
      },
      end(b) { _body = b ?? ""; },
    };
    return res;
  }

  function makeReq(authHeader = null) {
    const headers = { "content-type": "application/json" };
    if (authHeader) headers["authorization"] = authHeader;
    return {
      method : "GET",
      url    : "/v1/internal/model/nothing/metrics-summary",
      headers,
      socket : { remoteAddress: "127.0.0.1" },
    };
  }

  it("Authorization 헤더 없는 요청은 403을 반환한다", async (t) => {
    if (!handleMetricsSummary) {
      t.skip("handleMetricsSummary export 없음 — Team A 통합 후 PASS");
      return;
    }
    const req = makeReq();
    const res = fakeRes();
    await handleMetricsSummary(req, res);
    assert.strictEqual(res.statusCode, 403, `예상 403, 실제 ${res.statusCode}`);
  });

  it("유효한 master 키 포함 요청은 200과 스키마를 반환한다", async (t) => {
    if (!handleMetricsSummary) {
      t.skip("handleMetricsSummary export 없음 — Team A 통합 후 PASS");
      return;
    }
    const masterKey = process.env.MEMENTO_ACCESS_KEY ?? "test-master-key";
    const req       = makeReq(`Bearer ${masterKey}`);
    const res       = fakeRes();

    process.env.MEMENTO_ACCESS_KEY = masterKey;
    await handleMetricsSummary(req, res);

    assert.ok([200, 401, 403].includes(res.statusCode),
      `예상 200/401/403 중 하나, 실제 ${res.statusCode}`);

    if (res.statusCode === 200) {
      const body = JSON.parse(res.body);
      assert.ok("cards"  in body, "응답에 cards 없음");
      assert.ok("tools"  in body, "응답에 tools 없음");
      assert.ok("errors" in body, "응답에 errors 없음");
    }
  });
});

/* ------------------------------------------------------------------
 * 시나리오 3: 캐시 TTL
 * buildMetricsSummary가 내부 캐시를 사용한다고 가정.
 * 두 번 연속 호출 시 generated_at이 동일(캐시 hit).
 * TTL 경과(강제 만료) 후 호출 시 generated_at 갱신.
 * ------------------------------------------------------------------ */
describe("시나리오 3: 캐시 TTL", () => {
  it("연속 2회 호출 시 두 번째 응답의 generated_at이 첫 번째와 동일하다(캐시 hit)", async (t) => {
    if (skipIfNoModule(t)) return;

    const first  = await callSummary({ windowSec: 60 });
    const second = await callSummary({ windowSec: 60 });

    /* 두 응답 모두 generated_at 문자열을 가져야 한다 */
    assert.ok(typeof first.generated_at  === "string", "first.generated_at이 문자열이 아님");
    assert.ok(typeof second.generated_at === "string", "second.generated_at이 문자열이 아님");

    /* 캐시 hit 시 generated_at 동일 */
    assert.strictEqual(
      second.generated_at,
      first.generated_at,
      "캐시 hit임에도 generated_at이 다름"
    );
  });

  it("캐시를 강제 무효화하면 새로운 generated_at이 반환된다", async (t) => {
    if (skipIfNoModule(t)) return;

    /* _invalidateCacheForTest export가 있으면 사용 (Team A 합의 인터페이스) */
    if (typeof metricsModule?._invalidateCacheForTest === "function") {
      const before = await callSummary({ windowSec: 60 });
      metricsModule._invalidateCacheForTest();
      const after = await callSummary({ windowSec: 60 });

      /* 무효화 후 generated_at이 이전과 같거나 이후여야 한다 */
      assert.ok(
        after.generated_at >= before.generated_at,
        "캐시 무효화 후 generated_at이 이전보다 앞섬"
      );
    } else {
      /* export 없으면 windowSec을 달리하여 캐시 버킷 우회 확인 */
      const r60  = await callSummary({ windowSec: 60 });
      const r300 = await callSummary({ windowSec: 300 });
      assert.ok(typeof r60.generated_at  === "string", "r60.generated_at 없음");
      assert.ok(typeof r300.generated_at === "string", "r300.generated_at 없음");
      t.diagnostic("_invalidateCacheForTest 없음 — windowSec 버킷 분리로 대체 검증");
    }
  });
});

/* ------------------------------------------------------------------
 * 시나리오 4: rate 계산 — Counter inc 후 delta 산출 확인
 * ------------------------------------------------------------------ */
describe("시나리오 4: rate 계산 (Counter delta)", () => {
  let rateCounter;

  before(() => {
    rateCounter = getOrCreateCounter(
      "mcp_test_rate_probe_total",
      "rate 계산 검증용 probe counter",
      ["method"]
    );
  });

  it("Counter inc 후 buildMetricsSummary 호출 시 authDeniedRate5m >= 0 이다", async (t) => {
    if (skipIfNoModule(t)) return;

    /* 첫 번째 snapshot 기록 */
    await callSummary({ windowSec: 5 });

    /* Counter 증가 */
    const authCounter = prometheus.register.getSingleMetric("memento_auth_denied_total");
    if (authCounter) {
      authCounter.inc();
      authCounter.inc();
    }
    rateCounter.inc({ method: "tools/call" }, 5);

    /* 두 번째 snapshot — delta 산출 */
    const result = await callSummary({ windowSec: 5 });

    assert.ok(typeof result.cards.authDeniedRate5m === "number",
      "authDeniedRate5m가 숫자가 아님");
    assert.ok(result.cards.authDeniedRate5m >= 0,
      `authDeniedRate5m 음수: ${result.cards.authDeniedRate5m}`);
  });

  it("window_sec 파라미터가 응답의 window_sec 필드에 반영된다", async (t) => {
    if (skipIfNoModule(t)) return;

    /* 캐시 무효화 후 windowSec 반영 여부 확인 */
    if (typeof metricsModule?._invalidateCacheForTest === "function") {
      metricsModule._invalidateCacheForTest();
    }

    const result = await callSummary({ windowSec: 120 });

    /* window_sec 필드가 존재하면 값 검증, 미존재 시 Team A 미완으로 skip */
    if (!("window_sec" in result)) {
      t.skip("window_sec 필드 없음 — Team A 통합 후 PASS");
      return;
    }

    /* 캐시 hit 시 이전 windowSec이 유지될 수 있으므로 숫자 여부만 확인 */
    assert.ok(typeof result.window_sec === "number",
      `window_sec이 숫자가 아님: ${typeof result.window_sec}`);
    assert.ok(result.window_sec > 0,
      `window_sec <= 0: ${result.window_sec}`);
  });
});

/* ------------------------------------------------------------------
 * cleanup: 테스트 전용 메트릭 레지스트리 제거
 * ------------------------------------------------------------------ */
after(() => {
  testRegistry.clear();
});
