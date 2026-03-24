/**
 * ConsolidatorGC — 피드백 리포트, stale 파편 수집/정리, 긴 파편 분할, 피드백 기반 보정
 *
 * 작성자: 최진호
 * 작성일: 2026-03-12
 */

import { getPrimaryPool, queryWithAgentVector } from "../tools/db.js";
import { MEMORY_CONFIG } from "../../config/memory.js";
import { geminiCLIJson, isGeminiCLIAvailable } from "../gemini.js";
import { logInfo, logWarn } from "../logger.js";

const SCHEMA = "agent_memory";

export class ConsolidatorGC {
  /**
   * @param {import("./FragmentStore.js").FragmentStore} store
   */
  constructor(store) {
    this.store = store;
  }

  /**
   * 피드백 리포트 생성
   *
   * tool_feedback + task_feedback 데이터를 집계하여
   * 도구별 관련성/충분성 비율, 주요 개선 제안을 산출한다.
   * 최소 피드백 10건 이상인 도구만 통계 표시.
   *
   * @returns {Promise<boolean>} 리포트 생성 여부
   */
  async generateFeedbackReport() {
    const pool = getPrimaryPool();
    if (!pool) return false;

    try {
      const { redisClient } = await import("../redis.js");
      const LAST_REPORT_KEY = "frag:feedback_report_at";

      let lastReportAt = null;
      try {
        if (redisClient && redisClient.status === "ready") {
          lastReportAt = await redisClient.get(LAST_REPORT_KEY);
        }
      } catch (err) { logWarn(`[ConsolidatorGC] Redis lastReportAt read failed: ${err.message}`); }

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

      const totalFeedbacks = toolStats.rows.reduce((sum, r) => sum + r.total, 0);
      if (totalFeedbacks === 0) return false;

      const suggestions = await pool.query(
        `SELECT tool_name, suggestion
         FROM agent_memory.tool_feedback
         WHERE suggestion IS NOT NULL AND suggestion != ''
         ${dateFilter}
         ORDER BY created_at DESC
         LIMIT 50`,
        params
      );

      const taskStats = await pool.query(
        `SELECT
           count(*)::int                                           AS total_sessions,
           count(*) FILTER (WHERE overall_success = true)::int     AS success_count
         FROM agent_memory.task_feedback
         WHERE 1=1 ${dateFilter}`,
        params
      );

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

      const fs   = await import("fs");
      const path = await import("path");

      const reportsDir  = path.default.join(process.cwd(), "docs", "reports");
      const reportPath  = path.default.join(reportsDir, "tool-feedback-report.md");

      await fs.promises.mkdir(reportsDir, { recursive: true });
      await fs.promises.writeFile(reportPath, lines.join("\n"), "utf-8");

      logInfo(`[ConsolidatorGC] Feedback report generated: ${reportPath}`);

      try {
        if (redisClient && redisClient.status === "ready") {
          await redisClient.set(LAST_REPORT_KEY, new Date().toISOString());
        }
      } catch (err) { logWarn(`[ConsolidatorGC] Redis lastReportAt write failed: ${err.message}`); }

      return true;
    } catch (err) {
      logWarn(`[ConsolidatorGC] Feedback report generation failed: ${err.message}`);
      return false;
    }
  }

  /**
   * 검증 주기 초과 파편 목록 반환
   *
   * @returns {Promise<Array>} stale fragment 요약 목록
   */
  async collectStaleFragments() {
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
   *
   * @returns {Promise<number>} 삭제된 행 수
   */
  async purgeStaleReflections() {
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
      logInfo(`[ConsolidatorGC] Purged ${result.rowCount} stale session_reflect fragments`);
    }
    return result.rowCount;
  }

  /**
   * 긴 파편을 Gemini CLI로 원자 파편들로 분할
   *
   * @returns {Promise<number>} 분할 처리된 원본 파편 수
   */
  async splitLongFragments() {
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

        for (let i = 1; i < newIds.length; i++) {
          await this.store.createLink(newIds[i - 1], newIds[i], "related", agentId).catch(() => {});
        }

        for (const childId of newIds) {
          await this.store.createLink(childId, frag.id, "part_of", agentId).catch(() => {});
        }

        await pool.query(
          `UPDATE ${SCHEMA}.fragments
              SET valid_to   = NOW(),
                  importance = GREATEST(0.05, importance * 0.3)
            WHERE id = $1`,
          [frag.id]
        );

        splitCount++;
        logInfo(`[ConsolidatorGC] Split fragment ${frag.id} → ${newIds.length} atomic fragments`);

      } catch (err) {
        logWarn(`[ConsolidatorGC] splitLongFragments failed for ${frag.id}: ${err.message}`);
      }
    }

    return splitCount;
  }

  /**
   * 최근 24시간 피드백 데이터를 기반으로 파편 importance를 점진 보정한다.
   *
   * @returns {Promise<number>} 업데이트된 파편 수
   */
  async calibrateByFeedback() {
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

  /**
   * search_events 30일 초과 레코드 정리
   * @returns {Promise<number>} 삭제된 행 수
   */
  async _gcSearchEvents() {
    const pool = getPrimaryPool();
    if (!pool) return 0;

    try {
      const result = await pool.query(
        `DELETE FROM agent_memory.search_events
         WHERE created_at < NOW() - INTERVAL '30 days'
         RETURNING id`
      );
      return result.rowCount || 0;
    } catch (err) {
      logWarn(`[ConsolidatorGC] search_events GC failed: ${err.message}`);
      return 0;
    }
  }
}
