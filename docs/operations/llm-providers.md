# LLM Provider Fallback 운영 가이드

작성자: 최진호
작성일: 2026-04-16

## 개요

memento-mcp는 내부 LLM 호출(AutoReflect, MorphemeIndex, ConsolidatorGC, ContradictionDetector, MemoryEvaluator)에 13개 provider fallback chain을 지원한다. 기본값은 Gemini CLI 단독 사용으로 기존 동작 완전 보존.

## 활성화

### 기본 상태 (env 미설정)

```bash
# LLM_PRIMARY=gemini-cli (기본값)
# LLM_FALLBACKS=(비어있음)
```

Gemini CLI만 사용. 실패 시 caller가 graceful degradation (AutoReflect skip 등).

### Fallback 체인 구성

```bash
LLM_PRIMARY=gemini-cli
LLM_FALLBACKS='[
  {"provider":"anthropic","apiKey":"sk-ant-...","model":"claude-opus-4-6"},
  {"provider":"openai","apiKey":"sk-...","model":"gpt-4o-mini"}
]'
```

Gemini CLI 실패 시 anthropic → openai 순차 시도.

## Provider별 필수 필드

| Provider | apiKey | model | baseUrl | 기본 baseUrl |
|----------|--------|-------|---------|-------------|
| gemini-cli | - | - | - | (CLI 바이너리) |
| anthropic | 필수 | 필수 | 선택 | https://api.anthropic.com/v1 |
| openai | 필수 | 필수 | 선택 | https://api.openai.com/v1 |
| google-gemini-api | 필수 | 필수 | 선택 | https://generativelanguage.googleapis.com/v1beta |
| groq | 필수 | 필수 | 선택 | https://api.groq.com/openai/v1 |
| openrouter | 필수 | 필수 | 선택 | https://openrouter.ai/api/v1 |
| xai | 필수 | 필수 | 선택 | https://api.x.ai/v1 |
| ollama | 선택 | 필수 | **필수** | (없음 — 사용자 지정) |
| vllm | 선택 | 필수 | **필수** | (없음 — 사용자 배포) |
| deepseek | 필수 | 필수 | 선택 | https://api.deepseek.com |
| mistral | 필수 | 필수 | 선택 | https://api.mistral.ai/v1 |
| cohere | 필수 | 필수 | 선택 | https://api.cohere.ai/v1 |
| zai | 필수 | 필수 | 선택 | https://open.bigmodel.cn/api/paas/v4 |

## Circuit Breaker

연속 실패 시 provider 자동 격리:
- 기본 5회 연속 실패 → 60초 OPEN 상태
- OPEN 중 해당 provider 호출은 즉시 건너뛰고 다음 체인으로 이동
- 60초 경과 후 자동 CLOSE, 다음 호출에서 재시도
- REDIS_ENABLED=true 시 상태가 Redis에 저장되어 프로세스 재시작에도 유지됨

## Monitoring

Prometheus 쿼리 예시:

```promql
# provider별 성공률
sum(rate(memento_llm_provider_calls_total{outcome="success"}[5m])) by (provider)
  / sum(rate(memento_llm_provider_calls_total{outcome="attempt"}[5m])) by (provider)

# fallback 발동 빈도
rate(memento_llm_fallback_triggered_total[5m])

# provider별 p95 레이턴시
histogram_quantile(0.95, rate(memento_llm_provider_latency_ms_bucket[5m]))

# 토큰 사용량
rate(memento_llm_token_usage_total{direction="input"}[1h])
```

## 보안

**프롬프트 redaction**: Winston REDACT_PATTERNS + LLM 특화 패턴(`sk-ant-`, `sk-`, `gsk_`) 적용. API 키/세션 쿠키/OAuth 토큰은 자동 마스킹되지만 도메인 특화 PII(이름, 주소)는 마스킹 대상 아님.

**외부 provider 차단**: `LLM_FALLBACKS`에서 해당 provider 항목 제거. `LLM_PRIMARY=gemini-cli`만 남기면 외부 LLM 전면 차단.

## 장애 대응

### 특정 provider 전체 차단

```bash
# LLM_FALLBACKS JSON에서 해당 provider 원소 제거 후 서버 재시작
```

### 특정 모델 deprecation

```bash
# LLM_FALLBACKS JSON의 model 필드를 새 모델명으로 변경 후 서버 재시작
```

### Circuit breaker 수동 reset

```bash
# REDIS_ENABLED=true인 경우
redis-cli --scan --pattern "llm:cb:*" | xargs redis-cli del
# in-memory인 경우 서버 재시작
```

## 알려진 제약

- 프롬프트 캐싱 미지원 (Anthropic cache_control, OpenAI prompt caching 등 — 후속 과제)
- Structured output / tool calling 미지원 — parseJsonResponse heuristic으로 처리
- Token budget cap enforcement는 provider 응답 수신 후 누적 — 선제 차단 아님
- llmText export 없음 — 내부 caller가 전부 JSON 응답 사용
