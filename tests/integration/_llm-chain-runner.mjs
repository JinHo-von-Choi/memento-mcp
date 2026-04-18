/**
 * LLM Chain Runner — 서브프로세스 실행 전용 스크립트
 *
 * 작성자: 최진호
 * 작성일: 2026-04-18
 *
 * llm-chain-real.test.js 에서 child_process.spawn 으로 호출된다.
 * 환경변수(LLM_PRIMARY, LLM_FALLBACKS)를 읽어 체인을 초기화하고,
 * llmJson 호출 결과를 stdout에 JSON으로 출력한다.
 *
 * 출력 형식:
 *   성공: {"ok":true,"result":<parsed>,"usedProvider":"<name>","chainLength":<n>}
 *   실패: {"ok":false,"error":"<message>","chainLength":<n>}
 *
 * usedProvider 추적:
 *   llmJson 자체는 어느 provider가 응답했는지 노출하지 않으므로,
 *   buildChain()이 반환한 체인 정보와 순차 폴백 재구현으로 추적한다.
 *   단, buildChain은 내부 함수이므로 동일 로직을 직접 재구성한다.
 */

import { LLM_PRIMARY, LLM_FALLBACKS }  from "../../lib/config.js";
import { createProvider }               from "../../lib/llm/registry.js";

/** buildChain 로직 복제 — usedProvider 추적을 위해 체인을 직접 구성한다 */
async function buildChain() {
  const primaryConfig = (() => {
    if (LLM_PRIMARY === "gemini-cli") return "gemini-cli";
    const fromFallbacks = LLM_FALLBACKS.find(f => f.provider === LLM_PRIMARY);
    return fromFallbacks ?? LLM_PRIMARY;
  })();

  const entries = [primaryConfig, ...LLM_FALLBACKS];
  const seen    = new Set();
  const chain   = [];

  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry?.provider;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const provider = createProvider(entry);
    if (!provider) continue;

    try {
      if (await provider.isAvailable()) {
        chain.push(provider);
      }
    } catch (_) {
      /* isAvailable 실패는 체인 제외로 처리 */
    }
  }

  return chain;
}

async function main() {
  const chain = await buildChain();
  const chainLength = chain.length;

  if (chain.length === 0) {
    process.stdout.write(JSON.stringify({
      ok          : false,
      error       : "no LLM provider available — check LLM_PRIMARY and LLM_FALLBACKS configuration",
      chainLength
    }) + "\n");
    return;
  }

  const prompt = "Return ONLY valid JSON with no markdown fences: {\"chain_test\":true}";
  const errors = [];

  for (const provider of chain) {
    try {
      const result = await provider.callJson(prompt, { timeoutMs: 60_000 });
      process.stdout.write(JSON.stringify({
        ok           : true,
        result,
        usedProvider : provider.name,
        chainLength
      }) + "\n");
      return;
    } catch (err) {
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  process.stdout.write(JSON.stringify({
    ok    : false,
    error : `all LLM providers failed: ${errors.join("; ")}`,
    chainLength
  }) + "\n");
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({
    ok    : false,
    error : err.message,
    chainLength: 0
  }) + "\n");
  process.exit(1);
});
