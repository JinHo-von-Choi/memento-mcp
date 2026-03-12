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
import { geminiCLIJson, isGeminiCLIAvailable } from "../gemini.js";
import { detectContradiction as nliDetect, isNLIAvailable } from "./NLIClassifier.js";
import { logInfo, logWarn, logError, logDebug } from "../logger.js";
import { ContradictionDetector } from "./ContradictionDetector.js";

const SCHEMA = "agent_memory";

export class MemoryConsolidator {
  constructor() {
    this.store                = new FragmentStore();
    this.index                = new FragmentIndex();
    this.contradictionDetector = new ContradictionDetector(this.store);
  }

  /**
     * 전체 유지보수 실행
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
    const pool = getPrimaryPool();
    if (!pool) return false;

    try {
      /** 마지막 리포트 이후 피드백 존재 여부 확인 */
      const { redisClient } = await import("../redis.js");
      const LAST_REPORT_KEY = "frag:feedback_report_at";

      let lastReportAt = null;
      try {
        if (redisClient && redisClient.status === "ready") {
          lastReportAt = await redisClient.get(LAST_REPORT_KEY);
        }
      } catch (err) { logWarn(`[MemoryConsolidator] Redis lastReportAt read failed: ${err.message}`); }

      /** 도구별 피드백 집계 */
      const params     = [];
      let dateFilter   = "";
      if (lastReportAt) {
        params.push(lastReportAt);
        dateFilter     = `AND created_at > $1`;
      }

      const toolStats  = await pool.query(
        `SELECT
           tool_name,
           count(*)::int                                       AS total,
           count(*) FILTER (WHERE relevant  = true)::int       AS relevant_count,
           count(*) FILTER (WHERE sufficient = true)::int      AS sufficient_count,
           count(*) FILTER (WHERE trigger_type = 'sampled')::int  AS sampled_count,
           count(*) FILTER (WHERE trigger_type = 'voluntary')::int AS voluntary_count
         FROM agent_memory.tool_feedback
         WHERE 1=1 ${dateFilter}
         GROUP BY tool_name
         ORDER BY total DESC`,
        params
      );

      /** 전체 피드백 수 */
      const totalFeedbacks = toolStats.rows.reduce((sum, r) => sum + r.total, 0);
      if (totalFeedbacks === 0) return false;

      /** 개선 제안 수집 (최근 50건) */
      const suggestions = await pool.query(
        `SELECT tool_name, suggestion
         FROM agent_memory.tool_feedback
         WHERE suggestion IS NOT NULL AND suggestion != ''
         ${dateFilter}
         ORDER BY created_at DESC
         LIMIT 50`,
        params
      );

      /** task_feedback 집계 */
      const taskStats = await pool.query(
        `SELECT
           count(*)::int                                           AS total_sessions,
           count(*) FILTER (WHERE overall_success = true)::int     AS success_count
         FROM agent_memory.task_feedback
         WHERE 1=1 ${dateFilter}`,
        params
      );

      /** 리포트 마크다운 생성 */
      const now        = new Date().toISOString().split("T")[0];
      const reportFrom = lastReportAt ? lastReportAt.split("T")[0] : "전체";
      const lines      = [];

      lines.push("# 도구 유용성 피드백 리포트");
      lines.push("");
      lines.push(`생성일: ${now}`);
      lines.push(`기간: ${reportFrom} ~ ${now}`);
      lines.push(`전체 피드백 수: ${totalFeedbacks}건`);
      lines.push("");

      lines.push("## 도구별 통계");
      lines.push("");
      lines.push("| 도구 | 피드백 수 | 관련성 | 충분성 | 샘플링 | 자발적 | 경고 |");
      lines.push("|------|-----------|--------|--------|--------|--------|------|");

      for (const row of toolStats.rows) {
        const relevantPct   = row.total > 0 ? Math.round((row.relevant_count / row.total) * 100) : 0;
        const sufficientPct = row.total > 0 ? Math.round((row.sufficient_count / row.total) * 100) : 0;
        const warning       = [];

        if (row.total < 10) {
          warning.push("데이터 부족");
        } else {
          if (relevantPct < 50)   warning.push("관련성 낮음");
          if (sufficientPct < 50) warning.push("충분성 낮음");
        }

        const warningStr = warning.length > 0 ? warning.join(", ") : "-";

        lines.push(
          `| ${row.tool_name} | ${row.total} | ${relevantPct}% | ${sufficientPct}% ` +
          `| ${row.sampled_count} | ${row.voluntary_count} | ${warningStr} |`
        );
      }

      /** 개선 제안 섹션 */
      if (suggestions.rows.length > 0) {
        lines.push("");
        lines.push("## 주요 개선 제안");
        lines.push("");

        const grouped = {};
        for (const s of suggestions.rows) {
          if (!grouped[s.tool_name]) grouped[s.tool_name] = [];
          grouped[s.tool_name].push(s.suggestion);
        }

        for (const [tool, sugs] of Object.entries(grouped)) {
          lines.push(`### ${tool}`);
          for (const sug of sugs.slice(0, 5)) {
            lines.push(`- ${sug}`);
          }
          lines.push("");
        }
      }

      /** 작업 레벨 통계 */
      const ts = taskStats.rows[0];
      if (ts && ts.total_sessions > 0) {
        const successRate = Math.round((ts.success_count / ts.total_sessions) * 100);
        lines.push("## 작업 레벨 통계");
        lines.push("");
        lines.push(`| 지표 | 값 |`);
        lines.push(`|------|-----|`);
        lines.push(`| 평가된 세션 수 | ${ts.total_sessions} |`);
        lines.push(`| 성공 비율 | ${successRate}% |`);
        lines.push("");
      }

      /** 파일 저장 (docs/reports/ 디렉토리) */
      const fs   = await import("fs");
      const path = await import("path");

      const reportsDir  = path.default.join(process.cwd(), "docs", "reports");
      const reportPath  = path.default.join(reportsDir, "tool-feedback-report.md");

      await fs.promises.mkdir(reportsDir, { recursive: true });
      await fs.promises.writeFile(reportPath, lines.join("\n"), "utf-8");

      logInfo(`[MemoryConsolidator] Feedback report generated: ${reportPath}`);

      /** 타임스탬프 갱신 */
      try {
        if (redisClient && redisClient.status === "ready") {
          await redisClient.set(LAST_REPORT_KEY, new Date().toISOString());
        }
      } catch (err) { logWarn(`[MemoryConsolidator] Redis lastReportAt write failed: ${err.message}`); }

      return true;
    } catch (err) {
      logWarn(`[MemoryConsolidator] Feedback report generation failed: ${err.message}`);
      return false;
    }
  }

  /**
     * 검증 주기 초과 파편 목록 반환
     * @returns {Promise<Array>} stale fragment 요약 목록
     */
  async _collectStaleFragments() {
    const pool = getPrimaryPool();
    if (!pool) return [];

    const result = await pool.query(
      `SELECT id, content, type, verified_at,
              EXTRACT(DAY FROM NOW() - verified_at)::int AS days_since_verification
       FROM agent_memory.fragments
       WHERE (type = 'procedure' AND verified_at < NOW() - INTERVAL '30 days')
          OR (type = 'fact'      AND verified_at < NOW() - INTERVAL '60 days')
          OR (type = 'decision'  AND verified_at < NOW() - INTERVAL '90 days')
          OR (type NOT IN ('procedure', 'fact', 'decision') AND verified_at < NOW() - INTERVAL '60 days')
       ORDER BY days_since_verification DESC
       LIMIT 20`
    );

    return result.rows.map(r => ({
      id                    : r.id,
      content               : r.content.substring(0, 80) + (r.content.length > 80 ? "..." : ""),
      type                  : r.type,
      verified_at           : r.verified_at,
      days_since_verification: r.days_since_verification
    }));
  }

  /**
   * session_reflect 토픽의 오래되고 낮은 importance 파편을 정리한다.
   * type별로 최신 keepPerType개를 보존하고 나머지 중 조건에 맞는 것만 삭제.
   */
  async _purgeStaleReflections() {
    const policy   = MEMORY_CONFIG.reflectionPolicy || {};
    const maxDays  = Number(policy.maxAgeDays) || 30;
    const maxImp   = Number(policy.maxImportance) || 0.3;
    const keepN    = Number(policy.keepPerType) || 5;
    const maxDel   = Number(policy.maxDeletePerCycle) || 30;

    const result = await queryWithAgentVector("system",
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY type ORDER BY importance DESC, created_at DESC) AS rn
         FROM ${SCHEMA}.fragments
         WHERE topic = 'session_reflect'
       )
       DELETE FROM ${SCHEMA}.fragments
       WHERE id IN (
         SELECT r.id FROM ranked r
         JOIN ${SCHEMA}.fragments f ON f.id = r.id
         WHERE r.rn > $1
           AND f.importance < $2
           AND f.created_at < NOW() - make_interval(days => $3)
           AND f.is_anchor = FALSE
           AND f.ttl_tier != 'permanent'
         LIMIT $4
       )`,
      [keepN, maxImp, maxDays, maxDel],
      "write"
    );

    if (result.rowCount > 0) {
      logInfo(`[MemoryConsolidator] Purged ${result.rowCount} stale session_reflect fragments`);
    }
    return result.rowCount;
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
    if (!await isGeminiCLIAvailable()) return 0;

    const pool = getPrimaryPool();
    if (!pool)  return 0;

    const cfg       = MEMORY_CONFIG.fragmentSplit || {};
    const threshold = cfg.lengthThreshold ?? 300;
    const batchSize = cfg.batchSize       ?? 10;
    const minItems  = cfg.minItems        ?? 2;
    const maxItems  = cfg.maxItems        ?? 8;
    const timeoutMs = cfg.timeoutMs       ?? 30_000;

    const candidates = await pool.query(
      `SELECT id, content, topic, type, importance, agent_id, key_id
         FROM ${SCHEMA}.fragments
        WHERE length(content) > $1
          AND valid_to IS NULL
          AND is_anchor = FALSE
        ORDER BY length(content) DESC
        LIMIT $2`,
      [threshold, batchSize]
    );

    if (candidates.rows.length === 0) return 0;

    const { randomUUID } = await import("crypto");
    let splitCount = 0;

    for (const frag of candidates.rows) {
      try {
        const prompt =
          `다음 텍스트를 의미 단위로 쪼개어 각각 1~2문장의 원자적 사실로 분리하라.\n\n` +
          `텍스트:\n${frag.content}\n\n` +
          `규칙:\n` +
          `- 항목 1개 = 독립적으로 이해 가능한 단일 사실.\n` +
          `- 1~2문장을 넘지 않는다.\n` +
          `- 원문 정보를 손실 없이 유지한다.\n` +
          `- ${minItems}~${maxItems}개 항목으로 분리한다.\n\n` +
          `JSON 배열만 출력하라 (설명 없이):\n["항목1", "항목2", ...]`;

        const items = await geminiCLIJson(prompt, { timeoutMs });

        if (!Array.isArray(items) || items.length < minItems) continue;

        const agentId = frag.agent_id || "default";
        const keyId   = frag.key_id   ?? null;
        const newIds  = [];

        for (const item of items.slice(0, maxItems)) {
          const text = typeof item === "string" ? item.trim() : String(item).trim();
          if (!text) continue;

          const newId = randomUUID();
          const inserted = await this.store.insert({
            id        : newId,
            content   : text,
            topic     : frag.topic,
            type      : frag.type,
            importance: frag.importance,
            keywords  : [],
            source    : `split:${frag.id}`,
            linked_to : [],
            ttl_tier  : "warm",
            is_anchor : false,
            agent_id  : agentId,
            key_id    : keyId
          });

          if (inserted) newIds.push(inserted);
        }

        if (newIds.length < minItems) continue;

        /** 형제 간 순차 related 링크 */
        for (let i = 1; i < newIds.length; i++) {
          await this.store.createLink(newIds[i - 1], newIds[i], "related", agentId).catch(() => {});
        }

        /** 각 자식 → 원본 part_of 링크 */
        for (const childId of newIds) {
          await this.store.createLink(childId, frag.id, "part_of", agentId).catch(() => {});
        }

        /** 원본 supersede */
        await pool.query(
          `UPDATE ${SCHEMA}.fragments
              SET valid_to   = NOW(),
                  importance = GREATEST(0.05, importance * 0.3)
            WHERE id = $1`,
          [frag.id]
        );

        splitCount++;
        logInfo(`[MemoryConsolidator] Split fragment ${frag.id} → ${newIds.length} atomic fragments`);

      } catch (err) {
        logWarn(`[MemoryConsolidator] _splitLongFragments failed for ${frag.id}: ${err.message}`);
      }
    }

    return splitCount;
  }

  /**
   * 최근 24시간 피드백 데이터를 기반으로 파편 importance를 점진 보정한다.
   *
   * @returns {Promise<number>} 업데이트된 파편 수
   */
  async _calibrateByFeedback() {
    const pool = getPrimaryPool();
    if (!pool) return 0;

    let redisClient;
    try {
      const redis = await import("../redis.js");
      redisClient = redis.redisClient;
    } catch { return 0; }

    if (!redisClient || redisClient.status !== "ready") return 0;

    const LR = 0.05;

    const feedbackResult = await pool.query(`
      SELECT session_id,
             bool_and(relevant)   AS all_relevant,
             bool_and(sufficient) AS all_sufficient,
             count(*)::int         AS cnt
      FROM ${SCHEMA}.tool_feedback
      WHERE session_id IS NOT NULL
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY session_id
      HAVING count(*) >= 2
    `).catch(() => ({ rows: [] }));

    if (feedbackResult.rows.length === 0) return 0;

    const { SessionActivityTracker } = await import("./SessionActivityTracker.js");
    let updated = 0;

    for (const row of feedbackResult.rows) {
      const activity = await SessionActivityTracker.getActivity(row.session_id);
      if (!activity || !activity.fragments || activity.fragments.length === 0) continue;

      const fragIds = activity.fragments.slice(0, 20);

      let signal;
      if (!row.all_relevant)                              signal = -1.0;
      else if (row.all_relevant && row.all_sufficient)    signal =  1.0;
      else                                                signal = -0.5;

      for (const fragId of fragIds) {
        try {
          await queryWithAgentVector("default",
            `UPDATE ${SCHEMA}.fragments
             SET importance = LEAST(1.0, GREATEST(0.05,
               importance * (1.0 + $2::float * $3::float)
             ))
             WHERE id = $1 AND is_anchor = false`,
            [fragId, LR, signal],
            "write"
          );
          updated++;
        } catch { /* 무시 */ }
      }
    }

    return updated;
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
