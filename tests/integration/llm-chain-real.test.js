/**
 * LLM Chain 실측 통합 테스트 — 실제 provider 순차 폴백 검증
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 *
 * E2E_LLM_CHAIN=1 환경변수가 없으면 전체 suite가 skip된다.
 * 실행: E2E_LLM_CHAIN=1 node --test tests/integration/llm-chain-real.test.js
 *
 * --- 서브프로세스 방식 채택 이유 ---
 * lib/llm/index.js 는 lib/config.js 에서 LLM_PRIMARY / LLM_FALLBACKS 를 import하고,
 * config.js 는 ESM 모듈 평가 시점(import 시점)에 process.env 를 읽어 상수로 고정한다.
 * Node.js ESM 모듈 캐시는 테스트 프로세스 내에서 무효화할 수 없으므로,
 * 런타임에 process.env 를 변경해도 이미 로드된 LLM_PRIMARY / LLM_FALLBACKS 에는 반영되지 않는다.
 * 각 케이스마다 child_process.spawn 으로 독립 Node 프로세스를 실행하고,
 * 해당 프로세스의 env 옵션에 원하는 LLM_PRIMARY / LLM_FALLBACKS 를 주입하여
 * 매 케이스가 완전히 독립된 모듈 캐시 상태에서 체인을 초기화하도록 보장한다.
 */

import { describe, it }         from "node:test";
import assert                    from "node:assert/strict";
import { spawn }                 from "child_process";
import { fileURLToPath }         from "url";
import path                      from "path";

/** E2E_LLM_CHAIN=1 이 아니면 전체 suite를 skip한다 */
const ENABLED = process.env.E2E_LLM_CHAIN === "1";

/** 프로젝트 루트 (tests/integration 기준 두 단계 상위) */
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", ".."
);

/**
 * 서브프로세스에서 실행할 runner 스크립트 경로.
 * 런타임마다 새 프로세스를 띄워 ESM 모듈 캐시를 완전히 분리한다.
 */
const RUNNER_SCRIPT = path.resolve(PROJECT_ROOT, "tests/integration/_llm-chain-runner.mjs");

// ---------------------------------------------------------------------------
// 서브프로세스 헬퍼
// ---------------------------------------------------------------------------

/**
 * 지정된 env로 runner 스크립트를 실행하고 stdout JSON을 반환한다.
 *
 * @param {object} env   - process.env 에 병합할 추가 환경변수
 * @param {number} timeoutMs
 * @returns {Promise<{ok:boolean, result?:*, error?:string, chainLength?:number}>}
 */
function runInSubprocess(env, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [RUNNER_SCRIPT], {
      cwd   : PROJECT_ROOT,
      env   : { ...process.env, ...env },
      stdio : ["ignore", "pipe", "pipe"]
    });

    let   stdout = "";
    let   stderr = "";
    const timer  = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`subprocess timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });

    proc.on("close", (code) => {
      clearTimeout(timer);

      /** stdout 마지막 줄에서 JSON 결과를 추출한다 */
      const lines      = stdout.trim().split("\n").filter(Boolean);
      const resultLine = lines.find(l => l.startsWith("{"));

      if (!resultLine) {
        reject(new Error(
          `no JSON in stdout (exit=${code})\nstdout: ${stdout.slice(0, 300)}\nstderr: ${stderr.slice(-300)}`
        ));
        return;
      }

      try {
        resolve(JSON.parse(resultLine));
      } catch (err) {
        reject(new Error(`JSON parse failed: ${err.message}\nraw: ${resultLine}`));
      }
    });

    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// 테스트 suite
// ---------------------------------------------------------------------------

describe("LLM Chain — 실제 provider 순차 폴백", { skip: !ENABLED, timeout: 420_000 }, () => {

  /**
   * Case 1: primary(gemini-cli) 가 존재하면 1차에서 성공한다.
   *
   * LLM_PRIMARY=gemini-cli, LLM_FALLBACKS=[]
   * 기대: ok=true, chainLength=1 (primary만 호출)
   */
  it("primary(gemini-cli)가 존재하면 1차에서 성공한다", { timeout: 180_000 }, async () => {
    const res = await runInSubprocess({
      LLM_PRIMARY   : "gemini-cli",
      LLM_FALLBACKS : "[]"
    });

    assert.equal(res.ok,          true,   `ok should be true, got: ${res.error}`);
    assert.equal(res.chainLength, 1,      "체인 길이 1 — primary만 체인에 포함");
    assert.equal(res.usedProvider, "gemini-cli", "gemini-cli가 응답해야 함");
    assert.ok(res.result !== undefined && res.result !== null, "result가 존재해야 함");
  });

  /**
   * Case 2: primary를 미등록 provider로 지정하면 fallback(gemini-cli)으로 넘어간다.
   *
   * LLM_PRIMARY=nonexistent-xyz, LLM_FALLBACKS=[{"provider":"gemini-cli"}]
   * nonexistent-xyz 는 registry에 없으므로 createProvider → null → 체인 제외.
   * gemini-cli 가 1번째 fallback으로 성공해야 한다.
   */
  it("primary가 미등록 provider이면 fallback(gemini-cli)으로 넘어간다", { timeout: 180_000 }, async () => {
    const res = await runInSubprocess({
      LLM_PRIMARY   : "nonexistent-xyz",
      LLM_FALLBACKS : JSON.stringify([{ provider: "gemini-cli" }])
    });

    assert.equal(res.ok,           true,        `ok should be true, got: ${res.error}`);
    assert.equal(res.usedProvider, "gemini-cli", "gemini-cli fallback이 응답해야 함");
    assert.ok(res.result !== undefined, "result가 존재해야 함");
  });

  /**
   * Case 3: 3단 폴백 — 앞 2개가 미등록 provider, 3번째(gemini-cli)가 응답한다.
   *
   * LLM_PRIMARY=nonexistent-xyz
   * LLM_FALLBACKS=[{"provider":"also-nonexistent"},{"provider":"gemini-cli"}]
   * 앞 두 provider는 createProvider → null → 체인 제외.
   * gemini-cli 만 체인에 남아 성공해야 한다.
   */
  it("3단 폴백: 앞 2개 미등록 시 3번째(gemini-cli)가 응답한다", { timeout: 180_000 }, async () => {
    const res = await runInSubprocess({
      LLM_PRIMARY   : "nonexistent-xyz",
      LLM_FALLBACKS : JSON.stringify([
        { provider: "also-nonexistent" },
        { provider: "gemini-cli"       }
      ])
    });

    assert.equal(res.ok,           true,        `ok should be true, got: ${res.error}`);
    assert.equal(res.usedProvider, "gemini-cli", "3번째 gemini-cli가 응답해야 함");
    assert.ok(res.result !== undefined, "result가 존재해야 함");
  });

  /**
   * Case 4: 전부 미등록 provider → 체인이 비어 "no LLM provider available" 에러.
   *
   * LLM_PRIMARY=nonexistent-xyz
   * LLM_FALLBACKS=[{"provider":"also-nonexistent"},{"provider":"another-nonexistent"}]
   * 모든 provider가 createProvider → null → 체인이 비어 있으므로
   * llmJson이 throw해야 한다.
   */
  it("전부 미등록 provider이면 통합 에러를 throw한다", { timeout: 60_000 }, async () => {
    const res = await runInSubprocess({
      LLM_PRIMARY   : "nonexistent-xyz",
      LLM_FALLBACKS : JSON.stringify([
        { provider: "also-nonexistent"    },
        { provider: "another-nonexistent" }
      ])
    }, 60_000);

    assert.equal(res.ok, false, "ok should be false");
    assert.ok(
      res.error.includes("no LLM provider available") ||
      res.error.includes("all LLM providers failed"),
      `에러 메시지가 기대 패턴과 일치해야 함, got: ${res.error}`
    );
  });

});
