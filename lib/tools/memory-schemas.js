/**
 * 도구 스키마 정의: 에이전트 기억 관리 (Fragment-Based Memory)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-04-03 (Narrative Reconstruction Phase 1: caseId, goal, outcome, phase, resolutionStatus, assertionStatus 스키마 추가)
 *
 * 14개 MCP 도구의 inputSchema 정의
 */

export const rememberDefinition = {
  name       : "remember",
  description: "파편 기반 기억 저장. 반드시 1~2문장 단위의 원자적 사실 하나만 저장한다. " +
                 "세션 인트로(프로젝트 소개, 현재 상황 설명)·중요 사실·의사결정·에러·절차·선호 등 " +
                 "모든 맥락에서 동일하게 적용: 하나의 파편 = 하나의 사실. " +
                 "내용이 많으면 이 도구를 여러 번 호출하여 각각 저장할 것. " +
                 "여러 사실을 한 파편에 뭉치면 시맨틱 검색 정밀도가 저하된다.",
  inputSchema: {
    type      : "object",
    properties: {
      content: {
        type       : "string",
        description: "기억할 내용 (1~3문장, 300자 이내 권장)"
      },
      topic: {
        type       : "string",
        description: "주제 (예: database, email, deployment, security)"
      },
      type: {
        type       : "string",
        enum       : ["fact", "decision", "error", "preference", "procedure", "relation", "episode"],
        description: "파편 유형. fact=사실, decision=의사결정, error=에러, " +
                             "preference=사용자 선호, procedure=절차, relation=관계, episode=에피소드(1000자). " +
                             "episode 외 타입은 300자 초과 시 절삭."
      },
      keywords: {
        type       : "array",
        items      : { type: "string" },
        description: "검색용 키워드 (미입력 시 자동 추출)"
      },
      importance: {
        type       : "number",
        minimum    : 0,
        maximum    : 1,
        description: "중요도 0~1 (미입력 시 type별 기본값)"
      },
      source: {
        type       : "string",
        description: "출처 (세션 ID, 도구명 등)"
      },
      linkedTo: {
        type       : "array",
        items      : { type: "string" },
        description: "연결할 기존 파편 ID 목록"
      },
      scope: {
        type       : "string",
        enum       : ["permanent", "session"],
        description: "저장 범위. permanent=장기 기억(기본), session=세션 워킹 메모리(세션 종료 시 소멸)"
      },
      isAnchor: {
        type       : "boolean",
        description: "중요 파편 고정 여부. true 시 중요도 감쇠(decay) 및 만료 삭제 대상에서 제외됨."
      },
      supersedes: {
        type       : "array",
        items      : { type: "string" },
        description: "대체할 기존 파편 ID 목록. 지정된 파편은 valid_to가 설정되고 importance가 반감된다."
      },
      contextSummary: {
        type       : "string",
        description: "이 기억이 생긴 맥락/배경 요약 (1-2문장). recall 시 함께 반환되어 전후관계를 복원한다."
      },
      sessionId: {
        type       : "string",
        description: "현재 세션 ID. 같은 세션 파편을 시간 인접 번들로 묶는 데 사용."
      },
      workspace: {
        type       : "string",
        description: "워크스페이스 이름 (예: 'memento-mcp', 'personal', 'client-acme'). " +
                     "미지정 시 키의 default_workspace 적용. " +
                     "전역 기억(모든 워크스페이스에서 조회)으로 저장하려면 지정하지 않고 키에 default_workspace도 없어야 함."
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID (RLS 격리용)"
      },
      caseId: {
        type       : "string",
        description: "이 파편이 속한 작업/케이스 식별자. 미설정 시 현재 session_id로 자동 설정"
      },
      goal: {
        type       : "string",
        description: "에피소드 파편의 목표 (episode 타입 권장)"
      },
      outcome: {
        type       : "string",
        description: "에피소드 파편의 결과"
      },
      phase: {
        type       : "string",
        description: "작업 단계 (예: planning, debugging, verification)"
      },
      resolutionStatus: {
        type       : "string",
        enum       : ["open", "resolved", "abandoned"],
        description: "작업 해결 상태"
      },
      assertionStatus: {
        type       : "string",
        enum       : ["observed", "inferred", "verified", "rejected"],
        description: "파편의 신뢰도 수준. 기본값: observed"
      }
    },
    required: ["content", "topic", "type"]
  }
};

export const batchRememberDefinition = {
  name       : "batch_remember",
  description: "여러 파편을 한번에 저장 (대량 기억 입력용). " +
                 "단일 트랜잭션으로 최대 200건을 일괄 INSERT하여 HTTP 라운드트립을 최소화한다. " +
                 "개별 파편은 품질 게이트(validateContent)를 거치며, 부적합 파편은 건너뛴다.",
  inputSchema: {
    type      : "object",
    properties: {
      fragments: {
        type       : "array",
        items      : {
          type      : "object",
          properties: {
            content   : { type: "string", description: "기억할 내용 (1~3문장, 300자 이내 권장)" },
            topic     : { type: "string", description: "주제" },
            type      : {
              type: "string",
              enum: ["fact", "decision", "error", "preference", "procedure", "relation", "episode"],
              description: "파편 유형. episode 외 300자, episode 1000자 초과 시 절삭."
            },
            importance: { type: "number", minimum: 0, maximum: 1, description: "중요도 0~1" },
            keywords  : { type: "array", items: { type: "string" }, description: "검색용 키워드" },
            workspace : { type: "string", description: "워크스페이스 이름 (미지정 시 키의 default_workspace 적용)" }
          },
          required: ["content", "topic", "type"]
        },
        description: "저장할 파편 배열 (최대 200건)"
      },
      workspace: {
        type       : "string",
        description: "배치 기본 워크스페이스. 개별 파편에 workspace 미지정 시 이 값으로 대체. " +
                     "미지정 시 키의 default_workspace 적용."
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID (RLS 격리용)"
      }
    },
    required: ["fragments"]
  }
};

export const recallDefinition = {
  name       : "recall",
  description: "파편 기억 검색. 키워드, 주제, 유형, 자연어 쿼리로 관련 기억을 회상한다. " +
                 "keywords, text, topic 중 하나 이상 전달 권장. " +
                 "tokenBudget으로 반환량을 제어하여 컨텍스트 오염을 방지.",
  inputSchema: {
    type      : "object",
    properties: {
      keywords: {
        type       : "array",
        items      : { type: "string" },
        description: "검색 키워드"
      },
      topic: {
        type       : "string",
        description: "주제 필터"
      },
      type: {
        type       : "string",
        enum       : ["fact", "decision", "error", "preference", "procedure", "relation", "episode"],
        description: "유형 필터"
      },
      text: {
        type       : "string",
        description: "자연어 검색 쿼리 (시맨틱 검색 사용)"
      },
      tokenBudget: {
        type       : "number",
        description: "최대 반환 토큰 수 (기본 1000)"
      },
      includeLinks: {
        type       : "boolean",
        description: "연결된 파편 포함 여부 (기본 true, 1-hop 제한, resolved_by/caused_by 우선)"
      },
      linkRelationType: {
        type       : "string",
        enum       : ["related", "caused_by", "resolved_by", "part_of", "contradicts"],
        description: "연결 파편 관계 유형 필터 (미지정 시 caused_by, resolved_by, related 포함)"
      },
      threshold: {
        type       : "number",
        minimum    : 0,
        maximum    : 1,
        description: "similarity 임계값 (0~1). 이 값 미만의 파편은 결과에서 제외. similarity가 없는 L1/L2 결과는 필터링하지 않음 (기본 없음)"
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID"
      },
      includeSuperseded: {
        type       : "boolean",
        description: "true 시 superseded_by로 만료된 파편도 포함하여 검색. 기본 false."
      },
      asOf: {
        type       : "string",
        description: "특정 시점 기억 조회 (ISO 8601, 예: '2026-01-15T00:00:00Z'). 미지정 시 현재 유효한 파편만 반환"
      },
      cursor: {
        type       : "string",
        description: "페이지네이션 커서 (이전 결과의 nextCursor 값)"
      },
      pageSize: {
        type       : "number",
        description: "페이지 크기 (기본 20, 최대 50)"
      },
      excludeSeen: {
        type       : "boolean",
        description: "true(기본값) 시 이전 context() 호출에서 이미 주입된 파편을 결과에서 제외. " +
                       "false 시 모든 매칭 파편 반환."
      },
      includeKeywords: {
        type       : "boolean",
        description: "true 시 각 파편의 keywords 배열을 응답에 포함 (기본: false)"
      },
      includeContext: {
        type       : "boolean",
        description: "true이면 context_summary와 시간 인접 파편을 함께 반환한다. 토큰을 더 사용하지만 전후관계 복원이 가능."
      },
      timeRange: {
        type       : "object",
        description: "시간 범위 필터 (created_at 기준). 자연어 한국어 표현도 지원.",
        properties : {
          from: { type: "string", description: "시작 날짜. ISO 8601(예: 2026-03-15) 또는 자연어(예: '3일 전', '지난 주', '지난 화요일')" },
          to  : { type: "string", description: "종료 날짜. ISO 8601(예: 2026-03-16) 또는 자연어(예: '오늘', '어제')" }
        }
      },
      workspace: {
        type       : "string",
        description: "워크스페이스 필터. 지정 시 해당 workspace 파편 + 전역(NULL) 파편만 반환. " +
                     "미지정 시 키의 default_workspace 적용."
      },
      contextText: {
        type       : "string",
        description: "현재 대화 맥락 텍스트. 관련 파편을 선제적으로 활성화한다 (Spreading Activation)."
      },
      caseId: {
        type       : "string",
        description: "특정 케이스/작업 ID로 필터링. remember 시 지정한 caseId와 일치하는 파편만 반환."
      },
      resolutionStatus: {
        type       : "string",
        enum       : ["open", "resolved", "abandoned"],
        description: "해결 상태로 필터링."
      },
      phase: {
        type       : "string",
        description: "작업 단계로 필터링 (예: planning, debugging, verification, completed)."
      },
      minImportance: {
        type       : "number",
        minimum    : 0,
        maximum    : 1,
        description: "최소 중요도 필터. 이 값 이상의 importance를 가진 파편만 반환."
      },
      isAnchor: {
        type       : "boolean",
        description: "true 시 앵커(고정) 파편만 반환. 핵심 지식 조회에 유용."
      },
      caseMode: {
        type       : "boolean",
        description: "true 시 CBR(Case-Based Reasoning) 모드. " +
                     "유사 파편을 검색한 뒤 case_id별로 그루핑하여 " +
                     "(goal, events, outcome, resolution_status) 트리플로 반환. " +
                     "과거 유사 작업의 해결 사례를 참조할 때 사용."
      },
      maxCases: {
        type       : "number",
        description: "caseMode에서 반환할 최대 케이스 수 (기본 5, 상한 10)"
      },
      depth: {
        type       : "string",
        enum       : ["high-level", "detail", "tool-level"],
        description: "검색 깊이 필터. " +
                     "high-level: 의사결정/에피소드만 (Planner용). " +
                     "detail: 전체 (기본값). " +
                     "tool-level: 절차/에러/사실만 (Executor용)."
      }
    }
  }
};

export const forgetDefinition = {
  name       : "forget",
  description: "파편 기억 삭제. id 또는 topic 중 하나는 필수. " +
                 "permanent 계층 파편은 force 옵션이 필요.",
  inputSchema: {
    type      : "object",
    properties: {
      id: {
        type       : "string",
        description: "삭제할 파편 ID"
      },
      topic: {
        type       : "string",
        description: "해당 주제의 파편 전체 삭제"
      },
      force: {
        type       : "boolean",
        description: "permanent 파편도 강제 삭제 (기본 false)"
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID"
      }
    }
  }
};

export const linkDefinition = {
  name       : "link",
  description: "두 파편 사이에 관계를 설정한다. 인과, 해결, 구성, 모순 관계를 명시.",
  inputSchema: {
    type      : "object",
    properties: {
      fromId: {
        type       : "string",
        description: "시작 파편 ID"
      },
      toId: {
        type       : "string",
        description: "대상 파편 ID"
      },
      relationType: {
        type       : "string",
        enum       : ["related", "caused_by", "resolved_by", "part_of", "contradicts"],
        description: "관계 유형 (기본 related)"
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID"
      },
      weight: {
        type       : "number",
        description: "관계 가중치 (0-1, 기본 1)"
      }
    },
    required: ["fromId", "toId"]
  }
};

export const amendDefinition = {
  name       : "amend",
  description: "기존 파편의 내용이나 메타데이터를 갱신한다. ID와 링크를 보존하면서 " +
                 "content, topic, keywords, type, importance를 선택적으로 수정.",
  inputSchema: {
    type      : "object",
    properties: {
      id: {
        type       : "string",
        description: "갱신 대상 파편 ID (필수)"
      },
      content: {
        type       : "string",
        description: "새 내용 (300자 초과 시 절삭)"
      },
      topic: {
        type       : "string",
        description: "새 주제"
      },
      keywords: {
        type       : "array",
        items      : { type: "string" },
        description: "새 키워드 목록"
      },
      type: {
        type       : "string",
        enum       : ["fact", "decision", "error", "preference", "procedure", "relation"],
        description: "새 유형"
      },
      importance: {
        type       : "number",
        minimum    : 0,
        maximum    : 1,
        description: "새 중요도"
      },
      isAnchor: {
        type       : "boolean",
        description: "고정 파편 여부 설정"
      },
      supersedes: {
        type       : "boolean",
        description: "true 시 기존 파편을 명시적으로 대체(superseded_by 링크 생성 및 중요도 하향)"
      },
      assertionStatus: {
        type       : "string",
        enum       : ["observed", "inferred", "verified", "rejected"],
        description: "파편의 확인 상태 변경. verified: 검증 완료, rejected: 폐기. " +
                       "case_id가 있는 파편은 변경 시 verification_passed/verification_failed 이벤트가 자동 기록된다."
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID"
      }
    },
    required: ["id"]
  }
};

export const reflectDefinition = {
  name       : "reflect",
  description: "세션 종료 시 학습 내용을 원자 파편으로 영속화한다. " +
                 "각 배열 항목이 독립 파편으로 저장되므로 항목 하나에 하나의 사실/결정/절차만 담을 것. " +
                 "여러 내용을 한 항목에 나열하면 시맨틱 검색 정밀도가 저하된다. " +
                 "sessionId 전달 시 해당 세션의 기존 파편만 종합하여 사용(미입력 항목 자동 채움). " +
                 "summary 또는 sessionId 중 하나 이상 필요.",
  inputSchema: {
    type      : "object",
    properties: {
      summary: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } }
        ],
        description: "세션 개요 파편 목록. 배열 권장. 항목 1개 = 사실 1건 (1~2문장). " +
                       "문자열로 전달 시 내부에서 문장 단위로 분리하지만, 직접 배열로 쪼개면 더 정확하다. " +
                       "구체적 결정·에러·절차는 아래 배열에 별도 저장할 것. summary에 몰아넣지 말 것."
      },
      sessionId: {
        type       : "string",
        description: "세션 ID. 전달 시 같은 세션의 파편만 종합하여 reflect 수행"
      },
      decisions: {
        type       : "array",
        items      : { type: "string" },
        description: "기술/아키텍처 결정 목록. 항목 1개 = 결정 1건. " +
                       "내용이 길어지면 축약하지 말고 항목을 늘릴 것. " +
                       "예: ['pgvector 인덱스를 IVFFlat → HNSW로 교체 (정확도 우선)', 'Redis 캐시 TTL 600s로 설정']"
      },
      errors_resolved: {
        type       : "array",
        items      : { type: "string" },
        description: "해결된 에러 목록. 항목 1개 = 에러 1건. " +
                       "'원인: X → 해결: Y' 형식 권장. 내용이 길어지면 축약하지 말고 항목을 늘릴 것. " +
                       "예: ['valid_to 필터 누락으로 만료 파편 노출 → SELECT에 valid_to 조건 추가로 해결']"
      },
      new_procedures: {
        type       : "array",
        items      : { type: "string" },
        description: "확립된 절차/워크플로우 목록. 항목 1개 = 절차 1개. " +
                       "절차가 길면 단계별로 쪼개 여러 항목으로 저장할 것. 축약 금지. " +
                       "예: ['마이그레이션 순서: migration-003 → migration-004 (FK 의존성)']"
      },
      open_questions: {
        type       : "array",
        items      : { type: "string" },
        description: "미해결 질문 목록. 항목 1개 = 질문 1건. " +
                       "예: ['decay 감쇠 주기를 1일 vs 7일 중 어느 쪽이 적합한지 미결']"
      },
      narrative_summary: {
        type       : "string",
        description: "세션 전체를 3~5문장의 서사(narrative)로 요약. 사실 나열이 아니라 이야기로 작성. " +
                       "전달하면 episode 파편으로 저장되어 세션 간 맥락 연속성에 기여한다. " +
                       "생략 시 summary에서 자동 생성."
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID"
      },
      task_effectiveness: {
        type       : "object",
        description: "세션 전체의 도구 사용 효과성 종합 평가 (선택)",
        properties : {
          overall_success: {
            type       : "boolean",
            description: "세션의 주요 작업이 성공적으로 완료되었는가"
          },
          tool_highlights: {
            type       : "array",
            items      : { type: "string" },
            description: "특히 유용했던 도구와 이유 (예: 'recall - 이전 에러 해결 이력이 정확히 검색됨')"
          },
          tool_pain_points: {
            type       : "array",
            items      : { type: "string" },
            description: "불편했거나 개선이 필요한 도구와 이유 (예: 'db_query - 결과 페이징이 없어 대량 데이터 처리 불편')"
          }
        }
      }
    },
    required: []
  }
};

export const contextDefinition = {
  name       : "context",
  description: "Core Memory + Working Memory + session_reflect를 분리 로드한다. " +
                 "세션 시작 시 preference, error, procedure, decision 파편을 주입하여 맥락 유지. " +
                 "직전 세션의 reflect 파편(session_reflect 토픽)도 자동 포함. " +
                 "sessionId 전달 시 해당 세션의 워킹 메모리도 함께 반환. " +
                 "structured=true 시 계층적 트리 구조로 반환.",
  inputSchema: {
    type      : "object",
    properties: {
      tokenBudget: {
        type       : "number",
        description: "최대 토큰 수 (기본 2000)"
      },
      types: {
        type       : "array",
        items      : { type: "string" },
        description: "로드할 유형 목록 (기본: preference, error, procedure)"
      },
      sessionId: {
        type       : "string",
        description: "세션 ID (Working Memory 로드용)"
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID"
      },
      workspace: {
        type       : "string",
        description: "워크스페이스 필터. 지정 시 해당 workspace 파편 + 전역(NULL) 파편만 반환. " +
                     "미지정 시 키의 default_workspace 적용."
      },
      structured: {
        type       : "boolean",
        description: "true 시 계층적 트리 구조 반환, false/미지정 시 기존 flat list (기본값: false)"
      }
    }
  }
};

export const toolFeedbackDefinition = {
  name       : "tool_feedback",
  description: "도구 사용 결과에 대한 유용성 피드백. 대상 도구(recall, db_query, search_wiki 등)의 " +
                 "결과가 관련성 있었는지(relevant), 충분했는지(sufficient)를 평가한다. " +
                 "피드백 요청 메시지가 주입될 때 또는 도구 결과가 기대와 크게 다를 때 호출.",
  inputSchema: {
    type      : "object",
    properties: {
      tool_name: {
        type       : "string",
        description: "평가 대상 도구명 (필수)"
      },
      relevant: {
        type       : "boolean",
        description: "결과가 요청 의도와 관련 있었는가 (필수)"
      },
      sufficient: {
        type       : "boolean",
        description: "결과가 작업 완료에 충분했는가 (필수)"
      },
      suggestion: {
        type       : "string",
        description: "개선 제안 (선택, 100자 이내)"
      },
      context: {
        type       : "string",
        description: "사용 맥락 요약 (선택, 50자 이내)"
      },
      session_id: {
        type       : "string",
        description: "세션 ID (선택)"
      },
      trigger_type: {
        type       : "string",
        enum       : ["sampled", "voluntary"],
        description: "트리거 유형. sampled=훅 샘플링, voluntary=AI 자발적 (기본 voluntary)"
      },
      search_event_id: {
        type       : "integer",
        description: "직전 recall이 반환한 _searchEventId. 검색 품질 분석에 사용."
      },
      fragment_ids: {
        type       : "array",
        items      : { type: "string" },
        description: "피드백 대상 파편 ID 목록 (recall 결과에서 반환된 ID). 제공 시 해당 파편의 활성화 점수가 피드백에 따라 조정된다."
      }
    },
    required: ["tool_name", "relevant", "sufficient"]
  }
};

export const memoryStatsDefinition = {
  name       : "memory_stats",
  description: "파편 기억 시스템 통계 조회. 전체 파편 수, TTL 분포, 유형별 통계.",
  inputSchema: {
    type      : "object",
    properties: {}
  }
};

export const memoryConsolidateDefinition = {
  name       : "memory_consolidate",
  description: "파편 기억 유지보수 실행. TTL 전환, 중요도 감쇠, 만료 삭제, 중복 병합.",
  inputSchema: {
    type      : "object",
    properties: {}
  }
};

export const graphExploreDefinition = {
  name       : "graph_explore",
  description: "에러 파편 기점으로 인과 관계 체인을 추적한다. RCA(Root Cause Analysis) 전용. " +
               "caused_by, resolved_by 관계를 1-hop 추적하여 에러 원인과 해결 절차를 연결한다 (1-hop 고정, 다중 홉 미지원).",
  inputSchema: {
    type      : "object",
    properties: {
      startId: {
        type       : "string",
        description: "시작 파편 ID (error 파편 권장)"
      },
      agentId: {
        type       : "string",
        description: "에이전트 ID"
      }
    },
    required: ["startId"]
  }
};

export const fragmentHistoryDefinition = {
  name       : "fragment_history",
  description: "파편의 전체 변경 이력 조회. amend로 수정된 이전 버전과 superseded_by 체인을 반환한다.",
  inputSchema: {
    type      : "object",
    properties: {
      id: {
        type       : "string",
        description: "조회할 파편 ID (필수)"
      }
    },
    required: ["id"]
  }
};

export const getSkillGuideDefinition = {
  name       : "get_skill_guide",
  description: "Memento MCP 최적 활용 가이드를 반환한다. " +
                 "기억 도구 사용법, 세션 생명주기, 키워드 규칙, 검색 전략, " +
                 "에피소드 기억 활용법, 경험적 기억(Spreading Activation·Reconsolidation·Episode Continuity), " +
                 "다중 플랫폼 관리 등 포괄적 스킬 레퍼런스. " +
                 "플랫폼에 기억 도구 관련 설정(CLAUDE.md, 훅 등)이 없는 경우 이 가이드를 호출하여 참조한다.",
  inputSchema: {
    type      : "object",
    properties: {
      section: {
        type       : "string",
        description: "특정 섹션만 조회. 미지정 시 전체 가이드 반환. " +
                     "가능한 값: overview, lifecycle, keywords, search, episode, multiplatform, tools, importance, experiential, triggers, antipatterns"
      }
    }
  }
};

export const reconstructHistoryDefinition = {
  name       : "reconstruct_history",
  description: "case_id 또는 entity 기반으로 작업 히스토리를 시간순으로 재구성한다. " +
               "인과 체인과 미해결 브랜치를 포함하여 서사를 복원한다.",
  inputSchema: {
    type      : "object",
    properties: {
      caseId   : { type: "string", description: "재구성할 케이스 식별자" },
      entity   : { type: "string", description: "entity_key 필터 (caseId 없을 때 사용)" },
      timeRange: {
        type      : "object",
        properties: {
          from: { type: "string", description: "시작 시각 (ISO 8601)" },
          to  : { type: "string", description: "종료 시각 (ISO 8601)" }
        },
        description: "ISO 8601 시간 범위"
      },
      query    : { type: "string", description: "추가 키워드 필터" },
      limit    : { type: "number", description: "기본 100, 최대 500" },
      workspace: { type: "string", description: "워크스페이스 필터. 지정 시 해당 workspace + 전역(NULL) 파편만 대상." }
    }
  }
};

export const searchTracesDefinition = {
  name       : "search_traces",
  description: "fragments를 정확 매칭으로 탐색한다 (recall의 시맨틱 검색과 달리 content/type/case_id 텍스트 매칭). " +
               "event_type, entity, 키워드로 필터링하여 전체 히스토리를 grep하듯 조회.",
  inputSchema: {
    type      : "object",
    properties: {
      event_type: { type: "string", description: "필터할 fragment type (fact, error, decision 등)" },
      eventType : { type: "string", description: "event_type의 camelCase alias" },
      entity_key: { type: "string", description: "topic ILIKE 필터" },
      entityKey : { type: "string", description: "entity_key의 camelCase alias" },
      keyword   : { type: "string", description: "content 내 키워드 검색" },
      case_id   : { type: "string", description: "케이스 ID 필터" },
      caseId    : { type: "string", description: "case_id의 camelCase alias" },
      session_id: { type: "string", description: "세션 ID 필터" },
      sessionId : { type: "string", description: "session_id의 camelCase alias" },
      time_range: {
        type      : "object",
        properties: {
          from: { type: "string", description: "시작 시각 (ISO 8601)" },
          to  : { type: "string", description: "종료 시각 (ISO 8601)" }
        }
      },
      limit     : { type: "number", description: "기본 20, 최대 100" },
      workspace : { type: "string", description: "워크스페이스 필터. 지정 시 해당 workspace + 전역(NULL) 파편만 대상." }
    }
  }
};
