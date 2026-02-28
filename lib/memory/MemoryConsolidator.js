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

import { FragmentStore } from "./FragmentStore.js";
import { FragmentIndex } from "./FragmentIndex.js";
import { getPrimaryPool, queryWithAgentVector } from "../tools/db.js";
import { MEMORY_CONFIG } from "../../config/memory.js";
import { geminiCLIJson, isGeminiCLIAvailable } from "../gemini.js";
import { detectContradiction as nliDetect, isNLIAvailable } from "./NLIClassifier.js";

const SCHEMA = "agent_memory";

export class MemoryConsolidator {
  constructor() {
    this.store = new FragmentStore();
    this.index = new FragmentIndex();
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
      duplicatesMerged     : 0,
      embeddingsAdded      : 0,
      utilityUpdated       : 0,
      anchorsPromoted      : 0,
      contradictionsFound       : 0,
      nliResolvedDirectly       : 0,
      nliSkippedAsNonContra     : 0,
      feedbackReportGenerated   : false,
      indexesPruned            : false,
      stale_fragments          : []
    };

    try {
      /** 1. TTL 계층 전환 (전환 수 추적) */
      results.ttlTransitions = await this._transitionWithCount();

      /** 2. 중요도 감쇠 */
      await this.store.decayImportance();
      results.importanceDecay = true;

      /** 3. 만료 파편 삭제 */
      results.expiredDeleted = await this.store.deleteExpired();

      /** 4. 중복 파편 병합 */
      results.duplicatesMerged = await this._mergeDuplicates();

      /** 5. 누락 임베딩 보충 */
      results.embeddingsAdded = await this.store.generateMissingEmbeddings(5);

      /** 6. utility_score 갱신 */
      results.utilityUpdated = await this._updateUtilityScores();

      /** 6.5. 자동 앵커 승격 (Phase 3) */
      results.anchorsPromoted = await this._promoteAnchors();

      /** 7. 증분 모순 탐지 (NLI + Gemini CLI 하이브리드) */
      const contraResult = await this._detectContradictions();
      results.contradictionsFound   = contraResult.found;
      results.nliResolvedDirectly   = contraResult.nliResolved;
      results.nliSkippedAsNonContra = contraResult.nliSkipped;

      /** 7.5. 보류 중인 모순 후처리 */
      results.pendingContradictions = await this._processPendingContradictions();

      /** 8. 피드백 리포트 생성 */
      results.feedbackReportGenerated = await this._generateFeedbackReport();

      /** 9. Redis 인덱스 정리 */
      await this.index.pruneKeywordIndexes();
      results.indexesPruned = true;

      /** 10. stale 파편 목록 수집 */
      results.stale_fragments = await this._collectStaleFragments();

    } catch (err) {
      console.error(`[MemoryConsolidator] consolidation error: ${err.message}`);
      results.error = err.message;
    }

    console.log("[MemoryConsolidator] Result:", JSON.stringify(results));
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
    const { redisClient } = await import("../redis.js");
    const LAST_CHECK_KEY  = "frag:contradiction_check_at";
    const PENDING_KEY     = "frag:pending_contradictions";

    let lastCheckAt = null;
    try {
      if (redisClient && redisClient.status === "ready") {
        const val   = await redisClient.get(LAST_CHECK_KEY);
        lastCheckAt = val || null;
      }
    } catch { /* 무시 */ }

    let newFragsQuery = `
      SELECT id, content, topic, type, importance, embedding, created_at
      FROM ${SCHEMA}.fragments
      WHERE embedding IS NOT NULL`;

    const params = [];
    if (lastCheckAt) {
      params.push(lastCheckAt);
      newFragsQuery += ` AND created_at > $1`;
    }
    newFragsQuery += ` ORDER BY created_at DESC LIMIT 20`;

    const newFrags = await queryWithAgentVector("system", newFragsQuery, params);

    if (!newFrags.rows || newFrags.rows.length === 0) {
      return 0;
    }

    const nliAvail = isNLIAvailable();
    const cliAvail = await isGeminiCLIAvailable();
    let   found           = 0;
    let   nliResolved     = 0;
    let   nliSkipped      = 0;
    let   latestProcessed = null;

    for (const newFrag of newFrags.rows) {
      /** Stage 1: pgvector 코사인 유사도 > 0.85 */
      const candidates = await queryWithAgentVector("system",
        `SELECT id, content, topic, type, importance, created_at, is_anchor,
                1 - (embedding <=> (SELECT embedding FROM ${SCHEMA}.fragments WHERE id = $1)) AS similarity
         FROM ${SCHEMA}.fragments
         WHERE id != $1
           AND topic = $2
           AND embedding IS NOT NULL
           AND 1 - (embedding <=> (SELECT embedding FROM ${SCHEMA}.fragments WHERE id = $1)) > 0.85
         ORDER BY similarity DESC
         LIMIT 3`,
        [newFrag.id, newFrag.topic]
      );

      if (!candidates.rows || candidates.rows.length === 0) continue;

      for (const candidate of candidates.rows) {
        const existingLink = await queryWithAgentVector("system",
          `SELECT id FROM ${SCHEMA}.fragment_links
           WHERE ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))
             AND relation_type = 'contradicts'`,
          [newFrag.id, candidate.id]
        );
        if (existingLink.rows.length > 0) continue;

        /** Stage 2: NLI 분류 */
        if (nliAvail) {
          const nliResult = await nliDetect(newFrag.content, candidate.content);

          if (nliResult) {
            /** 높은 신뢰도 모순 → Gemini 없이 즉시 해소 */
            if (nliResult.contradicts && !nliResult.needsEscalation) {
              await this._resolveContradiction(newFrag, candidate,
                `NLI contradiction (conf=${nliResult.confidence.toFixed(3)})`);
              found++;
              nliResolved++;

              if (!latestProcessed || newFrag.created_at > latestProcessed) {
                latestProcessed = newFrag.created_at;
              }
              continue;
            }

            /** 확실한 비모순 → 스킵 */
            if (!nliResult.contradicts && !nliResult.needsEscalation) {
              nliSkipped++;

              if (!latestProcessed || newFrag.created_at > latestProcessed) {
                latestProcessed = newFrag.created_at;
              }
              continue;
            }

            /** NLI 불확실 → Stage 3로 에스컬레이션 (아래 fall-through) */
          }
        }

        /** Stage 3: Gemini CLI 에스컬레이션 */
        if (!cliAvail) {
          if (parseFloat(candidate.similarity) > 0.92) {
            await this._flagPotentialContradiction(
              redisClient, PENDING_KEY, newFrag, candidate
            );
          }
          continue;
        }

        try {
          const verdict = await this._askGeminiContradiction(newFrag.content, candidate.content);
          if (verdict.contradicts) {
            await this._resolveContradiction(newFrag, candidate, verdict.reasoning);
            found++;
          }
          if (!latestProcessed || newFrag.created_at > latestProcessed) {
            latestProcessed = newFrag.created_at;
          }
        } catch (err) {
          console.warn(`[MemoryConsolidator] Gemini contradiction check failed: ${err.message}`);
        }
      }
    }

    if (latestProcessed) {
      await this._updateContradictionTimestamp(redisClient, LAST_CHECK_KEY, latestProcessed);
    }

    if (nliResolved > 0 || nliSkipped > 0) {
      console.log(`[MemoryConsolidator] NLI stats: ${nliResolved} resolved, ${nliSkipped} skipped (saved ${nliResolved + nliSkipped} Gemini calls)`);
    }

    return { found, nliResolved, nliSkipped };
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
    } else {
      await queryWithAgentVector("system",
        `UPDATE ${SCHEMA}.fragments SET importance = importance * 0.5 WHERE id = $1`,
        [newFrag.id], "write"
      );
      await this.store.createLink(newFrag.id, candidate.id, "superseded_by", "system");
    }

    console.log(`[MemoryConsolidator] Contradiction resolved: ${newFrag.id} <-> ${candidate.id}: ${reasoning}`);
  }

  /**
     * Gemini CLI로 두 파편의 모순 여부를 판단 요청
     *
     * @param {string} contentA
     * @param {string} contentB
     * @returns {{ contradicts: boolean, reasoning: string }}
     */
  async _askGeminiContradiction(contentA, contentB) {
    const prompt = `두 개의 지식 파편이 서로 모순되는지 판단하라.

파편 A: "${contentA}"
파편 B: "${contentB}"

모순이란: 동일 주제에 대해 서로 양립 불가능한 주장을 하는 경우.
유사하지만 보완적인 정보는 모순이 아니다.
시간 경과에 의한 정보 갱신도 모순으로 판단한다 (구 정보 vs 신 정보).

반드시 다음 JSON 형식으로만 응답하라:
{"contradicts": true 또는 false, "reasoning": "판단 근거 1문장"}`;

    try {
      return await geminiCLIJson(prompt, { timeoutMs: 30_000 });
    } catch {
      return { contradicts: false, reasoning: "Gemini CLI 응답 파싱 실패" };
    }
  }

  /**
     * CLI 불가 시 고유사도 쌍을 pending 큐에 적재
     */
  async _flagPotentialContradiction(redisClient, key, fragA, fragB) {
    try {
      if (redisClient && redisClient.status === "ready") {
        const entry = JSON.stringify({
          idA:      fragA.id,
          idB:      fragB.id,
          contentA: fragA.content,
          contentB: fragB.content,
          flaggedAt: new Date().toISOString()
        });
        await redisClient.rpush(key, entry);
        console.debug(`[MemoryConsolidator] Flagged potential contradiction: ${fragA.id} <-> ${fragB.id}`);
      }
    } catch (err) {
      console.warn(`[MemoryConsolidator] Failed to flag contradiction: ${err.message}`);
    }
  }

  /**
     * pending 큐의 모순 후보들을 Gemini CLI로 재처리
     *
     * @returns {number} 처리된 모순 수
     */
  async _processPendingContradictions() {
    if (!(await isGeminiCLIAvailable())) return 0;

    const { redisClient } = await import("../redis.js");
    const PENDING_KEY     = "frag:pending_contradictions";

    if (!redisClient || redisClient.status !== "ready") return 0;

    let processed = 0;
    const batchSize = 10;

    for (let i = 0; i < batchSize; i++) {
      const raw = await redisClient.lpop(PENDING_KEY);
      if (!raw) break;

      try {
        const entry   = JSON.parse(raw);
        const verdict = await this._askGeminiContradiction(entry.contentA, entry.contentB);

        if (verdict.contradicts) {
          /** DB에서 최신 파편 정보 조회 */
          const fragAResult = await queryWithAgentVector("system",
            `SELECT id, content, created_at, is_anchor FROM ${SCHEMA}.fragments WHERE id = $1`,
            [entry.idA]
          );
          const fragBResult = await queryWithAgentVector("system",
            `SELECT id, content, created_at, is_anchor FROM ${SCHEMA}.fragments WHERE id = $1`,
            [entry.idB]
          );

          if (fragAResult.rows.length && fragBResult.rows.length) {
            await this._resolveContradiction(fragAResult.rows[0], fragBResult.rows[0], verdict.reasoning);
            processed++;
          }
        }
      } catch (err) {
        console.warn(`[MemoryConsolidator] Pending contradiction processing failed: ${err.message}`);
        /** 실패 시 다시 큐 뒤로 밀어넣기 */
        try { await redisClient.rpush(PENDING_KEY, raw); } catch { /* 무시 */ }
        break;
      }
    }

    if (processed > 0) {
      console.log(`[MemoryConsolidator] Processed ${processed} pending contradictions`);
    }
    return processed;
  }

  /**
     * 모순 탐지 타임스탬프 갱신
     * @param {string} [timestamp] - 명시하지 않으면 현재 시각
     */
  async _updateContradictionTimestamp(redisClient, key, timestamp) {
    try {
      if (redisClient && redisClient.status === "ready") {
        await redisClient.set(key, timestamp || new Date().toISOString());
      }
    } catch { /* 무시 */ }
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
      } catch { /* 무시 */ }

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

      console.log(`[MemoryConsolidator] Feedback report generated: ${reportPath}`);

      /** 타임스탬프 갱신 */
      try {
        if (redisClient && redisClient.status === "ready") {
          await redisClient.set(LAST_REPORT_KEY, new Date().toISOString());
        }
      } catch { /* 무시 */ }

      return true;
    } catch (err) {
      console.warn(`[MemoryConsolidator] Feedback report generation failed: ${err.message}`);
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
}
