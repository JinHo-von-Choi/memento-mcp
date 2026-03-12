/**
 * MemoryConsolidator - TTL 전환, 중복 제거, 망각 관리, 모순 탐지
 *
 * 작성자: 최진호
 * 작성일: 2026-02-23
 * 수정일: 2026-02-28
 *
 * 주기적 유지보수 작업을 수행하여 파편 저장소 건강도 유지
 * utility_score 갱신, 증분 모순 탐지(Gemini Flash)
 */

import { FragmentStore }    from "./FragmentStore.js";
import { FragmentIndex }    from "./FragmentIndex.js";
import { EmbeddingWorker }  from "./EmbeddingWorker.js";
import { getPrimaryPool, queryWithAgentVector } from "../tools/db.js";
import { MEMORY_CONFIG } from "../../config/memory.js";
import { logInfo, logWarn, logError } from "../logger.js";
import { ContradictionDetector } from "./ContradictionDetector.js";
import { ConsolidatorGC }        from "./ConsolidatorGC.js";

const SCHEMA = "agent_memory";

export class MemoryConsolidator {
  constructor() {
    this.store                = new FragmentStore();
    this.index                = new FragmentIndex();
    this.contradictionDetector = new ContradictionDetector(this.store);
    this.consolidatorGC        = new ConsolidatorGC(this.store);
  }

  /**
     * 전체 유지보수 실행 (master key 전용)
     * @returns {Object} 작업 결과 요약
     */
  async consolidate() {
    const results = {
      ttlTransitions       : 0,
      importanceDecay      : false,
      expiredDeleted       : 0,
      fragmentsSplit       : 0,
      duplicatesMerged     : 0,
      embeddingsAdded      : 0,
      retroLinked          : 0,
      utilityUpdated       : 0,
      anchorsPromoted      : 0,
      contradictionsFound       : 0,
      nliResolvedDirectly       : 0,
      nliSkippedAsNonContra     : 0,
      feedbackReportGenerated   : false,
      gcCandidatesByType       : {},
      indexesPruned            : false,
      supersessionsDetected    : 0,
      stale_fragments          : [],
      reflectionsPurged        : 0
    };

    try {
      /** 1. TTL 계층 전환 (전환 수 추적) */
      results.ttlTransitions = await this._transitionWithCount();

      /** 2. 중요도 감쇠 */
      await this.store.decayImportance();
      results.importanceDecay = true;

      /** 3. 만료 파편 삭제 */
      results.expiredDeleted = await this.store.deleteExpired();

      /** 3.5. GC 후보 분포 미리보기 */
      try {
        const gcPreview = await queryWithAgentVector("system",
          `SELECT type, COUNT(*) as cnt FROM ${SCHEMA}.fragments
           WHERE utility_score < ${MEMORY_CONFIG.gc?.utilityThreshold || 0.15}
             AND ttl_tier NOT IN ('permanent') AND is_anchor = FALSE
           GROUP BY type`,
          []
        );
        results.gcCandidatesByType = Object.fromEntries(
          gcPreview.rows.map(r => [r.type, parseInt(r.cnt)])
        );
      } catch (err) {
        logWarn(`[MemoryConsolidator] GC preview query failed: ${err.message}`);
        results.gcCandidatesByType = {};
      }

      /** 3.7. 긴 파편 분할 (Gemini CLI) */
      results.fragmentsSplit = await this._splitLongFragments();

      /** 4. 중복 파편 병합 */
      results.duplicatesMerged = await this._mergeDuplicates();

      /** 5. 누락 임베딩 보충 */
      const _embWorker = new EmbeddingWorker();
      results.embeddingsAdded = await _embWorker.processOrphanFragments(5);

      /** 5.5. 소급 자동 링크 (고립 파편 연결) */
      const { GraphLinker } = await import("./GraphLinker.js");
      const linker          = new GraphLinker();
      const retroResult     = await linker.retroLink(20);
      results.retroLinked   = retroResult.linksCreated;

      /** 6. utility_score 갱신 */
      results.utilityUpdated = await this._updateUtilityScores();

      /** 6.5. 자동 앵커 승격 (Phase 3) */
      results.anchorsPromoted = await this._promoteAnchors();

      /** 7. 증분 모순 탐지 (NLI + Gemini CLI 하이브리드) */
      const contraResult = await this._detectContradictions();
      results.contradictionsFound   = contraResult.found;
      results.nliResolvedDirectly   = contraResult.nliResolved;
      results.nliSkippedAsNonContra = contraResult.nliSkipped;

      /** 7.7. supersession 배치 감지 (같은 topic+type, similarity 0.7~0.85) */
      results.supersessionsDetected = await this._detectSupersessions();

      /** 7.5. 보류 중인 모순 후처리 */
      results.pendingContradictions = await this._processPendingContradictions();

      /** 8. 피드백 리포트 생성 */
      results.feedbackReportGenerated = await this._generateFeedbackReport();

      /** 8.5. 피드백 적응형 importance 보정 */
      const calibrated = await this._calibrateByFeedback().catch(() => 0);
      if (calibrated > 0) {
        logWarn(`[MemoryConsolidator] Feedback calibration: ${calibrated} fragments updated`);
      }

      /** 9. Redis 인덱스 정리 */
      await this.index.pruneKeywordIndexes();
      results.indexesPruned = true;

      /** 10. stale 파편 목록 수집 */
      results.stale_fragments = await this._collectStaleFragments();

      /** 11. session_reflect 노이즈 정리 */
      results.reflectionsPurged = await this._purgeStaleReflections();

    } catch (err) {
      logError(`[MemoryConsolidator] consolidation error: ${err.message}`, err);
      results.error = err.message;
    }

    logInfo("[MemoryConsolidator] Result:", { results });
    return results;
  }

  /**
     * 유사도 기반 중복 파편 병합
     */
  async _mergeDuplicates() {
    const result = await queryWithAgentVector("system",
      `WITH dups AS (
                SELECT content_hash,
                       array_agg(id ORDER BY importance DESC, created_at ASC) AS ids,
                       count(*) AS cnt
                FROM ${SCHEMA}.fragments
                GROUP BY content_hash
                HAVING count(*) > 1
             )
             SELECT * FROM dups LIMIT 50`
    );

    let merged = 0;

    for (const dup of result.rows) {
      const keepId    = dup.ids[0];
      const removeIds = dup.ids.slice(1);

      for (const rid of removeIds) {
        /** 링크를 승계자에게 이전 */
        await queryWithAgentVector("system",
          `UPDATE ${SCHEMA}.fragments
                     SET linked_to = array_append(
                         CASE WHEN NOT ($1 = ANY(linked_to)) THEN linked_to ELSE linked_to END, $1
                     )
                     WHERE id = ANY($2) AND NOT ($1 = ANY(linked_to))
                     RETURNING id`,
          [keepId, [rid]],
          "write"
        );

        /** linked_to 참조를 승계자로 교체 */
        await queryWithAgentVector("system",
          `UPDATE ${SCHEMA}.fragments
                     SET linked_to = array_replace(linked_to, $1, $2)
                     WHERE $1 = ANY(linked_to)`,
          [rid, keepId],
          "write"
        );

        await this.store.delete(rid, "system");
        merged++;
      }
    }

    return merged;
  }

  /**
     * TTL 전환 + 전환 수 추적
     * 전환 전후의 ttl_tier 분포를 비교하여 실제 전환 건수를 반환한다.
     */
  async _transitionWithCount() {
    const before = await queryWithAgentVector("system",
      `SELECT ttl_tier, count(*)::int AS cnt
             FROM ${SCHEMA}.fragments GROUP BY ttl_tier`
    );
    const beforeMap = new Map(before.rows.map(r => [r.ttl_tier, r.cnt]));

    await this.store.transitionTTL();

    const after = await queryWithAgentVector("system",
      `SELECT ttl_tier, count(*)::int AS cnt
             FROM ${SCHEMA}.fragments GROUP BY ttl_tier`
    );

    let transitions = 0;
    for (const row of after.rows) {
      const prev = beforeMap.get(row.ttl_tier) || 0;
      const diff = Math.abs(row.cnt - prev);
      transitions += diff;
    }

    return Math.floor(transitions / 2);
  }

  /**
     * utility_score 갱신
     * score = importance * (1 + ln(max(access_count, 1)))
     * permanent 파편 포함 계산, 단 eviction 대상에서는 제외.
     */
  async _updateUtilityScores() {
    const result = await queryWithAgentVector("system",
      `UPDATE ${SCHEMA}.fragments
             SET utility_score = importance * (1.0 + LN(GREATEST(access_count, 1)))
             WHERE utility_score IS DISTINCT FROM
                   importance * (1.0 + LN(GREATEST(access_count, 1)))`,
      [],
      "write"
    );

    return result.rowCount;
  }

  /**
     * 앵커 파편 승격
     * 조건: access_count >= 10, importance >= 0.8
     */
  async _promoteAnchors() {
    const result = await queryWithAgentVector("system",
      `UPDATE ${SCHEMA}.fragments
             SET is_anchor = TRUE
             WHERE is_anchor = FALSE
               AND access_count >= 10
               AND importance >= 0.8`,
      [],
      "write"
    );

    return result.rowCount;
  }

  /**
     * 증분 모순 탐지 (3단계 하이브리드 파이프라인)
     *
     * Stage 1: pgvector 코사인 유사도 > 0.85 → 후보 필터링
     * Stage 2: NLI 분류 → 명확한 모순(conf >= 0.8) 즉시 해소, entailment 즉시 통과
     * Stage 3: Gemini CLI 에스컬레이션 → NLI 불확실 케이스(수치/도메인 모순)
     *
     * NLI 미가용 시 기존 로직으로 폴백 (Gemini CLI 또는 pending 큐).
     *
     * @returns {number} 발견된 모순 쌍 수
     */
  async _detectContradictions() {
    return this.contradictionDetector.detectContradictions();
  }

  /**
   * 모순 확인 시 contradicts 링크 + 시간 논리 기반 해소
   */
  async _resolveContradiction(newFrag, candidate, reasoning) {
    await this.store.createLink(newFrag.id, candidate.id, "contradicts", "system");

    const newDate = new Date(newFrag.created_at);
    const oldDate = new Date(candidate.created_at);

    if (newDate > oldDate) {
      if (!candidate.is_anchor) {
        await queryWithAgentVector("system",
          `UPDATE ${SCHEMA}.fragments SET importance = importance * 0.5 WHERE id = $1`,
          [candidate.id], "write"
        );
      }
      await this.store.createLink(candidate.id, newFrag.id, "superseded_by", "system");
      await queryWithAgentVector("system",
        `UPDATE ${SCHEMA}.fragments SET valid_to = NOW()
         WHERE id = $1 AND valid_to IS NULL`,
        [candidate.id], "write"
      );
    } else {
      await queryWithAgentVector("system",
        `UPDATE ${SCHEMA}.fragments SET importance = importance * 0.5 WHERE id = $1`,
        [newFrag.id], "write"
      );
      await this.store.createLink(newFrag.id, candidate.id, "superseded_by", "system");
      await queryWithAgentVector("system",
        `UPDATE ${SCHEMA}.fragments SET valid_to = NOW()
         WHERE id = $1 AND valid_to IS NULL`,
        [newFrag.id], "write"
      );
    }

    try {
      const winner  = newDate > oldDate ? newFrag   : candidate;
      const loser   = newDate > oldDate ? candidate : newFrag;
      const { MemoryManager } = await import("./MemoryManager.js");
      const mgr = MemoryManager.getInstance();

      await mgr.remember({
        content   : `[모순 해결] "${(loser.content  || "").substring(0, 80)}" 파편이 "${(winner.content || "").substring(0, 80)}" 으로 대체됨. 판단 근거: ${reasoning || "시간 순서 기준"}`,
        type      : "decision",
        topic     : newFrag.topic || "contradiction",
        keywords  : ["contradiction", "superseded", "resolved", ...(newFrag.keywords || []).slice(0, 3)],
        importance: 0.6,
        isAnchor  : false,
        linkedTo  : [winner.id, loser.id]
      });
    } catch (auditErr) {
      logWarn(`[MemoryConsolidator] Contradiction audit record failed: ${auditErr.message}`);
    }

    logInfo(`[MemoryConsolidator] Contradiction resolved: ${newFrag.id} <-> ${candidate.id}: ${reasoning}`);
  }

  async _detectSupersessions() {
    return this.contradictionDetector.detectSupersessions();
  }

  async _askGeminiSupersession(contentA, contentB) {
    return this.contradictionDetector.askGeminiSupersession(contentA, contentB);
  }

  async _askGeminiContradiction(contentA, contentB) {
    return this.contradictionDetector.askGeminiContradiction(contentA, contentB);
  }

  async _flagPotentialContradiction(redisClient, key, fragA, fragB) {
    return this.contradictionDetector.flagPotentialContradiction(redisClient, key, fragA, fragB);
  }

  async _processPendingContradictions() {
    return this.contradictionDetector.processPendingContradictions();
  }

  async _updateContradictionTimestamp(redisClient, key, timestamp) {
    return this.contradictionDetector.updateContradictionTimestamp(redisClient, key, timestamp);
  }

  /**
     * 피드백 리포트 생성
     *
     * tool_feedback + task_feedback 데이터를 집계하여
     * 도구별 관련성/충분성 비율, 주요 개선 제안을 산출한다.
     * 최소 피드백 10건 이상인 도구만 통계 표시.
     *
     * @returns {boolean} 리포트 생성 여부
     */
  async _generateFeedbackReport() {
    return this.consolidatorGC.generateFeedbackReport();
  }


  /**
     * 검증 주기 초과 파편 목록 반환
     * @returns {Promise<Array>} stale fragment 요약 목록
     */
  async _collectStaleFragments() {
    return this.consolidatorGC.collectStaleFragments();
  }

  /**
   * session_reflect 토픽의 오래되고 낮은 importance 파편을 정리한다.
   * type별로 최신 keepPerType개를 보존하고 나머지 중 조건에 맞는 것만 삭제.
   */
  async _purgeStaleReflections() {
    return this.consolidatorGC.purgeStaleReflections();
  }

  /**
     * 통계 조회
     */
  async getStats() {
    const pool = getPrimaryPool();
    if (!pool) return {};

    const result = await pool.query(
      `SELECT
                count(*)                                                     AS total,
                count(*) FILTER (WHERE ttl_tier = 'permanent')               AS permanent,
                count(*) FILTER (WHERE ttl_tier = 'hot')                     AS hot,
                count(*) FILTER (WHERE ttl_tier = 'warm')                    AS warm,
                count(*) FILTER (WHERE ttl_tier = 'cold')                    AS cold,
                count(*) FILTER (WHERE embedding IS NOT NULL)                AS embedded,
                avg(importance)                                              AS avg_importance,
                count(DISTINCT topic)                                        AS topic_count,
                count(*) FILTER (WHERE type = 'error')                       AS error_count,
                count(*) FILTER (WHERE type = 'preference')                  AS preference_count,
                count(*) FILTER (WHERE type = 'decision')                    AS decision_count,
                count(*) FILTER (WHERE type = 'procedure')                   AS procedure_count,
                count(*) FILTER (WHERE type = 'fact')                        AS fact_count,
                count(*) FILTER (WHERE type = 'relation')                    AS relation_count,
                sum(access_count)                                            AS total_accesses,
                avg(utility_score)                                           AS avg_utility,
                sum(estimated_tokens)                                        AS total_tokens
             FROM ${SCHEMA}.fragments`
    );

    const stats          = result.rows[0];
    stats.avg_importance = parseFloat(stats.avg_importance || 0).toFixed(3);
    stats.avg_utility    = parseFloat(stats.avg_utility || 0).toFixed(3);
    stats.total_tokens   = parseInt(stats.total_tokens || 0, 10);

    return stats;
  }

  /**
   * 긴 파편을 Gemini CLI로 원자 파편들로 분할
   *
   * 동작:
   *   1. length(content) > threshold인 파편 조회 (앵커·만료 제외)
   *   2. 파편별 Gemini CLI 호출 → 1~2문장 원자 항목 배열 반환
   *   3. 각 항목을 독립 파편으로 INSERT (embedding은 EmbeddingWorker가 사후 처리)
   *   4. 형제 파편끼리 related 순차 링크 + 각 파편 → 원본 part_of 링크
   *   5. 원본 파편 valid_to = NOW() (supersede 처리)
   *
   * @returns {number} 분할 처리된 원본 파편 수
   */
  async _splitLongFragments() {
    return this.consolidatorGC.splitLongFragments();
  }

  /**
   * 최근 24시간 피드백 데이터를 기반으로 파편 importance를 점진 보정한다.
   *
   * @returns {Promise<number>} 업데이트된 파편 수
   */
  async _calibrateByFeedback() {
    return this.consolidatorGC.calibrateByFeedback();
  }
}

/** ─── 피드백 보정 순수 함수 (export — 테스트 가능) ─── */

const FEEDBACK_LR = 0.05;

/**
 * 피드백 시그널에 따른 importance 보정
 *
 * @param {number}  importance - 현재 importance [0, 1]
 * @param {boolean} relevant   - 관련성
 * @param {boolean} sufficient - 충분성
 * @returns {number} 보정된 importance
 */
export function applyFeedbackSignal(importance, relevant, sufficient) {
  let signal;
  if (!relevant)                   signal = -1.0;
  else if (relevant && sufficient) signal =  1.0;
  else                             signal = -0.5;

  const adjusted = importance * (1 + FEEDBACK_LR * signal);
  return Math.min(1.0, Math.max(0.05, adjusted));
}
