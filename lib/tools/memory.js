/**
 * 도구: 에이전트 기억 관리 (Fragment-Based Memory)
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-03-12
 *
 * MCP 도구 핸들러
 * remember, recall, forget, link, amend, reflect, context, memory_stats, memory_consolidate, graph_explore, fragment_history
 */

import { MemoryManager }    from "../memory/MemoryManager.js";
import { logAudit }         from "../utils.js";
import { SessionActivityTracker } from "../memory/SessionActivityTracker.js";
import { getSearchMetrics } from "../memory/SearchMetrics.js";

/** 스키마 re-export (기존 import 호환) */
export {
  rememberDefinition,
  recallDefinition,
  forgetDefinition,
  linkDefinition,
  amendDefinition,
  reflectDefinition,
  contextDefinition,
  toolFeedbackDefinition,
  memoryStatsDefinition,
  memoryConsolidateDefinition,
  graphExploreDefinition,
  fragmentHistoryDefinition
} from "./memory-schemas.js";

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
  const keyId = args._keyId ?? null;
  delete args._sessionId;
  if (keyId != null) {
    return { success: false, error: "memory_consolidate is master-key only" };
  }
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
