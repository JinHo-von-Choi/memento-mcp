/**
 * ReflectProcessor -- reflect() 로직 전담 모듈
 *
 * 작성자: 최진호
 * 작성일: 2026-04-05
 *
 * MemoryManager.reflect() 220줄 본문을 추출.
 * summary / decisions / errors_resolved / new_procedures / open_questions를
 * 파편으로 변환·저장하고, episode 생성 및 Working Memory 정리를 수행한다.
 */

import { MEMORY_CONFIG }                       from "../../config/memory.js";
import { pushToQueuePriority }                 from "../redis.js";
import { logWarn }                             from "../logger.js";
import { MorphemeIndex }                       from "./MorphemeIndex.js";
import { linkEpisodeMilestone }                from "./EpisodeContinuityService.js";
import { getPrimaryPool }                      from "../tools/db.js";

const morphemeIndex = new MorphemeIndex();

export class ReflectProcessor {
  /**
   * @param {Object} deps
   *   - store         {FragmentStore}
   *   - index         {FragmentIndex}
   *   - factory       {FragmentFactory}
   *   - sessionLinker {SessionLinker}
   *   - remember      {Function} MemoryManager.remember 바인딩
   */
  constructor({ store, index, factory, sessionLinker, remember }) {
    this.store         = store;
    this.index         = index;
    this.factory       = factory;
    this.sessionLinker = sessionLinker;
    this.remember      = remember;
  }

  /**
   * reflect 메인 로직 실행
   *
   * @param {Object} params - reflect 파라미터 전체
   * @returns {Object} { fragments, count, breakdown }
   */
  async process(params) {
    const fragments  = [];
    const sessionSrc = `session:${params.sessionId || "unknown"}`;
    const agentId    = params.agentId || "default";
    const keyId      = params._keyId ?? null;
    const workspace  = params.workspace ?? params._defaultWorkspace ?? null;
    const breakdown  = { summary: 0, decisions: 0, errors: 0, procedures: 0, questions: 0 };

    /** 0. sessionId가 있으면 세션 파편에서 미입력 항목 종합 */
    if (params.sessionId) {
      const consolidated = await this.sessionLinker.consolidateSessionFragments(
        params.sessionId, agentId, keyId
      );
      if (consolidated) {
        if (!params.summary && consolidated.summary)                        params.summary          = consolidated.summary;
        if (!params.decisions?.length && consolidated.decisions?.length)     params.decisions        = consolidated.decisions;
        if (!params.errors_resolved?.length && consolidated.errors_resolved?.length) params.errors_resolved = consolidated.errors_resolved;
        if (!params.new_procedures?.length && consolidated.new_procedures?.length)   params.new_procedures  = consolidated.new_procedures;
        if (!params.open_questions?.length && consolidated.open_questions?.length)    params.open_questions  = consolidated.open_questions;
      }
    }

    /**
     * 파편 배열을 병렬로 INSERT하고 결과를 fragments에 누적하는 내부 헬퍼.
     * 각 insert()는 독립적이므로 Promise.all로 병렬화해 레이턴시를 줄인다.
     */
    const _insertAll = async (items) => {
      const settled = await Promise.allSettled(
        items.map(async ({ f, fragType }) => {
          const id = await this.store.insert(f);
          await this.index.index({ ...f, id }, params.sessionId, f.key_id ?? null);
          return { id, content: f.content, type: fragType, keywords: f.keywords };
        })
      );
      for (const r of settled) {
        if (r.status === "fulfilled") {
          fragments.push(r.value);
        } else {
          logWarn(`[ReflectProcessor] insert failed: ${r.reason?.message}`);
        }
      }
    };

    /** 1. summary -> fact 파편 (배열 또는 문자열 모두 처리) */
    if (params.summary) {
      const summaryItems = Array.isArray(params.summary)
        ? params.summary.filter(s => s && s.trim().length > 0)
        : this.factory.splitAndCreate(params.summary, {
            topic: "session_reflect", type: "fact", source: sessionSrc, agentId
          }).map(f => f.content);

      const batch = summaryItems.map(item => {
        const f = this.factory.create({
          content   : item.trim ? item.trim() : item,
          topic     : "session_reflect",
          type      : "fact",
          source    : sessionSrc,
          agentId,
          sessionId : params.sessionId,
        });
        f.agent_id  = agentId;
        f.key_id    = keyId;
        f.workspace = workspace;
        return { f, fragType: "fact" };
      });
      await _insertAll(batch);
      breakdown.summary += batch.length;
    }

    /** 2. decisions -> decision 파편 */
    if (params.decisions && params.decisions.length > 0) {
      const batch = params.decisions
        .filter(dec => dec && dec.trim().length > 0)
        .map(dec => {
          const f = this.factory.create({
            content    : dec.trim(),
            topic      : "session_reflect",
            type       : "decision",
            importance : 0.8,
            source     : sessionSrc,
            agentId,
            sessionId  : params.sessionId,
          });
          f.agent_id  = agentId;
          f.key_id    = keyId;
          f.workspace = workspace;
          return { f, fragType: "decision" };
        });
      await _insertAll(batch);
      breakdown.decisions += batch.length;
    }

    /** 3. errors_resolved -> error 파편 (해결됨 표시) */
    if (params.errors_resolved && params.errors_resolved.length > 0) {
      const batch = params.errors_resolved
        .filter(err => err && err.trim().length > 0)
        .map(err => {
          const f = this.factory.create({
            content          : `[해결됨] ${err.trim()}`,
            topic            : "session_reflect",
            type             : "error",
            importance       : 0.5,
            source           : sessionSrc,
            agentId,
            resolutionStatus : "resolved",
            sessionId        : params.sessionId,
          });
          f.agent_id  = agentId;
          f.key_id    = keyId;
          f.workspace = workspace;
          return { f, fragType: "error" };
        });
      await _insertAll(batch);
      breakdown.errors += batch.length;
    }

    /** 4. new_procedures -> procedure 파편 */
    if (params.new_procedures && params.new_procedures.length > 0) {
      const batch = params.new_procedures
        .filter(proc => proc && proc.trim().length > 0)
        .map(proc => {
          const f = this.factory.create({
            content    : proc.trim(),
            topic      : "session_reflect",
            type       : "procedure",
            importance : 0.7,
            source     : sessionSrc,
            agentId,
            sessionId  : params.sessionId,
          });
          f.agent_id  = agentId;
          f.key_id    = keyId;
          f.workspace = workspace;
          return { f, fragType: "procedure" };
        });
      await _insertAll(batch);
      breakdown.procedures += batch.length;
    }

    /** 5. open_questions -> fact 파편 (낮은 importance, 후속 처리용) */
    if (params.open_questions && params.open_questions.length > 0) {
      const batch = params.open_questions
        .filter(q => q && q.trim().length > 0)
        .map(q => {
          const f = this.factory.create({
            content          : `[미해결] ${q.trim()}`,
            topic            : "session_reflect",
            type             : "fact",
            importance       : 0.4,
            source           : sessionSrc,
            agentId,
            resolutionStatus : "open",
            sessionId        : params.sessionId,
          });
          f.agent_id  = agentId;
          f.key_id    = keyId;
          f.workspace = workspace;
          return { f, fragType: "fact" };
        });
      await _insertAll(batch);
      breakdown.questions += batch.length;
    }

    /** 6. task_effectiveness -> task_feedback 저장 */
    if (params.task_effectiveness) {
      try {
        await this._saveTaskFeedback(
          params.sessionId || "unknown",
          params.task_effectiveness
        );
        breakdown.task_feedback = true;
      } catch (err) {
        logWarn(`[ReflectProcessor] task_feedback save failed: ${err.message}`);
        breakdown.task_feedback = false;
      }
    }

    /** 6.5. 세션 파편 간 자동 link 생성 */
    await this.sessionLinker.autoLinkSessionFragments(fragments, agentId);

    /** 6.7. reflect 파편 우선순위 임베딩 큐 적재 (rpush -> rpop이 즉시 처리) */
    const queueName = MEMORY_CONFIG.embeddingWorker.queueKey;
    for (const f of fragments) {
      if (f.id) {
        await pushToQueuePriority(queueName, { fragmentId: f.id }).catch((err) => {
          logWarn(`[ReflectProcessor] embedding queue push failed: ${err.message}`);
        });
      }
    }

    /** 6.8. reflect 파편 형태소 사전 등록 (fire-and-forget) */
    Promise.all(
      fragments.map(f =>
        morphemeIndex.tokenize(f.content)
          .then(morphemes => morphemeIndex.getOrRegisterEmbeddings(morphemes))
          .catch((err) => { logWarn(`[ReflectProcessor] morpheme registration failed: ${err.message}`); })
      )
    ).catch((err) => { logWarn(`[ReflectProcessor] morpheme registration failed: ${err.message}`); });

    /** 7. narrative_summary -> episode 파편 (세션 서사 요약) */
    if (params.narrative_summary) {
      const sessionId = params.sessionId || "unknown";
      await this.remember({
        content        : params.narrative_summary,
        type           : "episode",
        topic          : "session_reflect",
        source         : `session:${sessionId}`,
        sessionId      : sessionId,
        importance     : 0.6,
        contextSummary : this._buildEpisodeContext(params, fragments),
        agentId,
        _keyId         : keyId
      });
      breakdown.episode = 1;
    }

    /** 7.5. Episode Continuity -- milestone_reached 이벤트 + preceded_by 엣지 (fire-and-forget) */
    if (fragments.length > 0) {
      const episodeId = fragments.find(f => f.type === "episode")?.id ?? fragments[0]?.id;
      if (episodeId) {
        linkEpisodeMilestone(episodeId, agentId, keyId, params.sessionId).catch(() => {});
      }
    }

    /** 8. Working Memory 정리 (세션 종료) */
    if (params.sessionId) {
      await this.index.clearWorkingMemory(params.sessionId);
    }

    return { fragments, count: fragments.length, breakdown };
  }

  /**
   * reflect에서 저장된 파편을 요약하여 episode의 contextSummary를 생성한다.
   * @private
   */
  _buildEpisodeContext(params, fragments) {
    const counts = {};
    for (const f of fragments) {
      counts[f.type] = (counts[f.type] || 0) + 1;
    }
    const parts = Object.entries(counts).map(([t, c]) => `${t} ${c}건`);

    const topics = [...new Set(fragments
      .flatMap(f => f.keywords || [])
      .filter(Boolean)
    )].slice(0, 5);

    let ctx = `세션 파편 ${fragments.length}건 저장 (${parts.join(', ')}).`;
    if (topics.length > 0) {
      ctx += ` 주요 키워드: ${topics.join(', ')}.`;
    }
    return ctx;
  }

  /**
   * task_feedback 저장 (reflect에서 호출)
   * @private
   */
  async _saveTaskFeedback(sessionId, effectiveness) {
    const pool = getPrimaryPool();
    if (!pool) return;

    await pool.query(
      `INSERT INTO agent_memory.task_feedback
             (session_id, overall_success, tool_highlights, tool_pain_points)
       VALUES ($1, $2, $3, $4)`,
      [
        sessionId,
        effectiveness.overall_success || false,
        effectiveness.tool_highlights || [],
        effectiveness.tool_pain_points || []
      ]
    );
  }
}
