/**
 * 도구 핸들러: reconstruct_history, search_traces
 *
 * 작성자: 최진호
 * 작성일: 2026-04-03
 *
 * Narrative Reconstruction Phase 2 도구 구현
 * - reconstruct_history: case_id/entity 기반 서사 재구성
 * - search_traces:       fragments 탐색 (grep-like)
 */

import { MemoryManager }  from "../memory/MemoryManager.js";
import { getPrimaryPool } from "./db.js";
import { logAudit }       from "../utils.js";

export {
  reconstructHistoryDefinition,
  searchTracesDefinition
} from "./memory-schemas.js";

const SCHEMA = "agent_memory";

/** ==================== reconstruct_history ==================== */

/**
 * case_id 또는 entity 기반으로 작업 히스토리를 시간순 재구성한다.
 *
 * @param {Object} args
 * @param {string}      [args.caseId]
 * @param {string}      [args.entity]
 * @param {Object}      [args.timeRange]
 * @param {string}      [args.query]
 * @param {number}      [args.limit]
 * @param {number|null} [args._keyId]
 * @param {string|null} [args._defaultWorkspace]
 */
export async function tool_reconstructHistory(args) {
  const keyId     = args._keyId             ?? null;
  const workspace = args.workspace          ?? args._defaultWorkspace ?? null;
  delete args._sessionId;

  if (!args.caseId && !args.entity) {
    return { success: false, error: "caseId 또는 entity 중 하나는 필수입니다." };
  }

  const mgr = MemoryManager.getInstance();

  try {
    const result = await mgr.reconstructHistory({
      caseId   : args.caseId    ?? null,
      entity   : args.entity    ?? null,
      timeRange: args.timeRange ?? null,
      query    : args.query     ?? null,
      limit    : args.limit     ?? 100,
      keyId,
      workspace
    });

    await logAudit("reconstruct_history", {
      caseId   : args.caseId,
      entity   : args.entity,
      total    : result.ordered_timeline.length,
      success  : true
    });

    return {
      success             : true,
      ordered_timeline    : result.ordered_timeline,
      causal_chains       : result.causal_chains,
      unresolved_branches : result.unresolved_branches,
      supporting_fragments: result.supporting_fragments,
      summary             : result.summary
    };
  } catch (err) {
    await logAudit("reconstruct_history", {
      caseId : args.caseId,
      entity : args.entity,
      success: false,
      details: err.message
    });
    return { success: false, error: err.message };
  }
}

/** ==================== search_traces ==================== */

/**
 * fragments 테이블을 grep하듯 선택적으로 탐색한다.
 *
 * @param {Object}      args
 * @param {string}      [args.event_type]
 * @param {string}      [args.entity_key]  - topic ILIKE 필터로 매핑
 * @param {string}      [args.keyword]     - content ILIKE 필터
 * @param {string}      [args.case_id]
 * @param {string}      [args.session_id]
 * @param {Object}      [args.time_range]  - { from: ISO8601, to: ISO8601 }
 * @param {number}      [args.limit]       - 기본 20, 최대 100
 * @param {number|null} [args._keyId]
 * @param {string|null} [args._defaultWorkspace]
 */
export async function tool_searchTraces(args) {
  const keyId     = args._keyId             ?? null;
  const workspace = args.workspace          ?? args._defaultWorkspace ?? null;
  delete args._sessionId;

  const limit = Math.min(args.limit ?? 20, 100);

  try {
    const traces = await _queryFragmentTraces({
      event_type : args.event_type  ?? null,
      entity_key : args.entity_key  ?? null,
      keyword    : args.keyword     ?? null,
      case_id    : args.case_id     ?? null,
      session_id : args.session_id  ?? null,
      time_range : args.time_range  ?? null,
      limit,
      keyId,
      workspace
    });

    return {
      success: true,
      traces,
      count  : traces.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * fragments 테이블 탐색 쿼리
 *
 * @private
 */
async function _queryFragmentTraces({ event_type, entity_key, keyword, case_id, session_id, time_range, limit, keyId, workspace }) {
  const pool   = getPrimaryPool();
  const params = [];

  /** $1: case_id */
  params.push(case_id ?? null);
  const caseIdx = params.length;

  /** $2: session_id */
  params.push(session_id ?? null);
  const sessIdx = params.length;

  /** $3: content keyword */
  params.push(keyword ? `%${keyword}%` : null);
  const kwIdx = params.length;

  /** $4: entity_key → topic ILIKE */
  params.push(entity_key ? `%${entity_key}%` : null);
  const entityIdx = params.length;

  /** $5: event_type → fragment type 필터 */
  params.push(event_type ?? null);
  const typeIdx = params.length;

  /** $6, $7: 시간 범위 */
  params.push(time_range?.from ?? null);
  const fromIdx = params.length;
  params.push(time_range?.to ?? null);
  const toIdx = params.length;

  /** $8: key_id 격리 */
  params.push(keyId ?? null);
  const keyIdx = params.length;

  /** $9: workspace 격리 */
  params.push(workspace ?? null);
  const wsIdx = params.length;

  /** $10: limit */
  params.push(limit);
  const limitIdx = params.length;

  const sql = `
    SELECT f.id, f.content, f.type, f.topic, f.case_id, f.session_id,
           f.resolution_status, f.importance, f.created_at,
           'fragment' AS source
      FROM ${SCHEMA}.fragments f
     WHERE ($${caseIdx}::text  IS NULL OR f.case_id    = $${caseIdx})
       AND ($${sessIdx}::text  IS NULL OR f.session_id = $${sessIdx})
       AND ($${kwIdx}::text    IS NULL OR f.content    ILIKE $${kwIdx})
       AND ($${entityIdx}::text IS NULL OR f.topic     ILIKE $${entityIdx})
       AND ($${typeIdx}::text  IS NULL OR f.type       = $${typeIdx})
       AND ($${fromIdx}::timestamptz IS NULL OR f.created_at >= $${fromIdx})
       AND ($${toIdx}::timestamptz   IS NULL OR f.created_at <= $${toIdx})
       AND (f.key_id IS NULL OR f.key_id = $${keyIdx})
       AND ($${wsIdx}::text IS NULL OR f.workspace = $${wsIdx} OR f.workspace IS NULL)
       AND f.valid_to IS NULL
     ORDER BY f.created_at DESC
     LIMIT $${limitIdx}`;

  const { rows } = await pool.query(sql, params);
  return rows;
}
