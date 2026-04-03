# Memento MCP Skill Reference

AI 에이전트가 Memento MCP 기억 서버를 최대 효율로 활용하기 위한 기술 레퍼런스.

## 서버 개요

Memento MCP는 MCP(Model Context Protocol) 기반의 장기 기억 서버다. AI 에이전트의 세션 간 지식을 파편(Fragment) 단위로 영속화하고, 3계층 검색(키워드 L1 -> 시맨틱 L2 -> 하이브리드 RRF L3)으로 맥락에 맞는 기억을 회상한다.

### 핵심 개념

- 파편(Fragment): 1~3문장의 자기완결적 지식 단위. id, content, topic, type, keywords, importance로 구성.
- 타입: fact, decision, error, preference, procedure, relation, episode
- 에피소드(Episode): 전후관계를 포함하는 서사 기억. 복수의 원자적 파편을 시간순/인과순으로 연결하는 내러티브. contextSummary로 맥락 보존. 최대 1000자.
- 앵커(Anchor): isAnchor=true인 파편. 통합(consolidation)에서 중요도 감쇠 및 만료 삭제 대상에서 제외되는 영구 지침.
- 유효 기간: valid_from/valid_to로 시간 범위를 가진 임시 지식 표현.
- 대체(Supersession): supersedes 파라미터로 구 파편의 valid_to를 설정하고 importance를 반감하여 버전 관리.
- 키 격리: API 키별로 파편이 분리되어 다른 키의 기억에 접근 불가. 키 그룹으로 공유 가능.
- 스코프: permanent(기본, 장기 기억)와 session(세션 워킹 메모리, 세션 종료 시 소멸) 2종.

## 세션 생명주기 프로토콜

### 1. 세션 시작 (필수)

```
context() 호출
-> core_memory: 앵커 + 고중요도 파편 (preference, error, procedure)
-> working_memory: 현재 세션의 워킹 메모리
-> system_hints: 미반영 세션 경고, 시스템 알림
```

system_hints에 미반영 세션 경고가 있으면 사용자에게 알린다.

context 로드 후 행동:
- preference 파편을 확인하여 사용자의 코딩 스타일, 언어 선호, 작업 방식을 즉시 적용
- error 파편을 확인하여 현재 작업과 관련된 과거 에러/해결책을 인지
- procedure 파편을 확인하여 프로젝트별 빌드/배포/테스트 절차를 파악
- 사용자가 언급하는 주제에 대해 recall로 추가 컨텍스트 검색

### 2. 작업 중 (능동적 기억 관리)

#### remember 즉시 호출 시점

| 상황 | type | importance | 예시 |
|------|------|------------|------|
| 사용자 선호/스타일 명시 | preference | 0.9 | "한국어로 답변해" |
| 에러 원인 파악 | error | 0.8 | "CORS 에러: nginx proxy_pass에 Host 헤더 누락" |
| 에러 해결책 확정 | procedure | 0.8 | "nginx에 proxy_set_header Host $host 추가" |
| 아키텍처/기술 결정 | decision | 0.7 | "인증은 OAuth 2.0 + PKCE로 결정" |
| 배포/빌드 절차 완성 | procedure | 0.7 | "배포: git push -> CI -> Docker build -> kubectl apply" |
| 새 설정값/경로 확인 | fact | 0.5 | "memento-mcp 포트: 57332, admin: /v1/internal/model/nothing" |

#### recall 선행 호출 시점 (작업 전 의무)

| 상황 | 호출 예시 |
|------|-----------|
| 에러 해결 시작 전 | `recall(keywords=["에러키워드"], type="error")` |
| 설정/환경변수 변경 전 | `recall(keywords=["설정명", "프로젝트명"])` |
| 동일 토픽 코드 작성 전 | `recall(topic="프로젝트명")` |
| "이전에", "저번에" 언급 시 | `recall(text="관련 내용")` |

#### forget 시점
- 에러를 완전히 해결한 직후 해당 error 파편 삭제
- 사용자가 명시적으로 요청 시

#### link 활용
- 에러 -> 해결책: `link(fromId=에러, toId=해결책, relationType="resolved_by")`
- 원인 -> 결과: `link(fromId=원인, toId=결과, relationType="caused_by")`
- 관련 지식: `link(fromId=A, toId=B, relationType="related")`
- 모순 발견: `link(fromId=A, toId=B, relationType="contradicts")`

### 3. 세션 종료

```
reflect(
  summary=["사실1", "사실2"],
  decisions=["결정1"],
  errors_resolved=["원인: X -> 해결: Y"],
  new_procedures=["절차1"],
  open_questions=["미해결1"]
)
```

reflect 규칙:
- 배열의 각 항목은 독립적으로 이해 가능한 원자적 사실 1건 (1~2문장)
- 여러 사실을 한 항목에 뭉치지 않는다
- 관련 파편들이 맥락상 연결되어 있다면 episode 유형 파편을 추가 생성
- contextSummary로 전후관계 요약을 첨부

## 키워드 작성 규칙 (가장 중요)

### 필수 포함 키워드

1. 프로젝트 작업인 경우: 프로젝트명을 keywords에 반드시 포함
   - 예: `keywords: ["memento-mcp", "oauth", "DCR"]`
   - topic도 프로젝트명으로 설정: `topic: "memento-mcp"`

2. 디바이스/호스트 구분이 가능한 경우: hostname 포함
   - 작업 디렉토리 경로에서 추출 (예: /home/nirna -> "nerdvana")
   - 환경변수, 시스템 정보에서 추출 (예: os.hostname())
   - 예: `keywords: ["memento-mcp", "nerdvana", "oauth"]`

3. reflect의 summary/decisions/errors_resolved에도 동일 규칙 적용

### workspace 파라미터 활용 규칙

- workspace: 프로젝트·직종·클라이언트 단위로 기억을 분리하려면 workspace 파라미터를 지정한다.
  예: `workspace: "memento-mcp"`, `workspace: "client-acme"`, `workspace: "personal"`
- 미지정 시 키의 default_workspace가 자동 적용된다.
- 전역 기억(모든 workspace에서 조회)으로 저장하려면 workspace를 지정하지 않고 키에 default_workspace도 없으면 된다.
- 검색 시 workspace를 지정하면 해당 workspace 파편과 workspace=NULL(전역) 파편이 함께 반환된다.

#### workspace 활용 예시

프로젝트별 기억 분리:
```
remember(content="...", topic="error", type="error", workspace="memento-mcp")
recall(keywords=["auth"], workspace="memento-mcp")
```

전역 기억 (모든 workspace에서 공유):
```
remember(content="선호하는 코딩 스타일: ...", topic="preference", type="preference")
// workspace 미지정 + 키에 default_workspace 없음 → workspace=NULL(전역)
```

### 키워드 품질 기준

- 3~5개 권장. 너무 적으면 검색 누락, 너무 많으면 노이즈
- 구체적이고 검색 가능한 단어 (X: "문제", "해결" / O: "nginx", "CORS", "proxy_pass")
- 약어와 전체명 혼용 가능 (예: "DCR", "dynamic-client-registration")

## 검색 전략 의사결정 트리

```
질문: "정확한 용어/키워드를 알고 있는가?"
  |
  +-- YES --> recall(keywords=["정확한용어"])
  |           * 가장 빠름 (L1 ILIKE -> L2 pgvector)
  |           * 설정값, 포트번호, 파일 경로 등 검색에 최적
  |
  +-- NO --> "자연어로 설명할 수 있는가?"
              |
              +-- YES --> recall(text="자연어 설명")
              |           * L3 시맨틱 검색 (임베딩 + RRF)
              |           * 개념적 유사성 기반 검색
              |
              +-- 둘 다 --> recall(keywords=["키워드"], text="보충 설명")
                            * L1+L2+L3 병합. 최고 품질.
                            * 토큰 비용 가장 높음

추가 필터:
  - topic="프로젝트명"   --> 프로젝트별 검색 범위 제한
  - type="error"         --> 에러만 검색
  - timeRange={from, to} --> 시간 범위 제한
  - includeLinks=true    --> 연결된 파편 1-hop 포함 (기본값)
  - includeContext=true   --> episode의 context_summary + 인접 파편 포함
```

## 토큰 예산 관리

| 상황 | tokenBudget | 근거 |
|------|-------------|------|
| 세션 시작 context | 2000 (기본) | 핵심 기억만 로드 |
| 일반 recall | 1000 (기본) | 대부분의 질문에 충분 |
| 깊은 조사 | 3000~5000 | 복잡한 주제, 다수 파편 필요 시 |
| 에러 디버깅 | 2000 | 에러+해결책+관련 컨텍스트 |

tokenBudget을 초과하면 중요도 낮은 파편부터 잘림. 중요한 정보가 누락되면 tokenBudget을 올려서 재검색.

## recall 결과 해석

```json
{
  "fragments": [{
    "id": "frag-abc123",
    "content": "...",
    "similarity": 0.85,      // L3 시맨틱 유사도 (0~1). 0.7 이상이면 높은 관련성.
    "stale_warning": true     // true면 오래된 파편. 정보가 현재와 다를 수 있음.
  }],
  "searchPath": "L1+L2+RRF", // 사용된 검색 경로
  "_searchEventId": 12345     // tool_feedback에 전달하여 검색 품질 개선
}
```

- similarity 0.7 이상: 높은 관련성
- similarity 0.4~0.7: 참고 수준
- stale_warning: 파편이 오래되었거나 접근 빈도가 낮음. 내용을 재확인하고 필요시 amend나 supersedes로 갱신.
- searchPath: 어떤 검색 경로가 사용되었는지 확인. L1만 사용됐으면 키워드가 정확히 매칭된 것.

## 에피소드 기억 활용

에피소드(episode)는 개별 사실(fact)과 함께 사용하여 "안다"와 "이해한다"를 모두 커버한다.

### 사실 vs 에피소드

| 사실 (fact) | 에피소드 (episode) |
|-------------|-------------------|
| "nginx 포트는 3999" | "nginx SSL 설정 과정: 처음에 443을 시도했으나 well-known 포트 금지 규칙에 따라 3999로 변경. certbot으로 인증서 발급 후 ssl-params에 경로 설정." |
| 검색이 정확하고 빠름 | 전후관계와 이유를 보존 |
| recall(keywords=["nginx","포트"]) | recall(text="nginx 설정 과정", includeContext=true) |

### 에피소드 저장 시점

- 복잡한 문제 해결 후: 시도 -> 실패 -> 원인분석 -> 해결의 전체 과정
- 아키텍처 결정 후: 대안 비교 -> 트레이드오프 분석 -> 최종 선택의 과정
- 여러 세션에 걸친 작업 완료 시: 전체 진행 경과 요약

```
remember(
  content="OAuth 구현 과정: DCR 엔드포인트 추가 -> Claude.ai가 client_id=Authorization을 보내는 버그 발견 -> auto-register로 우회 -> redirect_uri를 origin 기반으로 변경하여 ChatGPT connector 동적 경로 대응",
  type="episode",
  topic="memento-mcp",
  keywords=["memento-mcp", "oauth", "DCR", "nerdvana"],
  contextSummary="2026-04-02 세션에서 OAuth MCP 준수 구현. Claude.ai/ChatGPT 연동 완료."
)
```

## 다중 플랫폼/디바이스 기억 관리

기억은 API 키 단위로 격리된다. 같은 그룹의 키는 기억을 공유한다.

### 구성 예시

```
그룹: nerdvana
  +-- nerdvana-claude (Claude Code용)
  +-- nerdvana-cursor (Cursor용)
  +-- nerdvana-gpt (ChatGPT용)
  +-- nerdvana-GC (기존 기억 보관용)
```

이 구성에서 Claude Code에서 저장한 기억을 Cursor에서도 recall 가능.

### 키워드로 출처 구분

같은 그룹 내에서도 어떤 플랫폼/디바이스에서 생긴 기억인지 구분하려면:
- keywords에 플랫폼명 포함: `["memento-mcp", "claude-code", "nerdvana"]`
- recall 시 플랫폼 필터: `recall(keywords=["claude-code"])`

## 도구 레퍼런스 (16개)

### remember

새 파편을 생성한다. 반드시 1~2문장 단위의 원자적 사실 하나만 저장한다.

파라미터:

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| content | string | O | 기억할 내용. 1~3문장, 300자 이내. episode는 1000자. |
| topic | string | O | 주제 라벨. 프로젝트명 권장. |
| type | string | O | fact, decision, error, preference, procedure, relation, episode |
| keywords | string[] | - | 검색용 키워드. 3~5개. 프로젝트명+호스트네임 포함. |
| importance | number | - | 0.0~1.0. 미입력 시 type별 기본값. |
| source | string | - | 출처 (세션 ID, 도구명 등) |
| linkedTo | string[] | - | 연결할 기존 파편 ID 목록 |
| scope | string | - | permanent(기본) 또는 session |
| isAnchor | boolean | - | true면 영구 보존. 핵심 규칙/정책용. |
| supersedes | string[] | - | 대체할 기존 파편 ID. 지정 파편은 만료 처리. |
| contextSummary | string | - | 맥락/배경 요약 (1-2문장) |
| sessionId | string | - | 현재 세션 ID |
| agentId | string | - | 에이전트 ID (RLS 격리용) |
| workspace | string | - | 워크스페이스 이름. 미지정 시 키의 default_workspace 자동 적용. |
| caseId | string | - | 이 파편이 속한 케이스 ID. 미지정 시 session_id 사용 |
| goal | string | - | 에피소드 목표 (episode 타입 권장) |
| outcome | string | - | 에피소드 결과 |
| phase | string | - | 작업 단계 (예: planning, debugging, verification) |
| resolutionStatus | string | - | open / resolved / abandoned |
| assertionStatus | string | observed | observed / inferred / verified / rejected |

품질 게이트: content < 10자, URL만, type+topic null인 경우 거부. importance < 0.3이면 경고 + TTL short 자동 설정.

에러: fragment_limit_exceeded 시 forget/memory_consolidate로 정리 안내.

### batch_remember

여러 파편을 한번에 저장. 단일 트랜잭션, 최대 200건. episode/contextSummary/isAnchor/supersedes/linkedTo/scope 미지원.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| fragments | array | O | [{content, topic, type, importance?, keywords?}] 최대 200건 |
| agentId | string | - | 에이전트 ID |

### recall

파편 검색. 키워드/시맨틱/하이브리드 자동 선택.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| keywords | string[] | - | 키워드 검색 (L1->L2) |
| text | string | - | 자연어 쿼리 (L3 시맨틱) |
| topic | string | - | 주제 필터 |
| type | string | - | 타입 필터 (episode 제외. episode는 text/topic으로 검색) |
| tokenBudget | number | - | 최대 반환 토큰. 기본 1000. |
| includeLinks | boolean | - | 연결 파편 포함. 기본 true. |
| linkRelationType | string | - | 연결 관계 필터 |
| threshold | number | - | similarity 임계값 0~1 |
| includeSuperseded | boolean | - | 만료 파편 포함. 기본 false. |
| asOf | string | - | ISO 8601. 특정 시점 기준 유효 파편만. |
| timeRange | object | - | {from, to} 시간 범위. |
| cursor | string | - | 페이지네이션 커서 |
| pageSize | number | - | 기본 20, 최대 50 |
| excludeSeen | boolean | - | context()에서 주입된 파편 제외. 기본 true. |
| includeContext | boolean | - | context_summary + 인접 파편 포함 |
| includeKeywords | boolean | - | 응답에 keywords 배열 포함 |
| agentId | string | - | 에이전트 ID |
| workspace | string | - | 검색 범위 제한. 지정 시 해당 workspace + 전역(NULL) 파편만 반환. |

### forget

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | string | - | 삭제할 파편 ID |
| topic | string | - | 해당 주제 전체 삭제 |
| force | boolean | - | permanent 파편 강제 삭제. 기본 false. |
| agentId | string | - | 에이전트 ID |

### link

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| fromId | string | O | 시작 파편 ID |
| toId | string | O | 대상 파편 ID |
| relationType | string | - | related(기본), caused_by, resolved_by, part_of, contradicts |
| agentId | string | - | 에이전트 ID |

### amend

기존 파편 수정. 변경 필드만 전달.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | string | O | 수정할 파편 ID |
| content | string | - | 새 내용 |
| topic | string | - | 새 주제 |
| keywords | string[] | - | 새 키워드 |
| type | string | - | 새 유형 |
| importance | number | - | 새 중요도 |
| isAnchor | boolean | - | 고정 여부 |
| supersedes | boolean | - | 기존 파편 대체 |
| agentId | string | - | 에이전트 ID |

### reflect

세션 학습 내용을 원자 파편으로 영속화.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| summary | string/string[] | - | 세션 개요. 배열 권장 (1항목=1사실). |
| sessionId | string | - | 세션 ID |
| decisions | string[] | - | 결정 목록 (1항목=1결정) |
| errors_resolved | string[] | - | 해결 에러 ('원인: X -> 해결: Y') |
| new_procedures | string[] | - | 확립된 절차 |
| open_questions | string[] | - | 미해결 질문 |
| task_effectiveness | object | - | {overall_success, tool_highlights[], tool_pain_points[]} |
| agentId | string | - | 에이전트 ID |

summary 또는 sessionId 중 하나 이상 필수.

### context

세션 시작 시 핵심 기억 로드.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tokenBudget | number | - | 기본 2000 |
| types | string[] | - | 기본: preference, error, procedure |
| sessionId | string | - | 워킹 메모리 로드용 |
| structured | boolean | - | 계층 구조 반환. 기본 false. |
| agentId | string | - | 에이전트 ID |
| workspace | string | - | 컨텍스트 로드 범위. 지정 시 해당 workspace + 전역(NULL) 파편만 포함. |

### tool_feedback

도구 결과 유용성 피드백.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| tool_name | string | O | 도구명 |
| relevant | boolean | O | 결과 관련성 |
| sufficient | boolean | O | 결과 충분성 |
| suggestion | string | - | 개선 제안 (100자) |
| context | string | - | 사용 맥락 (50자) |
| session_id | string | - | 세션 ID |
| trigger_type | string | - | sampled 또는 voluntary |
| fragment_ids | string[] | - | 피드백 대상 파편 ID (EMA 조정) |
| search_event_id | integer | - | recall의 _searchEventId |

### memory_stats

기억 시스템 통계. 파라미터 없음.

### memory_consolidate

수동 GC 트리거. TTL 전환, 감쇠, 만료 삭제, 중복 병합. master key 전용. 파라미터 없음.

### graph_explore

에러 인과 관계 추적 (RCA). caused_by/resolved_by 1-hop.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| startId | string | O | 시작 파편 ID (error 권장) |
| agentId | string | - | 에이전트 ID |

### fragment_history

파편 변경 이력. amend 이전 버전 + superseded_by 체인.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| id | string | O | 조회할 파편 ID |

### get_skill_guide

이 문서(SKILL.md)의 내용을 반환. 전체 또는 섹션별 조회 가능. 플랫폼에 기억 도구 설정이 없는 경우 이 도구를 호출하여 최적 활용법을 안내한다.

| 이름 | 타입 | 필수 | 설명 |
|------|------|------|------|
| section | string | - | overview, lifecycle, keywords, search, episode, multiplatform, tools, importance |

미지정 시 전체 가이드(~12KB) 반환.

### reconstruct_history

**목적**: case_id 또는 entity 기반으로 작업 히스토리를 시간순 재구성한다. 인과 체인, 미해결 브랜치, case_events DAG를 함께 반환하여 복잡한 디버깅 세션의 전체 맥락을 파악할 수 있다.

**언제 사용**: 특정 케이스/이슈의 전체 흐름 파악, 인과 관계 분석, 미해결 문제 확인.

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| caseId | string | - | 재구성할 케이스 ID (caseId 또는 entity 중 하나 필수) |
| entity | string | - | topic/keywords ILIKE 필터 (caseId 없을 때 사용) |
| timeRange | object | - | { from: ISO8601, to: ISO8601 } 시간 범위 |
| query | string | - | content 키워드 추가 필터 |
| limit | number | 100 | 최대 반환 파편 수 (최대 500) |

반환값:
- `ordered_timeline`: 시간순 파편 배열
- `causal_chains`: BFS 인과 체인 배열 `{ root_id, chain[], length, is_resolved }`
- `unresolved_branches`: 미해결 파편 + error_observed 이벤트 배열
- `supporting_fragments`: 체인에 포함되지 않은 나머지 파편
- `case_events`: case_events 테이블 이벤트 배열 (caseId 지정 시)
- `event_dag`: case_event_edges 배열
- `summary`: 요약 문자열

**예시**:
```json
{ "caseId": "debug-auth-2026-04-01" }
```

### search_traces

**목적**: fragments 테이블을 grep하듯 선택적으로 탐색한다. reconstruct_history보다 경량하며, 특정 조건에 맞는 파편을 빠르게 조회할 때 사용한다.

**언제 사용**: 키워드 검색, 특정 세션/케이스의 파편 확인, 이벤트 타입별 필터링.

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| event_type | string | - | fragment type 필터 (fact, decision, error, procedure 등) |
| entity_key | string | - | topic ILIKE 필터 |
| keyword | string | - | content ILIKE 필터 |
| case_id | string | - | 특정 케이스 필터 |
| session_id | string | - | 특정 세션 필터 |
| time_range | object | - | { from: ISO8601, to: ISO8601 } |
| limit | number | 20 | 최대 반환 수 (최대 100) |

반환값: `{ success, traces[], count }`

**예시**:
```json
{ "keyword": "authentication", "event_type": "error", "limit": 10 }
```

## 중요도 기본값

| 타입 | 권장 | 근거 |
|------|------|------|
| preference | 0.9 | 사용자 의도 정확 반영 |
| error | 0.8 | 재발 시 즉시 해결 |
| procedure | 0.7 | 안정적 회상 필요 |
| decision | 0.7 | 모순 방지 |
| episode | 0.6 | 맥락 보존용 |
| fact | 0.5 | 일반 사실 |
| relation | 0.5 | 관계 기록 |

## 기억 저장 규칙

1. 간결성: 파편 하나에 하나의 개념. 300자 이내 (episode 1000자).
2. 범주화: topic에 프로젝트명. 검색 효율에 직결.
3. 키워드: 3~5개. 프로젝트명 + 호스트네임 + 구체적 용어.
4. 보안: API 키, 비밀번호, 토큰을 파편에 저장하지 않는다.
5. 앵커: 절대 변경되지 않는 핵심 규칙만 isAnchor=true.
6. 대체: 정보 업데이트 시 supersedes로 구 파편 연결. 새 파편이 구 파편을 대체.
7. 연결: 인과 관계가 있는 파편은 link로 즉시 연결. 나중에 graph_explore로 추적 가능.

## 검색 계층 구조

| 계층 | 방식 | 용도 | 속도 |
|------|------|------|------|
| L1 | PostgreSQL ILIKE | 정확한 용어 검색 | 가장 빠름 |
| L2 | pgvector cosine | 의미적 유사 검색 | 빠름 |
| L2.5 | 그래프 이웃 | 연결된 파편 확장 | 빠름 |
| L3 | RRF 하이브리드 | L1+L2 결과 합산 | 보통 |

recall 호출 시 keywords만 전달하면 L1->L2, text를 전달하면 L3까지 자동 확장.
