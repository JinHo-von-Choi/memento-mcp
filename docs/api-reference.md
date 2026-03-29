# API Reference

MCP 도구 상세는 [SKILL.md](../SKILL.md) 참조.

---

## HTTP 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /mcp | Streamable HTTP. JSON-RPC 요청 수신. MCP-Session-Id 헤더 필요 (초기 initialize 제외) |
| GET | /mcp | Streamable HTTP. SSE 스트림 열기. 서버 측 푸시용 |
| DELETE | /mcp | Streamable HTTP. 세션 명시적 종료 |
| GET | /sse | Legacy SSE. 세션 생성. `accessKey` 쿼리 파라미터로 인증 |
| POST | /message?sessionId= | Legacy SSE. JSON-RPC 요청 수신. 응답은 SSE 스트림으로 전달 |
| GET | /health | 헬스 체크. DB 쿼리(SELECT 1), 세션 상태, Redis 연결을 확인하고 JSON으로 반환. `REDIS_ENABLED=false` 시 Redis는 `disabled`로 표시되며 200 반환. DB 장애 시 503 |
| GET | /metrics | Prometheus 메트릭. prom-client가 수집한 HTTP 요청 카운터, 세션 게이지 등 |
| GET | /.well-known/oauth-authorization-server | OAuth 2.0 인가 서버 메타데이터 |
| GET | /.well-known/oauth-protected-resource | OAuth 2.0 보호 리소스 메타데이터 |
| GET | /authorize | OAuth 2.0 인가 엔드포인트. PKCE code_challenge 필요 |
| POST | /token | OAuth 2.0 토큰 엔드포인트. authorization_code 교환 |
| GET | /v1/internal/model/nothing | Admin SPA. app shell HTML 제공(인증 불필요). 데이터 API는 마스터 키 인증 필요 |
| GET | /v1/internal/model/nothing/assets/* | Admin 정적 파일 (admin.css, admin.js). 인증 불필요 |
| POST | /v1/internal/model/nothing/auth | 마스터 키 검증 엔드포인트 |
| GET | /v1/internal/model/nothing/stats | 대시보드 통계 (파편 수, API 호출량, 시스템 메트릭, searchMetrics, observability, queues, healthFlags) |
| GET | /v1/internal/model/nothing/activity | 최근 파편 활동 로그 (10건) |
| GET | /v1/internal/model/nothing/keys | API 키 목록 조회 |
| POST | /v1/internal/model/nothing/keys | API 키 생성. 원시 키는 응답에서 단 1회 반환 |
| PUT | /v1/internal/model/nothing/keys/:id | API 키 상태 변경 (active ↔ inactive) |
| DELETE | /v1/internal/model/nothing/keys/:id | API 키 삭제 |
| GET | /v1/internal/model/nothing/groups | 키 그룹 목록 |
| POST | /v1/internal/model/nothing/groups | 키 그룹 생성 |
| DELETE | /v1/internal/model/nothing/groups/:id | 키 그룹 삭제 |
| GET | /v1/internal/model/nothing/groups/:id/members | 그룹 멤버 목록 |
| POST | /v1/internal/model/nothing/groups/:id/members | 키를 그룹에 추가 |
| DELETE | /v1/internal/model/nothing/groups/:gid/members/:kid | 그룹에서 키 제거 |
| GET | /v1/internal/model/nothing/memory/overview | 메모리 전체 현황 (유형/토픽 분포, 품질 미검증, superseded, 최근 활동) |
| GET | /v1/internal/model/nothing/memory/search-events?days=N | 검색 이벤트 분석 (총 검색 수, 실패 쿼리, 피드백 통계) |
| GET | /v1/internal/model/nothing/memory/fragments | 파편 검색/필터링 (topic, type, key_id, page, limit) |
| GET | /v1/internal/model/nothing/memory/anomalies | 이상 탐지 결과 |
| GET | /v1/internal/model/nothing/sessions | 세션 목록 (활동 enrichment, 미반영 세션 수) |
| GET | /v1/internal/model/nothing/sessions/:id | 세션 상세 (검색 이벤트, 도구 피드백) |
| POST | /v1/internal/model/nothing/sessions/:id/reflect | 수동 reflect 실행 |
| DELETE | /v1/internal/model/nothing/sessions/:id | 세션 종료 |
| POST | /v1/internal/model/nothing/sessions/cleanup | 만료 세션 정리 |
| POST | /v1/internal/model/nothing/sessions/reflect-all | 미반영 세션 일괄 reflect |
| GET | /v1/internal/model/nothing/logs/files | 로그 파일 목록 (크기 포함) |
| GET | /v1/internal/model/nothing/logs/read | 로그 내용 조회 (file, tail, level, search 파라미터) |
| GET | /v1/internal/model/nothing/logs/stats | 로그 통계 (레벨별 카운트, 최근 에러, 디스크 사용량) |
| GET | /v1/internal/model/nothing/memory/graph?topic=&limit= | 지식 그래프 데이터 (nodes + edges) |
| GET | /v1/internal/model/nothing/export?key_id=&topic= | 파편 JSON Lines 스트림 내보내기 |
| POST | /v1/internal/model/nothing/import | 파편 JSON 배열 가져오기 |

### /health 엔드포인트 정책

| 의존성 | 분류 | down 시 응답 |
|--------|------|-------------|
| PostgreSQL | 필수 | 503 (degraded) |
| Redis | 선택 | 200 (healthy, warnings 포함) |

Redis가 비활성화(`REDIS_ENABLED=false`)되거나 연결 실패해도 서버는 healthy(200)를 반환합니다.
L1 캐시와 Working Memory가 비활성화되지만 핵심 기억 저장/검색은 PostgreSQL만으로 동작합니다.

인증 방식은 두 가지다. Streamable HTTP는 `initialize` 요청 시 `Authorization: Bearer <MEMENTO_ACCESS_KEY>` 헤더로 인증하며 이후 세션으로 유지된다. Legacy SSE는 `/sse?accessKey=<MEMENTO_ACCESS_KEY>` 쿼리 파라미터로 인증한다.

---

## 프롬프트 (Prompts)

미리 정의된 가이드라인으로 AI가 기억 시스템을 효율적으로 사용하도록 돕는다.

| 이름 | 설명 | 주요 역할 |
|------|------|----------|
| `analyze-session` | 세션 활동 분석 | 현재 대화에서 저장할 가치가 있는 결정, 에러, 절차를 자동으로 추출하도록 유도 |
| `retrieve-relevant-memory` | 관련 기억 검색 가이드 | 특정 주제에 대해 키워드와 시맨틱 검색을 병행하여 최적의 컨텍스트를 찾도록 보조 |
| `onboarding` | 시스템 사용법 안내 | AI가 Memento MCP의 도구들을 언제 어떻게 써야 하는지 스스로 학습 |

---

## 리소스 (Resources)

기억 시스템의 현재 상태를 실시간으로 조회할 수 있는 MCP 리소스.

| URI | 설명 | 데이터 소스 |
|-----|------|------------|
| `memory://stats` | 시스템 통계 | `fragments` 테이블의 유형별, 계층별 카운트 및 유용성 점수 평균 |
| `memory://topics` | 주제 목록 | `fragments` 테이블의 모든 고유한 `topic` 레이블 목록 |
| `memory://config` | 시스템 설정 | `MEMORY_CONFIG`에 정의된 가중치 및 TTL 임계값 |
| `memory://active-session` | 세션 활동 로그 | `SessionActivityTracker`(Redis)에 기록된 현재 세션의 도구 사용 이력 |

---

## 권장 사용 흐름

1. 세션 시작 — `context()`로 핵심 기억을 로드한다. 선호, 에러 패턴, 절차가 복원된다. 미반영 세션이 있으면 힌트가 표시된다.
2. 작업 중 — 중요한 결정, 에러, 절차 발생 시 `remember()`로 저장한다. 저장 시 유사 파편과 자동으로 링크가 생성된다. 과거 경험이 필요하면 `recall()`로 검색한다. 에러 해결 후 `forget()`으로 에러 파편을 정리하고 `remember()`로 해결 절차를 기록한다.
3. 세션 종료 — `reflect()`로 세션 내용을 구조화된 파편으로 영속화한다. 수동 호출 없이도 세션 종료/만료 시 AutoReflect가 자동으로 실행된다.
