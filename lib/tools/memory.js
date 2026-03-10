/**
 * 도구: 에이전트 기억 관리 (Fragment-Based Memory)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-02-25
 *
 * MCP 도구 정의 및 핸들러
 * remember, recall, forget, link, amend, reflect, context, memory_stats, memory_consolidate, graph_explore
 */

import { MemoryManager }    from "../memory/MemoryManager.js";
import { logAudit }         from "../utils.js";
import { SessionActivityTracker } from "../memory/SessionActivityTracker.js";
import { getSearchMetrics } from "../memory/SearchMetrics.js";

/** ==================== 도구 정의 ==================== */

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
        enum       : ["fact", "decision", "error", "preference", "procedure", "relation"],
        description: "파편 유형. fact=사실, decision=의사결정, error=에러, " +
                             "preference=사용자 선호, procedure=절차, relation=관계"
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
      agentId: {
        type       : "string",
        description: "에이전트 ID (RLS 격리용)"
      }
    },
    required: ["content", "topic", "type"]
  }
};

export const recallDefinition = {
  name       : "recall",
  description: "파편 기억 검색. 키워드, 주제, 유형, 자연어 쿼리로 관련 기억을 회상한다. " +
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
        enum       : ["fact", "decision", "error", "preference", "procedure", "relation"],
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
      }
    }
  }
};

export const forgetDefinition = {
  name       : "forget",
  description: "파편 기억 삭제. 특정 ID, 주제, 또는 오래된 파편을 삭제한다. " +
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
                 "sessionId 전달 시 해당 세션의 워킹 메모리도 함께 반환.",
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

/** ==================== 도구 핸들러 ==================== */

export async function tool_remember(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.remember(args);
    await logAudit("remember", {
      topic     : args.topic,
      type      : args.type,
      fragmentId: result.id,
      success   : true
    });
    SessionActivityTracker.record(sessionId, {
      tool: "remember", keywords: args.keywords, fragmentId: result.id
    }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("remember", {
      topic  : args.topic,
      type   : args.type,
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_recall(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    /**
     * asOf → anchorTime 변환: 일반 recall 경로로 통합.
     * 과거 시점 기준 복합 랭킹이 해당 시점 근접 파편을 우선 배치한다.
     */
    if (args.asOf) {
      const asOfDate = new Date(args.asOf);
      if (isNaN(asOfDate.getTime())) {
        return { success: false, error: `Invalid asOf: "${args.asOf}"` };
      }
      args.anchorTime = asOfDate.getTime();
      delete args.asOf;
    }

    const result = await mgr.recall(args);
    SessionActivityTracker.record(sessionId, {
      tool: "recall", keywords: args.keywords || [args.text?.substring(0, 30)]
    }).catch(() => {});

    const fragments = result.fragments.map(f => ({
      id        : f.id,
      content   : f.content,
      topic     : f.topic,
      type      : f.type,
      importance: f.importance,
      ...(f.similarity !== undefined ? { similarity: f.similarity } : {}),
      ...(f.metadata?.stale       ? { stale_warning: f.metadata.warning } : {})
    }));

    return {
      success    : true,
      fragments,
      count      : fragments.length,
      totalTokens: result.totalTokens,
      searchPath : result.searchPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function tool_forget(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.forget(args);
    await logAudit("forget", {
      fragmentId: args.id   || "-",
      topic     : args.topic || "-",
      success   : true,
      details   : result.deleted ? `deleted ${result.deleted}` : undefined
    });
    SessionActivityTracker.record(sessionId, { tool: "forget" }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("forget", {
      fragmentId: args.id || "-",
      success   : false,
      details   : err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_link(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.link(args);
    await logAudit("link", {
      fragmentId: args.fromId || "-",
      success   : true,
      details   : `${args.fromId} -> ${args.toId}`
    });
    SessionActivityTracker.record(sessionId, { tool: "link" }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("link", {
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_amend(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.amend(args);
    await logAudit("amend", {
      fragmentId: args.id,
      success   : result.updated,
      details   : result.merged ? `merged with ${result.existingId}` : undefined
    });
    SessionActivityTracker.record(sessionId, { tool: "amend", fragmentId: args.id }).catch(() => {});
    return { success: result.updated, ...result };
  } catch (err) {
    await logAudit("amend", {
      fragmentId: args.id,
      success   : false,
      details   : err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_reflect(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  if (sessionId && !args.sessionId) args.sessionId = sessionId;
  try {
    const result = await mgr.reflect(args);
    await logAudit("reflect", {
      sessionId : args.sessionId,
      count     : result.count,
      success   : true
    });
    SessionActivityTracker.record(sessionId, { tool: "reflect" }).catch(() => {});
    SessionActivityTracker.markReflected(sessionId).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    await logAudit("reflect", {
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_context(args) {
  const mgr       = MemoryManager.getInstance();
  const sessionId = args._sessionId;
  delete args._sessionId;
  try {
    const result = await mgr.context(args);
    SessionActivityTracker.record(sessionId, { tool: "context" }).catch(() => {});
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function tool_toolFeedback(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.toolFeedback(args);
    await logAudit("tool_feedback", {
      tool_name : args.tool_name,
      relevant  : args.relevant,
      sufficient: args.sufficient,
      success   : true
    });
    return { success: true, ...result };
  } catch (err) {
    await logAudit("tool_feedback", {
      tool_name: args.tool_name,
      success  : false,
      details  : err.message
    });
    return { success: false, error: err.message };
  }
}

export async function tool_memoryStats(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result          = await mgr.stats();
    const searchMetrics   = await getSearchMetrics();
    const searchLatencyMs = await searchMetrics.getStats();

    const { computeRollingPrecision, computeTaskSuccessRate } = await import("../memory/EvaluationMetrics.js");
    const [evaluation, taskSuccess] = await Promise.all([
      computeRollingPrecision(100).catch(() => ({ precision_at_5: null, sample_sessions: 0, sufficient_rate: null })),
      computeTaskSuccessRate(30).catch(() => ({ success_rate: null, total_sessions: 0 }))
    ]);

    return {
      success: true,
      stats: {
        ...result,
        searchLatencyMs,
        evaluation: {
          rolling_precision_at_5: evaluation.precision_at_5,
          sufficient_rate        : evaluation.sufficient_rate,
          sample_sessions        : evaluation.sample_sessions,
          task_success_rate      : taskSuccess.success_rate,
          task_sessions          : taskSuccess.total_sessions
        }
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function tool_memoryConsolidate(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.consolidate();
    await logAudit("consolidate", {
      success: true,
      details: result.summary || undefined
    });
    return { success: true, ...result };
  } catch (err) {
    await logAudit("consolidate", { success: false, details: err.message });
    return { success: false, error: err.message };
  }
}

export const graphExploreDefinition = {
  name       : "graph_explore",
  description: "에러 파편 기점으로 인과 관계 체인을 추적한다. RCA(Root Cause Analysis) 전용. " +
               "caused_by, resolved_by 관계를 1-hop 추적하여 에러 원인과 해결 절차를 연결한다.",
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

export async function tool_graphExplore(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.graphExplore(args);
    if (result.error) {
      return { success: false, ...result };
    }
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

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

export async function tool_fragmentHistory(args) {
  delete args._sessionId;
  const mgr = MemoryManager.getInstance();
  try {
    const result = await mgr.fragmentHistory(args);
    if (result.error) {
      return { success: false, ...result };
    }
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
