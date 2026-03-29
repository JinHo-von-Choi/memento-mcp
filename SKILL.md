# Memento MCP Skill Reference

AI 에이전트가 Memento MCP 기억 서버를 완전히 활용하기 위한 기술 레퍼런스.

## 서버 개요

Memento MCP는 MCP(Model Context Protocol) 기반의 장기 기억 서버다. AI 에이전트의 세션 간 지식을 파편(Fragment) 단위로 영속화하고, 3계층 검색(키워드 L1 → 시맨틱 L2 → 하이브리드 RRF L3)으로 맥락에 맞는 기억을 회상한다.

### 핵심 개념

- 파편(Fragment): 1~3문장의 자기완결적 지식 단위. id, content, topic, type, keywords, importance로 구성.
- 타입: fact, decision, error, preference, procedure, relation
- 앵커(Anchor): isAnchor=true인 파편. 통합(consolidation)에서 중요도 감쇠 및 만료 삭제 대상에서 제외되는 영구 지침.
- 유효 기간: valid_from/valid_to로 시간 범위를 가진 임시 지식 표현.
- 대체(Supersession): supersedes 파라미터로 구 파편의 valid_to를 설정하고 importance를 반감하여 버전 관리.
- 키 격리: API 키별로 파편이 분리되어 다른 키의 기억에 접근 불가. 키 그룹으로 공유 가능.
- 스코프: permanent(기본, 장기 기억)와 session(세션 워킹 메모리, 세션 종료 시 소멸) 2종.

## 도구 레퍼런스 (12개)

### remember

새 파편을 생성한다. 반드시 1~2문장 단위의 원자적 사실 하나만 저장한다. 여러 사실을 한 파편에 뭉치면 시맨틱 검색 정밀도가 저하된다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| content | string | O | 기억할 내용. 1~3문장, 300자 이내 권장. |
| topic | string | O | 주제 라벨. 예: database, auth, deployment, security |
| type | string | O | fact, decision, error, preference, procedure, relation, episode -- episode: 서사/맥락 기억. 전후관계와 이유를 포함하는 긴 문장 (1000자) |
| keywords | string[] | - | 검색용 키워드. 미입력 시 자동 추출. 3~5개 권장. |
| importance | number | - | 0.0~1.0. 미입력 시 type별 기본값 적용. |
| source | string | - | 출처 (세션 ID, 도구명 등) |
| linkedTo | string[] | - | 연결할 기존 파편 ID 목록 |
| scope | string | - | permanent(기본) 또는 session. session은 세션 종료 시 소멸. |
| isAnchor | boolean | - | true면 영구 보존. 중요도 감쇠/만료 삭제 대상 제외. 핵심 규칙/정책용. |
| supersedes | string[] | - | 대체할 기존 파편 ID 목록. 지정된 파편은 valid_to 설정 + importance 반감. |
| contextSummary | string | - | 이 기억이 생긴 맥락/배경 요약 (1-2문장) |
| sessionId | string | - | 현재 세션 ID |
| agentId | string | - | 에이전트 ID (RLS 격리용) |

품질 게이트: content < 10자 AND 단어 < 3개, URL만, type+topic null인 경우 거부됨.
importance < 0.3이면 경고 반환 + TTL short 자동 설정.

반환: `{ id, keywords, ttl_tier, scope, conflicts }`

사용 시점:
- 사용자가 선호/스타일을 명시할 때 (type=preference, importance=0.9)
- 에러 원인이 파악됐을 때 (type=error, importance=0.8)
- 아키텍처/기술 결정이 확정됐을 때 (type=decision, importance=0.7)
- 새 서비스 경로/포트/설정값을 확인했을 때 (type=fact, importance=0.5)
- 배포/빌드 절차가 완성됐을 때 (type=procedure, importance=0.7)

### batch_remember

여러 파편을 한번에 저장한다. 단일 트랜잭션으로 최대 200건을 일괄 INSERT하여 HTTP 라운드트립을 최소화한다. 개별 파편은 품질 게이트(validateContent)를 거치며, 부적합 파편은 건너뛴다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| fragments | array | O | 저장할 파편 배열 (최대 200건). 각 항목: content(string, 필수), topic(string, 필수), type(string, 필수), importance(number), keywords(string[]). |
| agentId | string | - | 에이전트 ID (RLS 격리용) |

반환: `{ success, inserted, skipped }`

주의: batch_remember는 단순 배열 저장용으로, remember의 모든 파라미터를 지원하지 않는다. 미지원: contextSummary, isAnchor, supersedes, linkedTo, scope, sessionId. episode type도 미지원. 이 속성들이 필요하면 개별 remember를 호출한다.

### recall

파편을 검색한다. 키워드, 시맨틱, 하이브리드 3가지 검색 경로를 자동 선택.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| keywords | string[] | - | 키워드 검색. L1/L2 경로. |
| text | string | - | 자연어 검색 쿼리. L3 시맨틱 검색 사용. |
| topic | string | - | 주제 필터. |
| type | string | - | 타입 필터. fact, decision, error, preference, procedure, relation |
| tokenBudget | number | - | 최대 반환 토큰 수. 기본 1000. |
| includeLinks | boolean | - | 연결된 파편 포함 여부. 기본 true. 1-hop 제한, caused_by/resolved_by 우선. |
| linkRelationType | string | - | 연결 파편 관계 유형 필터. related, caused_by, resolved_by, part_of, contradicts |
| threshold | number | - | similarity 임계값 0~1. 미만인 파편은 제외. L1/L2 결과는 필터링 안 함. |
| includeSuperseded | boolean | - | true면 superseded_by로 만료된 파편도 포함. 기본 false. |
| asOf | string | - | ISO 8601. 특정 시점 기준 유효 파편만 반환. 미지정 시 현재 유효 파편. |
| timeRange | object | - | 시간 범위 필터. {from: "2026-03-15", to: "2026-03-16"} ISO 8601. |
| cursor | string | - | 페이지네이션 커서. 이전 결과의 nextCursor 값. |
| pageSize | number | - | 페이지 크기. 기본 20, 최대 50. |
| excludeSeen | boolean | - | true(기본값) 시 이전 context() 호출에서 이미 주입된 파편 제외. |
| includeContext | boolean | - | true이면 context_summary와 시간 인접 파편을 함께 반환 |
| agentId | string | - | 에이전트 ID. |

반환: `{ fragments: [{ id, content, topic, type, importance, similarity?, stale_warning? }], count, totalTokens, searchPath, _searchEventId }`

검색 전략:
- keywords만 전달: L1(PostgreSQL ILIKE) → L2(pgvector cosine)
- text만 전달: L3(시맨틱 임베딩 + RRF 하이브리드)
- 둘 다 전달: L1/L2 + L3 병합

사용 시점:
- 에러 해결 시작 전: `recall(keywords=["관련키워드"], type="error")`
- 설정 변경 전: `recall(keywords=["설정명"])`
- 사용자가 "이전에", "저번에" 언급 시: `recall(text="관련 내용")`

### forget

파편을 삭제한다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | string | - | 삭제할 파편 ID. |
| topic | string | - | 해당 주제의 파편 전체 삭제. |
| force | boolean | - | true면 permanent 파편도 강제 삭제. 기본 false. |
| agentId | string | - | 에이전트 ID. |

반환: `{ deleted }`

사용 시점:
- 에러를 완전히 해결한 직후 해당 error 파편 삭제
- 사용자가 "잊어", "지워" 요청 시

### link

두 파편 사이에 관계를 생성한다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| fromId | string | O | 시작 파편 ID. |
| toId | string | O | 대상 파편 ID. |
| relationType | string | - | related(기본), caused_by, resolved_by, part_of, contradicts |
| agentId | string | - | 에이전트 ID. |

사용 시점:
- 에러 → 해결책 연결: resolved_by
- 원인 → 결과 연결: caused_by
- 관련 지식 연결: related
- 정보 모순 발견 시: contradicts

### amend

기존 파편을 수정한다. 변경된 필드만 전달하면 나머지는 보존된다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | string | O | 수정할 파편 ID. |
| content | string | - | 새 내용. 300자 초과 시 절삭. |
| topic | string | - | 새 주제. |
| keywords | string[] | - | 새 키워드 목록. |
| type | string | - | 새 유형. fact, decision, error, preference, procedure, relation |
| importance | number | - | 새 중요도 0~1. |
| isAnchor | boolean | - | 고정 파편 여부 설정. |
| supersedes | boolean | - | true면 기존 파편을 명시적으로 대체(superseded_by 링크 + 중요도 하향). |
| agentId | string | - | 에이전트 ID. |

### reflect

세션 종료 시 학습 내용을 원자 파편으로 영속화한다. 각 배열 항목이 독립 파편으로 저장되므로 항목 하나에 하나의 사실/결정/절차만 담을 것.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| summary | string 또는 string[] | - | 세션 개요 파편 목록. 배열 권장. 항목 1개 = 사실 1건(1~2문장). |
| sessionId | string | - | 세션 ID. 전달 시 같은 세션의 파편만 종합하여 reflect 수행. |
| decisions | string[] | - | 기술/아키텍처 결정 목록. 항목 1개 = 결정 1건. |
| errors_resolved | string[] | - | 해결된 에러 목록. '원인: X → 해결: Y' 형식 권장. |
| new_procedures | string[] | - | 확립된 절차/워크플로우 목록. |
| open_questions | string[] | - | 미해결 질문 목록. |
| task_effectiveness | object | - | 세션 도구 사용 효과성 종합 평가. overall_success(bool), tool_highlights(string[]), tool_pain_points(string[]) |
| agentId | string | - | 에이전트 ID. |

반환: `{ count }`

사용 시점:
- 세션 종료 직전
- 대규모 작업 완료 후
- summary 또는 sessionId 중 하나 이상 전달 필요

### context

현재 에이전트의 핵심 기억을 캡슐화하여 반환. 세션 시작 시 호출 권장.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tokenBudget | number | - | 최대 토큰 수. 기본 2000. |
| types | string[] | - | 로드할 유형 목록. 기본: preference, error, procedure |
| sessionId | string | - | 세션 ID. Working Memory 로드용. |
| structured | boolean | - | true 시 계층적 트리 구조 반환 (core/working/anchors/learning). 기본값 false. |
| agentId | string | - | 에이전트 ID. |

반환: `{ core_memory: [...], working_memory: [...], system_hints: [...] }`
- core_memory: 앵커 + 고중요도 파편 (preference, error, procedure 등)
- working_memory: 해당 세션의 워킹 메모리 파편
- system_hints: 미반영 세션 경고 등 시스템 알림

### tool_feedback

도구 호출 결과에 대한 유용성 피드백을 기록한다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tool_name | string | O | 평가 대상 도구명. |
| relevant | boolean | O | 결과가 요청 의도와 관련 있었는가. |
| sufficient | boolean | O | 결과가 작업 완료에 충분했는가. |
| suggestion | string | - | 개선 제안. 100자 이내. |
| context | string | - | 사용 맥락 요약. 50자 이내. |
| session_id | string | - | 세션 ID. |
| trigger_type | string | - | sampled(훅 샘플링) 또는 voluntary(AI 자발적, 기본값). |
| search_event_id | integer | - | 직전 recall이 반환한 _searchEventId. 검색 품질 분석에 사용. |

### memory_stats

기억 시스템 통계를 반환한다.

파라미터: 없음

반환: `{ stats: { total_fragments, by_type, by_topic, searchLatencyMs, evaluation, searchObservability, ... } }`

### memory_consolidate

수동으로 기억 통합(GC)을 트리거한다. TTL 전환, 중요도 감쇠, 만료 삭제, 중복 병합을 수행. master key 전용.

파라미터: 없음

### graph_explore

에러 파편 기점으로 인과 관계 체인을 추적한다. RCA(Root Cause Analysis) 전용. caused_by, resolved_by 관계를 1-hop 추적하여 에러 원인과 해결 절차를 연결한다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| startId | string | O | 시작 파편 ID. error 파편 권장. |
| agentId | string | - | 에이전트 ID. |

### fragment_history

파편의 전체 변경 이력을 조회한다. amend로 수정된 이전 버전과 superseded_by 체인을 반환한다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | string | O | 조회할 파편 ID. |

## 세션 생명주기 프로토콜

### 1. 세션 시작

```
context() 호출
→ core_memory/working_memory 수신
→ 사용자 페르소나, 프로젝트 표준, 빈번한 에러 패턴 복원
```

system_hints에 미반영 세션 경고가 있으면 사용자에게 알린다.

### 2. 작업 중

```
작업 시작 전 → recall(keywords=[관련키워드]) 선행
정보 발생 시 → remember(type=적절한타입) 즉시 호출
에러 해결 시 → remember(type="error") + forget(이전 error 파편) + link(relationType="resolved_by")
```

### 3. 세션 종료

```
reflect(summary=[...], decisions=[...], errors_resolved=[...]) 호출
```

## 기억 저장 규칙

1. 간결성: 파편 하나에 하나의 개념만. 300자 이내.
2. 범주화: topic 라벨 필수. 검색 효율에 직결.
3. 키워드: 3~5개. 구체적이고 검색 가능한 단어.
4. 보안: API 키, 비밀번호, 토큰을 파편에 저장하지 않는다.
5. 앵커: 절대 변경되지 않는 핵심 규칙만 isAnchor=true.
6. 대체: 정보가 업데이트되면 새 파편 생성 시 supersedes 파라미터로 구 파편 연결.

## 검색 계층 구조

| 계층 | 방식 | 용도 |
|------|------|------|
| L1 | 키워드 ILIKE | 정확한 용어 검색. 가장 빠름. |
| L2 | pgvector cosine | 의미적 유사 파편 검색. 키워드 미스 보완. |
| L3 | RRF 하이브리드 | L1+L2 결과를 Reciprocal Rank Fusion으로 합산. 최고 품질. |

recall 호출 시 keywords만 전달하면 L1→L2, text를 전달하면 L3까지 자동 확장.

## 중요도 기본값 권장

| 타입 | 권장 중요도 | 근거 |
|------|------------|------|
| preference | 0.9 | 사용자 의도를 정확히 반영해야 반복 질문 방지 |
| error | 0.8 | 동일 에러 재발 시 즉시 해결책 제공 |
| procedure | 0.7 | 반복 절차는 안정적 회상이 필요 |
| decision | 0.7 | 과거 결정과 모순되는 제안 방지 |
| fact | 0.5 | 일반 사실은 기본값 |
| relation | 0.5 | 관계 기록은 기본값 |
